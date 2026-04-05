/**
 * Voice Casting Service
 * 
 * Automatically matches ElevenLabs voices to story characters based on:
 * - Gender (from pronouns)
 * - Age (young, middle, old)
 * - Personality traits
 * - Accent preferences
 * - Voice characteristics (warm, authoritative, playful, etc.)
 */

import { CharacterBible } from '../agents/CharacterDesigner';

// Voice metadata from ElevenLabs
export interface ElevenLabsVoice {
  id: string;
  name: string;
  category?: string;
  description?: string;
  previewUrl?: string;
  labels?: {
    accent?: string;
    age?: string;
    gender?: string;
    use_case?: string;
    description?: string;
    [key: string]: string | undefined;
  };
}

// Character voice assignment
export interface VoiceAssignment {
  characterId: string;
  characterName: string;
  voiceId: string;
  voiceName: string;
  matchScore: number;
  matchReasons: string[];
  isNarrator?: boolean;
}

// Voice cast result for a story
export interface VoiceCast {
  narrator: VoiceAssignment;
  characters: VoiceAssignment[];
  generatedAt: string;
  totalVoicesAvailable: number;
}

// Scoring weights for voice matching
const MATCH_WEIGHTS = {
  gender: 50,        // Gender match is most important
  age: 25,           // Age category match
  accent: 15,        // Accent preference
  personality: 10,   // Personality alignment
};

// Default voice IDs (fallbacks)
const DEFAULT_VOICES = {
  narrator: 'onwK4e9ZLuTAKqWW03F9', // Daniel - calm, professional
  male: 'TxGEqnHWrfWFTfGW9XjX',     // Josh - friendly male
  female: 'EXAVITQu4vr4xnSDxMaL',   // Bella - warm female
  child: 'jBpfuIE2acCO8z3wKNLl',    // Gigi - young voice
  elderly_male: 'VR6AewLTigWG4xSOukaG', // Arnold - older male
  elderly_female: 'ThT5KcBeYPX3keUQqHPh', // Dorothy - older female
};

// Personality to voice characteristic mappings
const PERSONALITY_VOICE_HINTS: Record<string, string[]> = {
  // Positive traits
  warm: ['warm', 'friendly', 'soft', 'gentle'],
  confident: ['confident', 'strong', 'authoritative', 'clear'],
  playful: ['playful', 'energetic', 'youthful', 'bright'],
  mysterious: ['deep', 'mysterious', 'smooth', 'seductive'],
  wise: ['calm', 'measured', 'wise', 'thoughtful'],
  fierce: ['intense', 'powerful', 'commanding', 'sharp'],
  gentle: ['soft', 'gentle', 'soothing', 'tender'],
  
  // Negative traits (for antagonists)
  menacing: ['deep', 'dark', 'gravelly', 'intense'],
  cunning: ['smooth', 'silky', 'calculating'],
  
  // Roles
  leader: ['authoritative', 'commanding', 'confident'],
  mentor: ['wise', 'warm', 'calm', 'measured'],
  trickster: ['playful', 'mischievous', 'quick'],
  warrior: ['strong', 'powerful', 'intense'],
};

class VoiceCastingService {
  private apiKey: string | null = null;
  private cachedVoices: ElevenLabsVoice[] | null = null;
  private cacheTimestamp: number = 0;
  private cacheDurationMs: number = 5 * 60 * 1000; // 5 minutes
  
  // Get proxy URL dynamically
  private get proxyUrl(): string {
    try {
      const { PROXY_CONFIG } = require('../../config/endpoints');
      return PROXY_CONFIG.getProxyUrl();
    } catch {
      return 'http://localhost:3001';
    }
  }

  /**
   * Set the ElevenLabs API key
   */
  setApiKey(apiKey: string): void {
    this.apiKey = apiKey;
  }

  /**
   * Fetch available voices from ElevenLabs (with caching)
   */
  async getAvailableVoices(forceRefresh = false): Promise<ElevenLabsVoice[]> {
    const now = Date.now();
    
    // Return cached voices if still valid
    if (!forceRefresh && this.cachedVoices && (now - this.cacheTimestamp) < this.cacheDurationMs) {
      return this.cachedVoices;
    }

    try {
      const response = await fetch(`${this.proxyUrl}/elevenlabs/voices`, {
        headers: {
          ...(this.apiKey && { 'x-elevenlabs-api-key': this.apiKey }),
        },
      });

      if (!response.ok) {
        console.warn('[VoiceCasting] Failed to fetch voices, using defaults');
        return this.getDefaultVoicesList();
      }

      const data = await response.json();
      this.cachedVoices = data.voices || [];
      this.cacheTimestamp = now;
      
      console.log(`[VoiceCasting] Loaded ${this.cachedVoices.length} voices from ElevenLabs`);
      return this.cachedVoices;
    } catch (error) {
      console.warn('[VoiceCasting] Error fetching voices:', error);
      return this.getDefaultVoicesList();
    }
  }

  /**
   * Get default voices list as fallback
   */
  private getDefaultVoicesList(): ElevenLabsVoice[] {
    return [
      { id: DEFAULT_VOICES.narrator, name: 'Daniel', labels: { gender: 'male', age: 'middle aged', description: 'calm, professional' } },
      { id: DEFAULT_VOICES.male, name: 'Josh', labels: { gender: 'male', age: 'young', description: 'friendly' } },
      { id: DEFAULT_VOICES.female, name: 'Bella', labels: { gender: 'female', age: 'young', description: 'warm' } },
      { id: DEFAULT_VOICES.child, name: 'Gigi', labels: { gender: 'female', age: 'young', description: 'youthful, energetic' } },
      { id: DEFAULT_VOICES.elderly_male, name: 'Arnold', labels: { gender: 'male', age: 'old', description: 'wise, measured' } },
      { id: DEFAULT_VOICES.elderly_female, name: 'Dorothy', labels: { gender: 'female', age: 'old', description: 'warm, grandmotherly' } },
    ];
  }

  /**
   * Cast voices for all characters in a story
   */
  async castVoices(characterBible: CharacterBible): Promise<VoiceCast> {
    const voices = await this.getAvailableVoices();
    const assignments: VoiceAssignment[] = [];
    const usedVoiceIds = new Set<string>();

    // First, assign narrator voice
    const narratorVoice = this.selectNarratorVoice(voices);
    usedVoiceIds.add(narratorVoice.id);
    
    const narratorAssignment: VoiceAssignment = {
      characterId: 'narrator',
      characterName: 'Narrator',
      voiceId: narratorVoice.id,
      voiceName: narratorVoice.name,
      matchScore: 100,
      matchReasons: ['Default narrator voice - professional, clear'],
      isNarrator: true,
    };

    // Sort characters by importance (protagonist first, then major NPCs)
    const sortedCharacters = this.sortCharactersByImportance(characterBible);

    // Assign voices to each character
    for (const character of sortedCharacters) {
      const availableVoices = voices.filter(v => !usedVoiceIds.has(v.id));
      
      if (availableVoices.length === 0) {
        console.warn(`[VoiceCasting] No more unique voices available for ${character.name}`);
        // Fall back to reusing a voice based on gender
        const fallbackVoice = this.selectFallbackVoice(voices, character);
        assignments.push({
          characterId: character.id,
          characterName: character.name,
          voiceId: fallbackVoice.id,
          voiceName: fallbackVoice.name,
          matchScore: 50,
          matchReasons: ['Fallback - no unique voice available'],
        });
        continue;
      }

      const { voice, score, reasons } = this.findBestVoiceMatch(character, availableVoices);
      usedVoiceIds.add(voice.id);
      
      assignments.push({
        characterId: character.id,
        characterName: character.name,
        voiceId: voice.id,
        voiceName: voice.name,
        matchScore: score,
        matchReasons: reasons,
      });

      console.log(`[VoiceCasting] ${character.name} -> ${voice.name} (score: ${score})`);
    }

    return {
      narrator: narratorAssignment,
      characters: assignments,
      generatedAt: new Date().toISOString(),
      totalVoicesAvailable: voices.length,
    };
  }

  /**
   * Select the best narrator voice
   */
  private selectNarratorVoice(voices: ElevenLabsVoice[]): ElevenLabsVoice {
    // Look for voices labeled as narration/storytelling
    const narratorCandidates = voices.filter(v => {
      const desc = (v.description || '').toLowerCase();
      const useCase = (v.labels?.use_case || '').toLowerCase();
      return useCase.includes('narrat') || useCase.includes('audiobook') || 
             desc.includes('narrat') || desc.includes('storytell') ||
             desc.includes('calm') || desc.includes('professional');
    });

    if (narratorCandidates.length > 0) {
      // Prefer male narrator (traditional audiobook style) but not required
      const maleNarrator = narratorCandidates.find(v => 
        v.labels?.gender?.toLowerCase() === 'male'
      );
      if (maleNarrator) return maleNarrator;
      return narratorCandidates[0];
    }

    // Fallback to Daniel (default narrator)
    const daniel = voices.find(v => v.id === DEFAULT_VOICES.narrator);
    return daniel || voices[0];
  }

  /**
   * Sort characters by importance for voice assignment priority
   */
  private sortCharactersByImportance(characterBible: CharacterBible): typeof characterBible.characters {
    return [...characterBible.characters].sort((a, b) => {
      // Protagonist gets top priority
      const aIsProtag = a.role?.toLowerCase().includes('protagonist') || a.id === characterBible.protagonist?.id;
      const bIsProtag = b.role?.toLowerCase().includes('protagonist') || b.id === characterBible.protagonist?.id;
      if (aIsProtag && !bIsProtag) return -1;
      if (bIsProtag && !aIsProtag) return 1;

      // Then by tier (if available)
      const tierOrder: Record<string, number> = { 'tier1': 1, 'tier2': 2, 'tier3': 3 };
      const aTier = tierOrder[(a as any).tier || 'tier3'] || 3;
      const bTier = tierOrder[(b as any).tier || 'tier3'] || 3;
      
      return aTier - bTier;
    });
  }

  /**
   * Find the best matching voice for a character
   */
  private findBestVoiceMatch(
    character: CharacterBible['characters'][0],
    availableVoices: ElevenLabsVoice[]
  ): { voice: ElevenLabsVoice; score: number; reasons: string[] } {
    let bestVoice = availableVoices[0];
    let bestScore = 0;
    let bestReasons: string[] = [];

    // Extract character attributes
    const charGender = this.inferGender(character);
    const charAge = this.inferAge(character);
    const charTraits = this.extractPersonalityTraits(character);

    for (const voice of availableVoices) {
      let score = 0;
      const reasons: string[] = [];

      // Gender matching (most important)
      const voiceGender = (voice.labels?.gender || '').toLowerCase();
      if (charGender && voiceGender) {
        if (charGender === voiceGender) {
          score += MATCH_WEIGHTS.gender;
          reasons.push(`Gender match: ${voiceGender}`);
        } else if (charGender === 'non-binary' || voiceGender === 'neutral') {
          score += MATCH_WEIGHTS.gender * 0.5;
          reasons.push('Gender: neutral/flexible');
        }
      }

      // Age matching
      const voiceAge = this.normalizeAge(voice.labels?.age || '');
      if (charAge && voiceAge) {
        if (charAge === voiceAge) {
          score += MATCH_WEIGHTS.age;
          reasons.push(`Age match: ${voiceAge}`);
        } else if (this.isAgeClose(charAge, voiceAge)) {
          score += MATCH_WEIGHTS.age * 0.5;
          reasons.push(`Age close: ${voiceAge}`);
        }
      }

      // Personality/description matching
      const voiceDesc = (voice.description || '').toLowerCase() + ' ' + 
                       (voice.labels?.description || '').toLowerCase();
      
      for (const trait of charTraits) {
        const hints = PERSONALITY_VOICE_HINTS[trait.toLowerCase()] || [trait.toLowerCase()];
        for (const hint of hints) {
          if (voiceDesc.includes(hint)) {
            score += MATCH_WEIGHTS.personality;
            reasons.push(`Personality match: ${trait} -> ${hint}`);
            break;
          }
        }
      }

      // Accent matching (if character has accent specified)
      const charAccent = this.inferAccent(character);
      const voiceAccent = (voice.labels?.accent || '').toLowerCase();
      if (charAccent && voiceAccent && voiceAccent.includes(charAccent)) {
        score += MATCH_WEIGHTS.accent;
        reasons.push(`Accent match: ${voiceAccent}`);
      }

      if (score > bestScore) {
        bestScore = score;
        bestVoice = voice;
        bestReasons = reasons;
      }
    }

    // If no good match, add a reason
    if (bestReasons.length === 0) {
      bestReasons.push('Best available voice (no specific matches)');
    }

    return { voice: bestVoice, score: bestScore, reasons: bestReasons };
  }

  /**
   * Infer gender from character pronouns or description
   */
  private inferGender(character: CharacterBible['characters'][0]): string | null {
    const pronouns = ((character as any).pronouns || '').toLowerCase();
    
    if (pronouns.includes('she') || pronouns.includes('her')) return 'female';
    if (pronouns.includes('he') || pronouns.includes('him')) return 'male';
    if (pronouns.includes('they') || pronouns.includes('them')) return 'non-binary';

    // Try to infer from description
    const desc = (character.description || '').toLowerCase();
    if (desc.includes('woman') || desc.includes('girl') || desc.includes('female') || 
        desc.includes('queen') || desc.includes('princess') || desc.includes('mother') ||
        desc.includes('sister') || desc.includes('daughter')) {
      return 'female';
    }
    if (desc.includes('man') || desc.includes('boy') || desc.includes('male') ||
        desc.includes('king') || desc.includes('prince') || desc.includes('father') ||
        desc.includes('brother') || desc.includes('son')) {
      return 'male';
    }

    return null;
  }

  /**
   * Infer age category from character description
   */
  private inferAge(character: CharacterBible['characters'][0]): string | null {
    const desc = (character.description || '').toLowerCase();
    const backstory = ((character as any).backstory || '').toLowerCase();
    const combined = desc + ' ' + backstory;

    // Check for explicit age mentions
    const ageMatch = combined.match(/(\d+)\s*years?\s*old/);
    if (ageMatch) {
      const age = parseInt(ageMatch[1]);
      if (age < 13) return 'child';
      if (age < 25) return 'young';
      if (age < 55) return 'middle';
      return 'old';
    }

    // Keyword inference
    if (combined.includes('child') || combined.includes('kid') || combined.includes('young boy') || 
        combined.includes('young girl')) {
      return 'child';
    }
    if (combined.includes('teenager') || combined.includes('teen') || combined.includes('young adult') ||
        combined.includes('youthful')) {
      return 'young';
    }
    if (combined.includes('elderly') || combined.includes('aged') || combined.includes('old ') ||
        combined.includes('ancient') || combined.includes('grandfather') || combined.includes('grandmother')) {
      return 'old';
    }
    if (combined.includes('mature') || combined.includes('experienced') || combined.includes('veteran')) {
      return 'middle';
    }

    // Default to middle-aged for most characters
    return 'middle';
  }

  /**
   * Normalize age labels from ElevenLabs
   */
  private normalizeAge(age: string): string {
    const lower = age.toLowerCase();
    if (lower.includes('young') || lower.includes('youth')) return 'young';
    if (lower.includes('middle') || lower.includes('adult')) return 'middle';
    if (lower.includes('old') || lower.includes('elder') || lower.includes('senior')) return 'old';
    return 'middle';
  }

  /**
   * Check if two ages are close enough for a partial match
   */
  private isAgeClose(age1: string, age2: string): boolean {
    const order = ['child', 'young', 'middle', 'old'];
    const idx1 = order.indexOf(age1);
    const idx2 = order.indexOf(age2);
    return Math.abs(idx1 - idx2) <= 1;
  }

  /**
   * Extract personality traits from character
   */
  private extractPersonalityTraits(character: CharacterBible['characters'][0]): string[] {
    const traits: string[] = [];
    
    // From explicit traits array
    if ((character as any).traits) {
      traits.push(...(character as any).traits);
    }

    // From personality description
    const desc = (character.description || '').toLowerCase();
    
    // Check for common personality keywords
    const keywords = [
      'warm', 'cold', 'fierce', 'gentle', 'wise', 'cunning', 'brave', 'timid',
      'confident', 'shy', 'playful', 'serious', 'mysterious', 'open', 'guarded',
      'leader', 'mentor', 'trickster', 'warrior', 'healer', 'scholar'
    ];
    
    for (const keyword of keywords) {
      if (desc.includes(keyword)) {
        traits.push(keyword);
      }
    }

    // From role
    const role = (character.role || '').toLowerCase();
    if (role.includes('antagonist') || role.includes('villain')) {
      traits.push('menacing');
    }
    if (role.includes('mentor')) {
      traits.push('wise');
    }

    return traits;
  }

  /**
   * Infer accent preference from character
   */
  private inferAccent(character: CharacterBible['characters'][0]): string | null {
    const desc = (character.description || '').toLowerCase();
    
    // Common accent keywords
    const accents = ['british', 'american', 'irish', 'scottish', 'australian', 
                    'french', 'german', 'spanish', 'italian', 'russian'];
    
    for (const accent of accents) {
      if (desc.includes(accent)) {
        return accent;
      }
    }
    
    return null;
  }

  /**
   * Select a fallback voice when no unique voice is available
   */
  private selectFallbackVoice(
    voices: ElevenLabsVoice[], 
    character: CharacterBible['characters'][0]
  ): ElevenLabsVoice {
    const gender = this.inferGender(character);
    
    // Find any voice matching gender
    const genderMatch = voices.find(v => 
      (v.labels?.gender || '').toLowerCase() === gender
    );
    
    if (genderMatch) return genderMatch;
    
    // Final fallback
    return voices[0];
  }

  /**
   * Convert voice cast to a simple character->voiceId map
   */
  voiceCastToMap(cast: VoiceCast): Map<string, string> {
    const map = new Map<string, string>();
    
    // Add narrator
    map.set('narrator', cast.narrator.voiceId);
    map.set('', cast.narrator.voiceId); // Empty speaker = narrator
    
    // Add all characters (by both ID and name for flexible lookup)
    for (const assignment of cast.characters) {
      map.set(assignment.characterId.toLowerCase(), assignment.voiceId);
      map.set(assignment.characterName.toLowerCase(), assignment.voiceId);
    }
    
    return map;
  }
}

// Export singleton
export const voiceCastingService = new VoiceCastingService();
export default voiceCastingService;
