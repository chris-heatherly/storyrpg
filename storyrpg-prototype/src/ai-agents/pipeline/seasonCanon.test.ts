import { describe, expect, it } from 'vitest';
import { SeasonCanon, CanonSealError, relationshipPairKey } from './seasonCanon';

describe('SeasonCanon sealing + immutability', () => {
  it('seals an episode and exposes its facts', () => {
    const canon = new SeasonCanon();
    canon.sealEpisode(1, {
      worldFacts: [{ id: 'wf1', statement: 'The chain binds the worlds.' }],
      knowledge: [{ characterId: 'vraxxan', factId: 'aeth-decision', summary: "Aethavyr's decision" }],
    });
    expect(canon.isSealed(1)).toBe(true);
    expect(canon.worldFactsAsOf(1).map((f) => f.id)).toEqual(['wf1']);
    expect(canon.knows('vraxxan', 'aeth-decision', 1)).toBe(true);
  });

  it('rejects re-sealing a sealed episode (append-only)', () => {
    const canon = new SeasonCanon();
    canon.sealEpisode(1, {});
    expect(() => canon.sealEpisode(1, {})).toThrow(CanonSealError);
  });

  it('fixes a fact establishedEpisode at first seal; a later re-declare does not move it', () => {
    const canon = new SeasonCanon();
    canon.sealEpisode(1, { worldFacts: [{ id: 'wf1', statement: 'first' }] });
    canon.sealEpisode(2, { worldFacts: [{ id: 'wf1', statement: 'second (ignored)' }] });
    const f = canon.worldFactsAsOf(2).find((x) => x.id === 'wf1')!;
    expect(f.establishedEpisode).toBe(1);
    expect(f.statement).toBe('first');
  });

  it('carries a numeric monotonic fact forward to the max (increasing) on re-declare', () => {
    const canon = new SeasonCanon();
    canon.sealEpisode(1, {
      worldFacts: [{ id: 'metric:views', statement: 'views count stands at 84,000', numericValue: 84000, monotonic: 'increasing' }],
    });
    canon.sealEpisode(2, {
      worldFacts: [{ id: 'metric:views', statement: 'views count stands at 90,147', numericValue: 90147, monotonic: 'increasing' }],
    });
    const f = canon.worldFactsAsOf(2).find((x) => x.id === 'metric:views')!;
    expect(f.numericValue).toBe(90147);
    expect(f.statement).toContain('90,147');
    expect(f.establishedEpisode).toBe(1); // first-established stays
    expect(canon.numericViolationsLog()).toHaveLength(0);
  });

  it('records a violation (and keeps the higher value) when an increasing fact regresses', () => {
    const canon = new SeasonCanon();
    canon.sealEpisode(2, {
      worldFacts: [{ id: 'metric:views', statement: 'views count stands at 90,147', numericValue: 90147, monotonic: 'increasing' }],
    });
    canon.sealEpisode(3, {
      worldFacts: [{ id: 'metric:views', statement: 'views count stands at 50,000', numericValue: 50000, monotonic: 'increasing' }],
    });
    const f = canon.worldFactsAsOf(3).find((x) => x.id === 'metric:views')!;
    expect(f.numericValue).toBe(90147); // regression rejected
    const violations = canon.numericViolationsLog();
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({ id: 'metric:views', keptValue: 90147, incomingValue: 50000, episode: 3 });
  });

  it('keeps the min for a decreasing monotonic fact', () => {
    const canon = new SeasonCanon();
    canon.sealEpisode(1, {
      worldFacts: [{ id: 'metric:fuel', statement: 'fuel at 100', numericValue: 100, monotonic: 'decreasing' }],
    });
    canon.sealEpisode(2, {
      worldFacts: [{ id: 'metric:fuel', statement: 'fuel at 40', numericValue: 40, monotonic: 'decreasing' }],
    });
    expect(canon.worldFactsAsOf(2).find((x) => x.id === 'metric:fuel')!.numericValue).toBe(40);
    canon.sealEpisode(3, {
      worldFacts: [{ id: 'metric:fuel', statement: 'fuel at 70', numericValue: 70, monotonic: 'decreasing' }],
    });
    expect(canon.worldFactsAsOf(3).find((x) => x.id === 'metric:fuel')!.numericValue).toBe(40); // increase rejected
    expect(canon.numericViolationsLog()).toHaveLength(1);
  });

  it('leaves non-numeric re-declares append-only (first establishment stands)', () => {
    const canon = new SeasonCanon();
    canon.sealEpisode(1, { worldFacts: [{ id: 'metric:views', statement: 'views at 84,000', numericValue: 84000, monotonic: 'increasing' }] });
    // A later re-declare WITHOUT numeric metadata must not disturb the frozen value.
    canon.sealEpisode(2, { worldFacts: [{ id: 'metric:views', statement: 'views mentioned again' }] });
    const f = canon.worldFactsAsOf(2).find((x) => x.id === 'metric:views')!;
    expect(f.numericValue).toBe(84000);
    expect(f.statement).toBe('views at 84,000');
  });

  it('canonForPrompt surfaces the no-regression constraint on a numeric fact', () => {
    const canon = new SeasonCanon();
    canon.sealEpisode(1, { worldFacts: [{ id: 'metric:views', statement: 'blog views', numericValue: 90147, monotonic: 'increasing' }] });
    expect(canon.canonForPrompt(1)).toContain('at least 90,147 (must not regress)');
  });

  it('round-trips numeric facts + violations through serialize/deserialize', () => {
    const canon = new SeasonCanon();
    canon.sealEpisode(1, { worldFacts: [{ id: 'metric:views', statement: 'v', numericValue: 90147, monotonic: 'increasing' }] });
    canon.sealEpisode(2, { worldFacts: [{ id: 'metric:views', statement: 'v', numericValue: 50000, monotonic: 'increasing' }] });
    const restored = SeasonCanon.deserialize(canon.serialize());
    expect(restored.worldFactsAsOf(2).find((x) => x.id === 'metric:views')!.numericValue).toBe(90147);
    expect(restored.numericViolationsLog()).toHaveLength(1);
  });

  it('knowledge respects as-of episode', () => {
    const canon = new SeasonCanon();
    canon.sealEpisode(3, { knowledge: [{ characterId: 'c', factId: 'k', summary: 's' }] });
    expect(canon.knows('c', 'k', 2)).toBe(false);
    expect(canon.knows('c', 'k', 3)).toBe(true);
    expect(canon.knowledgeEstablishedEpisode('c', 'k')).toBe(3);
  });

  it('accumulates relationship values by episode under a canonical pair key', () => {
    const canon = new SeasonCanon();
    canon.sealEpisode(1, { relationships: [{ a: 'b', b: 'a', dimension: 'trust', value: 2 }] });
    const ser = canon.serialize();
    expect(ser.relationships[0].pairKey).toBe(relationshipPairKey('a', 'b'));
    expect(ser.relationships[0].valueByEpisode[1]).toBe(2);
  });

  it('canonForPrompt renders an authoritative snapshot as-of an episode', () => {
    const canon = new SeasonCanon();
    canon.sealEpisode(1, { worldFacts: [{ id: 'wf1', statement: 'Alpha fact' }] });
    canon.sealEpisode(2, { worldFacts: [{ id: 'wf2', statement: 'Bravo fact' }] });
    const asOf1 = canon.canonForPrompt(1);
    expect(asOf1).toContain('ESTABLISHED CANON');
    expect(asOf1).toContain('Alpha fact');
    expect(asOf1).not.toContain('Bravo fact');
  });

  it('canonForPrompt surfaces the LATEST sealed arc state and relationship standing as-of an episode', () => {
    const canon = new SeasonCanon();
    canon.sealEpisode(1, {
      arcStates: [{ characterId: 'kylie', state: 'guarded, testing loyalty' }],
      relationships: [{ a: 'kylie', b: 'mika', dimension: 'trust', value: 5 }],
    });
    canon.sealEpisode(2, {
      arcStates: [{ characterId: 'kylie', state: 'committed, post-betrayal resolve' }],
      relationships: [{ a: 'kylie', b: 'mika', dimension: 'trust', value: -10 }],
    });
    const asOf1 = canon.canonForPrompt(1);
    expect(asOf1).toContain('kylie arc state: guarded, testing loyalty');
    expect(asOf1).toContain('trust stands at 5');
    expect(asOf1).not.toContain('post-betrayal');
    const asOf2 = canon.canonForPrompt(2);
    expect(asOf2).toContain('kylie arc state: committed, post-betrayal resolve');
    expect(asOf2).not.toContain('guarded, testing loyalty');
    expect(asOf2).toContain('trust stands at -10');
  });

  it('arcStatesAsOf / relationshipsAsOf return empty before anything is sealed', () => {
    const canon = new SeasonCanon();
    expect(canon.arcStatesAsOf(5)).toEqual([]);
    expect(canon.relationshipsAsOf(5)).toEqual([]);
    expect(canon.canonForPrompt(5)).toBe('');
  });

  it('round-trips through serialize/deserialize', () => {
    const canon = new SeasonCanon({ storyId: 'story-1' });
    canon.sealEpisode(1, {
      worldFacts: [{ id: 'wf1', statement: 'A' }],
      knowledge: [{ characterId: 'c', factId: 'k', summary: 's' }],
      arcStates: [{ characterId: 'c', state: 'wary' }],
    });
    const restored = SeasonCanon.deserialize(canon.serialize());
    expect(restored.isSealed(1)).toBe(true);
    expect(restored.knows('c', 'k', 1)).toBe(true);
    expect(restored.worldFactsAsOf(1)).toHaveLength(1);
  });
});
