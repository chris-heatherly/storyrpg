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
import { MemoryArtifactStore, runGraph, type StepDef } from './runGraph';
import { CheckpointArtifactStore, episodeArtifactId, type ArtifactStoreIO } from './checkpointArtifactStore';

/**
 * Foundation phases (world bible → character bible) as a two-step graph
 * chain (adoption A5). The store is an in-memory one seeded from the
 * job-state resume payload — the run directory doesn't exist yet at
 * foundation time, and the EXISTING resume source for these phases is the
 * job checkpoint's outputs, not run-dir files. Resume-by-construction: a
 * seeded artifact skips its producer step exactly where the legacy code
 * branched on `getResumeOutput(...)`.
 *
 * Observable ordering is preserved by construction: with the chain dependency
 * the runner processes world (run OR skip) strictly before characters, and the
 * hooks fire in the legacy slots: built → checkpoint hook, skipped → resumed
 * hook, then the phase-progress hook either way.
 */

export async function runFoundationOnGraph<W, C>(opts: {
  resumedWorldBible: W | undefined;
  resumedCharacterBible: C | undefined;
  buildWorldBible: () => Promise<W>;
  buildCharacterBible: (worldBible: W) => Promise<C>;
  /** Fires after a fresh build, before the phase-progress tick (legacy addCheckpoint slot). */
  onWorldBuilt: (worldBible: W) => void;
  onCharactersBuilt: (characterBible: C) => void;
  /** Fires when the artifact was seeded and the step skipped (legacy "Resumed ..." debug slot). */
  onWorldResumed: () => void;
  onCharactersResumed: () => void;
  /** Fires after each phase regardless of build/skip (legacy emitPhaseProgress slot). */
  afterWorld: () => void;
  afterCharacters: () => void;
  emitDebug: (message: string) => void;
}): Promise<{ worldBible: W; characterBible: C }> {
  const store = new MemoryArtifactStore();
  if (opts.resumedWorldBible !== undefined) await store.save('world_bible', opts.resumedWorldBible);
  if (opts.resumedCharacterBible !== undefined) await store.save('character_bible', opts.resumedCharacterBible);

  const steps: Array<StepDef<void>> = [
    {
      id: 'foundation-world',
      inputs: [],
      outputs: ['world_bible'],
      run: async () => {
        const worldBible = await opts.buildWorldBible();
        opts.onWorldBuilt(worldBible);
        opts.afterWorld();
        return { world_bible: worldBible };
      },
    },
    {
      id: 'foundation-characters',
      inputs: ['world_bible'],
      outputs: ['character_bible'],
      run: async (_ctx, inputs) => {
        const characterBible = await opts.buildCharacterBible(inputs.world_bible as W);
        opts.onCharactersBuilt(characterBible);
        opts.afterCharacters();
        return { character_bible: characterBible };
      },
    },
  ];

  const result = await runGraph({
    steps,
    store,
    ctx: undefined,
    concurrency: 1,
    onEvent: (e) => {
      if (e.type === 'step_skipped') {
        if (e.stepId === 'foundation-world') {
          opts.onWorldResumed();
          opts.afterWorld();
        } else {
          opts.onCharactersResumed();
          opts.afterCharacters();
        }
      }
      if (e.type === 'wave_start') return;
      opts.emitDebug(`${e.type}: ${e.stepId}${e.message ? ` — ${e.message}` : ''}`);
    },
  });

  const failed = result.results.find((r) => r.status === 'failed');
  if (failed) throw new Error(failed.error ?? `Foundation step ${failed.id} failed.`);
  return {
    worldBible: (await store.load('world_bible')) as W,
    characterBible: (await store.load('character_bible')) as C,
  };
}

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
