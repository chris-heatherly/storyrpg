/**
 * Run-graph execution of the sequential episode loop (adoption A2,
 * 2026-06-11). Builds the per-episode step chain and runs it on the
 * pipeline/runGraph.ts runner, journaled into the checkpoint artifact store
 * (the EXISTING WS1a watermark layout — legacy and graph runs resume each
 * other). The per-episode body itself stays in FullStoryPipeline (one closure
 * shared with the legacy for-loop); this module owns only the scheduling.
 *
 * Failure semantics mirror the legacy loop exactly (golden-parity tested by
 * FullStoryPipeline.runGraphParity.season.test.ts):
 *   - STRICT validation: steps chain (episode N depends on N-1's artifact);
 *     a failure blocks downstream and the ORIGINAL error rethrows — the
 *     legacy loop's abort-on-throw.
 *   - ADVISORY validation: steps are dependency-free at concurrency 1 (array
 *     order preserved); a failure is journaled and the rest continue — the
 *     legacy loop's record-and-continue.
 */

import type { Episode } from '../../types';
import { runGraph, type StepDef } from './runGraph';
import { CheckpointArtifactStore, episodeArtifactId, type ArtifactStoreIO } from './checkpointArtifactStore';

export async function runEpisodeLoopOnGraph<S extends { episodeNumber: number }>(opts: {
  specs: S[];
  /** validation.mode === 'strict' — chains steps and rethrows the first failure. */
  strict: boolean;
  /** Run-directory IO (saveEarlyDiagnostic / loadEarlyDiagnosticSync bindings). */
  io: ArtifactStoreIO;
  /** The shared per-episode body. Returns the assembled episode, or null on an advisory-mode failure. */
  processEpisode: (spec: S) => Promise<Episode | null>;
  emitDebug: (message: string) => void;
}): Promise<void> {
  const store = new CheckpointArtifactStore(opts.io);
  let firstStepError: unknown;

  const steps: Array<StepDef<void>> = opts.specs.map((spec, idx) => ({
    id: `episode-${spec.episodeNumber}`,
    inputs: opts.strict && idx > 0 ? [episodeArtifactId(opts.specs[idx - 1].episodeNumber)] : [],
    outputs: [episodeArtifactId(spec.episodeNumber)],
    run: async () => {
      try {
        const episode = await opts.processEpisode(spec);
        if (!episode) {
          // Advisory-mode failure result: the run's result arrays already
          // carry the failure record (legacy parity); the step is marked
          // failed so the journal stays honest, with no artifact to persist.
          throw new Error(`Episode ${spec.episodeNumber} produced no assembled episode.`);
        }
        return { [episodeArtifactId(spec.episodeNumber)]: episode };
      } catch (err) {
        firstStepError ??= err;
        throw err;
      }
    },
  }));

  const result = await runGraph({
    steps,
    store,
    ctx: undefined,
    concurrency: 1,
    onEvent: (e) => {
      if (e.type === 'wave_start') return;
      opts.emitDebug(`${e.type}: ${e.stepId}${e.message ? ` — ${e.message}` : ''}`);
    },
  });

  if (opts.strict && firstStepError) throw firstStepError;
  if (!result.ok) {
    const failed = result.results.filter((r) => r.status === 'failed').length;
    opts.emitDebug(`Run-graph episode loop finished with ${failed} failed step(s) (advisory mode — continuing)`);
  }
}
