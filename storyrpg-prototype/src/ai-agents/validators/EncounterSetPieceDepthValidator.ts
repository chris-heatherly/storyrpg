import type { Story } from '../../types';
import type { SeasonScenePlan } from '../../types/scenePlan';
import { BaseValidator, type ValidationIssue, type ValidationResult } from './BaseValidator';
import { SUSTAINED_SET_PIECE_RE } from '../utils/sustainedEncounter';

/**
 * Encounter set-piece depth (G10).
 *
 * A treatment can stage an encounter as a SUSTAINED set piece — "a sustained defensive
 * set piece (wall breach + repulse) culminating in the choice to evacuate" (Endsong ep3)
 * — i.e. an escalating sequence, not a single decision. G10 shipped that siege collapsed
 * to ONE phase, ONE decision, with a flat one-entry tensionCurve; the promised escalation
 * was summarized into the victory outcome paragraph. SignatureDevicePresenceValidator
 * checks the signature STRING is present; this checks the encounter STRUCTURE was not
 * flattened.
 *
 * For an encounter whose authored intent (plan signature / required beats / its own
 * description) describes a sustained sequence, require real depth: at least two phases OR
 * a tension curve of ≥3 escalation points. A single-phase, flat-curve encounter under a
 * "sustained set-piece" banner is flagged. Deterministic, no LLM.
 */

const SUSTAINED_RE = SUSTAINED_SET_PIECE_RE;

export interface EncounterSetPieceDepthInput {
  story: Story;
  /** Optional scene plan — its signatureMoment / signature requiredBeats are the most
   * reliable source of "this encounter was staged as a sustained set piece". */
  plan?: SeasonScenePlan;
}

interface EncObj {
  phases?: Array<{ beats?: unknown[] }>;
  tensionCurve?: unknown[];
  escalationTriggers?: unknown[];
  description?: string;
  name?: string;
}

export class EncounterSetPieceDepthValidator extends BaseValidator {
  constructor() {
    super('EncounterSetPieceDepthValidator');
  }

  validate(input: EncounterSetPieceDepthInput): ValidationResult {
    const issues: ValidationIssue[] = [];

    // Index plan intent text by scene id.
    const planIntentBySceneId = new Map<string, string>();
    for (const scene of input.plan?.scenes || []) {
      const parts: string[] = [];
      if (scene.signatureMoment) parts.push(scene.signatureMoment);
      for (const b of scene.requiredBeats || []) if (b.mustDepict) parts.push(b.mustDepict);
      for (const b of scene.encounter?.requiredBeats || []) if (b.mustDepict) parts.push(b.mustDepict);
      if (parts.length) planIntentBySceneId.set(scene.id, parts.join(' — '));
    }

    for (const episode of input.story.episodes || []) {
      for (const scene of episode.scenes || []) {
        const enc = (scene as { encounter?: EncObj }).encounter;
        if (!enc) continue;
        const intentText = [
          planIntentBySceneId.get(scene.id) || '',
          enc.description || '',
          enc.name || '',
        ].join(' ');
        if (!SUSTAINED_RE.test(intentText)) continue;

        const phaseCount = Array.isArray(enc.phases) ? enc.phases.length : 0;
        const curveLen = Array.isArray(enc.tensionCurve) ? enc.tensionCurve.length : 0;
        const hasDepth = phaseCount >= 2 || curveLen >= 3;
        if (!hasDepth) {
          issues.push(this.error(
            `Encounter scene "${scene.name || scene.id}" is staged as a sustained set piece but collapsed to ${phaseCount} phase(s) and a ${curveLen}-point tension curve — the escalation was summarized, not dramatized. Intent: "${intentText.trim().slice(0, 140)}".`,
            `${episode.id}:${scene.id}`,
            'Dramatize the sequence as multiple escalating phases (e.g. breach → repulse → choice), not a single decision plus a summary outcome. Add phases/tensionCurve points that play the set piece out.',
          ));
        }
      }
    }

    const errors = issues.length;
    return {
      valid: errors === 0,
      score: Math.max(0, 100 - errors * 20),
      issues,
      suggestions: issues.map((i) => i.suggestion).filter((s): s is string => Boolean(s)),
    };
  }
}
