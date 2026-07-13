import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

interface CorpusCase {
  id: string;
  category: string;
  proposition: string;
  excerpts: string[];
  expected: 'fulfilled' | 'partial' | 'not_fulfilled' | 'contradicted';
}

describe('semantic realization evaluation corpus', () => {
  it('keeps the required human-labeled paraphrase and false-positive classes addressable', () => {
    const corpus = JSON.parse(fs.readFileSync(path.join(
      __dirname,
      '__fixtures__',
      'semantic-realization-corpus.json',
    ), 'utf8')) as CorpusCase[];
    const categories = new Set(corpus.map((entry) => entry.category));

    expect(new Set(corpus.map((entry) => entry.id)).size).toBe(corpus.length);
    expect([...categories]).toEqual(expect.arrayContaining([
      'direct', 'paraphrase', 'indirect_valid', 'partial', 'summary_only', 'metadata_only',
      'intent_not_completion', 'contradiction', 'negation', 'reference_vs_restage',
      'wrong_character', 'wrong_location', 'wrong_route', 'wrong_tier', 'wrong_surface', 'invitation_vs_formation',
      'chemistry_vs_transition', 'setup_vs_payoff', 'encounter_surface',
    ]));
    for (const entry of corpus) {
      expect(entry.proposition.trim()).not.toBe('');
      expect(entry.excerpts.length).toBeGreaterThan(0);
      expect(['fulfilled', 'partial', 'not_fulfilled', 'contradicted']).toContain(entry.expected);
    }
  });
});
