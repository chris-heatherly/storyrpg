// ========================================
// CALLBACK LEDGER
// ========================================
//
// Tracks "memorable moments" across episodes so later episodes can author
// TextVariants that reference earlier choices. Implements the Witcher-style
// delayed-consequence pattern.
//
// Shape:
//   - ChoiceAuthor / authors tag notable choices with a `memorableMoment`.
//   - FullStoryPipeline harvests those into the ledger at end of each episode.
//   - Before generating episode N+1, the ledger's unresolved hooks are injected
//     into SceneWriter / ChoiceAuthor prompts.
//   - When a SceneWriter emits a TextVariant with `callbackHookId`, the
//     pipeline records a payoff.
//   - A hook is `resolved` once its payoffCount exceeds a threshold (default 2).
//
// The ledger is pure data + pure transforms; I/O (read/write) is handled by
// FullStoryPipeline using the existing pipelineOutputWriter helpers.

import type { Choice } from '../../types/choice';
import type { ChoiceConsequenceTier, ChoiceImpactFactor } from '../../types/choice';
import type { TextVariant } from '../../types/content';
import { normalizeTintFlag } from '../utils/tintVocabulary';

export interface CallbackHook {
  id: string;
  sourceEpisode: number;
  sourceSceneId: string;
  sourceChoiceId: string;
  flags: string[];
  conditionKeys?: string[];
  impactFactors?: ChoiceImpactFactor[];
  consequenceTier?: ChoiceConsequenceTier;
  summary: string;
  payoffWindow: { minEpisode: number; maxEpisode: number };
  /**
   * Season Canon (P2): the SPECIFIC episode this promise is meant to pay off in,
   * so it can be enforced exactly when that episode runs (the promise-due gate)
   * rather than against a vague window. Populated from the season spine (P5);
   * when set it is authoritative and `payoffWindow` is derived from it. Optional
   * for back-compat with window-only hooks.
   */
  payoffEpisode?: number;
  payoffCount: number;
  resolved: boolean;
  /**
   * Season Canon (P5): a promise intentionally dropped (e.g. its path was never
   * taken, or the spine cut it). The season-completion gate treats abandoned the
   * same as paid — it just must not be silently left open.
   */
  abandoned?: boolean;
  abandonReason?: string;
  /**
   * Reader-facing prose the source choice authored (its `feedbackCue.echoSummary`
   * and `reminderPlan.immediate/shortTerm`), captured at registration so a
   * cross-episode deterministic payoff can be sourced WITHOUT the choice being in
   * the realizing episode's scope. The hook's own `summary` is planning-register
   * (a forward-promise directive — "In Episode 3, Mika will mention …") and must
   * never ship as prose; these are the clean fallbacks. See `pickCallbackProse`.
   */
  proseSources?: { echoSummary?: string; immediate?: string; shortTerm?: string };
  createdAt: string;
}

export interface LedgerConfig {
  // Number of distinct payoff references before a hook is marked resolved.
  payoffThreshold: number;
  // Default window (in episodes) during which hooks are eligible for payoff.
  defaultWindowSpan: number;
  // Cap on active (unresolved) hooks kept in prompts. Oldest get retired first.
  maxActiveHooks: number;
}

/**
 * Tone-callback (tint) hook id prefix. Personality `tint:` flags used to be
 * dropped entirely by {@link isStructuralFlag} (so 10 per season were write-only),
 * but a tint IS a real, in-fiction signal of how the player has been behaving and
 * deserves the occasional light acknowledgment. We track it as a LOWER-priority
 * "tone callback" under its own id namespace (`tone:<tint-name>`) so:
 *   - it is distinct from a `flag:`/`score:` narrative hook in `unresolvedFor`
 *     ordering (tone hooks sort AFTER narrative hooks so they never crowd out a
 *     real payoff — see {@link CallbackLedger.unresolvedFor}); and
 *   - its hook id is NOT itself `tint:`-prefixed, so `isStructuralFlag` (and the
 *     promise-ledger dangling gate / SceneWriter strip that lean on it) still
 *     treat a raw `tint:` callbackHookId from the LLM as a non-ledger mislabel,
 *     exactly as before. The deterministic injector plants the `tone:` hook and
 *     tags the variant with it, so a tone payoff resolves to a real ledger hook.
 */
export const TONE_HOOK_PREFIX = 'tone:';

type CallbackHookInput = Omit<
  CallbackHook,
  'payoffCount' | 'resolved' | 'createdAt' | 'conditionKeys' | 'impactFactors' | 'consequenceTier'
> & {
  conditionKeys?: string[];
  impactFactors?: ChoiceImpactFactor[];
  consequenceTier?: ChoiceConsequenceTier;
  payoffCount?: number;
  resolved?: boolean;
  createdAt?: string;
};

export const DEFAULT_LEDGER_CONFIG: LedgerConfig = {
  payoffThreshold: 2,
  defaultWindowSpan: 3,
  // Raised from 10 so a meaningful fraction of the ~38 flags a season sets can
  // surface across an episode (they were write-only — only ~9 ever referenced).
  // This is the SIZE of the active pool fed to prompts / the deterministic
  // injector; flooding a single scene is prevented separately by the per-scene
  // injection cap in `injectFallbackCallbacks`, not by this number.
  maxActiveHooks: 24,
};

/**
 * Canonicalize a raw `callbackHookId` to a ledger id given a predicate that
 * knows which ids exist. Flag/score hooks are keyed `flag:<name>` / `score:<name>`,
 * but agents routinely mismatch the prefix BOTH ways:
 *   - drop it: tag a payoff with the BARE flag name (`treatment_seed_ep1_3`) instead
 *     of the planted id (`flag:treatment_seed_ep1_3`); or
 *   - add a spurious one: tag a payoff for a BARE callback-hook promise
 *     (`accepted-stelas-protection`) as `flag:accepted-stelas-protection` (bite-me-g14
 *     ep3 Season Canon abort: the ledger holds the bare hook, so the prefixed ref
 *     resolved to nothing).
 * In either case the intended hook is the one form (bare or `flag:`/`score:`-prefixed)
 * that the ledger actually knows — return it. When neither form is known the id is
 * returned unchanged (a genuinely unknown id stays as-is so it can still be flagged
 * dangling downstream).
 *
 * Pure: shared by the ledger's own `resolveHookId` (closure over its hook map) and
 * by agents that only know the prompt's hook-id set (e.g. SceneWriter), so the bare
 * id is canonicalized at the point textVariants are parsed, not just at the seam.
 */
export function canonicalizeHookId(rawId: string, isKnownHookId: (id: string) => boolean): string {
  if (!rawId || isKnownHookId(rawId)) return rawId;
  // Missing prefix: a bare name whose planted hook is `flag:`/`score:`-prefixed.
  for (const prefix of ['flag:', 'score:']) {
    if (isKnownHookId(prefix + rawId)) return prefix + rawId;
  }
  // Spurious prefix: a `flag:`/`score:` ref whose planted hook is registered BARE
  // (an agent prefixed a narrative callback-hook id that is not a state flag).
  for (const prefix of ['flag:', 'score:']) {
    if (rawId.startsWith(prefix)) {
      const bare = rawId.slice(prefix.length);
      if (isKnownHookId(bare)) return bare;
    }
  }
  return rawId;
}

/**
 * A flag whose name is COSMETIC (`tint:`) or STRUCTURAL (`route_`,
 * `treatment_branch_`, `encounter_<id>_<outcome>`) rather than a trackable
 * callback promise. The ledger never registers these (see `recordFlagSet` /
 * `trackableFlagsOf`): a `route_`/branch flag records which divergent path the
 * player took, and an `encounter_*` flag records how an encounter resolved
 * (seeded by seedEncounterOutcomeFlags / EncounterArchitect `setsFlags`) —
 * both are paid off BY CONSTRUCTION via the branch + reconvergence residue
 * (a textVariant gated on the flag), not as a cross-episode callback line. So
 * a `callbackHookId` pointing at one of these is always a mislabel — it can
 * never resolve to a ledger hook (bite-me-g13 2026-06-12T18-45: SceneWriter
 * authored correct outcome residue in s1-5 but copied the gating flag
 * `encounter_treatment-enc-1-1_partialVictory` into callbackHookId → Season
 * Canon dangling-payoff abort). Accepts the bare flag name or a
 * `flag:`-prefixed hook id.
 */
export function isStructuralFlag(flagOrHookId: string): boolean {
  const flag = flagOrHookId.startsWith('flag:') ? flagOrHookId.slice('flag:'.length) : flagOrHookId;
  return (
    flag.startsWith('tint:') ||
    flag.startsWith('route_') ||
    flag.startsWith('treatment_branch_') ||
    flag.startsWith('encounter_')
  );
}

/**
 * A cosmetic personality `tint:` flag (`tint:mercy`, `tint:boldness`, …). These
 * stay STRUCTURAL for {@link isStructuralFlag} (so the dangling-payoff gate and
 * the SceneWriter strip keep treating a raw `tint:` callbackHookId as a non-ledger
 * mislabel — the LLM is told not to tag them). But — unlike `route_`/branch/
 * `encounter_` flags, which are paid off BY CONSTRUCTION — a tint records a
 * recurring behavioral lean worth a light periodic acknowledgment, so we DO track
 * it, as a lower-priority "tone callback" under the `tone:` hook namespace. See
 * {@link recordTintSet} / {@link trackableTintsOf}.
 */
export function isTintFlag(flag: string): boolean {
  const bare = flag.startsWith('flag:') ? flag.slice('flag:'.length) : flag;
  return bare.startsWith('tint:');
}

/** True when a hook is a (lower-priority) tone callback seeded from a `tint:` flag. */
function isToneHook(hook: CallbackHook): boolean {
  return hook.id.startsWith(TONE_HOOK_PREFIX);
}

export interface SerializedCallbackLedger {
  version: 1;
  storyId?: string;
  hooks: CallbackHook[];
  config: LedgerConfig;
  /** Beat-level payoff dedupe keys (`<beatKey>::<hookId>`) already credited. */
  creditedVariantBeats?: string[];
}

export class CallbackLedger {
  private hooks = new Map<string, CallbackHook>();
  /** Beat-level payoff dedupe: `<beatKey>::<hookId>` entries already credited. */
  private creditedVariantBeats = new Set<string>();
  private config: LedgerConfig;
  private storyId?: string;

  constructor(options?: { storyId?: string; config?: Partial<LedgerConfig> }) {
    this.storyId = options?.storyId;
    this.config = { ...DEFAULT_LEDGER_CONFIG, ...(options?.config ?? {}) };
  }

  /**
   * Add a new hook. If an id already exists, updates flags/summary but
   * preserves payoff state and createdAt.
   */
  add(hook: CallbackHookInput): CallbackHook {
    const existing = this.hooks.get(hook.id);
    // An explicit payoffEpisode (from the season spine) is authoritative: when
    // present it pins the window's start to that exact episode and is never lost
    // on a later merge that omits it.
    const payoffEpisode = hook.payoffEpisode ?? existing?.payoffEpisode;
    const payoffWindow =
      payoffEpisode != null
        ? { minEpisode: payoffEpisode, maxEpisode: Math.max(payoffEpisode, hook.payoffWindow.maxEpisode) }
        : hook.payoffWindow;
    const merged: CallbackHook = {
      ...hook,
      payoffEpisode,
      payoffWindow,
      payoffCount: existing?.payoffCount ?? hook.payoffCount ?? 0,
      resolved: existing?.resolved ?? hook.resolved ?? false,
      createdAt: existing?.createdAt ?? hook.createdAt ?? new Date().toISOString(),
      flags: Array.from(new Set([...(existing?.flags ?? []), ...hook.flags])),
      conditionKeys: Array.from(new Set([
        ...(existing?.conditionKeys ?? []),
        ...(hook.conditionKeys ?? []),
        ...hook.flags,
      ])),
      impactFactors: hook.impactFactors ?? existing?.impactFactors ?? [],
      consequenceTier: hook.consequenceTier ?? existing?.consequenceTier ?? 'callback',
      proseSources: hook.proseSources ?? existing?.proseSources,
    };
    this.hooks.set(hook.id, merged);
    return merged;
  }

  /**
   * Register a choice's memorableMoment as a callback hook. Returns the hook
   * if one was created (or undefined when the choice had no memorableMoment).
   */
  recordChoice(params: {
    choice: Choice;
    episode: number;
    sceneId: string;
  }): CallbackHook | undefined {
    const moment = params.choice.memorableMoment;
    if (!moment?.id || !moment?.summary) return undefined;

    // G12: ChoiceAuthor emits generic moment ids ("choice-1"), so hooks from
    // DIFFERENT episodes'/scenes' choices merged into one (later:choice-1 carried
    // 14 flags spanning three episodes) and sibling-crediting marked unread flags
    // resolved. Qualify the id when it would collide with a different source;
    // an exact same-source re-record (resume/idempotent re-run) still merges.
    const existing = this.hooks.get(moment.id);
    const collides = existing
      && (existing.sourceEpisode !== params.episode
        || existing.sourceSceneId !== params.sceneId
        || existing.sourceChoiceId !== params.choice.id);
    const hookId = collides ? `${moment.id}@ep${params.episode}:${params.sceneId}` : moment.id;

    return this.add({
      id: hookId,
      sourceEpisode: params.episode,
      sourceSceneId: params.sceneId,
      sourceChoiceId: params.choice.id,
      flags: moment.flags ?? this.inferFlagsFromChoice(params.choice),
      conditionKeys: moment.flags ?? this.inferFlagsFromChoice(params.choice),
      impactFactors: params.choice.impactFactors ?? [],
      consequenceTier: params.choice.consequenceTier ?? this.inferConsequenceTier(params.choice),
      summary: moment.summary,
      proseSources: this.proseSourcesOf(params.choice),
      payoffWindow: {
        minEpisode: params.episode + 1,
        maxEpisode: params.episode + this.config.defaultWindowSpan,
      },
    });
  }

  /**
   * Seed a lightweight callback hook for a single trackable flag a choice sets
   * (1.1). Unlike `recordChoice` — which only seeds `memorableMoment`-tagged
   * choices — this brings ordinary `setFlag` consequences into the ledger so
   * they enter the inject -> payoff loop and stop shipping as unread debt.
   *
   * Cosmetic (`tint:`) and structural (`route_`) flags are skipped, as are
   * flag clears. Returns the hook, or undefined when the flag isn't trackable.
   * The hook id is keyed on the flag so repeated sets of the same flag merge.
   */
  recordFlagSet(params: {
    choice: Choice;
    flag: string;
    episode: number;
    sceneId: string;
  }): CallbackHook | undefined {
    const { flag } = params;
    if (!flag || isStructuralFlag(flag)) return undefined;
    const summary = params.choice.memorableMoment?.summary
      || (params.choice.text ? `Earlier choice: "${params.choice.text}" (sets ${flag}).` : `An earlier choice set ${flag}.`);
    return this.add({
      id: `flag:${flag}`,
      sourceEpisode: params.episode,
      sourceSceneId: params.sceneId,
      sourceChoiceId: params.choice.id,
      flags: [flag],
      conditionKeys: [flag],
      impactFactors: params.choice.impactFactors ?? [],
      consequenceTier: 'callback',
      summary,
      proseSources: this.proseSourcesOf(params.choice),
      payoffWindow: {
        // Eligible from the setting episode onward (same-episode payoff allowed).
        minEpisode: params.episode,
        maxEpisode: params.episode + this.config.defaultWindowSpan,
      },
    });
  }

  /**
   * Seed a callback hook for a single score a choice moves (`setScore` /
   * `changeScore`). The mirror of {@link recordFlagSet} for the score axis: a
   * SceneWriter can emit a TextVariant keyed on `score:<name>` (e.g. a beat that
   * fires when `thorne_loyalty` is high), and without a planted promise that payoff
   * is "dangling" and trips the Season-Canon promise gate. The hook id is keyed on
   * the score (`score:<name>`) so repeated moves of the same score merge.
   */
  recordScoreSet(params: {
    choice: Choice;
    score: string;
    episode: number;
    sceneId: string;
  }): CallbackHook | undefined {
    const { score } = params;
    if (!score) return undefined;
    const summary = params.choice.memorableMoment?.summary
      || (params.choice.text ? `Earlier choice: "${params.choice.text}" (moved ${score}).` : `An earlier choice moved ${score}.`);
    return this.add({
      id: `score:${score}`,
      sourceEpisode: params.episode,
      sourceSceneId: params.sceneId,
      sourceChoiceId: params.choice.id,
      flags: [],
      conditionKeys: [`score:${score}`],
      impactFactors: params.choice.impactFactors ?? [],
      consequenceTier: 'branchlet',
      summary,
      proseSources: this.proseSourcesOf(params.choice),
      payoffWindow: {
        minEpisode: params.episode,
        maxEpisode: params.episode + this.config.defaultWindowSpan,
      },
    });
  }

  /**
   * Seed a LOWER-priority "tone callback" hook for a cosmetic `tint:` flag a
   * choice sets (`tint:mercy`, `tint:boldness`, …). Tints used to be dropped by
   * {@link recordFlagSet} (via `isStructuralFlag`), so the ~10 personality flags a
   * season sets were write-only — never acknowledged in later prose. This brings
   * them into the inject->payoff loop as a distinct, de-prioritized category:
   *   - the hook id is `tone:<tint-name>` (NOT `tint:`-prefixed), so it is a real
   *     ledger hook the injector can tag and the dangling gate won't reject; while
   *   - `unresolvedFor` sorts tone hooks AFTER narrative hooks so they never crowd
   *     out a real flag/promise payoff (and the per-scene injection cap keeps tone
   *     acknowledgments sparse so prose doesn't get repetitive).
   * Tier `sceneTint`. Keyed on the tint name so repeated sets merge. Returns the
   * hook, or undefined when `flag` is not a `tint:` flag.
   */
  recordTintSet(params: {
    choice: Choice;
    flag: string;
    episode: number;
    sceneId: string;
  }): CallbackHook | undefined {
    const { flag } = params;
    if (!flag || !isTintFlag(flag)) return undefined;
    const tone = flag.slice('tint:'.length); // e.g. "mercy"
    return this.add({
      id: `${TONE_HOOK_PREFIX}${tone}`,
      sourceEpisode: params.episode,
      sourceSceneId: params.sceneId,
      sourceChoiceId: params.choice.id,
      // Gate the acknowledgment on the real runtime `tint:` flag (what the engine
      // actually sets); the hook id is the de-prioritized `tone:` namespace.
      flags: [flag],
      conditionKeys: [flag],
      impactFactors: params.choice.impactFactors ?? [],
      consequenceTier: 'sceneTint',
      // A clean in-fiction summary derived from the tone — never a raw-flag stub —
      // so the injector's prose fallback (pickCallbackProse) has a safe candidate.
      summary: toneAcknowledgmentProse(tone),
      proseSources: this.proseSourcesOf(params.choice),
      payoffWindow: {
        // Eligible from the setting episode onward (same-episode payoff allowed).
        minEpisode: params.episode,
        maxEpisode: params.episode + this.config.defaultWindowSpan,
      },
    });
  }

  /**
   * Cosmetic `tint:` flags a choice sets (the tone-callback axis of
   * {@link trackableFlagsOf}, which deliberately EXCLUDES them). Set, not cleared.
   */
  trackableTintsOf(choice: Choice): string[] {
    const tints = new Set<string>();
    if (typeof choice.tintFlag === 'string') {
      const normalized = normalizeTintFlag(choice.tintFlag);
      if (isTintFlag(normalized)) tints.add(normalized);
    }
    for (const consequence of choice.consequences ?? []) {
      if (
        consequence.type === 'setFlag' &&
        typeof consequence.flag === 'string' &&
        isTintFlag(consequence.flag) &&
        consequence.value !== false
      ) {
        tints.add(normalizeTintFlag(consequence.flag));
      }
    }
    return [...tints];
  }

  /**
   * Register a forward-promise written into a choice's `reminderPlan.later`
   * ("In Episode 2 … the photo appears in the blog's sidebar"). gen-5: these were
   * authored but never reconciled, so a promise naming a generated episode shipped
   * broken. Planting a hook (with the named `payoffEpisode` when one was parsed)
   * brings the promise into the inject -> payoff loop so it can be realized — and the
   * Season-Canon / schedule gates can detect a same-season miss. Keyed on the choice
   * id so repeated harvests of the same promise merge.
   */
  recordForwardPromise(params: {
    choice: Choice;
    episode: number;
    sceneId: string;
    summary: string;
    payoffEpisode?: number;
  }): CallbackHook | undefined {
    const { choice, episode, sceneId, summary, payoffEpisode } = params;
    if (!summary || summary.trim().length === 0) return undefined;
    // Carry the choice's gating flag(s) onto the forward-promise hook. Without them the
    // hook was flagless, so a CONDITIONAL cross-episode payoff (this promise only applies
    // if the player took this choice — e.g. `accepted_mika_key_card`) could not be
    // authored: the inject->payoff loop had no flag to surface and the later SceneWriter
    // could not gate the acknowledgment, so it shipped none and promise-due hard-failed.
    // With the flag attached, the promise enters the same realization path as flag-set
    // hooks: ep N's SceneWriter authors a flag-conditional textVariant tagged with this
    // hook id, which records the payoff. (`add()` folds flags into conditionKeys.)
    const flags = this.trackableFlagsOf(choice);
    return this.add({
      id: `later:${choice.id}`,
      sourceEpisode: episode,
      sourceSceneId: sceneId,
      sourceChoiceId: choice.id,
      flags,
      conditionKeys: [],
      impactFactors: choice.impactFactors ?? [],
      consequenceTier: 'callback',
      summary: summary.trim(),
      proseSources: this.proseSourcesOf(choice),
      payoffEpisode,
      payoffWindow:
        payoffEpisode != null
          ? { minEpisode: payoffEpisode, maxEpisode: payoffEpisode }
          : { minEpisode: episode + 1, maxEpisode: episode + this.config.defaultWindowSpan },
    });
  }

  /**
   * Trackable scores a choice moves: the score names of its `setScore` /
   * `changeScore` consequences. The score axis of {@link trackableFlagsOf}.
   */
  trackableScoresOf(choice: Choice): string[] {
    const scores: string[] = [];
    for (const consequence of choice.consequences ?? []) {
      if (
        (consequence.type === 'setScore' || consequence.type === 'changeScore') &&
        typeof (consequence as { score?: unknown }).score === 'string' &&
        (consequence as { score: string }).score.length > 0
      ) {
        scores.push((consequence as { score: string }).score);
      }
    }
    return scores;
  }

  /**
   * Trackable flags a choice sets: `setFlag` consequences that are neither
   * cosmetic (`tint:`) nor structural (`route_` / `treatment_branch_`), and that
   * set rather than clear the flag. Mirrors ChoiceAuthor.setsTrackableFlag.
   * `treatment_branch_*` is structural BRANCH-tier divergence (W5.2), paid off by
   * the branch + reconvergence residue — not a callback line — so it is excluded.
   */
  /**
   * Capture the choice's reader-facing prose (echo + immediate/short-term
   * reminders) so a later episode's deterministic fallback can realize this hook
   * without the source choice being in scope. Returns undefined when the choice
   * authored no usable prose. See {@link CallbackHook.proseSources}.
   */
  private proseSourcesOf(choice: Choice): CallbackHook['proseSources'] {
    const echoSummary = choice.feedbackCue?.echoSummary;
    const immediate = choice.reminderPlan?.immediate;
    const shortTerm = choice.reminderPlan?.shortTerm;
    if (!echoSummary && !immediate && !shortTerm) return undefined;
    return { echoSummary, immediate, shortTerm };
  }

  trackableFlagsOf(choice: Choice): string[] {
    const flags: string[] = [];
    for (const consequence of choice.consequences ?? []) {
      if (
        consequence.type === 'setFlag' &&
        typeof consequence.flag === 'string' &&
        !isStructuralFlag(consequence.flag) &&
        consequence.value !== false
      ) {
        flags.push(consequence.flag);
      }
    }
    return flags;
  }

  /**
   * Trackable flags a choice sets via its DELAYED consequences (not its immediate
   * `consequences`). `trackableFlagsOf` only reads immediate consequences, so a
   * delayed `setFlag` (e.g. the Mika-betrayal seeds `mika_invented_cover_story`,
   * `mika_reported_roses_to_victor`) never entered the ledger and shipped as a
   * truly-dead flag — set, registered nowhere, never read in a later episode
   * (gen-5 audit). Same cosmetic/structural exclusions as the immediate axis.
   */
  trackableDelayedFlagsOf(choice: Choice): string[] {
    const flags: string[] = [];
    for (const delayed of choice.delayedConsequences ?? []) {
      const consequence = delayed?.consequence;
      if (
        consequence &&
        consequence.type === 'setFlag' &&
        typeof consequence.flag === 'string' &&
        !isStructuralFlag(consequence.flag) &&
        consequence.value !== false
      ) {
        flags.push(consequence.flag);
      }
    }
    return flags;
  }

  private inferConsequenceTier(choice: Choice): ChoiceConsequenceTier {
    if (choice.nextSceneId) return 'branchlet';
    if (choice.tintFlag) return 'sceneTint';
    if (choice.choiceType === 'expression' || choice.choiceIntent === 'flavor') return 'callback';
    if ((choice.consequences ?? []).some((c) => c.type === 'addItem' || c.type === 'removeItem' || c.type === 'setScore')) {
      return 'branchlet';
    }
    return 'callback';
  }

  /**
   * Best-effort flag inference: if no flags were declared on the
   * memorableMoment, pull them from the choice's `setFlag` consequences.
   */
  private inferFlagsFromChoice(choice: Choice): string[] {
    const flags: string[] = [];
    for (const consequence of choice.consequences ?? []) {
      if (consequence.type === 'setFlag' && typeof consequence.flag === 'string') {
        flags.push(consequence.flag);
      }
    }
    return flags;
  }

  /**
   * Record that a hook was referenced by a TextVariant (or similar payoff).
   * Auto-resolves when payoffCount >= payoffThreshold.
   */
  recordPayoff(hookId: string): CallbackHook | undefined {
    // Canonicalize first: a caller may pass a prefix-drifted id (bare vs `flag:`/
    // `score:`) — resolveHookId maps it to the planted hook (and is a no-op for an
    // already-canonical or genuinely-unknown id), so the payoff isn't dropped silently.
    const hook = this.hooks.get(this.resolveHookId(hookId));
    if (!hook) return undefined;
    hook.payoffCount += 1;
    if (hook.payoffCount >= this.config.payoffThreshold) {
      hook.resolved = true;
    }
    return hook;
  }

  /** Collect every flag name referenced by a condition expression (flag/and/or/not). */
  private flagsInCondition(cond: unknown, out: Set<string> = new Set<string>()): Set<string> {
    if (!cond || typeof cond !== 'object') return out;
    const c = cond as { type?: string; flag?: string; conditions?: unknown[]; condition?: unknown };
    if (c.type === 'flag' && typeof c.flag === 'string') out.add(c.flag);
    if (Array.isArray(c.conditions)) for (const sub of c.conditions) this.flagsInCondition(sub, out);
    if (c.condition) this.flagsInCondition(c.condition, out);
    return out;
  }

  /**
   * Scan a set of TextVariants and record a payoff for the hooks they honor. A hook is
   * credited when:
   *   1. the variant's `callbackHookId` names it (direct reference); OR
   *   2. the variant's CONDITION is gated on a flag the hook carries (a flag-conditional
   *      acknowledgment pays off every hook gated on that flag — incl. untagged variants);
   * and in either case its SAME-`sourceChoiceId` siblings are credited too. The last
   * point fixes the Season-Canon false positive where a choice spawns BOTH a flag-set
   * hook (`flag:<flag>`) and a forward-promise hook (`later:<choice>`) for the same
   * decision: honoring the flag on-page paid the flag hook but left the promise hook
   * "never referenced", even though the decision WAS acknowledged. Returns matched ids.
   *
   * `dedupeKey` (when provided) identifies the BEAT these variants came from
   * (`<episode>:<sceneId>:<beatId>`); a hook is credited at most once per beat, so
   * crediting can run per-scene DURING generation (later scenes in the same episode
   * see up-to-date payoff counts) and the end-of-episode harvest re-running over the
   * same beats is a no-op instead of double-counting toward the resolve threshold.
   */
  recordPayoffsFromVariants(variants: TextVariant[] | undefined, dedupeKey?: string): string[] {
    if (!variants) return [];
    const matched: string[] = [];
    for (const variant of variants) {
      const credited = new Set<string>();
      const credit = (hookId: string): void => {
        const hook = this.hooks.get(hookId);
        if (!hook || credited.has(hookId)) return;
        if (dedupeKey) {
          const beatKey = `${dedupeKey}::${hookId}`;
          if (this.creditedVariantBeats.has(beatKey)) return;
          this.creditedVariantBeats.add(beatKey);
        }
        this.recordPayoff(hookId);
        matched.push(hookId);
        credited.add(hookId);
        // Same decision → credit the choice's other hooks (e.g. the `later:<choice>`
        // forward promise when its `flag:<flag>` twin is honored). G12: "same
        // decision" requires same episode AND scene, not just a (generic) choice id
        // — `choice-1` exists in every scene, and id-only matching credited
        // unrelated episodes' hooks as resolved.
        if (hook.sourceChoiceId) {
          for (const sib of this.hooks.values()) {
            if (
              sib.id !== hookId &&
              sib.sourceChoiceId === hook.sourceChoiceId &&
              sib.sourceEpisode === hook.sourceEpisode &&
              sib.sourceSceneId === hook.sourceSceneId
            ) credit(sib.id);
          }
        }
      };

      // 1. Direct hook reference (canonicalized: a bare `flag`/`score` name tags
      // its planted `flag:`/`score:`-prefixed hook).
      if (variant.callbackHookId) {
        const refId = this.resolveHookId(variant.callbackHookId);
        if (this.hooks.has(refId)) credit(refId);
      }
      // 2. Flag-conditional payoff: credit every hook gated on a flag the variant checks.
      const flags = this.flagsInCondition((variant as { condition?: unknown }).condition);
      if (flags.size > 0) {
        for (const hook of this.hooks.values()) {
          if (credited.has(hook.id)) continue;
          const keys = [...(hook.flags ?? []), ...(hook.conditionKeys ?? [])];
          if (keys.some((k) => flags.has(k))) credit(hook.id);
        }
      }
    }
    return matched;
  }

  /**
   * Return unresolved hooks eligible for payoff in the given episode,
   * oldest first, capped at maxActiveHooks.
   *
   * Hooks EXPLICITLY due this episode (`payoffEpisode === episode`) are hard
   * obligations the promise-due gate enforces uncapped via {@link dueAt}. They
   * are surfaced FIRST and never dropped by the cap: otherwise a forward promise
   * (e.g. `later:choice-write-magnolia-column`, due to pay off this episode) could
   * be starved out of the realization path by lower-priority window-only flag
   * hooks — invisible to both the prompt feed and the deterministic fallback —
   * while `dueAt` still hard-fails the episode. The window-only remainder fills
   * the rest of the budget oldest-first. (Bite-Me G13: 11 window hooks pushed the
   * due magnolia promise to slice index 11 > cap 10, so it was never realized.)
   */
  unresolvedFor(episode: number): CallbackHook[] {
    const eligible = Array.from(this.hooks.values()).filter(
      (hook) =>
        !hook.resolved &&
        hook.payoffWindow.minEpisode <= episode &&
        hook.payoffWindow.maxEpisode >= episode,
    );
    const due = eligible.filter((hook) => hook.payoffEpisode === episode);
    const rest = eligible
      .filter((hook) => hook.payoffEpisode !== episode)
      // Tone (`tint:`) callbacks are de-prioritized: they sort AFTER narrative
      // hooks (flag/score/promise) so a tone acknowledgment never crowds a real
      // payoff out of the capped active pool. Within each band, oldest first.
      .sort((a, b) => {
        const toneDelta = Number(isToneHook(a)) - Number(isToneHook(b));
        if (toneDelta !== 0) return toneDelta;
        return a.sourceEpisode - b.sourceEpisode;
      });
    return [...due, ...rest].slice(0, Math.max(this.config.maxActiveHooks, due.length));
  }

  /**
   * Every hook currently tracked (resolved + unresolved). Useful for validators
   * and UI.
   */
  all(): CallbackHook[] {
    return Array.from(this.hooks.values());
  }

  size(): number {
    return this.hooks.size;
  }

  /** Whether a hook id exists (for dangling-payoff detection). */
  has(hookId: string): boolean {
    return this.hooks.has(hookId);
  }

  /**
   * Canonicalize a raw `callbackHookId` to the ledger's id scheme so the
   * dangling-payoff gate doesn't abort on a prefix mismatch and the payoff credits
   * the real planted hook. Delegates to the pure {@link canonicalizeHookId} (closing
   * over this ledger's hook map); see that helper for the bare-flag-name rationale.
   */
  resolveHookId(rawId: string): string {
    return canonicalizeHookId(rawId, (id) => this.hooks.has(id));
  }

  /**
   * Season Canon (P2): pin a hook's explicit payoff episode (from the season
   * spine). Re-derives the window so `unresolvedFor` surfaces it at the right
   * time. No-op if the hook is unknown. Returns the updated hook.
   */
  setPayoffEpisode(hookId: string, payoffEpisode: number, latestEpisode?: number): CallbackHook | undefined {
    const hook = this.hooks.get(hookId);
    if (!hook) return undefined;
    hook.payoffEpisode = payoffEpisode;
    hook.payoffWindow = {
      minEpisode: payoffEpisode,
      maxEpisode: Math.max(payoffEpisode, latestEpisode ?? hook.payoffWindow.maxEpisode),
    };
    return hook;
  }

  /**
   * Promises explicitly targeted to pay off in `episode` that are still open
   * (unresolved). The promise-due gate enforces these MUST be paid in `episode`.
   */
  dueAt(episode: number): CallbackHook[] {
    return Array.from(this.hooks.values()).filter(
      (hook) => hook.payoffEpisode === episode && !hook.resolved,
    );
  }

  /** Hooks carrying an explicit payoffEpisode target (for plant-validity). */
  withExplicitTarget(): CallbackHook[] {
    return Array.from(this.hooks.values()).filter((hook) => hook.payoffEpisode != null);
  }

  /**
   * Season Canon (P5): intentionally drop a promise so the completion gate doesn't
   * flag it as silently-open. No-op if the hook is unknown.
   */
  abandon(hookId: string, reason: string): CallbackHook | undefined {
    const hook = this.hooks.get(hookId);
    if (!hook) return undefined;
    hook.abandoned = true;
    hook.abandonReason = reason;
    return hook;
  }

  /** Hooks that are neither resolved nor abandoned (still owed). */
  stillOpen(): CallbackHook[] {
    return Array.from(this.hooks.values()).filter((hook) => !hook.resolved && !hook.abandoned);
  }

  serialize(): SerializedCallbackLedger {
    return {
      version: 1,
      storyId: this.storyId,
      hooks: Array.from(this.hooks.values()),
      config: this.config,
      creditedVariantBeats: Array.from(this.creditedVariantBeats),
    };
  }

  static deserialize(raw: SerializedCallbackLedger | string): CallbackLedger {
    const parsed: SerializedCallbackLedger = typeof raw === 'string' ? JSON.parse(raw) : raw;
    const ledger = new CallbackLedger({
      storyId: parsed.storyId,
      config: parsed.config,
    });
    for (const hook of parsed.hooks ?? []) {
      ledger.hooks.set(hook.id, normalizeHook(hook));
    }
    for (const key of parsed.creditedVariantBeats ?? []) {
      ledger.creditedVariantBeats.add(key);
    }
    return ledger;
  }
}

/**
 * A short, clean, in-fiction acknowledgment of a recurring `tint:` behavioral
 * lean, used as a tone hook's `summary` (and so as the injector's deterministic
 * prose fallback). Deliberately:
 *   - names NO scene/flag/episode and contains no system math, so it passes the
 *     meta-prose / fallback-stub reject filters cleanly; and
 *   - keys off the tone WORD so different tints read differently (mercy vs.
 *     boldness), and the per-scene injection cap keeps any single page sparse —
 *     together these are the anti-repetition guard.
 * Unknown/unmapped tones fall back to a generic-but-clean line.
 */
export function toneAcknowledgmentProse(tone: string): string {
  const word = (tone || '').replace(/[-_]+/g, ' ').trim().toLowerCase();
  // A small curated map for the common ChoiceAuthor tints (see ChoiceAuthor's
  // tint vocabulary). Each is a fragment of behavioral continuity, not a recap.
  const lines: Record<string, string> = {
    mercy: 'There is a softness in how you move now — the kind that spares before it strikes.',
    compassion: 'You carry the habit of gentleness into the room with you.',
    forgiveness: 'You have let things go before; it shows in how lightly you hold this.',
    justice: 'You weigh this the way you weigh everything lately — by what is owed.',
    punishment: 'You have a reckoner\'s eye now, quick to mark what must be answered for.',
    vengeance: 'Something in you keeps its own ledger, and it has not forgotten.',
    idealism: 'You still reach for the better version of things, even here.',
    pragmatism: 'You take the measure of what will actually work, the way you have learned to.',
    sacrifice: 'You have given things up before; the willingness sits ready in you.',
    survival: 'You move like someone who has learned what it costs to keep going.',
    honor: 'You hold to your own line, the way you have all along.',
    expedience: 'You reach for the shortest path, as has become your habit.',
    caution: 'You step the way you have been stepping lately — carefully, watching the ground.',
    boldness: 'You move first, the way you have been moving — sure, ahead of the doubt.',
    patience: 'You let the moment come to you, unhurried as you have become.',
    aggression: 'You press, the way you have been pressing — forward, leaving no slack.',
    diplomacy: 'You reach for the words before the blade, as you have been doing.',
    force: 'You lead with weight now; it has become the shape of you.',
    independence: 'You keep your own counsel, the way you have learned to.',
    leadership: 'Others look to you now — a thing you have made true, choice by choice.',
    teamwork: 'You move with the others in mind, the way you have come to.',
    solitude: 'You keep to your own edges, as has become your way.',
    emotion: 'You let yourself feel it through, the way you have stopped apologizing for.',
    logic: 'You reason it out cool and clean, as you have been doing.',
    intuition: 'You trust the pull in your gut, the way it has earned.',
    honesty: 'You tell it straight now; it has become reflex.',
    truth: 'You hold to the plain fact of things, as you have all along.',
    deception: 'You keep a second face ready, the way you have learned to.',
    manipulation: 'You read the angles first now — an old habit, well practiced.',
  };
  if (lines[word]) return lines[word];
  // Clean generic fallback for an unmapped tone — still scrubs the system origin.
  return word
    ? `The ${word} in how you have been moving carries into this moment too.`
    : 'The way you have been carrying yourself follows you into this moment.';
}

function normalizeHook(hook: CallbackHook): CallbackHook {
  const flags = hook.flags ?? [];
  return {
    ...hook,
    flags,
    conditionKeys: hook.conditionKeys ?? flags,
    impactFactors: hook.impactFactors ?? [],
    consequenceTier: hook.consequenceTier ?? 'callback',
  };
}
