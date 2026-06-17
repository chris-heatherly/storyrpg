import fs from 'node:fs';
import path from 'node:path';
import { loadContext } from './replay-gates';
import { findEncounterPovBreaks } from '../src/ai-agents/pipeline/encounterPovBackstop';
import { planResidueConsumption } from '../src/ai-agents/pipeline/residueConsumption';
import { FlagContractValidator } from '../src/ai-agents/validators/FlagContractValidator';
import { RequiredBeatRealizationValidator } from '../src/ai-agents/validators/RequiredBeatRealizationValidator';
import { extractMonotonicMetrics, episodeProseCorpus } from '../src/ai-agents/pipeline/knowledgeExtraction';

/**
 * WS2 — watched live smoke run, health-check half.
 *
 * The plan's one credit-dependent step: a tiny live generation that exercises the recurring
 * failure surfaces, then THIS checker confirms the engines did their job. The checker is fully
 * offline and runs over ANY run dir, so it doubles as a regression probe against archived runs:
 *
 *   npm run smoke:check -- --run bite-me-g17      # check an archived run (substring match)
 *   npm run smoke:check -- --run generated-stories/<dir>
 *
 * Five checks, each mapping to a Phase 0/1 engine:
 *   1. encounter POV         (WS0.3)  — zero third-person-protagonist breaks in encounter prose
 *   2. residue economy       (WS0.2)  — consequential set-but-never-read flags ≈ 0
 *   3. cold open realized     (WS1.3)  — the episode-opening hook is on-page
 *   4. readership monotonic   (WS1.2)  — the blog counter never regresses across episodes
 *   5. truncation health      (WS0.4)  — SceneWriter truncation rate below the drop-risk line
 *
 * Exit non-zero if any check FAILS (thresholds are lenient; the live run is the real signal).
 * The generation half is intentionally NOT invoked here — kick off the 1-episode live job with
 * the gates enabled (GATE_ENCOUNTER_POV is already on; export GATE_RESIDUE_CONSUME=1
 * GATE_COLD_OPEN_REALIZATION=1 GATE_ENCOUNTER_SKILL_REBALANCE=1 for the smoke job), then point
 * this checker at the resulting run dir.
 */

interface CheckResult {
  name: string;
  status: 'pass' | 'warn' | 'fail';
  detail: string;
}

const TRUNCATION_WARN = 0.25; // >25% of SceneWriter calls truncated → drop risk
const RESIDUE_WARN = 5; // a few terminal/cross-slice residual flags are expected

function findRunDir(arg: string): string | undefined {
  const direct = path.resolve(process.cwd(), arg);
  if (fs.existsSync(path.join(direct, 'story.json')) || fs.existsSync(path.join(direct, '08-final-story.json'))) {
    return direct;
  }
  const root = path.resolve(process.cwd(), 'generated-stories');
  if (!fs.existsSync(root)) return undefined;
  const hit = fs.readdirSync(root).sort().reverse().find((n) => n.includes(arg)
    && (fs.existsSync(path.join(root, n, 'story.json')) || fs.existsSync(path.join(root, n, '08-final-story.json'))));
  return hit ? path.join(root, hit) : undefined;
}

function checkPov(story: Parameters<typeof findEncounterPovBreaks>[0]): CheckResult {
  const breaks = findEncounterPovBreaks(story);
  return {
    name: 'encounter POV (WS0.3)',
    status: breaks.length === 0 ? 'pass' : 'fail',
    detail: breaks.length === 0 ? 'no third-person-protagonist breaks' : `${breaks.length} break(s), e.g. "${breaks[0].slice(0, 80)}"`,
  };
}

function checkResidue(story: Parameters<typeof planResidueConsumption>[0]): CheckResult {
  const writeOnly = new FlagContractValidator().validate({ story: story as never }).metrics.writeOnlyFlags;
  const debts = planResidueConsumption(story).length;
  const status = writeOnly === 0 ? 'pass' : writeOnly <= RESIDUE_WARN ? 'warn' : 'fail';
  return {
    name: 'residue economy (WS0.2)',
    status,
    detail: `${writeOnly} write-only flag(s) (${debts} unread consequential)`,
  };
}

function checkColdOpen(ctx: ReturnType<typeof loadContext>): CheckResult {
  if (!ctx?.plan) return { name: 'cold open (WS1.3)', status: 'warn', detail: 'no scene plan in run dir — skipped' };
  // A run generated before WS1.3 has no 'coldopen'-tier beats, so the validator would vacuously
  // pass; surface that as a skip rather than a misleading green.
  const planScenes = (ctx.plan as { scenes?: Array<{ requiredBeats?: Array<{ tier?: string }> }> }).scenes ?? [];
  const hasColdOpenBeat = planScenes.some((s) => (s.requiredBeats ?? []).some((b) => b.tier === 'coldopen'));
  if (!hasColdOpenBeat) return { name: 'cold open (WS1.3)', status: 'warn', detail: 'no cold-open beat in plan (pre-WS1.3 run or none authored)' };
  const res = new RequiredBeatRealizationValidator().validate({ plan: ctx.plan, story: ctx.story });
  const coldMisses = res.issues.filter((i) => /Cold open not found/.test(i.message));
  return {
    name: 'cold open (WS1.3)',
    status: coldMisses.length === 0 ? 'pass' : 'fail',
    detail: coldMisses.length === 0 ? 'cold open realized on-page' : `${coldMisses.length} dropped: ${coldMisses[0].message.slice(0, 90)}`,
  };
}

function checkNumeric(story: { episodes?: Array<{ number?: number }> }): CheckResult {
  const series: Array<{ ep: number; value: number }> = [];
  for (const ep of story.episodes ?? []) {
    const metrics = extractMonotonicMetrics(episodeProseCorpus(ep as never));
    const readership = metrics.find((m) => m.id === 'metric:readership');
    if (readership) series.push({ ep: ep.number ?? 0, value: readership.value });
  }
  let regression: string | undefined;
  for (let i = 1; i < series.length; i++) {
    if (series[i].value < series[i - 1].value) {
      regression = `ep${series[i - 1].ep} ${series[i - 1].value.toLocaleString()} → ep${series[i].ep} ${series[i].value.toLocaleString()}`;
      break;
    }
  }
  if (series.length < 2) return { name: 'readership monotonic (WS1.2)', status: 'warn', detail: `${series.length} readership figure(s) — nothing to compare` };
  return {
    name: 'readership monotonic (WS1.2)',
    status: regression ? 'fail' : 'pass',
    detail: regression ? `REGRESSION ${regression}` : `monotonic across ${series.length} episodes`,
  };
}

function checkTruncation(runDir: string): CheckResult {
  const ledgerPath = path.join(runDir, '09-llm-ledger.json');
  if (!fs.existsSync(ledgerPath)) return { name: 'truncation health (WS0.4)', status: 'warn', detail: 'no llm-ledger in run dir' };
  try {
    const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8')) as {
      byAgent?: Array<{ agentName?: string; calls?: number; truncatedResponses?: number }>;
    };
    const sw = (ledger.byAgent ?? []).find((a) => /scene writer/i.test(a.agentName ?? ''));
    if (!sw || !sw.calls) return { name: 'truncation health (WS0.4)', status: 'warn', detail: 'no SceneWriter calls recorded' };
    const rate = (sw.truncatedResponses ?? 0) / sw.calls;
    return {
      name: 'truncation health (WS0.4)',
      status: rate <= TRUNCATION_WARN ? 'pass' : 'fail',
      detail: `SceneWriter truncated ${sw.truncatedResponses}/${sw.calls} (${(rate * 100).toFixed(0)}%)`,
    };
  } catch {
    return { name: 'truncation health (WS0.4)', status: 'warn', detail: 'unparseable llm-ledger' };
  }
}

function main(): void {
  const argv = process.argv.slice(2);
  const runArg = argv[argv.indexOf('--run') + 1];
  if (!runArg || runArg.startsWith('--')) {
    console.error('Usage: npm run smoke:check -- --run <dir-or-substring>');
    process.exit(1);
  }
  const runDir = findRunDir(runArg);
  if (!runDir) {
    console.error(`No run dir with story.json matching "${runArg}".`);
    process.exit(1);
  }
  const ctx = loadContext(runDir);
  if (!ctx) {
    console.error(`Could not load a story from ${runDir}.`);
    process.exit(1);
  }

  const results: CheckResult[] = [
    checkPov(ctx.story),
    checkResidue(ctx.story),
    checkColdOpen(ctx),
    checkNumeric(ctx.story),
    checkTruncation(runDir),
  ];

  const sym = { pass: '✓', warn: '·', fail: '✗' } as const;
  console.log(`\nSmoke health check — ${path.basename(runDir)}\n`);
  for (const r of results) console.log(`  ${sym[r.status]} ${r.name.padEnd(28)} ${r.detail}`);
  const fails = results.filter((r) => r.status === 'fail');
  const warns = results.filter((r) => r.status === 'warn');
  console.log(`\n${results.length - fails.length - warns.length} pass, ${warns.length} warn, ${fails.length} fail`);
  if (fails.length > 0) process.exit(1);
}

main();
