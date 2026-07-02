import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Expo inlines every EXPO_PUBLIC_* var referenced in bundled code into the
// client bundle, so a provider key/token/secret behind that prefix is
// world-readable (non-negotiable #2 in CLAUDE.md). PostHog publishable keys
// (EXPO_PUBLIC_POSTHOG_KEY, phc_...) are the one client-safe exception — the
// pattern below deliberately does not match it.
//
// Scope: src/ and apps/ (code reachable by the Metro bundler). The proxy/
// server files are Node-only and may keep legacy EXPO_PUBLIC fallbacks for
// operator back-compat without bundle risk.
const SECRET_ENV_RE = /EXPO_PUBLIC_[A-Z0-9_]*(?:API_KEY|TOKEN|SECRET)\b/g;

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCAN_ROOTS = ['src', 'apps'];
const SOURCE_EXT = new Set(['.ts', '.tsx', '.js', '.jsx']);

function* walk(dir: string): Generator<string> {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (SOURCE_EXT.has(path.extname(entry.name)) && !/\.test\.[tj]sx?$/.test(entry.name)) yield full;
  }
}

describe('no secret-shaped EXPO_PUBLIC env reads in bundled code', () => {
  it('src/ and apps/ contain no EXPO_PUBLIC_*_API_KEY / _TOKEN / _SECRET references', () => {
    const offenders: string[] = [];
    for (const root of SCAN_ROOTS) {
      const abs = path.join(repoRoot, root);
      if (!fs.existsSync(abs)) continue;
      for (const file of walk(abs)) {
        const text = fs.readFileSync(file, 'utf8');
        const matches = text.match(SECRET_ENV_RE);
        if (matches) {
          offenders.push(`${path.relative(repoRoot, file)}: ${Array.from(new Set(matches)).join(', ')}`);
        }
      }
    }
    expect(offenders, `Provider keys must be server-side only (read the plain name, not EXPO_PUBLIC_*):\n${offenders.join('\n')}`).toEqual([]);
  });
});
