import { describe, expect, it } from 'vitest';
import { SeasonCanon } from '../pipeline/seasonCanon';
import { validateKnowledgeConsistency, validateCanonConsistency } from './canonConsistencyValidator';

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
