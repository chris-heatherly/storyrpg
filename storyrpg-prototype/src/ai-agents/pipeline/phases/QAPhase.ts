/**
 * QA Phase
 *
 * Phase 5 of story generation: runs the QARunner full-QA pass and the
 * IntegratedBestPracticesValidator in parallel, emits the choice-distribution
 * telemetry checkpoint, then reports any defects against the committed
 * episode draft. It never reopens a scene or choice set.
 *
 * Faithful port of the "PHASE 5: QUALITY ASSURANCE" block from
 * FullStoryPipeline.generate() and of runQualityAssurance.
 * `runQualityAssurance` stays publicly callable for the monolith's
 * per-episode QA pass in the multi-episode loop. Helpers shared with other
 * monolith regions (validation-input prep, continuity knowledge/timeline,
 * run-scoped incremental-validation state is accessor-backed so the phase
 * always reads current values.
 */

import { CharacterBible } from '../../agents/CharacterDesigner';
import { ChoiceSet } from '../../agents/ChoiceAuthor';
import { EncounterStructure } from '../../agents/EncounterArchitect';
import {
  QAReport,
  QARunner,
  QARunnerOptions,
} from '../../agents/QAAgents';
import { EpisodeBlueprint } from '../../agents/StoryArchitect';
import { SceneContent } from '../../agents/SceneWriter';
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
import { QUALITY_REPAIR_THRESHOLDS } from '../../utils/qualityScoring';
import type { FullCreativeBrief } from '../FullStoryPipeline';
import { PipelineContext } from './index';

function addEncounterContinuityContext(
  sceneContents: SceneContent[],
  encounters?: Map<string, EncounterStructure>,
): SceneContent[] {
  if (!encounters || encounters.size === 0) return sceneContents;
  return sceneContents.map((scene) => {
    const encounter = encounters.get(scene.sceneId) as (EncounterStructure & {
      phases?: Array<{ beats?: Array<{ setupText?: string; escalationText?: string; text?: string }> }>;
    }) | undefined;
    if (!encounter) return scene;
    const transitionTexts = (encounter.phases ?? []).flatMap((phase) =>
      (phase.beats ?? []).flatMap((beat) => [beat.setupText, beat.escalationText, beat.text])
        .filter((text): text is string => typeof text === 'string' && text.trim().length > 0),
    );
    if (transitionTexts.length === 0) return scene;
    // QA gets a read-only continuity surface for encounter setup. The actual
    // story content remains unchanged; this prevents cross-scene QA from
    // treating a valid taxi/departure handoff as an unexplained jump simply
    // because encounter prose lives outside SceneContent.beats.
    return {
      ...scene,
      beats: [
        ...scene.beats,
        { id: `${scene.sceneId}-qa-encounter-context`, text: transitionTexts.join(' ') },
      ],
    };
  });
}

// ========================================
// INPUT, RESULT & DEPENDENCY TYPES
// ========================================

export interface QAPhaseInput {
  brief: FullCreativeBrief;
  worldBible: WorldBible;
  characterBible: CharacterBible;
  episodeBlueprint: EpisodeBlueprint;
  /** Sealed input; QA must treat it as read-only. */
  sceneContents: SceneContent[];
  /** Sealed input; QA must treat it as read-only. */
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
 * the rest of the run. Incremental-validation state is accessor-backed.
 */
export interface QAPhaseDeps {
  qaRunner: Pick<QARunner, 'runFullQA'>;
  integratedValidator: Pick<IntegratedBestPracticesValidator, 'runFullValidation'>;
  distributionValidator: Pick<ChoiceDistributionValidator, 'validate' | 'computeMetrics'>;
  // --- Run-scoped state (accessor-backed; reads see the monolith's current values) ---
  readonly incrementalValidator: IncrementalValidationRunner | null;
  readonly sceneValidationResults: SceneValidationResult[];

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
}

function isUngroundedJudgeIssue(issue: any): boolean {
  return /evidence-ungrounded|ungrounded (?:claim|evidence)|quoted text not found/i
    .test(String(issue?.description ?? issue ?? ''));
}


// ========================================
// PHASE IMPLEMENTATION
// ========================================

export class QAPhase {
  readonly name = 'qa';

  constructor(private readonly deps: QAPhaseDeps) {}

  /**
   * The full Phase 5 block from generate(): gate, parallel QA + best
   * practices, checkpoints, choice-distribution telemetry, and threshold
   * warning. Returns reports without changing committed artifacts.
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
          context,
          encounters,
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
          message: `Best Practices component diagnostic: ${bestPracticesReport.overallScore}/100 - ${bestPracticesReport.overallPassed ? 'PASSED' : 'NEEDS REVIEW'} (publishability is reported by qualityScoring)`,
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
      const requestedRepairPasses = brief.options?.maxQARepairPasses ?? 2;
      const proseNeedsRepair = (qaReport.proseCraft?.overallScore ?? 100) < QUALITY_REPAIR_THRESHOLDS.proseCraft
        || (qaReport.proseCraft?.issues ?? []).some((issue) => issue.severity === 'error' && !isUngroundedJudgeIssue(issue));
      const responsivenessNeedsRepair = (qaReport.responsiveness?.overallScore ?? 100) < QUALITY_REPAIR_THRESHOLDS.responsiveness
        || (qaReport.responsiveness?.issues ?? []).some((issue) => issue.severity === 'error' && !isUngroundedJudgeIssue(issue))
        || (qaReport.responsiveness?.probeVerdicts ?? []).some((probe) => probe.verdict === 'cosmetic' || probe.npcReaction === 'static');
      if (requestedRepairPasses > 0 && (
        !qaReport.passesQA || qaReport.criticalIssues.length > 0 || proseNeedsRepair || responsivenessNeedsRepair
      )) {
        context.emit({
          type: 'warning',
          phase: 'qa',
          message: `QA reported committed-artifact findings; ${requestedRepairPasses} configured late repair pass(es) were suppressed. Regenerate the earliest owning scene and dependent suffix.`,
        });
      }

      if (qaReport.overallScore < threshold) {
        context.emit({
          type: 'warning',
          phase: 'qa',
          message: `QA component diagnostic ${qaReport.overallScore} below threshold ${threshold} - story may need refinement; publishability is reported by qualityScoring`,
        });
      }
    }

    return { qaReport, bestPracticesReport };
  }

  /**
   * Single QARunner full-QA pass (with incremental-validation skip stubs).
   * Publicly callable: the multi-episode loop's per-episode QA pass delegates
   * here.
   */
  async runQualityAssurance(
    brief: FullCreativeBrief,
    sceneContents: SceneContent[],
    choiceSets: ChoiceSet[],
    characterBible: CharacterBible,
    blueprint: EpisodeBlueprint,
    context: PipelineContext,
    encounters?: Map<string, EncounterStructure>,
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
      sceneContents: addEncounterContinuityContext(sceneContents, encounters),
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
      // B2/G7: prefer the treatment's authored tone line — brief.story.tone is
      // often a genre word; the treatment tone is the layered contract the
      // tone_lens_fidelity concept grades against.
      targetTone: brief.multiEpisode?.sourceAnalysis?.treatmentSeasonGuidance?.tone?.trim() || brief.story.tone,
      protagonistLens: [
        brief.multiEpisode?.sourceAnalysis?.treatmentSeasonGuidance?.protagonistGuidance?.roleInWorld,
        brief.multiEpisode?.sourceAnalysis?.treatmentSeasonGuidance?.protagonistGuidance?.startingIdentity,
      ].map((value) => value?.trim()).filter(Boolean).join(' — ') || undefined,
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
