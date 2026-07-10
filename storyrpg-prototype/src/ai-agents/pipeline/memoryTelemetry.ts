import type { AgentMemoryRole } from './pipelineMemory';

export type MemoryTelemetryOperation = 'recall' | 'write' | 'cognify' | 'corroborate' | 'breaker_open';
export type MemoryTelemetryProvider = 'cognee' | 'file' | 'disabled';
export type MemoryTelemetryStatus = 'success' | 'empty' | 'failed' | 'circuit_open';

export interface MemoryTelemetryEvent {
  runId?: string;
  phase: string;
  operation: MemoryTelemetryOperation;
  provider: MemoryTelemetryProvider;
  agentRole?: AgentMemoryRole;
  validator?: string;
  recallMode?: string;
  datasets: string[];
  nodeNames: string[];
  queryCount: number;
  resultCount: number;
  emptyContext: boolean;
  latencyMs: number;
  status: MemoryTelemetryStatus;
  error?: string;
}

export interface MemoryRunSummary {
  recallCount: number;
  writeCount: number;
  cognifyCount: number;
  corroborateCount: number;
  breakerOpenCount: number;
  emptyRecallCount: number;
  recallFailureCount: number;
  writeFailureCount: number;
  cognifyFailureCount: number;
  circuitOpenSkipCount: number;
  totalResultCount: number;
  totalLatencyMs: number;
  errors: string[];
}

export class MemoryTelemetryCollector {
  private events: MemoryTelemetryEvent[] = [];

  record(event: MemoryTelemetryEvent): void {
    this.events.push(event);
  }

  getSummary(): MemoryRunSummary {
    const summary: MemoryRunSummary = {
      recallCount: 0,
      writeCount: 0,
      cognifyCount: 0,
      corroborateCount: 0,
      breakerOpenCount: 0,
      emptyRecallCount: 0,
      recallFailureCount: 0,
      writeFailureCount: 0,
      cognifyFailureCount: 0,
      circuitOpenSkipCount: 0,
      totalResultCount: 0,
      totalLatencyMs: 0,
      errors: [],
    };
    for (const event of this.events) {
      summary.totalLatencyMs += event.latencyMs;
      summary.totalResultCount += event.resultCount;
      if (event.operation === 'recall') {
        summary.recallCount += 1;
        if (event.status === 'empty' || event.emptyContext) summary.emptyRecallCount += 1;
        if (event.status === 'failed') summary.recallFailureCount += 1;
      } else if (event.operation === 'write') {
        summary.writeCount += 1;
        if (event.status === 'failed') summary.writeFailureCount += 1;
      } else if (event.operation === 'cognify') {
        summary.cognifyCount += 1;
        if (event.status === 'failed') summary.cognifyFailureCount += 1;
      } else if (event.operation === 'corroborate') {
        summary.corroborateCount += 1;
      } else if (event.operation === 'breaker_open') {
        summary.breakerOpenCount += 1;
      }
      if (event.status === 'circuit_open') summary.circuitOpenSkipCount += 1;
      if (event.error) summary.errors.push(event.error);
    }
    return summary;
  }

  reset(): void {
    this.events = [];
  }
}

export const memoryTelemetry = new MemoryTelemetryCollector();

export function memoryTelemetryEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.STORYRPG_MEMORY_TELEMETRY !== '0';
}
