/**
 * Deterministic design-note-leak repair for the final-contract repair loop — the
 * planned fix the GATE_DESIGN_NOTE_LEAK policyException referenced ("meta-narration
 * stripping ... so hits repair instead of aborting").
 *
 * FinalStoryContractValidator flags `echo_summary_variant` when a beat textVariant
 * is one of a choice's echo-summary / reminder cues, or when that meta one-liner
 * was appended as its own paragraph to base beat text. The bogus line IS the leak;
 * the beat's real prose is fine. So the repair deletes the variant or strips the
 * appended paragraph (no LLM, no rewrite — precise and model-independent).
 */

import type { Story } from '../../types/story';
import { READER_PROSE_LEAK_PATTERNS, STRUCTURAL_SCAFFOLDING_PATTERNS } from '../constants/metaProse';
import type { ContractRepairHandler } from './finalContractRepair';

/** Normalize a string the same way the validator does (collapse whitespace, lowercase). */
const normMeta = (s: unknown): string =>
  typeof s === 'string' ? s.replace(/\s+/g, ' ').trim().toLowerCase() : '';

const metaLeakPatterns = [
  ...READER_PROSE_LEAK_PATTERNS.map((p) => p.pattern),
  ...STRUCTURAL_SCAFFOLDING_PATTERNS.map((p) => p.pattern),
];

function isMetaParagraph(paragraph: string, meta: Set<string>): boolean {
  const normalized = normMeta(paragraph);
  return meta.has(normalized) || metaLeakPatterns.some((pattern) => pattern.test(paragraph));
}

const GENERIC_REPAIRED_META_TEXT = 'The consequence settles into the room, changing what the next choice can cost.';

function stripMetaParagraphs(text: unknown, meta: Set<string>, fallback = GENERIC_REPAIRED_META_TEXT): string | undefined {
  if (typeof text !== 'string') return undefined;
  const paragraphs = text.split(/\n{2,}/);
  if (paragraphs.length <= 1) {
    if (!isMetaParagraph(text, meta)) return undefined;
    return fallback;
  }
  const kept = paragraphs.filter((paragraph) => !isMetaParagraph(paragraph, meta));
  if (kept.length === paragraphs.length) return undefined;
  if (kept.length === 0) return fallback;
  return kept.join('\n\n').trim();
}

/**
 * The global set of choice feedback-cue / reminder strings — text that is META
 * (planning register), never beat prose. Mirrors FinalStoryContractValidator's
 * design-note-leak detection exactly, so the handler strips precisely what the
 * validator flags. Only strings >= 8 chars are tracked (the validator's floor).
 */
function collectMetaStrings(story: Story): Set<string> {
  const meta = new Set<string>();
  const note = (s: unknown): void => {
    const n = normMeta(s);
    if (n.length >= 8) meta.add(n);
  };
  for (const ep of (story as { episodes?: any[] }).episodes ?? []) {
    for (const scene of ep.scenes ?? []) {
      for (const beat of scene.beats ?? []) {
        for (const choice of beat.choices ?? []) {
          note(choice?.feedbackCue?.echoSummary);
          note(choice?.reminderPlan?.immediate);
          note(choice?.reminderPlan?.shortTerm);
          note(choice?.reminderPlan?.longTerm);
        }
      }
    }
  }
  return meta;
}

/**
 * Build the ContractRepairHandler. Deterministic and always-safe (removing a
 * variant that is a verbatim feedback cue never harms authored prose), so it runs
 * in the deterministic pass; no-op when there are no leaks (clean runs unaffected →
 * golden parity).
 */
export function buildDesignNoteLeakStripHandler(): ContractRepairHandler {
  return ({ story }) => {
    const meta = collectMetaStrings(story);

    let stripped = 0;
    let rewritten = 0;
    for (const ep of (story as { episodes?: any[] }).episodes ?? []) {
      for (const scene of ep.scenes ?? []) {
        for (const beat of scene.beats ?? []) {
          const cleanedText = stripMetaParagraphs(beat.text, meta);
          if (cleanedText !== undefined) {
            beat.text = cleanedText;
            rewritten += 1;
          }
          if (Array.isArray(beat.textVariants)) {
            const before = beat.textVariants.length;
            beat.textVariants = beat.textVariants.filter(
              (v: { text?: unknown }) => {
                if (!v || typeof v.text !== 'string') return true;
                const cleanedVariantText = stripMetaParagraphs(v.text, meta, '');
                if (cleanedVariantText !== undefined) {
                  if (!cleanedVariantText.trim()) return false;
                  v.text = cleanedVariantText;
                  rewritten += 1;
                  return true;
                }
                return !isMetaParagraph(v.text, meta);
              },
            );
            stripped += before - beat.textVariants.length;
          }
        }
      }
    }

    if (stripped === 0 && rewritten === 0) return { story, changed: false };
    const touched = stripped + rewritten;
    return {
      story,
      changed: true,
      record: {
        rule: 'final_contract_design_note_leak',
        scope: 'season',
        attempted: touched,
        succeeded: true,
        degraded: false,
        blocked: false,
        attempts: 1,
        details: `Stripped ${touched} echo-summary/reminder prose leak(s)`,
      },
    };
  };
}
