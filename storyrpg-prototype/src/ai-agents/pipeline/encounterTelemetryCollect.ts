/**
 * Encounter-telemetry capture (extracted from FullStoryPipeline, which is slated
 * for decomposition — do not grow it).
 *
 * Pulls an `EncounterTelemetry` payload out of an EncounterArchitect response's
 * metadata and records it into BOTH the per-episode buffer and the season-level
 * accumulator. gen-5 fixes: recover a missing/blank `sceneId` from the call-site
 * blueprint id (a payload that merely lacked its id was silently dropped — the
 * 1-of-3-encounters-counted bug), and warn instead of dropping when no usable
 * telemetry is present so 06c-encounter-telemetry stays a faithful count.
 */

import type { EncounterTelemetry } from '../agents/EncounterArchitect';

/** Per-episode buffer + season accumulator the pipeline owns. */
export interface EncounterTelemetryBuffers {
  /** Reset per episode — only ever holds the current episode's encounters. */
  perEpisode: EncounterTelemetry[];
  /** Survives the per-episode reset so the final 06c write counts every encounter. */
  season: EncounterTelemetry[];
}

export function captureEncounterTelemetry(
  buffers: EncounterTelemetryBuffers,
  metadata: Record<string, unknown> | undefined,
  sceneId?: string,
): void {
  const raw = metadata?.encounterTelemetry as EncounterTelemetry | undefined;
  if (raw) {
    if (typeof raw.sceneId !== 'string' || raw.sceneId.length === 0) {
      if (sceneId) raw.sceneId = sceneId;
    }
    if (typeof raw.sceneId === 'string' && raw.sceneId.length > 0) {
      buffers.perEpisode.push(raw);
      if (!buffers.season.some((t) => t.sceneId === raw.sceneId)) {
        buffers.season.push(raw);
      }
      return;
    }
  }
  console.warn(
    `[Pipeline] ⚠ Encounter ${sceneId ?? '(unknown scene)'} produced no telemetry payload — ` +
      `06c-encounter-telemetry will undercount. Ensure EncounterArchitect emits metadata.encounterTelemetry.sceneId.`,
  );
}
