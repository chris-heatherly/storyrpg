#!/usr/bin/env node
/**
 * Gate kill table — aggregate per-gate / per-failureCode kill rates from
 * quality-ledger.jsonl + per-run 99-pipeline-errors.json files.
 *
 * Usage:
 *   node scripts/gate-kill-table.mjs [generated-stories-dir]
 *   npm run validation:kill-table
 *
 * Outputs a markdown + JSON summary of top killers for Wave D demotion decisions.
 */
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const defaultStoriesDir = path.join(root, 'generated-stories');
const storiesDir = path.resolve(process.argv[2] || defaultStoriesDir);

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function pickFailureFields(row) {
  const details = asObject(row.details) || {};
  const failure = asObject(details.failure) || asObject(row.failure) || details;
  return {
    failureCode: row.failureCode || failure.code || failure.failureCode || null,
    failureOwnerStage: row.failureOwnerStage || failure.ownerStage || failure.failureOwnerStage || null,
    retryClass: row.retryClass || failure.retryClass || null,
    repairTarget: row.repairTarget || failure.repairTarget || null,
    validatorId: row.validatorId || row.topBlockingValidator || failure.agent || failure.validatorId || null,
    gateConfigHash: row.gateConfigHash || null,
    remediationsAttempted: typeof row.remediationsAttempted === 'number' ? row.remediationsAttempted : null,
  };
}

async function readJsonl(filePath) {
  try {
    const text = await readFile(filePath, 'utf8');
    return text
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        try { return JSON.parse(line); } catch { return null; }
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

async function listRunDirs(baseDir) {
  try {
    const entries = await readdir(baseDir, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory()).map((entry) => path.join(baseDir, entry.name));
  } catch {
    return [];
  }
}

function bump(map, key, field = 'count') {
  if (!key) return;
  const row = map.get(key) || { key, count: 0, remediationsZero: 0, missingFailureCode: 0 };
  row[field] = (row[field] || 0) + 1;
  map.set(key, row);
}

async function main() {
  const ledgerPath = path.join(storiesDir, 'quality-ledger.jsonl');
  const ledgerRows = await readJsonl(ledgerPath);
  const failedLedger = ledgerRows.filter((row) => row.outcome === 'failed' || row.blocked === true);

  const byCode = new Map();
  const byOwner = new Map();
  const byValidator = new Map();
  const byGateHash = new Map();
  let remediationsZero = 0;
  let missingFailureCode = 0;

  for (const row of failedLedger) {
    const fields = pickFailureFields(row);
    if (!fields.failureCode) missingFailureCode += 1;
    if ((fields.remediationsAttempted ?? 0) === 0) remediationsZero += 1;
    bump(byCode, fields.failureCode || '(missing failureCode)');
    bump(byOwner, fields.failureOwnerStage || '(missing ownerStage)');
    bump(byValidator, fields.validatorId || '(missing validator)');
    bump(byGateHash, fields.gateConfigHash || '(missing gateConfigHash)');
    if ((fields.remediationsAttempted ?? 0) === 0) {
      bump(byCode, fields.failureCode || '(missing failureCode)', 'remediationsZero');
    }
    if (!fields.failureCode) {
      bump(byOwner, fields.failureOwnerStage || '(missing ownerStage)', 'missingFailureCode');
    }
  }

  // Supplement with 99-pipeline-errors.json when ledger rows are sparse.
  const runDirs = await listRunDirs(storiesDir);
  let errorFiles = 0;
  for (const runDir of runDirs) {
    const errorPath = path.join(runDir, '99-pipeline-errors.json');
    try {
      await stat(errorPath);
    } catch {
      continue;
    }
    errorFiles += 1;
    try {
      const payload = JSON.parse(await readFile(errorPath, 'utf8'));
      const entries = Array.isArray(payload) ? payload : Array.isArray(payload?.errors) ? payload.errors : [payload];
      for (const entry of entries) {
        const fields = pickFailureFields(asObject(entry) || {});
        if (fields.failureCode) bump(byCode, fields.failureCode);
        if (fields.failureOwnerStage) bump(byOwner, fields.failureOwnerStage);
        if (fields.validatorId) bump(byValidator, fields.validatorId);
      }
    } catch {
      // best-effort
    }
  }

  const sortDesc = (map) => [...map.values()].sort((a, b) => b.count - a.count);
  const summary = {
    storiesDir,
    ledgerRows: ledgerRows.length,
    failedLedgerRows: failedLedger.length,
    errorFilesScanned: errorFiles,
    remediationsAttemptedZero: remediationsZero,
    missingFailureCode,
    topFailureCodes: sortDesc(byCode).slice(0, 25),
    topOwnerStages: sortDesc(byOwner).slice(0, 15),
    topValidators: sortDesc(byValidator).slice(0, 15),
    gateConfigHashes: sortDesc(byGateHash).slice(0, 10),
  };

  console.log(JSON.stringify(summary, null, 2));
  console.log('\n## Kill table (top failure codes)\n');
  for (const row of summary.topFailureCodes) {
    console.log(`- ${row.key}: ${row.count}${row.remediationsZero ? ` (${row.remediationsZero} with remediationsAttempted=0)` : ''}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
