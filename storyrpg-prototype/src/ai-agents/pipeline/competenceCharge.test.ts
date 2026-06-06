/**
 * Phase 5b (`CHARGE_COMPETENCE`) — competence-loop charge tests
 * (Plan Part 5 §Competence loop + Part 9).
 *
 * A heavy-tier moment gated on a skill/attribute level N is a `skill`/`attribute`
 * roadblock edge carrying `gateLevel`, anchored on an authored object (no
 * anchorless walls). The OVERCOME of a previously-failed wall carries
 * `overcomesPriorFailure: true` and an elevated magnitude.
 *
 * Covered:
 *  - flag OFF → roadblocks ignored; ledger byte-identical to Phase 5 (unchanged);
 *  - flag ON  → a roadblock projects into an anchored skill edge with gateLevel;
 *  - an overcome edge carries ELEVATED charge vs a plain roadblock;
 *  - anchorless roadblocks are dropped (no anchorless skill walls);
 *  - determinism.
 */

import { afterEach, describe, expect, it } from 'vitest';
import {
  buildConvergenceLedger,
  type SkillRoadblock,
} from './convergenceLedgerBuilder';
import type { SeasonScenePlan, SetupPayoffEdge } from '../../types/scenePlan';

function planWith(edges: SetupPayoffEdge[], sceneIds: string[]): SeasonScenePlan {
  return {
    scenes: sceneIds.map((id, i) => ({
      id,
      episodeNumber: 1,
      order: i,
      kind: 'standard' as const,
      title: id,
      dramaticPurpose: 'x',
      narrativeRole: 'development' as const,
      locations: [],
      npcsInvolved: [],
      setsUp: [],
      paysOff: [],
    })),
    byEpisode: { 1: sceneIds },
    setupPayoffEdges: edges,
  };
}

const wall: SkillRoadblock = {
  source: 'skill',
  anchorId: 'milestone:infiltration-test',
  skill: 'infiltration',
  from: 's0',
  to: 'wall',
  gateLevel: 4,
};

afterEach(() => {
  delete process.env.CHARGE_COMPETENCE;
});

describe('Phase 5b — flag gating (CHARGE_COMPETENCE)', () => {
  it('flag OFF: roadblocks are ignored — ledger identical to Phase 5', () => {
    delete process.env.CHARGE_COMPETENCE;
    const plan = planWith([{ from: 's0', to: 'wall', span: 'same_episode' }], ['s0', 'wall']);

    const withRoadblocks = buildConvergenceLedger(plan, { roadblocks: [wall] });
    const without = buildConvergenceLedger(plan);

    expect(JSON.stringify(withRoadblocks)).toBe(JSON.stringify(without));
    expect(withRoadblocks.edges).toHaveLength(1);
    expect(withRoadblocks.edges[0].source).toBe('setupPayoff');
  });

  it('flag ON: a roadblock projects into an anchored skill edge with gateLevel', () => {
    process.env.CHARGE_COMPETENCE = '1';
    const plan = planWith([], ['s0', 'wall']);
    const ledger = buildConvergenceLedger(plan, { roadblocks: [wall] });

    const skillEdges = ledger.edges.filter((e) => e.source === 'skill');
    expect(skillEdges).toHaveLength(1);
    expect(skillEdges[0]).toMatchObject({
      from: 's0',
      to: 'wall',
      anchorId: 'milestone:infiltration-test',
      gateLevel: 4,
    });
    expect(skillEdges[0].overcomesPriorFailure).toBeUndefined();
  });
});

describe('Phase 5b — overcome carries elevated charge (Part 5 step 4)', () => {
  it('an overcome edge has higher magnitude than a plain roadblock', () => {
    process.env.CHARGE_COMPETENCE = '1';
    const plan = planWith([], ['s0', 'wall']);

    const plain = buildConvergenceLedger(plan, { roadblocks: [wall] })
      .edges.find((e) => e.source === 'skill')!;
    const overcome = buildConvergenceLedger(plan, {
      roadblocks: [{ ...wall, overcomesPriorFailure: true }],
    }).edges.find((e) => e.source === 'skill')!;

    expect(overcome.overcomesPriorFailure).toBe(true);
    expect(overcome.magnitude).toBeGreaterThan(plain.magnitude);
  });

  it('attribute roadblocks project too, with gateLevel', () => {
    process.env.CHARGE_COMPETENCE = '1';
    const plan = planWith([], ['s0', 'wall']);
    const ledger = buildConvergenceLedger(plan, {
      roadblocks: [{ ...wall, source: 'attribute', anchorId: 'thread:resolve-arc' }],
    });
    const attrEdges = ledger.edges.filter((e) => e.source === 'attribute');
    expect(attrEdges).toHaveLength(1);
    expect(attrEdges[0].gateLevel).toBe(4);
  });
});

describe('Phase 5b — no anchorless skill walls (Part 5 story-first)', () => {
  it('drops a roadblock with a blank anchorId', () => {
    process.env.CHARGE_COMPETENCE = '1';
    const plan = planWith([], ['s0', 'wall']);
    const ledger = buildConvergenceLedger(plan, {
      roadblocks: [{ ...wall, anchorId: '   ' }],
    });
    expect(ledger.edges.filter((e) => e.source === 'skill')).toHaveLength(0);
  });
});

describe('Phase 5b — determinism', () => {
  it('same input yields byte-identical ledger', () => {
    process.env.CHARGE_COMPETENCE = '1';
    const plan = planWith([], ['s0', 'wall']);
    const a = buildConvergenceLedger(plan, { roadblocks: [wall] });
    const b = buildConvergenceLedger(plan, { roadblocks: [wall] });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
