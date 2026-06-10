import type { Story } from '../../types';
import { BaseValidator, type ValidationIssue, type ValidationResult } from './BaseValidator';
import { contentTokens, enumeratedItems } from '../utils/enumeratedObjective';

/**
 * Referenced-event / promised-clue presence (G10).
 *
 * A scene's `sequenceIntent.objective` sometimes ENUMERATES concrete things the scene
 * promises to dramatize — the canonical G10 failure was Bite Me ep3 s3-3:
 *   "Kylie collects four splinters of wrongness — Ileana's tears, the photograph,
 *    the maiden name, Mika's absence."
 * Three of those four (the photograph, the maiden name, Mika's absence) appeared ONLY in
 * the objective metadata and never in any beat prose, yet later scenes paid them off as
 * if the reader had seen them. Validators passed because the seed FLAGS were set; none
 * checked that the promised content was actually on the page.
 *
 * This validator parses ENUMERATED objectives (an explicit list after a dash/colon, or a
 * comma list of ≥3 items) and flags any list item whose distinctive content words never
 * appear in the scene's own beat prose. Conservative by design — it only fires on
 * explicit enumerations, so abstract single-clause objectives ("absorb the consequence
 * and recalibrate") are never flagged. Deterministic, no LLM.
 *
 * NOTE (scope): arbitrary in-dialogue back-references to events that never occurred
 * on-page (e.g. Endsong ep2 "you called me cargo … when you thought I was asleep") are
 * NOT covered here — verifying that a referenced spoken line happened earlier is a
 * semantic judgment best handled by an LLM-judge pass, not a keyword heuristic. This
 * validator covers the high-precision enumerated-promise slice only.
 */

export interface ReferencedEventPresenceInput {
  story: Story;
}

export class ReferencedEventPresenceValidator extends BaseValidator {
  constructor() {
    super('ReferencedEventPresenceValidator');
  }

  validate(input: ReferencedEventPresenceInput): ValidationResult {
    const issues: ValidationIssue[] = [];

    for (const episode of input.story.episodes || []) {
      for (const scene of episode.scenes || []) {
        const objective = (scene as { sequenceIntent?: { objective?: string } }).sequenceIntent?.objective;
        if (!objective) continue;
        const items = enumeratedItems(objective);
        if (items.length === 0) continue;

        // The scene's own reader-facing prose: beat text + mustShowDetail + encounter
        // situation/storylet prose (a clue can be dramatized in any of these).
        const proseTokens = new Set(collectSceneProseTokens(scene));
        if (proseTokens.size === 0) continue;

        for (const item of items) {
          const toks = contentTokens(item);
          if (toks.length === 0) continue;
          const present = toks.some((t) => proseTokens.has(t));
          if (!present) {
            issues.push(this.warning(
              `Scene "${scene.name || scene.id}" objective promises "${item.trim()}" but none of its content appears in the scene's prose — a later payoff would reference a clue the reader never saw.`,
              `${episode.id}:${scene.id}`,
              'Dramatize the promised detail on-page in this scene (a beat or tint), or remove it from the objective so it is not paid off later as if shown.',
            ));
          }
        }
      }
    }

    const warnings = issues.length;
    return {
      valid: true, // advisory by nature; gating handled by the caller
      score: Math.max(0, 100 - warnings * 5),
      issues,
      suggestions: issues.map((i) => i.suggestion).filter((s): s is string => Boolean(s)),
    };
  }
}

const PROSE_KEYS = new Set([
  'text', 'narrativeText', 'setupText', 'outcomeText', 'mustShowDetail', 'visualMoment',
]);

/** Collect content tokens from a scene's reader-facing prose (beats + encounter). */
function collectSceneProseTokens(scene: unknown): string[] {
  const out: string[] = [];
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const v of node) walk(v);
      return;
    }
    if (!node || typeof node !== 'object') return;
    const obj = node as Record<string, unknown>;
    // Do not descend into sequenceIntent — that is the SOURCE of the promise, not prose.
    for (const [key, val] of Object.entries(obj)) {
      if (key === 'sequenceIntent') continue;
      if (typeof val === 'string' && PROSE_KEYS.has(key)) {
        out.push(...contentTokens(val));
      } else if (val && typeof val === 'object') {
        walk(val);
      }
    }
  };
  walk(scene);
  return out;
}
