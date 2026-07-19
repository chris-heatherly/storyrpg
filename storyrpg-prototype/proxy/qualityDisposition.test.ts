import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { deriveLegacyDisposition, isReaderEligible } = require('./qualityDisposition.js');

describe('proxy quality disposition', () => {
  it('derives r127-style caps for diagnostics without retroactively withdrawing the package', () => {
    const disposition = deriveLegacyDisposition({
      qualityScore: 74,
      qualityScoreBasis: { caps: [{ id: 'unrepaired_contract_semantic', maxScore: 74 }] },
    });
    expect(disposition).toMatchObject({ status: 'held', band: 'warn', eligibleForReader: false });
    expect(isReaderEligible(disposition)).toBe(true);
  });

  it('enforces an explicit held disposition', () => {
    expect(isReaderEligible({
      version: 1,
      status: 'held',
      band: 'warn',
      eligibleForReader: false,
      reasonCodes: ['best_known_regression'],
      score: 74,
      capIds: [],
      blockingCapCount: 0,
      qaEvidenceStale: false,
      createdAt: '2026-07-19T00:00:00Z',
    })).toBe(false);
  });

  it('grandfathers packages that predate quality evidence', () => {
    expect(isReaderEligible(null)).toBe(true);
  });
});
