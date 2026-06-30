/**
 * Forbidden-reveals guard (G12).
 *
 * The information ledger budgets every season secret to a reveal episode, but
 * generators were never TOLD the schedule — only the per-scene "reveal this now"
 * directives. G12 burned reveals episodes early: Carmen unmasked in ep2 scene 1
 * (budgeted ep6), Victor confirming the staged rescue in ep2 (INFO-B, eps 3–5+),
 * the supernatural overt in ep3 (held to ep5). This derives the DO-NOT-REVEAL
 * list per episode for injection into SceneWriter / EncounterArchitect prompts;
 * the InformationLedgerScheduleValidator (GATE_INFORMATION_LEDGER_SCHEDULE)
 * remains the detection half.
 */

import type { InformationLedgerEntry } from '../../types/seasonPlan';

export interface ForbiddenReveal {
  id: string;
  label: string;
  description: string;
  revealEpisode?: number;
  /** True when this episode is a planned setup touch — hinting allowed, confirmation not. */
  hintAllowed: boolean;
}

/**
 * Ledger entries that must NOT be revealed/confirmed in `episodeNumber`.
 * Entries the scene itself is scheduled to reveal (`allowedInfoIds`) are excluded.
 */
export function buildForbiddenReveals(
  ledger: InformationLedgerEntry[] | undefined,
  episodeNumber: number,
  allowedInfoIds?: string[],
): ForbiddenReveal[] {
  if (!ledger?.length) return [];
  const allowed = new Set(allowedInfoIds || []);
  const out: ForbiddenReveal[] = [];
  for (const entry of ledger) {
    if (!entry?.id || allowed.has(entry.id)) continue;
    const revealEp = entry.plannedRevealEpisode;
    const withheldNow =
      revealEp !== undefined ? revealEp > episodeNumber : entry.audienceKnowledgeState === 'withheld';
    if (!withheldNow) continue;
    out.push({
      id: entry.id,
      label: entry.label,
      description: entry.description,
      revealEpisode: revealEp,
      hintAllowed: (entry.setupTouchEpisodes || []).includes(episodeNumber),
    });
  }
  return out;
}

/**
 * Prompt section for the forbidden list. Returns '' when empty so prompts are
 * byte-identical for stories without a ledger.
 */
export function formatForbiddenRevealsSection(items: ForbiddenReveal[]): string {
  if (items.length === 0) return '';
  const lines = items
    .map((i) => {
      const when = i.revealEpisode ? ` (reveals in episode ${i.revealEpisode})` : ' (withheld this season)';
      const hint = i.hintAllowed ? ' May be HINTED at obliquely this episode, never stated or confirmed.' : '';
      return `- ${i.label}: ${i.description}${when}.${hint}`;
    })
    .join('\n');
  return (
    '\n### Forbidden Reveals (season architecture — VIOLATIONS FAIL VALIDATION)\n' +
    'The following facts are withheld from the audience at this point in the season. ' +
    'NO character may state, confirm, demonstrate, or be shown discovering them — not in prose, ' +
    'dialogue, outcome text, or storylets. Do not invent substitutes that resolve the same mystery.\n' +
    lines
  );
}
