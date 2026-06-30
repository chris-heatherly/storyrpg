import { describe, expect, it } from 'vitest';
import { ArcDeltaValidator, ArcDeltaInput } from './ArcDeltaValidator';
import { CharacterArcTargets } from '../agents/CharacterArcTracker';

function buildTargets(overrides: Partial<CharacterArcTargets> = {}): CharacterArcTargets {
  return {
    episodeId: 'ep-01',
    identityTargets: [
      { axis: 'mercy_justice', delta: 15, rationale: 'Episode pushes toward justice.' },
    ],
    relationshipTargets: [
      {
        npcId: 'mara',
        trustDelta: -10,
        bondDelta: 8,
        trajectory: 'warm → guarded but loyal',
        rationale: 'Trust cracks, bond deepens.',
      },
    ],
    milestones: [],
    arcPhaseHeadline: 'The cost of conviction',
    ...overrides,
  };
}

describe('ArcDeltaValidator', () => {
  it('passes when observed identity and relationship deltas land on planned targets', () => {
    const input: ArcDeltaInput = {
      targets: buildTargets(),
      startIdentity: { mercy_justice: 0 },
      endIdentity: { mercy_justice: 16 }, // planned +15, observed +16: within tolerance
      relationshipDeltas: {
        mara: { trust: -9, bond: 7 }, // both within ±5 of planned (-10, +8)
      },
    };

    const result = new ArcDeltaValidator().validate(input);

    expect(result.valid).toBe(true);
    expect(result.issues.filter((i) => i.severity === 'error')).toHaveLength(0);
    expect(result.score).toBe(100);
    expect(result.metrics.identityTargetsHit).toBe(1);
    expect(result.metrics.relationshipTargetsHit).toBe(1);
  });

  it('flags an error when an identity axis moves opposite the planned direction', () => {
    const input: ArcDeltaInput = {
      targets: buildTargets({ relationshipTargets: [] }),
      startIdentity: { mercy_justice: 0 },
      endIdentity: { mercy_justice: -20 }, // planned +15, observed -20: wrong direction
    };

    const result = new ArcDeltaValidator().validate(input);

    expect(result.valid).toBe(false);
    const errorIssue = result.issues.find((i) => i.severity === 'error');
    expect(errorIssue).toBeDefined();
    expect(errorIssue?.message).toContain('moved opposite');
    expect(errorIssue?.message).toContain('mercy_justice');
    expect(result.metrics.identityTargetsHit).toBe(0);
    expect(result.score).toBe(0);
  });

  it('warns (not errors) when a relationship axis falls short of its planned delta', () => {
    const input: ArcDeltaInput = {
      targets: buildTargets({ identityTargets: [] }),
      relationshipDeltas: {
        mara: { trust: -1, bond: 1 }, // planned trust -10 / bond +8: both fall short, right direction
      },
    };

    const result = new ArcDeltaValidator().validate(input);

    expect(result.valid).toBe(true); // shortfalls are warnings, not errors
    expect(result.issues.every((i) => i.severity === 'warning')).toBe(true);
    expect(result.issues.some((i) => i.message.includes('trust'))).toBe(true);
    expect(result.metrics.relationshipTargetsHit).toBe(0);
    expect(result.suggestions.length).toBeGreaterThan(0);
  });
});
