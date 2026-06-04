/**
 * Within-episode plant context (Season Canon, Phase 1).
 *
 * The CallbackLedger pays callbacks off ACROSS episodes (it harvests at episode
 * end and windows by episode), so for a single episode a flag set in scene 1 is
 * never surfaced to scene 4 of the SAME episode — and the "your earlier choice
 * echoes here" payoff never gets authored (flagsReferenced stays near zero).
 *
 * This module closes that gap deterministically: as scenes generate in order, we
 * accumulate the trackable flags each scene's choices set (with the choice's
 * AUTHORED acknowledgment summary) and merge them into the `unresolvedCallbacks`
 * list handed to LATER scenes' SceneWriter — which already knows how to author a
 * flag-conditional textVariant acknowledging a callback. No new LLM call, no
 * templated prose: the model writes the payoff in context, gated on the flag the
 * earlier choice set.
 *
 * Pure + structurally typed so it's unit-testable and the pipeline keeps only a
 * thin call site.
 */

import type { Choice } from '../../types/choice';
import type { CallbackLedger } from './callbackLedger';
import type { UnresolvedCallbackForPrompt } from './callbackOrchestration';

export interface EpisodePlant {
  flag: string;
  summary: string;
  sceneId: string;
  /** Consequence tier surfaced to the later scene (defaults to 'tint'). */
  tier?: 'tint' | 'branch';
}

interface PlantChoiceSet {
  sceneId?: string;
  choices?: Choice[];
}

/** Best available authored acknowledgment text for a choice (never templated). */
function ackSummaryOf(choice: Choice): string | undefined {
  return (
    choice.feedbackCue?.echoSummary ||
    choice.reminderPlan?.shortTerm ||
    choice.reminderPlan?.immediate ||
    choice.memorableMoment?.summary ||
    undefined
  );
}

/**
 * Extract the plants a scene's choices set: each trackable flag (via the ledger's
 * own rule) paired with the choice's authored acknowledgment summary.
 */
export function extractPlantsFromChoiceSet(
  choiceSet: PlantChoiceSet,
  ledger: CallbackLedger,
): EpisodePlant[] {
  const out: EpisodePlant[] = [];
  for (const choice of choiceSet.choices ?? []) {
    const summary = ackSummaryOf(choice);
    if (!summary) continue;
    for (const flag of ledger.trackableFlagsOf(choice)) {
      out.push({ flag, summary, sceneId: choiceSet.sceneId ?? '' });
    }
  }
  return out;
}

/**
 * Extract `tint:` plants a scene's choices set. The trackable-flag extractor above
 * deliberately excludes cosmetic `tint:` flags (the ledger's rule), so they were
 * never surfaced to later scenes and shipped as unreferenced callback debt. This
 * surfaces them as low-priority plants — same in-context authoring mechanism (the
 * model writes a flag-conditional tint acknowledgment), no templating. Structural
 * `treatment_branch_*` / `route_` flags are NOT tint debt and stay excluded.
 */
export function extractTintPlantsFromChoiceSet(choiceSet: PlantChoiceSet): EpisodePlant[] {
  const out: EpisodePlant[] = [];
  for (const choice of choiceSet.choices ?? []) {
    const summary = ackSummaryOf(choice);
    if (!summary) continue;
    for (const consequence of choice.consequences ?? []) {
      if (
        consequence.type === 'setFlag' &&
        typeof consequence.flag === 'string' &&
        consequence.flag.startsWith('tint:') &&
        consequence.value !== false
      ) {
        out.push({ flag: consequence.flag, summary, sceneId: choiceSet.sceneId ?? '' });
      }
    }
  }
  return out;
}

/**
 * C1/C2: surface the BRANCH residue a scene's choices set — the `route_` /
 * `treatment_branch_` flags that record which divergent path the player took. The
 * tint/callback extractors deliberately exclude these structural flags, so when
 * branches reconverge at a bottleneck the later scene had no signal of which path
 * led here and authored generic, path-blind prose (no reconvergence residue).
 *
 * Surfacing them as `tier: 'branch'` plants flows them to later scenes through the
 * same in-context authoring mechanism (the model writes a flag-conditional residue
 * line — "the road you took still shows on you"), no templating. Cosmetic `tint:`
 * flags stay with the tint extractor.
 */
export function extractBranchResidueFromChoiceSet(choiceSet: PlantChoiceSet): EpisodePlant[] {
  const out: EpisodePlant[] = [];
  for (const choice of choiceSet.choices ?? []) {
    const summary = ackSummaryOf(choice);
    if (!summary) continue;
    for (const consequence of choice.consequences ?? []) {
      if (
        consequence.type === 'setFlag' &&
        typeof consequence.flag === 'string' &&
        (consequence.flag.startsWith('route_') || consequence.flag.startsWith('treatment_branch_')) &&
        consequence.value !== false
      ) {
        out.push({ flag: consequence.flag, summary, sceneId: choiceSet.sceneId ?? '', tier: 'branch' });
      }
    }
  }
  return out;
}

/** Shape accumulated within-episode plants as unresolved-callback prompt entries. */
export function plantsToUnresolvedCallbacks(
  plants: EpisodePlant[],
  episodeNumber: number,
): UnresolvedCallbackForPrompt[] {
  const byFlag = new Map<string, EpisodePlant>();
  for (const p of plants) if (!byFlag.has(p.flag)) byFlag.set(p.flag, p);
  return [...byFlag.values()].map((p) => ({
    id: `within-ep${episodeNumber}-${p.flag}`,
    sourceEpisode: episodeNumber,
    summary: p.summary,
    flags: [p.flag],
    conditionKeys: [p.flag],
    consequenceTier: p.tier ?? 'tint',
  }));
}

/**
 * Merge cross-episode unresolved callbacks with this-episode plants for the
 * scene about to be written. Returns `undefined` when there's nothing to surface
 * (so the prompt section is skipped). Dedupes within-episode plants by flag and
 * drops any whose flag is already covered by a cross-episode hook.
 */
export function mergeUnresolvedForScene(
  crossEpisode: UnresolvedCallbackForPrompt[] | undefined,
  episodePlants: EpisodePlant[],
  episodeNumber: number,
): UnresolvedCallbackForPrompt[] | undefined {
  const crossFlags = new Set((crossEpisode ?? []).flatMap((h) => h.flags ?? []));
  const within = plantsToUnresolvedCallbacks(episodePlants, episodeNumber).filter(
    (h) => !h.flags.some((f) => crossFlags.has(f)),
  );
  const merged = [...(crossEpisode ?? []), ...within];
  return merged.length > 0 ? merged : undefined;
}
