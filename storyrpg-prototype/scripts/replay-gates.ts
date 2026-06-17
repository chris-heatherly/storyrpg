import fs from 'node:fs';
import path from 'node:path';
import type { Episode, Story } from '../src/types';
import type { SeasonScenePlan } from '../src/types/scenePlan';
import type { EpisodeBlueprint } from '../src/ai-agents/agents/StoryArchitect';
import { GATE_DEFAULTS } from '../src/ai-agents/remediation/gateDefaults';
import { OutcomeTextQualityValidator } from '../src/ai-agents/validators/OutcomeTextQualityValidator';
import { SentenceOpenerVarietyValidator } from '../src/ai-agents/validators/SentenceOpenerVarietyValidator';
import { RequiredBeatRealizationValidator } from '../src/ai-agents/validators/RequiredBeatRealizationValidator';
import { DuplicateEstablishingBeatValidator } from '../src/ai-agents/validators/DuplicateEstablishingBeatValidator';
import { EncounterSetPieceDepthValidator } from '../src/ai-agents/validators/EncounterSetPieceDepthValidator';
import { ReferencedEventPresenceValidator } from '../src/ai-agents/validators/ReferencedEventPresenceValidator';
import { FlagContractValidator } from '../src/ai-agents/validators/FlagContractValidator';
import { findEncounterPovBreaks } from '../src/ai-agents/pipeline/encounterPovBackstop';

/**
 * Offline gate replay: run deterministic story validators against ARCHIVED generation
 * runs in generated-stories/, so a default-off gate can be promoted (or kept off) on
 * corpus evidence instead of burning a live generation run. This is the repeatable
 * version of the manual "G10 shadow gate audit" (memory: g10-shadow-gate-audit).
 *
 *   npm run replay:gates                              # whole corpus, default gate set
 *   npm run replay:gates -- --runs g10                # only run dirs whose name contains "g10"
 *   npm run replay:gates -- --gates OUTCOME_TEXT_QUALITY,REFERENCED_EVENT_PRESENCE
 *   npm run replay:gates -- --corpus generated-stories --out /tmp/replay.json
 *
 * Read-only with respect to run dirs: the only write is the JSON report at --out
 * (default generated-stories/replay-gates-report.json, the corpus ROOT — never inside
 * a run dir). No LLM calls; every registered validator is pure and deterministic.
 *
 * ── Adding a validator ──────────────────────────────────────────────────────────────
 * Append a REGISTRY entry. Requirements:
 *   1. Deterministic + LLM-free, and invokable purely from run-dir artifacts (the
 *      RunContext gives you the final Story, the season scene plan from
 *      00-input-brief.json, and the episode-N-blueprint.json files). If a validator
 *      needs live pipeline state (sourceAnalysis arming, qaReport sub-objects, ledger
 *      baseDir, …) it does NOT belong here until that input is persisted per run.
 *   2. `blocking` mirrors the gate's escalation semantics: 'errors' when only
 *      error-severity issues block (BaseValidator.error), 'any' when the gate promotes
 *      every finding (advisory validators that return valid:true and let the caller
 *      gate, e.g. ReferencedEventPresence).
 *   3. `run` returns normalized findings; throwing is fine — the harness records the
 *      throw as a finding ("validator threw: …") rather than crashing the replay.
 */

interface Finding {
  severity: 'error' | 'warning' | 'info';
  message: string;
}

interface RunContext {
  runDir: string;
  story: Story;
  /** Season scene plan from 00-input-brief.json (seasonPlan.scenePlan), when present. */
  plan?: SeasonScenePlan;
  /** episode-N-blueprint.json keyed by episode number, when present. */
  blueprints: Map<number, EpisodeBlueprint>;
}

interface GateEntry {
  /** Short name accepted by --gates (also accepts the validator class name or gate flag). */
  name: string;
  validator: string;
  gateFlag: string;
  /** 'errors': only error-severity findings would block. 'any': the gate escalates every finding. */
  blocking: 'errors' | 'any';
  /** Member of the no-flag default set (deterministic, Story-input, default-OFF gate). */
  inDefaultSet: boolean;
  run: (ctx: RunContext) => Finding[];
}

function fromValidationResult(issues: Array<{ severity: string; message: string }>): Finding[] {
  return issues.map((i) => ({
    severity: i.severity === 'error' ? 'error' : i.severity === 'warning' ? 'warning' : 'info',
    message: i.message,
  }));
}

function perEpisode(ctx: RunContext, fn: (episode: Episode, blueprint?: EpisodeBlueprint) => Finding[]): Finding[] {
  const out: Finding[] = [];
  for (const episode of ctx.story.episodes || []) {
    out.push(...fn(episode, ctx.blueprints.get(episode.number)));
  }
  return out;
}

const REGISTRY: GateEntry[] = [
  // ── Default replay set: deterministic, Story-input, default-OFF in gateDefaults ──
  {
    name: 'OUTCOME_TEXT_QUALITY',
    validator: 'OutcomeTextQualityValidator',
    gateFlag: 'GATE_OUTCOME_TEXT_QUALITY',
    blocking: 'errors',
    inDefaultSet: true,
    // properNouns omitted offline (no canonical roster artifact is guaranteed), so the
    // LOWERCASE_NAME sub-check stays quiet; scaffold/echo/duplicate checks fully apply.
    run: (ctx) => fromValidationResult(new OutcomeTextQualityValidator().validate({ story: ctx.story }).issues),
  },
  {
    name: 'SENTENCE_OPENER_VARIETY',
    validator: 'SentenceOpenerVarietyValidator',
    gateFlag: 'GATE_SENTENCE_OPENER_VARIETY',
    blocking: 'any',
    inDefaultSet: true,
    run: (ctx) => fromValidationResult(new SentenceOpenerVarietyValidator().validate({ story: ctx.story }).issues),
  },
  {
    name: 'REQUIRED_BEAT_REALIZATION',
    validator: 'RequiredBeatRealizationValidator',
    gateFlag: 'GATE_REQUIRED_BEAT_REALIZATION',
    blocking: 'errors',
    inDefaultSet: true,
    run: (ctx) => {
      if (!ctx.plan) return [{ severity: 'info', message: 'skipped: no seasonPlan.scenePlan in 00-input-brief.json' }];
      return fromValidationResult(new RequiredBeatRealizationValidator().validate({ plan: ctx.plan, story: ctx.story }).issues);
    },
  },
  {
    name: 'DUPLICATE_ESTABLISHING_BEAT',
    validator: 'DuplicateEstablishingBeatValidator',
    gateFlag: 'GATE_DUPLICATE_ESTABLISHING_BEAT',
    blocking: 'any', // the gate promotes the detection (warning by default) to blocking
    inDefaultSet: true,
    run: (ctx) =>
      perEpisode(ctx, (episode, blueprint) =>
        fromValidationResult(new DuplicateEstablishingBeatValidator().validateEpisode(episode, blueprint).issues)),
  },

  // ── Selectable extras: already default-ON gates, replayable for regression evidence ──
  {
    name: 'ENCOUNTER_SETPIECE_DEPTH',
    validator: 'EncounterSetPieceDepthValidator',
    gateFlag: 'GATE_ENCOUNTER_SETPIECE_DEPTH',
    blocking: 'errors',
    inDefaultSet: false,
    run: (ctx) => fromValidationResult(new EncounterSetPieceDepthValidator().validate({ story: ctx.story, plan: ctx.plan }).issues),
  },
  {
    name: 'REFERENCED_EVENT_PRESENCE',
    validator: 'ReferencedEventPresenceValidator',
    gateFlag: 'GATE_REFERENCED_EVENT_PRESENCE',
    blocking: 'any', // advisory validator (valid:true); the gate escalates its findings
    inDefaultSet: false,
    run: (ctx) => fromValidationResult(new ReferencedEventPresenceValidator().validate({ story: ctx.story }).issues),
  },
  {
    // Setter/consumer contract: an unset-condition flag is an error (dead conditioned
    // content); write-only flags surface as a warning (the dead-residue metric WS0.2 drives down).
    name: 'FLAG_CONTRACT',
    validator: 'FlagContractValidator',
    gateFlag: 'GATE_FLAG_CONTRACT',
    blocking: 'errors',
    inDefaultSet: false,
    run: (ctx) => fromValidationResult(new FlagContractValidator().validate({ story: ctx.story }).issues),
  },
  {
    // WS0.3: third-person protagonist narration in encounter outcome/phase prose. Protagonist
    // is resolved from the roster (npcs[].role === 'protagonist'); each break is an error.
    name: 'ENCOUNTER_POV',
    validator: 'EncounterPovBackstop',
    gateFlag: 'GATE_ENCOUNTER_POV',
    blocking: 'any',
    inDefaultSet: false,
    run: (ctx) =>
      findEncounterPovBreaks(ctx.story).map((snippet) => ({
        severity: 'error' as const,
        message: `encounter prose narrates the protagonist in third person: "${snippet}"`,
      })),
  },
];

// ── CLI plumbing ─────────────────────────────────────────────────────────────────────

interface Args {
  corpus: string;
  runsFilter?: string;
  gates?: string[];
  out: string;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { corpus: 'generated-stories', out: '' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--corpus') args.corpus = argv[++i];
    else if (a === '--runs') args.runsFilter = argv[++i];
    else if (a === '--gates') args.gates = argv[++i].split(',').map((g) => g.trim()).filter(Boolean);
    else if (a === '--out') args.out = argv[++i];
    else if (a === '--help' || a === '-h') {
      usage();
      process.exit(0);
    }
  }
  if (!args.out) args.out = path.join(args.corpus, 'replay-gates-report.json');
  return args;
}

function usage(): void {
  console.error('Usage: npm run replay:gates -- [--corpus <dir>] [--runs <substring>] [--gates <names>] [--out <report.json>]');
  console.error(`  registered gates: ${REGISTRY.map((g) => `${g.name}${g.inDefaultSet ? '*' : ''}`).join(', ')}  (* = in default set)`);
}

function selectGates(requested: string[] | undefined): GateEntry[] {
  if (!requested || requested.length === 0) return REGISTRY.filter((g) => g.inDefaultSet);
  const selected: GateEntry[] = [];
  for (const name of requested) {
    const needle = name.toUpperCase();
    const hit = REGISTRY.find(
      (g) => g.name === needle || g.gateFlag === needle || g.validator.toUpperCase() === needle,
    );
    if (!hit) {
      console.error(`Unknown gate "${name}".`);
      usage();
      process.exit(1);
    }
    if (!selected.includes(hit)) selected.push(hit);
  }
  return selected;
}

function readJson<T>(file: string): T | undefined {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
  } catch {
    return undefined;
  }
}

/** story.json wraps the Story under `.story`; 08-final-story.json is the raw Story. */
function loadStory(runDir: string): { story: Story; source: string } | undefined {
  for (const candidate of ['story.json', '08-final-story.json']) {
    const file = path.join(runDir, candidate);
    if (!fs.existsSync(file)) continue;
    const raw = readJson<Record<string, unknown>>(file);
    if (!raw) continue;
    const story = (Array.isArray(raw.episodes) ? raw : raw.story) as Story | undefined;
    if (story && Array.isArray(story.episodes)) return { story, source: candidate };
  }
  return undefined;
}

function loadContext(runDir: string): (RunContext & { storySource: string }) | undefined {
  const loaded = loadStory(runDir);
  if (!loaded) return undefined;
  const brief = readJson<{ seasonPlan?: { scenePlan?: SeasonScenePlan } }>(path.join(runDir, '00-input-brief.json'));
  const blueprints = new Map<number, EpisodeBlueprint>();
  for (const episode of loaded.story.episodes || []) {
    const bp = readJson<EpisodeBlueprint>(path.join(runDir, `episode-${episode.number}-blueprint.json`));
    if (bp) blueprints.set(episode.number, bp);
  }
  return { runDir, story: loaded.story, storySource: loaded.source, plan: brief?.seasonPlan?.scenePlan, blueprints };
}

interface CellResult {
  run: string;
  validator: string;
  gateFlag: string;
  gateDefaultOn: boolean;
  findingCount: number;
  errorCount: number;
  warningCount: number;
  wouldBlock: boolean;
  firstFindings: string[];
  validatorError?: string;
}

function replayCell(gate: GateEntry, ctx: RunContext): CellResult {
  const base = {
    run: path.basename(ctx.runDir),
    validator: gate.validator,
    gateFlag: gate.gateFlag,
    gateDefaultOn: GATE_DEFAULTS[gate.gateFlag] === true,
  };
  try {
    const findings = gate.run(ctx);
    const errorCount = findings.filter((f) => f.severity === 'error').length;
    const warningCount = findings.filter((f) => f.severity === 'warning').length;
    const actionable = findings.filter((f) => f.severity !== 'info');
    return {
      ...base,
      findingCount: actionable.length,
      errorCount,
      warningCount,
      wouldBlock: gate.blocking === 'errors' ? errorCount > 0 : actionable.length > 0,
      firstFindings: findings.slice(0, 3).map((f) => `[${f.severity}] ${f.message}`),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      ...base,
      findingCount: 1,
      errorCount: 1,
      warningCount: 0,
      wouldBlock: true,
      firstFindings: [`[error] validator threw: ${message}`],
      validatorError: message,
    };
  }
}

function findRunDirs(corpus: string, filter?: string): string[] {
  const root = path.resolve(process.cwd(), corpus);
  if (!fs.existsSync(root)) {
    console.error(`Corpus directory not found: ${root}`);
    process.exit(1);
  }
  const out: string[] = [];
  for (const name of fs.readdirSync(root).sort()) {
    if (filter && !name.includes(filter)) continue;
    const dir = path.join(root, name);
    if (!fs.statSync(dir).isDirectory()) continue;
    if (fs.existsSync(path.join(dir, 'story.json')) || fs.existsSync(path.join(dir, '08-final-story.json'))) {
      out.push(dir);
    }
  }
  return out;
}

function printSummary(gates: GateEntry[], cells: CellResult[], runCount: number): void {
  const nameWidth = Math.max(...gates.map((g) => g.name.length), 9) + 2;
  console.log(`\nGate replay over ${runCount} run(s):\n`);
  console.log(`${'gate'.padEnd(nameWidth)}${'default'.padStart(8)}${'findings'.padStart(10)}${'errors'.padStart(8)}${'block runs'.padStart(12)}${'threw'.padStart(7)}`);
  for (const gate of gates) {
    const rows = cells.filter((c) => c.validator === gate.validator);
    const findings = rows.reduce((n, c) => n + c.findingCount, 0);
    const errors = rows.reduce((n, c) => n + c.errorCount, 0);
    const blockRuns = rows.filter((c) => c.wouldBlock).length;
    const threw = rows.filter((c) => c.validatorError).length;
    console.log(
      `${gate.name.padEnd(nameWidth)}${(GATE_DEFAULTS[gate.gateFlag] ? 'ON' : 'off').padStart(8)}`
      + `${String(findings).padStart(10)}${String(errors).padStart(8)}`
      + `${`${blockRuns}/${rows.length}`.padStart(12)}${String(threw).padStart(7)}`,
    );
  }
  console.log('\nworst runs per gate (top 3 by findings):');
  for (const gate of gates) {
    const rows = cells
      .filter((c) => c.validator === gate.validator && c.findingCount > 0)
      .sort((a, b) => b.findingCount - a.findingCount)
      .slice(0, 3);
    if (rows.length === 0) continue;
    console.log(`  ${gate.name}:`);
    for (const row of rows) {
      console.log(`    ${row.findingCount} finding(s)${row.wouldBlock ? ' [WOULD BLOCK]' : ''}  ${row.run}`);
    }
  }
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const gates = selectGates(args.gates);
  const runDirs = findRunDirs(args.corpus, args.runsFilter);
  if (runDirs.length === 0) {
    console.error(`No run dirs with story.json / 08-final-story.json under ${args.corpus}`
      + (args.runsFilter ? ` matching "${args.runsFilter}"` : ''));
    process.exit(1);
  }

  const cells: CellResult[] = [];
  const skipped: string[] = [];
  let replayedRuns = 0;
  for (const runDir of runDirs) {
    const ctx = loadContext(runDir);
    if (!ctx) {
      skipped.push(path.basename(runDir));
      continue;
    }
    replayedRuns += 1;
    for (const gate of gates) {
      cells.push(replayCell(gate, ctx));
    }
  }

  printSummary(gates, cells, replayedRuns);
  if (skipped.length > 0) {
    console.log(`\nskipped (unparseable story): ${skipped.join(', ')}`);
  }

  const report = {
    generatedAt: new Date().toISOString(),
    corpus: path.resolve(process.cwd(), args.corpus),
    runsFilter: args.runsFilter ?? null,
    gates: gates.map((g) => ({ name: g.name, validator: g.validator, gateFlag: g.gateFlag, blocking: g.blocking, gateDefaultOn: GATE_DEFAULTS[g.gateFlag] === true })),
    runCount: replayedRuns,
    skippedRuns: skipped,
    results: cells,
  };
  const outFile = path.resolve(process.cwd(), args.out);
  fs.writeFileSync(outFile, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`\nfull report: ${outFile}`);
}

// Reusable machinery for the defect-corpus runner (scripts/defect-corpus/), which asserts
// labeled bad→caught / FP→not-flagged over the same archived runs. Exports are additive;
// the CLI only runs when this file is the entrypoint.
export { REGISTRY, loadContext, replayCell, findRunDirs };
export type { GateEntry, RunContext, CellResult, Finding };

if (require.main === module) {
  main();
}
