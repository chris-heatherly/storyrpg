/**
 * Batch triage: aggregate the residual defects of a batch of runs into one
 * deduped, frequency-ranked table — the analysis half of "stop discovering
 * serially" (reliability campaign, 2026-07-18).
 *
 * Before the ship-with-cap tranche (f7e64dab) a run surfaced exactly one
 * defect: its first fatal blocker. Now most runs COMPLETE and carry their
 * full residue in the quality report (caps + demotedFromBlocking warnings),
 * and failures still record blocking issues in 07b. This script reads both
 * shapes across a window of runs and answers: "across the batch, which
 * defect classes appear, how often, and in which runs?" — one triage list
 * instead of N sequential postmortems.
 *
 *   npm run triage:batch                         # runs from the last 24h
 *   npm run triage:batch -- --since 2026-07-18   # runs on/after a date
 *   npm run triage:batch -- --runs r12           # run dirs whose name contains "r12"
 *
 * Read-only. No LLM calls.
 */
import fs from 'node:fs';
import path from 'node:path';

interface DefectRow {
  key: string;
  type: string;
  validator?: string;
  disposition: 'aborted_run' | 'shipped_demoted' | 'shipped_capped';
  runs: Set<string>;
  count: number;
  sampleMessage: string;
}

interface Args {
  corpus: string;
  since?: string;
  runsFilter?: string;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { corpus: 'generated-stories' };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--corpus') args.corpus = argv[++i];
    else if (argv[i] === '--since') args.since = argv[++i];
    else if (argv[i] === '--runs') args.runsFilter = argv[++i];
  }
  return args;
}

function readJson<T>(file: string): T | undefined {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
  } catch {
    return undefined;
  }
}

function runTimestamp(runDirName: string): string | undefined {
  // Run dirs end with _<ISO-ish timestamp> e.g. bite-me-r118_2026-07-18T18-36-05
  const match = runDirName.match(/_(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2})$/);
  return match?.[1]?.replace(/T(\d{2})-(\d{2})-(\d{2})$/, 'T$1:$2:$3');
}

interface ContractIssueLike {
  type?: string;
  validator?: string;
  message?: string;
  demotedFromBlocking?: boolean;
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const root = path.resolve(process.cwd(), args.corpus);
  if (!fs.existsSync(root)) {
    console.error(`Corpus directory not found: ${root}`);
    process.exit(1);
  }
  const sinceIso = args.since
    ?? new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 19);

  const defects = new Map<string, DefectRow>();
  const runsSeen: Array<{ run: string; disposition: string; detail: string }> = [];

  const record = (
    run: string,
    issue: ContractIssueLike,
    disposition: DefectRow['disposition'],
  ): void => {
    const type = issue.type ?? 'unknown';
    const key = `${type}::${issue.validator ?? ''}`;
    const existing = defects.get(key);
    if (existing) {
      existing.count += 1;
      existing.runs.add(run);
    } else {
      defects.set(key, {
        key,
        type,
        validator: issue.validator,
        disposition,
        runs: new Set([run]),
        count: 1,
        sampleMessage: (issue.message ?? '').slice(0, 140),
      });
    }
  };

  for (const name of fs.readdirSync(root).sort()) {
    const dir = path.join(root, name);
    if (!fs.statSync(dir).isDirectory()) continue;
    if (args.runsFilter && !name.includes(args.runsFilter)) continue;
    const ts = runTimestamp(name);
    if (!ts || ts < sinceIso) continue;

    // Failed runs: the frozen blocking issues.
    const failed = readJson<{ blockingIssues?: ContractIssueLike[] }>(
      path.join(dir, '07b-final-story-contract.failed.json'),
    );
    if (failed?.blockingIssues?.length) {
      for (const issue of failed.blockingIssues) record(name, issue, 'aborted_run');
      runsSeen.push({ run: name, disposition: 'ABORTED', detail: `${failed.blockingIssues.length} blocker(s)` });
      continue;
    }

    // Completed runs: demoted residue + caps from the quality report / passing contract.
    const contract = readJson<{ warnings?: ContractIssueLike[] }>(
      path.join(dir, '07b-final-story-contract.json'),
    );
    const demoted = (contract?.warnings ?? []).filter((issue) => issue.demotedFromBlocking);
    for (const issue of demoted) record(name, issue, 'shipped_demoted');
    const quality = readJson<{ caps?: Array<{ id: string; maxScore: number; reason: string }>; finalScore?: number }>(
      path.join(dir, '07c-quality-score-report.json'),
    );
    const subNinetyCaps = (quality?.caps ?? []).filter((cap) => cap.maxScore < 90);
    for (const cap of subNinetyCaps) {
      record(name, { type: `cap:${cap.id}`, message: cap.reason }, 'shipped_capped');
    }
    if (demoted.length > 0 || subNinetyCaps.length > 0) {
      runsSeen.push({
        run: name,
        disposition: 'SHIPPED-WITH-RESIDUE',
        detail: `${demoted.length} demoted finding(s), ${subNinetyCaps.length} sub-90 cap(s), score ${quality?.finalScore ?? '?'}`,
      });
    } else if (contract || quality) {
      runsSeen.push({ run: name, disposition: 'CLEAN', detail: `score ${quality?.finalScore ?? '?'}` });
    }
  }

  if (runsSeen.length === 0) {
    console.log(`No runs on/after ${sinceIso}${args.runsFilter ? ` matching "${args.runsFilter}"` : ''}.`);
    return;
  }

  console.log(`\nBatch triage: ${runsSeen.length} run(s) since ${sinceIso}\n`);
  for (const entry of runsSeen) {
    console.log(`  ${entry.disposition.padEnd(21)} ${entry.run}  (${entry.detail})`);
  }

  const ranked = [...defects.values()].sort((a, b) =>
    b.runs.size - a.runs.size || b.count - a.count);
  console.log(`\nDefect classes across the batch (ranked by run coverage):\n`);
  console.log(`${'runs'.padEnd(6)}${'count'.padEnd(7)}${'disposition'.padEnd(17)}type / validator`);
  for (const row of ranked) {
    console.log(
      `${String(row.runs.size).padEnd(6)}${String(row.count).padEnd(7)}${row.disposition.padEnd(17)}`
      + `${row.type}${row.validator ? ` [${row.validator}]` : ''}`,
    );
    if (row.sampleMessage) console.log(`${' '.repeat(30)}e.g. ${row.sampleMessage}`);
  }
  console.log(
    '\nTriage guidance: classes hitting MULTIPLE runs are systemic (validator defect or prompt gap) — fix once, clears everywhere.'
    + '\nSingle-run classes are content variance — check the run before assuming a code defect.',
  );
}

main();
