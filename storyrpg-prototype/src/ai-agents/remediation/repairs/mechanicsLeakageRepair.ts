/**
 * MechanicsLeakage redaction repair (gating plan — autofix layer).
 *
 * Deterministically scrubs the ONE safe, isolated-token class of mechanics
 * leakage that {@link MechanicsLeakageValidator} flags: bare numeric stat
 * deltas rendered as HUD / bullet / label fragments
 * (e.g. "Trust +10", "Gained: XP +50", "+5 reputation").
 *
 * Everything else — die-roll phrases, embedded check results, threshold
 * conditionals, probability framing, and stat deltas wired into a narrative
 * sentence — is INTENTIONALLY left untouched. Removing those tokens would
 * orphan actions or break cause/effect, so they belong to the B1 SceneWriter
 * regen path. They are counted as skipped, never as fixes.
 *
 * Pure: no LLM, no wall-clock, no randomness. With the gate flag disabled this
 * is a complete no-op (default-off, zero behavior change). With it enabled the
 * story is mutated in place and one ledger record is returned per fix.
 */

import type { Story } from '../../../types/story';
import type { RemediationLedgerRecord } from '../remediationLedger';

const GATE_FLAG = 'GATE_MECHANICS_LEAKAGE';
const RULE_NAME = 'MechanicsLeakage';

type RepairRecord = Omit<RemediationLedgerRecord, 'timestamp'>;

export interface MechanicsLeakageRepairResult {
  fixedCount: number;
  records: RepairRecord[];
}

/** Stat words that, paired with a +/- number, constitute a mechanical delta. */
const STAT_WORD = '(?:XP|experience\\s*points?|hp|health|trust|affection|respect|fear|reputation|score|points?|stat|skill)';

/**
 * A safe, isolated numeric stat delta. The delta must sit at a fragment
 * boundary — start of string / after sentence-or-list punctuation on the left,
 * and end of string / before such punctuation on the right — so we never carve
 * a hole out of the middle of a clause. Both orderings are covered:
 *   - "Trust +10"  (stat then delta)
 *   - "+10 trust"  (delta then stat)
 */
const ISOLATED_DELTA_PATTERN = new RegExp(
  '(^|[.,:;\\n\\u2022\\-]\\s*)' +
    '(?:' +
    `${STAT_WORD}\\s*[+\\-]\\s*\\d+` +
    '|' +
    `[+\\-]\\s*\\d+\\s*${STAT_WORD}` +
    ')' +
    '(?=\\s*(?:[.,:;\\n\\u2022]|$))',
  'gi',
);

/**
 * Narrative-frame verbs that signal the delta is woven into prose rather than
 * sitting in a HUD/label fragment. When any appears in the text we treat the
 * whole text as in-sentence and skip it (leave it for B1 regen).
 */
const NARRATIVE_FRAME = /\b(?:increase[ds]?|increasing|decrease[ds]?|decreasing|gain(?:ed|s|ing)?|earn(?:ed|s|ing)?|lost|lose[ds]?|losing|appear(?:ed|s|ing)?|spark(?:ed|s|ing)?|gr(?:ew|ows?|owing)|rose|rises?|rising|fell|falls?|falling|drop(?:ped|s|ping)?)\b/i;

/** Collapse the whitespace / dangling punctuation a redaction leaves behind. */
function tidy(text: string): string {
  return text
    // Tidy stray space the redaction left in front of sentence punctuation,
    // and fold a now-empty label boundary ("Tally: ." -> "Tally.") into the
    // following punctuation so we don't strand a colon/bullet.
    .replace(/([•:])\s*([.,;])/g, '$2')
    // Collapse a run of sentence punctuation (e.g. ". ." from a removed clause)
    // down to a single mark.
    .replace(/([.,;])(?:\s*[.,;])+/g, '$1')
    // Drop a list bullet or colon that now introduces nothing.
    .replace(/[•:]\s*(?=$|\n)/g, '')
    // Tidy stray space before sentence punctuation.
    .replace(/[^\S\n]+([.,;])/g, '$1')
    // Collapse runs of spaces/tabs (but not newlines) into one space.
    .replace(/[^\S\n]{2,}/g, ' ')
    // Trim spaces that hug a newline.
    .replace(/[^\S\n]*\n[^\S\n]*/g, '\n')
    .trim();
}

/**
 * Redact every safe isolated stat delta from `text`. Returns the cleaned text
 * and how many distinct delta fragments were removed. If `text` reads as
 * narrative prose (a frame verb is present) we redact nothing and report 0 —
 * those leaks are deferred to regen.
 */
function redactIsolatedDeltas(text: string): { text: string; removed: number } {
  if (NARRATIVE_FRAME.test(text)) {
    return { text, removed: 0 };
  }

  let removed = 0;
  const next = text.replace(ISOLATED_DELTA_PATTERN, (_match, lead: string) => {
    removed += 1;
    // Preserve the leading boundary (start-of-string is ""); drop the delta.
    return lead;
  });

  if (removed === 0) {
    return { text, removed: 0 };
  }
  return { text: tidy(next), removed };
}

/**
 * Repair MechanicsLeakage by scrubbing safe isolated stat-delta tokens from
 * beat text and conditional text variants.
 */
export function repairMechanicsLeakage(
  story: Story,
  isEnabled: (flag: string) => boolean,
): MechanicsLeakageRepairResult {
  // Gate: disabled => complete no-op, story untouched.
  if (!isEnabled(GATE_FLAG)) {
    return { fixedCount: 0, records: [] };
  }

  let fixedCount = 0;
  const records: RepairRecord[] = [];

  const recordFix = () => {
    fixedCount += 1;
    records.push({
      rule: RULE_NAME,
      scope: 'autofix',
      attempted: 1,
      succeeded: true,
      degraded: false,
      blocked: false,
      attempts: 1,
    });
  };

  for (const episode of story.episodes ?? []) {
    for (const scene of episode.scenes ?? []) {
      for (const beat of scene.beats ?? []) {
        const beatResult = redactIsolatedDeltas(beat.text);
        if (beatResult.removed > 0) {
          beat.text = beatResult.text;
          for (let i = 0; i < beatResult.removed; i += 1) recordFix();
        }

        for (const variant of beat.textVariants ?? []) {
          const variantResult = redactIsolatedDeltas(variant.text);
          if (variantResult.removed > 0) {
            variant.text = variantResult.text;
            for (let i = 0; i < variantResult.removed; i += 1) recordFix();
          }
        }
      }
    }
  }

  return { fixedCount, records };
}
