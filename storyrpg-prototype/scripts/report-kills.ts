import fs from 'node:fs';
import path from 'node:path';

/**
 * Kill-table aggregator (Systemic Guards Plan W3.0).
 *
 * Gate promotions and demotions run on DATA, not anecdote: this report mines
 * every archived run's `99-pipeline-errors.json` plus the quality ledger and
 * answers "which check kills runs, how often, and did repair get a chance".
 * The 2026-07-13 audit had to hand-mine 169 files to learn that two
 * chokepoints owned 62% of all failures; this makes that table one command:
 *
 *   npm run report:kills
 *   npm run report:kills -- --since 2026-07-14 --corpus generated-stories
 *   npm run report:kills -- --json /tmp/kills.json
 *
 * Read-only over run dirs; the only write is the optional --json report.
 */

interface BlockingIssueLike {
  validator?: string;
  type?: string;
  sceneId?: string;
  message?: string;
}

interface RunRecord {
  runDir: string;
  firstErrorClass: string;
  blockingIssues: BlockingIssueLike[];
}

function classifyFirstError(message: string): string {
  const tag = /\[([A-Za-z]+)\]/.exec(message.slice(0, 160))?.[1];
  if (tag) return tag;
  if (message.includes('Final story contract failed')) return 'FinalContract';
  if (message.includes('Story Architect failed')) return 'StoryArchitect';
  if (message.includes('architecture contract failed')) return 'EpisodeArchitectureContract';
  return message.slice(0, 60);
}

function main(): void {
  const args = process.argv.slice(2);
  const corpus = args.includes('--corpus') ? args[args.indexOf('--corpus') + 1] : 'generated-stories';
  const since = args.includes('--since') ? args[args.indexOf('--since') + 1] : '';
  const jsonOut = args.includes('--json') ? args[args.indexOf('--json') + 1] : undefined;

  const runDirs = fs.readdirSync(corpus)
    .filter((name) => /_\d{4}-\d{2}-\d{2}T/.test(name))
    .filter((name) => !since || (name.split('_').pop() ?? '') >= since)
    .sort();

  const runs: RunRecord[] = [];
  for (const dir of runDirs) {
    const errPath = path.join(corpus, dir, '99-pipeline-errors.json');
    if (!fs.existsSync(errPath)) continue;
    try {
      const parsed = JSON.parse(fs.readFileSync(errPath, 'utf8'));
      const errors: Array<Record<string, unknown>> = parsed.errors ?? (Array.isArray(parsed) ? parsed : []);
      if (errors.length === 0) continue;
      const first = errors[0];
      const details = (first.details ?? {}) as Record<string, unknown>;
      const context = (details.context ?? {}) as Record<string, unknown>;
      const blockingIssues = ((details.blockingIssues ?? context.blockingIssues ?? []) as BlockingIssueLike[]);
      runs.push({
        runDir: dir,
        firstErrorClass: classifyFirstError(String(first.message ?? '')),
        blockingIssues,
      });
    } catch {
      // unreadable diagnostics — skip, never crash the report
    }
  }

  const killCounts = new Map<string, number>();
  const issueCounts = new Map<string, { issues: number; runs: Set<string> }>();
  for (const run of runs) {
    killCounts.set(run.firstErrorClass, (killCounts.get(run.firstErrorClass) ?? 0) + 1);
    for (const issue of run.blockingIssues) {
      const key = `${issue.validator ?? '?'} / ${issue.type ?? '?'}`;
      const entry = issueCounts.get(key) ?? { issues: 0, runs: new Set<string>() };
      entry.issues += 1;
      entry.runs.add(run.runDir);
      issueCounts.set(key, entry);
    }
  }

  // Ledger rollup: outcomes, remediation health, SHA distribution.
  const ledgerPath = path.join(corpus, 'quality-ledger.jsonl');
  const ledger: Array<Record<string, unknown>> = fs.existsSync(ledgerPath)
    ? fs.readFileSync(ledgerPath, 'utf8').split('\n').filter(Boolean).map((line) => {
        try { return JSON.parse(line); } catch { return {}; }
      }).filter((row) => !since || (String(row.runDir ?? '').split('_').pop() ?? '') >= since)
    : [];
  const outcomes = new Map<string, number>();
  const shas = new Map<string, number>();
  let remAttempted = 0; let remSucceeded = 0; let zeroRemFailures = 0; let failures = 0;
  for (const row of ledger) {
    outcomes.set(String(row.outcome ?? '?'), (outcomes.get(String(row.outcome ?? '?')) ?? 0) + 1);
    shas.set(String(row.workerGitSha ?? 'unknown'), (shas.get(String(row.workerGitSha ?? 'unknown')) ?? 0) + 1);
    if (row.outcome === 'failed') {
      failures += 1;
      remAttempted += Number(row.remediationsAttempted ?? 0);
      remSucceeded += Number(row.remediationsSucceeded ?? 0);
      if (!Number(row.remediationsAttempted ?? 0)) zeroRemFailures += 1;
    }
  }

  const sortedKills = [...killCounts.entries()].sort((a, b) => b[1] - a[1]);
  const sortedIssues = [...issueCounts.entries()].sort((a, b) => b[1].issues - a[1].issues);

  console.log(`\n=== KILL TABLE (${runs.length} failed run(s) with diagnostics${since ? `, since ${since}` : ''}) ===`);
  console.log('\nFirst-error class (what actually ended the run):');
  for (const [name, count] of sortedKills) console.log(`  ${String(count).padStart(4)}  ${name}`);
  console.log('\nBlocking issues by validator/type (issues | distinct runs):');
  for (const [name, entry] of sortedIssues.slice(0, 25)) {
    console.log(`  ${String(entry.issues).padStart(4)} | ${String(entry.runs.size).padStart(3)}  ${name}`);
  }
  console.log('\nLedger rollup:');
  console.log(`  outcomes: ${[...outcomes.entries()].map(([k, v]) => `${k}=${v}`).join('  ')}`);
  console.log(`  failed runs with ZERO remediations: ${zeroRemFailures}/${failures}`);
  console.log(`  remediations on failed runs: attempted=${remAttempted} succeeded=${remSucceeded}`);
  console.log(`  workerGitSha distribution: ${[...shas.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, v]) => `${k}=${v}`).join('  ')}`);

  if (jsonOut) {
    fs.writeFileSync(jsonOut, JSON.stringify({
      generatedAt: new Date().toISOString(),
      since: since || null,
      runCount: runs.length,
      firstErrorClasses: Object.fromEntries(sortedKills),
      blockingIssues: sortedIssues.map(([name, entry]) => ({ name, issues: entry.issues, runs: entry.runs.size })),
    }, null, 2));
    console.log(`\nJSON report written to ${jsonOut}`);
  }
}

main();
