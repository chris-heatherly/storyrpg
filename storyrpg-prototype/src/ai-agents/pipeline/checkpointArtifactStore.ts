/**
 * File-backed ArtifactStore over the run directory's checkpoint layout
 * (adoption wave A1, 2026-06-11 — phase 5 of the pipeline decomposition).
 *
 * Bridges the run-graph runner (pipeline/runGraph.ts) to the SAME persistence
 * the pipeline already uses, so graph-journaled runs and legacy runs read each
 * other's artifacts:
 *
 *   - Episode artifacts (`episode_assembled:N`) route to the EXISTING WS1a
 *     watermark layout (checkpoints/episode-N-complete.json +
 *     episode-N-assembled.json) via episodeCheckpoints.ts. A run half-finished
 *     under the legacy loop resumes under the graph, and vice versa.
 *   - Everything else persists as an enveloped JSON artifact under
 *     checkpoints/artifacts/<id>.json. The envelope pins the artifact id, so
 *     a torn/foreign file degrades to "absent" (re-run the producer) — the
 *     same crash-degradation discipline as the watermark probe.
 *
 * IO is injected as the ArtifactSaver/ArtifactLoader pair the pipeline already
 * wires to saveEarlyDiagnostic / loadEarlyDiagnosticSync (see
 * writeEpisodeCompletion call sites) — no expo/fs imports here, trivially
 * testable. saveEarlyDiagnostic swallows write failures by design, so save()
 * VERIFIES by reading back and throws when persistence didn't stick; the
 * runner then records the step as failed instead of trusting a phantom write.
 */

import type { Episode } from '../../types';
import type { ArtifactId, ArtifactStore } from './runGraph';
import {
  type ArtifactLoader,
  type ArtifactSaver,
  loadCompletedEpisode,
  writeEpisodeCompletion,
} from './episodeCheckpoints';

export interface ArtifactStoreIO {
  save: ArtifactSaver;
  load: ArtifactLoader;
}

/** Graph artifact id for an assembled, sealed episode. */
export const EPISODE_ARTIFACT_PREFIX = 'episode_assembled:';
export function episodeArtifactId(episodeNumber: number): ArtifactId {
  return `${EPISODE_ARTIFACT_PREFIX}${episodeNumber}`;
}
function episodeNumberFromArtifactId(id: ArtifactId): number | null {
  if (!id.startsWith(EPISODE_ARTIFACT_PREFIX)) return null;
  const n = Number(id.slice(EPISODE_ARTIFACT_PREFIX.length));
  return Number.isInteger(n) && n > 0 ? n : null;
}

/** Relative path for a generic (non-episode) graph artifact. */
export function artifactFilePath(id: ArtifactId): string {
  const safe = id.replace(/[^a-z0-9._-]+/gi, '__');
  return `checkpoints/artifacts/${safe}.json`;
}

interface ArtifactEnvelope {
  version: 1;
  artifactId: string;
  savedAt: string;
  value: unknown;
}

export class CheckpointArtifactStore implements ArtifactStore {
  constructor(private readonly io: ArtifactStoreIO) {}

  async has(id: ArtifactId): Promise<boolean> {
    const episodeNumber = episodeNumberFromArtifactId(id);
    if (episodeNumber !== null) {
      return loadCompletedEpisode(episodeNumber, this.io.load) !== null;
    }
    return this.readEnvelope(id) !== null;
  }

  async load(id: ArtifactId): Promise<unknown> {
    const episodeNumber = episodeNumberFromArtifactId(id);
    if (episodeNumber !== null) {
      return loadCompletedEpisode(episodeNumber, this.io.load)?.episode;
    }
    return this.readEnvelope(id)?.value;
  }

  async save(id: ArtifactId, value: unknown): Promise<void> {
    const episodeNumber = episodeNumberFromArtifactId(id);
    if (episodeNumber !== null) {
      const episode = value as Episode;
      await writeEpisodeCompletion({
        episode,
        episodeNumber,
        title: (episode as { title?: string }).title ?? `Episode ${episodeNumber}`,
        save: this.io.save,
      });
      if (loadCompletedEpisode(episodeNumber, this.io.load) === null) {
        throw new Error(`Episode artifact "${id}" failed to persist (watermark probe rejects it).`);
      }
      return;
    }
    const envelope: ArtifactEnvelope = {
      version: 1,
      artifactId: id,
      savedAt: new Date().toISOString(),
      value,
    };
    await this.io.save(artifactFilePath(id), envelope);
    if (this.readEnvelope(id) === null) {
      throw new Error(`Artifact "${id}" failed to persist (write was swallowed or envelope mismatched).`);
    }
  }

  private readEnvelope(id: ArtifactId): ArtifactEnvelope | null {
    const envelope = this.io.load<ArtifactEnvelope>(artifactFilePath(id));
    if (!envelope || envelope.version !== 1 || envelope.artifactId !== id) return null;
    if (!('value' in envelope)) return null;
    return envelope;
  }
}
