/**
 * Run-graph runner core (refactor R6, 2026-06-11 — phase 3 of the
 * FullStoryPipeline decomposition).
 *
 * The pipeline's reliability features have historically been hand-woven into
 * implicit control flow (generate → generateMultipleEpisodes →
 * generateEpisodeFromOutline), so every one of them — resume, surgical
 * repair, fail-fast, parallelism — needed a bespoke seam. This module inverts
 * that: a run is a declared graph of STEPS over named ARTIFACTS, and the
 * runner owns the cross-cutting semantics once:
 *
 *   - RESUME BY CONSTRUCTION: a step whose outputs all exist in the artifact
 *     store is skipped. Re-running a half-finished run re-executes only what
 *     is missing. (The existing checkpoint manifest/files become an
 *     ArtifactStore implementation at adoption time.)
 *   - SURGICAL REPAIR: invalidate an artifact and the runner re-runs its
 *     producer plus every transitive downstream step — "regenerate scene
 *     s2-1 and re-validate" instead of discarding the run.
 *   - PARALLEL WAVES: steps schedule by data dependency (Kahn topological
 *     waves) with bounded concurrency, not by hand-sequenced Promise.alls.
 *   - FAILURE ISOLATION: a failed step blocks only its transitive downstream;
 *     independent branches keep running, so one bad scene doesn't waste the
 *     episode's other work.
 *
 * Deterministic core: no wall-clock, no randomness; persistence and LLM work
 * live behind the injected ArtifactStore / step run() functions. Adoption
 * (wrapping the existing phases as steps and swapping the orchestrator stack
 * behind a flag with golden parity) is the follow-up wave — this module ships
 * the semantics, fully unit-tested, with zero changes to live control flow.
 */

/** Stable artifact identifier, e.g. `scene_content:episode-2:s2-1`. */
export type ArtifactId = string;

export interface StepDef<Ctx = unknown> {
  /** Unique step id (journal/progress key). */
  id: string;
  /** Artifacts this step consumes. Inputs no step produces are EXTERNAL and must pre-exist in the store. */
  inputs: ArtifactId[];
  /** Artifacts this step produces. Each artifact has exactly ONE producer. */
  outputs: ArtifactId[];
  /** Execute the step. Receives loaded input artifacts; returns every declared output. */
  run(ctx: Ctx, inputs: Record<ArtifactId, unknown>): Promise<Record<ArtifactId, unknown>>;
}

/** Persistence boundary. The checkpoint manifest + files adapt to this at adoption. */
export interface ArtifactStore {
  has(id: ArtifactId): Promise<boolean>;
  load(id: ArtifactId): Promise<unknown>;
  save(id: ArtifactId, value: unknown): Promise<void>;
}

export type StepStatus = 'completed' | 'skipped' | 'failed' | 'blocked' | 'cancelled';

export interface StepResult {
  id: string;
  status: StepStatus;
  /** Present on 'failed'. */
  error?: string;
  /** Step ids whose failure blocked this step (present on 'blocked'). */
  blockedBy?: string[];
}

export interface RunGraphEvent {
  type: 'step_start' | 'step_complete' | 'step_skipped' | 'step_failed' | 'step_blocked' | 'wave_start';
  stepId?: string;
  wave?: number;
  message?: string;
}

export interface RunGraphOptions<Ctx> {
  steps: Array<StepDef<Ctx>>;
  store: ArtifactStore;
  ctx: Ctx;
  /** Max steps in flight within a wave (default 4). */
  concurrency?: number;
  /** Re-run these artifacts' producers (and everything downstream) even if outputs exist. */
  invalidate?: ArtifactId[];
  /** Checked between steps; true stops scheduling (in-flight steps finish). */
  shouldCancel?: () => boolean;
  onEvent?: (event: RunGraphEvent) => void;
}

export interface RunGraphResult {
  /** True when no step failed, was blocked, or was cancelled. */
  ok: boolean;
  results: StepResult[];
}

/** Thrown for structural graph errors (caller bugs) before any step runs. */
export class RunGraphDefinitionError extends Error {}

interface GraphIndex<Ctx> {
  byId: Map<string, StepDef<Ctx>>;
  producerOf: Map<ArtifactId, string>;
  /** step id → step ids it depends on (via produced inputs). */
  dependsOn: Map<string, Set<string>>;
  /** step id → step ids that depend on it. */
  dependents: Map<string, Set<string>>;
  /** Inputs with no producer (must pre-exist in the store). */
  externalInputs: Set<ArtifactId>;
}

function indexGraph<Ctx>(steps: Array<StepDef<Ctx>>): GraphIndex<Ctx> {
  const byId = new Map<string, StepDef<Ctx>>();
  const producerOf = new Map<ArtifactId, string>();
  for (const step of steps) {
    if (byId.has(step.id)) throw new RunGraphDefinitionError(`Duplicate step id "${step.id}".`);
    byId.set(step.id, step);
    for (const out of step.outputs) {
      const existing = producerOf.get(out);
      if (existing) throw new RunGraphDefinitionError(`Artifact "${out}" has two producers: "${existing}" and "${step.id}".`);
      producerOf.set(out, step.id);
    }
  }
  const dependsOn = new Map<string, Set<string>>();
  const dependents = new Map<string, Set<string>>();
  const externalInputs = new Set<ArtifactId>();
  for (const step of steps) {
    dependsOn.set(step.id, new Set());
    if (!dependents.has(step.id)) dependents.set(step.id, new Set());
  }
  for (const step of steps) {
    for (const input of step.inputs) {
      const producer = producerOf.get(input);
      if (!producer) {
        externalInputs.add(input);
        continue;
      }
      if (producer === step.id) throw new RunGraphDefinitionError(`Step "${step.id}" consumes its own output "${input}".`);
      dependsOn.get(step.id)!.add(producer);
      dependents.get(producer)!.add(step.id);
    }
  }
  return { byId, producerOf, dependsOn, dependents, externalInputs };
}

/** Kahn topological waves; throws on a cycle. */
export function topologicalWaves<Ctx>(steps: Array<StepDef<Ctx>>): string[][] {
  const { dependsOn, dependents } = indexGraph(steps);
  const remainingDeps = new Map<string, number>();
  for (const [id, deps] of dependsOn) remainingDeps.set(id, deps.size);
  const waves: string[][] = [];
  let frontier = [...remainingDeps].filter(([, n]) => n === 0).map(([id]) => id);
  const seen = new Set<string>();
  while (frontier.length > 0) {
    waves.push(frontier);
    const next: string[] = [];
    for (const id of frontier) {
      seen.add(id);
      for (const dep of dependents.get(id) ?? []) {
        const n = (remainingDeps.get(dep) ?? 0) - 1;
        remainingDeps.set(dep, n);
        if (n === 0) next.push(dep);
      }
    }
    frontier = next;
  }
  if (seen.size !== steps.length) {
    const cyclic = steps.filter((s) => !seen.has(s.id)).map((s) => s.id);
    throw new RunGraphDefinitionError(`Dependency cycle among steps: ${cyclic.join(', ')}.`);
  }
  return waves;
}

/**
 * Artifacts considered STALE for this run: the requested invalidations plus
 * everything transitively downstream of them (through producing steps).
 * A step with any stale output re-runs even if its outputs exist.
 */
function staleArtifacts<Ctx>(index: GraphIndex<Ctx>, invalidate: ArtifactId[]): Set<ArtifactId> {
  const stale = new Set<ArtifactId>();
  const stepQueue: string[] = [];
  for (const id of invalidate) {
    if (stale.has(id)) continue;
    stale.add(id);
    const producer = index.producerOf.get(id);
    if (producer) stepQueue.push(producer);
  }
  // Every dependent step of a stale artifact's producer re-runs, making ITS
  // outputs stale, and so on transitively.
  const visitedSteps = new Set<string>();
  while (stepQueue.length > 0) {
    const stepId = stepQueue.shift()!;
    if (visitedSteps.has(stepId)) continue;
    visitedSteps.add(stepId);
    const step = index.byId.get(stepId);
    if (!step) continue;
    for (const out of step.outputs) stale.add(out);
    for (const dependent of index.dependents.get(stepId) ?? []) stepQueue.push(dependent);
  }
  return stale;
}

async function mapBounded<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (next < items.length) {
      const i = next++;
      await fn(items[i]);
    }
  });
  await Promise.all(workers);
}

/**
 * Execute the graph. See module header for semantics. Never throws for STEP
 * failures (they're reported in results); throws RunGraphDefinitionError for
 * structural graph bugs.
 */
export async function runGraph<Ctx>(opts: RunGraphOptions<Ctx>): Promise<RunGraphResult> {
  const index = indexGraph(opts.steps);
  const waves = topologicalWaves(opts.steps);
  const stale = staleArtifacts(index, opts.invalidate ?? []);
  const concurrency = opts.concurrency ?? 4;
  const emit = opts.onEvent ?? (() => undefined);

  const results = new Map<string, StepResult>();
  const failedOrBlocked = new Set<string>();
  let cancelled = false;

  for (let w = 0; w < waves.length; w++) {
    emit({ type: 'wave_start', wave: w });
    await mapBounded(waves[w], concurrency, async (stepId) => {
      const step = index.byId.get(stepId)!;

      // Upstream failure/block → blocked (deterministic regardless of wave timing).
      const blockedBy = [...index.dependsOn.get(stepId)!].filter((d) => failedOrBlocked.has(d));
      if (blockedBy.length > 0) {
        failedOrBlocked.add(stepId);
        results.set(stepId, { id: stepId, status: 'blocked', blockedBy });
        emit({ type: 'step_blocked', stepId, message: `blocked by ${blockedBy.join(', ')}` });
        return;
      }

      if (cancelled || opts.shouldCancel?.()) {
        cancelled = true;
        // A cancelled step blocks its downstream like a failure — dependents
        // must not run against outputs that were never produced.
        failedOrBlocked.add(stepId);
        results.set(stepId, { id: stepId, status: 'cancelled' });
        return;
      }

      // Resume by construction: all outputs present and none stale → skip.
      const outputsStale = step.outputs.some((o) => stale.has(o));
      if (!outputsStale && step.outputs.length > 0) {
        const present = await Promise.all(step.outputs.map((o) => opts.store.has(o)));
        if (present.every(Boolean)) {
          results.set(stepId, { id: stepId, status: 'skipped' });
          emit({ type: 'step_skipped', stepId });
          return;
        }
      }

      // Load inputs (external inputs must pre-exist).
      const inputs: Record<ArtifactId, unknown> = {};
      try {
        for (const input of step.inputs) {
          if (index.externalInputs.has(input) && !(await opts.store.has(input))) {
            throw new Error(`External input artifact "${input}" is missing from the store.`);
          }
          inputs[input] = await opts.store.load(input);
        }

        emit({ type: 'step_start', stepId });
        const outputs = await step.run(opts.ctx, inputs);
        for (const out of step.outputs) {
          if (!(out in outputs)) {
            throw new Error(`Step "${stepId}" did not return declared output "${out}".`);
          }
          await opts.store.save(out, outputs[out]);
        }
        results.set(stepId, { id: stepId, status: 'completed' });
        emit({ type: 'step_complete', stepId });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        failedOrBlocked.add(stepId);
        results.set(stepId, { id: stepId, status: 'failed', error: message });
        emit({ type: 'step_failed', stepId, message });
      }
    });
  }

  const ordered = opts.steps.map((s) => results.get(s.id)!).filter(Boolean);
  return {
    ok: ordered.every((r) => r.status === 'completed' || r.status === 'skipped'),
    results: ordered,
  };
}

/** In-memory ArtifactStore (tests + dry runs). */
export class MemoryArtifactStore implements ArtifactStore {
  private readonly artifacts = new Map<ArtifactId, unknown>();
  constructor(seed?: Record<ArtifactId, unknown>) {
    for (const [k, v] of Object.entries(seed ?? {})) this.artifacts.set(k, v);
  }
  async has(id: ArtifactId): Promise<boolean> {
    return this.artifacts.has(id);
  }
  async load(id: ArtifactId): Promise<unknown> {
    return this.artifacts.get(id);
  }
  async save(id: ArtifactId, value: unknown): Promise<void> {
    this.artifacts.set(id, value);
  }
  keys(): ArtifactId[] {
    return [...this.artifacts.keys()];
  }
}
