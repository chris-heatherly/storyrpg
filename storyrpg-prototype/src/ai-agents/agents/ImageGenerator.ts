/**
 * Image Generator Agent
 *
 * Generates images for story content:
 * - Scene background images
 * - Beat images for key narrative moments
 * - Episode cover images
 * - Story cover images
 * - Encounter images
 *
 * Uses LLM to create detailed image prompts based on story context,
 * then can integrate with image generation services.
 */

import { AgentConfig } from '../config';
import { BaseAgent, AgentResponse } from './BaseAgent';
import { SceneContent } from './SceneWriter';
import { WorldBible } from './WorldBuilder';
import { CharacterBible } from './CharacterDesigner';
import { EpisodeBlueprint } from './StoryArchitect';
import type {
  BeatImageRequest,
  CharacterMasterRequest,
  CoverImageRequest,
  EncounterSequenceRequest,
  ImageGenerationResult,
  ImagePrompt,
  LocationMasterRequest,
  SceneImageRequest,
} from '../images/imageTypes';

export type {
  BeatImageRequest,
  CharacterMasterRequest,
  CoverImageRequest,
  EncounterSequenceRequest,
  GeneratedImage,
  ImageGenerationResult,
  ImagePrompt,
  ImagePromptControlNet,
  ImagePromptIpAdapter,
  ImagePromptLora,
  LocationMasterRequest,
  SceneImageRequest,
  SDReferencePurpose,
} from '../images/imageTypes';

export class ImageGenerator extends BaseAgent {
  private artStyle?: string;

  constructor(config: AgentConfig, artStyle?: string) {
    super('Image Generator', config);
    this.artStyle = artStyle;
  }

  /**
   * Generic execute method (required by BaseAgent)
   * Prefer using specific methods: generateSceneImagePrompt, generateBeatImagePrompt, generateCoverImagePrompt
   */
  async execute(input: unknown): Promise<AgentResponse<ImagePrompt>> {
    // This is a fallback - prefer using specific methods
    if (typeof input === 'object' && input !== null) {
      const req = input as SceneImageRequest | BeatImageRequest | CoverImageRequest;
      if ('sceneId' in req) {
        return this.generateSceneImagePrompt(req as SceneImageRequest);
      } else if ('beatId' in req) {
        return this.generateBeatImagePrompt(req as BeatImageRequest);
      } else if ('title' in req && 'synopsis' in req) {
        return this.generateCoverImagePrompt(req as CoverImageRequest);
      }
    }
    return {
      success: false,
      error: 'Invalid input. Use generateSceneImagePrompt, generateBeatImagePrompt, or generateCoverImagePrompt methods.',
    };
  }

  protected getAgentSpecificPrompt(): string {
    const styleInstruction = this.artStyle 
      ? `\n### MANDATORY Art Style\nAll images MUST strictly follow this art style: ${this.artStyle}\nEnsure every prompt incorporates specific keywords and techniques relevant to this style.`
      : '';

    return `
## Your Role: Image Generator

You create detailed, evocative image prompts for AI image generation based on story content.
${styleInstruction}

## Continuity & Visual References
When generating story visuals (scenes, beats, encounters), you are continuing a visual narrative. You should assume that master reference visuals have been created for all characters and locations.
- Ensure your prompts for specific shots build upon the core descriptions provided.
- Mention key "anchor" visual traits consistently.
- In your JSON output, use the "referenceCharIds" and "referenceLocationId" fields to tag which master visuals should be used as references for the image generation engine.

## Image Prompt Guidelines

### Composition Rules
- Images should be generated with 9:19.5 aspect ratio (full-bleed mobile format)
- Critical narrative elements (characters, key objects, focal action) should be positioned in the upper two-thirds (9:16 safe zone), centered
- Edges outside the 9:16 safe zone should contain only atmospheric extension
- Bottom third should contain only ground plane, shadows, or ambient details suitable for UI overlay

### Style Consistency
- Maintain consistent visual style across all images for a story
- Match the genre and tone of the story
- Use appropriate color palettes and lighting
- Consider the mood and atmosphere of each scene

### Character Representation
- When characters appear, describe them based on their character profiles
- Maintain character consistency across images
- Focus on recognizable features and clothing

### Scene Composition
- Scene backgrounds should establish location and atmosphere
- Beat images should capture key narrative moments
- Cover images should be iconic and representative of the story

## Output Format

For each image request, provide:
{
  "prompt": "Detailed image generation prompt",
  "negativePrompt": "Things to avoid (optional)",
  "style": "Visual style description",
  "aspectRatio": "9:19.5",
  "composition": "Composition notes for mobile display",
  "referenceCharIds": ["char-1", "char-2"],
  "referenceLocationId": "loc-1"
}
`;
  }

  /**
   * Generate image prompt for a character master portrait
   */
  async generateCharacterMasterPrompt(request: CharacterMasterRequest): Promise<AgentResponse<ImagePrompt>> {
    const prompt = `
Create a definitive character master portrait. This will be used as a visual reference for all future shots of this character.

## Character Information
- **Name**: ${request.name}
- **Role**: ${request.role}
- **Description**: ${request.description}
- **Genre**: ${request.genre}
- **Tone**: ${request.tone}

## Requirements
1. Create a detailed prompt for a high-fidelity character portrait.
2. Character should be against a relatively neutral but atmospheric background.
3. Show the character clearly, full body or upper body.
4. Focus on distinguishing features, clothing, and posture described above.
5. Use 9:19.5 aspect ratio.
${this.artStyle ? `6. STRICTLY follow the art style: ${this.artStyle}` : ''}

Return a JSON object with the image prompt details.
`;

    try {
      const response = await this.callLLM([{ role: 'user', content: prompt }]);
      const imagePrompt = this.parseJSON<ImagePrompt>(response);
      if (!imagePrompt.aspectRatio) imagePrompt.aspectRatio = '9:19.5';
      return { success: true, data: imagePrompt, rawResponse: response };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  /**
   * Generate image prompt for a location master environment shot
   */
  async generateLocationMasterPrompt(request: LocationMasterRequest): Promise<AgentResponse<ImagePrompt>> {
    const prompt = `
Create a definitive environment master shot for a location. This will be used as a visual reference for all future shots in this location.

## Location Information
- **Name**: ${request.name}
- **Type**: ${request.type}
- **Description**: ${request.description}
- **Genre**: ${request.genre}
- **Tone**: ${request.tone}

## Requirements
1. Create a detailed prompt for a wide-angle environment "hero shot".
2. Establish the architecture, lighting, palette, and key landmarks of the location.
3. No characters should be the primary focus; focus on the space itself.
4. Use 9:19.5 aspect ratio.
${this.artStyle ? `5. STRICTLY follow the art style: ${this.artStyle}` : ''}

Return a JSON object with the image prompt details.
`;

    try {
      const response = await this.callLLM([{ role: 'user', content: prompt }]);
      const imagePrompt = this.parseJSON<ImagePrompt>(response);
      if (!imagePrompt.aspectRatio) imagePrompt.aspectRatio = '9:19.5';
      return { success: true, data: imagePrompt, rawResponse: response };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  /**
   * Generate image prompt for a scene background
   */
  async generateSceneImagePrompt(request: SceneImageRequest): Promise<AgentResponse<ImagePrompt>> {
    const prompt = this.buildScenePrompt(request);

    try {
      const response = await this.callLLM([
        { role: 'user', content: prompt }
      ]);

      const imagePrompt = this.parseJSON<ImagePrompt>(response);
      
      // Ensure aspect ratio is set
      if (!imagePrompt.aspectRatio) {
        imagePrompt.aspectRatio = '9:19.5';
      }

      return {
        success: true,
        data: imagePrompt,
        rawResponse: response,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        error: errorMsg,
      };
    }
  }

  /**
   * Generate image prompt for a beat
   */
  async generateBeatImagePrompt(request: BeatImageRequest): Promise<AgentResponse<ImagePrompt>> {
    const prompt = this.buildBeatPrompt(request);

    try {
      const response = await this.callLLM([
        { role: 'user', content: prompt }
      ]);

      const imagePrompt = this.parseJSON<ImagePrompt>(response);
      
      // Ensure aspect ratio is set
      if (!imagePrompt.aspectRatio) {
        imagePrompt.aspectRatio = '9:19.5';
      }

      return {
        success: true,
        data: imagePrompt,
        rawResponse: response,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        error: errorMsg,
      };
    }
  }

  /**
   * Generate image prompt for a cover image
   */
  async generateCoverImagePrompt(request: CoverImageRequest): Promise<AgentResponse<ImagePrompt>> {
    const prompt = this.buildCoverPrompt(request);

    try {
      const response = await this.callLLM([
        { role: 'user', content: prompt }
      ]);

      const imagePrompt = this.parseJSON<ImagePrompt>(response);
      
      // Ensure aspect ratio is set
      if (!imagePrompt.aspectRatio) {
        imagePrompt.aspectRatio = '9:19.5';
      }

      return {
        success: true,
        data: imagePrompt,
        rawResponse: response,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        error: errorMsg,
      };
    }
  }

  /**
   * Generate image prompts for an encounter sequence
   */
  async generateEncounterSequencePrompts(request: EncounterSequenceRequest): Promise<AgentResponse<ImagePrompt[]>> {
    const prompt = this.buildEncounterSequencePrompt(request);

    try {
      const response = await this.callLLM([
        { role: 'user', content: prompt }
      ]);

      const prompts = this.parseJSON<ImagePrompt[]>(response);
      
      // Ensure aspect ratio is set for all
      prompts.forEach(p => {
        if (!p.aspectRatio) p.aspectRatio = '9:19.5';
      });

      return {
        success: true,
        data: prompts,
        rawResponse: response,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        error: errorMsg,
      };
    }
  }

  private buildEncounterSequencePrompt(request: EncounterSequenceRequest): string {
    const charactersInfo = request.characters.map(c => `- ${c.name} (${c.role}): ${c.description}`).join('\n');
    const frameCount = request.outcome === 'situation' ? 1 : 3;
    const styleInfo = this.artStyle ? `- **MANDATORY Art Style**: ${this.artStyle}\n` : '';

    return `
Create a series of ${frameCount} image prompts for an encounter ${request.outcome}.

## Encounter Context
${styleInfo}- **Outcome Type**: ${request.outcome}
- **Scene**: ${request.sceneContext.name}
- **Location**: ${request.sceneContext.location || 'Unknown'}
- **Mood**: ${request.sceneContext.mood}
- **Action/Shot Description**: ${request.shotDescription}
- **Genre**: ${request.genre}
- **Tone**: ${request.tone}

## Characters Involved
${charactersInfo}

## Requirements
1. Create ${frameCount} distinct but visually consistent image prompts.
2. For outcomes (success/failure), these should form a sequence showing the action unfold.
3. Use cinematic camera angles and composition notes.
4. Follow the 9:19.5 mobile aspect ratio guidelines.
5. Ensure character and environment consistency across all frames.

Return a JSON array of image prompt objects.
`;
  }

  private buildScenePrompt(request: SceneImageRequest): string {
    const locationInfo = request.location
      ? `\n**Location**: ${request.location.name}\n${request.location.description}`
      : '';
    const styleInfo = this.artStyle ? `- **MANDATORY Art Style**: ${this.artStyle}\n` : '';

    return `
Create an image prompt for a scene background image.

## Scene Information
${styleInfo}- **Scene Name**: ${request.sceneName}
- **Description**: ${request.description}
${locationInfo}
- **Mood**: ${request.mood}
- **Genre**: ${request.genre}
- **Tone**: ${request.tone}

## Requirements
1. Create a detailed image generation prompt for a background image
2. The image should establish the location and atmosphere
3. Use 9:19.5 aspect ratio with composition guidelines for mobile display
4. Focus on environment, lighting, and mood
5. Include style notes matching the genre and tone

Return a JSON object with the image prompt details.
`;
  }

  private buildBeatPrompt(request: BeatImageRequest): string {
    const charactersInfo = request.characters && request.characters.length > 0
      ? `\n**Characters Present**:\n${request.characters.map(c => `- ${c.name}: ${c.description}`).join('\n')}`
      : '';
    const styleInfo = this.artStyle ? `- **MANDATORY Art Style**: ${this.artStyle}\n` : '';

    return `
Create an image prompt for a narrative beat image.

## Beat Information
${styleInfo}- **Beat Text**: ${request.beatText}
- **Scene Context**: ${request.sceneContext.name}${request.sceneContext.location ? ` (${request.sceneContext.location})` : ''}
- **Mood**: ${request.sceneContext.mood}
${charactersInfo}
- **Genre**: ${request.genre}
- **Tone**: ${request.tone}

## Requirements
1. Create a detailed image generation prompt capturing the key moment in this beat
2. The image should be visually compelling and narrative-focused
3. Use 9:19.5 aspect ratio with composition guidelines for mobile display
4. Position critical elements in the upper two-thirds safe zone
5. Include style notes matching the genre and tone

Return a JSON object with the image prompt details.
`;
  }

  private buildCoverPrompt(request: CoverImageRequest): string {
    const keyElementsInfo = request.keyElements && request.keyElements.length > 0
      ? `\n**Key Elements**: ${request.keyElements.join(', ')}`
      : '';
    const styleInfo = this.artStyle ? `- **MANDATORY Art Style**: ${this.artStyle}\n` : '';

    return `
Create an image prompt for a cover image.

## Story Information
${styleInfo}- **Title**: ${request.title}
- **Synopsis**: ${request.synopsis}
${keyElementsInfo}
- **Genre**: ${request.genre}
- **Tone**: ${request.tone}

## Requirements
1. Create a detailed image generation prompt for an iconic cover image
2. The image should be representative and compelling
3. Use 9:19.5 aspect ratio with composition guidelines for mobile display
4. Should work well as a thumbnail and full-screen image
5. Include style notes matching the genre and tone

Return a JSON object with the image prompt details.
`;
  }
}
