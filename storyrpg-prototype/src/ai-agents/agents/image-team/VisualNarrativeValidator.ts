/**
 * Visual Narrative Validator (Eisner-Inspired QA)
 * 
 * Validates images against Eisner's sequential art principles:
 * - Thumbnail test (focal point readable at small size)
 * - Redundancy check (does beat advance story)
 * - Silent storytelling test (emotional clarity without text)
 * - Eye flow check (composition leads viewer correctly)
 * - Motif consistency
 * - Environment consistency
 */

import { AgentConfig } from '../config';
import { BaseAgent, AgentResponse, AgentMessage } from '../BaseAgent';
import {
  RhythmSpec,
  CompositionFlowSpec,
  ClaritySpec,
  EnvironmentSpec,
  MotifPresence,
  ChoiceTelegraph,
  AdvancementCheck,
  SilentStorytellingTest,
  checkAdvancement,
  runSilentStorytellingTest,
  CLARITY_RULES,
  COMPOSITION_FLOW_RULES,
  SILENT_STORYTELLING_RULES
} from './VisualNarrativeSystem';

// ============================================
// VALIDATION INTERFACES
// ============================================

export interface ThumbnailTestResult {
  // Can you identify the focal character at thumbnail size?
  focalCharacterReadable: boolean;
  // Can you read the main gesture/pose?
  mainGestureReadable: boolean;
  // Is the emotional tone clear?
  emotionalToneClear: boolean;
  // Single clear focal point?
  hasSingleFocalPoint: boolean;
  
  // Issues found
  issues: string[];
  
  // Overall
  passesTest: boolean;
  score: number;
}

export interface EyeFlowValidation {
  // Does eye flow follow expected pattern?
  followsReadingConvention: boolean;
  // Is entry point where expected?
  entryPointCorrect: boolean;
  // Is exit point where expected?
  exitPointCorrect: boolean;
  // Do flow elements (gaze, gesture, light) guide correctly?
  flowElementsEffective: boolean;
  // For choice beats: does composition lead to UI area?
  leadsToUIIfNeeded: boolean;
  
  // Observed flow description
  observedFlowDescription: string;
  
  issues: string[];
  passesTest: boolean;
  score: number;
}

export interface EnvironmentValidation {
  // Does environment match expected personality?
  personalityMatch: boolean;
  observedPersonality: string;
  expectedPersonality: string;
  
  // Does character-environment relation match?
  characterRelationMatch: boolean;
  observedRelation: string;
  
  // Does state of repair match branch/story state?
  stateConsistent: boolean;
  
  issues: string[];
  passesTest: boolean;
  score: number;
}

export interface MotifValidation {
  motifId: string;
  motifName: string;
  
  // Is motif present as expected?
  isPresent: boolean;
  // Is it at the right stage/treatment?
  stageCorrect: boolean;
  observedTreatment: string;
  expectedTreatment: string;
  // Is prominence appropriate?
  prominenceCorrect: boolean;
  
  issues: string[];
  passesTest: boolean;
}

export interface ChoiceTelegraphValidation {
  // For pre-choice: are visual hints appropriate?
  hintsAppropriate: boolean;
  observedHints: string[];
  
  // Is pacing slowed (composition simplified)?
  pacingSlowed: boolean;
  
  // Does composition lead toward UI?
  leadsToUI: boolean;
  
  // For post-choice: is consequence direction visible?
  consequenceSignalClear: boolean;
  observedDirection: 'positive' | 'negative' | 'ambiguous' | 'unclear';
  
  issues: string[];
  passesTest: boolean;
  score: number;
}

export interface VisualNarrativeValidationReport {
  imageId: string;
  beatId?: string;
  
  // Individual validations
  thumbnailTest: ThumbnailTestResult;
  eyeFlowValidation: EyeFlowValidation;
  silentStorytellingTest: SilentStorytellingTest;
  advancementCheck: AdvancementCheck;
  
  // Optional validations (when specs provided)
  environmentValidation?: EnvironmentValidation;
  motifValidations?: MotifValidation[];
  choiceTelegraphValidation?: ChoiceTelegraphValidation;
  
  // Overall
  overallScore: number;
  isAcceptable: boolean;
  
  // Critical issues that require regeneration
  criticalIssues: string[];
  // Warnings (not blocking but worth noting)
  warnings: string[];
  // Suggestions for improvement
  suggestions: string[];
  
  needsRegeneration: boolean;
  regenerationGuidance?: string;
}

export interface VisualNarrativeValidationRequest {
  imageId: string;
  imageData: string;
  mimeType: string;
  
  // Beat specifications
  beatId?: string;
  claritySpec?: ClaritySpec;
  compositionFlow?: CompositionFlowSpec;
  environmentSpec?: EnvironmentSpec;
  motifsExpected?: MotifPresence[];
  choiceTelegraph?: ChoiceTelegraph;
  rhythmSpec?: RhythmSpec;
  
  // Previous beat info for advancement check
  previousBeat?: {
    action: string;
    emotion: string;
    characters?: string[];
  };
  currentBeat?: {
    action: string;
    emotion: string;
    characters?: string[];
  };
  transitionType?: string;
  
  // Context
  storyContext?: {
    characterEmotions?: Array<{ characterName: string; emotion: string }>;
    relationshipDynamic?: string;
    bodyLanguageDescribed?: boolean;
    lightingMoodAligned?: boolean;
  };
}

export class VisualNarrativeValidator extends BaseAgent {
  constructor(config: AgentConfig) {
    super('Visual Narrative Validator', config);
  }

  async execute(input: VisualNarrativeValidationRequest): Promise<AgentResponse<VisualNarrativeValidationReport>> {
    console.log(`[VisualNarrativeValidator] Validating visual narrative for image ${input.imageId}`);

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
      const report = this.parseJSON<VisualNarrativeValidationReport>(response);
      
      report.imageId = input.imageId;
      report.beatId = input.beatId;
      
      // Run structural checks
      if (input.previousBeat && input.currentBeat) {
        report.advancementCheck = checkAdvancement(
          input.currentBeat,
          input.previousBeat,
          input.transitionType
        );
        
        if (report.advancementCheck.isRedundant) {
          report.criticalIssues.push('Beat appears redundant - does not advance story');
        }
      }
      
      // Run silent storytelling test structurally
      if (input.storyContext) {
        const silentTest = runSilentStorytellingTest({
          focalEmotion: input.claritySpec?.focalEmotion,
          characterEmotions: input.storyContext.characterEmotions,
          bodyLanguageDescribed: input.storyContext.bodyLanguageDescribed,
          lightingMoodAligned: input.storyContext.lightingMoodAligned,
          relationshipDynamic: input.storyContext.relationshipDynamic
        });
        
        // Merge with vision-based test
        if (!silentTest.passesTest) {
          report.warnings.push(...(silentTest.recommendations || []));
        }
      }
      
      // Determine regeneration need
      report.needsRegeneration = report.criticalIssues.length > 0 || report.overallScore < 60;
      
      if (report.needsRegeneration) {
        report.regenerationGuidance = this.buildRegenerationGuidance(report);
      }

      return { success: true, data: report, rawResponse: response };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  protected getAgentSpecificPrompt(): string {
    return `
## Your Role: Visual Narrative QA Validator (Eisner-Inspired)

You analyze images against principles from Will Eisner's sequential art theory.
Every image should be deliberate visual narration, not just cool art.

${CLARITY_RULES}

${COMPOSITION_FLOW_RULES}

${SILENT_STORYTELLING_RULES}

## YOUR VALIDATION RULES

### THUMBNAIL TEST (Critical)
Shrink the image mentally to thumbnail size. Can you:
1. Identify the focal character?
2. Read the main gesture/pose?
3. Understand the emotional tone?
4. See ONE clear focal point (not competing elements)?

### EYE FLOW TEST
Does the composition guide the eye correctly?
1. Entry point at expected location (usually top-left/left)?
2. Clear visual path through frame?
3. Exit point toward expected area (bottom-right or toward UI)?
4. No strong distractors pulling eye away from focal point?

### SILENT STORYTELLING TEST
If all text were removed, could viewer understand:
1. Emotional tone of the scene?
2. Relationship dynamic between characters?
3. Whether situation is improving or worsening?

### REDUNDANCY FLAGS
Does this image ADVANCE the story? Valid if it:
- Shows time passing
- Shifts focus to new subject
- Changes location
- Shifts mood/atmosphere
- Reveals new information
- Shows character reaction

INVALID if nothing has changed from previous beat.
`;
  }

  private buildVisionAnalysisPrompt(input: VisualNarrativeValidationRequest): string {
    const claritySection = input.claritySpec ? `
## CLARITY SPECIFICATION
- **Focal Event**: ${input.claritySpec.focalEvent}
- **Focal Emotion**: ${input.claritySpec.focalEmotion}
- **Essential Context**: ${input.claritySpec.essentialContext.join(', ')}
- **Should Read at Thumbnail**: ${input.claritySpec.thumbnailRead}
` : '';

    const compositionSection = input.compositionFlow ? `
## EXPECTED COMPOSITION FLOW
- **Entry Point**: ${input.compositionFlow.entryPoint}
- **Exit Point**: ${input.compositionFlow.exitPoint}
- **Flow Elements**: ${input.compositionFlow.flowElements.join(', ')}
- **Expected Flow**: ${input.compositionFlow.flowDescription}
- **Should Lead to UI**: ${input.compositionFlow.leadsToUI || false}
` : '';

    const environmentSection = input.environmentSpec ? `
## EXPECTED ENVIRONMENT
- **Personality**: ${input.environmentSpec.currentPersonality}
- **Character Relation**: ${input.environmentSpec.characterRelation}
- **State of Repair**: ${input.environmentSpec.characteristics.stateOfRepair}
- **Narrative Function**: ${input.environmentSpec.narrativeFunction}
` : '';

    const motifsSection = input.motifsExpected && input.motifsExpected.length > 0 ? `
## EXPECTED MOTIFS
${input.motifsExpected.map(m => `- **${m.motifId}**: Stage "${m.currentStage}", ${m.prominence} prominence, in ${m.placement}`).join('\n')}
` : '';

    const choiceSection = input.choiceTelegraph ? `
## CHOICE TELEGRAPH CONTEXT
- **Is Pre-Choice**: ${input.choiceTelegraph.isPreChoice}
- **Is Post-Choice**: ${input.choiceTelegraph.isPostChoice}
${input.choiceTelegraph.optionHints ? `- **Expected Hints**: ${input.choiceTelegraph.optionHints.map(h => `${h.optionType}: ${h.visualHint}`).join(', ')}` : ''}
${input.choiceTelegraph.choiceProximityTreatment ? `- **Expected Treatment**: Slow down, simplify, focus on acting, lead to UI` : ''}
` : '';

    return `
Analyze this image for VISUAL NARRATIVE effectiveness using Eisner's principles.

${claritySection}
${compositionSection}
${environmentSection}
${motifsSection}
${choiceSection}

## ANALYSIS INSTRUCTIONS

### 1. THUMBNAIL TEST
Look at the image and imagine it at thumbnail size:
- Can you identify the focal character clearly?
- Is the main gesture/pose readable?
- Is the emotional tone obvious?
- Is there ONE clear focal point, or are multiple elements competing?

### 2. EYE FLOW VALIDATION
Trace how your eye moves through the image:
- Where does your eye enter? (Should be top-left/left for Western reading)
- What path does it follow?
- Where does it exit?
- Are there distracting elements pulling attention away from the focus?

### 3. SILENT STORYTELLING TEST
Ignore any text and assess:
- Is the emotional tone clear from visuals alone?
- Can you understand character relationships from body language and positioning?
- Can you tell if things are getting better or worse?

### 4. ENVIRONMENT CHECK (if spec provided)
- Does the environment feel like the expected personality?
- Does it relate to characters as expected (dwarf/frame/match/elevate)?

### 5. MOTIF CHECK (if motifs specified)
- Are expected motifs present?
- Are they at the right stage/treatment?
- Is their prominence appropriate?

### 6. CHOICE TELEGRAPH CHECK (if near a choice)
- For pre-choice: Is composition simplified? Does it lead toward UI area?
- For post-choice: Is consequence direction (positive/negative) visually clear?

## RETURN FORMAT

Return a JSON VisualNarrativeValidationReport:
{
  "imageId": "${input.imageId}",
  "thumbnailTest": {
    "focalCharacterReadable": true/false,
    "mainGestureReadable": true/false,
    "emotionalToneClear": true/false,
    "hasSingleFocalPoint": true/false,
    "issues": ["any issues found"],
    "passesTest": true/false,
    "score": 0-100
  },
  "eyeFlowValidation": {
    "followsReadingConvention": true/false,
    "entryPointCorrect": true/false,
    "exitPointCorrect": true/false,
    "flowElementsEffective": true/false,
    "leadsToUIIfNeeded": true/false,
    "observedFlowDescription": "How eye actually moves through frame",
    "issues": [],
    "passesTest": true/false,
    "score": 0-100
  },
  "silentStorytellingTest": {
    "emotionalToneClear": true/false,
    "relationshipDynamicClear": true/false,
    "situationDirectionClear": true/false,
    "unclearElements": ["anything unclear without text"],
    "recommendations": ["how to improve"],
    "passesTest": true/false
  },
  "advancementCheck": {
    "advancementType": "time|focus|space|aspect|revelation|reaction|consequence|none",
    "whatAdvanced": "description",
    "isRedundant": false
  },
  ${input.environmentSpec ? `"environmentValidation": {
    "personalityMatch": true/false,
    "observedPersonality": "what you perceive",
    "expectedPersonality": "${input.environmentSpec.currentPersonality}",
    "characterRelationMatch": true/false,
    "observedRelation": "what you perceive",
    "stateConsistent": true/false,
    "issues": [],
    "passesTest": true/false,
    "score": 0-100
  },` : ''}
  ${input.motifsExpected && input.motifsExpected.length > 0 ? `"motifValidations": [
    {
      "motifId": "id",
      "motifName": "name",
      "isPresent": true/false,
      "stageCorrect": true/false,
      "observedTreatment": "what you see",
      "expectedTreatment": "what was expected",
      "prominenceCorrect": true/false,
      "issues": [],
      "passesTest": true/false
    }
  ],` : ''}
  ${input.choiceTelegraph ? `"choiceTelegraphValidation": {
    "hintsAppropriate": true/false,
    "observedHints": ["what visual hints you see"],
    "pacingSlowed": true/false,
    "leadsToUI": true/false,
    "consequenceSignalClear": true/false,
    "observedDirection": "positive|negative|ambiguous|unclear",
    "issues": [],
    "passesTest": true/false,
    "score": 0-100
  },` : ''}
  "overallScore": 0-100,
  "isAcceptable": true/false (score >= 70),
  "criticalIssues": ["issues requiring regeneration"],
  "warnings": ["notable but not blocking issues"],
  "suggestions": ["improvement suggestions"],
  "needsRegeneration": true/false
}
`;
  }

  private buildRegenerationGuidance(report: VisualNarrativeValidationReport): string {
    const guidance: string[] = [];

    // Thumbnail test failures
    if (!report.thumbnailTest.passesTest) {
      if (!report.thumbnailTest.focalCharacterReadable) {
        guidance.push('Increase contrast/size of focal character');
      }
      if (!report.thumbnailTest.hasSingleFocalPoint) {
        guidance.push('Simplify composition to single clear focal point');
      }
      if (!report.thumbnailTest.emotionalToneClear) {
        guidance.push('Strengthen emotional expression in pose and lighting');
      }
    }

    // Eye flow failures
    if (!report.eyeFlowValidation.passesTest) {
      guidance.push(`Adjust composition: ${report.eyeFlowValidation.issues.join(', ')}`);
    }

    // Silent storytelling failures
    if (!report.silentStorytellingTest.passesTest) {
      guidance.push('Enhance visual storytelling: ' + (report.silentStorytellingTest.recommendations?.join(', ') || 'improve emotional clarity'));
    }

    // Redundancy
    if (report.advancementCheck?.isRedundant) {
      guidance.push('Add visual change to advance story: new pose, new focus, or new information');
    }

    // Environment mismatch
    if (report.environmentValidation && !report.environmentValidation.passesTest) {
      guidance.push(`Adjust environment to feel more "${report.environmentValidation.expectedPersonality}"`);
    }

    // Choice telegraph issues
    if (report.choiceTelegraphValidation && !report.choiceTelegraphValidation.passesTest) {
      guidance.push('For choice beat: simplify composition, lead eye toward UI area');
    }

    return guidance.join('. ') || 'Regenerate with clearer visual storytelling';
  }

  // ==========================================
  // STRUCTURAL VALIDATION (No Image Needed)
  // ==========================================

  /**
   * Validate beat specifications structurally before generation
   */
  validateBeatSpecStructure(spec: {
    claritySpec?: ClaritySpec;
    compositionFlow?: CompositionFlowSpec;
    rhythmSpec?: RhythmSpec;
    environmentSpec?: EnvironmentSpec;
  }): { isValid: boolean; issues: string[]; warnings: string[] } {
    const issues: string[] = [];
    const warnings: string[] = [];

    // Clarity spec validation
    if (!spec.claritySpec) {
      issues.push('Missing clarity spec (focalEvent, focalEmotion, essentialContext)');
    } else {
      if (!spec.claritySpec.focalEvent) issues.push('Missing focalEvent');
      if (!spec.claritySpec.focalEmotion) issues.push('Missing focalEmotion');
      if (!spec.claritySpec.essentialContext || spec.claritySpec.essentialContext.length === 0) {
        warnings.push('No essentialContext specified');
      }
      if (!spec.claritySpec.thumbnailRead) {
        warnings.push('No thumbnailRead description');
      }
    }

    // Composition flow validation
    if (!spec.compositionFlow) {
      warnings.push('Missing composition flow spec');
    } else {
      if (!spec.compositionFlow.flowDescription) {
        warnings.push('Missing flow description');
      }
    }

    // Rhythm spec validation
    if (spec.rhythmSpec) {
      // Check for pre-choice with wrong settings
      if (spec.rhythmSpec.isPreChoice) {
        if (spec.rhythmSpec.informationDensity === 'busy' || spec.rhythmSpec.informationDensity === 'dense') {
          issues.push('Pre-choice beat should not have busy/dense information density');
        }
        if (spec.rhythmSpec.changeMagnitude === 'large' || spec.rhythmSpec.changeMagnitude === 'total') {
          warnings.push('Pre-choice beat should have smaller change magnitude (micro/small)');
        }
      }
    }

    return {
      isValid: issues.length === 0,
      issues,
      warnings
    };
  }

  /**
   * Check advancement between beats structurally
   */
  checkBeatAdvancement(
    currentBeat: { action: string; emotion: string },
    previousBeat?: { action: string; emotion: string },
    transitionType?: string
  ): AdvancementCheck {
    return checkAdvancement(currentBeat, previousBeat, transitionType);
  }

  /**
   * Validate rhythm appropriateness for beat context
   */
  validateRhythmForContext(
    rhythm: RhythmSpec,
    context: {
      isPreChoice?: boolean;
      isPostChoice?: boolean;
      isClimactic?: boolean;
      isResolution?: boolean;
    }
  ): { isAppropriate: boolean; suggestions: string[] } {
    const suggestions: string[] = [];

    // Pre-choice should be slow
    if (context.isPreChoice) {
      if (rhythm.changeMagnitude !== 'micro' && rhythm.changeMagnitude !== 'small') {
        suggestions.push('Pre-choice beat should have micro/small change magnitude');
      }
      if (rhythm.informationDensity !== 'minimal' && rhythm.informationDensity !== 'sparse') {
        suggestions.push('Pre-choice beat should have minimal/sparse density');
      }
      if (rhythm.role !== 'build' && rhythm.role !== 'breather') {
        suggestions.push('Pre-choice beat should be build or breather role');
      }
    }

    // Post-choice should be resolution/processing
    if (context.isPostChoice) {
      if (rhythm.role !== 'resolution' && rhythm.role !== 'breather') {
        suggestions.push('Post-choice beat should be resolution or breather');
      }
    }

    // Climactic should be spike
    if (context.isClimactic) {
      if (rhythm.role !== 'spike') {
        suggestions.push('Climactic beat should have spike rhythm role');
      }
    }

    // Resolution should be calmer
    if (context.isResolution) {
      if (rhythm.role !== 'resolution' && rhythm.role !== 'breather') {
        suggestions.push('Resolution beat should have resolution or breather role');
      }
      if (rhythm.changeMagnitude === 'large' || rhythm.changeMagnitude === 'total') {
        suggestions.push('Resolution beat should have smaller change magnitude');
      }
    }

    return {
      isAppropriate: suggestions.length === 0,
      suggestions
    };
  }
}
