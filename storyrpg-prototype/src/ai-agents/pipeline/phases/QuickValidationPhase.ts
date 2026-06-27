/**
 * Quick Validation Phase
 *
 * Phase 4.5 of story generation: the fast IntegratedBestPracticesValidator
 * gate that runs between content generation and QA. Escalates incremental
 * POV/voice failures into blocking categories, attempts targeted repair
 * (ChoiceAuthor re-authoring for stakes/five-factor/stat-balance issues and
 * missing choice points, scoped SceneWriter rewrites for POV/voice/skill-
 * surface issues), re-validates once after repairs, and throws
 * ValidationError when the gate still cannot proceed.
 *
 * Faithful port of the "PHASE 4.5: QUICK VALIDATION" block from
 * FullStoryPipeline.generate() (pure move): same gate, same escalations,
 * same repair bounds, same events, same prompts, same abort behavior.
 * Helpers shared with other monolith regions (validation-input prep, compact
 * world context, ChoiceAuthor NPC prep, story verbs, target beat count) are
 * injected as closures; run-scoped incremental-validation state
 * (sceneValidationResults, cachedPipelineMemory) is accessor-backed. Repairs
 * mutate the shared `sceneContents` / `choiceSets` arrays in place, exactly
 * as the inline code did.
 */

import { CharacterBible } from '../../agents/CharacterDesigner';
import { ChoiceAuthor, ChoiceSet } from '../../agents/ChoiceAuthor';
import { EncounterStructure } from '../../agents/EncounterArchitect';
import { EpisodeBlueprint, SceneBlueprint } from '../../agents/StoryArchitect';
import { SceneContent, SceneWriter } from '../../agents/SceneWriter';
import { WorldBible } from '../../agents/WorldBuilder';
import {
  IntegratedBestPracticesValidator,
  SceneValidationResult,
} from '../../validators';
import { QuickValidationResult, ValidationError } from '../../../types/validation';
import { resolveCharacterProfile } from '../../utils/characterProfileResolver';
import { withTimeout, PIPELINE_TIMEOUTS } from '../../utils/withTimeout';
import type { FullCreativeBrief } from '../FullStoryPipeline';
import type { AgentMemoryRequest, AgentMemoryRole } from '../pipelineMemory';
import type { PipelineMemoryArtifactKind } from '../artifactMemoryTypes';
import { PipelineContext } from './index';

// ========================================
// INPUT, RESULT & DEPENDENCY TYPES
// ========================================

export interface QuickValidationPhaseInput {
  brief: FullCreativeBrief;
  worldBible: WorldBible;
  characterBible: CharacterBible;
  episodeBlueprint: EpisodeBlueprint;
  /** Mutated in place when a repair re-authors a scene. */
  sceneContents: SceneContent[];
  /** Mutated in place when a repair re-authors or adds a choice set. */
  choiceSets: ChoiceSet[];
  encounters: Map<string, EncounterStructure>;
}

type ValidationInput = Parameters<
  IntegratedBestPracticesValidator['runQuickValidation']
>[0];

/**
 * Everything the phase still borrows from the monolith. Helpers shared with
 * other pipeline regions stay injected as closures; agent/validator
 * instances are passed by reference. `sceneValidationResults` and
 * `cachedPipelineMemory` are accessor-backed run-scoped state.
 */
export interface QuickValidationPhaseDeps {
  integratedValidator: Pick<IntegratedBestPracticesValidator, 'runQuickValidation'>;
  sceneWriter: Pick<SceneWriter, 'execute'>;
  choiceAuthor: Pick<ChoiceAuthor, 'execute'>;

  // --- Run-scoped state (accessor-backed; reads see the monolith's current values) ---
  readonly sceneValidationResults: SceneValidationResult[];
  readonly cachedPipelineMemory: string | null;
  getAgentMemoryContext?: (request: AgentMemoryRequest) => Promise<string | null>;

  // --- Helpers shared with other monolith regions (injected closures) ---
  prepareValidationInput: (
    sceneContents: SceneContent[],
    choiceSets: ChoiceSet[],
    characterBible: CharacterBible,
    encounters?: Map<string, EncounterStructure>,
    blueprint?: EpisodeBlueprint
  ) => ValidationInput;
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

export class QuickValidationPhase {
  readonly name = 'quick_validation';

  constructor(private readonly deps: QuickValidationPhaseDeps) {}

  private async memoryContextFor(
    role: AgentMemoryRole,
    lifecycle: string,
    brief: FullCreativeBrief,
    sceneId?: string,
    characterIds?: string[],
    artifactKinds: PipelineMemoryArtifactKind[] = [],
  ): Promise<string | undefined> {
    if (!this.deps.getAgentMemoryContext) return this.deps.cachedPipelineMemory || undefined;
    const block = await this.deps.getAgentMemoryContext({
      agentRole: role,
      lifecycle,
      storyId: brief.story.title,
      episodeNumber: brief.episode?.number,
      treatmentId: brief.multiEpisode?.sourceAnalysis?.sourceTitle,
      sceneId,
      characterIds,
      artifactKinds,
    });
    return block || this.deps.cachedPipelineMemory || undefined;
  }

  /**
   * Returns the quick-validation result the caller should carry forward
   * (undefined when validation is disabled). Throws ValidationError when the
   * gate cannot proceed after the repair attempt.
   */
  async run(
    input: QuickValidationPhaseInput,
    context: PipelineContext
  ): Promise<QuickValidationResult | undefined> {
    const {
      brief,
      worldBible,
      characterBible,
      episodeBlueprint,
      sceneContents,
      choiceSets,
      encounters,
    } = input;

    let quickValidation: QuickValidationResult | undefined;
    if (context.config.validation.enabled) {
      context.emit({ type: 'phase_start', phase: 'quick_validation', message: 'Running quick validation' });

      const validationInput = this.deps.prepareValidationInput(
        sceneContents,
        choiceSets,
        characterBible,
        encounters
      );

      quickValidation = await this.deps.integratedValidator.runQuickValidation(validationInput);

      // Treat incremental scene issues as critical when they require a scoped
      // SceneWriter rewrite. Quick validation owns the final blocking gate, so
      // escalate incremental POV/voice failures into repairable categories.
      try {
        const voiceThreshold =
          (context.config as unknown as { incrementalValidation?: { voiceRegenerationThreshold?: number } })
            .incrementalValidation?.voiceRegenerationThreshold ?? 50;
        const criticalVoiceScenes = this.deps.sceneValidationResults.filter(
          r => r.voice && r.voice.score < voiceThreshold,
        );
        if (criticalVoiceScenes.length > 0) {
          const voiceBlockers = criticalVoiceScenes.map(r => ({
            category: 'voice_fidelity' as const,
            level: 'error' as const,
            message: `Scene ${r.sceneId}: voice fidelity score ${r.voice!.score} below critical threshold (${voiceThreshold})`,
            location: { sceneId: r.sceneId },
            suggestion:
              r.voice!.issues
                .slice(0, 3)
                .map(i => `${i.characterName}: ${i.suggestion || i.issue}`)
                .join('; ') || undefined,
          }));
          quickValidation = {
            canProceed: false,
            blockingIssues: [...quickValidation.blockingIssues, ...voiceBlockers],
            warningCount: quickValidation.warningCount,
          };
        }
        const povClarityScenes = this.deps.sceneValidationResults.filter(
          r => r.povClarity && r.povClarity.shouldRegenerate,
        );
        if (povClarityScenes.length > 0) {
          const povBlockers = povClarityScenes.map(r => ({
            category: 'pov_clarity' as const,
            level: 'error' as const,
            message: `Scene ${r.sceneId}: opening beat does not clearly anchor POV to the player character`,
            location: { sceneId: r.sceneId, beatId: r.povClarity!.checkedBeatId },
            suggestion:
              r.povClarity!.issues
                .slice(0, 3)
                .map(i => i.suggestion || i.issue)
                .join('; ') || 'Rewrite the first beat with you/your, the protagonist name, or a concrete pronoun before NPC or setting exposition.',
          }));
          quickValidation = {
            canProceed: false,
            blockingIssues: [...quickValidation.blockingIssues, ...povBlockers],
            warningCount: quickValidation.warningCount,
          };
        }
      } catch (err) {
        context.emit({
          type: 'warning',
          phase: 'quick_validation',
          message: `Incremental scene escalation skipped: ${err instanceof Error ? err.message : String(err)}`,
        });
      }

      if (!quickValidation.canProceed) {
        // === KARPATHY LOOP: Attempt targeted repair before throwing ===
        const repairableCategories = new Set([
          'stakes_triangle',
          'five_factor',
          'choice_density',
          'consequence_budget',
          'callback_opportunities',
          'pov_clarity',
          'voice_fidelity',
          'branch_topology',
          'stat_check_balance',
          'skill_surface',
          'branch_mechanical_divergence',
        ]);
        const repairableIssues = quickValidation.blockingIssues.filter(
          i => repairableCategories.has(i.category)
        );
        let repairAttempted = false;

        if (repairableIssues.length > 0) {
          context.emit({
            type: 'regeneration_triggered',
            phase: 'quick_validation',
            message: `Quick validation failed with ${repairableIssues.length} repairable issue(s), attempting repair`,
          });

          // --- Repair stakes_triangle and five_factor issues (existing choices) ---
          const choiceIssues = repairableIssues.filter(
            i => i.category === 'stakes_triangle' || i.category === 'five_factor' || i.category === 'stat_check_balance'
          );

          for (const issue of choiceIssues) {
            const choiceId = issue.location?.choiceId;
            if (!choiceId) continue;

            const csIdx = choiceSets.findIndex(cs =>
              cs.choices.some(c => c.id === choiceId)
            );
            if (csIdx === -1) continue;

            const cs = choiceSets[csIdx];
            const beat = sceneContents.flatMap(sc => sc.beats).find(b => b.id === cs.beatId);
            if (!beat) continue;

            const sceneBlueprint = episodeBlueprint.scenes.find(s => s.choicePoint);
            if (!sceneBlueprint) continue;

            repairAttempted = true;
            const repairResult = await withTimeout(this.deps.choiceAuthor.execute({
              sceneBlueprint,
              beatText: beat.text,
              beatId: beat.id,
              storyContext: {
                title: brief.story.title,
                genre: brief.story.genre,
                tone: brief.story.tone,
                userPrompt: `${brief.userPrompt || ''}\n\nCRITICAL FIX REQUIRED: ${issue.message}. ${issue.suggestion || ''}`,
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
              memoryContext: await this.memoryContextFor('ChoiceAuthor', 'quick-validation-choice-repair', brief, sceneBlueprint.id, sceneBlueprint.npcsPresent, ['quick-validation-report', 'choice-set']),
              storyVerbs: this.deps.deriveStoryVerbsForBrief(brief, worldBible),
            }), PIPELINE_TIMEOUTS.llmAgent, `ChoiceAuthor.execute(${cs.beatId} quick-val-repair)`);

            if (repairResult.success && repairResult.data) {
              choiceSets[csIdx] = repairResult.data;
            }
          }

          // --- Repair choice_density issues (missing choice points) ---
          const densityIssues = repairableIssues.filter(i => i.category === 'choice_density');
          if (densityIssues.length > 0) {
            const scenesWithChoices = new Set(choiceSets.map(cs => {
              const beat = sceneContents.flatMap(sc => sc.beats).find(b => b.id === cs.beatId);
              return beat ? sceneContents.find(sc => sc.beats.includes(beat))?.sceneId : null;
            }).filter(Boolean));

            const scenesNeedingChoices = episodeBlueprint.scenes
              .filter(s => s.choicePoint && !scenesWithChoices.has(s.id) && !s.isEncounter)
              .slice(0, 3);

            for (const targetScene of scenesNeedingChoices) {
              const sceneContent = sceneContents.find(sc => sc.sceneId === targetScene.id);
              if (!sceneContent || sceneContent.beats.length === 0) continue;

              const lastBeat = sceneContent.beats[sceneContent.beats.length - 1];
              context.emit({
                type: 'regeneration_triggered',
                phase: 'quick_validation',
                message: `Generating missing choices for scene ${targetScene.id} (choice density repair)`,
              });

              repairAttempted = true;
              const densityRepairResult = await withTimeout(this.deps.choiceAuthor.execute({
                sceneBlueprint: targetScene,
                beatText: lastBeat.text,
                beatId: lastBeat.id,
                storyContext: {
                  title: brief.story.title,
                  genre: brief.story.genre,
                  tone: brief.story.tone,
                  userPrompt: `${brief.userPrompt || ''}\n\nCRITICAL: This scene needs player choices. ${densityIssues.map(i => i.message).join('. ')}`,
                  worldContext: this.deps.buildCompactWorldContext(worldBible, worldBible.locations.find(l => l.id === targetScene.location)?.fullDescription),
                },
                protagonistInfo: {
                  name: brief.protagonist.name,
                  pronouns: brief.protagonist.pronouns,
                },
                npcsInScene: this.deps.buildChoiceAuthorNpcs(targetScene.npcsPresent, characterBible),
                availableFlags: episodeBlueprint.suggestedFlags,
                availableScores: episodeBlueprint.suggestedScores,
                availableTags: episodeBlueprint.suggestedTags,
                possibleNextScenes: targetScene.leadsTo.map(id => {
                  const scene = episodeBlueprint.scenes.find(s => s.id === id);
                  return { id, name: scene?.name || id, description: scene?.description || '' };
                }),
                optionCount: targetScene.choicePoint?.optionHints?.length || 3,
                sourceAnalysis: brief.multiEpisode?.sourceAnalysis,
                memoryContext: await this.memoryContextFor('ChoiceAuthor', 'quick-validation-density-repair', brief, targetScene.id, targetScene.npcsPresent, ['quick-validation-report', 'choice-set']),
                storyVerbs: this.deps.deriveStoryVerbsForBrief(brief, worldBible),
              }), PIPELINE_TIMEOUTS.llmAgent, `ChoiceAuthor.execute(${lastBeat.id} density-repair)`);

              if (densityRepairResult.success && densityRepairResult.data) {
                choiceSets.push(densityRepairResult.data);
              }
            }
          }

          // --- Repair pov_clarity / voice_fidelity issues (scoped SceneWriter rewrite) ---
          const sceneRewriteIssues = repairableIssues.filter(
            i => i.category === 'voice_fidelity' || i.category === 'pov_clarity' || i.category === 'skill_surface'
          );
          for (const issue of sceneRewriteIssues) {
            const sceneId = issue.location?.sceneId;
            if (!sceneId) continue;
            const sceneBlueprint = episodeBlueprint.scenes.find(s => s.id === sceneId);
            const sceneIdx = sceneContents.findIndex(sc => sc.sceneId === sceneId);
            if (!sceneBlueprint || sceneIdx === -1 || sceneBlueprint.isEncounter) continue;

            context.emit({
              type: 'regeneration_triggered',
              phase: 'quick_validation',
              message: `Rewriting scene ${sceneId} for ${issue.category}: ${issue.message}`,
            });
            repairAttempted = true;

            const protagonistProfile = characterBible.characters.find(c => c.id === brief.protagonist.id);
            const location = worldBible.locations.find(l => l.id === sceneBlueprint.location);
            const existingSceneJson = JSON.stringify(sceneContents[sceneIdx]).slice(0, 12000);

            try {
              const voiceRepair = await withTimeout(this.deps.sceneWriter.execute({
                sceneBlueprint,
                storyContext: {
                  title: brief.story.title,
                  genre: brief.story.genre,
                  tone: brief.story.tone,
                  userPrompt: `${brief.userPrompt || ''}\n\nCRITICAL ${issue.category === 'pov_clarity' ? 'POV CLARITY' : issue.category === 'skill_surface' ? 'SKILL SURFACE' : 'VOICE FIDELITY'} FIX:\n${issue.message}\n${issue.suggestion || ''}\n\nEXISTING SCENE CONTENT TO PRESERVE STRUCTURALLY:\n${existingSceneJson}\n\n${issue.category === 'pov_clarity'
                    ? 'Rewrite only prose/textVariants needed to anchor POV to the player character. Preserve beat IDs, visual contract fields, choice-point flags, thread IDs, callback IDs, and navigation. The first non-empty beat must use you/your, the protagonist name, or a concrete pronoun before focusing on NPCs, setting, or exposition. Do not emit template variables.'
                    : issue.category === 'skill_surface'
                      ? 'Add or repair fiction-first skill surfaces. Prefer beat-level skillInsights that reveal usable story information, and preserve all existing beat IDs, navigation, choices, visual contract fields, thread IDs, and callback IDs. Do not expose stats, skill checks, thresholds, modifiers, bonuses, rolls, or percentages.'
                    : 'Re-author this scene\'s beats with stricter voice adherence; match each character\'s vocabulary, formality, sentence length, and avoided-words list.'}`,
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
              }), PIPELINE_TIMEOUTS.llmAgent, `SceneWriter.execute(${sceneId} voice-repair)`);

              if (voiceRepair.success && voiceRepair.data) {
                sceneContents[sceneIdx] = voiceRepair.data;
              }
            } catch (err) {
              context.emit({
                type: 'warning',
                phase: 'quick_validation',
                message: `${issue.category} repair for ${sceneId} failed: ${err instanceof Error ? err.message : String(err)}`,
              });
            }
          }

          if (repairAttempted) {
            const revalidationInput = this.deps.prepareValidationInput(
              sceneContents,
              choiceSets,
              characterBible,
              encounters
            );
            quickValidation = await this.deps.integratedValidator.runQuickValidation(revalidationInput);
          }
        }

        if (!quickValidation.canProceed) {
          context.emit({
            type: 'error',
            phase: 'quick_validation',
            message: `Quick validation failed${repairAttempted ? ' after repair attempt' : ''}: ${quickValidation.blockingIssues.length} blocking issues`,
            data: quickValidation.blockingIssues,
          });
          throw new ValidationError(
            'Content validation failed',
            quickValidation.blockingIssues
          );
        }
      }

      if (quickValidation.canProceed) {
        context.emit({
          type: 'phase_complete',
          phase: 'quick_validation',
          message: `Quick validation passed (${quickValidation.warningCount} warnings)`,
        });
      }
    }

    return quickValidation;
  }
}
