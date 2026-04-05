/**
 * Lighting and Color Validator Agent
 * 
 * QA agent that validates lighting and color in generated images:
 * - Does lighting match the mood spec?
 * - Does color palette match the story beat?
 * - Is lighting direction appropriate for the emotion?
 * - Are branch-specific adjustments applied?
 */

import { AgentConfig } from '../config';
import { BaseAgent, AgentResponse, AgentMessage } from '../BaseAgent';
import {
  MoodSpec,
  LightDirection,
  LightQuality,
  LightTemperature,
  ContrastLevel,
  PaletteSaturation,
  ValueKey,
  ColorScript,
  ColorScriptBeat,
  LIGHTING_DIRECTION_GUIDE,
  COLOR_TEMPERATURE_GUIDE,
  validateMoodForBeat
} from './LightingColorSystem';

// ============================================
// VALIDATION INTERFACES
// ============================================

export interface LightingValidation {
  // Direction check
  directionCheck: {
    expected: LightDirection;
    observed: string;
    isCorrect: boolean;
    issue?: string;
  };
  
  // Quality check
  qualityCheck: {
    expected: LightQuality;
    observed: string;
    isCorrect: boolean;
    issue?: string;
  };
  
  // Temperature check
  temperatureCheck: {
    expectedKey: LightTemperature;
    expectedFill: LightTemperature;
    observedOverall: string;
    isCorrect: boolean;
    issue?: string;
  };
  
  // Contrast check
  contrastCheck: {
    expected: ContrastLevel;
    observed: string;
    isCorrect: boolean;
    issue?: string;
  };
  
  // Overall
  isAcceptable: boolean;
  score: number;
  issues: string[];
}

export interface ColorValidation {
  // Palette check
  paletteCheck: {
    expectedHues: string[];
    observedHues: string[];
    matchScore: number; // 0-100
    isCorrect: boolean;
    issue?: string;
  };
  
  // Saturation check
  saturationCheck: {
    expected: PaletteSaturation;
    observed: string;
    isCorrect: boolean;
    issue?: string;
  };
  
  // Value key check
  valueKeyCheck: {
    expected: ValueKey;
    observed: string;
    isCorrect: boolean;
    issue?: string;
  };
  
  // POV filter check (if applicable)
  povFilterCheck?: {
    expected: string;
    observed: string;
    isApplied: boolean;
    issue?: string;
  };
  
  // Overall
  isAcceptable: boolean;
  score: number;
  issues: string[];
}

export interface MoodAlignmentCheck {
  // Does the visual feel match the intended emotion?
  emotionMatch: {
    intendedEmotion: string;
    perceivedEmotion: string;
    isAligned: boolean;
    confidence: number;
  };
  
  // Intensity alignment
  intensityMatch: {
    intendedIntensity: string;
    perceivedIntensity: string;
    isAligned: boolean;
  };
  
  // Valence alignment
  valenceMatch: {
    intendedValence: string;
    perceivedValence: string;
    isAligned: boolean;
  };
}

export interface LightingColorValidationReport {
  imageId: string;
  beatId?: string;
  
  lightingValidation: LightingValidation;
  colorValidation: ColorValidation;
  moodAlignment: MoodAlignmentCheck;
  
  // Color script consistency (if script provided)
  colorScriptConsistency?: {
    matchesBeatSpec: boolean;
    matchesOverallArc: boolean;
    issues: string[];
  };
  
  // Overall
  overallScore: number;
  isAcceptable: boolean;
  
  issues: string[];
  recommendations: string[];
  
  needsRegeneration: boolean;
  regenerationGuidance?: string;
}

export interface LightingColorValidationRequest {
  imageId: string;
  imageData: string;
  mimeType: string;
  
  // The mood specification to validate against
  moodSpec: MoodSpec;
  
  // Optional: color script for arc consistency checking
  colorScript?: ColorScript;
  beatId?: string;
  
  // Context
  beatContext?: {
    isClimactic?: boolean;
    isResolution?: boolean;
    isFlashback?: boolean;
    isNightmare?: boolean;
    isSafeHubScene?: boolean;
    branchType?: 'dark' | 'hopeful' | 'neutral';
  };
  
  strictMode?: boolean;
}

export class LightingColorValidator extends BaseAgent {
  constructor(config: AgentConfig) {
    super('Lighting/Color Validator', config);
  }

  async execute(input: LightingColorValidationRequest): Promise<AgentResponse<LightingColorValidationReport>> {
    console.log(`[LightingColorValidator] Validating lighting/color for image ${input.imageId}`);

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
      const report = this.parseJSON<LightingColorValidationReport>(response);
      
      report.imageId = input.imageId;
      report.beatId = input.beatId;
      
      // Add context validation
      if (input.beatContext) {
        const contextValidation = validateMoodForBeat(input.moodSpec, input.beatContext);
        if (!contextValidation.isValid) {
          report.issues.push(...contextValidation.issues);
          report.recommendations.push(...contextValidation.suggestions);
        }
      }
      
      // Check color script consistency
      if (input.colorScript && input.beatId) {
        report.colorScriptConsistency = this.checkColorScriptConsistency(
          report, 
          input.colorScript, 
          input.beatId
        );
      }
      
      // Determine if regeneration needed
      if (!report.isAcceptable || report.overallScore < 60) {
        report.needsRegeneration = true;
        report.regenerationGuidance = this.buildRegenerationGuidance(report, input.moodSpec);
      }

      return { success: true, data: report, rawResponse: response };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  protected getAgentSpecificPrompt(): string {
    return `
## Your Role: Lighting & Color QA Validator

You analyze images to validate that lighting and color correctly convey the intended mood.
Lighting and color are STORY SYSTEMS - they encode emotional arc, not just aesthetics.

${LIGHTING_DIRECTION_GUIDE}

${COLOR_TEMPERATURE_GUIDE}

## YOUR VALIDATION RULES

### LIGHTING DIRECTION
- **Top lighting**: Should feel neutral, realistic, everyday
- **Side lighting**: Should feel dramatic, conflicted, "two sides" visible
- **Backlighting**: Should feel mysterious, awe-inspiring, or isolating
- **Under-lighting**: Should feel eerie, unnatural, horror-adjacent

### LIGHT QUALITY
- **Soft**: Gentle shadows = safe, nostalgic, peaceful
- **Hard**: Sharp shadows = dangerous, urgent, dramatic

### COLOR TEMPERATURE
- **Warm**: Human, intimate, hopeful
- **Cool**: Sterile, lonely, alien, clinical

### COLOR PALETTE
- Check if dominant colors match the spec
- Check if saturation level matches (muted vs vivid)
- Check if value key matches (high-key bright vs low-key dark)

### MOOD ALIGNMENT
- Does the FEELING of the image match the intended emotion?
- Would a viewer correctly guess the mood without context?
`;
  }

  private buildVisionAnalysisPrompt(input: LightingColorValidationRequest): string {
    const { moodSpec } = input;
    
    return `
Analyze this image for LIGHTING AND COLOR accuracy against the mood specification.

## EXPECTED MOOD SPECIFICATION

### Lighting Requirements
- **Direction**: ${moodSpec.lighting.direction} ${moodSpec.lighting.directionDescription ? `(${moodSpec.lighting.directionDescription})` : ''}
- **Quality**: ${moodSpec.lighting.quality}
- **Key Light Temperature**: ${moodSpec.lighting.keyLightTemp}
- **Fill Light Temperature**: ${moodSpec.lighting.fillLightTemp}
- **Contrast Level**: ${moodSpec.lighting.contrastLevel}
- **Narrative Reason**: ${moodSpec.lighting.narrativeReason}

### Color Requirements
- **Primary Hues**: ${moodSpec.color.primaryHues.join(', ')}
- **Accent**: ${moodSpec.color.accentHue || 'none specified'}
- **Saturation**: ${moodSpec.color.saturation}
- **Value Key**: ${moodSpec.color.valueKey}
- **POV Filter**: ${moodSpec.color.povFilter}
- **Narrative Reason**: ${moodSpec.color.narrativeReason}

### Emotional Target
- **Emotion**: ${moodSpec.emotion}
- **Intensity**: ${moodSpec.intensity}
- **Valence**: ${moodSpec.valence}

${moodSpec.comparedToPrevious ? `
### Compared to Previous Beat
- Calmer/More Intense: ${moodSpec.comparedToPrevious.isCalmerOrMoreIntense}
- Warmer/Colder: ${moodSpec.comparedToPrevious.isWarmerOrColder}
- Safer/More Dangerous: ${moodSpec.comparedToPrevious.isSaferOrMoreDangerous}
` : ''}

## ANALYSIS INSTRUCTIONS

Analyze the image and validate:

1. **LIGHTING**
   - What is the primary light direction? Does it match "${moodSpec.lighting.direction}"?
   - Are shadows soft or hard? Does it match "${moodSpec.lighting.quality}"?
   - Is the light warm, neutral, or cool? Does it match "${moodSpec.lighting.keyLightTemp}"?
   - What is the contrast level? Does it match "${moodSpec.lighting.contrastLevel}"?

2. **COLOR**
   - What are the dominant colors? Do they match "${moodSpec.color.primaryHues.join(', ')}"?
   - Is the saturation muted, normal, or vivid? Does it match "${moodSpec.color.saturation}"?
   - Is the overall image bright (high-key) or dark (low-key)? Does it match "${moodSpec.color.valueKey}"?
   - If POV filter expected (${moodSpec.color.povFilter}), is it visible?

3. **MOOD ALIGNMENT**
   - What emotion does this image convey?
   - What intensity level does it feel like?
   - Is the overall feeling positive, negative, or ambiguous?
   - Does the visual feeling match the intended "${moodSpec.emotion}" at "${moodSpec.intensity}" intensity?

## RETURN FORMAT

Return a JSON LightingColorValidationReport:
{
  "imageId": "${input.imageId}",
  "lightingValidation": {
    "directionCheck": {
      "expected": "${moodSpec.lighting.direction}",
      "observed": "what you see",
      "isCorrect": true/false,
      "issue": "description if incorrect"
    },
    "qualityCheck": {
      "expected": "${moodSpec.lighting.quality}",
      "observed": "what you see",
      "isCorrect": true/false,
      "issue": "description if incorrect"
    },
    "temperatureCheck": {
      "expectedKey": "${moodSpec.lighting.keyLightTemp}",
      "expectedFill": "${moodSpec.lighting.fillLightTemp}",
      "observedOverall": "what you see",
      "isCorrect": true/false,
      "issue": "description if incorrect"
    },
    "contrastCheck": {
      "expected": "${moodSpec.lighting.contrastLevel}",
      "observed": "what you see",
      "isCorrect": true/false,
      "issue": "description if incorrect"
    },
    "isAcceptable": true/false,
    "score": 0-100,
    "issues": []
  },
  "colorValidation": {
    "paletteCheck": {
      "expectedHues": ${JSON.stringify(moodSpec.color.primaryHues)},
      "observedHues": ["what you see"],
      "matchScore": 0-100,
      "isCorrect": true/false,
      "issue": "description if incorrect"
    },
    "saturationCheck": {
      "expected": "${moodSpec.color.saturation}",
      "observed": "what you see",
      "isCorrect": true/false,
      "issue": "description if incorrect"
    },
    "valueKeyCheck": {
      "expected": "${moodSpec.color.valueKey}",
      "observed": "what you see",
      "isCorrect": true/false,
      "issue": "description if incorrect"
    },
    ${moodSpec.color.povFilter !== 'none' ? `"povFilterCheck": {
      "expected": "${moodSpec.color.povFilter}",
      "observed": "what you see",
      "isApplied": true/false,
      "issue": "description if not applied"
    },` : ''}
    "isAcceptable": true/false,
    "score": 0-100,
    "issues": []
  },
  "moodAlignment": {
    "emotionMatch": {
      "intendedEmotion": "${moodSpec.emotion}",
      "perceivedEmotion": "what you perceive",
      "isAligned": true/false,
      "confidence": 0-100
    },
    "intensityMatch": {
      "intendedIntensity": "${moodSpec.intensity}",
      "perceivedIntensity": "what you perceive",
      "isAligned": true/false
    },
    "valenceMatch": {
      "intendedValence": "${moodSpec.valence}",
      "perceivedValence": "what you perceive",
      "isAligned": true/false
    }
  },
  "overallScore": 0-100,
  "isAcceptable": true/false (score >= 70),
  "issues": ["list of all issues"],
  "recommendations": ["how to fix"],
  "needsRegeneration": true/false
}
`;
  }

  private checkColorScriptConsistency(
    report: LightingColorValidationReport,
    colorScript: ColorScript,
    beatId: string
  ): { matchesBeatSpec: boolean; matchesOverallArc: boolean; issues: string[] } {
    const issues: string[] = [];
    const beat = colorScript.beats.find(b => b.beatId === beatId);
    
    if (!beat) {
      return { matchesBeatSpec: false, matchesOverallArc: false, issues: ['Beat not found in color script'] };
    }

    // Check beat spec match
    const paletteMatch = report.colorValidation.paletteCheck.matchScore >= 60;
    const saturationMatch = report.colorValidation.saturationCheck.isCorrect;
    const valueKeyMatch = report.colorValidation.valueKeyCheck.isCorrect;
    const lightDirMatch = report.lightingValidation.directionCheck.isCorrect;
    const lightTempMatch = report.lightingValidation.temperatureCheck.isCorrect;

    const matchesBeatSpec = paletteMatch && saturationMatch && valueKeyMatch && lightDirMatch && lightTempMatch;

    if (!matchesBeatSpec) {
      if (!paletteMatch) issues.push(`Color palette doesn't match beat spec (${beat.dominantHues.join(', ')})`);
      if (!saturationMatch) issues.push(`Saturation doesn't match beat spec (${beat.saturation})`);
      if (!lightDirMatch) issues.push(`Light direction doesn't match beat spec (${beat.lightDirection})`);
    }

    // Check arc consistency (simplified - just verify it's not wildly different from neighbors)
    const beatIndex = colorScript.beats.findIndex(b => b.beatId === beatId);
    let matchesOverallArc = true;

    if (beatIndex > 0) {
      const prevBeat = colorScript.beats[beatIndex - 1];
      // If previous beat was low-key and this is high-key without being a resolution, might be inconsistent
      if (prevBeat.valueKey === 'low_key' && beat.valueKey === 'high_key' && 
          report.colorValidation.valueKeyCheck.observed === 'high_key') {
        // This is fine if intended
      }
    }

    return { matchesBeatSpec, matchesOverallArc, issues };
  }

  private buildRegenerationGuidance(report: LightingColorValidationReport, moodSpec: MoodSpec): string {
    const guidance: string[] = [];

    // Lighting issues
    if (!report.lightingValidation.directionCheck.isCorrect) {
      guidance.push(`Change lighting to ${moodSpec.lighting.direction} direction`);
    }
    if (!report.lightingValidation.temperatureCheck.isCorrect) {
      guidance.push(`Use ${moodSpec.lighting.keyLightTemp} temperature light`);
    }
    if (!report.lightingValidation.contrastCheck.isCorrect) {
      guidance.push(`Adjust to ${moodSpec.lighting.contrastLevel} contrast`);
    }

    // Color issues
    if (!report.colorValidation.paletteCheck.isCorrect) {
      guidance.push(`Use ${moodSpec.color.primaryHues.join(' and ')} color palette`);
    }
    if (!report.colorValidation.saturationCheck.isCorrect) {
      guidance.push(`Adjust saturation to ${moodSpec.color.saturation}`);
    }
    if (!report.colorValidation.valueKeyCheck.isCorrect) {
      guidance.push(`Make image ${moodSpec.color.valueKey === 'high_key' ? 'brighter' : 'darker'}`);
    }

    // Mood issues
    if (!report.moodAlignment.emotionMatch.isAligned) {
      guidance.push(`Image should feel more "${moodSpec.emotion}" - currently reads as "${report.moodAlignment.emotionMatch.perceivedEmotion}"`);
    }

    return guidance.join('. ') || 'Regenerate with correct lighting and color as specified';
  }

  // ==========================================
  // STRUCTURAL VALIDATION (No Image Needed)
  // ==========================================

  /**
   * Validate mood spec is properly formed and appropriate
   */
  validateMoodSpecStructure(moodSpec: MoodSpec): {
    isValid: boolean;
    issues: string[];
    warnings: string[];
  } {
    const issues: string[] = [];
    const warnings: string[] = [];

    // Check required fields
    if (!moodSpec.emotion) issues.push('Missing emotion');
    if (!moodSpec.intensity) issues.push('Missing intensity');
    if (!moodSpec.valence) issues.push('Missing valence');
    if (!moodSpec.lighting) issues.push('Missing lighting spec');
    if (!moodSpec.color) issues.push('Missing color spec');

    // Check lighting coherence
    if (moodSpec.lighting) {
      if (!moodSpec.lighting.direction) issues.push('Missing light direction');
      if (!moodSpec.lighting.quality) issues.push('Missing light quality');
      if (!moodSpec.lighting.keyLightTemp) issues.push('Missing key light temperature');
      if (!moodSpec.lighting.narrativeReason) warnings.push('Missing lighting narrative reason');

      // Warn about under-lighting overuse
      if (moodSpec.lighting.direction === 'under' && moodSpec.intensity !== 'peak') {
        warnings.push('Under-lighting should be reserved for peak intensity horror/nightmare scenes');
      }
    }

    // Check color coherence
    if (moodSpec.color) {
      if (!moodSpec.color.primaryHues || moodSpec.color.primaryHues.length === 0) {
        issues.push('Missing primary hues');
      }
      if (!moodSpec.color.saturation) issues.push('Missing saturation level');
      if (!moodSpec.color.valueKey) issues.push('Missing value key');
      if (!moodSpec.color.narrativeReason) warnings.push('Missing color narrative reason');
    }

    return {
      isValid: issues.length === 0,
      issues,
      warnings
    };
  }

  /**
   * Check if mood spec is consistent with color script beat
   */
  checkMoodVsColorScript(moodSpec: MoodSpec, colorScriptBeat: ColorScriptBeat): {
    isConsistent: boolean;
    discrepancies: string[];
  } {
    const discrepancies: string[] = [];

    // Check emotion match
    if (moodSpec.emotion !== colorScriptBeat.emotion) {
      discrepancies.push(`Emotion mismatch: spec has "${moodSpec.emotion}", color script has "${colorScriptBeat.emotion}"`);
    }

    // Check intensity match
    if (moodSpec.intensity !== colorScriptBeat.intensity) {
      discrepancies.push(`Intensity mismatch: spec has "${moodSpec.intensity}", color script has "${colorScriptBeat.intensity}"`);
    }

    // Check light direction match
    if (moodSpec.lighting.direction !== colorScriptBeat.lightDirection) {
      discrepancies.push(`Light direction mismatch: spec has "${moodSpec.lighting.direction}", color script has "${colorScriptBeat.lightDirection}"`);
    }

    // Check light temperature match
    if (moodSpec.lighting.keyLightTemp !== colorScriptBeat.lightTemp) {
      discrepancies.push(`Light temperature mismatch: spec has "${moodSpec.lighting.keyLightTemp}", color script has "${colorScriptBeat.lightTemp}"`);
    }

    // Check saturation match
    if (moodSpec.color.saturation !== colorScriptBeat.saturation) {
      discrepancies.push(`Saturation mismatch: spec has "${moodSpec.color.saturation}", color script has "${colorScriptBeat.saturation}"`);
    }

    // Check value key match
    if (moodSpec.color.valueKey !== colorScriptBeat.valueKey) {
      discrepancies.push(`Value key mismatch: spec has "${moodSpec.color.valueKey}", color script has "${colorScriptBeat.valueKey}"`);
    }

    return {
      isConsistent: discrepancies.length === 0,
      discrepancies
    };
  }
}
