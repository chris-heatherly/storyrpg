import { describe, expect, it } from 'vitest';
import { extractEpisodeKnowledge, collectReferencedFlags, factSlug } from './knowledgeExtraction';

describe('factSlug', () => {
  it('is a stable deterministic slug', () => {
    expect(factSlug('Lysandra is the Codex key!')).toBe('lysandra-is-the-codex-key');
    expect(factSlug('  ???  ')).toBe('fact');
  });
});

describe('extractEpisodeKnowledge', () => {
  it('seals character knowledge + world facts and emits flag claims', () => {
    const r = extractEpisodeKnowledge({
      episodeNumber: 2,
      protagonistId: 'protagonist',
      characterKnowledge: [
        { characterId: 'lysandra', knows: ['her own goal: open the Codex', 'her own goal: open the Codex'] }, // dup → once
        { characterId: 'galen', knows: ['Vraxxan engineered the war'] },
      ],
      timelineEvents: [{ event: 'The ambush at the pass', when: 'Scene 2' }],
      referencedFlags: ['lysandra_trusted', 'lysandra_trusted'], // dup → once
    });
    expect(r.deltas.knowledge).toEqual([
      { characterId: 'lysandra', factId: 'know:her-own-goal-open-the-codex', summary: 'her own goal: open the Codex' },
      { characterId: 'galen', factId: 'know:vraxxan-engineered-the-war', summary: 'Vraxxan engineered the war' },
    ]);
    expect(r.deltas.worldFacts?.[0]).toMatchObject({ id: 'wf:the-ambush-at-the-pass' });
    expect(r.claims).toEqual([
      { characterId: 'protagonist', factId: 'flag:lysandra_trusted', episode: 2, summary: 'references lysandra_trusted' },
    ]);
  });

  it('is empty when given nothing', () => {
    const r = extractEpisodeKnowledge({ episodeNumber: 1, protagonistId: 'protagonist' });
    expect(r.deltas.knowledge).toEqual([]);
    expect(r.claims).toEqual([]);
  });
});

describe('collectReferencedFlags', () => {
  it('pulls flag names from beat/choice/variant conditions (nested and/or)', () => {
    const ep = {
      scenes: [
        {
          beats: [
            { conditions: { type: 'flag', flag: 'a', value: true } },
            {
              choices: [{ conditions: { and: [{ type: 'flag', flag: 'b' }, { type: 'flag', flag: 'a' }] } }],
              textVariants: [{ condition: { type: 'flag', flag: 'c', value: true } }],
            },
          ],
        },
      ],
    };
    expect(collectReferencedFlags(ep as any).sort()).toEqual(['a', 'b', 'c']);
  });

  it('handles an undefined episode', () => {
    expect(collectReferencedFlags(undefined)).toEqual([]);
  });
});
