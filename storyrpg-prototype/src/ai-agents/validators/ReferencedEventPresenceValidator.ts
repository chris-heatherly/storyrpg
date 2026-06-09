import type { Story } from '../../types';
import { BaseValidator, type ValidationIssue, type ValidationResult } from './BaseValidator';

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

const STOPWORDS = new Set([
  'the', 'and', 'her', 'his', 'their', 'with', 'that', 'this', 'from', 'into', 'over',
  'four', 'three', 'five', 'two', 'some', 'each', 'every', 'they', 'them', 'then',
  'wrongness', 'things', 'details', 'moments', 'collects', 'collect', 'notices', 'notice',
  'plants', 'plant', 'gathers', 'gather', 'before', 'after', 'while', 'about',
  'player', 'reader', 'audience', // meta references, never concrete clues
]);

// Lead-in words that signal the objective is ENUMERATING observed concrete clues
// (vs. describing an abstract dramatic arc). Without one of these, a dash/list is just
// prose structure, not a promise of on-page details — so we do not treat it as a list.
const ENUMERATION_TRIGGER_RE =
  /\b(collect|collects|gather|gathers|notice|notices|catalog|catalogs|clue|clues|splinter|splinters|detail|details|sign|signs|tell|tells|spot|spots|observe|observes|piece|pieces|note|notes|inventory)\b/i;

// A concrete clue item is a short noun phrase. Reject items that read as verb clauses
// (a leading/standalone verb or any gerund) — those are arc descriptions, not clues.
const VERBY_RE = /\b\w+ing\b/i;
const LEADING_VERB_RE =
  /^(move|set|setting|test|tests|establish|build|deepen|reveal|push|shift|survive|survives|absorb|recalibrate|earn|trade)\b/i;

function contentTokens(s: string): string[] {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter((t) => t.length >= 4 && !STOPWORDS.has(t));
}

/**
 * Extract enumerated list items from an objective, or [] when it is not an enumeration.
 * Recognizes "lead — a, b, c[, and d]" / "lead: a, b, c" and bare comma lists of ≥3.
 */
function enumeratedItems(objective: string): string[] {
  if (!objective) return [];
  // Require a dash/colon that separates an enumeration lead-in from the list.
  const dashSplit = objective.split(/\s[—–:-]\s/);
  if (dashSplit.length < 2) return [];
  const lead = dashSplit[0];
  // The lead-in must signal an enumeration of concrete clues, not an abstract arc.
  if (!ENUMERATION_TRIGGER_RE.test(lead)) return [];

  const tail = dashSplit.slice(1).join(' ');
  const items = tail
    .split(/,|\band\b/i)
    .map((s) => s.trim().replace(/[.!?]+$/, ''))
    .filter(Boolean)
    .filter((s) => contentTokens(s).length > 0)
    // A concrete clue is a SHORT noun phrase: ≤5 words, no gerund, no leading verb.
    .filter((s) => s.split(/\s+/).length <= 5 && !VERBY_RE.test(s) && !LEADING_VERB_RE.test(s));
  // Only treat as an enumeration when there are genuinely ≥3 distinct concrete items.
  return items.length >= 3 ? items : [];
}

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
