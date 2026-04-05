/**
 * VideoDirectorAgent
 *
 * Generates cinematic animation instructions for each beat's still image.
 * Takes storyboard data (camera angle, pose, mood, transition) and beat narrative
 * context, then produces Veo-compatible motion prompts that describe how to
 * animate the still frame into a short video clip.
 */

import { AgentConfig } from '../../config';
import { BaseAgent, AgentResponse } from '../BaseAgent';
import { VideoAnimationInstruction } from '../../../types';

export interface VideoDirectionRequest {
  beatId: string;
  sceneId: string;
  beatText: string;
  imagePrompt: string;
  shotType?: string;
  cameraAngle?: string;
  horizontalAngle?: string;
  storyBeat?: {
    action: string;
    emotion: string;
    relationship?: string;
  };
  pose?: {
    lineOfAction?: string;
    weightDistribution?: string;
    armPosition?: string;
    emotionalQuality?: string;
  };
  lighting?: {
    direction?: string;
    quality?: string;
    temperature?: string;
  };
  transitionToNext?: {
    type?: string;
    changeDescription?: string;
  };
  moodSpec?: {
    emotion?: string;
    intensity?: number;
  };
  sceneContext: {
    name: string;
    genre: string;
    tone: string;
    mood: string;
  };
  previousBeatSummary?: string;
  nextBeatSummary?: string;
  artStyle?: string;
}

export interface VideoDirectionBatchRequest {
  beats: VideoDirectionRequest[];
  episodeContext?: string;
}

const VIDEO_DIRECTION_SYSTEM_PROMPT = `You are a cinematic animation director specializing in translating still illustrations into short animated video clips.

## YOUR ROLE
Given a still image description and its narrative context, you produce precise animation direction that a video generation AI (Google Veo) will use to bring the image to life as an 8-second clip.

## ANIMATION PHILOSOPHY
- Every motion serves the story — no gratuitous movement
- Character animation should feel natural and emotionally grounded
- Camera motion should guide the viewer's attention to the narrative focal point
- Environment animation adds atmosphere without distracting from characters
- Pacing matches the emotional beat: tense moments use slow, deliberate motion; action beats use dynamic movement

## VEO PROMPT BEST PRACTICES
- Describe motion chronologically: what happens first, then what follows
- Be specific about direction and speed of movement
- Reference the starting composition (the still image) as the opening frame
- Include ambient details: wind in hair, flickering light, drifting particles
- Avoid requesting text, UI elements, or impossible physics
- Keep descriptions under 200 words for optimal Veo comprehension
- Mention the art style to maintain visual consistency

## CAMERA MOTION VOCABULARY
- STATIC: Camera holds position (use for intimate/dialogue moments)
- SLOW PUSH IN: Gradual zoom toward subject (builds tension or intimacy)
- SLOW PULL BACK: Gradual zoom out (reveals environment or isolation)
- PAN LEFT/RIGHT: Horizontal sweep (follows action or reveals space)
- TILT UP/DOWN: Vertical sweep (reveals height or grounds the scene)
- DOLLY: Camera physically moves through space (adds depth)
- CRANE UP/DOWN: Vertical camera movement (establishes or diminishes power)
- SUBTLE DRIFT: Barely perceptible movement (adds life to static scenes)

## CHARACTER ANIMATION VOCABULARY
- Breathing/idle motion (subtle chest rise, weight shifting)
- Facial expression shifts (brow movement, lip tension, gaze direction)
- Gesture completion (hand reaching, arm extending, turning)
- Full body motion (walking, turning, reacting physically)
- Hair/clothing physics (wind interaction, movement follow-through)

## OUTPUT FORMAT
Respond with valid JSON matching this schema exactly. No markdown, no extra text.
{
  "motionDescription": "Overall description of what motion/animation to show",
  "cameraMotion": "Specific camera movement direction",
  "characterAnimation": "What the character(s) do during the clip",
  "environmentAnimation": "Ambient/environment motion details",
  "pacing": "slow" | "medium" | "fast",
  "audioHint": "Optional ambient sound suggestion for Veo's native audio",
  "composedPrompt": "The final assembled Veo prompt (under 200 words)"
}`;

export class VideoDirectorAgent extends BaseAgent {
  private artStyle: string;

  constructor(config: AgentConfig, artStyle?: string) {
    super('VideoDirector', config);
    this.artStyle = artStyle || '';
  }

  protected getAgentSpecificPrompt(): string {
    return VIDEO_DIRECTION_SYSTEM_PROMPT;
  }

  async execute(input: unknown): Promise<AgentResponse<VideoAnimationInstruction>> {
    const request = input as VideoDirectionRequest;
    return this.generateVideoDirection(request);
  }

  async generateVideoDirection(
    request: VideoDirectionRequest
  ): Promise<AgentResponse<VideoAnimationInstruction>> {
    const userPrompt = this.buildDirectionPrompt(request);

    try {
      const rawResponse = await this.callLLM([
        { role: 'system', content: this.systemPrompt },
        { role: 'user', content: userPrompt },
      ]);

      const cleaned = rawResponse.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
      const parsed = JSON.parse(cleaned);

      const instruction: VideoAnimationInstruction = {
        beatId: request.beatId,
        sceneId: request.sceneId,
        motionDescription: parsed.motionDescription || '',
        cameraMotion: parsed.cameraMotion || 'STATIC',
        characterAnimation: parsed.characterAnimation || '',
        environmentAnimation: parsed.environmentAnimation || '',
        pacing: this.validatePacing(parsed.pacing),
        audioHint: parsed.audioHint,
        composedPrompt: parsed.composedPrompt || '',
      };

      return { success: true, data: instruction, rawResponse };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`[VideoDirector] Failed to generate direction for beat ${request.beatId}: ${errorMsg}`);
      return { success: false, error: errorMsg };
    }
  }

  async generateBatchDirections(
    request: VideoDirectionBatchRequest
  ): Promise<AgentResponse<VideoAnimationInstruction[]>> {
    const results: VideoAnimationInstruction[] = [];

    for (const beat of request.beats) {
      const result = await this.generateVideoDirection(beat);
      if (result.success && result.data) {
        results.push(result.data);
      } else {
        console.warn(`[VideoDirector] Skipping beat ${beat.beatId}: ${result.error}`);
      }
    }

    return {
      success: results.length > 0,
      data: results,
    };
  }

  private buildDirectionPrompt(request: VideoDirectionRequest): string {
    const sections: string[] = [];

    if (this.artStyle || request.artStyle) {
      sections.push(`ART STYLE: ${request.artStyle || this.artStyle}`);
    }

    sections.push(`SCENE: "${request.sceneContext.name}" — ${request.sceneContext.genre}, ${request.sceneContext.tone} tone, ${request.sceneContext.mood} mood`);

    sections.push(`BEAT NARRATIVE:\n${request.beatText}`);

    sections.push(`STILL IMAGE DESCRIPTION:\n${request.imagePrompt}`);

    if (request.storyBeat) {
      const sb = request.storyBeat;
      sections.push(`STORY BEAT: Action="${sb.action}", Emotion="${sb.emotion}"${sb.relationship ? `, Relationship="${sb.relationship}"` : ''}`);
    }

    if (request.shotType || request.cameraAngle) {
      sections.push(`CAMERA: ${request.shotType || 'MS'} shot, ${request.cameraAngle || 'Eye-level'} angle${request.horizontalAngle ? `, ${request.horizontalAngle}` : ''}`);
    }

    if (request.pose) {
      const p = request.pose;
      const poseDetails = [
        p.lineOfAction && `line-of-action: ${p.lineOfAction}`,
        p.weightDistribution && `weight: ${p.weightDistribution}`,
        p.armPosition && `arms: ${p.armPosition}`,
        p.emotionalQuality && `emotional quality: ${p.emotionalQuality}`,
      ].filter(Boolean).join(', ');
      if (poseDetails) sections.push(`POSE: ${poseDetails}`);
    }

    if (request.lighting) {
      const l = request.lighting;
      const lightDetails = [
        l.direction && `direction: ${l.direction}`,
        l.quality && `quality: ${l.quality}`,
        l.temperature && `temperature: ${l.temperature}`,
      ].filter(Boolean).join(', ');
      if (lightDetails) sections.push(`LIGHTING: ${lightDetails}`);
    }

    if (request.moodSpec) {
      sections.push(`MOOD: ${request.moodSpec.emotion || 'neutral'}, intensity ${request.moodSpec.intensity ?? 5}/10`);
    }

    if (request.transitionToNext) {
      sections.push(`TRANSITION TO NEXT: ${request.transitionToNext.type || 'cut'} — ${request.transitionToNext.changeDescription || ''}`);
    }

    if (request.previousBeatSummary) {
      sections.push(`PREVIOUS BEAT: ${request.previousBeatSummary}`);
    }
    if (request.nextBeatSummary) {
      sections.push(`NEXT BEAT: ${request.nextBeatSummary}`);
    }

    sections.push(`Generate animation direction for this beat. The still image is the first frame — describe how to bring it to life as an 8-second animated clip. Focus on subtle, story-driven motion that enhances the narrative moment.`);

    return sections.join('\n\n');
  }

  private validatePacing(pacing: string): 'slow' | 'medium' | 'fast' {
    const normalized = (pacing || '').toLowerCase().trim();
    if (normalized === 'slow' || normalized === 'medium' || normalized === 'fast') {
      return normalized;
    }
    return 'medium';
  }
}
