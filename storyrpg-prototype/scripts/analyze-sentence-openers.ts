import fs from 'node:fs';
import path from 'node:path';
import type { Story } from '../src/types';
import { analyzeStory, MONOTONY_RUN_THRESHOLD } from '../src/ai-agents/utils/sentenceOpenerStats';

/**
 * Measure sentence-opener variety for a generated story (or every run under a
 * directory). Reports the second-person-opener ratio and the worst monotonous
 * passages so prose-cadence regressions are gradeable run-over-run.
 *
 *   npm run analyze:openers -- --story generated-stories/<run>/story.json
 *   npm run analyze:openers -- --dir generated-stories            # all runs, summary table
 *   npm run analyze:openers -- --story <path> --json              # machine-readable
 */

interface Args {
  storyPath?: string;
  dir?: string;
  json: boolean;
  top: number;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { json: false, top: 10 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--story') args.storyPath = argv[++i];
    else if (a === '--dir') args.dir = argv[++i];
    else if (a === '--json') args.json = true;
    else if (a === '--top') args.top = Number(argv[++i]) || 10;
  }
  return args;
}

function loadStory(p: string): Story {
  const raw = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), p), 'utf8')) as Story | { story?: Story };
  return 'story' in raw && raw.story ? raw.story : raw as Story;
}

function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

function reportOne(storyPath: string, args: Args): void {
  const stats = analyzeStory(loadStory(storyPath));
  if (args.json) {
    console.log(JSON.stringify(stats, null, 2));
    return;
  }
  console.log(`\n=== ${storyPath} ===`);
  console.log(`Sentences analyzed:        ${stats.totalSentences}`);
  console.log(`Second-person openers:     ${stats.secondPersonOpenings} (${pct(stats.secondPersonRatio)})`);
  const b = stats.byBucket.beat;
  const o = stats.byBucket.outcome;
  console.log(`  beat.text:               ${b.secondPersonOpenings}/${b.sentences} (${pct(b.sentences ? b.secondPersonOpenings / b.sentences : 0)})`);
  console.log(`  outcomeTexts:            ${o.secondPersonOpenings}/${o.sentences} (${pct(o.sentences ? o.secondPersonOpenings / o.sentences : 0)})`);
  console.log(`Longest consecutive run:   ${stats.longestRun}`);
  console.log(`Monotonous passages (≥${MONOTONY_RUN_THRESHOLD}): ${stats.monotonyPassages.length}`);
  const worst = [...stats.monotonyPassages].sort((x, y) => y.longestRun - x.longestRun).slice(0, args.top);
  for (const p of worst) {
    console.log(`   [${p.bucket}] ${p.where} (run ${p.longestRun}): ${p.excerpt}`);
  }
}

function findRuns(dir: string): string[] {
  const root = path.resolve(process.cwd(), dir);
  const out: string[] = [];
  for (const name of fs.readdirSync(root)) {
    const final = path.join(root, name, 'story.json');
    if (fs.existsSync(final)) out.push(path.relative(process.cwd(), final));
  }
  return out.sort();
}

function reportDir(dir: string, args: Args): void {
  const runs = findRuns(dir);
  const rows = runs.map((r) => {
    const s = analyzeStory(loadStory(r));
    return { run: path.basename(path.dirname(r)), ratio: s.secondPersonRatio, monotony: s.monotonyPassages.length, sentences: s.totalSentences };
  });
  if (args.json) {
    console.log(JSON.stringify(rows, null, 2));
    return;
  }
  console.log('\nsecond-person opener ratio per run (lower is more varied):\n');
  for (const r of rows) {
    console.log(`  ${pct(r.ratio).padStart(6)}  monotony=${String(r.monotony).padStart(3)}  ${r.run}`);
  }
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  if (args.dir) {
    reportDir(args.dir, args);
  } else if (args.storyPath) {
    reportOne(args.storyPath, args);
  } else {
    console.error('Usage: npm run analyze:openers -- --story <path-to-story.json> [--json] [--top N]');
    console.error('   or: npm run analyze:openers -- --dir generated-stories [--json]');
    process.exit(1);
  }
}

main();
