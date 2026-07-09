/**
 * Thread + treatment-seed obligations on the unified ledger (audit item 2,
 * P2.3). Narrative threads (ThreadPlanner) and treatment seeds (blueprint
 * declarations) are authored plans validated statically by their own
 * validators; this module additionally registers each as a ledger entry
 * (kind 'thread' / 'seed') so EVERY "setup must pay off later" promise lives
 * in one store with one status — the unified ObligationLedgerValidator (P2.4)
 * reads these per-kind instead of re-scanning the plans.
 *
 * Kind-specific payoff semantics: a thread or seed is PAID at payoffCount >= 1
 * (unlike choice callbacks, which resolve at the ledger's threshold of 2).
 * Consumers must interpret paid-ness per kind via `isObligationPaid`.
 */

import type { ThreadLedger } from '../../types/narrativeThread';
import type { CallbackHook, CallbackLedger } from './callbackLedger';
import { resolveSceneTreatmentSeeds } from './episodePlantContext';
import { isEscPlantStagingThread } from '../utils/compiledEscDirectives';

export interface ObligationSeedingResult {
  threadsRegistered: number;
  threadPayoffsCredited: number;
  seedsRegistered: number;
  seedPayoffsCredited: number;
}

/** Kind-aware paid-ness: threads/seeds/residue pay off with a single credit. */
export function isObligationPaid(hook: CallbackHook): boolean {
  if (hook.resolved) return true;
  const kind = hook.kind;
  if (kind === 'thread' || kind === 'seed' || kind === 'residue') return hook.payoffCount >= 1;
  return false;
}

/**
 * Register every PLANTED thread as a `thread:<id>` obligation; credit one
 * payoff per authored payoff beat. Unplanted threads promise nothing yet and
 * are skipped (SetupPayoffValidator still flags them as structural issues).
 *
 * ESC plant-staging threads (authored-lite spine obligations) are fulfilled by
 * on-page staging: if they somehow lack an explicit payoff entry, credit the
 * plant scene so they never seal-block as unpaid Chekhov debt.
 */
export function registerThreadObligations(
  ledger: CallbackLedger,
  threadLedger: ThreadLedger | undefined,
  episodeNumber: number,
): Pick<ObligationSeedingResult, 'threadsRegistered' | 'threadPayoffsCredited'> {
  let threadsRegistered = 0;
  let threadPayoffsCredited = 0;
  for (const thread of threadLedger?.threads ?? []) {
    if (!thread.id || !(thread.plants?.length)) continue;
    const id = `thread:${thread.id}`;
    const minEpisode = thread.introducedInEpisode ?? episodeNumber;
    const plantStaging = isEscPlantStagingThread(thread);
    // Plant-staging ESC obligations are same-scene fulfilled; leave the window
    // open (season-wide) when no explicit due episode was authored so a stale
    // empty-payoff entry cannot escalate to a same-episode seal error.
    const maxEpisode = plantStaging
      ? (thread.expectedPaidOffByEpisode ?? minEpisode)
      : (thread.expectedPaidOffByEpisode ?? Math.max(minEpisode, episodeNumber));
    ledger.add({
      id,
      kind: 'thread',
      sourceEpisode: minEpisode,
      sourceSceneId: thread.plants[0]?.sceneId ?? '',
      sourceChoiceId: '',
      flags: [],
      summary: thread.label || thread.description || thread.id,
      payoffWindow: { minEpisode, maxEpisode: Math.max(minEpisode, maxEpisode) },
    });
    threadsRegistered += 1;

    const payoffs = [...(thread.payoffs ?? [])];
    if (plantStaging && payoffs.length === 0) {
      const plant = thread.plants[0]!;
      payoffs.push({
        sceneId: plant.sceneId,
        beatId: `${plant.beatId || plant.sceneId}-staging-fulfilled`,
        note: 'ESC plant staging fulfilled on-page',
      });
    }

    for (const payoff of payoffs) {
      const credited = ledger.recordPayoff(id, {
        episode: episodeNumber,
        sceneId: payoff.sceneId,
        beatId: payoff.beatId,
        source: 'authored_variant',
      });
      if (credited) threadPayoffsCredited += 1;
    }
  }
  return { threadsRegistered, threadPayoffsCredited };
}

/**
 * Register every declared treatment seed as a `seed:<flag>` obligation
 * (same-episode presence contract); credit a payoff when any choice in the
 * episode sets the flag. Mirrors TreatmentSeedOnPageValidator's
 * declared-vs-set check, as ledger state.
 */
export function registerSeedObligations(
  ledger: CallbackLedger,
  blueprintScenes: Array<{ id?: string; choicePoint?: { setsTreatmentSeeds?: string[] }; encounterSetupContext?: string[] }>,
  episodeSetFlags: ReadonlySet<string>,
  episodeNumber: number,
): Pick<ObligationSeedingResult, 'seedsRegistered' | 'seedPayoffsCredited'> {
  let seedsRegistered = 0;
  let seedPayoffsCredited = 0;
  for (const scene of blueprintScenes) {
    for (const flag of resolveSceneTreatmentSeeds(scene)) {
      const id = `seed:${flag}`;
      ledger.add({
        id,
        kind: 'seed',
        sourceEpisode: episodeNumber,
        sourceSceneId: scene.id ?? '',
        sourceChoiceId: '',
        flags: [flag],
        summary: `Treatment seed set on-page: ${flag}`,
        payoffWindow: { minEpisode: episodeNumber, maxEpisode: episodeNumber },
      });
      seedsRegistered += 1;
      if (episodeSetFlags.has(flag)) {
        const credited = ledger.recordPayoff(id, {
          episode: episodeNumber,
          sceneId: scene.id ?? '',
          source: 'authored_variant',
        });
        if (credited) seedPayoffsCredited += 1;
      }
    }
  }
  return { seedsRegistered, seedPayoffsCredited };
}

/** Every setFlag name any choice in the episode's choice sets emits. */
export function collectEpisodeSetFlags(
  choiceSets: Array<{ choices?: Array<{ consequences?: Array<{ type?: string; flag?: string }> }> }>,
): Set<string> {
  const flags = new Set<string>();
  for (const set of choiceSets) {
    for (const choice of set.choices ?? []) {
      for (const consequence of choice.consequences ?? []) {
        if (consequence?.type === 'setFlag' && typeof consequence.flag === 'string') flags.add(consequence.flag);
      }
    }
  }
  return flags;
}
