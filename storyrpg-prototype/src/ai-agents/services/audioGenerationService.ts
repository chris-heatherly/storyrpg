/**
 * Audio Generation Service
 * 
 * Pre-generates narration audio during story pipeline execution.
 * Supports ElevenLabs and Gemini TTS via the local proxy.
 */

import { VoiceCast, VoiceAssignment, voiceCastingService, NarrationProvider, DEFAULT_GEMINI_TTS_MODEL } from './voiceCastingService';
import { buildAudioPerformanceScript } from './audioPerformance';
import { CharacterBible } from '../agents/CharacterDesigner';
import { PROXY_CONFIG } from '../../config/endpoints';

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
  speakerMood?: string;
  sceneId?: string;
}

export interface AudioGenerationResult {
  beatId: string;
  success: boolean;
  audioUrl?: string;
  hasAlignment?: boolean;
  error?: string;
  cached?: boolean;
  provider?: NarrationProvider;
  voiceId?: string;
}

export interface BatchAudioResult {
  success: boolean;
  generated: number;
  cached: number;
  failed: number;
  results: AudioGenerationResult[];
  errors: { beatId: string; error: string }[];
}

export interface AudioGenerationServiceOptions {
  provider?: NarrationProvider;
  apiKey?: string;
  geminiApiKey?: string;
  geminiModel?: string;
  voiceId?: string;
  performanceTagsEnabled?: boolean;
  voiceCastingEnabled?: boolean;
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
  private geminiApiKey: string | null = null;
  private provider: NarrationProvider = 'elevenlabs';
  private geminiModel: string = DEFAULT_GEMINI_TTS_MODEL;
  private defaultVoiceId?: string;
  private performanceTagsEnabled = false;
  private voiceCastingEnabled = true;
  private proxyUrl: string;
  private characterVoices: Map<string, string> = new Map();

  constructor(options?: string | AudioGenerationServiceOptions, proxyUrl?: string) {
    if (typeof options === 'string' || options === undefined) {
      this.apiKey = (typeof options === 'string' ? options : undefined) || process.env.ELEVENLABS_API_KEY || null;
    } else {
      this.provider = options.provider || 'elevenlabs';
      this.apiKey = options.apiKey || process.env.ELEVENLABS_API_KEY || null;
      this.geminiApiKey = options.geminiApiKey || process.env.GEMINI_API_KEY || null;
      this.geminiModel = options.geminiModel || DEFAULT_GEMINI_TTS_MODEL;
      this.defaultVoiceId = options.voiceId;
      this.performanceTagsEnabled = !!options.performanceTagsEnabled;
      this.voiceCastingEnabled = options.voiceCastingEnabled !== false;
    }
    this.proxyUrl = proxyUrl || PROXY_CONFIG.getProxyUrl();
  }

  /**
   * Set the API key
   */
  setApiKey(apiKey: string): void {
    this.apiKey = apiKey;
  }

  configure(options: AudioGenerationServiceOptions): void {
    this.provider = options.provider || this.provider;
    this.apiKey = options.apiKey ?? this.apiKey;
    this.geminiApiKey = options.geminiApiKey ?? this.geminiApiKey;
    this.geminiModel = options.geminiModel || this.geminiModel;
    this.defaultVoiceId = options.voiceId || this.defaultVoiceId;
    this.performanceTagsEnabled = options.performanceTagsEnabled ?? this.performanceTagsEnabled;
    this.voiceCastingEnabled = options.voiceCastingEnabled ?? this.voiceCastingEnabled;
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
    voiceCastingService.setProvider(this.provider);
    voiceCastingService.setApiKey(this.provider === 'gemini' ? (this.geminiApiKey || '') : (this.apiKey || ''));
    const cast = await voiceCastingService.castVoices(characterBible, this.provider);
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
    if (this.defaultVoiceId && (!speaker || speaker.toLowerCase().includes('narrator'))) {
      return this.defaultVoiceId;
    }
    if (!speaker) {
      return this.provider === 'gemini' ? 'Kore' : DEFAULT_VOICES.narrator;
    }

    const lowerSpeaker = speaker.toLowerCase();

    // Check custom mappings
    if (this.characterVoices.has(lowerSpeaker)) {
      return this.characterVoices.get(lowerSpeaker)!;
    }

    // Check if speaker contains narrator keywords
    if (lowerSpeaker.includes('narrator') || lowerSpeaker === '') {
      return this.provider === 'gemini' ? 'Kore' : DEFAULT_VOICES.narrator;
    }

    // Default to narrator voice for unknown speakers
    return this.provider === 'gemini' ? 'Kore' : DEFAULT_VOICES.narrator;
  }

  private getActiveApiKey(): string | null {
    return this.provider === 'gemini' ? this.geminiApiKey : this.apiKey;
  }

  private getAuthHeaders(): Record<string, string> {
    const apiKey = this.getActiveApiKey();
    if (!apiKey) return {};
    return this.provider === 'gemini'
      ? { 'x-gemini-api-key': apiKey }
      : { 'x-elevenlabs-api-key': apiKey };
  }

  /**
   * Generate audio for a single beat
   */
  async generateBeatAudio(
    storyId: string,
    beat: BeatAudioRequest
  ): Promise<AudioGenerationResult> {
    if (!this.getActiveApiKey()) {
      return {
        beatId: beat.beatId,
        success: false,
        error: `No ${this.provider === 'gemini' ? 'Gemini' : 'ElevenLabs'} API key configured`,
      };
    }

    try {
      const voiceId = this.getVoiceForSpeaker(beat.speaker);
      const audioScript = buildAudioPerformanceScript(beat, this.performanceTagsEnabled);

      const response = await fetch(`${this.proxyUrl}/audio/tts`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...this.getAuthHeaders(),
        },
        body: JSON.stringify({
          provider: this.provider,
          text: beat.text,
          audioScript,
          voiceId,
          storyId,
          beatId: beat.beatId,
          speaker: beat.speaker,
          speakerMood: beat.speakerMood,
          geminiModel: this.geminiModel,
          performanceTagsEnabled: this.performanceTagsEnabled,
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
        provider: data.provider || this.provider,
        voiceId: data.voiceId || voiceId,
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
    if (!this.getActiveApiKey()) {
      onProgress?.(0, beats.length);
      return {
        success: false,
        generated: 0,
        cached: 0,
        failed: beats.length,
        results: [],
        errors: beats.map(b => ({ beatId: b.beatId, error: `No ${this.provider === 'gemini' ? 'Gemini' : 'ElevenLabs'} API key` })),
      };
    }

    // Build character voice mapping for batch endpoint
    const characterVoices: Record<string, string> = {};
    this.characterVoices.forEach((voiceId, name) => {
      characterVoices[name] = voiceId;
    });

    try {
      // Use batch endpoint for efficiency
      const response = await fetch(`${this.proxyUrl}/audio/batch-generate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...this.getAuthHeaders(),
        },
        body: JSON.stringify({
          provider: this.provider,
          storyId,
          beats: beats.map(b => ({
            beatId: b.beatId,
            text: b.text,
            audioScript: buildAudioPerformanceScript(b, this.performanceTagsEnabled),
            speaker: b.speaker,
            speakerMood: b.speakerMood,
          })),
          characterVoices,
          geminiModel: this.geminiModel,
          performanceTagsEnabled: this.performanceTagsEnabled,
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
              speakerMood: beat.speakerMood,
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
                  speakerMood: (encBeat as any).speakerMood,
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
