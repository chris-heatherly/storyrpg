/**
 * Dialogue Specialist Agent
 *
 * The character dialogue expert responsible for:
 * - Generating multiple dialogue variants per line for different relationship states
 * - Handling emotional subtext and voice consistency
 * - Creating dialogue that reflects character personality and current emotional state
 * - Producing cold, neutral, warm, and romantic variants as appropriate
 */

import { AgentConfig } from '../config';
import { BaseAgent, AgentResponse } from './BaseAgent';

// Relationship state affects dialogue tone and content
export type RelationshipState = 'cold' | 'neutral' | 'warm' | 'romantic';

// Emotional context for the dialogue
export interface EmotionalContext {
  primary: string; // e.g., "angry", "hopeful", "fearful"
  underlying?: string; // e.g., "secretly worried", "hiding affection"
  intensity: 'subtle' | 'moderate' | 'intense';
}

// Input types
export interface DialogueSpecialistInput {
  // Scene context
  sceneId: string;
  sceneMood: string;
  sceneDescription: string;

  // Story context
  storyContext: {
    title: string;
    genre: string;
    tone: string;
  };

  // Character speaking
  speaker: {
    id: string;
    name: string;
    personality: string;
    speakingStyle?: string; // e.g., "formal", "casual", "poetic"
    currentEmotionalState?: string;
  };

  // Character being addressed (if any)
  addressee?: {
    id: string;
    name: string;
    relationshipToSpeaker?: string;
  };

  // Dialogue context
  dialogueIntent: string; // What the dialogue needs to accomplish
  precedingContext: string; // What just happened before this line
  followingAction?: string; // What happens after this dialogue

  // Protagonist info for proper pronoun handling
  protagonistInfo: {
    name: string;
    pronouns: 'he/him' | 'she/her' | 'they/them';
  };

  // Which relationship variants to generate
  requestedVariants: RelationshipState[];

  // Optional emotional context
  emotionalContext?: EmotionalContext;
}

// Output types
export interface DialogueVariant {
  relationshipState: RelationshipState;
  text: string;
  emotionalSubtext?: string; // What the character is really feeling/meaning
  deliveryNote?: string; // Stage direction for how it's delivered
}

export interface DialogueLine {
  speakerId: string;
  speakerName: string;
  intent: string;
  variants: DialogueVariant[];
  authorNotes?: string;
}

export interface DialogueOutput {
  sceneId: string;
  dialogueLines: DialogueLine[];
  voiceConsistencyNotes?: string;
}

export class DialogueSpecialist extends BaseAgent {
  constructor(config: AgentConfig) {
    super('Dialogue Specialist', config);
    this.includeSystemPrompt = true;
  }

  protected getAgentSpecificPrompt(): string {
    return `
## Your Role: Dialogue Specialist

You craft authentic character dialogue that reveals personality, advances relationships, and carries emotional subtext. Every line you write should feel true to the character and appropriate for the relationship state.

## Dialogue Principles

### Voice Consistency
- Each character has a unique voice based on their personality and background
- Speech patterns, vocabulary, and rhythm should remain consistent
- Emotional state affects delivery but not fundamental voice

### Relationship State Variants
Generate different dialogue for each relationship state:

**COLD** (Trust: Low, Familiarity: Low/Negative)
- Guarded, formal, or hostile
- Short responses, deflection
- Suspicious undertones
- May be sarcastic or dismissive

**NEUTRAL** (Trust: Medium, Familiarity: Medium)
- Professional or politely distant
- Task-focused communication
- Neither warm nor cold
- Standard courtesy

**WARM** (Trust: High, Familiarity: High)
- Friendly, open, relaxed
- Willing to share and confide
- Uses nicknames or casual address
- Shows genuine concern

**ROMANTIC** (Trust: Very High, Intimacy: Present)
- Tender, vulnerable, affectionate
- Pet names, soft delivery
- Willing to be emotionally exposed
- Subtext of deep care

### Emotional Subtext
- What characters SAY vs what they MEAN
- Internal conflict should show through word choice
- Hiding emotions creates interesting tension
- Allow vulnerability to peek through defenses

### Delivery Notes
Brief stage directions that help convey tone:
- "(barely containing anger)"
- "(avoiding eye contact)"
- "(with forced casualness)"
- "(voice catching)"

## Quality Guidelines

- **STRICT MAXIMUM 4 sentences per dialogue line.**
- **TARGET: 1-2 sentences per line (5-30 words).**
- Active voice preferred.
- Avoid exposition dumps in dialogue.
- Show, don't tell emotions.
- Subtext > explicit statements.
- Each variant should feel genuinely different, not just find-replace.
- DO NOT write paragraphs.
`;
  }

  async execute(input: DialogueSpecialistInput): Promise<AgentResponse<DialogueOutput>> {
    const prompt = this.buildPrompt(input);

    console.log(`[DialogueSpecialist] Generating dialogue for scene: ${input.sceneId}, speaker: ${input.speaker.name}`);

    try {
      const response = await this.callLLM([
        { role: 'user', content: prompt }
      ]);

      console.log(`[DialogueSpecialist] Received response (${response.length} chars)`);

      let dialogueOutput: DialogueOutput;
      try {
        dialogueOutput = this.parseJSON<DialogueOutput>(response);
      } catch (parseError) {
        console.error(`[DialogueSpecialist] JSON parse failed. Raw response (first 500 chars):`, response.substring(0, 500));
        throw parseError;
      }

      // Normalize the output
      dialogueOutput = this.normalizeOutput(dialogueOutput, input);

      console.log(`[DialogueSpecialist] Generated ${dialogueOutput.dialogueLines?.length || 0} dialogue lines`);

      // Validate the output
      this.validateOutput(dialogueOutput, input);

      return {
        success: true,
        data: dialogueOutput,
        rawResponse: response,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`[DialogueSpecialist] Error:`, errorMsg);
      return {
        success: false,
        error: errorMsg,
      };
    }
  }

  private normalizeOutput(output: DialogueOutput, input: DialogueSpecialistInput): DialogueOutput {
    // Ensure sceneId
    if (!output.sceneId) {
      output.sceneId = input.sceneId;
    }

    // Ensure dialogueLines is an array
    if (!output.dialogueLines) {
      output.dialogueLines = [];
    } else if (!Array.isArray(output.dialogueLines)) {
      output.dialogueLines = [output.dialogueLines as unknown as DialogueLine];
    }

    // Normalize each dialogue line
    for (const line of output.dialogueLines) {
      if (!line.speakerId) {
        line.speakerId = input.speaker.id;
      }
      if (!line.speakerName) {
        line.speakerName = input.speaker.name;
      }
      if (!line.intent) {
        line.intent = input.dialogueIntent;
      }

      // Ensure variants is an array
      if (!line.variants) {
        line.variants = [];
      } else if (!Array.isArray(line.variants)) {
        line.variants = [line.variants as unknown as DialogueVariant];
      }

      // Normalize each variant
      for (const variant of line.variants) {
        if (!variant.relationshipState) {
          variant.relationshipState = 'neutral';
        }
        if (!variant.text) {
          variant.text = '';
        }
      }
    }

    return output;
  }

  private buildPrompt(input: DialogueSpecialistInput): string {
    const variantsList = input.requestedVariants.join(', ');

    let emotionalContextStr = '';
    if (input.emotionalContext) {
      emotionalContextStr = `
## Emotional Context
- **Primary Emotion**: ${input.emotionalContext.primary}
- **Underlying Emotion**: ${input.emotionalContext.underlying || 'None specified'}
- **Intensity**: ${input.emotionalContext.intensity}
`;
    }

    return `
Generate dialogue variants for the following scene:

## Story Context
- **Title**: ${input.storyContext.title}
- **Genre**: ${input.storyContext.genre}
- **Tone**: ${input.storyContext.tone}

## Scene Context
- **Scene ID**: ${input.sceneId}
- **Mood**: ${input.sceneMood}
- **Description**: ${input.sceneDescription}

## Speaker
- **Name**: ${input.speaker.name} (${input.speaker.id})
- **Personality**: ${input.speaker.personality}
${input.speaker.speakingStyle ? `- **Speaking Style**: ${input.speaker.speakingStyle}` : ''}
${input.speaker.currentEmotionalState ? `- **Current Emotional State**: ${input.speaker.currentEmotionalState}` : ''}

${input.addressee ? `## Addressee
- **Name**: ${input.addressee.name} (${input.addressee.id})
${input.addressee.relationshipToSpeaker ? `- **Relationship to Speaker**: ${input.addressee.relationshipToSpeaker}` : ''}
` : ''}

## Protagonist Reference
- **Name**: ${input.protagonistInfo.name}
- **Pronouns**: ${input.protagonistInfo.pronouns}

## Dialogue Context
- **Intent**: ${input.dialogueIntent}
- **Preceding Context**: ${input.precedingContext}
${input.followingAction ? `- **Following Action**: ${input.followingAction}` : ''}

${emotionalContextStr}

## Required Variants
Generate dialogue variants for these relationship states: ${variantsList}

## Required JSON Structure

{
  "sceneId": "${input.sceneId}",
  "dialogueLines": [
    {
      "speakerId": "${input.speaker.id}",
      "speakerName": "${input.speaker.name}",
      "intent": "${input.dialogueIntent}",
      "variants": [
        {
          "relationshipState": "cold",
          "text": "The actual dialogue line",
          "emotionalSubtext": "What the character is really feeling",
          "deliveryNote": "Stage direction for delivery"
        }
      ],
      "authorNotes": "Design reasoning"
    }
  ],
  "voiceConsistencyNotes": "Notes on maintaining character voice"
}

CRITICAL REQUIREMENTS:
1. Generate variants for ALL requested relationship states: ${variantsList}
2. Each variant should feel genuinely different, not just word substitution
3. Maintain consistent character voice across all variants
4. Include emotional subtext for each variant
5. Include delivery notes to guide presentation
6. Return ONLY valid JSON, no markdown, no extra text
`;
  }

  private validateOutput(output: DialogueOutput, input: DialogueSpecialistInput): void {
    // Check we have dialogue lines
    if (output.dialogueLines.length === 0) {
      throw new Error('Must generate at least one dialogue line');
    }

    // Check each line
    for (const line of output.dialogueLines) {
      if (!line.speakerId || !line.speakerName) {
        throw new Error('Each dialogue line must have speaker information');
      }

      if (line.variants.length === 0) {
        throw new Error('Each dialogue line must have at least one variant');
      }

      // Check that we have all requested variants
      const generatedStates = new Set(line.variants.map(v => v.relationshipState));
      for (const requestedState of input.requestedVariants) {
        if (!generatedStates.has(requestedState)) {
          console.warn(`Missing variant for relationship state: ${requestedState}`);
        }
      }

      // Check variant content
      for (const variant of line.variants) {
        if (!variant.text || variant.text.length < 2) {
          throw new Error(`Dialogue variant text is too short or missing`);
        }
        if (variant.text.length > 500) {
          throw new Error(`Dialogue variant text is too long (max 500 chars)`);
        }
      }
    }
  }
}
