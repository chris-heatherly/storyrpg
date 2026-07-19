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

interface ForbiddenAtomLike {
  polarity?: string;
  description?: string;
  acceptedPatterns?: string[];
}

interface ForbiddenLexicalTaskLike {
  id: string;
  evidenceAtoms?: ForbiddenAtomLike[];
}

/**
 * Per-scene forbidden VOCABULARY from the scene's compiled realization tasks —
 * not-yet-coined names/codewords whose premature appearance the final contract
 * blocks as forbidden evidence ("Mr. Midnight" before s1-6 coins it, "The
 * Mountain" before Episode 2). The information ledger (buildForbiddenReveals)
 * never carried these, so no writer was ever TOLD the term was off-limits —
 * the model invented the natural nickname usage and walked into a tripwire it
 * could not see (batch r122/r126/r128/r129, 2026-07-19: the top-ranked defect
 * class, 4 of 8 runs). Prevention beats repair: inject them into the same
 * prompt section.
 */
export function buildForbiddenLexicalReveals(tasks: ForbiddenLexicalTaskLike[] | undefined): ForbiddenReveal[] {
  if (!tasks?.length) return [];
  const out: ForbiddenReveal[] = [];
  const seen = new Set<string>();
  for (const task of tasks) {
    for (const atom of task.evidenceAtoms ?? []) {
      if (atom.polarity !== 'forbidden' || !atom.description) continue;
      const patterns = (atom.acceptedPatterns ?? []).filter(Boolean);
      const key = `${atom.description}::${patterns.join('|')}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        id: `lexical:${task.id}`,
        label: patterns.length > 0 ? `Do not use the wording ${patterns.map((p) => `"${p}"`).join(', ')}` : 'Forbidden content for this scene',
        description: atom.description,
        revealEpisode: undefined,
        hintAllowed: false,
      });
    }
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
      const when = i.revealEpisode
        ? ` (reveals in episode ${i.revealEpisode})`
        : i.id.startsWith('lexical:')
          ? ' (not yet coined at this point in the story — refer to the person/thing descriptively instead)'
          : ' (withheld this season)';
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
