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
import type { Consequence, SetFlag } from '../../types/consequences';
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

// ========================================
// CONSEQUENCE-SEED EMITTERS (Treatment fidelity, §3.3)
// ========================================
//
// Authored consequence seeds (Section 9 of a treatment) are encoded by the
// SeasonPlannerAgent into a scene's `encounterSetupContext` as directives of the
// form `flag:treatment_seed_ep<N>_<idx> — <description>`. Until now those flags
// only ever appeared in READ/CHECK positions (preconditions surfaced to the
// encounter), so a downstream `treatment_seed_*` precondition could never be
// true — nothing on-page SET it. That broke authored cause→effect chains (e.g.
// "Darian's poison set" in Ep3 → the Ep4 trap precondition).
//
// These helpers close the loop deterministically: they read the `flag:` seed
// directives off the origin scene and emit a `setFlag` consequence so the seed is
// SET on-page, not only read. No LLM call, no templated prose.

const TREATMENT_SEED_PREFIX = 'treatment_seed_';

/**
 * Parse the authored consequence-seed flag NAMES out of a scene's
 * `encounterSetupContext` directives. Only `flag:treatment_seed_* — ...`
 * directives qualify; relationship/other directives are ignored. Returns unique,
 * order-preserving flag names.
 */
export function treatmentSeedFlagsFromSetupContext(setupContext: readonly string[] | undefined): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const directive of setupContext ?? []) {
    if (typeof directive !== 'string') continue;
    if (!directive.startsWith('flag:')) continue;
    const rest = directive.slice('flag:'.length);
    const dashIdx = rest.indexOf(' — ');
    const flagName = (dashIdx !== -1 ? rest.slice(0, dashIdx) : rest).trim();
    if (!flagName.startsWith(TREATMENT_SEED_PREFIX)) continue;
    if (seen.has(flagName)) continue;
    seen.add(flagName);
    out.push(flagName);
  }
  return out;
}

/**
 * Build the deterministic `setFlag` consequences for a set of authored seed
 * flags. Each becomes `{ type: 'setFlag', flag, value: true }`. Pure.
 */
export function buildTreatmentSeedConsequences(seedFlags: readonly string[]): SetFlag[] {
  return seedFlags.map((flag) => ({ type: 'setFlag', flag, value: true }));
}

/**
 * Emit the authored consequence seeds for the origin scene by ATTACHING a
 * deterministic `setFlag` consequence to a choice, so the seed is set on-page and
 * a later authored precondition referencing it can be satisfied (§3.3). Mutates
 * and returns the choices array.
 *
 * Placement rule (deterministic, no LLM): the seed is attached to the choice that
 * already carries the most consequences (the scene's "load-bearing" choice) — or
 * the first choice if none stand out. A seed flag already present on ANY choice is
 * not duplicated. Choices with no consequences array get one created.
 *
 * Call this once per origin scene after its choices are authored, passing the
 * seed flags resolved from the scene's `encounterSetupContext` (via
 * {@link treatmentSeedFlagsFromSetupContext}).
 */
/**
 * Resolve the authored treatment-seed flags a scene must SET, from both the
 * StoryArchitect-recorded sources: the choicePoint's `setsTreatmentSeeds` (the
 * explicit "this scene sets these seeds" list) and any `flag:treatment_seed_* — ...`
 * directive on the scene's `encounterSetupContext`. Order-preserving, deduped.
 */
export function resolveSceneTreatmentSeeds(scene: {
  choicePoint?: { setsTreatmentSeeds?: string[] };
  encounterSetupContext?: string[];
}): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (flag: string): void => {
    if (!flag.startsWith(TREATMENT_SEED_PREFIX) || seen.has(flag)) return;
    seen.add(flag);
    out.push(flag);
  };
  for (const flag of scene.choicePoint?.setsTreatmentSeeds ?? []) {
    if (typeof flag === 'string') push(flag);
  }
  for (const flag of treatmentSeedFlagsFromSetupContext(scene.encounterSetupContext)) {
    push(flag);
  }
  return out;
}

/**
 * Pipeline seam (§3.3 / GAP-C): given a freshly-authored scene's choice set and the
 * scene blueprint that declares its authored consequence seeds, deterministically
 * emit a `setFlag` for each seed onto a choice so the seed is SET on-page. One-line
 * call site in {@link FullStoryPipeline}. Returns the (mutated) choices; a no-op when
 * the scene declares no treatment seeds, so non-treatment runs are unaffected.
 */
export function emitSceneTreatmentSeeds(
  scene: { choicePoint?: { setsTreatmentSeeds?: string[] }; encounterSetupContext?: string[] },
  choices: Choice[],
): Choice[] {
  return emitTreatmentSeedConsequences(choices, resolveSceneTreatmentSeeds(scene));
}

export function emitTreatmentSeedConsequences(choices: Choice[], seedFlags: readonly string[]): Choice[] {
  if (!choices.length || !seedFlags.length) return choices;

  const alreadySet = new Set<string>();
  for (const choice of choices) {
    for (const c of choice.consequences ?? []) {
      if (c.type === 'setFlag' && typeof c.flag === 'string') alreadySet.add(c.flag);
    }
  }

  const pending = seedFlags.filter((f) => !alreadySet.has(f));
  if (!pending.length) return choices;

  // Pick the load-bearing choice: most existing consequences, else the first.
  let target = choices[0];
  let best = target.consequences?.length ?? 0;
  for (const choice of choices) {
    const n = choice.consequences?.length ?? 0;
    if (n > best) {
      best = n;
      target = choice;
    }
  }

  const next: Consequence[] = [...(target.consequences ?? []), ...buildTreatmentSeedConsequences(pending)];
  target.consequences = next;
  return choices;
}
