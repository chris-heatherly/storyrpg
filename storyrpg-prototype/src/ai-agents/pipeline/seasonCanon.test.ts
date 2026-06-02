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
