/**
 * Color Script Agent
 * 
 * Generates upfront color/lighting arc references for a story/episode.
 * The color script shows the emotional journey through visual thumbnails.
 */

import { AgentConfig } from '../config';
import { BaseAgent, AgentResponse } from '../BaseAgent';
import {
  ColorScript,
  ColorScriptBeat,
  ColorMeaning,
  EmotionCore,
  EmotionIntensity,
  EmotionValence,
  LightDirection,
  LightTemperature,
  PaletteSaturation,
  ValueKey,
  LIGHTING_DIRECTION_GUIDE,
  LIGHT_QUALITY_GUIDE,
  COLOR_TEMPERATURE_GUIDE,
  generateMoodSpec
} from './LightingColorSystem';

// Story beat input for color script generation
export interface StoryBeatInput {
  beatId: string;
  beatName: string;
  sequenceOrder: number;
  narrativeDescription: string;
  emotionalNote?: string;
  isClimactic?: boolean;
  isResolution?: boolean;
  isSafeHub?: boolean;
  branchType?: 'dark' | 'hopeful' | 'neutral' | 'tragic' | 'redemption';
}

// Request to generate a color script
export interface ColorScriptRequest {
  storyId: string;
  storyTitle: string;
  episodeId?: string;
  episodeTitle?: string;
  genre: string;
  tone: string;
  
  // Story beats to create color script for
  beats: StoryBeatInput[];
  
  // Story-specific color meanings (optional - agent will suggest if not provided)
  colorDictionary?: ColorMeaning[];
  
  // Branch information for variant color scripts
  branches?: {
    branchId: string;
    branchType: 'dark' | 'hopeful' | 'neutral' | 'tragic' | 'redemption';
    affectedBeatIds: string[];
    description: string;
  }[];
}

export class ColorScriptAgent extends BaseAgent {
  constructor(config: AgentConfig) {
    super('Color Script Agent', config);
  }

  async execute(request: ColorScriptRequest): Promise<AgentResponse<ColorScript>> {
    console.log(`[ColorScriptAgent] Generating color script for: ${request.storyTitle}`);
    
    // LIMIT: If too many beats, sample key beats to avoid token truncation
    const MAX_BEATS_FOR_COLOR_SCRIPT = 15;
    let processedRequest = request;
    
    if (request.beats.length > MAX_BEATS_FOR_COLOR_SCRIPT) {
      console.log(`[ColorScriptAgent] Sampling ${MAX_BEATS_FOR_COLOR_SCRIPT} key beats from ${request.beats.length} total`);
      processedRequest = {
        ...request,
        beats: this.sampleKeyBeats(request.beats, MAX_BEATS_FOR_COLOR_SCRIPT)
      };
    }
    
    const prompt = this.buildColorScriptPrompt(processedRequest);
    
    try {
      const response = await this.callLLM([{ role: 'user', content: prompt }]);
      
      // Try to parse, handling potential truncation
      let colorScript: ColorScript;
      try {
        colorScript = this.parseJSON<ColorScript>(response);
      } catch (parseError) {
        // If truncated, try to repair by closing the JSON
        console.warn('[ColorScriptAgent] JSON parse failed, attempting truncation repair...');
        const repaired = this.repairTruncatedJSON(response);
        if (repaired) {
          colorScript = repaired;
        } else {
          throw parseError;
        }
      }
      
      // Validate and fill in any missing data
      colorScript.storyId = request.storyId;
      colorScript.episodeId = request.episodeId;
      
      // Ensure beats array exists
      if (!colorScript.beats) colorScript.beats = [];
      if (!colorScript.colorDictionary) colorScript.colorDictionary = [];
      
      return { success: true, data: colorScript, rawResponse: response };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  /**
   * Sample key beats from a larger set to avoid token limits
   * Prioritizes: first beat, last beat, climactic, resolution, and evenly distributed others
   */
  private sampleKeyBeats(beats: StoryBeatInput[], maxBeats: number): StoryBeatInput[] {
    if (beats.length <= maxBeats) return beats;
    
    const sampled: StoryBeatInput[] = [];
    const usedIndices = new Set<number>();
    
    // Always include first and last
    if (beats.length > 0) {
      sampled.push(beats[0]);
      usedIndices.add(0);
    }
    if (beats.length > 1) {
      sampled.push(beats[beats.length - 1]);
      usedIndices.add(beats.length - 1);
    }
    
    // Include all climactic and resolution beats
    beats.forEach((beat, idx) => {
      if ((beat.isClimactic || beat.isResolution) && !usedIndices.has(idx)) {
        if (sampled.length < maxBeats) {
          sampled.push(beat);
          usedIndices.add(idx);
        }
      }
    });
    
    // Fill remaining slots with evenly distributed beats
    const remaining = maxBeats - sampled.length;
    if (remaining > 0) {
      const step = Math.floor(beats.length / (remaining + 1));
      for (let i = step; i < beats.length && sampled.length < maxBeats; i += step) {
        if (!usedIndices.has(i)) {
          sampled.push(beats[i]);
          usedIndices.add(i);
        }
      }
    }
    
    // Sort by sequence order
    return sampled.sort((a, b) => a.sequenceOrder - b.sequenceOrder);
  }

  /**
   * Attempt to repair truncated JSON response
   */
  private repairTruncatedJSON(response: string): ColorScript | null {
    try {
      // Extract JSON from markdown if present
      let json = response;
      const jsonMatch = response.match(/```json\s*([\s\S]*)/);
      if (jsonMatch) {
        json = jsonMatch[1].replace(/```.*$/, '');
      }
      
      // Try to close open structures
      let depth = { braces: 0, brackets: 0 };
      for (const char of json) {
        if (char === '{') depth.braces++;
        if (char === '}') depth.braces--;
        if (char === '[') depth.brackets++;
        if (char === ']') depth.brackets--;
      }
      
      // Add closing brackets/braces
      // First, close any incomplete object in an array
      if (depth.brackets > 0) {
        // We're likely in the middle of an array of objects
        // Try to close the current object and the arrays
        json = json.trimEnd();
        if (!json.endsWith('}') && !json.endsWith(']') && !json.endsWith('"')) {
          // In the middle of a value - add a placeholder
          json += '"truncated"';
        }
        if (!json.endsWith('}')) {
          json += '}';
          depth.braces--;
        }
      }
      
      // Close arrays
      while (depth.brackets > 0) {
        json += ']';
        depth.brackets--;
      }
      
      // Close objects
      while (depth.braces > 0) {
        json += '}';
        depth.braces--;
      }
      
      const parsed = JSON.parse(json);
      console.log('[ColorScriptAgent] Successfully repaired truncated JSON');
      return parsed as ColorScript;
    } catch (e) {
      console.error('[ColorScriptAgent] Could not repair truncated JSON:', e);
      return null;
    }
  }

  protected getAgentSpecificPrompt(): string {
    return `
## Your Role: Color Script Artist

You create COLOR SCRIPTS - visual emotional maps that show the lighting and color journey of a story.
A color script is like a tiny thumbnail strip showing only color & light evolution.

Lighting and color are STORY SYSTEMS, not just style:
- Each image encodes WHERE we are in the emotional arc
- Each beat's lighting/color should feel DERIVED from the emotion, not picked ad hoc

${LIGHTING_DIRECTION_GUIDE}

${LIGHT_QUALITY_GUIDE}

${COLOR_TEMPERATURE_GUIDE}

## YOUR RULES

1. **NO GENERIC LIGHTING**: Every beat must answer:
   - What should the player feel when they see this?
   - Is this calmer or more intense than the previous beat?
   - Is this warmer/safer or colder/more alien than before?

2. **ARC THINKING**: Map emotional arc → visual arc:
   - **Start**: Often neutral/daylight, balanced palette
   - **Rising tension**: Cooler, more contrast, more shadows
   - **Climax**: Highest contrast, strongest complementary colors
   - **Resolution**: Softer light (warm for good ending, cool/desaturated for bad)

3. **BRANCH AWARENESS**: Different paths get variations of the main script:
   - **Dark path**: Cooler, more low-key, more desaturated
   - **Hopeful path**: More warm pockets, higher key values
   - **Same structure, different temperature**

4. **COLOR DICTIONARY**: Define what colors MEAN in this specific story:
   - "In THIS story, red = X, blue = Y"
   - Keep meanings consistent scene-to-scene
`;
  }

  private buildColorScriptPrompt(request: ColorScriptRequest): string {
    const beatsDescription = request.beats.map(b => `
- **${b.beatName}** (${b.beatId}, order: ${b.sequenceOrder})
  ${b.narrativeDescription}
  ${b.emotionalNote ? `Emotional note: ${b.emotionalNote}` : ''}
  ${b.isClimactic ? '⚡ CLIMACTIC BEAT' : ''}
  ${b.isResolution ? '🏁 RESOLUTION BEAT' : ''}
  ${b.isSafeHub ? '🏠 SAFE HUB SCENE' : ''}
`).join('\n');

    const branchesDescription = request.branches ? request.branches.map(b => `
- **${b.branchId}** (${b.branchType})
  ${b.description}
  Affects beats: ${b.affectedBeatIds.join(', ')}
`).join('\n') : 'No branch variations specified';

    const existingDictionary = request.colorDictionary ? `
## Existing Color Dictionary (use this)
${request.colorDictionary.map(c => `- **${c.color}**: ${c.meaning} - ${c.usage}`).join('\n')}
` : `
## Create a Color Dictionary for this story
Define what 4-6 key colors will MEAN in this specific story.
`;

    return `
Create a COLOR SCRIPT for this interactive story.

## Story Information
- **Title**: ${request.storyTitle}
- **Episode**: ${request.episodeTitle || 'N/A'}
- **Genre**: ${request.genre}
- **Tone**: ${request.tone}

## Story Beats (in sequence order)
${beatsDescription}

## Branch Variations
${branchesDescription}

${existingDictionary}

## Instructions

1. Create a concise COLOR DICTIONARY (4-6 colors) defining what colors mean in this story
2. For each beat, provide a COMPACT color spec (see format below)
3. Map the overall emotional arc
4. BE CONCISE - short values, no extra explanation

## Return Format (KEEP IT COMPACT)

Return ONLY valid JSON, no markdown:
{
  "storyId": "${request.storyId}",
  "episodeId": ${request.episodeId ? `"${request.episodeId}"` : 'null'},
  "colorDictionary": [
    { "color": "name", "meaning": "3-5 word meaning", "usage": "when" }
  ],
  "beats": [
    {
      "beatId": "id",
      "beatName": "short name",
      "sequenceOrder": 0,
      "emotion": "tense",
      "intensity": "medium",
      "valence": "negative",
      "dominantHues": ["blue", "gray"],
      "saturation": "muted",
      "valueKey": "low_key",
      "lightDirection": "side_left",
      "lightTemp": "cool",
      "thumbnailColors": { "background": "#hex", "foreground": "#hex", "accent": "#hex" },
      "narrativeNote": "5 words max"
    }
  ],
  "overallArc": {
    "startingMood": "5 words",
    "midpointMood": "5 words",
    "climaxMood": "5 words",
    "resolutionMood": "5 words"
  },
  "branchVariations": []
}

VALID EMOTION VALUES: hopeful, triumphant, joyful, peaceful, romantic, nostalgic, tense, anxious, fearful, dread, sad, grief, melancholy, lonely, angry, furious, bitter, mysterious, eerie, otherworldly, neutral, contemplative, curious
VALID INTENSITY: low, medium, high, peak
VALID VALENCE: positive, negative, ambiguous, mixed_positive, mixed_negative
VALID SATURATION: muted, normal, vivid
VALID VALUE_KEY: high_key, mid_key, low_key
VALID LIGHT_DIRECTION: top, side_left, side_right, back, under, front, ambient
VALID LIGHT_TEMP: warm, neutral, cool
`;
  }

  /**
   * Generate a visual thumbnail reference for the color script
   * Returns prompts for generating actual color script thumbnail images
   */
  async generateColorScriptThumbnails(colorScript: ColorScript): Promise<AgentResponse<{
    thumbnailPrompts: Array<{
      beatId: string;
      prompt: string;
    }>;
    stripPrompt: string; // Single image showing all beats
  }>> {
    console.log(`[ColorScriptAgent] Generating thumbnail prompts for ${colorScript.beats.length} beats`);

    const thumbnailPrompts = colorScript.beats.map(beat => ({
      beatId: beat.beatId,
      prompt: `abstract color field representing "${beat.emotion}" mood, ${beat.dominantHues.join(' and ')} palette, ${beat.saturation} saturation, ${beat.valueKey.replace('_', ' ')} values, ${beat.lightDirection} lighting direction with ${beat.lightTemp} temperature, minimalist mood thumbnail, no text, square format`
    }));

    // Create a strip prompt that shows the whole arc
    const stripDescription = colorScript.beats.map((b, i) => 
      `panel ${i + 1}: ${b.dominantHues.join('/')} (${b.emotion})`
    ).join(', ');

    const stripPrompt = `horizontal color script strip showing emotional arc through pure abstract color: ${stripDescription}, abstract color blocks transitioning left to right, ${colorScript.beats.length} panels, minimalist mood visualization, no characters, no people, no figures, no text, color fields only`;

    return {
      success: true,
      data: { thumbnailPrompts, stripPrompt }
    };
  }

  /**
   * Get mood spec for a specific beat based on the color script
   */
  getMoodSpecForBeat(colorScript: ColorScript, beatId: string): {
    mood: import('./LightingColorSystem').MoodSpec | null;
    beatData: ColorScriptBeat | null;
    previousBeatData: ColorScriptBeat | null;
  } {
    const beatIndex = colorScript.beats.findIndex(b => b.beatId === beatId);
    if (beatIndex === -1) {
      return { mood: null, beatData: null, previousBeatData: null };
    }

    const beat = colorScript.beats[beatIndex];
    const previousBeat = beatIndex > 0 ? colorScript.beats[beatIndex - 1] : null;

    // Generate mood spec from beat data
    const previousMood = previousBeat ? generateMoodSpec(
      previousBeat.emotion,
      previousBeat.intensity,
      previousBeat.valence
    ) : undefined;

    const mood = generateMoodSpec(
      beat.emotion,
      beat.intensity,
      beat.valence,
      previousMood
    );

    // Apply beat-specific overrides from color script
    mood.color.primaryHues = beat.dominantHues;
    mood.color.saturation = beat.saturation;
    mood.color.valueKey = beat.valueKey;
    mood.lighting.direction = beat.lightDirection;
    mood.lighting.keyLightTemp = beat.lightTemp;

    return { mood, beatData: beat, previousBeatData: previousBeat };
  }

  /**
   * Adjust color script for a specific branch
   */
  adjustForBranch(colorScript: ColorScript, branchId: string): ColorScript {
    const branchVariation = colorScript.branchVariations?.find(b => b.branchId === branchId);
    if (!branchVariation) {
      return colorScript;
    }

    // Create adjusted copy
    const adjusted: ColorScript = JSON.parse(JSON.stringify(colorScript));

    for (const beat of adjusted.beats) {
      // Adjust saturation
      if (branchVariation.saturationAdjust === 'decrease') {
        beat.saturation = beat.saturation === 'vivid' ? 'normal' : 'muted';
      } else if (branchVariation.saturationAdjust === 'increase') {
        beat.saturation = beat.saturation === 'muted' ? 'normal' : 'vivid';
      }

      // Adjust temperature
      if (branchVariation.temperatureShift === 'cooler') {
        beat.lightTemp = beat.lightTemp === 'warm' ? 'neutral' : 'cool';
      } else if (branchVariation.temperatureShift === 'warmer') {
        beat.lightTemp = beat.lightTemp === 'cool' ? 'neutral' : 'warm';
      }

      // Adjust value key for dark paths
      if (branchVariation.branchType === 'dark' || branchVariation.branchType === 'tragic') {
        beat.valueKey = beat.valueKey === 'high_key' ? 'mid_key' : 'low_key';
      }
    }

    return adjusted;
  }
}
