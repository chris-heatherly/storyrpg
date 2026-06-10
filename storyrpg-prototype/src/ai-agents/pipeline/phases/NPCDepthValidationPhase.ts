/**
 * NPC Depth Validation Phase
 *
 * Phase 2.5 of story generation: validates NPC relationship depth across the
 * cast (relationship dimensions by tier), and on error-level failures runs
 * the Karpathy retry — re-running character design once with the depth
 * issues folded into the prompt, adopting the retry bible only when it
 * improves, then enforcing strict-mode aborts / advisory checkpoints on the
 * final residue.
 *
 * Faithful port of the "PHASE 2.5: NPC DEPTH VALIDATION" block from
 * FullStoryPipeline.generate() (pure move): same gate, same retry/adopt
 * policy, same events, same abort behavior. The retry adopts by
 * Object.assign onto the SHARED characterBible reference, exactly as the
 * inline code did, so every downstream consumer sees the repaired cast.
 * Character design re-runs go through the injected closure (which the
 * monolith routes through measurePhase + its delegating runCharacterDesign).
 */

import { CharacterBible } from '../../agents/CharacterDesigner';
import { WorldBible } from '../../agents/WorldBuilder';
import { NPCDepthValidator } from '../../validators';
import { ValidationError } from '../../../types/validation';
import type { FullCreativeBrief } from '../FullStoryPipeline';
import { PipelineContext } from './index';

// ========================================
// DEPENDENCY TYPES
// ========================================

export interface NPCDepthValidationPhaseDeps {
  npcDepthValidator: Pick<NPCDepthValidator, 'validateCast'>;
  /** Re-runs character design (routed through measurePhase in the monolith). */
  rerunCharacterDesign: (
    brief: FullCreativeBrief,
    worldBible: WorldBible
  ) => Promise<CharacterBible>;
}

// ========================================
// PHASE IMPLEMENTATION
// ========================================

export class NPCDepthValidationPhase {
  readonly name = 'npc_validation';

  constructor(private readonly deps: NPCDepthValidationPhaseDeps) {}

  /** Mutates `characterBible` in place when the retry improves the cast. */
  async run(
    brief: FullCreativeBrief,
    worldBible: WorldBible,
    characterBible: CharacterBible,
    context: PipelineContext
  ): Promise<void> {
    if (context.config.validation.enabled && context.config.validation.rules.npcDepth.enabled) {
      context.emit({ type: 'phase_start', phase: 'npc_validation', message: 'Validating NPC relationship depth' });
      let npcValidation = await this.deps.npcDepthValidator.validateCast(characterBible.characters);

      if (!npcValidation.passed) {
        const depthIssues = npcValidation.issues.filter(i => i.level === 'error');

        // === KARPATHY LOOP: Re-run character design with depth feedback ===
        if (depthIssues.length > 0 && context.config.validation.mode !== 'disabled') {
          const issueText = depthIssues
            .map(i => `- ${i.message}${i.suggestion ? ` (fix: ${i.suggestion})` : ''}`)
            .join('\n');

          context.emit({
            type: 'regeneration_triggered',
            phase: 'npc_validation',
            message: `NPC depth validation failed with ${depthIssues.length} error(s), retrying character design with feedback`,
          });

          try {
            const originalBrief = { ...brief };
            const repairedBrief = {
              ...originalBrief,
              userPrompt: `${originalBrief.userPrompt || ''}\n\nCRITICAL NPC DEPTH FIXES REQUIRED:\n${issueText}\n\nEnsure every major NPC has relationship dimensions (trust, affection, respect, fear) initialized. Supporting NPCs need at least 2 dimensions. Core NPCs need all 4.`,
            };

            const retryCharBible = await this.deps.rerunCharacterDesign(repairedBrief, worldBible);

            const retryNpcValidation = await this.deps.npcDepthValidator.validateCast(retryCharBible.characters);
            const retryDepthErrors = retryNpcValidation.issues.filter(i => i.level === 'error');

            if (retryNpcValidation.passed || retryDepthErrors.length < depthIssues.length) {
              Object.assign(characterBible, retryCharBible);
              npcValidation = retryNpcValidation;
              context.addCheckpoint('Character Bible', characterBible, true);
              context.emit({
                type: 'debug',
                phase: 'npc_validation',
                message: `NPC depth retry improved: ${depthIssues.length} -> ${retryDepthErrors.length} error(s)`,
              });
            } else {
              context.emit({
                type: 'debug',
                phase: 'npc_validation',
                message: `NPC depth retry did not improve (${retryDepthErrors.length} errors), keeping original`,
              });
            }
          } catch (retryErr) {
            context.emit({
              type: 'warning',
              phase: 'npc_validation',
              message: `Character design retry for NPC depth failed: ${retryErr instanceof Error ? retryErr.message : String(retryErr)}`,
            });
          }
        }

        // After repair attempt, check final state
        const finalDepthIssues = npcValidation.issues.filter(i => i.level === 'error');
        if (finalDepthIssues.length > 0 && context.config.validation.mode === 'strict') {
          context.emit({
            type: 'error',
            message: `NPC depth requirements not met: ${finalDepthIssues.length} errors`,
            data: finalDepthIssues,
          });
          throw new ValidationError('NPC depth requirements not met', finalDepthIssues);
        } else if (finalDepthIssues.length > 0) {
          context.emit({
            type: 'checkpoint',
            phase: 'npc_validation',
            message: `NPC depth validation: ${finalDepthIssues.length} issues remain (advisory mode)`,
            data: npcValidation,
          });
        } else {
          context.emit({
            type: 'phase_complete',
            phase: 'npc_validation',
            message: 'NPC depth validation passed after repair',
          });
        }
      } else {
        context.emit({
          type: 'phase_complete',
          phase: 'npc_validation',
          message: 'NPC depth validation passed',
        });
      }
    }
  }
}
