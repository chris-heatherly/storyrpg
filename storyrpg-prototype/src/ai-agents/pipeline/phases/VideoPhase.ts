/**
 * Video Phase
 *
 * Selects beats to animate (per the configured strategy), generates an
 * animation direction per beat via the VideoDirector agent, renders clips
 * through the video service, and collects per-beat diagnostics.
 *
 * Faithful port of FullStoryPipeline.runVideoGeneration (pure move): same
 * selection rules, same per-beat error handling (failures are diagnostics,
 * never throws), same progress events. bindGeneratedVideoToStory moves along
 * with it (only caller is the video-only re-run path).
 */

import { Story } from '../../../types';
import { SceneContent } from '../../agents/SceneWriter';
import {
  VideoDirectorAgent,
  VideoDirectionRequest,
} from '../../agents/image-team/VideoDirectorAgent';
import { VideoGenerationService } from '../../services/videoGenerationService';
import { VideoGenerationDiagnostic } from '../../utils/pipelineOutputWriter';
import { PipelineContext } from './index';

// ========================================
// INPUT & CONTEXT TYPES
// ========================================

export interface VideoPhaseInput {
  sceneContents: SceneContent[];
  imageResults: { beatImages: Map<string, string>; sceneImages: Map<string, string> };
  story: { genre?: string; tone?: string };
}

export interface VideoPhaseDeps {
  videoService: Pick<
    VideoGenerationService,
    'clearDiagnostics' | 'getDiagnostics' | 'readFileAsBase64' | 'generateVideo'
  >;
  videoDirectorAgent: Pick<VideoDirectorAgent, 'generateVideoDirection'>;
  checkCancellation: () => Promise<void>;
  /** Episode-scoped key builders (close over the active brief at the call site). */
  scopedSceneId: (sceneId: string) => string;
  scopedBeatKey: (sceneId: string, beatId: string) => string;
}

export interface VideoPhaseResult {
  videoResults: Map<string, string>;
  diagnostics: VideoGenerationDiagnostic[];
}

// ========================================
// PHASE IMPLEMENTATION
// ========================================

export class VideoPhase {
  readonly name = 'video_generation';

  constructor(private readonly deps: VideoPhaseDeps) {}

  async run(input: VideoPhaseInput, context: PipelineContext): Promise<VideoPhaseResult> {
    const { sceneContents, imageResults } = input;
    const { videoService, videoDirectorAgent, scopedSceneId, scopedBeatKey } = this.deps;
    const videoResults = new Map<string, string>();
    const diagnostics: VideoGenerationDiagnostic[] = [];
    const videoStrategy = context.config.videoGen?.strategy || 'selective';
    videoService.clearDiagnostics();

    const beatsToAnimate: Array<{
      sceneId: string;
      beatId: string;
      beatText: string;
      imageKey: string;
      imagePath: string;
      sceneContext: { name: string; genre: string; tone: string; mood: string };
      visualMoment?: string;
      primaryAction?: string;
      emotionalRead?: string;
    }> = [];

    for (const scene of sceneContents) {
      const sceneContext = {
        name: scene.sceneName || scene.sceneId,
        genre: input.story.genre || 'drama',
        tone: input.story.tone || 'serious',
        mood: (scene.moodProgression as string[])?.[0] || 'neutral',
      };

      for (const beat of scene.beats || []) {
        const imageKey = scopedBeatKey(scene.sceneId, beat.id);
        const imagePath = imageResults.beatImages.get(imageKey);

        if (!imagePath) continue;

        if (videoStrategy === 'selective') {
          const isSelectiveBeat = beat.isChoicePoint || beat.visualMoment
            || beat.shotType === 'action'
            || scene.beats.indexOf(beat) === 0;
          if (!isSelectiveBeat) continue;
        }

        beatsToAnimate.push({
          sceneId: scene.sceneId,
          beatId: beat.id,
          beatText: beat.text,
          imageKey,
          imagePath,
          sceneContext,
          visualMoment: beat.visualMoment,
          primaryAction: beat.primaryAction,
          emotionalRead: beat.emotionalRead,
        });
      }
    }

    if (beatsToAnimate.length === 0) {
      context.emit({ type: 'debug', phase: 'video_generation', message: 'No beats selected for video animation' });
      diagnostics.push({
        timestamp: new Date().toISOString(),
        stage: 'selection',
        status: 'skipped',
        message: 'No beats selected for video animation',
      });
      return { videoResults, diagnostics };
    }

    context.emit({
      type: 'agent_start',
      agent: 'VideoDirector',
      message: `Generating animation directions for ${beatsToAnimate.length} beats...`,
    });

    let completed = 0;
    const total = beatsToAnimate.length;

    for (const beatInfo of beatsToAnimate) {
      await this.deps.checkCancellation();

      try {
        const directionRequest: VideoDirectionRequest = {
          beatId: beatInfo.beatId,
          sceneId: beatInfo.sceneId,
          beatText: beatInfo.beatText,
          imagePrompt: beatInfo.visualMoment || beatInfo.primaryAction || beatInfo.beatText,
          sceneContext: beatInfo.sceneContext,
        };

        const directionResult = await videoDirectorAgent.generateVideoDirection(directionRequest);

        if (!directionResult.success || !directionResult.data) {
          console.warn(`[Pipeline] VideoDirector failed for beat ${beatInfo.beatId}: ${directionResult.error}`);
          diagnostics.push({
            timestamp: new Date().toISOString(),
            sceneId: beatInfo.sceneId,
            beatId: beatInfo.beatId,
            imageKey: beatInfo.imageKey,
            identifier: `video-${scopedSceneId(beatInfo.sceneId)}-${beatInfo.beatId}`,
            sourceImageUrl: beatInfo.imagePath,
            stage: 'direction',
            status: 'failed',
            message: directionResult.error || 'VideoDirector returned no direction data',
          });
          completed++;
          continue;
        }

        const instruction = directionResult.data;

        const imageData = await videoService.readFileAsBase64(beatInfo.imagePath);
        if (!imageData) {
          console.warn(`[Pipeline] Could not read image file for video animation: ${beatInfo.imagePath}`);
          diagnostics.push({
            timestamp: new Date().toISOString(),
            sceneId: beatInfo.sceneId,
            beatId: beatInfo.beatId,
            imageKey: beatInfo.imageKey,
            identifier: `video-${scopedSceneId(beatInfo.sceneId)}-${beatInfo.beatId}`,
            sourceImageUrl: beatInfo.imagePath,
            stage: 'image_load',
            status: 'failed',
            message: `Could not read source image for video animation: ${beatInfo.imagePath}`,
          });
          completed++;
          continue;
        }

        const videoIdentifier = `video-${scopedSceneId(beatInfo.sceneId)}-${beatInfo.beatId}`;
        const videoResult = await videoService.generateVideo(
          instruction,
          imageData.data,
          imageData.mimeType,
          videoIdentifier,
          { sceneId: beatInfo.sceneId, beatId: beatInfo.beatId },
          beatInfo.imagePath,
        );

        if (videoResult.videoUrl || videoResult.videoPath) {
          videoResults.set(beatInfo.imageKey, videoResult.videoUrl || videoResult.videoPath!);
        }

        completed++;
        context.emit({
          type: 'agent_start',
          phase: 'video_generation',
          message: `Video generation: ${completed}/${total} clips`,
          data: { completed, total, currentItem: completed, totalItems: total, subphaseLabel: 'video:clips' },
        });
      } catch (beatVideoError) {
        const msg = beatVideoError instanceof Error ? beatVideoError.message : String(beatVideoError);
        console.warn(`[Pipeline] Video generation failed for beat ${beatInfo.beatId}: ${msg}`);
        diagnostics.push({
          timestamp: new Date().toISOString(),
          sceneId: beatInfo.sceneId,
          beatId: beatInfo.beatId,
          imageKey: beatInfo.imageKey,
          identifier: `video-${scopedSceneId(beatInfo.sceneId)}-${beatInfo.beatId}`,
          sourceImageUrl: beatInfo.imagePath,
          stage: 'veo_generation',
          status: 'failed',
          message: msg,
        });
        completed++;
      }
    }

    diagnostics.push(...videoService.getDiagnostics().map((diagnostic) => ({
      ...diagnostic,
      imageKey: diagnostic.sceneId && diagnostic.beatId
        ? `${diagnostic.sceneId}::${diagnostic.beatId}`
        : diagnostic.imageKey,
    })));

    console.log(`[Pipeline] Video generation complete: ${videoResults.size}/${total} clips generated`);
    return { videoResults, diagnostics };
  }
}

// ========================================
// HELPERS (moved with the phase)
// ========================================

/**
 * Bind generated video URLs to beats in the assembled story.
 * Uses the same composite key pattern as images (sceneId::beatId).
 * Moved from FullStoryPipeline.bindGeneratedVideoToStory.
 */
export function bindGeneratedVideoToStory(
  story: Story,
  videoResults: Map<string, string>,
  options: { targetEpisodeNumber?: number } = {}
): number {
  if (!videoResults || videoResults.size === 0) return 0;

  let mapped = 0;
  for (const episode of story.episodes || []) {
    if (options.targetEpisodeNumber != null && episode.number !== options.targetEpisodeNumber) continue;
    for (const scene of episode.scenes || []) {
      for (const beat of scene.beats || []) {
        const scopedKey = `episode-${episode.number}-${scene.id}::${beat.id}`;
        const videoUrl = videoResults.get(scopedKey) || videoResults.get(`${scene.id}::${beat.id}`);
        if (videoUrl) {
          beat.video = videoUrl;
          mapped++;
        }
      }
    }
  }
  return mapped;
}
