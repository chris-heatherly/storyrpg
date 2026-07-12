import fs from 'node:fs';
import path from 'node:path';
import type { NarrativeContractGraph, NarrativeRealizationTask } from '../src/types/narrativeContract';
import type { ValidatorExecutionRecord } from '../src/types/validation';
import { GATE_REGISTRY } from '../src/ai-agents/remediation/gateRegistry';
import {
  policiesForGate,
  policiesForValidator,
  policyById,
} from '../src/ai-agents/validators/validatorRegistry';

function option(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function jsonFiles(root: string): string[] {
  if (!fs.existsSync(root)) return [];
  const out: string[] = [];
  const visit = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(file);
      else if (entry.isFile() && entry.name.endsWith('.json')) out.push(file);
    }
  };
  visit(root);
  return out;
}

function readJson(file: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return undefined;
  }
}

function graphFrom(value: unknown): NarrativeContractGraph | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const record = value as Record<string, unknown>;
  const candidate = record.kind === 'narrative-contract-graph' ? record.payload : value;
  if (!candidate || typeof candidate !== 'object') return undefined;
  const graph = candidate as Partial<NarrativeContractGraph>;
  return Array.isArray(graph.events) && Array.isArray(graph.dependencies) ? graph as NarrativeContractGraph : undefined;
}

function executionRecordsFrom(value: unknown): ValidatorExecutionRecord[] {
  if (!value || typeof value !== 'object') return [];
  const record = value as Record<string, unknown>;
  const payload = record.kind === 'validation-report' && record.payload && typeof record.payload === 'object'
    ? record.payload as Record<string, unknown>
    : record;
  return Array.isArray(payload.executionRecords) ? payload.executionRecords as ValidatorExecutionRecord[] : [];
}

const runDirArg = option('--run');
const taskId = option('--task');
const contractId = option('--contract');
const validatorId = option('--validator');
const policyId = option('--policy');
const gateId = option('--gate');

if (!taskId && !contractId && !validatorId && !policyId && !gateId) {
  console.error('usage: npm run validation:explain -- [--run <runDir>] (--task <id> | --contract <id> | --validator <id> | --policy <id> | --gate <id>)');
  process.exit(1);
}

const files = runDirArg ? jsonFiles(path.resolve(runDirArg)) : [];
const parsed = files.map((file) => ({ file, value: readJson(file) }));
const graphs = parsed.flatMap(({ file, value }) => {
  const graph = graphFrom(value);
  return graph ? [{ file, graph }] : [];
});
const tasks = graphs.flatMap(({ file, graph }) => (graph.realizationTasks ?? []).map((task) => ({ file, task })));
const selectedTasks = tasks.filter(({ task }) =>
  (taskId ? task.id === taskId : true)
  && (contractId ? task.contractId === contractId : true),
);
const executions = parsed.flatMap(({ file, value }) => executionRecordsFrom(value).map((record) => ({ file, record })));

const policies = policyId
  ? [policyById(policyId)].filter(Boolean)
  : gateId
    ? policiesForGate(gateId)
    : validatorId
      ? policiesForValidator(validatorId)
      : contractId || taskId
        ? policiesForValidator('NarrativeContractValidator')
        : [];
const gates = gateId
  ? GATE_REGISTRY.filter((gate) => gate.id === gateId)
  : policies.flatMap((policy) => policy?.rolloutFlag
    ? GATE_REGISTRY.filter((gate) => gate.id === policy.rolloutFlag)
    : []);
const matchingExecutions = executions.filter(({ record }) => {
  if (validatorId && record.validatorId !== validatorId) return false;
  if (policyId && record.policyId !== policyId) return false;
  if (gateId && record.gateFlag !== gateId) return false;
  if (taskId && !record.issues.some((issue) => issue.ownership?.taskId === taskId)) return false;
  if (contractId && !record.issues.some((issue) => issue.ownership?.contractId === contractId)) return false;
  return true;
});

console.log(JSON.stringify({
  selector: { taskId, contractId, validatorId, policyId, gateId },
  runDir: runDirArg ? path.resolve(runDirArg) : undefined,
  narrativeTasks: selectedTasks.map(({ file, task }: { file: string; task: NarrativeRealizationTask }) => ({ file, ...task })),
  policies,
  gates,
  executions: matchingExecutions,
}, null, 2));

