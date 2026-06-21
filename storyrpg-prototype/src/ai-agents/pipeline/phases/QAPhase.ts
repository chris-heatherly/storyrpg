/**
 * QA Phase
 *
 * Phase 5 of story generation: runs the QARunner full-QA pass and the
 * IntegratedBestPracticesValidator in parallel, emits the choice-distribution
 * telemetry checkpoint, then drives the QA-driven targeted repair loop
 * (SceneWriter re-authoring for continuity errors, ChoiceAuthor re-authoring
 * for weak/false choices, bounded by `maxQARepairPasses`) and the final
 * threshold warning.
 *
 * Faithful port of the "PHASE 5: QUALITY ASSURANCE" block from
 * FullStoryPipeline.generate() and of runQualityAssurance (pure move): same
 * gates, same events, same prompts, same repair bounds.
 * `runQualityAssurance` stays publicly callable for the monolith's
 * per-episode QA pass in the multi-episode loop. Helpers shared with other
 * monolith regions (validation-input prep, continuity knowledge/timeline,
 * compact world context, ChoiceAuthor NPC prep, story verbs) are injected as
 * closures; run-scoped incremental-validation state (incrementalValidator,
 * sceneValidationResults, cachedPipelineMemory) is accessor-backed so the
 * phase always reads current values. Repairs mutate the shared
 * `sceneContents` / `choiceSets` arrays in place, exactly as the inline code
 * did.
 */

import { CharacterBible } from '../../agents/CharacterDesigner';
import { ChoiceAuthor, ChoiceSet } from '../../agents/ChoiceAuthor';
import { EncounterStructure } from '../../agents/EncounterArchitect';
import {
  QAReport,
  QARunner,
  QARunnerOptions,
} from '../../agents/QAAgents';
import { EpisodeBlueprint, SceneBlueprint } from '../../agents/StoryArchitect';
import { SceneContent, SceneWriter } from '../../agents/SceneWriter';
import { WorldBible } from '../../agents/WorldBuilder';
import {
  ChoiceDistributionValidator,
  IncrementalValidationRunner,
  IntegratedBestPracticesValidator,
  SceneValidationResult,
  aggregateValidationResults,
} from '../../validators';
import { ComprehensiveValidationReport } from '../../../types/validation';
import { QA_DEFAULTS } from '../../../constants/validation';
import { capabilityFactStrings } from '../characterCanonFacts';
import { resolveCharacterProfile } from '../../utils/characterProfileResolver';
import { withTimeout, PIPELINE_TIMEOUTS } from '../../utils/withTimeout';
import type { FullCreativeBrief } from '../FullStoryPipeline';
import { PipelineContext } from './index';

// ========================================
// INPUT, RESULT & DEPENDENCY TYPES
// ========================================

export interface QAPhaseInput {
  brief: FullCreativeBrief;
  worldBible: WorldBible;
  characterBible: CharacterBible;
  episodeBlueprint: EpisodeBlueprint;
  /** Mutated in place when the repair loop re-authors a scene. */
  sceneContents: SceneContent[];
  /** Mutated in place when the repair loop re-authors a choice set. */
  choiceSets: ChoiceSet[];
  encounters: Map<string, EncounterStructure>;
}

export interface QAPhaseResult {
  qaReport?: QAReport;
  bestPracticesReport?: ComprehensiveValidationReport;
}

type ValidationInput = Parameters<
  IntegratedBestPracticesValidator['runFullValidation']
>[0];

/**
 * Everything the phase still borrows from the monolith. Helpers shared with
 * other pipeline regions stay injected as closures; agent/validator
 * instances are passed by reference so config and telemetry stay shared with
 * the rest of the run. `incrementalValidator`, `sceneValidationResults`, and
 * `cachedPipelineMemory` are accessor-backed run-scoped state.
 */
export interface QAPhaseDeps {
  qaRunner: Pick<QARunner, 'runFullQA'>;
  integratedValidator: Pick<IntegratedBestPracticesValidator, 'runFullValidation'>;
  distributionValidator: Pick<ChoiceDistributionValidator, 'validate' | 'computeMetrics'>;
  sceneWriter: Pick<SceneWriter, 'execute'>;
  choiceAuthor: Pick<ChoiceAuthor, 'execute'>;

  // --- Run-scoped state (accessor-backed; reads see the monolith's current values) ---
  readonly incrementalValidator: IncrementalValidationRunner | null;
  readonly sceneValidationResults: SceneValidationResult[];
  readonly cachedPipelineMemory: string | null;

  // --- Helpers shared with other monolith regions (injected closures) ---
  requirePhases: (phase: string, prerequisites: string[]) => void;
  markPhaseComplete: (phase: string) => void;
  measurePhase: <T>(phase: string, fn: () => Promise<T>) => Promise<T>;
  emitPhaseProgress: (
    phase: string,
    done: number,
    total: number,
    source: string,
    message?: string
  ) => void;
  prepareValidationInput: (
    sceneContents: SceneContent[],
    choiceSets: ChoiceSet[],
    characterBible: CharacterBible,
    encounters?: Map<string, EncounterStructure>,
    blueprint?: EpisodeBlueprint
  ) => ValidationInput;
  buildContinuityCharacterKnowledge: (
    characterBible: CharacterBible
  ) => Array<{ characterId: string; knows: string[]; doesNotKnow: string[] }>;
  buildContinuityTimeline: (
    blueprint: EpisodeBlueprint
  ) => Array<{ event: string; when: string }>;
  buildCompactWorldContext: (worldBible: WorldBible, locationDescription?: string) => string;
  getTargetBeatCountForScene: (sceneBlueprint: SceneBlueprint) => number;
  buildChoiceAuthorNpcs: (
    npcIds: string[],
    characterBible: CharacterBible
  ) => Parameters<ChoiceAuthor['execute']>[0]['npcsInScene'];
  deriveStoryVerbsForBrief: (
    brief: FullCreativeBrief,
    worldBible?: WorldBible
  ) => Parameters<ChoiceAuthor['execute']>[0]['storyVerbs'];
}

// ========================================
// PHASE IMPLEMENTATION
// ========================================

export class QAPhase {
  readonly name = 'qa';

  constructor(private readonly deps: QAPhaseDeps) {}

  /**
   * The full Phase 5 block from generate(): gate, parallel QA + best
   * practices, checkpoints, choice-distribution telemetry, repair loop,
   * threshold warning. Returns the reports for the caller to adopt.
   */
  async run(input: QAPhaseInput, context: PipelineContext): Promise<QAPhaseResult> {
    const {
      brief,
      worldBible,
      characterBible,
      episodeBlueprint,
      sceneContents,
      choiceSets,
      encounters,
    } = input;

    let qaReport: QAReport | undefined;
    let bestPracticesReport: ComprehensiveValidationReport | undefined;

    if (brief.options?.runQA !== false) {
      context.emit({ type: 'phase_start', phase: 'qa', message: 'Phase 5: Running quality assurance' });
      this.deps.requirePhases('qa', ['content_generation']);

      // Run QA and best practices validation in parallel (including encounters)
      const validationInput = this.deps.prepareValidationInput(
        sceneContents,
        choiceSets,
        characterBible,
        encounters
      );

      const [qaResult, bpResult] = await this.deps.measurePhase('qa', () => Promise.all([
        this.runQualityAssurance(
          brief,
          sceneContents,
          choiceSets,
          characterBible,
          episodeBlueprint,
          context
        ),
        context.config.validation.enabled
          ? this.deps.integratedValidator.runFullValidation(validationInput)
          : Promise.resolve(undefined),
      ]));

      qaReport = qaResult;
      bestPracticesReport = bpResult;
      this.deps.markPhaseComplete('qa');

      context.addCheckpoint('QA Report', qaReport, qaReport.passesQA === false);

      if (bestPracticesReport) {
        context.addCheckpoint('Best Practices Report', bestPracticesReport, !bestPracticesReport.overallPassed);
        context.emit({
          type: 'phase_complete',
          phase: 'best_practices',
          message: `Best Practices Score: ${bestPracticesReport.overallScore}/100 - ${bestPracticesReport.overallPassed ? 'PASSED' : 'NEEDS REVIEW'}`,
          data: {
            score: bestPracticesReport.overallScore,
            errors: bestPracticesReport.blockingIssues.length,
            warnings: bestPracticesReport.warnings.length,
            suggestions: bestPracticesReport.suggestions.length,
          },
        });
      }

      // Phase 4.3: Wire ChoiceDistributionValidator into FullStoryPipeline
      try {
        const distributionInput = {
          choiceSets: choiceSets.map(cs => ({
            beatId: cs.beatId,
            choiceType: cs.choiceType,
            hasBranching: cs.choices.some(c => c.nextSceneId),
          })),
          targets: {
            // Defaults match the canonical 35/30/20/15 taxonomy (was 25/10 here — the lone
            // divergent site; every other caller uses 20/15).
            expression: context.config.generation?.choiceDistExpression ?? 35,
            relationship: context.config.generation?.choiceDistRelationship ?? 30,
            strategic: context.config.generation?.choiceDistStrategic ?? 20,
            dilemma: context.config.generation?.choiceDistDilemma ?? 15,
          },
          maxBranchingChoicesPerEpisode: context.config.generation?.maxBranchingChoicesPerEpisode ?? 3,
        };
        const distributionResult = this.deps.distributionValidator.validate(distributionInput);
        const distributionMetrics = this.deps.distributionValidator.computeMetrics(distributionInput);
        context.emit({
          type: 'checkpoint',
          phase: 'choice_distribution',
          message:
            `Choice Distribution: ${distributionResult.score}/100 — ` +
            Object.entries(distributionMetrics.actualPercentages)
              .map(([t, pct]) => `${t}: ${pct.toFixed(0)}%`)
              .join(', ') +
            ` | branching: ${distributionMetrics.branchingCount}/${distributionMetrics.branchingCap} cap`,
          data: { distributionResult, metrics: distributionMetrics },
        });
      } catch (err) {
        context.emit({
          type: 'warning',
          phase: 'choice_distribution',
          message: `ChoiceDistributionValidator failed: ${err instanceof Error ? err.message : String(err)}`,
        });
      }

      const threshold = brief.options?.qaThreshold || QA_DEFAULTS.defaultThreshold;
      const maxQARepairPasses = brief.options?.maxQARepairPasses ?? 2;

      for (let qaRepairPass = 0; qaRepairPass < maxQARepairPasses; qaRepairPass++) {
        if (qaReport.passesQA && qaReport.criticalIssues.length === 0) break;

        // === KARPATHY LOOP: QA-driven targeted repair ===
        const previousScore = qaReport.overallScore;
        context.emit({
          type: 'phase_start',
          phase: 'qa_repair',
          message: `QA repair pass ${qaRepairPass + 1}/${maxQARepairPasses}: score ${qaReport.overallScore}/100, ${qaReport.criticalIssues.length} critical issue(s)`,
        });

        let repairsMade = 0;

        // Repair scenes with continuity errors
        if (qaReport.continuity && qaReport.continuity.issues.length > 0) {
          const errorIssues = qaReport.continuity.issues.filter(i => i.severity === 'error');
          const affectedSceneIds = new Set(errorIssues.map(i => i.location.sceneId));

          for (const sceneId of affectedSceneIds) {
            const sceneIssues = errorIssues.filter(i => i.location.sceneId === sceneId);
            const sceneIdx = sceneContents.findIndex(sc => sc.sceneId === sceneId);
            if (sceneIdx === -1) continue;

            const sceneBlueprint = episodeBlueprint.scenes.find(s => s.id === sceneId);
            if (!sceneBlueprint || sceneBlueprint.isEncounter) continue;

            const issueText = sceneIssues.map(i => `- ${i.description} (fix: ${i.suggestedFix})`).join('\n');
            const location = worldBible.locations.find(l => l.id === sceneBlueprint.location);
            const protagonistProfile = characterBible.characters.find(c => c.id === brief.protagonist.id);

            context.emit({
              type: 'regeneration_triggered',
              phase: 'qa_repair',
              message: `Repairing scene ${sceneId}: ${sceneIssues.length} continuity error(s)`,
            });

            const repairResult = await withTimeout(this.deps.sceneWriter.execute({
              sceneBlueprint,
              storyContext: {
                title: brief.story.title,
                genre: brief.story.genre,
                tone: brief.story.tone,
                userPrompt: `${brief.userPrompt || ''}\n\nCRITICAL CONTINUITY FIXES REQUIRED:\n${issueText}`,
                worldContext: this.deps.buildCompactWorldContext(worldBible, location?.fullDescription || brief.world.premise),
              },
              protagonistInfo: {
                name: brief.protagonist.name,
                pronouns: brief.protagonist.pronouns,
                description: protagonistProfile?.fullBackground || brief.protagonist.description,
                physicalDescription: protagonistProfile?.physicalDescription,
              },
              npcs: sceneBlueprint.npcsPresent.map(npcId => {
                const profile = resolveCharacterProfile(characterBible.characters, npcId);
                return {
                  id: npcId,
                  name: profile?.name || npcId,
                  pronouns: profile?.pronouns || 'they/them',
                  description: profile?.overview || '',
                  physicalDescription: profile?.physicalDescription,
                  voiceNotes: profile?.voiceProfile?.writingGuidance || '',
                  currentMood: profile?.voiceProfile?.whenNervous,
                };
              }),
              relevantFlags: episodeBlueprint.suggestedFlags,
              relevantScores: episodeBlueprint.suggestedScores,
              targetBeatCount: this.deps.getTargetBeatCountForScene(sceneBlueprint),
              dialogueHeavy: sceneBlueprint.npcsPresent.length > 0,
              incomingChoiceContext: sceneBlueprint.incomingChoiceContext,
              sourceAnalysis: brief.multiEpisode?.sourceAnalysis,
              memoryContext: this.deps.cachedPipelineMemory || undefined,
            }), PIPELINE_TIMEOUTS.llmAgent, `SceneWriter.execute(${sceneId} qa-repair-${qaRepairPass + 1})`);

            if (repairResult.success && repairResult.data) {
              repairResult.data.sceneId = sceneId;
              repairResult.data.sceneName = repairResult.data.sceneName || sceneBlueprint.name;
              repairResult.data.locationId = sceneContents[sceneIdx].locationId;
              repairResult.data.settingContext = sceneContents[sceneIdx].settingContext;
              repairResult.data.branchType = sceneContents[sceneIdx].branchType;
              repairResult.data.isBottleneck = sceneContents[sceneIdx].isBottleneck;
              repairResult.data.isConvergencePoint = sceneContents[sceneIdx].isConvergencePoint;
              sceneContents[sceneIdx] = repairResult.data;
              repairsMade++;
            }
          }
        }

        // Repair choices with false choices / weak stakes
        if (qaReport.stakes && qaReport.stakes.metrics.falseChoiceCount > 0) {
          const weakChoiceSets = qaReport.stakes.choiceSetAnalysis
            .filter(cs => cs.stakesScore < 50)
            .slice(0, 3);

          for (const weakCs of weakChoiceSets) {
            const csIdx = choiceSets.findIndex(cs => cs.beatId === weakCs.beatId);
            if (csIdx === -1) continue;

            const sceneBlueprint = episodeBlueprint.scenes.find(s => s.choicePoint);
            if (!sceneBlueprint) continue;

            const beat = sceneContents.flatMap(sc => sc.beats).find(b => b.id === weakCs.beatId);
            if (!beat) continue;

            context.emit({
              type: 'regeneration_triggered',
              phase: 'qa_repair',
              message: `Repairing weak choice set at beat ${weakCs.beatId} (stakes: ${weakCs.stakesScore}/100)`,
            });

            const repairChoiceResult = await withTimeout(this.deps.choiceAuthor.execute({
              sceneBlueprint,
              beatText: beat.text,
              beatId: beat.id,
              storyContext: {
                title: brief.story.title,
                genre: brief.story.genre,
                tone: brief.story.tone,
                userPrompt: `${brief.userPrompt || ''}\n\nIMPORTANT - QA found these stakes issues: ${weakCs.analysis}. Improvements needed: ${weakCs.improvements.join('; ')}`,
                worldContext: this.deps.buildCompactWorldContext(worldBible, worldBible.locations.find(l => l.id === sceneBlueprint.location)?.fullDescription),
              },
              protagonistInfo: {
                name: brief.protagonist.name,
                pronouns: brief.protagonist.pronouns,
              },
              npcsInScene: this.deps.buildChoiceAuthorNpcs(sceneBlueprint.npcsPresent, characterBible),
              availableFlags: episodeBlueprint.suggestedFlags,
              availableScores: episodeBlueprint.suggestedScores,
              availableTags: episodeBlueprint.suggestedTags,
              possibleNextScenes: sceneBlueprint.leadsTo.map(id => {
                const scene = episodeBlueprint.scenes.find(s => s.id === id);
                return { id, name: scene?.name || id, description: scene?.description || '' };
              }),
              optionCount: sceneBlueprint.choicePoint?.optionHints?.length || 3,
              sourceAnalysis: brief.multiEpisode?.sourceAnalysis,
              memoryContext: this.deps.cachedPipelineMemory || undefined,
              storyVerbs: this.deps.deriveStoryVerbsForBrief(brief, worldBible),
            }), PIPELINE_TIMEOUTS.llmAgent, `ChoiceAuthor.execute(${weakCs.beatId} qa-repair-${qaRepairPass + 1})`);

            if (repairChoiceResult.success && repairChoiceResult.data) {
              choiceSets[csIdx] = repairChoiceResult.data;
              repairsMade++;
            }
          }
        }

        if (repairsMade > 0) {
          context.emit({
            type: 'debug',
            phase: 'qa_repair',
            message: `Pass ${qaRepairPass + 1}: made ${repairsMade} repair(s), re-running QA`,
          });

          qaReport = await this.runQualityAssurance(
            brief, sceneContents, choiceSets, characterBible, episodeBlueprint, context
          );

          context.emit({
            type: 'phase_complete',
            phase: 'qa_repair',
            message: `QA repair pass ${qaRepairPass + 1}: ${qaReport.overallScore}/100 (was ${previousScore}/100), ${qaReport.passesQA ? 'PASSES' : 'still below threshold'}`,
          });
        } else {
          context.emit({
            type: 'phase_complete',
            phase: 'qa_repair',
            message: `QA repair pass ${qaRepairPass + 1}: no repairable issues found`,
          });
          break;
        }
      }

      if (qaReport.overallScore < threshold) {
        context.emit({
          type: 'warning',
          phase: 'qa',
          message: `QA score ${qaReport.overallScore} below threshold ${threshold} - story may need refinement`,
        });
      }
    }

    return { qaReport, bestPracticesReport };
  }

  /**
   * Single QARunner full-QA pass (with incremental-validation skip stubs).
   * Publicly callable: the multi-episode loop's per-episode QA pass delegates
   * here, and the repair loop above re-runs it after repairs.
   */
  async runQualityAssurance(
    brief: FullCreativeBrief,
    sceneContents: SceneContent[],
    choiceSets: ChoiceSet[],
    characterBible: CharacterBible,
    blueprint: EpisodeBlueprint,
    context: PipelineContext
  ): Promise<QAReport> {
    const qaStepTotal = 3;
    this.deps.emitPhaseProgress('qa', 0, qaStepTotal, 'qa:steps', 'Preparing quality assurance checks...');
    // Determine which checks to skip based on incremental validation
    const skipRedundantQA = brief.options?.skipRedundantQA !== false && this.deps.incrementalValidator !== null;

    const qaOptions: QARunnerOptions = {};

    if (skipRedundantQA && this.deps.sceneValidationResults.length > 0) {
      // Calculate issue counts from incremental validation
      const aggregated = aggregateValidationResults(this.deps.sceneValidationResults);

      // Flatten actual incremental issues so the skip stubs carry them into
      // the QA report instead of reporting `issues: []`. Without this, any
      // run with `skipRedundantQA: true` silently discards everything that
      // the incremental validators caught.
      const voiceIssues: NonNullable<QARunnerOptions['incrementalResults']>['voiceIssues'] = [];
      const stakesIssues: NonNullable<QARunnerOptions['incrementalResults']>['stakesIssues'] = [];
      const voiceScores: number[] = [];
      const stakesScores: number[] = [];
      let voiceEvidenceCount = 0;
      let stakesEvidenceCount = 0;
      let voiceErrorCount = 0;
      let voiceWarningCount = 0;
      let stakesErrorCount = 0;
      let stakesWarningCount = 0;
      let falseChoiceCount = 0;
      for (const sceneResult of this.deps.sceneValidationResults) {
        if (sceneResult.voice) {
          voiceEvidenceCount++;
          if (typeof sceneResult.voice.score === 'number') voiceScores.push(sceneResult.voice.score);
          for (const iss of sceneResult.voice.issues) {
            if (iss.severity === 'error') voiceErrorCount++;
            if (iss.severity === 'warning') voiceWarningCount++;
            voiceIssues.push({
              sceneId: sceneResult.sceneId,
              beatId: iss.beatId,
              characterId: iss.characterId,
              characterName: iss.characterName,
              severity: iss.severity,
              issue: iss.issue,
              suggestion: iss.suggestion,
            });
          }
        }
        if (sceneResult.stakes) {
          stakesEvidenceCount++;
          if (typeof sceneResult.stakes.score === 'number') stakesScores.push(sceneResult.stakes.score);
          if (sceneResult.stakes.hasFalseChoices) falseChoiceCount++;
          for (const iss of sceneResult.stakes.issues) {
            if (iss.severity === 'error') stakesErrorCount++;
            if (iss.severity === 'warning') stakesWarningCount++;
            stakesIssues.push({
              sceneId: sceneResult.sceneId,
              choiceSetId: iss.choiceId,
              severity: iss.severity,
              issue: iss.issue,
              suggestion: iss.suggestion,
            });
          }
        }
      }

      qaOptions.skipVoiceValidation = true;
      qaOptions.skipStakesAnalysis = true;
      qaOptions.continuityFocusCrossScene = true;
      qaOptions.incrementalResults = {
        voiceIssueCount: aggregated.totalIssues.voice,
        stakesIssueCount: aggregated.totalIssues.stakes,
        continuityIssueCount: aggregated.totalIssues.continuity,
        voiceIssues,
        stakesIssues,
        voiceScores,
        stakesScores,
        voiceEvidenceCount,
        stakesEvidenceCount,
        voiceErrorCount,
        voiceWarningCount,
        stakesErrorCount,
        stakesWarningCount,
        falseChoiceCount,
      };

      context.emit({
        type: 'debug',
        agent: 'QARunner',
        message: `Skipping redundant QA checks (voice: ${aggregated.totalIssues.voice} issues, stakes: ${aggregated.totalIssues.stakes} issues caught incrementally)`
      });
    }
    this.deps.emitPhaseProgress('qa', 1, qaStepTotal, 'qa:steps', 'QA input bundle prepared');

    context.emit({ type: 'agent_start', agent: 'QARunner', message: 'Running quality assurance checks' });

    const characterKnowledge = this.deps.buildContinuityCharacterKnowledge(characterBible);
    const timelineEvents = this.deps.buildContinuityTimeline(blueprint);

    const report = await this.deps.qaRunner.runFullQA({
      sceneContents,
      choiceSets,
      characterProfiles: characterBible.characters.map(c => ({
        id: c.id,
        name: c.name,
        voiceProfile: c.voiceProfile,
      })),
      knownFlags: blueprint.suggestedFlags,
      knownScores: blueprint.suggestedScores,
      // Ground continuity in character-capability canon so it reliably flags
      // "character does something they can't" (the scholar-doing-blade-work bug).
      establishedFacts: capabilityFactStrings(characterBible.characters),
      storyThemes: brief.story.themes,
      targetTone: brief.story.tone,
      sceneContexts: blueprint.scenes.map(s => ({
        sceneId: s.id,
        sceneName: s.name,
        mood: s.mood,
        narrativeFunction: s.narrativeFunction,
      })),
      characterKnowledge,
      timelineEvents,
    }, qaOptions);
    this.deps.emitPhaseProgress('qa', 2, qaStepTotal, 'qa:steps', 'QA analysis complete');

    const skippedMsg = report.skippedChecks && report.skippedChecks.length > 0
      ? ` (skipped: ${report.skippedChecks.join(', ')})`
      : '';

    context.emit({
      type: 'agent_complete',
      agent: 'QARunner',
      message: `QA Score: ${report.overallScore}/100 - ${report.passesQA ? 'PASSED' : 'NEEDS REVISION'}${skippedMsg}`,
    });
    this.deps.emitPhaseProgress('qa', 3, qaStepTotal, 'qa:steps', 'QA report finalized');

    return report;
  }
}
