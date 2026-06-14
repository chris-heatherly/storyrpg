/**
 * Deterministic design-note-leak repair for the final-contract repair loop — the
 * planned fix the GATE_DESIGN_NOTE_LEAK policyException referenced ("meta-narration
 * stripping ... so hits repair instead of aborting").
 *
 * FinalStoryContractValidator flags `echo_summary_variant`: a beat `textVariant`
 * whose ENTIRE text is one of a choice's echo-summary / reminder cues — a META
 * one-liner (a design note, not prose) that at runtime would REPLACE the beat's
 * prose with a feedback line. The bogus variant IS the leak; the beat's real base
 * prose is fine. So the repair is simply to DELETE that variant (no LLM, no rewrite
 * — precise and model-independent), which clears the finding while leaving the
 * authored prose intact. Before this, a design-note leak hard-aborted the season.
 */

import type { Story } from '../../types/story';
import type { ContractRepairHandler } from './finalContractRepair';

/** Normalize a string the same way the validator does (collapse whitespace, lowercase). */
const normMeta = (s: unknown): string =>
  typeof s === 'string' ? s.replace(/\s+/g, ' ').trim().toLowerCase() : '';

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
    if (meta.size === 0) return { story, changed: false };

    let stripped = 0;
    for (const ep of (story as { episodes?: any[] }).episodes ?? []) {
      for (const scene of ep.scenes ?? []) {
        for (const beat of scene.beats ?? []) {
          if (!Array.isArray(beat.textVariants)) continue;
          const before = beat.textVariants.length;
          beat.textVariants = beat.textVariants.filter(
            (v: { text?: unknown }) => !(v && meta.has(normMeta(v.text))),
          );
          stripped += before - beat.textVariants.length;
        }
      }
    }

    if (stripped === 0) return { story, changed: false };
    return {
      story,
      changed: true,
      record: {
        rule: 'final_contract_design_note_leak',
        scope: 'season',
        attempted: stripped,
        succeeded: true,
        degraded: false,
        blocked: false,
        attempts: 1,
        details: `Stripped ${stripped} echo-summary/reminder textVariant leak(s)`,
      },
    };
  };
}
