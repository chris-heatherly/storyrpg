/**
 * Read-only quick-validation regression net.
 *
 * Scene, choice, and encounter repair belongs to ContentGenerationPhase before
 * the scene commit receipt is issued. This phase may aggregate/escalate those
 * results, but it must never replace a committed artifact.
 */

import { CharacterBible } from '../../agents/CharacterDesigner';
import { ChoiceSet } from '../../agents/ChoiceAuthor';
import { EncounterStructure } from '../../agents/EncounterArchitect';
import { EpisodeBlueprint } from '../../agents/StoryArchitect';
import { SceneContent } from '../../agents/SceneWriter';
import { WorldBible } from '../../agents/WorldBuilder';
import { IntegratedBestPracticesValidator, SceneValidationResult } from '../../validators';
import { QuickValidationResult, ValidationError } from '../../../types/validation';
import type { FullCreativeBrief } from '../FullStoryPipeline';
import { PipelineContext } from './index';

export interface QuickValidationPhaseInput {
  brief: FullCreativeBrief;
  worldBible: WorldBible;
  characterBible: CharacterBible;
  episodeBlueprint: EpisodeBlueprint;
  sceneContents: SceneContent[];
  choiceSets: ChoiceSet[];
  encounters: Map<string, EncounterStructure>;
}

type ValidationInput = Parameters<IntegratedBestPracticesValidator['runQuickValidation']>[0];

export interface QuickValidationPhaseDeps {
  integratedValidator: Pick<IntegratedBestPracticesValidator, 'runQuickValidation'>;
  readonly sceneValidationResults: SceneValidationResult[];
  prepareValidationInput: (
    sceneContents: SceneContent[],
    choiceSets: ChoiceSet[],
    characterBible: CharacterBible,
    encounters?: Map<string, EncounterStructure>,
    blueprint?: EpisodeBlueprint,
  ) => ValidationInput;
}

export class QuickValidationPhase {
  readonly name = 'quick_validation';

  constructor(private readonly deps: QuickValidationPhaseDeps) {}

  async run(
    input: QuickValidationPhaseInput,
    context: PipelineContext,
  ): Promise<QuickValidationResult | undefined> {
    if (!context.config.validation.enabled) return undefined;
    context.emit({ type: 'phase_start', phase: 'quick_validation', message: 'Running quick validation' });

    const validationInput = this.deps.prepareValidationInput(
      input.sceneContents,
      input.choiceSets,
      input.characterBible,
      input.encounters,
      input.episodeBlueprint,
    );
    let result = await this.deps.integratedValidator.runQuickValidation(validationInput);

    try {
      const voiceThreshold =
        (context.config as unknown as { incrementalValidation?: { voiceRegenerationThreshold?: number } })
          .incrementalValidation?.voiceRegenerationThreshold ?? 50;
      const voiceBlockers = this.deps.sceneValidationResults
        .filter((scene) => scene.voice && scene.voice.score < voiceThreshold)
        .map((scene) => ({
          category: 'voice_fidelity' as const,
          level: 'error' as const,
          message: `Scene ${scene.sceneId}: voice fidelity score ${scene.voice!.score} below critical threshold (${voiceThreshold})`,
          location: { sceneId: scene.sceneId },
          suggestion: scene.voice!.issues.slice(0, 3).map((issue) => `${issue.characterName}: ${issue.suggestion || issue.issue}`).join('; ') || undefined,
        }));
      const povBlockers = this.deps.sceneValidationResults
        .filter((scene) => scene.povClarity?.shouldRegenerate)
        .map((scene) => ({
          category: 'pov_clarity' as const,
          level: 'error' as const,
          message: `Scene ${scene.sceneId}: opening beat does not clearly anchor POV to the player character`,
          location: { sceneId: scene.sceneId, beatId: scene.povClarity!.checkedBeatId },
          suggestion: scene.povClarity!.issues.slice(0, 3).map((issue) => issue.suggestion || issue.issue).join('; ') || undefined,
        }));
      if (voiceBlockers.length > 0 || povBlockers.length > 0) {
        result = {
          canProceed: false,
          blockingIssues: [...result.blockingIssues, ...voiceBlockers, ...povBlockers],
          warningCount: result.warningCount,
        };
      }
    } catch (error) {
      context.emit({
        type: 'warning',
        phase: 'quick_validation',
        message: `Incremental scene escalation skipped: ${error instanceof Error ? error.message : String(error)}`,
      });
    }

    if (!result.canProceed) {
      context.emit({
        type: 'error',
        phase: 'quick_validation',
        message: `Quick validation rejected ${result.blockingIssues.length} committed-artifact issue(s); regenerate the earliest owning scene and dependent suffix`,
        data: result.blockingIssues,
      });
      throw new ValidationError('Committed content validation failed', result.blockingIssues);
    }

    context.emit({
      type: 'phase_complete',
      phase: 'quick_validation',
      message: `Quick validation passed (${result.warningCount} warnings)`,
    });
    return result;
  }
}
