/**
 * Late media binding for the contract-first phase ordering.
 *
 * The final TEXT contract (enforceFinalStoryContract / treatment fidelity) now
 * runs BEFORE image/video/audio generation, so the assembled story that passed
 * the contract carries no media yet. This module binds the media generated
 * afterwards into that contract-passed story — WITHOUT re-assembling from
 * sceneContents/choiceSets, which would discard the contract's in-place
 * repairs (scene-prose rewrites, outcome re-authors, deterministic autofixes).
 *
 * Binding is the same late-binding path the pipeline already trusts:
 *   - `assembleStoryAssetsFromRegistry` overlays every registry-tracked slot
 *     family (scene backgrounds, beat images/panels, encounter setup/outcome/
 *     situation, storylet aftermath) — the registry is seeded from the image
 *     phase results via seedAssetRegistryFromResults.
 *   - `bindGeneratedVideoToStory` maps beat videos by episode-scoped key.
 *   - Cover art + NPC portraits are wired here with the same precedence the
 *     old media-first assembly used (story cover → first-scene background).
 *
 * Extracted to its own module to keep FullStoryPipeline within its monolith
 * ratchet baseline.
 */

import type { Story } from '../../types';
import { mediaRefAsString } from '../../assets/assetRef';
import type { AssetRegistry } from '../images/assetRegistry';
import type { ImageAgentTeam } from '../agents/image-team/ImageAgentTeam';
import { assembleStoryAssetsFromRegistry } from '../images/storyAssetAssembler';
import { savePipelineErrorLog } from '../utils/pipelineOutputWriter';
import { PipelineError } from './errors';
import { bindGeneratedVideoToStory } from './phases/VideoPhase';
import type { PipelineContext } from './phases/index';

export interface StoryMediaBindingInputs {
  assetRegistry: AssetRegistry;
  /** Generated story cover art URL (single-episode cover or season cover). */
  storyCoverUrl?: string;
  /**
   * Single-episode parity: assembleStory used the generated cover for the
   * episode cover too (multi-episode assembleEpisode never did).
   */
  applyCoverToEpisodes?: boolean;
  videoResults?: Map<string, string>;
  /** When provided, missing NPC portraits are filled from reference sheets. */
  imageAgentTeam?: Pick<ImageAgentTeam, 'getReferenceSheet'>;
}

/**
 * Bind late-generated media into a (contract-passed) story. Returns a new
 * story object (the registry overlay clones); never removes existing media,
 * only fills what is missing.
 */
export function bindStoryMediaAssets(story: Story, inputs: StoryMediaBindingInputs): Story {
  const next = assembleStoryAssetsFromRegistry(story, inputs.assetRegistry);

  if (inputs.videoResults && inputs.videoResults.size > 0) {
    bindGeneratedVideoToStory(next, inputs.videoResults);
  }

  for (const episode of next.episodes || []) {
    if (episode.coverImage) continue;
    const firstScene = (episode.scenes || [])[0];
    episode.coverImage = (inputs.applyCoverToEpisodes ? inputs.storyCoverUrl : undefined)
      || firstScene?.backgroundImage
      || '';
  }

  if (!next.coverImage) {
    next.coverImage = inputs.storyCoverUrl || mediaRefAsString(next.episodes?.[0]?.coverImage);
  }

  if (inputs.imageAgentTeam) {
    for (const npc of next.npcs || []) {
      if (npc.portrait) continue;
      const refSheet = inputs.imageAgentTeam.getReferenceSheet(npc.id);
      if (!refSheet) continue;
      const frontImg = refSheet.generatedImages.get('front') || refSheet.generatedImages.get('composite');
      const portrait = frontImg?.imageUrl || frontImg?.imagePath;
      if (portrait) npc.portrait = portrait;
    }
  }

  return next;
}

/**
 * Shared failure funnel for the single-episode run-setup and image-generation
 * try blocks (one block before the reorder; the text contract now runs
 * between them). Exact behavior of the original inline catch: quota failures
 * and generic errors are wrapped as phase-'images' PipelineErrors,
 * PipelineErrors pass through untouched, and generic failures are logged to
 * the run's pipeline error log first.
 */
export async function rethrowAsImagePhaseFailure(
  imgError: unknown,
  deps: {
    isLlmQuotaFailure: (err: unknown) => boolean;
    emit: PipelineContext['emit'];
    outputDirectory?: string;
  },
): Promise<never> {
  if (deps.isLlmQuotaFailure(imgError)) {
    const quotaMsg = imgError instanceof Error ? imgError.message : String(imgError);
    deps.emit({ type: 'error', phase: 'images', message: `Image generation stopped: ${quotaMsg}` });
    throw new PipelineError(`Image generation stopped due to LLM quota exhaustion: ${quotaMsg}`, 'images', {
      agent: 'ImageAgentTeam',
      context: { mode: 'single-episode' },
      originalError: imgError instanceof Error ? imgError : undefined,
    });
  }
  if (imgError instanceof PipelineError) {
    throw imgError;
  }
  const imgErrorMsg = imgError instanceof Error ? imgError.message : String(imgError);
  console.error(`[Pipeline] Image generation failed: ${imgErrorMsg}`);
  deps.emit({
    type: 'error',
    phase: 'images',
    message: `Image generation failed: ${imgErrorMsg}`,
  });
  if (deps.outputDirectory) {
    try {
      await savePipelineErrorLog(deps.outputDirectory, [{
        timestamp: new Date().toISOString(),
        phase: 'images',
        message: imgErrorMsg,
      }]);
    } catch { /* best-effort save */ }
  }
  throw new PipelineError(
    `Image generation failed: ${imgErrorMsg}`,
    'images',
    {
      context: {
        outputDirectory: deps.outputDirectory,
        failureKind: 'image_generation',
      },
      originalError: imgError instanceof Error ? imgError : undefined,
    }
  );
}
