/**
 * Body Language Validator Agent
 * 
 * QA agent that validates body language in generated images:
 * - No neutral/static poses (banned: arms at sides, straight spine)
 * - Silhouette clarity (reads emotionally as thumbnail)
 * - Body-face agreement (or intentional disagreement for subtext)
 * - Intent-pose alignment
 * - Character body vocabulary consistency
 */

import { AgentConfig } from '../config';
import { BaseAgent, AgentResponse, AgentMessage } from '../BaseAgent';
import { 
  CharacterActingSpec, 
  BodyLanguageSpec,
  SilhouetteGoal
} from './StoryboardAgent';
import {
  CharacterBodyVocabulary,
  BODY_LANGUAGE_PRINCIPLES,
  STATUS_BODY_LANGUAGE,
  SILHOUETTE_RULES
} from './CharacterReferenceSheetAgent';

// ============================================
// VALIDATION INTERFACES
// ============================================

// Single character body language validation
export interface CharacterBodyValidation {
  characterName: string;
  
  // Neutral pose check
  neutralPoseCheck: {
    hasNeutralPose: boolean; // TRUE = VIOLATION
    violations: string[]; // e.g., "arms at sides", "straight spine"
    isAcceptable: boolean;
  };
  
  // Silhouette clarity
  silhouetteCheck: {
    isReadable: boolean;
    headSeparation: boolean;
    handsVisible: boolean;
    limbsStaggered: boolean;
    emotionalRead: string; // What emotion the silhouette conveys
    matchesIntent: boolean;
    issues: string[];
  };
  
  // Body-face agreement
  bodyFaceAgreement: {
    facialExpression: string;
    bodyExpression: string;
    isCongruent: boolean;
    isIntentionalDisagreement: boolean; // For subtext
    subtextRead?: string; // If disagreement, what's the subtext
    issues: string[];
  };
  
  // Intent alignment
  intentAlignment: {
    specifiedIntent?: string;
    observedIntent: string;
    isAligned: boolean;
    issues: string[];
  };
  
  // Body vocabulary consistency (if vocabulary provided)
  vocabularyConsistency?: {
    matchesBasePosture: boolean;
    matchesGestureStyle: boolean;
    usesCharacteristicElements: boolean;
    issues: string[];
  };
  
  // Overall
  overallScore: number;
  isAcceptable: boolean;
  feedback: string;
  issues: string[];
  recommendations: string[];
}

// Full validation report
export interface BodyLanguageValidationReport {
  imageId: string;
  isAcceptable: boolean;
  overallScore: number;
  
  characterValidations: CharacterBodyValidation[];
  
  // Scene-level checks
  sceneComposition: {
    spatialRelationships: string; // How characters relate spatially
    powerDynamic: string; // Who appears dominant
    emotionalDistance: string; // Close, distant, etc.
    isAppropriate: boolean;
    issues: string[];
  };
  
  // Issues and recommendations
  issues: string[];
  recommendations: string[];
  
  needsRegeneration: boolean;
  regenerationGuidance?: string;
}

// Request for body language validation
export interface BodyLanguageValidationRequest {
  imageId: string;
  imageData: string;
  mimeType: string;
  
  // Expected acting specs for characters
  characterSpecs: CharacterActingSpec[];
  
  // Character body vocabularies (for consistency check)
  bodyVocabularies?: Map<string, CharacterBodyVocabulary>;
  
  // Scene context
  sceneContext?: {
    expectedPowerDynamic?: 'balanced' | 'one_dominant' | 'shifting';
    expectedEmotionalDistance?: 'close' | 'neutral' | 'distant';
    isConflictScene?: boolean;
  };
  
  strictMode?: boolean;
}

// Structural validation (no image needed)
export interface BodyLanguageStructuralCheck {
  characterName: string;
  hasBodyLanguageSpec: boolean;
  hasSilhouetteGoal: boolean;
  hasIntentSpecified: boolean;
  bannedElements: string[]; // Any banned neutral pose elements
  issues: string[];
  isValid: boolean;
}

export class BodyLanguageValidator extends BaseAgent {
  constructor(config: AgentConfig) {
    super('Body Language Validator', config);
  }

  async execute(input: BodyLanguageValidationRequest): Promise<AgentResponse<BodyLanguageValidationReport>> {
    console.log(`[BodyLanguageValidator] Validating body language for ${input.characterSpecs.length} characters`);

    const messages: AgentMessage[] = [
      {
        role: 'user',
        content: [
          { type: 'text', text: this.buildVisionAnalysisPrompt(input) },
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: input.mimeType,
              data: input.imageData
            }
          }
        ]
      }
    ];

    try {
      const response = await this.callLLM(messages);
      const report = this.parseJSON<BodyLanguageValidationReport>(response);
      
      report.imageId = input.imageId;
      if (!report.isAcceptable && report.needsRegeneration) {
        report.regenerationGuidance = this.buildRegenerationGuidance(report);
      }

      return { success: true, data: report, rawResponse: response };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  protected getAgentSpecificPrompt(): string {
    return `
## Your Role: Body Language Validator

You analyze images to validate that character body language effectively conveys story and emotion.
Body language is the PRIMARY storytelling channel - every image is a "performance still."

${BODY_LANGUAGE_PRINCIPLES}

${STATUS_BODY_LANGUAGE}

${SILHOUETTE_RULES}

## BANNED POSES (Auto-Fail)
These "neutral" poses kill subtext and must be flagged:
- Arms hanging straight at sides
- Perfectly straight spine with no lean
- Weight evenly distributed (50/50)
- Parallel limbs (both arms same position)
- "Standing puppet" - just standing there with small face change

## REQUIRED ELEMENTS
Every acceptable pose MUST have at least ONE of:
- Lean (forward/back/side)
- Active arm/hand position
- Weight shift to one side
- Head tilt or neck angle

## BODY-FACE AGREEMENT CHECK
- Face and body should tell the same story, OR
- Disagree intentionally to create subtext (e.g., smile but tense body = hiding something)
`;
  }

  private buildVisionAnalysisPrompt(input: BodyLanguageValidationRequest): string {
    const characterSpecs = input.characterSpecs.map(spec => `
### ${spec.characterName}
- **Intent**: ${spec.intent} ${spec.intentDescription ? `(${spec.intentDescription})` : ''}
- **Primary Emotion**: ${spec.primaryEmotion}
- **Secondary Emotion**: ${spec.secondaryEmotion || 'none'}
- **Status**: ${spec.status}
- **Relational Stance**: ${spec.relationalStance}
- **Expected Body Language**:
  - Spine: ${spec.bodyLanguage?.spine || 'not specified'}
  - Shoulders: ${spec.bodyLanguage?.shoulderState || 'not specified'}
  - Arms: ${spec.bodyLanguage?.armPosition || 'not specified'}
  - Hands: ${spec.bodyLanguage?.handState || 'not specified'}
  - Weight: ${spec.bodyLanguage?.weightDistribution || 'not specified'}
${spec.silhouetteGoal ? `- **Silhouette Goal**: ${spec.silhouetteGoal.overallShape} - should read as "${spec.silhouetteGoal.emotionalRead}"` : ''}
`).join('\n');

    return `
Analyze this image for body language effectiveness in visual storytelling.

## Expected Character Acting
${characterSpecs}

## Scene Context
${input.sceneContext ? `
- Expected Power Dynamic: ${input.sceneContext.expectedPowerDynamic || 'not specified'}
- Expected Emotional Distance: ${input.sceneContext.expectedEmotionalDistance || 'not specified'}
- Is Conflict Scene: ${input.sceneContext.isConflictScene || false}
` : 'No specific scene context provided'}

## Analysis Instructions

For EACH visible character:

1. **NEUTRAL POSE CHECK** (CRITICAL)
   - Are arms hanging at sides? (VIOLATION)
   - Is spine perfectly straight with no lean? (VIOLATION)
   - Is weight evenly distributed? (VIOLATION)
   - Are limbs parallel/symmetrical? (VIOLATION)
   - Flag ANY "standing puppet" poses

2. **SILHOUETTE CHECK**
   - Is head clearly separated from torso?
   - Are hands visible (not hidden behind body)?
   - Are limbs staggered (not parallel)?
   - Would the emotion read if this were just a black shape?

3. **BODY-FACE AGREEMENT**
   - What does the face express?
   - What does the body express?
   - Do they agree? If not, is it intentional subtext?

4. **INTENT ALIGNMENT**
   - Does the body language match the specified intent?
   - Does posture match the status (dominant/submissive)?

## Return Format

Return a JSON BodyLanguageValidationReport:
{
  "imageId": "${input.imageId}",
  "isAcceptable": true/false,
  "overallScore": 0-100,
  "characterValidations": [
    {
      "characterName": "string",
      "neutralPoseCheck": {
        "hasNeutralPose": false (true = VIOLATION),
        "violations": ["list of neutral pose elements found"],
        "isAcceptable": true/false
      },
      "silhouetteCheck": {
        "isReadable": true/false,
        "headSeparation": true/false,
        "handsVisible": true/false,
        "limbsStaggered": true/false,
        "emotionalRead": "what emotion the silhouette conveys",
        "matchesIntent": true/false,
        "issues": []
      },
      "bodyFaceAgreement": {
        "facialExpression": "observed facial expression",
        "bodyExpression": "observed body language emotion",
        "isCongruent": true/false,
        "isIntentionalDisagreement": false,
        "subtextRead": "if disagreement, what subtext",
        "issues": []
      },
      "intentAlignment": {
        "specifiedIntent": "the requested intent",
        "observedIntent": "what the pose actually conveys",
        "isAligned": true/false,
        "issues": []
      },
      "overallScore": 0-100,
      "isAcceptable": true/false,
      "feedback": "brief assessment",
      "issues": [],
      "recommendations": []
    }
  ],
  "sceneComposition": {
    "spatialRelationships": "describe how characters relate spatially",
    "powerDynamic": "who appears dominant and why",
    "emotionalDistance": "close/distant/confrontational",
    "isAppropriate": true/false,
    "issues": []
  },
  "issues": ["overall issues"],
  "recommendations": ["how to fix"],
  "needsRegeneration": true/false
}
`;
  }

  private buildRegenerationGuidance(report: BodyLanguageValidationReport): string {
    const guidance: string[] = [];

    for (const cv of report.characterValidations) {
      if (!cv.isAcceptable) {
        // Neutral pose violations
        if (cv.neutralPoseCheck.hasNeutralPose) {
          guidance.push(
            `${cv.characterName}: REMOVE neutral pose. Add: ${
              cv.neutralPoseCheck.violations.includes('arms at sides') ? 'active arm position, ' : ''
            }${cv.neutralPoseCheck.violations.includes('straight spine') ? 'lean or curve to spine, ' : ''
            }${cv.neutralPoseCheck.violations.includes('even weight') ? 'weight shift, ' : ''
            }`.trim().replace(/, $/, '')
          );
        }

        // Silhouette issues
        if (!cv.silhouetteCheck.isReadable) {
          guidance.push(
            `${cv.characterName}: Improve silhouette - ${cv.silhouetteCheck.issues.join(', ')}`
          );
        }

        // Intent misalignment
        if (!cv.intentAlignment.isAligned) {
          guidance.push(
            `${cv.characterName}: Pose shows "${cv.intentAlignment.observedIntent}" but should show "${cv.intentAlignment.specifiedIntent}"`
          );
        }
      }
    }

    return guidance.join('. ') || 'Regenerate with more expressive body language';
  }

  // ==========================================
  // STRUCTURAL VALIDATION (No Image Needed)
  // ==========================================

  /**
   * Validate acting specs structurally before generation
   * Checks for banned neutral pose elements and missing specifications
   */
  validateActingSpecStructure(specs: CharacterActingSpec[]): {
    isValid: boolean;
    characterChecks: BodyLanguageStructuralCheck[];
    issues: string[];
  } {
    const characterChecks: BodyLanguageStructuralCheck[] = [];
    const issues: string[] = [];

    for (const spec of specs) {
      const check: BodyLanguageStructuralCheck = {
        characterName: spec.characterName,
        hasBodyLanguageSpec: !!spec.bodyLanguage,
        hasSilhouetteGoal: !!spec.silhouetteGoal,
        hasIntentSpecified: !!spec.intent,
        bannedElements: [],
        issues: [],
        isValid: true
      };

      // Check for banned neutral pose elements in spec
      if (spec.bodyLanguage) {
        if (spec.bodyLanguage.armPosition === 'at_sides_relaxed') {
          check.bannedElements.push('arms at sides');
          check.issues.push('Arm position "at_sides_relaxed" is banned - specify active arm position');
        }
        if (spec.bodyLanguage.spine === 'upright' && 
            spec.bodyLanguage.weightDistribution === 'centered' &&
            spec.bodyLanguage.shoulderState !== 'raised_tense') {
          check.bannedElements.push('neutral standing pose');
          check.issues.push('Combination of upright spine + centered weight = neutral pose. Add lean, tension, or weight shift');
        }
        if (spec.bodyLanguage.gestureSize === 'none' && spec.bodyLanguage.handState === 'hidden') {
          check.bannedElements.push('no hand visibility');
          check.issues.push('Hands should be visible - they sell emotion');
        }
      } else {
        check.issues.push('No body language specification provided');
      }

      if (!spec.silhouetteGoal) {
        check.issues.push('No silhouette goal - specify what emotion should read as thumbnail');
      }

      if (!spec.intent) {
        check.issues.push('No intent specified - what does this character WANT?');
      }

      check.isValid = check.bannedElements.length === 0 && 
                      check.hasBodyLanguageSpec && 
                      check.hasIntentSpecified;

      if (!check.isValid) {
        issues.push(...check.issues.map(i => `${spec.characterName}: ${i}`));
      }

      characterChecks.push(check);
    }

    return {
      isValid: characterChecks.every(c => c.isValid),
      characterChecks,
      issues
    };
  }

  /**
   * Check if a body language spec would result in a neutral/static pose
   */
  isNeutralPose(bodyLanguage: BodyLanguageSpec): { isNeutral: boolean; reasons: string[] } {
    const reasons: string[] = [];

    // Arms at sides or hidden
    if (bodyLanguage.armPosition === 'at_sides_relaxed') {
      reasons.push('arms at sides');
    }

    // Straight spine with centered weight
    if (bodyLanguage.spine === 'upright' && bodyLanguage.weightDistribution === 'centered') {
      reasons.push('upright spine with centered weight');
    }

    // No gesture or hand action
    if (bodyLanguage.gestureSize === 'none' && bodyLanguage.handState === 'hidden') {
      reasons.push('no visible hand action');
    }

    // Neutral head position
    if (bodyLanguage.headPosition === 'chin_up' && 
        bodyLanguage.gazeDirection === 'direct_contact' &&
        bodyLanguage.neckTension === 'relaxed') {
      // This is actually OK - confident direct engagement
    }

    return {
      isNeutral: reasons.length >= 2, // 2+ neutral elements = neutral pose
      reasons
    };
  }

  /**
   * Suggest improvements for a neutral pose
   */
  suggestPoseImprovements(
    bodyLanguage: BodyLanguageSpec,
    intent: string,
    emotion: string
  ): string[] {
    const suggestions: string[] = [];

    // Based on intent, suggest appropriate body language
    const intentSuggestions: Record<string, string[]> = {
      'convince': ['lean forward', 'open palms gesture', 'direct gaze'],
      'hide_emotion': ['arms crossed or self-contact', 'weight slightly back', 'avoiding full eye contact'],
      'threaten': ['expanded chest', 'weight forward', 'chin down with intense gaze'],
      'withdraw': ['weight back', 'arms protective', 'angled away from target'],
      'comfort': ['reaching gesture', 'soft shoulders', 'slight lean toward other'],
      'confess': ['hunched shoulders', 'head down', 'self-contact gestures']
    };

    const matchingIntent = Object.keys(intentSuggestions).find(i => intent.includes(i));
    if (matchingIntent) {
      suggestions.push(...intentSuggestions[matchingIntent]);
    }

    // Generic improvements based on what's neutral
    if (bodyLanguage.armPosition === 'at_sides_relaxed') {
      suggestions.push('Move arms to active position: gesturing, crossed, on hips, or self-contact');
    }
    if (bodyLanguage.weightDistribution === 'centered') {
      suggestions.push('Shift weight to one foot or add lean');
    }
    if (bodyLanguage.spine === 'upright') {
      suggestions.push('Add curve, lean, or twist to spine');
    }

    return suggestions;
  }
}
