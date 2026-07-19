/** Deterministic retrieval metrics for curated StoryRPG memory fixtures. */
export interface MemoryRetrievalFixture {
  id: string;
  expectedSourceIds: string[];
  returnedSourceIds: string[];
}

export interface MemoryRetrievalMetrics {
  fixtureCount: number;
  hitAtK: number;
  meanReciprocalRank: number;
  precisionAtK: number;
}

/**
 * Measures source-level relevance only. Generation quality remains separately
 * judged against canonical artifacts; this never promotes Cognee to authority.
 */
export function evaluateMemoryRetrieval(fixtures: MemoryRetrievalFixture[], k = 5): MemoryRetrievalMetrics {
  if (!fixtures.length) return { fixtureCount: 0, hitAtK: 0, meanReciprocalRank: 0, precisionAtK: 0 };
  const limit = Math.max(1, k);
  let hits = 0;
  let reciprocalRanks = 0;
  let relevantReturned = 0;
  let returnedSlots = 0;
  for (const fixture of fixtures) {
    const expected = new Set(fixture.expectedSourceIds);
    const returned = fixture.returnedSourceIds.slice(0, limit);
    const first = returned.findIndex((sourceId) => expected.has(sourceId));
    if (first >= 0) {
      hits += 1;
      reciprocalRanks += 1 / (first + 1);
    }
    relevantReturned += returned.filter((sourceId) => expected.has(sourceId)).length;
    returnedSlots += returned.length;
  }
  return {
    fixtureCount: fixtures.length,
    hitAtK: hits / fixtures.length,
    meanReciprocalRank: reciprocalRanks / fixtures.length,
    precisionAtK: returnedSlots ? relevantReturned / returnedSlots : 0,
  };
}
