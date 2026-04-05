import { AgentConfig } from '../config';
import { BaseAgent, AgentResponse, AgentMessage } from '../BaseAgent';
import { 
  MOBILE_COMPOSITION_FRAMEWORK, 
  FORBIDDEN_DEFAULTS,
  SHOT_TYPE_SYSTEM,
  CAMERA_ANGLE_SYSTEM,
  BODY_LANGUAGE_VOCABULARY,
  POSE_LINE_OF_ACTION,
  POSE_SILHOUETTE_CLARITY,
  POSE_ASYMMETRY_RULES
} from '../../prompts';

export interface CompositionValidation {
  isValid: boolean;
  score: number; // 0 to 100
  feedback: string;
  ruleViolations: string[];
  // NEW: Pose-specific feedback
  poseAnalysis?: {
    lineOfAction: 'S-curve' | 'C-curve' | 'diagonal' | 'rigid' | 'unclear';
    isAsymmetric: boolean;
    silhouetteReadable: boolean;
    weightDistributionClear: boolean;
    poseIssues: string[];
  };
}

export interface CompositionRequest {
  image: { data: string; mimeType: string };
  shotType: string;
  intendedComposition: string;
}

export class CompositionValidatorAgent extends BaseAgent {
  constructor(config: AgentConfig) {
    super('Composition Validator', config);
  }

  async execute(input: CompositionRequest): Promise<AgentResponse<CompositionValidation>> {
    const messages: AgentMessage[] = [
      {
        role: 'user',
        content: [
          { type: 'text', text: this.buildPrompt(input) },
          { 
            type: 'image', 
            source: { 
              type: 'base64', 
              media_type: input.image.mimeType, 
              data: input.image.data 
            } 
          }
        ]
      }
    ];

    try {
      const response = await this.callLLM(messages);
      const result = this.parseJSON<CompositionValidation>(response);
      return { success: true, data: result, rawResponse: response };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  protected getAgentSpecificPrompt(): string {
    return `
## Your Role: Composition & Pose Validator

You are an expert in mobile cinematography AND character posing. You ensure that generated images meet strict technical and artistic requirements, with special attention to POSE QUALITY.

## Per-Image Validation Checklist

### 1. COMPOSITION
- Primary focal point is NOT dead-center.
- Critical content (faces, key objects, focal action) is in the upper 2/3 of the 9:16 safe zone.
- Bottom 1/3 is suitable for UI overlay (ground plane, shadows, ambient details only).
- Rule of thirds is effectively applied.
- Clear foreground/midground/background depth layers.

### 2. CAMERA & STAGING
- Shot type matches story beat requirements.
- Camera angle (Vertical & Horizontal) supports the emotional register.
- Horizontal staging is NOT just "two people standing and looking at each other" unless justified.
- Angle is NOT defaulting to eye-level without narrative reason.

### 3. POSE ANALYSIS (CRITICAL - CHECK CAREFULLY)
${POSE_LINE_OF_ACTION}
${POSE_ASYMMETRY_RULES}
${POSE_SILHOUETTE_CLARITY}

**Specific Pose Checks**:
- **Line of Action**: Is there a clear S-curve, C-curve, or diagonal through the character's spine? Or is it rigid/vertical?
- **Asymmetry**: Are the arms in different positions? Are the legs different? No mirror-symmetry?
- **Silhouette**: Are limbs separated from the body? Could you recognize the pose as a black silhouette?
- **Weight**: Is weight clearly on one leg, or ambiguously distributed?
- **Static Pose Detection**: Flag if character is "standing straight, arms at sides, facing camera" with no dynamism.

### 4. VISUAL QUALITY
- No major AI artifacts or anatomical errors.
- NO visible text, words, letters, numbers, signs, labels, speech bubbles, captions, watermarks, or signatures in the image. This is a BLOCKING issue. The only exception is when diegetic text is explicitly allowed (e.g., a letter or sign that is part of the story scene). If text is visible and not explicitly allowed, mark isValid: false.
- Clear focal hierarchy (viewer knows where to look first).

${MOBILE_COMPOSITION_FRAMEWORK}
${SHOT_TYPE_SYSTEM}
${CAMERA_ANGLE_SYSTEM}
${BODY_LANGUAGE_VOCABULARY}
${FORBIDDEN_DEFAULTS}

## Output Format
Return a JSON object:
{
  "isValid": boolean,
  "score": number,
  "feedback": "Detailed feedback covering composition, camera, AND pose quality",
  "ruleViolations": ["List of specific rule violations found"],
  "poseAnalysis": {
    "lineOfAction": "S-curve | C-curve | diagonal | rigid | unclear",
    "isAsymmetric": boolean,
    "silhouetteReadable": boolean,
    "weightDistributionClear": boolean,
    "poseIssues": ["specific pose problems like 'arms at sides', 'straight spine', etc."]
  }
}

**IMPORTANT**: A pose with a "rigid" or "unclear" lineOfAction should result in isValid: false.
`;
  }

  private buildPrompt(request: CompositionRequest): string {
    return `
Evaluate the composition and quality of the provided image.

**Intended Shot Type**: ${request.shotType}
**Intended Composition**: ${request.intendedComposition}

Check if it follows the 9:19.5 mobile composition rules and matches the intended vision.
`;
  }
}
