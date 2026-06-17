import { describe, expect, it } from 'vitest';
import {
  extractEpisodeKnowledge,
  collectReferencedFlags,
  factSlug,
  extractMonotonicMetrics,
  episodeProseCorpus,
} from './knowledgeExtraction';

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

describe('extractMonotonicMetrics', () => {
  it('extracts a grouped view count under the unified readership id', () => {
    expect(extractMonotonicMetrics('The blog hit 90,147 views overnight.')).toEqual([
      { id: 'metric:readership', metric: 'readership', value: 90147, statement: 'readership count stands at 90,147' },
    ]);
  });

  it('keeps the highest value when a metric appears more than once', () => {
    const m = extractMonotonicMetrics('500 views in the morning, then 12,300 views by night.');
    expect(m).toEqual([{ id: 'metric:readership', metric: 'readership', value: 12300, statement: 'readership count stands at 12,300' }]);
  });

  it('unifies readership synonyms (views/reads) under one id so wording drift still compares', () => {
    // ep-style: "views" early, bare "reads" later — both must land on metric:readership.
    expect(extractMonotonicMetrics('84,000 views')[0]).toMatchObject({ id: 'metric:readership', value: 84000 });
    expect(extractMonotonicMetrics('cleared 50,001 reads')[0]).toMatchObject({ id: 'metric:readership', value: 50001 });
  });

  it('catches the g17 noun-less counter phrasing ("clicks over. 50,001")', () => {
    const m = extractMonotonicMetrics("The number beneath 'Dating After Dusk' clicks over. 50,001.");
    expect(m).toEqual([{ id: 'metric:readership', metric: 'readership', value: 50001, statement: 'readership count stands at 50,001' }]);
  });

  it('makes the g17 regression detectable: ep1 84,000 → ep2 91,428 → ep3 50,001 all under one id', () => {
    const ep1 = extractMonotonicMetrics('The post does 84,000 views in a week.')[0];
    const ep2 = extractMonotonicMetrics('Dating After Dusk passes 91,428 views.')[0];
    const ep3 = extractMonotonicMetrics('The number clicks over. 50,001.')[0];
    expect([ep1.id, ep2.id, ep3.id]).toEqual(['metric:readership', 'metric:readership', 'metric:readership']);
    // ep3 < ep2 under the same id → SeasonCanon.sealEpisode logs a numeric violation (was undetected in g17).
    expect(ep3.value).toBeLessThan(ep2.value);
  });

  it('matches a number a couple words before the noun (followers stays its own metric)', () => {
    const m = extractMonotonicMetrics('She now has 2,000 loyal followers.');
    expect(m[0]).toMatchObject({ id: 'metric:followers', value: 2000 });
  });

  it('does not match an unrelated quantity (conservative — no fabrication)', () => {
    expect(extractMonotonicMetrics('Fifty thousand readers cheered.')).toEqual([]); // spelled-out not parsed
    expect(extractMonotonicMetrics('There were 50 soldiers at the gate.')).toEqual([]);
    expect(extractMonotonicMetrics('The line passes 12 people ahead of you.')).toEqual([]); // verb but < 1000 floor
  });
});

describe('episodeProseCorpus', () => {
  it('gathers beat text + choice outcome texts into one corpus the metric extractor can read', () => {
    const episode = {
      scenes: [
        { beats: [
          { text: 'The post detonates.', choices: [{ outcomeTexts: { success: 'The counter hits 90,147 views.' } }] },
          { text: 'She refreshes the page.' },
        ] },
      ],
    };
    const corpus = episodeProseCorpus(episode);
    expect(corpus).toContain('The post detonates.');
    expect(corpus).toContain('90,147 views');
    expect(extractMonotonicMetrics(corpus)[0]).toMatchObject({ id: 'metric:readership', value: 90147 });
  });

  it('is empty-safe for a missing or sceneless episode', () => {
    expect(episodeProseCorpus(undefined)).toBe('');
    expect(episodeProseCorpus({})).toBe('');
  });
});

describe('extractEpisodeKnowledge — numeric metrics', () => {
  it('emits a numeric monotonic worldFact from timeline + scene text', () => {
    const r = extractEpisodeKnowledge({
      episodeNumber: 2,
      protagonistId: 'protagonist',
      timelineEvents: [{ event: 'The post climbed to 90,147 views', when: 'Scene 1' }],
    });
    const metric = r.deltas.worldFacts?.find((f) => f.id === 'metric:readership');
    expect(metric).toMatchObject({ id: 'metric:readership', numericValue: 90147, monotonic: 'increasing' });
  });

  it('scans sceneText for metrics too', () => {
    const r = extractEpisodeKnowledge({
      episodeNumber: 1,
      protagonistId: 'protagonist',
      sceneText: 'Her readership crossed 84,000 readers that week.',
    });
    expect(r.deltas.worldFacts?.find((f) => f.id === 'metric:readership')).toMatchObject({ numericValue: 84000 });
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
