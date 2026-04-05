/**
 * Expression Validator Agent
 * 
 * QA agent that validates whether generated images display the correct
 * expressions for each character based on the story beat requirements.
 * 
 * Uses vision analysis to check:
 * - Each character's expression matches their specified emotion
 * - The 3 key landmarks (eyebrows, eyelids, mouth) are correctly rendered
 * - Characters don't all have the same expression when they shouldn't
 */

import { AgentConfig } from '../config';
import { BaseAgent, AgentResponse, AgentMessage } from '../BaseAgent';
import { CharacterEmotion } from './StoryboardAgent';
import { IMAGE_VALIDATION_DEFAULTS } from '../../../constants/validation';
import {
  EXPRESSION_LIBRARY,
  EXPRESSION_LANDMARKS,
  EXPRESSION_PACING_RULES,
  ExpressionName,
  findExpressionForEmotion,
  getEmotionalDistance,
  isExtremeExpression,
  suggestTransitionPath,
  EXTREME_EXPRESSIONS
} from './CharacterReferenceSheetAgent';

// Validation result for a single character's expression
export interface CharacterExpressionValidation {
  characterName: string;
  expectedEmotion: string;
  expectedExpression?: ExpressionName;
  intensity: 'subtle' | 'moderate' | 'intense';
  
  // 3 Key Landmarks validation
  landmarks: {
    eyebrows: {
      expected: string;
      observed: string;
      isCorrect: boolean;
    };
    eyelids: {
      expected: string;
      observed: string;
      isCorrect: boolean;
    };
    mouth: {
      expected: string;
      observed: string;
      isCorrect: boolean;
    };
  };
  
  // Overall assessment
  expressionIsCorrect: boolean;
  expressionScore: number; // 0-100
  feedback: string;
  issues: string[];
}

// Full validation report for an image
export interface ExpressionValidationReport {
  imageId: string;
  isAcceptable: boolean;
  overallScore: number;
  
  // Per-character validation
  characterValidations: CharacterExpressionValidation[];
  
  // Multi-character consistency
  diversityCheck: {
    allSameExpression: boolean;
    shouldBeSame: boolean;
    isAppropriate: boolean;
  };
  
  // Flagged issues
  issues: string[];
  recommendations: string[];
  
  // Should this image be regenerated?
  needsRegeneration: boolean;
  regenerationGuidance?: string;
}

// Request for expression validation
export interface ExpressionValidationRequest {
  imageId: string;
  imageData: string;        // Base64 encoded image
  mimeType: string;
  
  // Expected character emotions
  characterEmotions: CharacterEmotion[];
  
  // Overall beat mood (for context)
  overallMood?: string;
  
  // Should all characters have same expression?
  expectSameExpression?: boolean;
  
  // Strictness
  strictMode?: boolean;
}

// ============================================
// EXPRESSION PACING VALIDATION
// ============================================

// Emotional transition between shots
export interface EmotionalTransition {
  characterName: string;
  fromShotId: string;
  toShotId: string;
  fromEmotion: ExpressionName;
  toEmotion: ExpressionName;
  emotionalDistance: number;
  isJarring: boolean;
  suggestedIntermediates?: ExpressionName[];
}

// Extreme expression usage tracking
export interface ExtremeExpressionUsage {
  expression: ExpressionName;
  shotId: string;
  characterName: string;
  count: number; // How many times used in scene
}

// Full pacing validation report
export interface ExpressionPacingReport {
  isAcceptable: boolean;
  overallScore: number;
  
  // Extreme expression analysis
  extremeUsage: {
    totalExtremeCount: number;
    maxAllowed: number;
    isOverused: boolean;
    usage: ExtremeExpressionUsage[];
    issues: string[];
  };
  
  // Transition analysis
  transitions: {
    jarringTransitions: EmotionalTransition[];
    smoothTransitions: number;
    totalTransitions: number;
    issues: string[];
  };
  
  // Per-character emotional arc
  characterArcs: Map<string, {
    emotions: ExpressionName[];
    hasGradualProgression: boolean;
    issues: string[];
  }>;
  
  // Overall issues and recommendations
  issues: string[];
  recommendations: string[];
}

// Request for pacing validation (across multiple shots)
export interface ExpressionPacingRequest {
  // Shots with their character emotions
  shots: Array<{
    shotId: string;
    characterEmotions: CharacterEmotion[];
  }>;
  
  // Scene context
  sceneType?: 'action' | 'dialogue' | 'emotional' | 'climax';
  isNarrativePeak?: boolean; // Climax moment where extremes are OK
  
  // Strictness
  strictMode?: boolean;
}

export class ExpressionValidator extends BaseAgent {
  constructor(config: AgentConfig) {
    super('Expression Validator', config);
  }

  async execute(input: ExpressionValidationRequest): Promise<AgentResponse<ExpressionValidationReport>> {
    console.log(`[ExpressionValidator] Validating expressions for ${input.characterEmotions.length} characters`);

    // Build the vision analysis prompt
    const analysisPrompt = this.buildVisionAnalysisPrompt(input);

    // Call LLM with vision capabilities
    const messages: AgentMessage[] = [
      {
        role: 'user',
        content: [
          { type: 'text', text: analysisPrompt },
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
      const report = this.parseJSON<ExpressionValidationReport>(response);
      
      // Post-process to add regeneration guidance
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
## Your Role: Expression Validator

You analyze images to verify that character expressions match the intended emotions.
You are an expert at reading facial expressions, focusing on the 3 KEY LANDMARKS.

${EXPRESSION_LANDMARKS}

## Expression Recognition Patterns

When analyzing an expression, identify:

1. **EYEBROWS** - What position are they in?
   - Raised high → surprise, fear
   - Furrowed/lowered → anger, focus
   - Inner corners raised → sadness
   - One raised → skepticism, confusion
   - Relaxed → neutral, calm

2. **EYELIDS** - How open are they?
   - Wide open → surprise, fear, alertness
   - Narrowed → anger, suspicion, focus
   - Half-lidded → tired, bored, seductive, arrogant
   - Squeezed shut → pain, grief, laughter
   - Normal → neutral, calm

3. **MOUTH** - What shape is it?
   - Open wide → screaming, laughing, shock
   - Closed/pressed → quiet anger, determination
   - Corners up → happy, pleased, smug
   - Corners down → sad, disgusted, disappointed
   - Asymmetric → smirk, skepticism

## Multi-Character Analysis

When multiple characters are visible:
- Analyze EACH character separately
- Note if expressions are inappropriately identical
- Characters in conflict should have OPPOSING expressions
- Only shared moments (celebration, shared shock) justify same expressions
`;
  }

  private buildVisionAnalysisPrompt(input: ExpressionValidationRequest): string {
    // Build expected expressions with landmarks for each character
    const expectedExpressions = input.characterEmotions.map(ce => {
      const expressionName = ce.expressionName || findExpressionForEmotion(ce.emotion);
      const expressionDef = EXPRESSION_LIBRARY.find(e => e.name === expressionName);
      
      return `
### ${ce.characterName}
- **Expected Emotion**: ${ce.emotion} (${ce.intensity})
- **Expression Type**: ${expressionName}
${ce.reason ? `- **Context**: ${ce.reason}` : ''}
**Expected 3 Key Landmarks**:
- EYEBROWS: ${ce.eyebrows || expressionDef?.eyebrows || 'infer from emotion'}
- EYELIDS: ${ce.eyelids || expressionDef?.eyelids || 'infer from emotion'}
- MOUTH: ${ce.mouth || expressionDef?.mouth || 'infer from emotion'}`;
    }).join('\n');

    return `
Analyze this image and validate that each character's expression matches their expected emotion.

## Characters to Validate
${expectedExpressions}

## Overall Scene Context
- **Overall Mood**: ${input.overallMood || 'Not specified'}
- **Should expressions be identical?**: ${input.expectSameExpression ? 'Yes - shared moment' : 'No - characters may feel differently'}
${input.strictMode ? '- **STRICT MODE**: Minor deviations should be flagged' : ''}

## Analysis Instructions

For EACH visible character:
1. Identify the character in the image
2. Observe their EYEBROWS (position, shape)
3. Observe their EYELIDS (openness level)
4. Observe their MOUTH (shape, corners, open/closed)
5. Compare to expected landmarks
6. Score accuracy (0-100)

## Return Format

Return a JSON ExpressionValidationReport:
{
  "imageId": "${input.imageId}",
  "isAcceptable": true/false (true if overall score >= 70),
  "overallScore": 0-100,
  "characterValidations": [
    {
      "characterName": "string",
      "expectedEmotion": "string",
      "expectedExpression": "expression name",
      "intensity": "subtle | moderate | intense",
      "landmarks": {
        "eyebrows": {
          "expected": "what was requested",
          "observed": "what you actually see in the image",
          "isCorrect": true/false
        },
        "eyelids": {
          "expected": "what was requested",
          "observed": "what you actually see",
          "isCorrect": true/false
        },
        "mouth": {
          "expected": "what was requested",
          "observed": "what you actually see",
          "isCorrect": true/false
        }
      },
      "expressionIsCorrect": true/false,
      "expressionScore": 0-100,
      "feedback": "Brief assessment of this character's expression",
      "issues": ["List of specific problems if any"]
    }
  ],
  "diversityCheck": {
    "allSameExpression": true/false (are all characters showing same expression?),
    "shouldBeSame": ${input.expectSameExpression || false},
    "isAppropriate": true/false (is expression diversity appropriate for the scene?)
  },
  "issues": ["List of overall issues"],
  "recommendations": ["How to fix issues"],
  "needsRegeneration": true/false (should this image be regenerated?)
}
`;
  }

  private buildRegenerationGuidance(report: ExpressionValidationReport): string {
    const guidance: string[] = [];

    // Add character-specific guidance
    for (const cv of report.characterValidations) {
      if (!cv.expressionIsCorrect) {
        const fixes: string[] = [];
        
        if (!cv.landmarks.eyebrows.isCorrect) {
          fixes.push(`eyebrows should be ${cv.landmarks.eyebrows.expected} (not ${cv.landmarks.eyebrows.observed})`);
        }
        if (!cv.landmarks.eyelids.isCorrect) {
          fixes.push(`eyelids should be ${cv.landmarks.eyelids.expected} (not ${cv.landmarks.eyelids.observed})`);
        }
        if (!cv.landmarks.mouth.isCorrect) {
          fixes.push(`mouth should be ${cv.landmarks.mouth.expected} (not ${cv.landmarks.mouth.observed})`);
        }
        
        if (fixes.length > 0) {
          guidance.push(`${cv.characterName}: ${fixes.join(', ')}`);
        }
      }
    }

    // Add diversity guidance
    if (!report.diversityCheck.isAppropriate) {
      if (report.diversityCheck.allSameExpression && !report.diversityCheck.shouldBeSame) {
        guidance.push('Characters should have DIFFERENT expressions - they are not all feeling the same emotion');
      }
    }

    return guidance.join('. ') || 'Regenerate with correct expressions';
  }

  /**
   * Quick validation without vision (structural check only)
   */
  validateStructure(characterEmotions: CharacterEmotion[]): {
    isValid: boolean;
    issues: string[];
  } {
    const issues: string[] = [];

    // Check that emotions are specified
    for (const ce of characterEmotions) {
      if (!ce.emotion) {
        issues.push(`${ce.characterName}: No emotion specified`);
      }
      if (!ce.eyebrows && !ce.eyelids && !ce.mouth) {
        issues.push(`${ce.characterName}: No landmark specifications - expressions may not render correctly`);
      }
    }

    // Check for inappropriate uniformity
    if (characterEmotions.length > 1) {
      const emotions = characterEmotions.map(ce => ce.emotion.toLowerCase());
      const uniqueEmotions = new Set(emotions);
      if (uniqueEmotions.size === 1 && characterEmotions.length > 2) {
        issues.push(`Warning: All ${characterEmotions.length} characters have same emotion "${emotions[0]}" - is this intentional?`);
      }
    }

    return {
      isValid: issues.filter(i => !i.startsWith('Warning')).length === 0,
      issues
    };
  }

  // ==========================================
  // EXPRESSION PACING VALIDATION
  // ==========================================

  /**
   * Validate expression pacing across a sequence of shots
   * Checks for:
   * - Overuse of extreme expressions
   * - Jarring emotional transitions
   * - Gradual progression
   */
  validateExpressionPacing(request: ExpressionPacingRequest): ExpressionPacingReport {
    console.log(`[ExpressionValidator] Validating expression pacing across ${request.shots.length} shots`);
    
    const issues: string[] = [];
    const recommendations: string[] = [];

    // 1. Track extreme expression usage
    const extremeUsage = this.analyzeExtremeUsage(request.shots, request.isNarrativePeak);
    if (extremeUsage.isOverused) {
      issues.push(...extremeUsage.issues);
      recommendations.push('Reserve extreme expressions (rage, terror, grief, pain, hollow) for true narrative peaks');
    }

    // 2. Analyze emotional transitions for each character
    const transitions = this.analyzeEmotionalTransitions(request.shots);
    if (transitions.jarringTransitions.length > 0) {
      issues.push(...transitions.issues);
      for (const jt of transitions.jarringTransitions) {
        if (jt.suggestedIntermediates && jt.suggestedIntermediates.length > 0) {
          recommendations.push(
            `${jt.characterName}: Add intermediate emotion(s) [${jt.suggestedIntermediates.join(' → ')}] ` +
            `between ${jt.fromEmotion} and ${jt.toEmotion}`
          );
        }
      }
    }

    // 3. Build character emotional arcs
    const characterArcs = this.buildCharacterArcs(request.shots);

    // Calculate overall score
    const extremeScore = extremeUsage.isOverused ? 50 : 100;
    const transitionScore = transitions.totalTransitions > 0
      ? Math.round((transitions.smoothTransitions / transitions.totalTransitions) * 100)
      : 100;
    const overallScore = Math.round((extremeScore + transitionScore) / 2);

    return {
      isAcceptable: overallScore >= 70 && issues.filter(i => !i.startsWith('Warning')).length === 0,
      overallScore,
      extremeUsage,
      transitions,
      characterArcs,
      issues,
      recommendations
    };
  }

  /**
   * Analyze extreme expression usage
   */
  private analyzeExtremeUsage(
    shots: ExpressionPacingRequest['shots'],
    isNarrativePeak?: boolean
  ): ExpressionPacingReport['extremeUsage'] {
    const usage: ExtremeExpressionUsage[] = [];
    const extremeCount = new Map<ExpressionName, number>();
    const issues: string[] = [];

    // Count extreme expressions
    for (const shot of shots) {
      for (const ce of shot.characterEmotions) {
        const expression = (ce.expressionName || findExpressionForEmotion(ce.emotion)) as ExpressionName;
        
        if (isExtremeExpression(expression)) {
          const count = (extremeCount.get(expression) || 0) + 1;
          extremeCount.set(expression, count);
          
          usage.push({
            expression,
            shotId: shot.shotId,
            characterName: ce.characterName,
            count
          });
        }
      }
    }

    // Check for overuse (caps from IMAGE_VALIDATION_DEFAULTS)
    const totalExtremeCount = usage.length;
    const maxAllowed = isNarrativePeak
      ? IMAGE_VALIDATION_DEFAULTS.maxExtremeExpressionsAtPeak
      : IMAGE_VALIDATION_DEFAULTS.maxExtremeExpressionsStandard;
    const isOverused = totalExtremeCount > maxAllowed;

    if (isOverused) {
      issues.push(
        `Extreme expressions overused: ${totalExtremeCount} found (max ${maxAllowed} recommended). ` +
        `This will desensitize readers and reduce emotional impact.`
      );
    }

    // Check for consecutive same extreme
    for (let i = 1; i < shots.length; i++) {
      const prevShot = shots[i - 1];
      const currShot = shots[i];
      
      for (const ce of currShot.characterEmotions) {
        const currExpr = (ce.expressionName || findExpressionForEmotion(ce.emotion)) as ExpressionName;
        if (!isExtremeExpression(currExpr)) continue;
        
        const prevCe = prevShot.characterEmotions.find(p => p.characterName === ce.characterName);
        if (prevCe) {
          const prevExpr = (prevCe.expressionName || findExpressionForEmotion(prevCe.emotion)) as ExpressionName;
          if (prevExpr === currExpr && isExtremeExpression(prevExpr)) {
            issues.push(
              `Warning: ${ce.characterName} has same extreme expression "${currExpr}" in consecutive shots. ` +
              `Consider varying intensity or adding recovery beat.`
            );
          }
        }
      }
    }

    return {
      totalExtremeCount,
      maxAllowed,
      isOverused,
      usage,
      issues
    };
  }

  /**
   * Analyze emotional transitions between shots
   */
  private analyzeEmotionalTransitions(
    shots: ExpressionPacingRequest['shots']
  ): ExpressionPacingReport['transitions'] {
    const jarringTransitions: EmotionalTransition[] = [];
    const issues: string[] = [];
    let smoothTransitions = 0;
    let totalTransitions = 0;

    // For each consecutive pair of shots
    for (let i = 1; i < shots.length; i++) {
      const prevShot = shots[i - 1];
      const currShot = shots[i];

      // Check each character that appears in both shots
      for (const ce of currShot.characterEmotions) {
        const prevCe = prevShot.characterEmotions.find(p => p.characterName === ce.characterName);
        if (!prevCe) continue; // Character not in previous shot

        const fromExpr = (prevCe.expressionName || findExpressionForEmotion(prevCe.emotion)) as ExpressionName;
        const toExpr = (ce.expressionName || findExpressionForEmotion(ce.emotion)) as ExpressionName;
        
        if (fromExpr === toExpr) continue; // Same expression, no transition

        totalTransitions++;
        const distance = getEmotionalDistance(fromExpr, toExpr);
        const isJarring = distance >= 4; // 4+ is considered jarring

        if (isJarring) {
          const intermediates = suggestTransitionPath(fromExpr, toExpr);
          
          jarringTransitions.push({
            characterName: ce.characterName,
            fromShotId: prevShot.shotId,
            toShotId: currShot.shotId,
            fromEmotion: fromExpr,
            toEmotion: toExpr,
            emotionalDistance: distance,
            isJarring: true,
            suggestedIntermediates: intermediates
          });

          issues.push(
            `Jarring emotional transition for ${ce.characterName}: ${fromExpr} → ${toExpr} ` +
            `(distance: ${distance}). Consider intermediate emotional beats.`
          );
        } else {
          smoothTransitions++;
        }
      }
    }

    return {
      jarringTransitions,
      smoothTransitions,
      totalTransitions,
      issues
    };
  }

  /**
   * Build emotional arcs for each character
   */
  private buildCharacterArcs(
    shots: ExpressionPacingRequest['shots']
  ): Map<string, { emotions: ExpressionName[]; hasGradualProgression: boolean; issues: string[] }> {
    const arcs = new Map<string, { emotions: ExpressionName[]; hasGradualProgression: boolean; issues: string[] }>();

    // Collect emotions per character
    const characterEmotions = new Map<string, ExpressionName[]>();
    
    for (const shot of shots) {
      for (const ce of shot.characterEmotions) {
        const expr = (ce.expressionName || findExpressionForEmotion(ce.emotion)) as ExpressionName;
        const existing = characterEmotions.get(ce.characterName) || [];
        existing.push(expr);
        characterEmotions.set(ce.characterName, existing);
      }
    }

    // Analyze each character's arc
    for (const [name, emotions] of characterEmotions.entries()) {
      const issues: string[] = [];
      let hasGradualProgression = true;

      // Check for jarring jumps
      for (let i = 1; i < emotions.length; i++) {
        const distance = getEmotionalDistance(emotions[i - 1], emotions[i]);
        if (distance >= 4) {
          hasGradualProgression = false;
          issues.push(`Jump from ${emotions[i - 1]} to ${emotions[i]} is too abrupt`);
        }
      }

      arcs.set(name, { emotions, hasGradualProgression, issues });
    }

    return arcs;
  }

  /**
   * Quick check for a single emotional transition
   */
  checkTransition(
    characterName: string,
    fromEmotion: string,
    toEmotion: string
  ): { isSmooth: boolean; distance: number; suggestion?: string } {
    const from = findExpressionForEmotion(fromEmotion);
    const to = findExpressionForEmotion(toEmotion);
    const distance = getEmotionalDistance(from, to);
    
    if (distance < 4) {
      return { isSmooth: true, distance };
    }

    const intermediates = suggestTransitionPath(from, to);
    return {
      isSmooth: false,
      distance,
      suggestion: intermediates.length > 0
        ? `Add intermediate beat(s): ${from} → ${intermediates.join(' → ')} → ${to}`
        : `Consider adding a neutral beat between ${from} and ${to}`
    };
  }
}
