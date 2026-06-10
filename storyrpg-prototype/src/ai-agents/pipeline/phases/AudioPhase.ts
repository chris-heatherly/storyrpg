/**
 * Audio Phase
 *
 * Pre-generates narration audio for story beats (ElevenLabs), binds the
 * resulting audio URLs onto beats (episode scenes + encounter beats), and
 * appends to the shared audio diagnostics log.
 *
 * Faithful port of the `config.narration.preGenerateAudio` block from
 * FullStoryPipeline.generate() (pure move): same gate condition, same events,
 * same diagnostics entries (including the skip paths), same non-blocking
 * failure handling, same 08-final-story.json rewrite through the proxy.
 */

import { Story } from '../../../types';
import { CharacterBible } from '../../agents/CharacterDesigner';
import { AudioGenerationService } from '../../services/audioGenerationService';
import {
  AudioGenerationDiagnostic,
  saveAudioDiagnosticsLog,
  updateOutputManifest,
} from '../../utils/pipelineOutputWriter';
import { PROXY_CONFIG } from '../../../config/endpoints';
import { PipelineContext } from './index';

// ========================================
// INPUT & CONTEXT TYPES
// ========================================

export interface AudioPhaseInput {
  story: Story;
  characterBible?: CharacterBible;
  outputDirectory?: string;
  /** Shared per-run diagnostics log — appended in place (saved earlier too). */
  audioDiagnostics: AudioGenerationDiagnostic[];
}

/**
 * Pipeline services/callbacks this phase needs beyond the shared context.
 * Passed explicitly rather than growing PipelineContext (see phases/README).
 */
export interface AudioPhaseDeps {
  audioService: Pick<
    AudioGenerationService,
    'autoCastVoices' | 'extractBeatsForAudio' | 'generateStoryAudio'
  >;
  /** The pipeline's audio worker queue (serializes audio batches). */
  audioWorkerQueue: { run<T>(task: () => Promise<T>): Promise<T> };
  requirePhases: (phase: string, dependencies: string[]) => void;
  markPhaseComplete: (phase: string) => void;
  measurePhase: <T>(phase: string, task: () => Promise<T>) => Promise<T>;
  checkCancellation: () => Promise<void>;
}

// ========================================
// PHASE IMPLEMENTATION
// ========================================

export class AudioPhase {
  readonly name = 'audio_generation';

  constructor(private readonly deps: AudioPhaseDeps) {}

  async run(input: AudioPhaseInput, context: PipelineContext): Promise<void> {
    const { story, characterBible, outputDirectory, audioDiagnostics } = input;
    const { audioService, audioWorkerQueue, requirePhases, markPhaseComplete, measurePhase } =
      this.deps;
    const narration = context.config.narration;

    // Pre-generate audio if enabled (check both enabled flag and preGenerateAudio)
    await this.deps.checkCancellation();
    if (narration?.enabled !== false && narration?.preGenerateAudio && narration?.elevenLabsApiKey) {
      requirePhases('audio_generation', ['content_generation']);
      context.emit({ type: 'phase_start', phase: 'audio_generation', message: 'Pre-generating narration audio...' });
      try {
        // Auto-cast voices for characters
        if (characterBible) {
          await audioService.autoCastVoices(characterBible);
          audioDiagnostics.push({
            timestamp: new Date().toISOString(),
            stage: 'voice_cast',
            status: 'completed',
            message: `Auto-cast voices for ${characterBible.characters.length} characters`,
          });
        }

        // Extract all beats and generate audio
        const beats = audioService.extractBeatsForAudio(story);
        if (beats.length > 0) {
          const audioResult = await audioWorkerQueue.run(() =>
            measurePhase('audio_generation', () => audioService.generateStoryAudio(
              story.id,
              beats,
              (completed, total) => {
                context.emit({
                  type: 'agent_start',
                  phase: 'audio_generation',
                  message: `Generating audio: ${completed}/${total} beats`,
                  data: { completed, total, currentItem: completed, totalItems: total, subphaseLabel: 'audio:beats' },
                });
              }
            ))
          );
          const mappedAudioCount = bindGeneratedAudioToStory(story, audioResult.results || []);
          audioDiagnostics.push({
            timestamp: new Date().toISOString(),
            stage: 'batch_generation',
            status: audioResult.success ? 'completed' : 'failed',
            message: `Audio batch finished: ${audioResult.generated} generated, ${audioResult.cached} cached, ${audioResult.failed} failed`,
            generated: audioResult.generated,
            cached: audioResult.cached,
            failed: audioResult.failed,
          });
          audioDiagnostics.push({
            timestamp: new Date().toISOString(),
            stage: 'binding',
            status: mappedAudioCount > 0 ? 'completed' : 'skipped',
            message: `Mapped audio onto ${mappedAudioCount} beats`,
            mapped: mappedAudioCount,
          });
          for (const result of audioResult.results || []) {
            if (result?.audioUrl) {
              audioDiagnostics.push({
                timestamp: new Date().toISOString(),
                stage: 'binding',
                status: 'completed',
                message: result.cached ? 'Bound cached audio to beat' : 'Bound generated audio to beat',
                beatId: result.beatId,
                audioUrl: result.audioUrl,
              });
            }
          }
          for (const error of audioResult.errors || []) {
            audioDiagnostics.push({
              timestamp: new Date().toISOString(),
              stage: 'batch_generation',
              status: 'failed',
              message: error.error,
              beatId: error.beatId,
            });
          }
          context.emit({
            type: 'debug',
            phase: 'audio_generation',
            message: `Audio complete: ${audioResult.generated} generated, ${audioResult.cached} cached, ${audioResult.failed} failed, ${mappedAudioCount} beats mapped`,
            data: {
              generated: audioResult.generated,
              cached: audioResult.cached,
              failed: audioResult.failed,
              mappedAudioCount,
            },
          });
          if (outputDirectory) {
            await saveDiagnosticsAndManifest(outputDirectory, audioDiagnostics);
            await fetch(PROXY_CONFIG.writeFile, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                filePath: `${outputDirectory}08-final-story.json`,
                content: JSON.stringify(story, null, 2),
                isBase64: false,
              }),
            });
          }
        } else {
          audioDiagnostics.push({
            timestamp: new Date().toISOString(),
            stage: 'gate',
            status: 'skipped',
            message: 'No beats found that required narration audio',
          });
          if (outputDirectory) {
            await saveDiagnosticsAndManifest(outputDirectory, audioDiagnostics);
          }
        }
        context.emit({ type: 'phase_complete', phase: 'audio_generation', message: `Audio narration generated for ${beats.length} beats` });
        markPhaseComplete('audio_generation');
      } catch (audioError) {
        const audioErrMsg = audioError instanceof Error ? audioError.message : String(audioError);
        audioDiagnostics.push({
          timestamp: new Date().toISOString(),
          stage: 'batch_generation',
          status: 'failed',
          message: audioErrMsg,
        });
        console.warn(`[Pipeline] Audio generation failed: ${audioErrMsg}`);
        context.emit({ type: 'warning', phase: 'audio_generation', message: `Audio generation failed (non-blocking): ${audioErrMsg}` });
        if (outputDirectory) {
          await saveDiagnosticsAndManifest(outputDirectory, audioDiagnostics);
        }
      }
    } else {
      audioDiagnostics.push({
        timestamp: new Date().toISOString(),
        stage: 'gate',
        status: 'skipped',
        message: `Audio generation skipped: enabled=${narration?.enabled !== false}, preGenerateAudio=${!!narration?.preGenerateAudio}, hasApiKey=${!!narration?.elevenLabsApiKey}`,
      });
      if (outputDirectory) {
        await saveDiagnosticsAndManifest(outputDirectory, audioDiagnostics);
      }
    }
  }
}

// ========================================
// HELPERS (moved with the phase)
// ========================================

/**
 * Identical save+manifest sequence the monolith repeated at four sites in the
 * audio block. Behavior unchanged: save the log, then record it (and the
 * count) in the output manifest when the save succeeded.
 */
async function saveDiagnosticsAndManifest(
  outputDirectory: string,
  audioDiagnostics: AudioGenerationDiagnostic[]
): Promise<void> {
  const savedAudioDiagnostics = await saveAudioDiagnosticsLog(outputDirectory, audioDiagnostics);
  if (savedAudioDiagnostics) {
    await updateOutputManifest(outputDirectory, {
      file: {
        name: 'Audio Diagnostics',
        path: savedAudioDiagnostics.path,
        type: 'audio_diagnostics',
        size: savedAudioDiagnostics.size,
      },
      summary: {
        audioDiagnosticsCount: audioDiagnostics.length,
      },
    });
  }
}

/**
 * Bind generated audio URLs onto story beats by beat id — episode scene beats
 * plus encounter beats in both phased and flat encounter shapes. Moved from
 * FullStoryPipeline.bindGeneratedAudioToStory (its only call site is here).
 */
export function bindGeneratedAudioToStory(
  story: Story,
  audioResults: Array<{ beatId: string; audioUrl?: string }>
): number {
  const audioByBeatId = new Map<string, string>();
  for (const result of audioResults) {
    if (result?.beatId && result?.audioUrl) {
      audioByBeatId.set(result.beatId, result.audioUrl);
    }
  }
  if (audioByBeatId.size === 0) return 0;

  let mapped = 0;
  for (const episode of story.episodes || []) {
    for (const scene of episode.scenes || []) {
      for (const beat of scene.beats || []) {
        const audioUrl = audioByBeatId.get(beat.id);
        if (audioUrl) {
          beat.audio = audioUrl;
          mapped++;
        }
      }

      const encounterAny = scene.encounter as any;
      if (encounterAny?.phases) {
        for (const phase of encounterAny.phases) {
          for (const beat of phase?.beats || []) {
            const audioUrl = audioByBeatId.get(beat.id);
            if (audioUrl) {
              beat.audio = audioUrl;
              mapped++;
            }
          }
        }
      }
      if (encounterAny?.beats) {
        for (const beat of encounterAny.beats) {
          const audioUrl = audioByBeatId.get(beat.id);
          if (audioUrl) {
            beat.audio = audioUrl;
            mapped++;
          }
        }
      }
    }
  }
  return mapped;
}
