/**
 * Saving Phase
 *
 * Thin wrapper around `savePipelineOutputs` that normalizes the
 * cross-cutting concerns (timeout, phase events, error handling) currently
 * inlined in `FullStoryPipeline`. Extracted as the template leaf phase for
 * the Phase 5 migration (see `phases/index.ts`).
 *
 * Contract:
 *   - Never throws on disk failure (save errors emit a `warning` event).
 *   - Always races against a 2-minute timeout.
 *   - Returns the `OutputManifest` on success, `null` on save failure.
 */

import {
  savePipelineOutputs,
  type OutputManifest,
  type PipelineOutputs,
} from '../../utils/pipelineOutputWriter';
import type { PipelineContext, PipelinePhase } from './index';

export interface SavingPhaseInput {
  outputDirectory: string;
  outputs: PipelineOutputs;
  /** Wall-clock duration of the whole pipeline run so far. */
  durationMs?: number;
  /** Per-save timeout in ms. Defaults to 2 minutes. */
  timeoutMs?: number;
}

export interface SavingPhaseResult {
  manifest: OutputManifest | null;
  error?: Error;
}

export const DEFAULT_SAVE_TIMEOUT_MS = 120_000;

export class SavingPhase implements PipelinePhase<SavingPhaseInput, SavingPhaseResult> {
  name = 'SavingPhase';

  async run(input: SavingPhaseInput, context: PipelineContext): Promise<SavingPhaseResult> {
    const timeoutMs = input.timeoutMs ?? DEFAULT_SAVE_TIMEOUT_MS;

    try {
      const savePromise = savePipelineOutputs(
        input.outputDirectory,
        input.outputs,
        input.durationMs
      );
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error(`OutputWriter timed out after ${Math.round(timeoutMs / 1000)}s`)),
          timeoutMs
        )
      );

      const manifest = await Promise.race([savePromise, timeoutPromise]);
      context.emit({
        type: 'phase_complete',
        phase: 'saving',
        message: `Saved ${manifest.files.length} files to ${input.outputDirectory}`,
      });
      return { manifest };
    } catch (saveError) {
      const err = saveError instanceof Error ? saveError : new Error(String(saveError));
      context.emit({
        type: 'warning',
        phase: 'saving',
        message: `Failed to save output files (non-blocking): ${err.message}`,
      });
      return { manifest: null, error: err };
    }
  }
}

export function createSavingPhase(): SavingPhase {
  return new SavingPhase();
}
