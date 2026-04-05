/**
 * Beat Writer Agent
 *
 * The encounter prose specialist responsible for:
 * - Writing compelling beat content for encounters
 * - Creating text variants for different outcomes (success/failure/complicated)
 * - Ensuring fiction-first presentation of mechanics
 * - Maintaining tension and pacing through prose
 */

import { AgentConfig } from '../config';
import { BaseAgent, AgentResponse } from './BaseAgent';
import { EncounterBeat, EscalationPhase } from './EncounterArchitect';

// Outcome types for beat resolution
export type BeatOutcome = 'full_success' | 'complicated_success' | 'interesting_failure';

// Input types
export interface BeatWriterInput {
  // Story context
  storyContext: {
    title: string;
    genre: string;
    tone: string;
    userPrompt?: string;
  };

  // Scene context
  sceneId: string;
  sceneName: string;
  sceneMood: string;

  // Beat to write
  beat: EncounterBeat;

  // Surrounding context
  previousBeatSummary?: string;
  nextBeatHints?: string[];

  // Protagonist info
  protagonistInfo: {
    name: string;
    pronouns: 'he/him' | 'she/her' | 'they/them';
  };

  // NPCs present
  npcsPresent: Array<{
    id: string;
    name: string;
    pronouns: 'he/him' | 'she/her' | 'they/them';
    description: string;
    currentState?: string;
  }>;

  // Writing guidance
  targetWordCount: {
    setup: number; // Usually 25-40
    outcome: number; // Usually 20-35 per outcome
  };
}

// Output types
export interface BeatTextVariant {
  outcome: BeatOutcome;
  text: string;
  emotionalTone: string;
  visualShotDescription: string; // Detailed visual description for image generation
  transitionHint?: string; // How this leads to the next beat
}

export interface BeatContent {
  beatId: string;
  phase: EscalationPhase;

  // Setup text (shown before challenge)
  setupText: string;
  setupMood: string;

  // Challenge framing (if applicable)
  challengeNarrative?: {
    presentation: string; // How the challenge is described in fiction
    urgencyLevel: 'low' | 'medium' | 'high' | 'critical';
    hiddenMechanics: string; // What's happening mechanically (for debug)
  };

  // Outcome texts
  outcomeVariants: BeatTextVariant[];

  // Sensory details to enhance immersion
  sensoryDetails: {
    visual?: string;
    audio?: string;
    tactile?: string;
    olfactory?: string;
  };

  // Author notes
  authorNotes?: string;
}

export interface BeatWriterOutput {
  sceneId: string;
  beatsContent: BeatContent[];
}

export class BeatWriter extends BaseAgent {
  constructor(config: AgentConfig) {
    super('Beat Writer', config);
    this.includeSystemPrompt = true;
  }

  protected getAgentSpecificPrompt(): string {
    return `
## Your Role: Beat Writer

You write the moment-to-moment prose that brings encounters to life. Your words create tension, deliver payoff, and make players feel the weight of their choices.

## Writing Principles

### Fiction-First Mechanics
- NEVER mention dice, numbers, or game mechanics
- Challenges are described as narrative obstacles
- Difficulty is conveyed through description, not stats
- Outcomes feel like natural story consequences

### Three-Tier Outcomes
Every challenge beat needs three outcome texts:

**FULL SUCCESS**
- Clear victory, goal achieved
- Character feels competent
- Momentum carries forward
- No significant cost

**COMPLICATED SUCCESS**
- Goal achieved BUT...
- Something goes wrong
- A cost is paid
- Victory feels earned, not easy

**INTERESTING FAILURE**
- Goal NOT achieved
- But story moves forward
- Reveals character or information
- Opens new possibilities

### Tension Through Prose

**SETUP Phase**
- Establish the situation clearly
- Build anticipation
- Let player assess before acting
- Use sensory details to ground

**RISING Phase**
- Increase urgency
- Shorter sentences
- Things go wrong
- Stakes become personal

**PEAK Phase**
- Maximum tension
- The critical moment
- Hold breath energy
- Everything matters

**RESOLUTION Phase**
- Release tension
- Consequences manifest
- Emotional processing
- Setup for what's next

## Visual Storyboarding
For every outcome, you must provide a **visualShotDescription**. This is a detailed description of the action, camera angle, and character emotion for image generation.
- **Full Success**: Show character dominance, clear victory, and dynamic action.
- **Complicated Success**: Show the goal achieved but with visible cost or a new threat looming in the background.
- **Interesting Failure**: Show character struggle, a dramatic setback, or a narrow escape.

### Pacing Guidelines (STRICT LIMITS)
- Setup: **STRICT MAX 4 sentences** (Target: 2 short sentences, 25-40 words)
- Each Outcome: **STRICT MAX 2 sentences** (Target: 1-2 short sentences, 20-35 words)
- Vary sentence length for rhythm
- Short sentences = tension
- Longer sentences = reflection (but still brief)
- This is for mobile players - keep it punchy and fast! DO NOT WRITE PARAGRAPHS.
`;
  }

  async execute(input: BeatWriterInput): Promise<AgentResponse<BeatContent>> {
    const prompt = this.buildPrompt(input);

    console.log(`[BeatWriter] Writing content for beat: ${input.beat.id}`);

    try {
      const response = await this.callLLM([
        { role: 'user', content: prompt }
      ]);

      console.log(`[BeatWriter] Received response (${response.length} chars)`);

      let content: BeatContent;
      try {
        content = this.parseJSON<BeatContent>(response);
      } catch (parseError) {
        console.error(`[BeatWriter] JSON parse failed. Raw response (first 500 chars):`, response.substring(0, 500));
        throw parseError;
      }

      // Normalize the output
      content = this.normalizeContent(content, input);

      console.log(`[BeatWriter] Generated content with ${content.outcomeVariants?.length || 0} outcome variants`);

      // Validate the content
      this.validateContent(content, input);

      return {
        success: true,
        data: content,
        rawResponse: response,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`[BeatWriter] Error:`, errorMsg);
      return {
        success: false,
        error: errorMsg,
      };
    }
  }

  private normalizeContent(content: BeatContent, input: BeatWriterInput): BeatContent {
    // Ensure beatId
    if (!content.beatId) {
      content.beatId = input.beat.id;
    }

    // Ensure phase
    if (!content.phase) {
      content.phase = input.beat.phase;
    }

    // Ensure setupText
    if (!content.setupText) {
      content.setupText = input.beat.setupText || '';
    }

    // Ensure setupMood
    if (!content.setupMood) {
      content.setupMood = input.sceneMood;
    }

    // Ensure outcomeVariants is an array
    if (!content.outcomeVariants) {
      content.outcomeVariants = [];
    } else if (!Array.isArray(content.outcomeVariants)) {
      content.outcomeVariants = [content.outcomeVariants as unknown as BeatTextVariant];
    }

    // Ensure each outcome has required fields
    for (const variant of content.outcomeVariants) {
      if (!variant.outcome) {
        variant.outcome = 'full_success';
      }
      if (!variant.text) {
        variant.text = '';
      }
      if (!variant.emotionalTone) {
        variant.emotionalTone = 'neutral';
      }
    }

    // Ensure sensoryDetails exists
    if (!content.sensoryDetails) {
      content.sensoryDetails = {};
    }

    return content;
  }

  private buildPrompt(input: BeatWriterInput): string {
    const npcsList = input.npcsPresent
      .map(npc => `- ${npc.name} (${npc.pronouns}): ${npc.description}${npc.currentState ? ` (currently: ${npc.currentState})` : ''}`)
      .join('\n');

    const challengeInfo = input.beat.challenge
      ? `
## Skill Challenge
- **Primary Skill**: ${input.beat.challenge.primarySkill}
- **Alternate Skills**: ${input.beat.challenge.alternateSkills?.join(', ') || 'None'}
- **Narrative Framing**: ${input.beat.challenge.narrativeFraming}
`
      : '';

    const imageInfo = input.beat.imageSequence
      ? `
## Image Sequence Context
- **Frames**: ${input.beat.imageSequence.frameCount}
- **Key Moments**: ${input.beat.imageSequence.keyframes.map(k => k.description).join('; ')}
`
      : '';

    return `
Write prose content for the following encounter beat:

## Story Context
- **Title**: ${input.storyContext.title}
- **Genre**: ${input.storyContext.genre}
- **Tone**: ${input.storyContext.tone}
${input.storyContext.userPrompt ? `- **User Instructions/Prompt**: ${input.storyContext.userPrompt}\n` : ''}

## Scene Context
- **Scene**: ${input.sceneName} (${input.sceneId})
- **Mood**: ${input.sceneMood}

## Beat Details
- **ID**: ${input.beat.id}
- **Phase**: ${input.beat.phase}
- **Name**: ${input.beat.name}
- **Description**: ${input.beat.description}

${challengeInfo}
${imageInfo}

## Context
${input.previousBeatSummary ? `**Previously**: ${input.previousBeatSummary}` : ''}
${input.nextBeatHints ? `**Coming Next**: ${input.nextBeatHints.join(', ')}` : ''}

## Protagonist
- **Name**: ${input.protagonistInfo.name}
- **Pronouns**: ${input.protagonistInfo.pronouns}

## NPCs Present
${npcsList || 'None'}

## Word Count Targets
- Setup: ~${input.targetWordCount.setup} words
- Each Outcome: ~${input.targetWordCount.outcome} words

## Required JSON Structure

{
  "beatId": "${input.beat.id}",
  "phase": "${input.beat.phase}",
  "setupText": "The prose shown before the challenge",
  "setupMood": "tense/hopeful/dread/etc",
  "challengeNarrative": {
    "presentation": "How the challenge appears in fiction",
    "urgencyLevel": "high",
    "hiddenMechanics": "What's actually being rolled (for debug)"
  },
  "outcomeVariants": [
    {
      "outcome": "full_success",
      "text": "What happens on complete success",
      "emotionalTone": "triumphant",
      "visualShotDescription": "Low-angle dynamic shot of the protagonist overpowering the guard, focused expression, background blurred",
      "transitionHint": "How this leads to next beat"
    },
    {
      "outcome": "complicated_success",
      "text": "What happens on success with cost",
      "emotionalTone": "relieved_but_worried",
      "visualShotDescription": "Medium shot of protagonist grabbing the ledger, but a secondary guard is visible in the doorway behind them",
      "transitionHint": "How this leads to next beat"
    },
    {
      "outcome": "interesting_failure",
      "text": "What happens on failure that moves story forward",
      "emotionalTone": "desperate",
      "visualShotDescription": "Close-up of protagonist's shocked face as the alarm triggers, red emergency lights casting long shadows",
      "transitionHint": "How this leads to next beat"
    }
  ],
  "sensoryDetails": {
    "visual": "What they see",
    "audio": "What they hear",
    "tactile": "What they feel physically",
    "olfactory": "What they smell (if relevant)"
  },
  "authorNotes": "Design reasoning"
}

CRITICAL REQUIREMENTS:
1. Write compelling prose that matches the genre and tone
2. NEVER mention dice, numbers, or game mechanics
3. Include ALL THREE outcome variants (full_success, complicated_success, interesting_failure)
4. Include at least 2 sensory details
5. Setup text should be approximately ${input.targetWordCount.setup} words
6. Each outcome should be approximately ${input.targetWordCount.outcome} words
7. Use ${input.protagonistInfo.pronouns} pronouns for the protagonist
8. Use EXACT names and CORRECT pronouns for ALL characters (NPCs have pronouns listed above). Use he/him or she/her by default — only use they/them for characters explicitly designated as non-binary or transgender.
9. Return ONLY valid JSON, no markdown, no extra text
`;
  }

  private validateContent(content: BeatContent, input: BeatWriterInput): void {
    // Check setup text exists and has reasonable length
    if (!content.setupText || content.setupText.length < 20) {
      throw new Error('Setup text is too short or missing');
    }

    // Check we have outcome variants
    if (content.outcomeVariants.length < 3) {
      console.warn('Beat content has fewer than 3 outcome variants');
    }

    // Check for all three outcome types
    const outcomes = new Set(content.outcomeVariants.map(v => v.outcome));
    const requiredOutcomes: BeatOutcome[] = ['full_success', 'complicated_success', 'interesting_failure'];
    for (const required of requiredOutcomes) {
      if (!outcomes.has(required)) {
        console.warn(`Missing outcome variant: ${required}`);
      }
    }

    // Check outcome texts are not empty
    for (const variant of content.outcomeVariants) {
      if (!variant.text || variant.text.length < 15) {
        throw new Error(`Outcome variant ${variant.outcome} has text that is too short or missing`);
      }
    }

    // Check sensory details exist
    const sensoryCount = Object.values(content.sensoryDetails).filter(v => v && v.length > 0).length;
    if (sensoryCount < 1) {
      console.warn('Beat content has no sensory details');
    }
  }
}
