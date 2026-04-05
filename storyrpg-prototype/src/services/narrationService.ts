/**
 * Narration Service
 * 
 * Handles text-to-speech using ElevenLabs API for story narration.
 * Features:
 * - Audio generation and caching
 * - Voice assignment per character
 * - Playback controls
 * - Queue management for sequential narration
 */

import { useAudioPlayer, AudioPlayer, setAudioModeAsync, AudioMode } from 'expo-audio';
import { Platform } from 'react-native';

// Voice types for different character roles
export type VoiceType = 'narrator' | 'male' | 'female' | 'child';

export interface VoiceConfig {
  id: string;
  name: string;
  type: VoiceType;
}

export interface NarrationRequest {
  text: string;
  voiceId?: string;
  voiceType?: VoiceType;
  storyId?: string;
  beatId?: string;
  speaker?: string;
}

// Alignment data from ElevenLabs timestamps
export interface AlignmentData {
  characters?: string[];
  character_start_times_seconds?: number[];
  character_end_times_seconds?: number[];
  words?: string[];
  word_start_times_seconds?: number[];
  word_end_times_seconds?: number[];
}

export interface AlignmentFile {
  text: string;
  speaker?: string;
  voiceId: string;
  alignment: AlignmentData;
  generatedAt: string;
}

export interface NarrationResult {
  success: boolean;
  audioUrl?: string;
  audioData?: string;
  alignment?: AlignmentData;
  error?: string;
  cached?: boolean;
  characterCount?: number;
}

// Default voice mappings
const DEFAULT_VOICE_MAPPINGS: Record<VoiceType, string> = {
  narrator: 'onwK4e9ZLuTAKqWW03F9', // Daniel
  male: 'TxGEqnHWrfWFTfGW9XjX', // Josh
  female: 'EXAVITQu4vr4xnSDxMaL', // Bella
  child: 'jBpfuIE2acCO8z3wKNLl', // Gigi
};

class NarrationService {
  private apiKey: string | null = null;
  private proxyUrl: string = 'http://localhost:3001';
  private currentPlayer: AudioPlayer | null = null;
  private isPlaying: boolean = false;
  private characterVoices: Map<string, string> = new Map();
  private audioQueue: NarrationRequest[] = [];
  private isProcessingQueue: boolean = false;
  private statusInterval: NodeJS.Timeout | null = null;
  private currentDuration: number = 0;
  
  // Callbacks
  private onPlaybackStatusChange?: (isPlaying: boolean, position: number, duration: number) => void;
  private onNarrationStart?: (text: string) => void;
  private onNarrationEnd?: () => void;
  private onError?: (error: string) => void;

  /**
   * Initialize the narration service with API key
   */
  async initialize(apiKey?: string): Promise<void> {
    this.apiKey = apiKey || null;
    
    // Configure audio mode for background playback
    if (Platform.OS !== 'web') {
      try {
        await setAudioModeAsync({
          playsInSilentMode: true,
          shouldPlayInBackground: true,
          shouldRouteThroughEarpiece: false,
        } as AudioMode);
      } catch (error) {
        console.warn('[NarrationService] Could not set audio mode:', error);
      }
    }
  }

  /**
   * Set the API key
   */
  setApiKey(apiKey: string): void {
    this.apiKey = apiKey;
  }

  /**
   * Set callback for playback status changes
   */
  setOnPlaybackStatusChange(callback: (isPlaying: boolean, position: number, duration: number) => void): void {
    this.onPlaybackStatusChange = callback;
  }

  /**
   * Set callback for narration start
   */
  setOnNarrationStart(callback: (text: string) => void): void {
    this.onNarrationStart = callback;
  }

  /**
   * Set callback for narration end
   */
  setOnNarrationEnd(callback: () => void): void {
    this.onNarrationEnd = callback;
  }

  /**
   * Set callback for errors
   */
  setOnError(callback: (error: string) => void): void {
    this.onError = callback;
  }

  /**
   * Assign a voice to a specific character
   */
  assignVoiceToCharacter(characterName: string, voiceId: string): void {
    this.characterVoices.set(characterName.toLowerCase(), voiceId);
  }

  /**
   * Get voice ID for a character
   */
  getVoiceForCharacter(characterName?: string): string {
    if (!characterName) {
      return DEFAULT_VOICE_MAPPINGS.narrator;
    }
    
    const lowerName = characterName.toLowerCase();
    
    // Check custom assignments
    if (this.characterVoices.has(lowerName)) {
      return this.characterVoices.get(lowerName)!;
    }
    
    // Default logic based on common patterns
    if (lowerName.includes('narrator') || lowerName === '') {
      return DEFAULT_VOICE_MAPPINGS.narrator;
    }
    
    // Could add more sophisticated gender/age detection here
    return DEFAULT_VOICE_MAPPINGS.narrator;
  }

  /**
   * Generate narration audio with alignment timestamps
   */
  async generateNarration(request: NarrationRequest): Promise<NarrationResult> {
    try {
      const voiceId = request.voiceId || this.getVoiceForCharacter(request.speaker);
      
      const response = await fetch(`${this.proxyUrl}/elevenlabs/tts`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(this.apiKey && { 'x-elevenlabs-api-key': this.apiKey }),
        },
        body: JSON.stringify({
          text: request.text,
          voiceId,
          voiceType: request.voiceType,
          storyId: request.storyId,
          beatId: request.beatId,
          speaker: request.speaker,
          withTimestamps: true, // Always request alignment data
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to generate narration');
      }

      return {
        success: true,
        audioUrl: data.audioUrl,
        audioData: data.audioData,
        alignment: data.alignment,
        cached: data.cached,
        characterCount: data.characterCount,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error('[NarrationService] Error generating narration:', errorMessage);
      this.onError?.(errorMessage);
      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Load pre-generated alignment data for a beat
   */
  async loadAlignmentData(storyId: string, beatId: string): Promise<AlignmentData | null> {
    try {
      const primary = await fetch(`${this.proxyUrl}/audio-alignment?storyId=${encodeURIComponent(storyId)}&beatId=${encodeURIComponent(beatId)}`);
      if (primary.ok) {
        const data: AlignmentFile = await primary.json();
        return data.alignment;
      }

      // Backward-compatible fallback for legacy direct file path assumptions.
      const legacy = await fetch(`${this.proxyUrl}/generated-stories/${storyId}/audio/${beatId}.alignment.json`);
      if (!legacy.ok) return null;
      const legacyData: AlignmentFile = await legacy.json();
      return legacyData.alignment;
    } catch (error) {
      console.warn('[NarrationService] Could not load alignment data:', error);
      return null;
    }
  }

  /**
   * Get the current word/character being spoken based on playback position
   */
  getCurrentWordIndex(alignment: AlignmentData, positionSeconds: number): number {
    if (alignment.word_start_times_seconds) {
      // Word-level alignment
      for (let i = alignment.word_start_times_seconds.length - 1; i >= 0; i--) {
        if (positionSeconds >= alignment.word_start_times_seconds[i]) {
          return i;
        }
      }
    }
    return -1;
  }

  /**
   * Get the current character index being spoken
   */
  getCurrentCharIndex(alignment: AlignmentData, positionSeconds: number): number {
    if (alignment.character_start_times_seconds) {
      for (let i = alignment.character_start_times_seconds.length - 1; i >= 0; i--) {
        if (positionSeconds >= alignment.character_start_times_seconds[i]) {
          return i;
        }
      }
    }
    return -1;
  }

  /**
   * Play narration audio
   */
  async playNarration(request: NarrationRequest): Promise<NarrationResult> {
    try {
      // Stop any current playback
      await this.stop();

      this.onNarrationStart?.(request.text);

      // Generate audio
      const result = await this.generateNarration(request);
      
      if (!result.success) {
        throw new Error(result.error || 'Failed to generate audio');
      }

      // Determine audio source
      let audioUri: string;
      
      if (result.audioUrl) {
        audioUri = result.audioUrl;
      } else if (result.audioData) {
        // For base64 audio, create a data URI
        audioUri = `data:audio/mpeg;base64,${result.audioData}`;
      } else {
        throw new Error('No audio data received');
      }

      // Create audio element for web, or use expo-audio player for native
      if (Platform.OS === 'web') {
        // Use HTML5 Audio for web
        const audio = new Audio(audioUri);
        
        // Store reference for controls
        (this as any)._webAudio = audio;
        
        audio.onplay = () => {
          this.isPlaying = true;
        };
        
        audio.onpause = () => {
          this.isPlaying = false;
        };
        
        audio.onended = () => {
          this.isPlaying = false;
          this.onNarrationEnd?.();
          this.processNextInQueue();
        };
        
        audio.onerror = (e) => {
          console.error('[NarrationService] Audio error:', e);
          this.onError?.('Audio playback error');
          this.onNarrationEnd?.();
        };
        
        audio.ontimeupdate = () => {
          const position = audio.currentTime * 1000;
          const duration = (audio.duration || 0) * 1000;
          this.onPlaybackStatusChange?.(this.isPlaying, position, duration);
        };
        
        audio.onloadedmetadata = () => {
          this.currentDuration = (audio.duration || 0) * 1000;
        };
        
        await audio.play();
        this.isPlaying = true;
      } else {
        // Use expo-audio for native platforms
        // Note: This requires the component to use useAudioPlayer hook
        // For now, fall back to web audio on native as well
        console.warn('[NarrationService] Native audio not fully implemented, using web fallback');
      }

      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error('[NarrationService] Error playing narration:', errorMessage);
      this.onError?.(errorMessage);
      this.onNarrationEnd?.();
      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Start status polling for position updates
   */
  private startStatusPolling(): void {
    this.stopStatusPolling();
    
    this.statusInterval = setInterval(() => {
      if (this.currentPlayer && this.isPlaying) {
        const position = (this.currentPlayer.currentTime || 0) * 1000;
        const duration = (this.currentPlayer.duration || 0) * 1000;
        this.onPlaybackStatusChange?.(this.isPlaying, position, duration);
      }
    }, 100); // Update every 100ms for smooth highlighting
  }

  /**
   * Stop status polling
   */
  private stopStatusPolling(): void {
    if (this.statusInterval) {
      clearInterval(this.statusInterval);
      this.statusInterval = null;
    }
  }

  /**
   * Pause playback
   */
  async pause(): Promise<void> {
    if (Platform.OS === 'web') {
      const audio = (this as any)._webAudio as HTMLAudioElement | undefined;
      if (audio) {
        audio.pause();
        this.isPlaying = false;
      }
    } else if (this.currentPlayer) {
      this.currentPlayer.pause();
      this.isPlaying = false;
    }
  }

  /**
   * Resume playback
   */
  async resume(): Promise<void> {
    if (Platform.OS === 'web') {
      const audio = (this as any)._webAudio as HTMLAudioElement | undefined;
      if (audio) {
        await audio.play();
        this.isPlaying = true;
      }
    } else if (this.currentPlayer) {
      this.currentPlayer.play();
      this.isPlaying = true;
    }
  }

  /**
   * Toggle play/pause
   */
  async togglePlayPause(): Promise<void> {
    if (this.isPlaying) {
      await this.pause();
    } else {
      await this.resume();
    }
  }

  /**
   * Stop playback
   */
  async stop(): Promise<void> {
    this.stopStatusPolling();
    
    if (Platform.OS === 'web') {
      const audio = (this as any)._webAudio as HTMLAudioElement | undefined;
      if (audio) {
        audio.pause();
        audio.currentTime = 0;
        (this as any)._webAudio = null;
      }
    } else if (this.currentPlayer) {
      this.currentPlayer.pause();
      this.currentPlayer.seekTo(0);
      this.currentPlayer = null;
    }
    
    this.isPlaying = false;
  }

  /**
   * Seek to position (in milliseconds)
   */
  async seekTo(positionMillis: number): Promise<void> {
    const positionSeconds = positionMillis / 1000;
    
    if (Platform.OS === 'web') {
      const audio = (this as any)._webAudio as HTMLAudioElement | undefined;
      if (audio) {
        audio.currentTime = positionSeconds;
      }
    } else if (this.currentPlayer) {
      this.currentPlayer.seekTo(positionSeconds);
    }
  }

  /**
   * Add narration request to queue
   */
  addToQueue(request: NarrationRequest): void {
    this.audioQueue.push(request);
    
    if (!this.isProcessingQueue) {
      this.processNextInQueue();
    }
  }

  /**
   * Process next item in queue
   */
  private async processNextInQueue(): Promise<void> {
    if (this.audioQueue.length === 0) {
      this.isProcessingQueue = false;
      return;
    }

    this.isProcessingQueue = true;
    const nextRequest = this.audioQueue.shift()!;
    await this.playNarration(nextRequest);
  }

  /**
   * Clear the queue
   */
  clearQueue(): void {
    this.audioQueue = [];
    this.isProcessingQueue = false;
  }

  /**
   * Get available voices from ElevenLabs
   */
  async getAvailableVoices(): Promise<VoiceConfig[]> {
    try {
      const response = await fetch(`${this.proxyUrl}/elevenlabs/voices`, {
        headers: {
          ...(this.apiKey && { 'x-elevenlabs-api-key': this.apiKey }),
        },
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to fetch voices');
      }

      return data.voices.map((v: any) => ({
        id: v.id,
        name: v.name,
        type: this.inferVoiceType(v),
      }));
    } catch (error) {
      console.error('[NarrationService] Error fetching voices:', error);
      return [];
    }
  }

  /**
   * Infer voice type from voice metadata
   */
  private inferVoiceType(voice: any): VoiceType {
    const labels = voice.labels || {};
    const description = (voice.description || '').toLowerCase();
    const name = (voice.name || '').toLowerCase();

    if (labels.age === 'young' || description.includes('child') || name.includes('child')) {
      return 'child';
    }
    if (labels.gender === 'female' || description.includes('female')) {
      return 'female';
    }
    if (labels.gender === 'male' || description.includes('male')) {
      return 'male';
    }
    return 'narrator';
  }

  /**
   * Check if currently playing
   */
  getIsPlaying(): boolean {
    return this.isPlaying;
  }

  /**
   * Cleanup resources
   */
  async cleanup(): Promise<void> {
    await this.stop();
    this.clearQueue();
    this.characterVoices.clear();
  }
}

// Export singleton instance
export const narrationService = new NarrationService();
export default narrationService;
