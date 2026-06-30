import { describe, expect, it } from 'vitest';
import { normalizeCouncilOutput, normalizeCouncilOutputWithDiagnostics } from './schema';

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
      category: 'choice-agency',
      severity: 'warning',
      confidence: 'medium',
      repairRoute: 'none',
    });
  });

  it('accepts string evidence and alternate repair route fields', () => {
    const normalized = normalizeCouncilOutput({
      summary: 'string evidence',
      findings: [{
        id: 'choice-1',
        checkpoint: 'choice',
        category: 'agency',
        severity: 'error',
        confidence: 'high',
        evidence: 'The presented dilemma only changes tone.',
        repair_route: 'regen-choices',
      } as any],
    }, 'choice');

    expect(normalized.findings).toHaveLength(1);
    expect(normalized.findings[0]).toMatchObject({
      category: 'choice-agency',
      evidence: ['The presented dilemma only changes tone.'],
      repairRoute: 'regen-choices',
    });
  });

  it('recovers fenced JSON from raw output when structured data is empty', () => {
    const raw = 'Here is the report:\n```json\n{"summary":"bad","findings":[{"id":"f1","checkpoint":"final","category":"treatment","severity":"error","confidence":"high","evidence":"The generated scene repeats one treatment event twice.","repair":"regen-episode"}]}\n```';

    const result = normalizeCouncilOutputWithDiagnostics(undefined, 'final', raw);

    expect(result.diagnostics.parseStatus).toBe('recovered');
    expect(result.output.findings).toHaveLength(1);
    expect(result.output.findings[0]).toMatchObject({
      category: 'treatment-fidelity',
      repairRoute: 'regen-episode',
    });
  });

  it('fails closed when raw output appears to contain findings but none survive normalization', () => {
    const raw = '{"summary":"bad","findings":[{"severity":"error","category":"choice-agency","evidence":[]}]}';
    const result = normalizeCouncilOutputWithDiagnostics({
      summary: 'bad',
      findings: [{ severity: 'error', category: 'choice-agency', evidence: [] } as any],
    }, 'final', raw);

    expect(result.output.findings).toHaveLength(0);
    expect(result.diagnostics.parseStatus).toBe('raw_findings_dropped');
    expect(result.diagnostics.droppedFindingCount).toBe(1);
  });
});
