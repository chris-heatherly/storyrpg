import { describe, expect, it } from 'vitest';
import { SeasonCanon } from '../pipeline/seasonCanon';
import {
  validateKnowledgeConsistency,
  validateCanonConsistency,
  validateNumericMonotonicity,
} from './canonConsistencyValidator';

function canonWithReveal(characterId: string, factId: string, episode: number): SeasonCanon {
  const canon = new SeasonCanon();
  canon.sealEpisode(episode, { knowledge: [{ characterId, factId, summary: 'the secret' }] });
  return canon;
}

describe('validateKnowledgeConsistency', () => {
  it('flags acting on a fact before it is learned (impossible knowledge)', () => {
    const canon = canonWithReveal('vraxxan', 'aeth-decision', 3);
    const issues = validateKnowledgeConsistency(
      [{ characterId: 'vraxxan', factId: 'aeth-decision', episode: 2, summary: "Aethavyr's decision" }],
      canon,
    );
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe('error');
    expect(issues[0].location).toBe('knowledge:vraxxan:aeth-decision');
  });

  it('passes when the fact is known at or before the claim episode', () => {
    const canon = canonWithReveal('vraxxan', 'aeth-decision', 2);
    expect(
      validateKnowledgeConsistency([{ characterId: 'vraxxan', factId: 'aeth-decision', episode: 2 }], canon),
    ).toHaveLength(0);
    expect(
      validateKnowledgeConsistency([{ characterId: 'vraxxan', factId: 'aeth-decision', episode: 3 }], canon),
    ).toHaveLength(0);
  });

  it('does not flag an unknown factId (treated as newly introduced this episode)', () => {
    const canon = new SeasonCanon();
    expect(
      validateKnowledgeConsistency([{ characterId: 'c', factId: 'brand-new', episode: 1 }], canon),
    ).toHaveLength(0);
  });

  it('combined gate is invalid on an impossible-knowledge claim', () => {
    const canon = canonWithReveal('c', 'k', 4);
    const result = validateCanonConsistency({ canon, claims: [{ characterId: 'c', factId: 'k', episode: 1 }] });
    expect(result.valid).toBe(false);
  });
});

describe('validateNumericMonotonicity', () => {
  function canonWithRegression(): SeasonCanon {
    const canon = new SeasonCanon();
    canon.sealEpisode(2, {
      worldFacts: [{ id: 'metric:views', statement: 'views count stands at 90,147', numericValue: 90147, monotonic: 'increasing' }],
    });
    canon.sealEpisode(3, {
      worldFacts: [{ id: 'metric:views', statement: 'views count stands at 50,000', numericValue: 50000, monotonic: 'increasing' }],
    });
    return canon;
  }

  it('flags a regressing numeric fact as an advisory warning (not blocking)', () => {
    const issues = validateNumericMonotonicity(canonWithRegression());
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe('warning');
    expect(issues[0].location).toBe('numeric:metric:views');
    expect(issues[0].message).toContain('90,147');
  });

  it('reports nothing when no numeric constraint was breached', () => {
    const canon = new SeasonCanon();
    canon.sealEpisode(1, {
      worldFacts: [{ id: 'metric:views', statement: 'v', numericValue: 84000, monotonic: 'increasing' }],
    });
    canon.sealEpisode(2, {
      worldFacts: [{ id: 'metric:views', statement: 'v', numericValue: 90147, monotonic: 'increasing' }],
    });
    expect(validateNumericMonotonicity(canon)).toHaveLength(0);
  });

  it('combined gate stays VALID on a numeric regression (advisory only)', () => {
    const result = validateCanonConsistency({ canon: canonWithRegression(), claims: [] });
    expect(result.valid).toBe(true);
    expect(result.issues.some((i) => i.severity === 'warning' && i.location === 'numeric:metric:views')).toBe(true);
  });
});
