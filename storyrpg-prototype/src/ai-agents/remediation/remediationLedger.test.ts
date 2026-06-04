import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { recordRemediation, RemediationLedgerRecord } from './remediationLedger';

const dirs: string[] = [];
function tmp(): string {
  const d = mkdtempSync(path.join(tmpdir(), 'rledger-'));
  dirs.push(d);
  return d + '/';
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('recordRemediation', () => {
  it('appends JSONL rows with the expected shape, one per line', async () => {
    const base = tmp();
    const a: RemediationLedgerRecord = {
      rule: 'scene-turn',
      scope: 'scene',
      attempted: 3,
      succeeded: true,
      degraded: false,
      blocked: false,
      attempts: 1,
      timestamp: '2026-05-28T00:00:00Z',
      runDir: 'a',
    };
    const b: RemediationLedgerRecord = {
      rule: 'choice-taxonomy',
      scope: 'choices',
      attempted: 2,
      succeeded: false,
      degraded: true,
      blocked: true,
      attempts: 2,
      runDir: 'b',
      details: 'exhausted retries',
    };
    await recordRemediation(base, a);
    await recordRemediation(base, b);

    const file = path.join(base, 'remediation-ledger.jsonl');
    expect(existsSync(file)).toBe(true);
    const lines = readFileSync(file, 'utf8').trim().split('\n');
    expect(lines).toHaveLength(2);

    expect(JSON.parse(lines[0])).toEqual(a);
    expect(JSON.parse(lines[1])).toEqual(b);
  });

  it('does not throw on an empty baseDir', async () => {
    await expect(
      recordRemediation('', {
        rule: 'r',
        scope: 'autofix',
        attempted: 0,
        succeeded: false,
        degraded: false,
        blocked: false,
        attempts: 0,
      }),
    ).resolves.toBeUndefined();
  });
});
