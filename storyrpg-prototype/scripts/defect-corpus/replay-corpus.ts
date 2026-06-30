import fs from 'node:fs';
import path from 'node:path';
import { REGISTRY, loadContext, findRunDirs, replayCell } from '../replay-gates';
import type { GateEntry } from '../replay-gates';

/**
 * Labeled recurring-defect corpus runner (WS0.1). Asserts, over archived generation runs
 * and committed hermetic fixtures, that each known defect class is CAUGHT and each known
 * false-positive is NOT flagged — so a gate's FP rate can be proven down before it is
 * promoted to blocking, and a fixed class can't silently reopen.
 *
 *   npm run corpus:check                 # enforced labels must pass; pending are reported
 *   npm run corpus:check -- --all        # also print skipped/pending detail
 *
 * Reuses the deterministic replay machinery in scripts/replay-gates.ts (same RunContext
 * loader + validator REGISTRY). No LLM calls. Exit non-zero iff an ENFORCED label fails.
 *
 * Label semantics (scripts/defect-corpus/labels.json):
 *   expect 'flag'    → the gate must produce ≥1 actionable finding on that run.
 *   expect 'no-flag' → the gate must produce 0 actionable findings (false-positive guard).
 *   status 'enforced'→ CI-gating. 'pending' → documents a target for a not-yet-built gate.
 *   corpus 'scripts/defect-corpus/fixtures' → committed; absence is a FAILURE.
 *   corpus 'generated-stories'              → gitignored; absence is a SKIP (local-only).
 */

export interface CorpusLabel {
  class: string;
  corpus: string;
  runMatch: string;
  gate: string;
  expect: 'flag' | 'no-flag';
  status: 'enforced' | 'pending';
  note?: string;
}

export interface CorpusOutcome {
  label: CorpusLabel;
  result: 'pass' | 'fail' | 'skipped';
  reason: string;
  findingCount?: number;
}

const DEFAULT_LABELS_PATH = 'scripts/defect-corpus/labels.json';

function findGate(name: string): GateEntry | undefined {
  const needle = name.toUpperCase();
  return REGISTRY.find(
    (g) => g.name === needle || g.gateFlag === needle || g.validator.toUpperCase() === needle,
  );
}

/** findRunDirs() process.exit(1)s on a missing corpus root; guard so absent live corpora skip. */
function findRunDirsSafe(corpus: string, match: string): string[] {
  const root = path.resolve(process.cwd(), corpus);
  if (!fs.existsSync(root)) return [];
  return findRunDirs(corpus, match);
}

export function loadLabels(labelsPath = DEFAULT_LABELS_PATH): CorpusLabel[] {
  const raw = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), labelsPath), 'utf8'));
  return raw.labels as CorpusLabel[];
}

export function runCorpus(labels: CorpusLabel[] = loadLabels()): CorpusOutcome[] {
  const out: CorpusOutcome[] = [];
  for (const label of labels) {
    const isFixture = label.corpus.includes('fixtures');
    const gate = findGate(label.gate);
    if (!gate) {
      out.push({
        label,
        result: label.status === 'pending' ? 'skipped' : 'fail',
        reason: label.status === 'pending'
          ? `gate ${label.gate} not built yet (pending target)`
          : `gate ${label.gate} is not registered in replay-gates REGISTRY`,
      });
      continue;
    }
    const dirs = findRunDirsSafe(label.corpus, label.runMatch);
    if (dirs.length === 0) {
      out.push({
        label,
        result: isFixture ? 'fail' : 'skipped',
        reason: isFixture
          ? `committed fixture "${label.runMatch}" is missing under ${label.corpus}`
          : `live run "${label.runMatch}" absent (gitignored) — skipped`,
      });
      continue;
    }
    const ctx = loadContext(dirs[0]);
    if (!ctx) {
      out.push({ label, result: 'skipped', reason: `unparseable story in ${path.basename(dirs[0])}` });
      continue;
    }
    const cell = replayCell(gate, ctx);
    const actual: 'flag' | 'no-flag' = cell.findingCount > 0 ? 'flag' : 'no-flag';
    const ok = actual === label.expect;
    out.push({
      label,
      // A failing PENDING label is just "not there yet" → skipped, never a CI failure.
      result: ok ? 'pass' : label.status === 'pending' ? 'skipped' : 'fail',
      reason: `expected ${label.expect}, got ${actual} (${cell.findingCount} finding(s))`,
      findingCount: cell.findingCount,
    });
  }
  return out;
}

function printOutcomes(outcomes: CorpusOutcome[], showAll: boolean): void {
  const sym = { pass: '✓', fail: '✗', skipped: '·' } as const;
  console.log('\nDefect-corpus check:\n');
  for (const o of outcomes) {
    if (!showAll && o.result === 'skipped') continue;
    const scope = o.label.status === 'enforced' ? 'enforced' : 'pending';
    console.log(`  ${sym[o.result]} [${scope}] ${o.label.class} · ${o.label.gate} · ${o.label.runMatch} — ${o.reason}`);
  }
  const enforced = outcomes.filter((o) => o.label.status === 'enforced');
  const passed = enforced.filter((o) => o.result === 'pass').length;
  const failed = enforced.filter((o) => o.result === 'fail').length;
  const skippedEnforced = enforced.filter((o) => o.result === 'skipped').length;
  const pending = outcomes.filter((o) => o.label.status === 'pending').length;
  console.log(
    `\nenforced: ${passed} pass, ${failed} fail, ${skippedEnforced} skipped (run absent)`
    + ` · pending targets: ${pending}`,
  );
}

function main(): void {
  const showAll = process.argv.includes('--all');
  const outcomes = runCorpus();
  printOutcomes(outcomes, showAll);
  const failed = outcomes.filter((o) => o.label.status === 'enforced' && o.result === 'fail');
  if (failed.length > 0) {
    console.error(`\n${failed.length} enforced corpus label(s) FAILED.`);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}
