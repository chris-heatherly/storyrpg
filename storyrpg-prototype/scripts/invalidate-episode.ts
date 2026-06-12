import fs from 'node:fs';
import path from 'node:path';
import {
  invalidateEpisodes,
  planEpisodeInvalidation,
} from '../src/ai-agents/pipeline/episodeInvalidation';
import type { ArtifactLoader, ArtifactSaver } from '../src/ai-agents/pipeline/episodeCheckpoints';

/**
 * Surgical episode invalidation for a generation run directory (adoption A4).
 * Tombstones the completion watermark of one episode — and, by default, every
 * later completed episode (season-canon carry-forward makes them downstream) —
 * so the next resume of the SAME run dir regenerates exactly those episodes
 * and rehydrates the rest.
 *
 *   npm run invalidate:episode -- generated-stories/<run> 2 --reason "ep2 canon break"
 *   npm run invalidate:episode -- generated-stories/<run> 2 --only      # no downstream (canon-drift risk is yours)
 *   npm run invalidate:episode -- generated-stories/<run> 2 --dry-run   # print the plan, write nothing
 *
 * Writes ONLY episode-N-complete.json tombstones inside the run dir's
 * checkpoints/ — assembled artifacts and everything else stay untouched.
 */

function usage(message?: string): never {
  if (message) console.error(`error: ${message}\n`);
  console.error(
    'usage: npm run invalidate:episode -- <runDir> <episodeNumber> [--only] [--dry-run] [--reason "<why>"]',
  );
  process.exit(message ? 1 : 0);
}

const argv = process.argv.slice(2);
const reasonIdxRaw = argv.indexOf('--reason');
const reasonValue = reasonIdxRaw !== -1 ? argv[reasonIdxRaw + 1] : undefined;
const positional = argv.filter((a, i) => !a.startsWith('--') && i !== reasonIdxRaw + 1);
if (positional.length !== 2) usage('expected exactly <runDir> <episodeNumber>');
const runDir = path.resolve(positional[0]);
const target = Number(positional[1]);
if (!Number.isInteger(target) || target < 1) usage(`"${positional[1]}" is not a valid episode number`);
if (!fs.existsSync(path.join(runDir, 'checkpoints'))) {
  usage(`${runDir} has no checkpoints/ directory — not a generation run dir?`);
}
const downstream = !argv.includes('--only');
const dryRun = argv.includes('--dry-run');
const reason =
  reasonValue ?? `manual invalidate:episode (target ${target}${downstream ? ' + downstream' : ' only'})`;

// Candidate episode numbers come from the watermark files actually present.
const episodeNumbers = fs
  .readdirSync(path.join(runDir, 'checkpoints'))
  .map((f) => /^episode-(\d+)-complete\.json$/.exec(f)?.[1])
  .filter((n): n is string => !!n)
  .map(Number);
if (episodeNumbers.length === 0) usage(`no episode completion watermarks found in ${runDir}/checkpoints`);

const load: ArtifactLoader = <T,>(name: string): T | null => {
  try {
    return JSON.parse(fs.readFileSync(path.join(runDir, name), 'utf8')) as T;
  } catch {
    return null;
  }
};
// Atomic tombstone write: temp file + rename, so a crash never tears a watermark.
const save: ArtifactSaver = async (name, data) => {
  const file = path.join(runDir, name);
  const tmp = `${file}.tmp-invalidate`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
};

async function main() {
  const plan = planEpisodeInvalidation({ target, episodeNumbers, load, downstream });
  console.log(`run dir:      ${runDir}`);
  console.log(`completed:    [${[...plan.invalidated, ...plan.kept].sort((a, b) => a - b).join(', ')}]`);
  console.log(`invalidating: [${plan.invalidated.join(', ')}]${downstream ? ' (target + downstream)' : ' (target only)'}`);
  console.log(`keeping:      [${plan.kept.join(', ')}]`);
  if (plan.invalidated.length === 0) {
    console.log('nothing to do — the target episode has no completion watermark.');
    return;
  }
  if (dryRun) {
    console.log('dry run — no tombstones written.');
    return;
  }
  await invalidateEpisodes({ target, episodeNumbers, load, save, reason, downstream });
  console.log(`done. resume the run against the same output directory to regenerate [${plan.invalidated.join(', ')}].`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
