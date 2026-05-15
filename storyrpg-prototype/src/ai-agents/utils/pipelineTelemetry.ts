export interface ProviderCallMetric {
  agentName: string;
  provider: 'anthropic' | 'openai' | 'gemini';
  success: boolean;
  durationMs: number;
  queueWaitMs: number;
  attempt: number;
  error?: string;
  /**
   * Token usage reported by the provider, when available. Populated by the
   * BaseAgent observer path for anthropic + gemini; undefined for openai or
   * when the provider did not return usage data (e.g. on error).
   */
  usage?: {
    inputTokens: number;
    outputTokens: number;
  };
}

export interface PhaseMetric {
  phase: string;
  durationMs: number;
}

/**
 * Per-agent slice of the run-level LLM ledger. Aggregates every LLM call made
 * by an agent (including retries — each retry attempt is counted separately
 * so the ledger reflects actual provider billing, not logical calls).
 */
export interface LlmLedgerAgentRow {
  agentName: string;
  provider: 'anthropic' | 'openai' | 'gemini';
  calls: number;
  successes: number;
  failures: number;
  /** Sum of per-call durationMs. With concurrency this can exceed wall time. */
  totalDurationMs: number;
  avgDurationMs: number;
  totalQueueWaitMs: number;
  avgQueueWaitMs: number;
  /** Sum of input tokens across calls where usage was reported. */
  totalInputTokens: number;
  /** Sum of output tokens across calls where usage was reported. */
  totalOutputTokens: number;
  /** Number of calls that actually reported usage; calls - usageReported = gaps. */
  usageReported: number;
}

/**
 * Run-level LLM ledger — consumed by `savePipelineOutputs` to write
 * `09-llm-ledger.json`. Designed to be self-contained: everything needed to
 * rank future rebalance work by cost without re-reading other artifacts.
 */
export interface LlmLedger {
  totals: {
    calls: number;
    successes: number;
    failures: number;
    totalDurationMs: number;
    avgDurationMs: number;
    totalQueueWaitMs: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    /** Calls where the provider reported usage; the rest are gaps. */
    usageReported: number;
  };
  byAgent: LlmLedgerAgentRow[];
  phases: PhaseMetric[];
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

  /**
   * Raw per-call metrics. Avoid unless the consumer truly needs per-call
   * detail — most callers should use `getLlmLedger()` which aggregates to a
   * manageable artifact size.
   */
  getProviderCallMetrics(): ProviderCallMetric[] {
    return [...this.providerCallMetrics];
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

  /**
   * Build a run-level LLM ledger from all observed provider calls and phase
   * metrics. Returns `null` when no LLM calls were observed so callers can
   * skip writing an empty artifact. I4 instrumentation — token totals depend
   * on each provider reporting usage; counts of calls without usage are
   * surfaced via `usageReported` so gaps are visible.
   */
  getLlmLedger(): LlmLedger | null {
    if (this.providerCallMetrics.length === 0) return null;

    type AgentKey = string;
    const byAgent = new Map<AgentKey, LlmLedgerAgentRow>();

    for (const m of this.providerCallMetrics) {
      const key = `${m.agentName}::${m.provider}`;
      let row = byAgent.get(key);
      if (!row) {
        row = {
          agentName: m.agentName,
          provider: m.provider,
          calls: 0,
          successes: 0,
          failures: 0,
          totalDurationMs: 0,
          avgDurationMs: 0,
          totalQueueWaitMs: 0,
          avgQueueWaitMs: 0,
          totalInputTokens: 0,
          totalOutputTokens: 0,
          usageReported: 0,
        };
        byAgent.set(key, row);
      }
      row.calls += 1;
      if (m.success) row.successes += 1;
      else row.failures += 1;
      row.totalDurationMs += m.durationMs;
      row.totalQueueWaitMs += m.queueWaitMs;
      if (m.usage) {
        row.totalInputTokens += m.usage.inputTokens;
        row.totalOutputTokens += m.usage.outputTokens;
        row.usageReported += 1;
      }
    }

    for (const row of byAgent.values()) {
      row.avgDurationMs = Math.round(row.totalDurationMs / row.calls);
      row.avgQueueWaitMs = Math.round(row.totalQueueWaitMs / row.calls);
    }

    const totals = {
      calls: this.providerCallMetrics.length,
      successes: this.providerCallMetrics.filter((m) => m.success).length,
      failures: 0,
      totalDurationMs: this.providerCallMetrics.reduce((s, m) => s + m.durationMs, 0),
      avgDurationMs: 0,
      totalQueueWaitMs: this.providerCallMetrics.reduce((s, m) => s + m.queueWaitMs, 0),
      totalInputTokens: this.providerCallMetrics.reduce(
        (s, m) => s + (m.usage?.inputTokens ?? 0),
        0,
      ),
      totalOutputTokens: this.providerCallMetrics.reduce(
        (s, m) => s + (m.usage?.outputTokens ?? 0),
        0,
      ),
      usageReported: this.providerCallMetrics.filter((m) => m.usage).length,
    };
    totals.failures = totals.calls - totals.successes;
    totals.avgDurationMs = Math.round(totals.totalDurationMs / totals.calls);

    const rows = Array.from(byAgent.values()).sort((a, b) => b.totalDurationMs - a.totalDurationMs);

    return {
      totals,
      byAgent: rows,
      phases: [...this.phaseMetrics],
    };
  }
}
