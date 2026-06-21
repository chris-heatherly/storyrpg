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

  // Load-bearing choice (most existing consequences) is the fallback target for
  // index-keyed seeds (`treatment_seed_ep3_4`) that carry no semantic content.
  let loadBearing = choices[0];
  let best = loadBearing.consequences?.length ?? 0;
  for (const choice of choices) {
    const n = choice.consequences?.length ?? 0;
    if (n > best) {
      best = n;
      loadBearing = choice;
    }
  }

  // Per-seed placement: a descriptively-named seed lands on the choice its text
  // matches; an index-keyed seed falls back to the load-bearing choice. (Previously
  // ALL seeds piled onto the load-bearing choice, which mis-bound seeds to unrelated
  // choices — gen-5 treatment_seed_ep3_4 attached to an Ileana choice.)
  for (const flag of pending) {
    const semanticIdx = bestSemanticChoiceIndex(flag, choices);
    const target = semanticIdx >= 0 ? choices[semanticIdx] : loadBearing;
    target.consequences = [...(target.consequences ?? []), ...buildTreatmentSeedConsequences([flag])];
  }
  return choices;
}

// ========================================
// BRANCH / ENDING-AXIS EMISSION
// ========================================

const BRANCH_AXIS_PREFIX = 'treatment_branch_';

/**
 * Resolve the ending-axis flags (`treatment_branch_*`) a scene's choices must
 * SET on-page, from the StoryArchitect-recorded `choicePoint.setsBranchAxes`.
 * Order-preserving, deduped, prefix-guarded. Mirrors
 * {@link resolveSceneTreatmentSeeds} but for the ending-axis channel.
 */
export function resolveSceneBranchAxes(scene: {
  choicePoint?: { setsBranchAxes?: string[] };
}): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const flag of scene.choicePoint?.setsBranchAxes ?? []) {
    if (typeof flag !== 'string' || !flag.startsWith(BRANCH_AXIS_PREFIX) || seen.has(flag)) continue;
    seen.add(flag);
    out.push(flag);
  }
  return out;
}

const SEMANTIC_MATCH_STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'vs', 'versus', 'none', 'new', 'not', 'a', 'an', 'of', 'or',
  'treatment', 'branch', 'seed', 'house', 'open', 'close', 'gentle', 'cruel', 'hard', 'line',
]);

/** Content tokens of a descriptive flag name (`treatment_branch_the_country_house_wine_…`). */
function flagSemanticTokens(flag: string): string[] {
  return flag
    .replace(/^treatment_(?:branch|seed)_/i, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 3 && !SEMANTIC_MATCH_STOPWORDS.has(t) && !/^\d+$/.test(t) && !/^ep\d*$/.test(t));
}

/** Reader-facing text a choice carries, for semantic affinity scoring. */
function choiceSemanticText(choice: Choice): string {
  return [
    choice.text,
    choice.memorableMoment?.summary,
    (choice.stakes as { want?: string; cost?: string; identity?: string } | undefined)?.want,
    (choice.stakes as { want?: string; cost?: string } | undefined)?.cost,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

/**
 * Index of the choice whose text best matches a descriptive flag's content tokens,
 * or -1 when no choice shares any token (an index-keyed flag like `treatment_seed_ep3_4`
 * has no content tokens → always -1, so callers fall back to their heuristic).
 */
export function bestSemanticChoiceIndex(flag: string, choices: Choice[]): number {
  const tokens = flagSemanticTokens(flag);
  if (tokens.length === 0) return -1;
  let bestIdx = -1;
  let bestScore = 0;
  choices.forEach((choice, idx) => {
    const text = choiceSemanticText(choice);
    const score = tokens.reduce((acc, t) => acc + (text.includes(t) ? 1 : 0), 0);
    if (score > bestScore) {
      bestScore = score;
      bestIdx = idx;
    }
  });
  return bestScore > 0 ? bestIdx : -1;
}

/**
 * Pipeline seam: deterministically emit `setFlag` consequences for this scene's
 * ending-axis flags so the season's named endings are mechanically REACHABLE.
 * SEMANTIC placement first: an axis whose descriptive name matches a choice's text
 * (e.g. `…_wine_a_new_appetite_vs_none` → the wine choice) is attached to THAT choice,
 * so the named decision lands where the fiction stages it instead of being smeared
 * round-robin onto an unrelated option (gen-5: the wine axis collapsed onto a rose
 * gesture). Axes with no semantic match fall back to round-robin and emit a warning so
 * the misplacement is visible. A no-op when no axes are declared; never duplicates.
 */
export function emitSceneBranchAxes(
  scene: { choicePoint?: { setsBranchAxes?: string[] }; id?: string },
  choices: Choice[],
): Choice[] {
  const axes = resolveSceneBranchAxes(scene);
  if (!choices.length || !axes.length) return choices;

  const alreadySet = new Set<string>();
  for (const choice of choices) {
    for (const c of choice.consequences ?? []) {
      if (c.type === 'setFlag' && typeof c.flag === 'string') alreadySet.add(c.flag);
    }
  }
  const pending = axes.filter((f) => !alreadySet.has(f));
  if (!pending.length) return choices;

  let roundRobin = 0;
  for (const flag of pending) {
    const semanticIdx = bestSemanticChoiceIndex(flag, choices);
    let choice: Choice;
    if (semanticIdx >= 0) {
      choice = choices[semanticIdx];
    } else {
      choice = choices[roundRobin % choices.length];
      roundRobin += 1;
      // Descriptive axes that find no matching choice were likely never authored as a
      // player-facing decision (the gen-5 wine-branch collapse). Surface it; the
      // on-page presence gate still guarantees the flag is SET, but its decision may
      // not be staged on the right choice.
      if (flagSemanticTokens(flag).length > 0) {
        console.warn(
          `[BranchAxes] Axis "${flag}" found no semantically-matching choice in scene ` +
            `"${scene.id ?? '(unknown)'}" — attaching round-robin. The treatment may declare a ` +
            `decision (e.g. drink/sip/refuse) that ChoiceAuthor did not author as a distinct choice.`
        );
      }
    }
    choice.consequences = [...(choice.consequences ?? []), { type: 'setFlag', flag, value: true }];
  }
  return choices;
}

/**
 * The detectable reveal flag for an INFO ledger entry. Format mirrors the
 * `info_<id>_reveal` convention the InformationLedgerScheduleValidator recognizes:
 * the flag contains the entry id and a `reveal` token, so its `referencesEntry` +
 * REVEAL_TOKEN detection matches it. Pure.
 */
export function infoRevealFlag(infoId: string): string {
  return `${infoId}_reveal`;
}

export function infoSetupFlag(infoId: string): string {
  return `${infoId}_setup`;
}

export function infoPayoffFlag(infoId: string): string {
  return `${infoId}_payoff`;
}

export function emitSceneInfoMarkers(
  scene: { setsUpInfoIds?: string[]; revealsInfoIds?: string[]; paysOffInfoIds?: string[]; id?: string },
  choices: Choice[],
): Choice[] {
  const markers = [
    ...(scene.setsUpInfoIds ?? []).map((id) => infoSetupFlag(id)),
    ...(scene.revealsInfoIds ?? []).map((id) => infoRevealFlag(id)),
    ...(scene.paysOffInfoIds ?? []).map((id) => infoPayoffFlag(id)),
  ].filter((flag): flag is string => Boolean(flag));
  if (!choices.length || markers.length === 0) return choices;

  const alreadySet = new Set<string>();
  for (const choice of choices) {
    for (const c of choice.consequences ?? []) {
      if (c.type === 'setFlag' && typeof c.flag === 'string') alreadySet.add(c.flag);
    }
  }

  let roundRobin = 0;
  for (const flag of markers) {
    if (alreadySet.has(flag)) continue;
    const choice = choices[roundRobin % choices.length];
    roundRobin += 1;
    choice.consequences = [...(choice.consequences ?? []), { type: 'setFlag', flag, value: true }];
    alreadySet.add(flag);
  }
  return choices;
}

/**
 * Step 3 (info-reveal): for a scene StoryArchitect assigned INFO reveals to
 * (`scene.revealsInfoIds`), set the detectable `<id>_reveal` flag via a setFlag
 * consequence on a choice, so InformationLedgerScheduleValidator can confirm the
 * reveal landed in this scene's episode. Mirrors emitSceneBranchAxes: idempotent
 * (skips flags already present), additive-only, and a no-op when the scene has no
 * assigned reveals or no choices. Returns the (possibly mutated) choices.
 */
export function emitSceneInfoReveals(
  scene: { revealsInfoIds?: string[]; id?: string },
  choices: Choice[],
): Choice[] {
  return emitSceneInfoMarkers(scene, choices);
}
