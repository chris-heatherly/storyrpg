import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { appendQualityLedger, scoreBand, QUALITY_SCORE_BANDS } from './qualityLedger';

const dirs: string[] = [];
function tmp(): string {
  const d = mkdtempSync(path.join(tmpdir(), 'qledger-'));
  dirs.push(d);
  return d + '/';
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('scoreBand', () => {
  it('maps scores to ship/warn/block bands', () => {
    expect(scoreBand(QUALITY_SCORE_BANDS.ship)).toBe('ship');
    expect(scoreBand(85)).toBe('ship');
    expect(scoreBand(QUALITY_SCORE_BANDS.warn)).toBe('warn');
    expect(scoreBand(60)).toBe('warn');
    expect(scoreBand(10)).toBe('block');
    expect(scoreBand(undefined)).toBe('block');
  });

  it('never ships a run carrying blocking caps (known defects), regardless of score', () => {
    expect(scoreBand(85, 0)).toBe('ship');
    expect(scoreBand(85, 1)).toBe('warn');
    expect(scoreBand(74, 2)).toBe('warn');
    expect(scoreBand(45, 3)).toBe('block');
  });

  it('holds a high-scoring run when its QA evidence is stale', () => {
    expect(scoreBand(92, 0, true)).toBe('warn');
  });
});

describe('appendQualityLedger', () => {
  it('appends JSONL rows with a derived band, one per line', async () => {
    const base = tmp();
    await appendQualityLedger(base, { timestamp: '2026-05-28T00:00:00Z', outcome: 'success', overallScore: 82, runDir: 'a' });
    await appendQualityLedger(base, { timestamp: '2026-05-28T01:00:00Z', outcome: 'failed', errorCount: 3, runDir: 'b' });

    const file = path.join(base, 'quality-ledger.jsonl');
    expect(existsSync(file)).toBe(true);
    const lines = readFileSync(file, 'utf8').trim().split('\n');
    expect(lines).toHaveLength(2);

    const first = JSON.parse(lines[0]);
    expect(first).toMatchObject({ outcome: 'success', overallScore: 82, band: 'ship', runDir: 'a' });
    const second = JSON.parse(lines[1]);
    expect(second).toMatchObject({ outcome: 'failed', errorCount: 3, band: 'block', runDir: 'b' });
  });

  it('bands a high-scoring run with blocking caps as warn, and records the caps', async () => {
    const base = tmp();
    await appendQualityLedger(base, {
      timestamp: '2026-05-28T02:00:00Z',
      outcome: 'success',
      overallScore: 84,
      runDir: 'c',
      capIds: ['false_meaningful_choice'],
      blockingCapCount: 1,
    });

    const line = readFileSync(path.join(base, 'quality-ledger.jsonl'), 'utf8').trim();
    expect(JSON.parse(line)).toMatchObject({
      overallScore: 84,
      band: 'warn',
      capIds: ['false_meaningful_choice'],
      blockingCapCount: 1,
    });
  });

  it('does not throw on an empty baseDir', async () => {
    await expect(appendQualityLedger('', { timestamp: 't', outcome: 'failed' })).resolves.toBeUndefined();
  });
});
