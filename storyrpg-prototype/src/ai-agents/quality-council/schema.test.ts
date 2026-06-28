import { describe, expect, it } from 'vitest';
import { normalizeCouncilOutput } from './schema';

describe('Quality Council schema normalization', () => {
  it('normalizes invalid enum values and drops findings without evidence', () => {
    const normalized = normalizeCouncilOutput({
      summary: 'mixed',
      findings: [
        {
          id: 'bad-enums',
          checkpoint: 'final',
          category: 'made-up',
          severity: 'fatal',
          confidence: 'certain',
          evidence: ['The choice has no remembered consequence.'],
          repairRoute: 'rewrite-the-season',
        } as any,
        {
          id: 'no-evidence',
          checkpoint: 'final',
          category: 'choice-agency',
          severity: 'warning',
          confidence: 'medium',
          evidence: [],
          repairRoute: 'regen-choices',
        } as any,
      ],
    }, 'final');

    expect(normalized.findings).toHaveLength(1);
    expect(normalized.findings[0]).toMatchObject({
      checkpoint: 'final',
      category: 'scene-coherence',
      severity: 'warning',
      confidence: 'medium',
      repairRoute: 'none',
    });
  });
});
