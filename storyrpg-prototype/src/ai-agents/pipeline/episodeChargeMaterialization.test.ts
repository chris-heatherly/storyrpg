/**
 * Phase 6 wiring (`episodeChargeMaterialization`) — the live seam between the
 * per-episode loop and the charge-materialization gate (Plan Part 9 + Part 10).
 *
 * These tests pin the DEFAULT-OFF contract and the flag behavior the wiring exists
 * to provide:
 *  - flag OFF (`CONVERGENCE_LEDGER` unset) → `ran:false`, NOTHING runs: no ledger,
 *    no validator, no persistence, no throw (byte-identical to before this phase);
 *  - flag ON, gate OFF → advisory: the annotated ledger is built + persisted, a
 *    hollow branch is recorded but does NOT throw;
 *  - flag ON + `GATE_CHARGE_MATERIALIZATION='1'` → a hollow branch THROWS, and the
 *    annotated ledger is still persisted first (the diagnostic survives the throw);
 *  - flag ON + gate ON, charge materialized → no throw, `edge.materialized` true.
 *
 * The projection + target-adapter helpers are exercised directly too.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildMaterializationTargets,
  projectSceneConsequences,
  runEpisodeChargeMaterialization,
  runEpisodeChargeMaterializationForSeason,
  type AuthoredChoiceSetLike,
} from './episodeChargeMaterialization';
import { edgeKey } from '../validators/ChargeMaterializationValidator';
import type { ConsequenceTier, PlannedScene, SeasonScenePlan } from '../../types/scenePlan';
import type { SeasonPlan } from '../../types/seasonPlan';

// --- builders -------------------------------------------------------------

function scene(
  id: string,
  episodeNumber: number,
  opts: { kind?: 'standard' | 'encounter'; tier?: ConsequenceTier } = {},
): PlannedScene {
  return {
    id,
    episodeNumber,
    order: 0,
    kind: opts.kind ?? 'standard',
    title: id,
    dramaticPurpose: 'x',
    narrativeRole: 'development',
    locations: [],
    npcsInvolved: [],
    setsUp: [],
    paysOff: [],
    consequenceTier: opts.tier,
  };
}

/**
 * A two-scene season plan: `s0` plants a setup that the heavy-tier `payoff` scene
 * (in `ep`) discharges. The single `setsUp`→`payoff` edge becomes a `setupPayoff`
 * ledger edge landing in `ep` — a heavy, non-encounter, non-score edge, so its
 * charge failing to materialize is a HOLLOW BRANCH.
 */
function heavyPayoffPlan(ep = 1): SeasonScenePlan {
  const scenes = [scene('s0', ep), scene('payoff', ep, { tier: 'branch' })];
  return {
    scenes,
    byEpisode: { [ep]: ['s0', 'payoff'] },
    setupPayoffEdges: [{ from: 's0', to: 'payoff', span: 'same_episode' }],
  };
}

/** A choice set on `payoff` whose authored flag consequence materializes the plant. */
const MATERIALIZING_CHOICE_SETS: AuthoredChoiceSetLike[] = [
  {
    sceneId: 'payoff',
    choices: [{ consequences: [{ type: 'setFlag', flag: 'plant-landed', value: true }] }],
  },
];

/** No authored consequence on `payoff` → the heavy plant never materializes. */
const HOLLOW_CHOICE_SETS: AuthoredChoiceSetLike[] = [
  { sceneId: 'payoff', choices: [{ consequences: [] }] },
];

afterEach(() => {
  delete process.env.CONVERGENCE_LEDGER;
  delete process.env.GATE_CHARGE_MATERIALIZATION;
  delete process.env.CHARGE_STATS;
  delete process.env.CHARGE_COMPETENCE;
});

// --- default-off ----------------------------------------------------------

describe('runEpisodeChargeMaterialization — default-off', () => {
  it('no-ops when CONVERGENCE_LEDGER is unset: no run, no persist, no throw — even on a hollow branch', async () => {
    const persist = vi.fn();
    const outcome = await runEpisodeChargeMaterialization(
      {
        scenePlan: heavyPayoffPlan(),
        episodeNumber: 1,
        choiceSets: HOLLOW_CHOICE_SETS,
      },
      persist,
    );
    expect(outcome).toEqual({ ran: false });
    expect(persist).not.toHaveBeenCalled();
  });

  it('no-ops even when GATE_CHARGE_MATERIALIZATION is on but CONVERGENCE_LEDGER is off', async () => {
    process.env.GATE_CHARGE_MATERIALIZATION = '1';
    const persist = vi.fn();
    const outcome = await runEpisodeChargeMaterialization(
      { scenePlan: heavyPayoffPlan(), episodeNumber: 1, choiceSets: HOLLOW_CHOICE_SETS },
      persist,
    );
    // The ledger flag gates the whole module: the gate flag alone has no effect.
    expect(outcome.ran).toBe(false);
    expect(persist).not.toHaveBeenCalled();
  });
});

// --- flag-on, gate-off: advisory -----------------------------------------

describe('runEpisodeChargeMaterialization — advisory (ledger on, gate off)', () => {
  it('builds + persists the annotated ledger and records a hollow branch WITHOUT throwing', async () => {
    process.env.CONVERGENCE_LEDGER = '1';
    const persist = vi.fn();
    const outcome = await runEpisodeChargeMaterialization(
      { scenePlan: heavyPayoffPlan(), episodeNumber: 1, choiceSets: HOLLOW_CHOICE_SETS },
      persist,
    );

    expect(outcome.ran).toBe(true);
    expect(outcome.blocking).toBe(false);
    // The hollow branch is an error-severity finding, but advisory → not thrown.
    expect(outcome.result?.issues.some((i) => i.severity === 'error')).toBe(true);
    // Annotated ledger persisted, edge marked NOT materialized.
    expect(persist).toHaveBeenCalledTimes(1);
    const persistedLedger = persist.mock.calls[0][0];
    expect(persistedLedger.edges.find((e: { to: string }) => e.to === 'payoff')?.materialized).toBe(
      false,
    );
  });

  it('materializes the plant when an authored consequence lands on the payoff scene', async () => {
    process.env.CONVERGENCE_LEDGER = '1';
    const outcome = await runEpisodeChargeMaterialization({
      scenePlan: heavyPayoffPlan(),
      episodeNumber: 1,
      choiceSets: MATERIALIZING_CHOICE_SETS,
    });
    expect(outcome.ran).toBe(true);
    expect(outcome.ledger?.edges.find((e) => e.to === 'payoff')?.materialized).toBe(true);
    expect(outcome.result?.issues.some((i) => i.severity === 'error')).toBe(false);
  });
});

// --- flag-on + gate-on: blocking -----------------------------------------

describe('runEpisodeChargeMaterialization — blocking (ledger on, gate on)', () => {
  it('throws on a hollow branch, but persists the annotated ledger FIRST', async () => {
    process.env.CONVERGENCE_LEDGER = '1';
    process.env.GATE_CHARGE_MATERIALIZATION = '1';
    const persist = vi.fn();

    await expect(
      runEpisodeChargeMaterialization(
        { scenePlan: heavyPayoffPlan(), episodeNumber: 1, choiceSets: HOLLOW_CHOICE_SETS },
        persist,
      ),
    ).rejects.toThrow(/hollow branch/i);

    // The diagnostic must survive the throw.
    expect(persist).toHaveBeenCalledTimes(1);
    expect(
      persist.mock.calls[0][0].edges.find((e: { to: string }) => e.to === 'payoff')?.materialized,
    ).toBe(false);
  });

  it('does NOT throw when the charge materialized, even with the gate on', async () => {
    process.env.CONVERGENCE_LEDGER = '1';
    process.env.GATE_CHARGE_MATERIALIZATION = '1';
    const outcome = await runEpisodeChargeMaterialization({
      scenePlan: heavyPayoffPlan(),
      episodeNumber: 1,
      choiceSets: MATERIALIZING_CHOICE_SETS,
    });
    expect(outcome.ran).toBe(true);
    expect(outcome.blocking).toBe(true);
    expect(outcome.result?.valid).toBe(true);
  });

  it('only checks the named episode: a hollow payoff in another episode does not block', async () => {
    process.env.CONVERGENCE_LEDGER = '1';
    process.env.GATE_CHARGE_MATERIALIZATION = '1';
    // payoff lives in episode 2; we validate episode 1 → its edge is out of scope.
    const outcome = await runEpisodeChargeMaterialization({
      scenePlan: heavyPayoffPlan(2),
      episodeNumber: 1,
      choiceSets: HOLLOW_CHOICE_SETS,
    });
    expect(outcome.ran).toBe(true);
    expect(outcome.result?.issues.some((i) => i.severity === 'error')).toBe(false);
  });
});

// --- season-plan convenience seam (the monolith call site) ---------------

describe('runEpisodeChargeMaterializationForSeason', () => {
  it('no-ops when the season plan has no scene plan (non-scene-first mode)', async () => {
    process.env.CONVERGENCE_LEDGER = '1';
    const persist = vi.fn();
    const outcome = await runEpisodeChargeMaterializationForSeason(
      { scenePlan: undefined } as unknown as SeasonPlan,
      1,
      HOLLOW_CHOICE_SETS,
      persist,
    );
    expect(outcome).toEqual({ ran: false });
    expect(persist).not.toHaveBeenCalled();
  });

  it('no-ops when seasonPlan is undefined', async () => {
    process.env.CONVERGENCE_LEDGER = '1';
    expect(await runEpisodeChargeMaterializationForSeason(undefined, 1, HOLLOW_CHOICE_SETS)).toEqual({
      ran: false,
    });
  });

  it('runs the gate off the season scene plan and blocks a hollow branch under the gate flag', async () => {
    process.env.CONVERGENCE_LEDGER = '1';
    process.env.GATE_CHARGE_MATERIALIZATION = '1';
    const seasonPlan = { scenePlan: heavyPayoffPlan() } as unknown as SeasonPlan;
    await expect(
      runEpisodeChargeMaterializationForSeason(seasonPlan, 1, HOLLOW_CHOICE_SETS),
    ).rejects.toThrow(/hollow branch/i);
  });
});

// --- helpers --------------------------------------------------------------

describe('projectSceneConsequences', () => {
  it('flattens choices per scene and merges multiple sets on one scene; skips sceneId-less sets', () => {
    const projected = projectSceneConsequences([
      { sceneId: 'a', choices: [{ consequences: [{ type: 'setFlag', flag: 'f1', value: true }] }] },
      { sceneId: 'a', choices: [{ consequences: [{ type: 'changeScore', score: 'suspicion', change: 5 }] }] },
      { choices: [{ consequences: [{ type: 'setFlag', flag: 'orphan', value: true }] }] },
      { sceneId: 'b', choices: [{ consequences: undefined }] },
    ]);
    const a = projected.find((p) => p.sceneId === 'a');
    expect(a?.consequences).toHaveLength(2);
    // The set with no sceneId is dropped; 'b' survives with an empty bucket.
    expect(projected.map((p) => p.sceneId).sort()).toEqual(['a', 'b']);
    expect(projected.find((p) => p.sceneId === 'b')?.consequences).toEqual([]);
  });
});

describe('buildMaterializationTargets', () => {
  it('maps crossings only when CHARGE_STATS is on and roadblocks only when CHARGE_COMPETENCE is on', () => {
    const crossings = [
      { source: 'relationship' as const, anchorId: 'vale', from: 's0', to: 'payoff' },
    ];
    const roadblocks = [
      { source: 'skill' as const, anchorId: 'milestone:test', skill: 'lockpick', from: 's0', to: 'payoff', gateLevel: 3 },
    ];

    // Both flags off → no targets.
    expect(buildMaterializationTargets({ trajectoryCrossings: crossings, roadblocks })).toEqual({});

    process.env.CHARGE_STATS = '1';
    const statsOnly = buildMaterializationTargets({ trajectoryCrossings: crossings, roadblocks });
    expect(statsOnly[edgeKey({ from: 's0', to: 'payoff', source: 'relationship' })]).toEqual({
      dimension: 'vale',
      direction: 0,
    });
    expect(statsOnly[edgeKey({ from: 's0', to: 'payoff', source: 'skill' })]).toBeUndefined();

    process.env.CHARGE_COMPETENCE = '1';
    const both = buildMaterializationTargets({ trajectoryCrossings: crossings, roadblocks });
    expect(both[edgeKey({ from: 's0', to: 'payoff', source: 'skill' })]).toEqual({
      dimension: 'lockpick',
      direction: 1,
    });
  });
});
