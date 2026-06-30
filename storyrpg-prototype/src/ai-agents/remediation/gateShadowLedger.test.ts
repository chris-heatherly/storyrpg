import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { recordGateShadow, GateShadowRecord } from './gateShadowLedger';

const dirs: string[] = [];
function tmp(): string {
  const d = mkdtempSync(path.join(tmpdir(), 'gshadow-'));
  dirs.push(d);
  return d + '/';
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('recordGateShadow', () => {
  it('appends JSONL rows with the expected shape, one per line', async () => {
    const base = tmp();
    const a: GateShadowRecord = {
      gate: 'GATE_DESIGN_NOTE_LEAK',
      validator: 'MechanicsLeakageValidator (design-note class)',
      scope: 'scene',
      enabled: false,
      wouldGate: true,
      blockingCount: 3,
      timestamp: '2026-06-06T00:00:00Z',
      runDir: 'a',
      details: 'leaks meta-narration',
    };
    const b: GateShadowRecord = {
      gate: 'GATE_SETUP_PAYOFF',
      validator: 'SetupPayoffValidator',
      scope: 'episode',
      enabled: false,
      wouldGate: false,
      blockingCount: 0,
      wouldRepairCount: 0,
      runDir: 'b',
    };
    await recordGateShadow(base, a);
    await recordGateShadow(base, b);

    const file = path.join(base, 'gate-shadow-ledger.jsonl');
    expect(existsSync(file)).toBe(true);
    const lines = readFileSync(file, 'utf8').trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0])).toEqual(a);
    expect(JSON.parse(lines[1])).toEqual(b);
  });

  it('does not throw on an empty baseDir', async () => {
    await expect(
      recordGateShadow('', {
        gate: 'GATE_X',
        validator: 'V',
        scope: 'autofix',
        enabled: false,
        wouldGate: false,
        blockingCount: 0,
      }),
    ).resolves.toBeUndefined();
  });
});
