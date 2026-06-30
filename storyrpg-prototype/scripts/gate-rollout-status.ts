import fs from 'node:fs';
import path from 'node:path';
import { GATE_DEFAULTS } from '../src/ai-agents/remediation/gateDefaults';
import { GATE_REGISTRY, type GateSpec } from '../src/ai-agents/remediation/gateRegistry';

interface GateShadowRow {
  gate?: string;
  wouldGate?: boolean;
  blockingCount?: number;
  residualBlockingCount?: number;
  repairAttempted?: boolean;
  repairSucceeded?: boolean;
  timestamp?: string;
  runDir?: string;
}

interface GateStats {
  records: number;
  runs: Set<string>;
  wouldGateRows: number;
  blockingCount: number;
  residualBlockingCount: number;
  residualRows: number;
  repairAttemptedRows: number;
  repairSucceededRows: number;
  latest?: GateShadowRow;
}

interface ReplayReport {
  results?: Array<{
    gateFlag?: string;
    findingCount?: number;
    errorCount?: number;
    wouldBlock?: boolean;
  }>;
}

const ADVISORY_ONLY = new Set([
  'GATE_NPC_PRONOUN',
  'GATE_QA_CRITICAL_BLOCK',
  'GATE_CHOICE_TYPE_CONFORMANCE',
  'GATE_SKILL_PLAN_CONFORMANCE',
]);

const FULL_SEASON_REQUIRED = new Set([
  'GATE_ENDING_REACHABILITY',
]);

const LIVE_PROOF_REQUIRED = new Set([
  'GATE_PROTAGONIST_PRONOUN',
  'GATE_ENCOUNTER_PROSE_INTEGRITY',
  'GATE_ENCOUNTER_SKILL_REBALANCE',
  'GATE_COLD_OPEN_REALIZATION',
  'GATE_RESIDUE_CONSUME',
  'GATE_CONTINUITY_REMEDIATION',
  'GATE_CHARACTER_INTRODUCTION',
]);

function readJsonl(file: string): GateShadowRow[] {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8')
    .split(/\n+/)
    .filter((line) => line.trim().length > 0)
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as GateShadowRow];
      } catch {
        return [];
      }
    });
}

function readReplay(file: string): Map<string, { runs: number; blockers: number; findings: number; errors: number }> {
  const out = new Map<string, { runs: number; blockers: number; findings: number; errors: number }>();
  if (!fs.existsSync(file)) return out;
  try {
    const report = JSON.parse(fs.readFileSync(file, 'utf8')) as ReplayReport;
    for (const row of report.results ?? []) {
      if (!row.gateFlag) continue;
      const stat = out.get(row.gateFlag) ?? { runs: 0, blockers: 0, findings: 0, errors: 0 };
      stat.runs++;
      if (row.wouldBlock) stat.blockers++;
      stat.findings += row.findingCount ?? 0;
      stat.errors += row.errorCount ?? 0;
      out.set(row.gateFlag, stat);
    }
  } catch {
    // Ignore malformed replay reports; the shadow ledger remains authoritative.
  }
  return out;
}

function collectStats(rows: GateShadowRow[]): Map<string, GateStats> {
  const stats = new Map<string, GateStats>();
  for (const row of rows) {
    if (!row.gate) continue;
    const stat = stats.get(row.gate) ?? {
      records: 0,
      runs: new Set<string>(),
      wouldGateRows: 0,
      blockingCount: 0,
      residualBlockingCount: 0,
      residualRows: 0,
      repairAttemptedRows: 0,
      repairSucceededRows: 0,
    };
    stat.records++;
    if (row.runDir) stat.runs.add(row.runDir);
    if (row.wouldGate) stat.wouldGateRows++;
    stat.blockingCount += row.blockingCount ?? 0;
    stat.residualBlockingCount += row.residualBlockingCount ?? 0;
    if ((row.residualBlockingCount ?? 0) > 0) stat.residualRows++;
    if (row.repairAttempted) stat.repairAttemptedRows++;
    if (row.repairSucceeded) stat.repairSucceededRows++;
    if (!stat.latest || String(row.timestamp ?? '') > String(stat.latest.timestamp ?? '')) stat.latest = row;
    stats.set(row.gate, stat);
  }
  return stats;
}

function classify(gate: string, spec: GateSpec | undefined, stats: GateStats | undefined, replay: Map<string, { runs: number; blockers: number }>): string {
  const replayStats = replay.get(gate);
  if (ADVISORY_ONLY.has(gate)) return 'advisory by design';
  if (FULL_SEASON_REQUIRED.has(gate)) return 'needs full-season proof';
  if ((stats?.residualBlockingCount ?? 0) > 0 || (replayStats?.blockers ?? 0) > 0) return 'needs repair';
  if (LIVE_PROOF_REQUIRED.has(gate)) return 'needs live proof';
  if (!stats && !replayStats) return 'needs data';
  if (spec?.kind === 'blocking' && spec.placement === 'season-final' && !spec.repair && !spec.policyException) {
    return 'needs repair route';
  }
  return 'ready';
}

function main(): void {
  const corpus = process.argv.includes('--corpus')
    ? process.argv[process.argv.indexOf('--corpus') + 1]
    : 'generated-stories';
  const ledger = collectStats(readJsonl(path.join(corpus, 'gate-shadow-ledger.jsonl')));
  const replay = readReplay(path.join(corpus, 'replay-gates-report.json'));
  const registry = new Map(GATE_REGISTRY.map((gate) => [gate.id, gate]));
  const offGates = Object.entries(GATE_DEFAULTS).filter(([, enabled]) => !enabled).map(([gate]) => gate).sort();
  const buckets = new Map<string, string[]>();

  for (const gate of offGates) {
    const stat = ledger.get(gate);
    const spec = registry.get(gate);
    const bucket = classify(gate, spec, stat, replay);
    const replayStats = replay.get(gate);
    const detail = [
      gate,
      spec ? `${spec.placement}/${spec.kind}${spec.repair ? `/${spec.repair}` : ''}` : 'unregistered',
      stat ? `shadow=${stat.records} rows/${stat.runs.size} runs residual=${stat.residualBlockingCount}` : 'shadow=none',
      replayStats ? `replay=${replayStats.blockers}/${replayStats.runs} block runs` : 'replay=none',
    ].join(' | ');
    const list = buckets.get(bucket) ?? [];
    list.push(detail);
    buckets.set(bucket, list);
  }

  for (const bucket of ['ready', 'needs live proof', 'needs full-season proof', 'needs repair', 'needs repair route', 'needs data', 'advisory by design']) {
    const rows = buckets.get(bucket) ?? [];
    console.log(`\n${bucket}:`);
    if (rows.length === 0) {
      console.log('  (none)');
      continue;
    }
    for (const row of rows) console.log(`  - ${row}`);
  }
}

main();
