/**
 * Prompt-snapshot harness (test/CI only — never imported by production code).
 *
 * Purpose: make "pure move" refactors of the generation pipeline *provable*.
 * Every agent LLM call funnels through BaseAgent.callLLM, which exposes a
 * transport-override seam (BaseAgent.setLlmTransportOverride). This module
 * installs a scripted transport there, records the exact ordered sequence of
 * requests the pipeline assembles (agent, provider, model, full messages),
 * and serializes it deterministically. If the serialized snapshot is
 * byte-identical before and after a refactor, the LLM receives identical
 * inputs in identical order — so generated story quality cannot regress from
 * that code change.
 *
 * See docs/PIPELINE_REFACTOR_PLAN.md (Phase 0).
 */

import { BaseAgent, type AgentMessage, type LlmTransportRequest } from '../agents/BaseAgent';
import type { PipelineEvent } from '../pipeline/events';

// ========================================
// CAPTURE
// ========================================

export interface CapturedLlmExchange {
  /** 0-based global order of the call within the capture session. */
  index: number;
  agentName: string;
  provider: string;
  model: string;
  /** The exact messages (system prompt included) the agent assembled. */
  messages: AgentMessage[];
  /** FNV-1a digest of the scripted response (informational, deterministic). */
  responseDigest: string;
}

export type ScriptedResponder = (
  request: LlmTransportRequest,
  globalIndex: number
) => string | Promise<string>;

export class PromptCaptureSession {
  readonly exchanges: CapturedLlmExchange[] = [];
  private active = true;
  // Assigned synchronously at call entry so concurrent in-flight calls (scene
  // fan-out) each get a unique, arrival-ordered index.
  private nextIndex = 0;

  constructor(private readonly responder: ScriptedResponder) {
    BaseAgent.setLlmTransportOverride(async (request) => {
      if (!this.active) {
        throw new Error('PromptCaptureSession received a call after stop()');
      }
      const index = this.nextIndex++;
      const exchange: CapturedLlmExchange = {
        index,
        agentName: request.agentName,
        provider: request.provider,
        model: request.model,
        messages: request.messages,
        responseDigest: '',
      };
      this.exchanges.push(exchange);
      const response = await this.responder(request, index);
      exchange.responseDigest = fnv1a64(response);
      return response;
    });
  }

  /** Uninstall the transport override. Always call in a finally block. */
  stop(): void {
    this.active = false;
    BaseAgent.setLlmTransportOverride(null);
  }
}

export function startPromptCapture(responder: ScriptedResponder): PromptCaptureSession {
  return new PromptCaptureSession(responder);
}

// ========================================
// SCRIPTED FIXTURES
// ========================================

export type ScriptedFixture =
  | string
  | ((request: LlmTransportRequest, perAgentIndex: number, globalIndex: number) => string);

/**
 * Fixtures keyed by agent name (BaseAgent's `name`, as reported in
 * LlmTransportRequest.agentName).
 *
 *   - An array is consumed FIFO; running past the end throws a loud
 *     MissingFixtureError so missing coverage can't silently corrupt a run.
 *   - A single (non-array) fixture is reused for every call from that agent —
 *     useful for repair/retry loops where call counts may grow.
 */
export type ScriptedFixtureMap = Record<string, ScriptedFixture | ScriptedFixture[]>;

export class MissingFixtureError extends Error {
  constructor(agentName: string, perAgentIndex: number, globalIndex: number, recent: string[]) {
    super(
      `No scripted fixture for agent "${agentName}" (call #${perAgentIndex + 1} from this agent, ` +
        `global call #${globalIndex + 1}). Recent call order: ${recent.join(' → ') || '(none)'}. ` +
        `Extend the fixture map to cover this call.`
    );
    this.name = 'MissingFixtureError';
  }
}

export function createScriptedResponder(fixtures: ScriptedFixtureMap): ScriptedResponder {
  const perAgentCounts = new Map<string, number>();
  const callOrder: string[] = [];

  return (request, globalIndex) => {
    const agentName = request.agentName;
    const perAgentIndex = perAgentCounts.get(agentName) ?? 0;
    perAgentCounts.set(agentName, perAgentIndex + 1);
    callOrder.push(agentName);

    const entry = fixtures[agentName];
    let fixture: ScriptedFixture | undefined;
    if (Array.isArray(entry)) {
      fixture = entry[perAgentIndex];
    } else {
      fixture = entry;
    }
    if (fixture === undefined) {
      throw new MissingFixtureError(agentName, perAgentIndex, globalIndex, callOrder.slice(-8));
    }
    return typeof fixture === 'function' ? fixture(request, perAgentIndex, globalIndex) : fixture;
  };
}

// ========================================
// DETERMINISTIC SERIALIZATION
// ========================================

/**
 * Serialize captured exchanges for golden-file comparison. Output is fully
 * deterministic given deterministic prompts: no timestamps, no durations.
 */
export function serializePromptSnapshot(exchanges: CapturedLlmExchange[]): string {
  return JSON.stringify(exchanges, null, 2) + '\n';
}

/**
 * Compact summary of a capture — one line per call — for fast eyeballing of
 * ordering diffs when the full snapshot diff is large.
 */
export function summarizePromptSnapshot(exchanges: CapturedLlmExchange[]): string[] {
  return exchanges.map(
    (e) => `${e.index}: ${e.agentName} [${e.provider}/${e.model}] msgs=${e.messages.length} prompt=${fnv1a64(JSON.stringify(e.messages))}`
  );
}

/**
 * Normalize pipeline events for snapshotting: drop wall-clock fields
 * (timestamp, telemetry) and scrub embedded durations from messages so the
 * sequence is deterministic across runs.
 */
export function normalizeEventsForSnapshot(
  events: PipelineEvent[]
): Array<{ type: string; phase?: string; agent?: string; message: string }> {
  return events.map((e) => ({
    type: e.type,
    ...(e.phase !== undefined ? { phase: e.phase } : {}),
    ...(e.agent !== undefined ? { agent: e.agent } : {}),
    message: scrubTimings(e.message),
  }));
}

/**
 * Normalize checkpoints: keep phase + the shape of the payload, not the
 * payload itself (which can embed timing/identifiers).
 */
export function normalizeCheckpointsForSnapshot(
  checkpoints: Array<{ phase: string; data: unknown; requiresApproval?: boolean }>
): Array<{ phase: string; requiresApproval: boolean; dataKeys: string[] }> {
  return checkpoints.map((c) => ({
    phase: c.phase,
    requiresApproval: !!c.requiresApproval,
    dataKeys:
      c.data && typeof c.data === 'object' ? Object.keys(c.data as Record<string, unknown>).sort() : [],
  }));
}

function scrubTimings(message: string | undefined): string {
  return (message ?? '')
    .replace(/\b\d+(\.\d+)?\s?(ms|s|sec|seconds|minutes|min)\b/gi, '<t>')
    .replace(/\b\d{13}\b/g, '<epoch>')
    // Timestamped run-directory names (the-locked-wing_2026-06-10T03-11-52).
    .replace(/_\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}/g, '_<ts>')
    // Current writer format also includes milliseconds, an epoch-derived id,
    // and a random suffix (the-locked-wing_2026-07-19-22-25-34-081_.../).
    .replace(/generated-stories\/[^/\s"]+_\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}[^/\s"]*\//g, 'generated-stories/<run>/')
    // Observability report embeds per-phase wall-clock durations as JSON.
    .replace(/"phaseDurationsMs":\{[^}]*\}/g, '"phaseDurationsMs":{}')
    .replace(/"(avgDurationMs|avgQueueWaitMs|durationMs|elapsedMs)":\d+(\.\d+)?/g, '"$1":0');
}

/** Dependency-free 64-bit FNV-1a — stable across platforms, good enough for change detection. */
export function fnv1a64(text: string): string {
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const mask = 0xffffffffffffffffn;
  for (let i = 0; i < text.length; i++) {
    hash ^= BigInt(text.charCodeAt(i));
    hash = (hash * prime) & mask;
  }
  return hash.toString(16).padStart(16, '0');
}
