export interface ProviderCallMetric {
  agentName: string;
  provider: 'anthropic' | 'openai' | 'gemini';
  success: boolean;
  durationMs: number;
  queueWaitMs: number;
  attempt: number;
  error?: string;
}

export interface PhaseMetric {
  phase: string;
  durationMs: number;
}

export class PipelineTelemetry {
  private readonly phaseStarts = new Map<string, number>();
  private readonly phaseMetrics: PhaseMetric[] = [];
  private readonly providerCallMetrics: ProviderCallMetric[] = [];

  startPhase(phase: string): void {
    this.phaseStarts.set(phase, Date.now());
  }

  endPhase(phase: string): void {
    const start = this.phaseStarts.get(phase);
    if (start === undefined) return;
    this.phaseStarts.delete(phase);
    this.phaseMetrics.push({
      phase,
      durationMs: Date.now() - start,
    });
  }

  observeProviderCall(metric: ProviderCallMetric): void {
    this.providerCallMetrics.push(metric);
  }

  getPhaseMetrics(): PhaseMetric[] {
    return [...this.phaseMetrics];
  }

  getProviderSummary(): {
    totalCalls: number;
    successCalls: number;
    failedCalls: number;
    avgDurationMs: number;
    avgQueueWaitMs: number;
  } {
    const totalCalls = this.providerCallMetrics.length;
    if (totalCalls === 0) {
      return {
        totalCalls: 0,
        successCalls: 0,
        failedCalls: 0,
        avgDurationMs: 0,
        avgQueueWaitMs: 0,
      };
    }
    const successCalls = this.providerCallMetrics.filter((m) => m.success).length;
    const failedCalls = totalCalls - successCalls;
    const avgDurationMs = Math.round(
      this.providerCallMetrics.reduce((sum, m) => sum + m.durationMs, 0) / totalCalls
    );
    const avgQueueWaitMs = Math.round(
      this.providerCallMetrics.reduce((sum, m) => sum + m.queueWaitMs, 0) / totalCalls
    );
    return {
      totalCalls,
      successCalls,
      failedCalls,
      avgDurationMs,
      avgQueueWaitMs,
    };
  }
}

