export type LlmFailureCategory =
  | 'transport'
  | 'schema_rejection'
  | 'parse'
  | 'validation'
  | 'safety'
  | 'timeout'
  | 'quota'
  | 'unknown';

export interface ProviderCallMetric {
  agentName: string;
  provider: 'anthropic' | 'openai' | 'gemini' | 'openrouter';
  model?: string;
  phase?: string;
  success: boolean;
  durationMs: number;
  queueWaitMs: number;
  attempt: number;
  error?: string;
  failureCategory?: LlmFailureCategory;
  promptChars?: number;
  schemaName?: string;
  /**
   * Token usage reported by the provider, when available. Populated by the
   * BaseAgent observer path for anthropic + gemini; undefined for openai or
   * when the provider did not return usage data (e.g. on error).
   */
  usage?: {
    inputTokens: number;
    outputTokens: number;
    thoughtsTokens?: number;
  };
  /**
   * Output-token cap the request was actually sent with (post
   * structuredMaxTokens clamp). Enables near-cap leading indicators (P3).
   */
  requestedMaxTokens?: number;
  requestedVisibleTokens?: number;
  requestedReasoningTokens?: number;
  thoughtsTokens?: number;
}

export interface PhaseMetric {
  phase: string;
  durationMs: number;
  calls?: number;
  failures?: number;
  promptChars?: number;
  inputTokens?: number;
  outputTokens?: number;
}

/**
 * Per-agent slice of the run-level LLM ledger. Aggregates every LLM call made
 * by an agent (including retries — each retry attempt is counted separately
 * so the ledger reflects actual provider billing, not logical calls).
 */
export interface LlmLedgerAgentRow {
  agentName: string;
  provider: 'anthropic' | 'openai' | 'gemini' | 'openrouter';
  calls: number;
  successes: number;
  /** Provider responses received successfully, before parse/schema/contract acceptance. */
  transportSuccesses: number;
  /** Parse or validation rejections observed after a successful provider response. */
  structuredFailures: number;
  /** Conservative accepted count: transport successes minus structured failures. */
  acceptedResponses: number;
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
  totalThoughtsTokens: number;
  /** Number of calls that actually reported usage; calls - usageReported = gaps. */
  usageReported: number;
  /**
   * Responses whose JSON parse recovered from truncation by DROPPING content
   * (landmine L4 — silent loss). Shadow data for the retry-on-truncation
   * decision (WS5): a non-zero count here means this agent shipped incomplete
   * output that looked like a successful parse.
   */
  truncatedResponses: number;
  /**
   * Calls whose reported output landed at ≥85% of the request's actual
   * output-token cap (P3 leading indicator). A rising count here is the
   * early warning for the truncation-abort class — re-budget the schema or
   * shrink the ask before it starts failing runs.
   */
  nearCapCalls: number;
  /** Failure attempts grouped by actionable category. */
  failureCategories: Partial<Record<LlmFailureCategory, number>>;
  /** Exact serialized prompt characters sent across all attempts. */
  totalPromptChars: number;
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
    transportSuccesses: number;
    structuredFailures: number;
    acceptedResponses: number;
    failures: number;
    totalDurationMs: number;
    avgDurationMs: number;
    totalQueueWaitMs: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    totalThoughtsTokens: number;
    /** Calls where the provider reported usage; the rest are gaps. */
    usageReported: number;
    /** Total lossy truncation recoveries across all agents (landmine L4). */
    truncatedResponses: number;
    /** Total calls at ≥85% of their actual output cap (P3 leading indicator). */
    nearCapCalls: number;
    totalPromptChars: number;
    failureCategories: Partial<Record<LlmFailureCategory, number>>;
  };
  byAgent: LlmLedgerAgentRow[];
  budgetDiagnostics: Array<{
    agentName: string;
    provider: ProviderCallMetric['provider'];
    model?: string;
    schemaName?: string;
    success: boolean;
    requestedMaxTokens?: number;
    requestedVisibleTokens?: number;
    requestedReasoningTokens?: number;
    thoughtsTokens?: number;
    error?: string;
  }>;
  phases: PhaseMetric[];
}

/** A call counts as near-cap when reported output reaches 85% of its actual request cap. */
export const NEAR_CAP_RATIO = 0.85;

function isNearCap(m: ProviderCallMetric): boolean {
  return (
    typeof m.requestedMaxTokens === 'number' &&
    m.requestedMaxTokens > 0 &&
    typeof m.usage?.outputTokens === 'number' &&
    m.usage.outputTokens >= m.requestedMaxTokens * NEAR_CAP_RATIO
  );
}

export class PipelineTelemetry {
  private readonly phaseStarts = new Map<string, number>();
  private readonly phaseMetrics: PhaseMetric[] = [];
  private readonly providerCallMetrics: ProviderCallMetric[] = [];
  private readonly semanticFailures: Array<{
    agentName: string;
    provider: ProviderCallMetric['provider'];
    category: Extract<LlmFailureCategory, 'parse' | 'validation'>;
  }> = [];
  /** Lossy truncation recoveries, keyed `agentName::provider` (see WS5 shadow counter). */
  private readonly truncationCounts = new Map<string, number>();

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
    this.providerCallMetrics.push({
      ...metric,
      phase: metric.phase ?? this.getActivePhase() ?? 'unattributed',
    });
  }

  observeSemanticFailure(
    agentName: string,
    provider: ProviderCallMetric['provider'],
    category: Extract<LlmFailureCategory, 'parse' | 'validation'>,
  ): void {
    this.semanticFailures.push({ agentName, provider, category });
  }

  private getActivePhase(): string | undefined {
    return Array.from(this.phaseStarts.keys()).at(-1);
  }

  /** Record one lossy truncation recovery for an agent (BaseAgent observer). */
  observeTruncation(agentName: string, provider: ProviderCallMetric['provider']): void {
    const key = `${agentName}::${provider}`;
    this.truncationCounts.set(key, (this.truncationCounts.get(key) ?? 0) + 1);
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
          transportSuccesses: 0,
          structuredFailures: 0,
          acceptedResponses: 0,
          failures: 0,
          totalDurationMs: 0,
          avgDurationMs: 0,
          totalQueueWaitMs: 0,
          avgQueueWaitMs: 0,
          totalInputTokens: 0,
          totalOutputTokens: 0,
          totalThoughtsTokens: 0,
          usageReported: 0,
          truncatedResponses: 0,
          nearCapCalls: 0,
          failureCategories: {},
          totalPromptChars: 0,
        };
        byAgent.set(key, row);
      }
      row.calls += 1;
      if (m.success) row.successes += 1;
      if (m.success) row.transportSuccesses += 1;
      else row.failures += 1;
      row.totalDurationMs += m.durationMs;
      row.totalQueueWaitMs += m.queueWaitMs;
      if (m.usage) {
        row.totalInputTokens += m.usage.inputTokens;
        row.totalOutputTokens += m.usage.outputTokens;
        row.totalThoughtsTokens += m.usage.thoughtsTokens ?? m.thoughtsTokens ?? 0;
        row.usageReported += 1;
      } else {
        row.totalThoughtsTokens += m.thoughtsTokens ?? 0;
      }
      if (isNearCap(m)) row.nearCapCalls += 1;
      row.totalPromptChars += m.promptChars ?? 0;
      if (!m.success) {
        const category = m.failureCategory ?? 'unknown';
        row.failureCategories[category] = (row.failureCategories[category] ?? 0) + 1;
      }
    }

    for (const failure of this.semanticFailures) {
      const row = byAgent.get(`${failure.agentName}::${failure.provider}`);
      if (row) {
        row.failureCategories[failure.category] = (row.failureCategories[failure.category] ?? 0) + 1;
        row.structuredFailures += 1;
      }
    }

    for (const row of byAgent.values()) {
      row.avgDurationMs = Math.round(row.totalDurationMs / row.calls);
      row.avgQueueWaitMs = Math.round(row.totalQueueWaitMs / row.calls);
      row.truncatedResponses = this.truncationCounts.get(`${row.agentName}::${row.provider}`) ?? 0;
      row.acceptedResponses = Math.max(0, row.transportSuccesses - row.structuredFailures);
    }

    const totals = {
      calls: this.providerCallMetrics.length,
      successes: this.providerCallMetrics.filter((m) => m.success).length,
      transportSuccesses: this.providerCallMetrics.filter((m) => m.success).length,
      structuredFailures: this.semanticFailures.length,
      acceptedResponses: Math.max(
        0,
        this.providerCallMetrics.filter((m) => m.success).length - this.semanticFailures.length,
      ),
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
      totalThoughtsTokens: this.providerCallMetrics.reduce(
        (s, m) => s + (m.usage?.thoughtsTokens ?? m.thoughtsTokens ?? 0),
        0,
      ),
      usageReported: this.providerCallMetrics.filter((m) => m.usage).length,
      truncatedResponses: [...this.truncationCounts.values()].reduce((s, n) => s + n, 0),
      nearCapCalls: this.providerCallMetrics.filter(isNearCap).length,
      totalPromptChars: this.providerCallMetrics.reduce((s, m) => s + (m.promptChars ?? 0), 0),
      failureCategories: {} as Partial<Record<LlmFailureCategory, number>>,
    };
    for (const metric of this.providerCallMetrics) {
      if (!metric.success) {
        const category = metric.failureCategory ?? 'unknown';
        totals.failureCategories[category] = (totals.failureCategories[category] ?? 0) + 1;
      }
    }
    for (const failure of this.semanticFailures) {
      totals.failureCategories[failure.category] = (totals.failureCategories[failure.category] ?? 0) + 1;
    }
    totals.failures = totals.calls - totals.successes;
    totals.avgDurationMs = Math.round(totals.totalDurationMs / totals.calls);

    const rows = Array.from(byAgent.values()).sort((a, b) => b.totalDurationMs - a.totalDurationMs);

    return {
      totals,
      byAgent: rows,
      budgetDiagnostics: this.providerCallMetrics
        .filter((metric) => Boolean(metric.schemaName))
        .map((metric) => ({
          agentName: metric.agentName,
          provider: metric.provider,
          model: metric.model,
          schemaName: metric.schemaName,
          success: metric.success,
          requestedMaxTokens: metric.requestedMaxTokens,
          requestedVisibleTokens: metric.requestedVisibleTokens,
          requestedReasoningTokens: metric.requestedReasoningTokens,
          thoughtsTokens: metric.usage?.thoughtsTokens ?? metric.thoughtsTokens,
          error: metric.error,
        })),
      phases: this.buildPhaseMetrics(),
    };
  }

  private buildPhaseMetrics(): PhaseMetric[] {
    const durations = new Map(this.phaseMetrics.map((metric) => [metric.phase, metric.durationMs]));
    const phases = new Map<string, PhaseMetric>();
    for (const metric of this.providerCallMetrics) {
      const phase = metric.phase ?? 'unattributed';
      const row = phases.get(phase) ?? {
        phase,
        durationMs: durations.get(phase) ?? 0,
        calls: 0,
        failures: 0,
        promptChars: 0,
        inputTokens: 0,
        outputTokens: 0,
      };
      row.calls! += 1;
      if (!metric.success) row.failures! += 1;
      row.promptChars! += metric.promptChars ?? 0;
      row.inputTokens! += metric.usage?.inputTokens ?? 0;
      row.outputTokens! += metric.usage?.outputTokens ?? 0;
      phases.set(phase, row);
    }
    for (const metric of this.phaseMetrics) {
      if (!phases.has(metric.phase)) phases.set(metric.phase, metric);
    }
    return Array.from(phases.values());
  }
}

/**
 * Build the BaseAgent LLM-call observer that records every provider call into a
 * telemetry instance for the run-level LLM ledger (`09-llm-ledger.json`).
 *
 * Extracted so the wiring is unit-testable: the entire `usage` field MUST be
 * forwarded into `observeProviderCall`, otherwise the ledger's token totals /
 * `usageReported` stay 0 even when the provider reports usage. (A prior inline
 * version dropped `usage` here, blinding cost/token tracking — see the
 * pipelineTelemetry regression test.)
 *
 * @param telemetry  the run telemetry collector to record into, OR a getter
 *                   returning the current one. The pipeline reassigns its
 *                   telemetry between runs while the observer is registered only
 *                   once, so it passes a getter to always hit the live instance.
 * @param onUsage    optional callback fed the per-call total token count
 *                   (input + output), used to enforce a per-story token ceiling.
 */
export function buildLlmCallObserver(
  telemetry: PipelineTelemetry | (() => PipelineTelemetry),
  onUsage?: (totalTokens: number) => void,
): (observation: ProviderCallMetric) => void {
  const resolve = typeof telemetry === 'function' ? telemetry : () => telemetry;
  return (observation) => {
    resolve().observeProviderCall({
      agentName: observation.agentName,
      provider: observation.provider,
      model: observation.model,
      phase: observation.phase,
      success: observation.success,
      durationMs: observation.durationMs,
      queueWaitMs: observation.queueWaitMs,
      attempt: observation.attempt,
      error: observation.error,
      failureCategory: observation.failureCategory,
      promptChars: observation.promptChars,
      schemaName: observation.schemaName,
      // Forward provider-reported token usage so the ledger can total tokens.
      usage: observation.usage,
      // Forward the actual request cap so the ledger can flag near-cap calls.
      requestedMaxTokens: observation.requestedMaxTokens,
      requestedVisibleTokens: observation.requestedVisibleTokens,
      requestedReasoningTokens: observation.requestedReasoningTokens,
      thoughtsTokens: observation.thoughtsTokens,
    });
    if (observation.usage && onUsage) {
      onUsage(
        (observation.usage.inputTokens || 0)
        + (observation.usage.outputTokens || 0)
        + (observation.usage.thoughtsTokens || 0),
      );
    }
  };
}
