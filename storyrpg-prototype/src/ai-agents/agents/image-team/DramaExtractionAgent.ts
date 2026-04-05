/**
 * Drama Extraction Agent
 *
 * Analyzes story beats to extract the dramatic core for image generation:
 * - Peak moment of tension (not the whole scene)
 * - Physical manifestations of emotion per character
 * - Spatial relationships (who's advancing/retreating)
 * - Asymmetric body language suggestions
 *
 * This agent runs BEFORE VisualIllustratorAgent to ensure prompts
 * contain specific, actionable dramatic details.
 */

import { AgentConfig } from '../config';
import { BaseAgent, AgentResponse } from '../BaseAgent';

// ============================================
// INPUT/OUTPUT INTERFACES
// ============================================

export interface DramaExtractionRequest {
  beatId: string;
  beatText: string;

  // Scene context
  sceneContext: {
    sceneName: string;
    genre: string;
    tone: string;
    mood: string;
  };

  // Characters in this beat
  characters: Array<{
    id: string;
    name: string;
    role: 'protagonist' | 'antagonist' | 'ally' | 'neutral' | 'love_interest';
    personality?: string;
    currentMood?: string;
  }>;

  // Visual contract from SceneWriter (if available)
  visualContract?: {
    visualMoment?: string;
    primaryAction?: string;
    emotionalRead?: string;
    relationshipDynamic?: string;
  };

  // Context from surrounding beats
  previousBeatSummary?: string;
  nextBeatSummary?: string;

  // Is this a choice payoff beat?
  isChoicePayoff?: boolean;
  choiceContext?: string;
}

export interface CharacterPhysicalManifestation {
  characterName: string;
  face: string;           // "jaw tightens, eyes narrow, brow furrows"
  hands: string;          // "fingers curl into fists, knuckles white"
  body: string;           // "weight shifts forward, shoulders square, spine rigid"
  spatialIntent: 'advancing' | 'retreating' | 'holding_ground' | 'circling' | 'frozen';
  weight: string;         // "forward on balls of feet" | "back on heels" | "planted firmly"
  tension: 'high' | 'medium' | 'low' | 'coiled';
}

export interface DramaExtraction {
  beatId: string;

  // The single most dramatic instant
  peakMoment: string;           // "The instant Marcus realizes she lied"
  peakMomentVisual: string;     // "Marcus's face transforms from confusion to betrayal"

  // Per-character physical manifestations
  physicalManifestations: CharacterPhysicalManifestation[];

  // Scene-level dynamics
  sceneAsymmetry: string;       // "Marcus advances while Elena retreats"
  powerDynamic: 'balanced' | 'aggressor_defender' | 'dominant_submissive' | 'shifting';
  emotionalPolarity: string;    // "One character hot (anger), other cold (fear)"

  // Cinematic direction
  cinematicBeat: string;        // "The confrontation beat - one accuser, one accused"
  suggestedCamera: {
    angle: string;              // "Low angle on aggressor, eye-level on defender"
    focus: string;              // "Sharp focus on hands, soft on background"
    composition: string;        // "Rule of thirds - aggressor left, defender right, space between them"
  };

  // Environmental interaction suggestions
  environmentInteraction?: string;  // "Hand gripping table edge, back against wall"

  // The moment of change (if applicable)
  momentOfChange?: string;      // "Mid-recoil", "Hand freezing mid-reach", "Eyes widening"

  // Confidence score
  confidence: number;           // 0-100
}

export class DramaExtractionAgent extends BaseAgent {
  constructor(config: AgentConfig) {
    super('Drama Extraction Agent', config);
    this.includeSystemPrompt = true;
  }

  async execute(input: DramaExtractionRequest): Promise<AgentResponse<DramaExtraction>> {
    const prompt = this.buildExtractionPrompt(input);

    try {
      const response = await this.callLLM([{ role: 'user', content: prompt }]);
      const extraction = this.parseJSON<DramaExtraction>(response);

      extraction.beatId = input.beatId;

      // Ensure we have at least basic physical manifestations
      if (!extraction.physicalManifestations || extraction.physicalManifestations.length === 0) {
        extraction.physicalManifestations = this.generateFallbackManifestations(input);
      }

      return { success: true, data: extraction, rawResponse: response };
    } catch (error) {
      console.warn(`[DramaExtractionAgent] Extraction failed, using fallback: ${error}`);
      // Return fallback extraction on failure
      return {
        success: true,
        data: this.generateFallbackExtraction(input),
        rawResponse: ''
      };
    }
  }

  protected getAgentSpecificPrompt(): string {
    return `
## Your Role: Drama Extraction Agent

You analyze story beats to extract the DRAMATIC CORE for visual image generation.
Your job is to find the SINGLE MOST CINEMATIC INSTANT in each beat and describe
exactly how it would look as a freeze-frame from a film.

### KEY PRINCIPLE: Find the PEAK MOMENT
Every beat has one instant of maximum dramatic tension. Your job is to identify it:
- NOT "they argued" but "the instant his hand slammed the table"
- NOT "she was sad" but "the moment her composure cracked and her lip trembled"
- NOT "tension between them" but "she stepped back, creating distance he immediately closed"

### PHYSICAL MANIFESTATION (Critical)
For each character, describe SPECIFIC PHYSICAL DETAILS:

**FACE**: Use anatomical precision
- YES: "jaw clenched, temples tight, nostrils flared"
- NO: "angry expression"

**HANDS**: What are they DOING?
- YES: "fingers curled into white-knuckled fists, one hand half-raised"
- NO: "tense hands"

**BODY**: Weight, posture, spatial intent
- YES: "weight forward on balls of feet, shoulders squared, spine coiled for action"
- NO: "aggressive stance"

**SPATIAL INTENT**: What is each body TRYING to do?
- Advancing: closing distance, leaning in, moving forward
- Retreating: creating distance, leaning away, stepping back
- Holding ground: planted firmly, refusing to yield space
- Circling: lateral movement, positioning for advantage
- Frozen: caught mid-action, paralyzed by emotion

### ASYMMETRY IS ESSENTIAL
Two characters should NEVER mirror each other:
- One advances, one retreats
- One expanded, one contracted
- One hot emotion, one cold
- One in control, one losing control

### MOMENT OF CHANGE
The best image captures TRANSITION, not stasis:
- "Mid-recoil" not "recoiled"
- "Hand freezing mid-reach" not "stopped"
- "Eyes widening" not "wide eyes"
- "Weight shifting" not "shifted weight"

### OUTPUT FORMAT
Return a JSON DramaExtraction object with all fields filled with specific, visual details.
`;
  }

  private buildExtractionPrompt(input: DramaExtractionRequest): string {
    const characterInfo = input.characters.map(c =>
      `- **${c.name}** (${c.role}): ${c.personality || 'No personality specified'}. Current mood: ${c.currentMood || 'unspecified'}`
    ).join('\n');

    const visualContract = input.visualContract ? `
## Existing Visual Contract (Use as baseline, enhance with physical detail)
- Visual Moment: ${input.visualContract.visualMoment || 'Not specified'}
- Primary Action: ${input.visualContract.primaryAction || 'Not specified'}
- Emotional Read: ${input.visualContract.emotionalRead || 'Not specified'}
- Relationship Dynamic: ${input.visualContract.relationshipDynamic || 'Not specified'}
` : '';

    const beatContext = (input.previousBeatSummary || input.nextBeatSummary) ? `
## Beat Context
${input.previousBeatSummary ? `- Just before: ${input.previousBeatSummary}` : ''}
${input.nextBeatSummary ? `- Coming next: ${input.nextBeatSummary}` : ''}
` : '';

    const choicePayoff = input.isChoicePayoff ? `
## CHOICE PAYOFF (Critical)
The player chose: "${input.choiceContext}"
This image MUST show the physical result of that choice playing out.
` : '';

    return `
Analyze this story beat and extract the dramatic core for image generation.

## Beat Text
"${input.beatText}"

## Scene Context
- Scene: ${input.sceneContext.sceneName}
- Genre: ${input.sceneContext.genre}
- Tone: ${input.sceneContext.tone}
- Mood: ${input.sceneContext.mood}

## Characters in Beat
${characterInfo}
${visualContract}
${beatContext}
${choicePayoff}

## Your Task
1. Identify the SINGLE PEAK MOMENT of dramatic tension
2. Describe PHYSICAL MANIFESTATIONS for each character (face, hands, body, spatial intent)
3. Define the ASYMMETRY between characters
4. Suggest CAMERA direction to capture the drama
5. Note any ENVIRONMENTAL INTERACTION opportunities

Return a complete DramaExtraction JSON object:
{
  "beatId": "${input.beatId}",
  "peakMoment": "One sentence describing the exact instant of maximum tension",
  "peakMomentVisual": "What you would SEE in that instant, in cinematic terms",
  "physicalManifestations": [
    {
      "characterName": "Name",
      "face": "Specific facial anatomy details",
      "hands": "What hands are doing",
      "body": "Posture, weight, spine, shoulders",
      "spatialIntent": "advancing|retreating|holding_ground|circling|frozen",
      "weight": "Where weight is distributed",
      "tension": "high|medium|low|coiled"
    }
  ],
  "sceneAsymmetry": "How the characters contrast with each other physically",
  "powerDynamic": "balanced|aggressor_defender|dominant_submissive|shifting",
  "emotionalPolarity": "The emotional contrast between characters",
  "cinematicBeat": "Film-grammar description of this moment type",
  "suggestedCamera": {
    "angle": "Camera angle recommendation",
    "focus": "Focus/depth of field recommendation",
    "composition": "Framing/composition recommendation"
  },
  "environmentInteraction": "How characters might interact with environment",
  "momentOfChange": "The specific transition being captured (mid-X)",
  "confidence": 85
}
`;
  }

  private generateFallbackManifestations(input: DramaExtractionRequest): CharacterPhysicalManifestation[] {
    return input.characters.map(char => ({
      characterName: char.name,
      face: 'Expression reflecting the emotional weight of the moment — not neutral, not blank',
      hands: 'Hands engaged in meaningful gesture or gripping something',
      body: 'Weight shifted to one side, asymmetric stance, posture reflecting emotional state',
      spatialIntent: 'holding_ground' as const,
      weight: 'Shifted to one foot, not evenly distributed',
      tension: 'medium' as const
    }));
  }

  private generateFallbackExtraction(input: DramaExtractionRequest): DramaExtraction {
    const charNames = input.characters.map(c => c.name);
    const firstChar = charNames[0] || 'Character';
    const secondChar = charNames[1] || '';

    return {
      beatId: input.beatId,
      peakMoment: input.visualContract?.visualMoment || `${firstChar} in moment of dramatic tension`,
      peakMomentVisual: input.visualContract?.primaryAction || `${firstChar}'s body language reveals inner conflict`,
      physicalManifestations: this.generateFallbackManifestations(input),
      sceneAsymmetry: secondChar
        ? `${firstChar} and ${secondChar} in contrasting postures — one more guarded, one more open`
        : `${firstChar} caught between impulses — body shows internal conflict`,
      powerDynamic: 'balanced',
      emotionalPolarity: input.visualContract?.emotionalRead || 'Visible emotional intensity',
      cinematicBeat: 'Character moment — internal state externalized through body language',
      suggestedCamera: {
        angle: 'Medium shot, slightly off-center for visual interest',
        focus: 'Sharp focus on foreground characters, environmental context in background',
        composition: 'Rule of thirds, character(s) positioned with breathing room in direction of gaze or movement'
      },
      environmentInteraction: 'Character interacting with nearby surface or object for grounding',
      momentOfChange: 'Mid-action, caught in transition rather than static pose',
      confidence: 50
    };
  }
}
