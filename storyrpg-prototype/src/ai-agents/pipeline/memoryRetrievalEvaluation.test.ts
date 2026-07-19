import { describe, expect, it } from 'vitest';
import { evaluateMemoryRetrieval } from './memoryRetrievalEvaluation';

describe('evaluateMemoryRetrieval', () => {
  it('reports source-level retrieval relevance without treating snippets as authority', () => {
    expect(evaluateMemoryRetrieval([
      { id: 'exact', expectedSourceIds: ['scene-1'], returnedSourceIds: ['scene-1', 'noise'] },
      { id: 'ranked', expectedSourceIds: ['validator-1'], returnedSourceIds: ['noise', 'validator-1'] },
      { id: 'miss', expectedSourceIds: ['fact-1'], returnedSourceIds: ['noise'] },
    ], 2)).toEqual({ fixtureCount: 3, hitAtK: 2 / 3, meanReciprocalRank: 0.5, precisionAtK: 0.4 });
  });
});
