// Bundle secret scan for any exported web bundle (generator or reader).
//
// The reader has the full check (import graph + forbidden strings + secrets) in
// check-reader-boundary.mjs. The GENERATOR bundle legitimately contains pipeline
// code, but it is still a browser bundle — Expo inlines EXPO_PUBLIC_* values at
// build time, so a provider key must never appear in it either ("internal" is
// not safe if the generator is ever served/exposed). This script runs ONLY the
// secret scan: literal secret values from env/.env + provider-key shapes.
//
// Usage: node scripts/scan-bundle-secrets.mjs <dist-dir> [--require-bundle]

import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const args = process.argv.slice(2).filter((arg) => !arg.startsWith('--'));
const distDirName = args[0] || 'dist-generator-internal';
const distDir = path.join(root, distDirName);
const requireBundle = process.argv.includes('--require-bundle');

// Provider API-key value patterns that must never appear in a browser bundle,
// even if the *name* of the env var doesn't. Mirrors check-reader-boundary.mjs.
const secretValuePatterns = [
  { label: 'Google API key (AIza…)', re: /AIza[0-9A-Za-z_\-]{35}/g },
  { label: 'OpenAI key (sk-…)', re: /\bsk-[A-Za-z0-9_\-]{20,}\b/g },
  { label: 'Anthropic key (sk-ant-…)', re: /\bsk-ant-[A-Za-z0-9_\-]{20,}\b/g },
];

function collectSecretValues() {
  const values = new Set();
  const consider = (name, value) => {
    if (!value || value.length < 12) return;
    // PostHog publishable/client keys (phc_/phx_) are designed to ship client-side.
    if (/POSTHOG/i.test(name) || /^ph[cx]_/.test(value)) return;
    if (/(KEY|TOKEN|SECRET|PASSWORD)/i.test(name)) values.add(value);
  };
  for (const [name, value] of Object.entries(process.env)) consider(name, value);
  const envFile = path.join(root, '.env');
  if (fs.existsSync(envFile)) {
    for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
      const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
      if (!m) continue;
      consider(m[1], m[2].replace(/^['"]|['"]$/g, ''));
    }
  }
  return [...values];
}

function redact(value) {
  if (value.length <= 8) return '****';
  return `${value.slice(0, 4)}…${value.slice(-2)} (${value.length} chars)`;
}

const violations = [];

if (fs.existsSync(distDir)) {
  const secretValues = collectSecretValues();
  const files = [];
  const walk = (dir) => {
    for (const name of fs.readdirSync(dir)) {
      const abs = path.join(dir, name);
      const stat = fs.statSync(abs);
      if (stat.isDirectory()) walk(abs);
      else if (/\.(js|html|json|map|txt)$/i.test(name)) files.push(abs);
    }
  };
  walk(distDir);
  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');
    const relFile = path.relative(root, file).split(path.sep).join('/');
    for (const value of secretValues) {
      if (source.includes(value)) {
        violations.push(`${distDirName} leaks a secret value ${redact(value)} in ${relFile}`);
      }
    }
    for (const { label, re } of secretValuePatterns) {
      re.lastIndex = 0;
      if (re.test(source)) {
        violations.push(`${distDirName} contains a ${label} in ${relFile}`);
      }
    }
  }
  console.log(`${distDirName} scanned (${files.length} files, ${secretValues.length} secret value(s) checked).`);
} else if (requireBundle) {
  violations.push(
    `${distDirName}/ is missing but --require-bundle was set. Export the bundle first (e.g. npm run generator:export:internal).`,
  );
} else {
  console.warn(`Note: ${distDirName}/ not found — nothing to scan. Export the bundle first for a real check.`);
}

if (violations.length > 0) {
  console.error('\nBundle secret scan FAILED:');
  for (const violation of violations) console.error(`  ✗ ${violation}`);
  process.exit(1);
}
console.log('Bundle secret scan passed.');
