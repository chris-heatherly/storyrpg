import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { GATE_DEFAULTS } from './gateDefaults';

// Meta-guardrail (audit 2026-07-01 item 4.2): validateGateRegistry only checks
// the flags it already knows about, so two decay classes were invisible to CI:
//
//  1. A live gate flag consumed in code but registered NOWHERE — raw
//     `process.env.GATE_X === '1'` reads recreating the scattered-predicate
//     pattern the registry replaced (8 such flags existed at audit time).
//  2. A registered gate NO code ever consults — a dead kill-switch that
//     advertises reversibility while gating nothing (4 such flags existed).
//
// This sweep closes both by scanning the source tree. Gate references are
// counted in two forms: quoted literals ('GATE_X' — isGateEnabled, rolloutFlag,
// registry-driven dispatch) and process.env dot-reads (process.env.GATE_X —
// the escape pattern itself).

const srcRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const REGISTRY_FILES = new Set(['gateDefaults.ts', 'gateRegistry.ts']);
const QUOTED = /['"](GATE_[A-Z0-9_]+)['"]/g;
const ENV_DOT = /process\.env\.(GATE_[A-Z0-9_]+)\b/g;

function collectGateReferences(): Map<string, Set<string>> {
  const refs = new Map<string, Set<string>>();
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules') continue;
        walk(full);
        continue;
      }
      if (!entry.name.endsWith('.ts') || /\.test\.tsx?$/.test(entry.name)) continue;
      if (REGISTRY_FILES.has(entry.name)) continue;
      const text = fs.readFileSync(full, 'utf8');
      for (const re of [QUOTED, ENV_DOT]) {
        re.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = re.exec(text))) {
          if (m[1].startsWith('GATE_TEST')) continue; // test fixtures
          if (!refs.has(m[1])) refs.set(m[1], new Set());
          refs.get(m[1])!.add(path.relative(srcRoot, full));
        }
      }
    }
  };
  walk(srcRoot);
  return refs;
}

describe('gate source sweep (registry escape hatches)', () => {
  const refs = collectGateReferences();
  const registered = new Set(Object.keys(GATE_DEFAULTS));

  it('every GATE_* flag consumed in source is registered in GATE_DEFAULTS', () => {
    const strays = [...refs.keys()]
      .filter((gate) => !registered.has(gate))
      .map((gate) => `${gate} (${[...refs.get(gate)!].slice(0, 2).join(', ')})`);
    expect(strays, `Unregistered gate flags found — add them to gateDefaults.ts AND gateRegistry.ts:\n${strays.join('\n')}`).toEqual([]);
  });

  it('every registered gate is consulted by at least one source file (no dead kill-switches)', () => {
    const dead = [...registered].filter((gate) => !refs.has(gate));
    expect(dead, `Registered gates with zero call sites — wire them or delete them:\n${dead.join('\n')}`).toEqual([]);
  });
});
