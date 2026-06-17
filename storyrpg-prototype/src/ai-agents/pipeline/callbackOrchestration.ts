/**
 * Callback orchestration
 *
 * The pipeline-level glue around the `CallbackLedger`: harvesting hooks/payoffs
 * from a just-generated episode and shaping unresolved hooks for agent prompts.
 *
 * Extracted from FullStoryPipeline (which is slated for decomposition) so the
 * callback set->payoff lifecycle lives in one focused, unit-testable module.
 * These functions are pure with respect to pipeline state — they take the
 * ledger explicitly and touch no `this` — so the pipeline keeps only thin
 * delegating wrappers.
 */

import type { Choice, ReminderPlan } from '../../types/choice';
import type { TextVariant } from '../../types/content';
import type { ConditionExpression } from '../../types/conditions';
import { isUnsafeCallbackProse } from '../constants/metaProse';
import { isFallbackReminderStub } from '../constants/choiceTextFallbacks';
import type { CallbackHook, CallbackLedger } from './callbackLedger';

/**
 * Parse an explicit FUTURE episode number out of a forward-promise string
 * ("In Episode 2 …", "Mika's confession in Episode 3/4", "in episode three").
 * Returns the number only when it names an episode strictly AFTER the current one
 * (a vague "in a later episode" yields undefined → the hook uses a default window).
 * When a range is named ("Episode 3/4"), the earliest future episode is used.
 */
export function parsePromisedEpisode(text: string, currentEpisode: number): number | undefined {
  const words: Record<string, number> = {
    one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  };
  const candidates: number[] = [];
  const re = /\bepisode[s]?\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten)(?:\s*\/\s*(\d+|one|two|three|four|five|six|seven|eight|nine|ten))?/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    for (const token of [m[1], m[2]]) {
      if (!token) continue;
      const lower = token.toLowerCase();
      const n = /^\d+$/.test(lower) ? parseInt(lower, 10) : words[lower];
      if (n && n > currentEpisode) candidates.push(n);
    }
  }
  return candidates.length > 0 ? Math.min(...candidates) : undefined;
}

/** A single unresolved hook, shaped for a SceneWriter/ChoiceAuthor prompt. */
export interface UnresolvedCallbackForPrompt {
  id: string;
  sourceEpisode: number;
  summary: string;
  flags: string[];
  conditionKeys?: string[];
  impactFactors?: string[];
  consequenceTier?: string;
}

/** Minimal beat shape the harvest pass reads. */
export interface HarvestBeat {
  id?: string;
  text?: string;
  callbackHookIds?: string[];
  textVariants?: TextVariant[];
  choices?: Array<{ id: string; memorableMoment?: { id: string; summary: string; flags?: string[] } }>;
}

/** Minimal scene-content shape the harvest pass reads. */
export interface HarvestSceneContent {
  sceneId: string;
  beats: HarvestBeat[];
}

/** Minimal choice-set shape the harvest pass reads. */
export interface HarvestChoiceSet {
  sceneId?: string;
  beatId?: string;
  choices: Array<{ id: string; memorableMoment?: { id: string; summary: string; flags?: string[] }; consequences?: unknown[] }>;
}

export interface HarvestEpisodeCallbacksParams {
  episodeNumber: number;
  sceneContents: HarvestSceneContent[];
  choiceSets: HarvestChoiceSet[];
}

/**
 * Shape the unresolved callback hooks for SceneWriter/ChoiceAuthor prompts.
 * Returns `undefined` when there are no hooks, so the prompt section is
 * skipped cleanly.
 */
export function getUnresolvedCallbacksForPrompt(
  ledger: CallbackLedger,
  episodeNumber: number | undefined,
): UnresolvedCallbackForPrompt[] | undefined {
  // 1.1: previously episode 1 was skipped entirely, so first-episode (and
  // single-episode) hooks could never be injected and so never paid off. Allow
  // episode 1; `unresolvedFor` still gates on each hook's payoff window, so no
  // hook is offered before it exists.
  if (!episodeNumber || episodeNumber < 1) return undefined;
  const hooks = ledger.unresolvedFor(episodeNumber);
  if (hooks.length === 0) return undefined;
  return hooks.map((hook) => ({
    id: hook.id,
    sourceEpisode: hook.sourceEpisode,
    summary: hook.summary,
    flags: hook.flags,
    conditionKeys: hook.conditionKeys,
    impactFactors: hook.impactFactors,
    consequenceTier: hook.consequenceTier,
  }));
}

/**
 * Harvest callback state from a just-generated episode: seed new hooks from
 * `memorableMoment` choice fields, and record payoffs for any TextVariants
 * that reference an existing hook id.
 */
export function harvestEpisodeCallbacks(
  ledger: CallbackLedger,
  params: HarvestEpisodeCallbacksParams,
): { newHooks: number; payoffs: number } {
  let newHooks = 0;
  let payoffs = 0;

  for (const choiceSet of params.choiceSets) {
    const sceneId = choiceSet.sceneId || '';
    for (const choice of choiceSet.choices || []) {
      const typedChoice = choice as unknown as Choice;
      if (choice.memorableMoment?.id) {
        const added = ledger.recordChoice({
          choice: typedChoice,
          episode: params.episodeNumber,
          sceneId,
        });
        if (added) newHooks += 1;
      }
      // 1.1: seed a hook for every trackable flag the choice sets, not just
      // memorableMoment-tagged choices, so ordinary set-flags enter the
      // inject -> payoff loop instead of shipping unread.
      for (const flag of ledger.trackableFlagsOf(typedChoice)) {
        const added = ledger.recordFlagSet({
          choice: typedChoice,
          flag,
          episode: params.episodeNumber,
          sceneId,
        });
        if (added) newHooks += 1;
      }
      // Tone callbacks: seed a LOWER-priority `tone:` hook for every cosmetic
      // `tint:` flag the choice sets. These were write-only before (dropped by
      // isStructuralFlag), so a season's ~10 personality flags were never
      // acknowledged in later prose; now they enter the inject->payoff loop,
      // de-prioritized so they don't crowd real narrative payoffs.
      for (const flag of ledger.trackableTintsOf(typedChoice)) {
        const added = ledger.recordTintSet({
          choice: typedChoice,
          flag,
          episode: params.episodeNumber,
          sceneId,
        });
        if (added) newHooks += 1;
      }
      // gen-5: also seed hooks for flags set via DELAYED consequences (e.g. the
      // Mika-betrayal seeds). These never entered the ledger before, so they were
      // truly-dead flags — set, registered nowhere, never read downstream.
      for (const flag of ledger.trackableDelayedFlagsOf(typedChoice)) {
        const added = ledger.recordFlagSet({
          choice: typedChoice,
          flag,
          episode: params.episodeNumber,
          sceneId,
        });
        if (added) newHooks += 1;
      }
      // gen-5: harvest forward-promises written into reminderPlan.later. The author
      // often promises a SPECIFIC later-episode payoff ("In Episode 2 … the photo
      // appears in the blog's sidebar"); nothing reconciled these, so they shipped
      // as broken in-range promises. Plant a hook targeting the named episode so the
      // promise enters the inject -> payoff loop and the gate can detect a miss.
      const laterPromise = typedChoice.reminderPlan?.later;
      if (laterPromise && laterPromise.trim().length > 0) {
        const payoffEpisode = parsePromisedEpisode(laterPromise, params.episodeNumber);
        const added = ledger.recordForwardPromise({
          choice: typedChoice,
          episode: params.episodeNumber,
          sceneId,
          summary: laterPromise.trim(),
          payoffEpisode,
        });
        if (added) newHooks += 1;
      }
      // Mirror for the score axis: plant a `score:<name>` promise for every score
      // the choice moves, so a later TextVariant keyed on that score resolves
      // against a real ledger hook instead of dangling (Season-Canon promise gate).
      for (const score of ledger.trackableScoresOf(typedChoice)) {
        const added = ledger.recordScoreSet({
          choice: typedChoice,
          score,
          episode: params.episodeNumber,
          sceneId,
        });
        if (added) newHooks += 1;
      }
    }
  }

  for (const scene of params.sceneContents) {
    for (const beat of scene.beats || []) {
      if (beat.choices) {
        for (const choice of beat.choices) {
          if (choice.memorableMoment?.id) {
            const added = ledger.recordChoice({
              choice: choice as unknown as Choice,
              episode: params.episodeNumber,
              sceneId: scene.sceneId,
            });
            if (added) newHooks += 1;
          }
        }
      }
      if (beat.textVariants) {
        const matched = ledger.recordPayoffsFromVariants(
          beat.textVariants,
          beatPayoffDedupeKey(params.episodeNumber, scene.sceneId, beat, scene.beats.indexOf(beat)),
        );
        payoffs += matched.length;
        if (matched.length > 0) {
          const hookIds = new Set(beat.callbackHookIds || []);
          for (const hookId of matched) hookIds.add(hookId);
          beat.callbackHookIds = Array.from(hookIds);
        }
      }
    }
  }

  return { newHooks, payoffs };
}

/** Stable per-beat dedupe key so payoff crediting is idempotent across passes. */
function beatPayoffDedupeKey(
  episodeNumber: number,
  sceneId: string,
  beat: HarvestBeat,
  beatIndex: number,
): string {
  return `${episodeNumber}:${sceneId}:${beat.id ?? `idx${beatIndex}`}`;
}

/**
 * Credit callback payoffs from a SINGLE just-written scene, during episode
 * generation. Previously payoffs were only harvested AFTER the whole episode
 * (harvestEpisodeCallbacks), so scene 5's prompt still listed a hook scene 2 had
 * already honored — the writer paid it again, inflating payoffCount past the
 * resolve threshold and double-acknowledging the same decision on-page. Crediting
 * per-scene keeps `unresolvedFor()` (and so getUnresolvedCallbacksForPrompt) live
 * within the episode; the beat-level dedupe key makes the end-of-episode harvest
 * re-scan a no-op for these beats rather than a double count.
 */
export function recordScenePayoffs(
  ledger: CallbackLedger,
  episodeNumber: number,
  scene: HarvestSceneContent,
): { payoffs: number } {
  let payoffs = 0;
  for (const beat of scene.beats || []) {
    if (!beat.textVariants) continue;
    const matched = ledger.recordPayoffsFromVariants(
      beat.textVariants,
      beatPayoffDedupeKey(episodeNumber, scene.sceneId, beat, scene.beats.indexOf(beat)),
    );
    payoffs += matched.length;
    if (matched.length > 0) {
      const hookIds = new Set(beat.callbackHookIds || []);
      for (const hookId of matched) hookIds.add(hookId);
      beat.callbackHookIds = Array.from(hookIds);
    }
  }
  return { payoffs };
}

// ---------------------------------------------------------------------------
// Deterministic callback realization (P1b)
// ---------------------------------------------------------------------------

/** Tag stamped on auto-injected callback variants so they're identifiable. */
export const AUTO_CALLBACK_REMINDER_TAG = 'auto-callback';

export interface InjectFallbackCallbacksParams {
  episodeNumber: number;
  sceneContents: HarvestSceneContent[];
  choiceSets: HarvestChoiceSet[];
  /** Max callback variants to inject per beat (default 1). */
  maxPerBeat?: number;
  /** Max callback variants to inject per scene (default 2). */
  maxPerScene?: number;
}

/** Every flag / score key a (possibly compound) condition references. */
export function extractConditionKeys(condition: unknown): string[] {
  if (!condition || typeof condition !== 'object') return [];
  const c = condition as Record<string, unknown>;
  const out: string[] = [];
  if (c.type === 'flag' && typeof c.flag === 'string') out.push(c.flag);
  if (c.type === 'score' && typeof c.score === 'string') out.push(`score:${c.score}`);
  if (Array.isArray(c.conditions)) for (const child of c.conditions) out.push(...extractConditionKeys(child));
  if (c.condition) out.push(...extractConditionKeys(c.condition));
  return out;
}

/** Build the gating condition for a callback variant from a ledger condition key. */
export function buildCallbackCondition(conditionKey: string): ConditionExpression {
  if (conditionKey.startsWith('score:')) {
    return { type: 'score', score: conditionKey.slice('score:'.length), operator: '>=', value: 1 };
  }
  return { type: 'flag', flag: conditionKey, value: true };
}

/**
 * Choose reader-facing prose for an auto-injected callback.
 *
 * The authored callback sources — `reminderPlan` and `feedbackCue` — are
 * planning-register ("In the caravan scene, she …", "The next scene should
 * remember this choice"), and the ledger's synthesized fallback summary embeds
 * raw flag names ('Earlier choice: "…" (sets treatment_seed_ep2_1).'). Injecting
 * any of those verbatim leaked design notes to readers. We now consider candidates
 * in reader-facing-preference order and return the FIRST one that passes the
 * meta-prose reject filter. If none of the AUTHORED candidates is clean we no longer
 * give up: we synthesize a short, deterministic in-fiction acknowledgment from the
 * choice text (`deriveChoiceAcknowledgment`) so a hook whose only authored source was
 * the synthesized `Earlier choice: "…" (sets …)` stub still yields usable, non-meta
 * prose instead of being silently dropped (the "write-only flags" gap). Only when even
 * that can't be built (no choice text) do we return '' and skip the injection.
 */
function pickCallbackProse(meta: CallbackProseMeta | undefined, summary: string): string {
  const candidates = [
    // memorableMoment.summary / tone summary arrives here as `summary` (an in-fiction
    // recap); for ordinary flag/score hooks `summary` is the synthesized stub, which
    // the filter rejects so we fall through to the authored prose then the derived line.
    summary,
    meta?.echoSummary,
    meta?.reminderPlan?.shortTerm,
    meta?.reminderPlan?.immediate,
  ];
  for (const raw of candidates) {
    const candidate = (raw ?? '').replace(/\s+/g, ' ').trim();
    if (candidate && !isUnsafeCallbackProse(candidate) && !isFallbackReminderStub(candidate)) return candidate;
  }
  // Deterministic in-fiction fallback derived from the choice text. Built to pass
  // the same reject filters (no scene/flag/episode refs, no system math) so it is a
  // clean acknowledgment, not a bypass.
  const derived = deriveChoiceAcknowledgment(meta?.text);
  if (derived && !isUnsafeCallbackProse(derived) && !isFallbackReminderStub(derived)) return derived;
  return '';
}

/**
 * A small pool of short, neutral, in-fiction continuity beats. Each references "an
 * earlier decision" WITHOUT naming a scene, flag, or episode, so every entry passes
 * the meta-prose / fallback-stub reject filters. Picked by a stable hash of the
 * choice text so DIFFERENT choices vary (anti-repetition) while the SAME choice is
 * always realized identically (golden-stable, no RNG).
 */
const DERIVED_ACK_POOL: readonly string[] = [
  'What you chose earlier still sits with you here.',
  'The decision you made before has not let go of you.',
  'An earlier choice of yours echoes quietly under this moment.',
  'You feel the weight of what you settled on before.',
  'The call you made earlier is still shaping how this lands.',
  'Something you decided before colors the way you meet this.',
];

/** Stable, deterministic 32-bit hash of a string (no RNG, golden-safe). */
function stableHash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

/**
 * Synthesize a short, clean, in-fiction acknowledgment of an earlier decision when a
 * hook's only authored prose source was the synthesized `Earlier choice: "…"` stub.
 * We do NOT echo the choice text verbatim (imperative choice prose reads oddly mid-
 * scene); instead we pick a neutral continuity beat from {@link DERIVED_ACK_POOL},
 * keyed by a stable hash of the choice text so different choices get different lines
 * (the anti-repetition guard) while the same choice is deterministic. When no choice
 * text is available we still return the first pool entry (better a light beat than a
 * dropped, write-only flag). All pool entries are pre-cleared by the reject filters.
 */
export function deriveChoiceAcknowledgment(choiceText: string | undefined): string {
  const text = (choiceText ?? '').replace(/\s+/g, ' ').trim();
  const key = text && !isUnsafeCallbackProse(text) ? text : '';
  return DERIVED_ACK_POOL[stableHash(key) % DERIVED_ACK_POOL.length];
}

/** Choice metadata the callback realizer consults for reader-facing prose. */
interface CallbackProseMeta {
  reminderPlan?: ReminderPlan;
  echoSummary?: string;
  text?: string;
}

/**
 * Reader-facing prose carried on the hook itself, captured from the source choice
 * at registration. Lets the fallback realize a CROSS-EPISODE hook whose source
 * choice is not in this episode's `choiceMetaById` — the case that left
 * forward-promise (`later:`) hooks unrealizable and tripped the promise-due gate.
 */
function hookProseMeta(hook: CallbackHook): CallbackProseMeta | undefined {
  const ps = hook.proseSources;
  if (!ps) return undefined;
  return {
    echoSummary: ps.echoSummary,
    reminderPlan: { immediate: ps.immediate ?? '', shortTerm: ps.shortTerm ?? '' },
  };
}

/**
 * Deterministically realize planted-but-uncollected callbacks.
 *
 * The ledger plants a hook for every trackable flag/score a choice sets, and the
 * harvest pass records payoffs only for TextVariants the LLM *chose* to author with a
 * `callbackHookId`. In practice the LLM skips most of them, so player choices set state
 * that later prose never acknowledges (the audited run referenced 1 of 21 flags). This
 * pass closes that gap: for each in-window, never-paid-off hook it appends a TextVariant
 * — gated on the hook's flag/score, sourced from the choice's authored `reminderPlan` —
 * to an eligible downstream beat, and records the payoff. Runs AFTER harvest (so this
 * episode's hooks are already seeded) and BEFORE assembly/validation (which both read the
 * mutated sceneContents). Only hooks whose payoffWindow includes this episode are
 * realized, so cross-episode hooks targeting later episodes correctly stay open.
 */
export function injectFallbackCallbacks(
  ledger: CallbackLedger,
  params: InjectFallbackCallbacksParams,
): { injected: number } {
  const { episodeNumber, sceneContents, choiceSets } = params;
  const maxPerBeat = params.maxPerBeat ?? 1;
  const maxPerScene = params.maxPerScene ?? 2;
  if (!sceneContents.length) return { injected: 0 };

  const sceneIndexById = new Map<string, number>();
  sceneContents.forEach((sc, idx) => sceneIndexById.set(sc.sceneId, idx));

  // Choice metadata (reminderPlan + echoSummary + text) for prose sourcing.
  const choiceMetaById = new Map<string, CallbackProseMeta>();
  const noteChoice = (raw: unknown): void => {
    const c = raw as Choice;
    if (c?.id && !choiceMetaById.has(c.id)) {
      choiceMetaById.set(c.id, {
        reminderPlan: c.reminderPlan,
        echoSummary: c.feedbackCue?.echoSummary,
        text: c.text,
      });
    }
  };
  for (const cs of choiceSets) for (const choice of cs.choices || []) noteChoice(choice);
  for (const sc of sceneContents) for (const beat of sc.beats || []) for (const choice of beat.choices || []) noteChoice(choice);

  // Flags/scores/hookIds already referenced by an existing TextVariant — never double up.
  const alreadyReferenced = new Set<string>();
  for (const sc of sceneContents) {
    for (const beat of sc.beats || []) {
      for (const variant of beat.textVariants || []) {
        for (const key of extractConditionKeys(variant.condition)) alreadyReferenced.add(key);
        if (variant.callbackHookId) alreadyReferenced.add(variant.callbackHookId);
      }
    }
  }

  const usedPerBeat = new Map<string, number>();
  const usedPerScene = new Map<number, number>();
  let injected = 0;

  // Never-paid-off hooks whose window includes this episode, oldest first.
  for (const hook of ledger.unresolvedFor(episodeNumber).filter((h) => h.payoffCount === 0)) {
    const conditionKey = hook.flags[0] ?? (hook.conditionKeys ?? []).find((k) => k.startsWith('score:'));
    if (!conditionKey) continue;
    if (alreadyReferenced.has(conditionKey) || alreadyReferenced.has(hook.id)) continue;

    // Resolve reader-facing prose once per hook. If no candidate survives the
    // meta-prose filter, skip the hook entirely rather than leak a planning note.
    // Prefer the choice's meta from THIS episode; for a cross-episode hook the
    // source choice isn't in scope, so fall back to the prose captured on the hook.
    const meta = (hook.sourceChoiceId ? choiceMetaById.get(hook.sourceChoiceId) : undefined)
      ?? hookProseMeta(hook);
    const text = pickCallbackProse(meta, hook.summary);
    if (!text) continue;

    // Within-episode hooks must land in a LATER scene than where the flag was set;
    // cross-episode hooks (sourceIdx -1) may land anywhere in this episode.
    const sourceIdx = hook.sourceEpisode === episodeNumber
      ? (sceneIndexById.get(hook.sourceSceneId) ?? -1)
      : -1;

    let placed = false;
    for (let sIdx = 0; sIdx < sceneContents.length && !placed; sIdx++) {
      if (sIdx <= sourceIdx) continue;
      if ((usedPerScene.get(sIdx) ?? 0) >= maxPerScene) continue;
      for (const beat of sceneContents[sIdx].beats || []) {
        const beatId = beat.id || '';
        if (!beatId) continue;
        if ((usedPerBeat.get(beatId) ?? 0) >= maxPerBeat) continue;

        // G12: a matching TextVariant REPLACES the beat's base text at runtime, so
        // injecting the bare callback line erased whole establishing beats ("You
        // asked the real question. Stela answered it." shipped as the entire beat).
        // Compose: base prose + callback acknowledgment, so the scene survives.
        const baseText = typeof beat.text === 'string' ? beat.text.trim() : '';
        const composedText = baseText ? `${baseText}\n\n${text}` : text;
        const variant: TextVariant = {
          condition: buildCallbackCondition(conditionKey),
          text: composedText,
          callbackHookId: hook.id,
          sourceChoiceId: hook.sourceChoiceId,
          reminderTag: AUTO_CALLBACK_REMINDER_TAG,
        };
        beat.textVariants = [...(beat.textVariants || []), variant];
        beat.callbackHookIds = Array.from(new Set([...(beat.callbackHookIds || []), hook.id]));
        ledger.recordPayoff(hook.id);
        alreadyReferenced.add(conditionKey);
        usedPerBeat.set(beatId, (usedPerBeat.get(beatId) ?? 0) + 1);
        usedPerScene.set(sIdx, (usedPerScene.get(sIdx) ?? 0) + 1);
        injected += 1;
        placed = true;
        break;
      }
    }
  }

  return { injected };
}
