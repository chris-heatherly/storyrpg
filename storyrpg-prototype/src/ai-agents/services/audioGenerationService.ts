/**
 * Audio Generation Service
 * 
 * Pre-generates narration audio during story pipeline execution.
 * Uses ElevenLabs API with timestamps for karaoke-style playback.
 */

import { VoiceCast, VoiceAssignment, voiceCastingService } from './voiceCastingService';
import { CharacterBible } from '../agents/CharacterDesigner';

export interface CharacterVoiceConfig {
  characterId: string;
  characterName: string;
  voiceId: string;
  voiceType: 'narrator' | 'male' | 'female' | 'child';
}

export interface BeatAudioRequest {
  beatId: string;
  text: string;
  speaker?: string;
  sceneId?: string;
}

export interface AudioGenerationResult {
  beatId: string;
  success: boolean;
  audioUrl?: string;
  hasAlignment?: boolean;
  error?: string;
  cached?: boolean;
}

export interface BatchAudioResult {
  success: boolean;
  generated: number;
  cached: number;
  failed: number;
  results: AudioGenerationResult[];
  errors: { beatId: string; error: string }[];
}

// Default voice mappings
const DEFAULT_VOICES = {
  narrator: 'onwK4e9ZLuTAKqWW03F9', // Daniel
  male: 'TxGEqnHWrfWFTfGW9XjX', // Josh
  female: 'EXAVITQu4vr4xnSDxMaL', // Bella
  child: 'jBpfuIE2acCO8z3wKNLl', // Gigi
};

export class AudioGenerationService {
  private apiKey: string | null = null;
  private proxyUrl: string;
  private characterVoices: Map<string, string> = new Map();

  constructor(apiKey?: string, proxyUrl?: string) {
    this.apiKey = apiKey || process.env.ELEVENLABS_API_KEY || null;
    // Import dynamically to avoid circular dependencies
    this.proxyUrl = proxyUrl || 'http://localhost:3001';
    // Try to get from config if available
    try {
      const { PROXY_CONFIG } = require('../../config/endpoints');
      this.proxyUrl = proxyUrl || PROXY_CONFIG.getProxyUrl();
    } catch (e) {
      // Config not available, use default
    }
  }

  /**
   * Set the API key
   */
  setApiKey(apiKey: string): void {
    this.apiKey = apiKey;
  }

  /**
   * Configure character voices for the story
   */
  setCharacterVoices(configs: CharacterVoiceConfig[]): void {
    this.characterVoices.clear();
    for (const config of configs) {
      // Store by both ID and name for flexible lookup
      if (config.characterId) {
        this.characterVoices.set(config.characterId.toLowerCase(), config.voiceId);
      }
      if (config.characterName) {
        this.characterVoices.set(config.characterName.toLowerCase(), config.voiceId);
      }
    }
  }

  /**
   * Apply a voice cast from the VoiceCastingService
   */
  applyVoiceCast(cast: VoiceCast): void {
    this.characterVoices.clear();
    
    // Add narrator
    this.characterVoices.set('narrator', cast.narrator.voiceId);
    this.characterVoices.set('', cast.narrator.voiceId);
    
    // Add all character voices
    for (const assignment of cast.characters) {
      this.characterVoices.set(assignment.characterId.toLowerCase(), assignment.voiceId);
      this.characterVoices.set(assignment.characterName.toLowerCase(), assignment.voiceId);
    }
    
    console.log(`[AudioGen] Applied voice cast with ${cast.characters.length + 1} voices`);
  }

  /**
   * Auto-cast voices for characters and apply them
   */
  async autoCastVoices(characterBible: CharacterBible): Promise<VoiceCast> {
    voiceCastingService.setApiKey(this.apiKey || '');
    const cast = await voiceCastingService.castVoices(characterBible);
    this.applyVoiceCast(cast);
    return cast;
  }

  /**
   * Get current voice cast as a serializable object
   */
  getVoiceCastMap(): Record<string, string> {
    const map: Record<string, string> = {};
    this.characterVoices.forEach((voiceId, key) => {
      map[key] = voiceId;
    });
    return map;
  }

  /**
   * Get voice ID for a character/speaker
   */
  getVoiceForSpeaker(speaker?: string): string {
    if (!speaker) {
      return DEFAULT_VOICES.narrator;
    }

    const lowerSpeaker = speaker.toLowerCase();

    // Check custom mappings
    if (this.characterVoices.has(lowerSpeaker)) {
      return this.characterVoices.get(lowerSpeaker)!;
    }

    // Check if speaker contains narrator keywords
    if (lowerSpeaker.includes('narrator') || lowerSpeaker === '') {
      return DEFAULT_VOICES.narrator;
    }

    // Default to narrator voice for unknown speakers
    return DEFAULT_VOICES.narrator;
  }

  /**
   * Generate audio for a single beat
   */
  async generateBeatAudio(
    storyId: string,
    beat: BeatAudioRequest
  ): Promise<AudioGenerationResult> {
    if (!this.apiKey) {
      return {
        beatId: beat.beatId,
        success: false,
        error: 'No ElevenLabs API key configured',
      };
    }

    try {
      const voiceId = this.getVoiceForSpeaker(beat.speaker);

      const response = await fetch(`${this.proxyUrl}/elevenlabs/tts`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-elevenlabs-api-key': this.apiKey,
        },
        body: JSON.stringify({
          text: beat.text,
          voiceId,
          storyId,
          beatId: beat.beatId,
          speaker: beat.speaker,
          withTimestamps: true,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to generate audio');
      }

      return {
        beatId: beat.beatId,
        success: true,
        audioUrl: data.audioUrl,
        hasAlignment: !!data.alignment,
        cached: data.cached,
      };
    } catch (error) {
      return {
        beatId: beat.beatId,
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Batch generate audio for all beats in a story
   */
  async generateStoryAudio(
    storyId: string,
    beats: BeatAudioRequest[],
    onProgress?: (completed: number, total: number) => void
  ): Promise<BatchAudioResult> {
    if (!this.apiKey) {
      onProgress?.(0, beats.length);
      return {
        success: false,
        generated: 0,
        cached: 0,
        failed: beats.length,
        results: [],
        errors: beats.map(b => ({ beatId: b.beatId, error: 'No API key' })),
      };
    }

    // Build character voice mapping for batch endpoint
    const characterVoices: Record<string, string> = {};
    this.characterVoices.forEach((voiceId, name) => {
      characterVoices[name] = voiceId;
    });

    try {
      // Use batch endpoint for efficiency
      const response = await fetch(`${this.proxyUrl}/elevenlabs/batch-generate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-elevenlabs-api-key': this.apiKey,
        },
        body: JSON.stringify({
          storyId,
          beats: beats.map(b => ({
            beatId: b.beatId,
            text: b.text,
            speaker: b.speaker,
          })),
          characterVoices,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Batch generation failed');
      }

      const completed = Array.isArray(data.results) ? data.results.length : beats.length;
      onProgress?.(completed, beats.length);

      return {
        success: true,
        generated: data.generated,
        cached: data.cached,
        failed: data.failed,
        results: data.results,
        errors: data.errors,
      };
    } catch (error) {
      onProgress?.(0, beats.length);
      return {
        success: false,
        generated: 0,
        cached: 0,
        failed: beats.length,
        results: [],
        errors: [{ beatId: 'batch', error: error instanceof Error ? error.message : 'Unknown error' }],
      };
    }
  }

  /**
   * Extract all beats from a story that need audio
   */
  extractBeatsForAudio(story: any): BeatAudioRequest[] {
    const beats: BeatAudioRequest[] = [];

    if (!story.episodes) return beats;

    for (const episode of story.episodes) {
      if (!episode.scenes) continue;

      for (const scene of episode.scenes) {
        if (!scene.beats) continue;

        for (const beat of scene.beats) {
          if (beat.text && beat.text.trim()) {
            beats.push({
              beatId: beat.id,
              text: beat.text,
              speaker: beat.speaker,
              sceneId: scene.id,
            });
          }
        }

        // Also process encounter beats if present
        if (scene.encounter?.phases) {
          for (const phase of scene.encounter.phases) {
            if (!phase.beats) continue;

            for (const encBeat of phase.beats) {
              const text = (encBeat as any).text || (encBeat as any).setupText;
              if (text && text.trim()) {
                beats.push({
                  beatId: encBeat.id,
                  text,
                  speaker: (encBeat as any).speaker,
                  sceneId: scene.id,
                });
              }
            }
          }
        }
      }
    }

    return beats;
  }
}

// Export singleton
export const audioGenerationService = new AudioGenerationService();
export default audioGenerationService;
