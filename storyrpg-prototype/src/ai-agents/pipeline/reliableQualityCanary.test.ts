import { describe, expect, it } from 'vitest';
import {
  CROSS_TREATMENT_FIXTURES,
  biteMeEpisodeOneSealCandidate,
  evaluateDeterministicSeal,
} from '../testing/reliableQualityFixtures';

function diagnostics(
  id: string,
  findings: Array<{ source: string; type: string; message: string }>,
): string {
  if (findings.length === 0) return `${id}: no blockers`;
  return [
    `${id}:`,
    ...findings.map((item) => `- [${item.source}] ${item.type}: ${item.message}`),
  ].join('\n');
}

describe('reliable quality cross-treatment fixture matrix', () => {
  for (const fixture of CROSS_TREATMENT_FIXTURES) {
    it(`${fixture.id} ${fixture.expectedPublishable ? 'seals' : 'fails closed'}`, async () => {
      const result = await evaluateDeterministicSeal(fixture.build(), fixture.focusedChecks);
      expect(
        result.publishable,
        diagnostics(fixture.id, result.findings),
      ).toBe(fixture.expectedPublishable);
      for (const type of fixture.expectedFindingTypes) {
        expect(
          result.findings.map((item) => item.type),
          diagnostics(fixture.id, result.findings),
        ).toContain(type);
      }
    });
  }

  it('keeps representative failure validators blocking rather than accepting warnings', async () => {
    const invalidFixtures = CROSS_TREATMENT_FIXTURES.filter((fixture) => !fixture.expectedPublishable);
    const results = await Promise.all(invalidFixtures.map(async (fixture) => ({
      fixture,
      result: await evaluateDeterministicSeal(fixture.build(), fixture.focusedChecks),
    })));

    expect(results).toHaveLength(6);
    for (const { fixture, result } of results) {
      expect(result.publishable, diagnostics(fixture.id, result.findings)).toBe(false);
      expect(result.findings.length, diagnostics(fixture.id, result.findings)).toBeGreaterThan(0);
    }
  });

  it('keeps encounter source synopsis as provenance while blocking its leaked fallback description', async () => {
    const fixture = CROSS_TREATMENT_FIXTURES.find((item) => item.id === 'encounter-provenance-leak')!;
    const result = await evaluateDeterministicSeal(fixture.build(), fixture.focusedChecks);
    const messages = result.findings.map((item) => item.message);

    expect(messages.some((message) => message.includes('encounter.description'))).toBe(true);
    expect(messages.some((message) => message.includes('sourceSynopsis'))).toBe(false);
    expect(result.publishable).toBe(false);
  });
});

describe('Bite Me episode 1 deterministic sealing canary', () => {
  it('seals at least 9 of 10 independently seeded offline replay variants', async () => {
    const seeds = [101, 211, 307, 401, 503, 601, 701, 809, 907, 1009];
    const attempts = await Promise.all(seeds.map(async (seed) => {
      const result = await evaluateDeterministicSeal(biteMeEpisodeOneSealCandidate(seed));
      return { seed, ...result };
    }));
    const sealed = attempts.filter((attempt) => attempt.publishable);
    const failures = attempts
      .filter((attempt) => !attempt.publishable)
      .map((attempt) => diagnostics(`seed ${attempt.seed}`, attempt.findings))
      .join('\n\n');

    expect(
      sealed.length,
      `Bite Me episode 1 deterministic canary sealed ${sealed.length}/10.\n${failures}`,
    ).toBeGreaterThanOrEqual(9);
    expect(
      sealed.length,
      `Current deterministic replay result was ${sealed.length}/10.\n${failures}`,
    ).toBe(10);
  });
});
