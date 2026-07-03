/**
 * Season seal orchestration (Season Canon, Phase 4).
 *
 * Ties the deterministic state machine (PromiseLedger) and the frozen store
 * (SeasonCanon) to a generated episode: evaluate the state-scoped gates, then —
 * when permitted — freeze the episode's facts into canon. The handoff is
 * "LLM output → deterministic extraction → seal → read-only downstream".
 *
 * Two pure steps the runner composes:
 *   - evaluateEpisodeForSeal(): run the promise gate (deterministic) + the
 *     canon-consistency gate (over supplied knowledge claims). Returns issues +
 *     whether the episode is clean.
 *   - sealEpisodeIntoCanon(): extract structured deltas and freeze them. The
 *     deterministic extraction available without an LLM is the trackable flags an
 *     episode sets → who-knows-what knowledge facts (keyed `flag:<flag>`), which
 *     builds the who-knows-what-when ledger future episodes validate against.
 *     Richer extraction (prose-mined world facts, attributed knowledge claims) is
 *     the LLM handoff fed in via `claims`/`extraDeltas`.
 *
 * No I/O — persistence (season-canon.json / season-ledger.json) is the runner's job.
 */

import type { CallbackLedger } from './callbackLedger';
import type { SeasonCanon, EpisodeCanonDeltas } from './seasonCanon';
import type { ValidationIssue } from '../validators/BaseValidator';
import { validatePromiseLedger } from '../validators/promiseLedgerValidators';
import { validateKnowledgeConsistency, type KnowledgeClaim } from '../validators/canonConsistencyValidator';
import { buildEpisodeStateSnapshot, type EpisodeStateSnapshot } from './episodeStateSnapshot';

interface SealConsequence {
  type?: string;
  flag?: string;
  value?: unknown;
}
interface SealVariant {
  callbackHookId?: string;
  condition?: { flag?: string };
}
interface SealChoice {
  consequences?: SealConsequence[];
}
interface SealBeat {
  textVariants?: SealVariant[];
  choices?: SealChoice[];
}
interface SealScene {
  beats?: SealBeat[];
  choices?: SealChoice[];
}
export interface SealEpisode {
  number?: number;
  scenes?: SealScene[];
}

function* beatsOf(episode: SealEpisode): Generator<SealBeat> {
  for (const scene of episode.scenes ?? []) {
    for (const beat of scene.beats ?? []) yield beat;
  }
}

function* choicesOf(episode: SealEpisode): Generator<SealChoice> {
  for (const scene of episode.scenes ?? []) {
    for (const c of scene.choices ?? []) yield c;
    for (const beat of scene.beats ?? []) {
      for (const c of beat.choices ?? []) yield c;
    }
  }
}

/** callbackHookId values the episode's textVariants reference (for dangling-payoff). */
export function collectReferencedHookIds(episode: SealEpisode): string[] {
  const ids = new Set<string>();
  for (const beat of beatsOf(episode)) {
    for (const v of beat.textVariants ?? []) {
      if (v.callbackHookId) ids.add(v.callbackHookId);
    }
  }
  return [...ids];
}

/**
 * Strip hallucinated within-episode tint hooks (mutates the episode in place).
 *
 * A SceneWriter sometimes gates a prose TextVariant on a within-episode tint flag
 * (`condition.flag`) AND tags that same variant with a ledger-style
 * `callbackHookId: "flag:<X>"` for the same flag — turning a within-episode tint
 * into what looks like a cross-episode payoff. When `flag:<X>` is NOT a planted
 * ledger promise and the variant's own `condition.flag` is exactly `<X>`, that
 * callbackHookId is a mislabel (the flag is set/consumed within the episode and was
 * never planted), not a real payoff. Drop the `callbackHookId` (keep
 * `condition.flag`) so the dangling-payoff gate doesn't abort on the orphan, while
 * genuine dangling cross-episode payoffs (no matching same-variant tint, or a flag
 * that IS planted) still flow through to the gate unchanged.
 *
 * Returns the stripped ids (with duplicates) for advisory reporting.
 */
export function sanitizeWithinEpisodeTintHooks(episode: SealEpisode, ledger: CallbackLedger): string[] {
  const stripped: string[] = [];
  for (const beat of beatsOf(episode)) {
    for (const v of beat.textVariants ?? []) {
      const id = v.callbackHookId;
      if (!id || !id.startsWith('flag:')) continue;
      if (ledger.has(id)) continue; // real planted promise — leave it for the gate to accept
      const flagName = id.slice('flag:'.length);
      // Tightest signature of the defect: the variant pays off the exact flag it
      // also gates its own prose on → a within-episode tint, not a payoff.
      if (v.condition?.flag === flagName) {
        delete v.callbackHookId;
        stripped.push(id);
      }
    }
  }
  return stripped;
}

/** Trackable flags the episode sets (set, non-cosmetic, non-structural). */
function trackableFlagsSet(episode: SealEpisode): string[] {
  const flags = new Set<string>();
  for (const choice of choicesOf(episode)) {
    for (const c of choice.consequences ?? []) {
      if (
        c.type === 'setFlag' &&
        typeof c.flag === 'string' &&
        c.value !== false &&
        !c.flag.startsWith('tint:') &&
        !c.flag.startsWith('route_')
      ) {
        flags.add(c.flag);
      }
    }
  }
  return [...flags];
}

/**
 * Deterministic canon deltas extractable without an LLM: each trackable flag the
 * episode sets becomes a knowledge fact (keyed `flag:<flag>`). `extraDeltas`
 * (LLM-extracted world facts / attributed knowledge / relationships) are merged.
 */
export function extractCanonDeltasFromEpisode(
  episode: SealEpisode,
  protagonistId = 'protagonist',
  extraDeltas?: EpisodeCanonDeltas,
): EpisodeCanonDeltas {
  const knowledge = trackableFlagsSet(episode).map((flag) => ({
    characterId: protagonistId,
    factId: `flag:${flag}`,
    summary: `Established: ${flag}`,
  }));
  return {
    worldFacts: extraDeltas?.worldFacts,
    knowledge: [...knowledge, ...(extraDeltas?.knowledge ?? [])],
    arcStates: extraDeltas?.arcStates,
    relationships: extraDeltas?.relationships,
  };
}

export interface SealEvaluation {
  /** True when no blocking (error) issues were found. */
  clean: boolean;
  issues: ValidationIssue[];
  referencedHookIds: string[];
}

/**
 * Run the state-scoped gates for the episode being sealed. Deterministic over the
 * ledger; the canon-consistency check runs over `claims` (empty → no-op until the
 * LLM extraction is wired).
 */
export function evaluateEpisodeForSeal(params: {
  episode: SealEpisode;
  episodeNumber: number;
  seasonLength: number;
  ledger: CallbackLedger;
  canon: SeasonCanon;
  claims?: KnowledgeClaim[];
}): SealEvaluation {
  // Drop SceneWriter-hallucinated within-episode tint hooks before the gate so an
  // unplanted `flag:<X>` that only tints same-variant prose isn't treated as an
  // orphan cross-episode payoff (keeps condition.flag; surfaced as an advisory).
  const strippedTintHooks = [...new Set(sanitizeWithinEpisodeTintHooks(params.episode, params.ledger))];
  // Dead-promise sweep: a promise due THIS episode whose gating flag no choice
  // ever creates (sourceChoiceId empty — spine/seed-minted, never bound to a
  // setter) can never display a payoff at runtime, so aborting the run over it
  // punishes a contract-PASSED story for an unfulfillable, invisible debt
  // (bite-me 2026-07-03T15-39-14: flag:drank_dark_negroni). Abandon it with a
  // warning instead — the same creation-side semantics the unified
  // ObligationLedgerValidator applies to residue kinds (planned_residue_debt,
  // advisory). A promise whose flag IS choice-set keeps the hard gate.
  const deadPromiseWarnings: ValidationIssue[] = [];
  for (const hook of params.ledger.all()) {
    if (hook.payoffEpisode !== params.episodeNumber) continue;
    if (hook.resolved || hook.payoffCount > 0 || hook.abandoned) continue;
    if (hook.sourceChoiceId) continue;
    params.ledger.abandon(
      hook.id,
      `due in episode ${params.episodeNumber} but no choice ever creates its flag; auto-abandoned at the canon seal`,
    );
    deadPromiseWarnings.push({
      severity: 'warning',
      message: `Promise "${hook.summary}" (${hook.id}) was due in episode ${params.episodeNumber} but no choice ever creates its gating flag — auto-abandoned at the seal (a payoff variant could never display).`,
      location: `promise:${hook.id}`,
      suggestion: 'Wire a choice consequence that sets the flag in its planned episode, or drop the promise from the season spine.',
    });
  }
  const referencedHookIds = collectReferencedHookIds(params.episode);
  const promise = validatePromiseLedger({
    ledger: params.ledger,
    episode: params.episodeNumber,
    seasonLength: params.seasonLength,
    referencedHookIds,
  });
  const canonIssues = validateKnowledgeConsistency(params.claims ?? [], params.canon);
  const tintWarnings: ValidationIssue[] = strippedTintHooks.map((id) => ({
    severity: 'warning' as const,
    message: `Within-episode tint hook ${id} carried a ledger-style callbackHookId but the flag is gated/consumed within episode ${params.episodeNumber} and was never planted; treated as a within-episode tint (callbackHookId dropped, condition.flag kept).`,
    location: `tint-hook:${id}`,
    suggestion: 'Plant the flag as a cross-episode promise if a real payoff is intended, or rely on condition.flag alone for within-episode tints.',
  }));
  const issues = [...promise.issues, ...canonIssues, ...tintWarnings, ...deadPromiseWarnings];
  return {
    clean: issues.every((i) => i.severity !== 'error'),
    issues,
    referencedHookIds,
  };
}

/**
 * Freeze the episode's facts into canon. No-op (returns undefined) if the episode
 * is already sealed — sealed episodes are immutable and never reopened on resume.
 */
export function sealEpisodeIntoCanon(params: {
  canon: SeasonCanon;
  episode: SealEpisode;
  episodeNumber: number;
  protagonistId?: string;
  extraDeltas?: EpisodeCanonDeltas;
}): EpisodeCanonDeltas | undefined {
  if (params.canon.isSealed(params.episodeNumber)) return undefined;
  const deltas = extractCanonDeltasFromEpisode(params.episode, params.protagonistId, params.extraDeltas);
  params.canon.sealEpisode(params.episodeNumber, deltas);
  return deltas;
}

export interface SealAndPersistResult {
  snapshot: EpisodeStateSnapshot;
  evaluation: SealEvaluation;
  alreadySealed: boolean;
}

/**
 * Full per-episode seal step the runner calls (one thin call site in the monolith):
 * evaluate the state-scoped gates, freeze the episode into canon (skipping an
 * already-sealed episode for resume), carry state forward, and persist all three
 * durable artifacts via the injected `save` callback. Gate issues are returned for
 * the caller to surface — advisory by default; the caller decides whether to block.
 */
export async function sealAndPersistEpisode(params: {
  episode: SealEpisode;
  episodeNumber: number;
  seasonLength: number;
  ledger: CallbackLedger;
  canon: SeasonCanon;
  priorSnapshot?: EpisodeStateSnapshot;
  protagonistId?: string;
  claims?: KnowledgeClaim[];
  extraDeltas?: EpisodeCanonDeltas;
  save: (artifactName: string, data: unknown) => Promise<void>;
}): Promise<SealAndPersistResult> {
  const evaluation = evaluateEpisodeForSeal({
    episode: params.episode,
    episodeNumber: params.episodeNumber,
    seasonLength: params.seasonLength,
    ledger: params.ledger,
    canon: params.canon,
    claims: params.claims,
  });
  const alreadySealed = params.canon.isSealed(params.episodeNumber);
  if (!alreadySealed) {
    sealEpisodeIntoCanon({
      canon: params.canon,
      episode: params.episode,
      episodeNumber: params.episodeNumber,
      protagonistId: params.protagonistId,
      extraDeltas: params.extraDeltas,
    });
  }
  const openPromiseIds = params.ledger.all().filter((h) => !h.resolved).map((h) => h.id);
  const snapshot = buildEpisodeStateSnapshot(params.episode, openPromiseIds, params.priorSnapshot);
  await params.save('season-canon.json', params.canon.serialize());
  await params.save('season-ledger.json', params.ledger.serialize());
  await params.save('episode-state-snapshot.json', snapshot);
  return { snapshot, evaluation, alreadySealed };
}
