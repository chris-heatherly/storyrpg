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
  it('extracts a grouped view count and keys it on a stable id', () => {
    expect(extractMonotonicMetrics('The blog hit 90,147 views overnight.')).toEqual([
      { id: 'metric:views', metric: 'views', value: 90147, statement: 'views count stands at 90,147' },
    ]);
  });

  it('keeps the highest value when a metric appears more than once', () => {
    const m = extractMonotonicMetrics('500 views in the morning, then 12,300 views by night.');
    expect(m).toEqual([{ id: 'metric:views', metric: 'views', value: 12300, statement: 'views count stands at 12,300' }]);
  });

  it('matches a number a couple words before the noun (followers)', () => {
    const m = extractMonotonicMetrics('She now has 2,000 loyal followers.');
    expect(m[0]).toMatchObject({ id: 'metric:followers', value: 2000 });
  });

  it('does not match an unrelated quantity (conservative — no fabrication)', () => {
    expect(extractMonotonicMetrics('Fifty thousand readers cheered.')).toEqual([]); // spelled-out not parsed
    expect(extractMonotonicMetrics('There were 50 soldiers at the gate.')).toEqual([]);
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
    expect(extractMonotonicMetrics(corpus)[0]).toMatchObject({ id: 'metric:views', value: 90147 });
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
    const metric = r.deltas.worldFacts?.find((f) => f.id === 'metric:views');
    expect(metric).toMatchObject({ id: 'metric:views', numericValue: 90147, monotonic: 'increasing' });
  });

  it('scans sceneText for metrics too', () => {
    const r = extractEpisodeKnowledge({
      episodeNumber: 1,
      protagonistId: 'protagonist',
      sceneText: 'Her readership crossed 84,000 readers that week.',
    });
    expect(r.deltas.worldFacts?.find((f) => f.id === 'metric:readers')).toMatchObject({ numericValue: 84000 });
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
