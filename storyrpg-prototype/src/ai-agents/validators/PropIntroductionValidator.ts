/**
 * Prop / Cast Introduction Validator (#26C).
 *
 * A scene that names a character or prop the story never declared is a continuity
 * break — the LLM invented a name, or referenced an entity from a path the player
 * didn't take. Full prose entity-extraction is unreliable, so this validator works
 * on the STRUCTURED references the pipeline already tracks (a scene's declared
 * entities) and checks each resolves to a KNOWN, introduced entity.
 *
 * "Known" = the seeded cast/prop set (character bible + declared props) plus any
 * entity a scene explicitly marks as introducing. A reference that resolves to
 * nothing known is the reliable, deterministic signal of a missing introduction —
 * ordering ("used before introduced") needs per-entity intro metadata we don't have,
 * so we deliberately don't guess at it.
 *
 * Advisory — surfaces the gap and feeds the light-continuity prompt; never blocks.
 * Pure + unit-testable.
 */

import {
  BaseValidator,
  ValidationIssue,
  ValidationResult,
  buildSuccessResult,
  buildFailureResult,
} from './BaseValidator';

export interface PropIntroductionScene {
  sceneId?: string;
  sceneName?: string;
  /** Entity ids this scene references (characters + props). */
  referencedEntityIds?: string[];
  /** Entity ids this scene explicitly introduces (added to the known set). */
  introducesEntityIds?: string[];
}

export interface PropIntroductionInput {
  /** All declared entities: protagonist, full cast bible, seeded props. */
  knownEntityIds: string[];
  /** Scenes in play order. */
  sceneContents: PropIntroductionScene[];
}

export interface PropIntroductionMetrics {
  scenesChecked: number;
  unresolvedReferences: Array<{ sceneId: string; entityId: string }>;
}

export class PropIntroductionValidator extends BaseValidator {
  constructor() {
    super('PropIntroductionValidator');
  }

  validate(input: PropIntroductionInput): ValidationResult & { metrics: PropIntroductionMetrics } {
    const issues: ValidationIssue[] = [];
    const known = new Set((input.knownEntityIds ?? []).filter(Boolean));
    // A scene may declare it introduces an entity (e.g. a newly-revealed NPC); fold those in.
    for (const scene of input.sceneContents ?? []) {
      for (const id of scene.introducesEntityIds ?? []) if (id) known.add(id);
    }

    const unresolved: Array<{ sceneId: string; entityId: string }> = [];
    let scenesChecked = 0;
    const flagged = new Set<string>(); // de-dupe repeated references to the same unknown entity

    for (const scene of input.sceneContents ?? []) {
      scenesChecked++;
      const sceneId = scene.sceneId ?? 'scene';
      for (const entityId of scene.referencedEntityIds ?? []) {
        if (!entityId || known.has(entityId)) continue;
        unresolved.push({ sceneId, entityId });
        if (flagged.has(entityId)) continue;
        flagged.add(entityId);
        issues.push(
          this.warning(
            `Scene "${scene.sceneName || sceneId}" references "${entityId}", which is not a declared character/prop.`,
            `scene:${sceneId}`,
            'Add the entity to the cast/prop bible, introduce it earlier, or correct the reference.',
          ),
        );
      }
    }

    const metrics: PropIntroductionMetrics = { scenesChecked, unresolvedReferences: unresolved };

    if (unresolved.length > 0) {
      const score = Math.max(40, 100 - flagged.size * 15);
      return { ...buildFailureResult(issues, score), metrics };
    }
    return { ...buildSuccessResult(100), metrics };
  }
}
