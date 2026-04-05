/**
 * Transition Validator Agent
 * 
 * Validates that panel transitions between images follow the specified rules:
 * - Continuity elements are properly preserved based on transition type
 * - Changes are appropriate for the transition type
 * - Visual storytelling rhythm makes sense for the narrative
 * 
 * Can work with:
 * - Image pairs (vision model comparison)
 * - Prompt pairs (structural analysis)
 * - VisualPlan analysis (before generation)
 */

import { AgentConfig } from '../config';
import { BaseAgent, AgentResponse, AgentMessage } from '../BaseAgent';
import { TransitionType, TransitionSpecification, VisualPlan } from './StoryboardAgent';
import { ImagePrompt } from '../ImageGenerator';
import { TRANSITION_CONTINUITY_RULES, TRANSITION_TYPES } from '../../prompts';

// Transition validation result for a single pair
export interface TransitionValidation {
  shotAId: string;
  shotBId: string;
  transitionType: TransitionType;
  isValid: boolean;
  score: number; // 0-100
  
  // Continuity check results
  continuityChecks: {
    element: string;
    shouldPreserve: boolean;
    wasPreserved: boolean;
    issue?: string;
  }[];
  
  // What changed (should align with transition type)
  changeAnalysis: {
    whatChanged: string;
    isAppropriateChange: boolean;
    issue?: string;
  };
  
  // Overall feedback
  feedback: string;
  issues: string[];
  recommendations: string[];
}

// Full validation report for a sequence
export interface TransitionValidationReport {
  isAcceptable: boolean;
  overallScore: number;
  totalTransitions: number;
  validTransitions: number;
  invalidTransitions: number;
  
  transitionValidations: TransitionValidation[];
  
  // Rhythm analysis
  rhythmAnalysis: {
    isEffective: boolean;
    description: string;
    closureLoadProgression: string;
    suggestions: string[];
  };
  
  // Flagged transitions for regeneration
  transitionsToFix: Array<{
    shotAId: string;
    shotBId: string;
    issue: string;
    fix: string;
  }>;
  
  summary: string;
}

// Request for transition validation
export interface TransitionValidationRequest {
  plan: VisualPlan;
  // Optional: actual generated images for vision analysis
  generatedImages?: Map<string, { data: string; mimeType: string }>;
  // Optional: generated prompts for structural analysis
  generatedPrompts?: Map<string, ImagePrompt>;
  // Validation mode
  includeVisionAnalysis?: boolean;
  strictMode?: boolean;
}

export class TransitionValidator extends BaseAgent {
  constructor(config: AgentConfig) {
    super('Transition Validator', config);
  }

  async execute(input: TransitionValidationRequest): Promise<AgentResponse<TransitionValidationReport>> {
    console.log(`[TransitionValidator] Validating ${input.plan.shots.length - 1} transitions`);
    
    const validations: TransitionValidation[] = [];
    const transitionsToFix: TransitionValidationReport['transitionsToFix'] = [];
    
    // Validate each transition pair
    for (let i = 0; i < input.plan.shots.length - 1; i++) {
      const shotA = input.plan.shots[i];
      const shotB = input.plan.shots[i + 1];
      
      const validation = await this.validateTransitionPair(
        shotA,
        shotB,
        input.generatedImages,
        input.generatedPrompts,
        input.includeVisionAnalysis,
        input.strictMode
      );
      
      validations.push(validation);
      
      if (!validation.isValid) {
        transitionsToFix.push({
          shotAId: shotA.id,
          shotBId: shotB.id,
          issue: validation.issues[0] || 'Continuity violation',
          fix: validation.recommendations[0] || 'Review and regenerate'
        });
      }
    }
    
    // Analyze overall rhythm
    const rhythmAnalysis = this.analyzeTransitionRhythm(input.plan, validations);
    
    // Calculate scores
    const validCount = validations.filter(v => v.isValid).length;
    const overallScore = validations.length > 0
      ? Math.round(validations.reduce((sum, v) => sum + v.score, 0) / validations.length)
      : 100;
    
    const report: TransitionValidationReport = {
      isAcceptable: overallScore >= 70 && transitionsToFix.length === 0,
      overallScore,
      totalTransitions: validations.length,
      validTransitions: validCount,
      invalidTransitions: validations.length - validCount,
      transitionValidations: validations,
      rhythmAnalysis,
      transitionsToFix,
      summary: this.generateSummary(validations, rhythmAnalysis, overallScore)
    };
    
    return { success: true, data: report };
  }

  protected getAgentSpecificPrompt(): string {
    return `
## Your Role: Transition Validator

You validate that panel transitions between story images follow proper visual continuity rules.

${TRANSITION_TYPES}
${TRANSITION_CONTINUITY_RULES}

## Validation Criteria

### MOMENT_TO_MOMENT
- Camera angle MUST be identical
- Environment MUST be identical
- Character position MUST be identical (only micro-change allowed)
- Lighting MUST be identical
- Palette MUST be identical
- ONLY ONE tiny detail should change

### ACTION_TO_ACTION
- Same character present
- Same environment/setting
- Lighting should be consistent
- Character shows different key pose in action sequence
- Motion should be implied between frames

### SUBJECT_TO_SUBJECT
- SAME time (frozen moment)
- SAME location visible
- SAME lighting direction
- Camera focus changes to different subject
- Spatial relationship should be clear

### SCENE_TO_SCENE
- Time and/or location changes
- Character state may change (clothes, injuries, mood)
- Some continuity thread should connect (character, motif, theme)

### ASPECT_TO_ASPECT
- Time is FROZEN
- SAME general location
- Palette MUST be identical
- Lighting mood MUST be identical
- Only the focus/detail changes

### NON_SEQUITUR
- Intentionally jarring
- Only motif-level connection expected
- Symbolic rather than literal continuity
`;
  }

  /**
   * Validate a single transition pair
   */
  private async validateTransitionPair(
    shotA: VisualPlan['shots'][0],
    shotB: VisualPlan['shots'][0],
    images?: Map<string, { data: string; mimeType: string }>,
    prompts?: Map<string, ImagePrompt>,
    includeVision?: boolean,
    strictMode?: boolean
  ): Promise<TransitionValidation> {
    const transition = shotA.transitionToNext;
    const transitionType = transition?.type || 'action_to_action';
    
    const continuityChecks: TransitionValidation['continuityChecks'] = [];
    const issues: string[] = [];
    const recommendations: string[] = [];
    
    // Get continuity rules for this transition type
    const rules = this.getContinuityRules(transitionType);
    
    // Check each continuity element
    for (const rule of rules) {
      const check = this.checkContinuityElement(rule, shotA, shotB, transition);
      continuityChecks.push(check);
      
      if (check.shouldPreserve && !check.wasPreserved && check.issue) {
        issues.push(check.issue);
        recommendations.push(`${rule.element}: ${rule.recommendation}`);
      }
    }
    
    // Analyze what changed
    const changeAnalysis = this.analyzeChange(transitionType, shotA, shotB, transition);
    if (!changeAnalysis.isAppropriateChange && changeAnalysis.issue) {
      issues.push(changeAnalysis.issue);
    }
    
    // Vision analysis if requested and images available
    if (includeVision && images?.has(shotA.id) && images?.has(shotB.id)) {
      const visionIssues = await this.runVisionAnalysis(
        shotA.id, shotB.id, transitionType, images
      );
      issues.push(...visionIssues);
    }
    
    // Calculate score
    const preservedCount = continuityChecks.filter(c => !c.shouldPreserve || c.wasPreserved).length;
    const score = Math.round((preservedCount / continuityChecks.length) * 100);
    
    const isValid = strictMode
      ? issues.length === 0
      : score >= 70;
    
    return {
      shotAId: shotA.id,
      shotBId: shotB.id,
      transitionType,
      isValid,
      score,
      continuityChecks,
      changeAnalysis,
      feedback: issues.length === 0 
        ? `Transition ${transitionType} properly enforced`
        : `Transition ${transitionType} has ${issues.length} issue(s)`,
      issues,
      recommendations
    };
  }

  /**
   * Get continuity rules for a transition type
   */
  private getContinuityRules(type: TransitionType): Array<{
    element: string;
    shouldPreserve: boolean;
    recommendation: string;
  }> {
    const rules: Record<TransitionType, Array<{ element: string; shouldPreserve: boolean; recommendation: string }>> = {
      'moment_to_moment': [
        { element: 'camera_angle', shouldPreserve: true, recommendation: 'Use IDENTICAL camera angle' },
        { element: 'environment', shouldPreserve: true, recommendation: 'Use IDENTICAL environment' },
        { element: 'character_position', shouldPreserve: true, recommendation: 'Keep character in SAME position with only micro-adjustment' },
        { element: 'lighting', shouldPreserve: true, recommendation: 'Use IDENTICAL lighting' },
        { element: 'palette', shouldPreserve: true, recommendation: 'Use IDENTICAL color palette' },
      ],
      'action_to_action': [
        { element: 'character', shouldPreserve: true, recommendation: 'Same character must be present' },
        { element: 'environment', shouldPreserve: true, recommendation: 'Same environment/setting' },
        { element: 'lighting', shouldPreserve: true, recommendation: 'Consistent lighting' },
        { element: 'camera_angle', shouldPreserve: false, recommendation: 'Camera can follow action' },
      ],
      'subject_to_subject': [
        { element: 'time', shouldPreserve: true, recommendation: 'Same frozen moment' },
        { element: 'location', shouldPreserve: true, recommendation: 'Same location visible' },
        { element: 'lighting_direction', shouldPreserve: true, recommendation: 'Same lighting direction' },
        { element: 'palette', shouldPreserve: true, recommendation: 'Consistent palette' },
      ],
      'scene_to_scene': [
        { element: 'continuity_thread', shouldPreserve: true, recommendation: 'Maintain character or thematic link' },
        { element: 'environment', shouldPreserve: false, recommendation: 'Environment should change' },
        { element: 'time', shouldPreserve: false, recommendation: 'Time can change' },
      ],
      'aspect_to_aspect': [
        { element: 'time', shouldPreserve: true, recommendation: 'Time is FROZEN' },
        { element: 'location', shouldPreserve: true, recommendation: 'Same general location' },
        { element: 'palette', shouldPreserve: true, recommendation: 'IDENTICAL palette' },
        { element: 'lighting_mood', shouldPreserve: true, recommendation: 'IDENTICAL lighting mood' },
      ],
      'non_sequitur': [
        { element: 'motif', shouldPreserve: true, recommendation: 'At least one visual motif should repeat' },
      ],
    };
    
    return rules[type] || [];
  }

  /**
   * Check a specific continuity element
   */
  private checkContinuityElement(
    rule: { element: string; shouldPreserve: boolean; recommendation: string },
    shotA: VisualPlan['shots'][0],
    shotB: VisualPlan['shots'][0],
    transition?: TransitionSpecification
  ): TransitionValidation['continuityChecks'][0] {
    // Check based on the element type
    let wasPreserved = true;
    let issue: string | undefined;

    switch (rule.element) {
      case 'camera_angle':
        wasPreserved = shotA.cameraAngle === shotB.cameraAngle;
        if (rule.shouldPreserve && !wasPreserved) {
          issue = `Camera angle changed from ${shotA.cameraAngle} to ${shotB.cameraAngle} (should be identical)`;
        }
        break;

      case 'environment':
        // Check if environment description is similar
        wasPreserved = transition?.preserveEnvironment !== false;
        if (rule.shouldPreserve && !wasPreserved) {
          issue = 'Environment should be preserved but transition allows change';
        }
        break;

      case 'lighting':
      case 'lighting_direction':
      case 'lighting_mood':
        wasPreserved = transition?.preserveLighting !== false &&
          shotA.lighting?.direction === shotB.lighting?.direction;
        if (rule.shouldPreserve && !wasPreserved) {
          issue = `Lighting changed but should be preserved for ${transition?.type}`;
        }
        break;

      case 'palette':
        wasPreserved = transition?.preservePalette !== false;
        if (rule.shouldPreserve && !wasPreserved) {
          issue = 'Color palette should be preserved';
        }
        break;

      case 'character_position':
        wasPreserved = transition?.preserveCharacterPosition !== false;
        if (rule.shouldPreserve && !wasPreserved) {
          issue = 'Character position should be preserved (micro-change only)';
        }
        break;

      case 'character':
        // Check if same character appears in both shots
        const charsA = Array.isArray(shotA.characters) ? shotA.characters : [];
        const charsB = Array.isArray(shotB.characters) ? shotB.characters : [];
        const sharedChars = charsA.filter(c => charsB.includes(c));
        wasPreserved = sharedChars.length > 0;
        if (rule.shouldPreserve && !wasPreserved) {
          issue = 'Same character should appear in both shots';
        }
        break;

      case 'time':
        // For aspect_to_aspect, time should be frozen
        wasPreserved = transition?.type === 'aspect_to_aspect' || transition?.type === 'subject_to_subject';
        break;

      case 'continuity_thread':
        wasPreserved = !!transition?.continuityThread;
        if (rule.shouldPreserve && !wasPreserved) {
          issue = 'Scene-to-scene transition needs a continuity thread (character, motif, or theme)';
        }
        break;

      case 'motif':
        wasPreserved = !!transition?.continuityThread;
        if (rule.shouldPreserve && !wasPreserved) {
          issue = 'Non-sequitur transition needs at least one repeating visual motif';
        }
        break;
    }

    return {
      element: rule.element,
      shouldPreserve: rule.shouldPreserve,
      wasPreserved: rule.shouldPreserve ? wasPreserved : true,
      issue
    };
  }

  /**
   * Analyze what changed between shots
   */
  private analyzeChange(
    transitionType: TransitionType,
    shotA: VisualPlan['shots'][0],
    shotB: VisualPlan['shots'][0],
    transition?: TransitionSpecification
  ): TransitionValidation['changeAnalysis'] {
    const whatChanged = transition?.changeDescription || 
      shotB.continuityFromPrevious?.whatChanged || 
      'Not specified';
    
    let isAppropriateChange = true;
    let issue: string | undefined;

    switch (transitionType) {
      case 'moment_to_moment':
        // Only micro-changes allowed
        if (!whatChanged.match(/tiny|micro|small|slight|subtle/i)) {
          isAppropriateChange = false;
          issue = 'Moment-to-moment should only have tiny/micro changes';
        }
        break;

      case 'action_to_action':
        // Should show key pose change
        if (!whatChanged.match(/pose|position|action|motion|move/i)) {
          isAppropriateChange = false;
          issue = 'Action-to-action should show pose/motion change';
        }
        break;

      case 'subject_to_subject':
        // Should change focus/subject
        if (!whatChanged.match(/focus|subject|character|person|object|cut to/i)) {
          isAppropriateChange = false;
          issue = 'Subject-to-subject should change focus to different subject';
        }
        break;
    }

    return {
      whatChanged,
      isAppropriateChange,
      issue
    };
  }

  /**
   * Run vision analysis on image pair
   */
  private async runVisionAnalysis(
    shotAId: string,
    shotBId: string,
    transitionType: TransitionType,
    images: Map<string, { data: string; mimeType: string }>
  ): Promise<string[]> {
    const imageA = images.get(shotAId);
    const imageB = images.get(shotBId);
    
    if (!imageA || !imageB) return [];

    const messages: AgentMessage[] = [
      {
        role: 'user',
        content: [
          { type: 'text', text: this.buildVisionPrompt(transitionType) },
          { 
            type: 'image', 
            source: { type: 'base64', media_type: imageA.mimeType, data: imageA.data } 
          },
          { type: 'text', text: '[Image A - Previous shot]' },
          { 
            type: 'image', 
            source: { type: 'base64', media_type: imageB.mimeType, data: imageB.data } 
          },
          { type: 'text', text: '[Image B - Current shot]' },
        ]
      }
    ];

    try {
      const response = await this.callLLM(messages);
      const result = this.parseJSON<{ issues: string[] }>(response);
      return result.issues || [];
    } catch {
      return [];
    }
  }

  private buildVisionPrompt(transitionType: TransitionType): string {
    return `
Analyze these two sequential images for proper ${transitionType} transition.

Based on the transition type, check:
${this.getTransitionChecklistForVision(transitionType)}

Return a JSON object with:
{
  "issues": ["list of continuity violations found", "or empty array if none"]
}
`;
  }

  private getTransitionChecklistForVision(type: TransitionType): string {
    const checklists: Record<TransitionType, string> = {
      'moment_to_moment': `
- Is the camera angle IDENTICAL?
- Is the environment IDENTICAL?
- Is the character in the SAME position (with only micro-change)?
- Is the lighting IDENTICAL?
- Is only ONE tiny detail different?`,
      'action_to_action': `
- Is the same character present?
- Is the environment the same?
- Is the lighting consistent?
- Does the character show a different key pose in an action sequence?`,
      'subject_to_subject': `
- Does it appear to be the SAME moment in time?
- Is the location the same?
- Is the lighting direction consistent?
- Has the focus shifted to a different subject?`,
      'scene_to_scene': `
- Has the location/time clearly changed?
- Is there a connecting thread (same character, similar motif)?`,
      'aspect_to_aspect': `
- Does it appear to be the SAME frozen moment?
- Is the color palette IDENTICAL?
- Is the lighting mood IDENTICAL?
- Does it show a different detail/aspect of the same place?`,
      'non_sequitur': `
- Is the transition intentionally jarring?
- Is there at least ONE repeating visual motif (color, shape, symbol)?`
    };
    
    return checklists[type] || '';
  }

  /**
   * Analyze the overall transition rhythm of the sequence
   */
  private analyzeTransitionRhythm(
    plan: VisualPlan,
    validations: TransitionValidation[]
  ): TransitionValidationReport['rhythmAnalysis'] {
    const sequence = validations.map(v => v.transitionType);
    const suggestions: string[] = [];
    
    // Check for rhythm issues
    const consecutiveSame = this.findConsecutiveRepeats(sequence);
    if (consecutiveSame.length > 0) {
      suggestions.push(`Consider varying transitions: ${consecutiveSame.join(', ')} appear consecutively`);
    }
    
    // Check closure load progression
    const closureLoads = validations.map(v => {
      const loadMap: Record<TransitionType, string> = {
        'moment_to_moment': 'Very Low',
        'action_to_action': 'Moderate',
        'subject_to_subject': 'Moderate-High',
        'aspect_to_aspect': 'Moderate',
        'scene_to_scene': 'High',
        'non_sequitur': 'Very High'
      };
      return loadMap[v.transitionType] || 'Unknown';
    });
    
    const closureLoadProgression = closureLoads.join(' → ');
    
    // Determine if rhythm is effective
    const rhythmPattern = plan.rhythmPattern || 'Standard';
    const isEffective = this.evaluateRhythmEffectiveness(sequence, rhythmPattern);
    
    return {
      isEffective,
      description: plan.transitionAnalysis?.rhythmDescription || 
        `Sequence uses ${new Set(sequence).size} different transition types`,
      closureLoadProgression,
      suggestions
    };
  }

  private findConsecutiveRepeats(sequence: TransitionType[]): TransitionType[] {
    const repeats: TransitionType[] = [];
    for (let i = 1; i < sequence.length; i++) {
      if (sequence[i] === sequence[i - 1] && !repeats.includes(sequence[i])) {
        repeats.push(sequence[i]);
      }
    }
    return repeats;
  }

  private evaluateRhythmEffectiveness(sequence: TransitionType[], pattern: string): boolean {
    // Simple heuristics for rhythm effectiveness
    const variety = new Set(sequence).size;
    
    switch (pattern) {
      case 'Tension Build':
        // Should have moment_to_moment near the end
        return sequence.includes('moment_to_moment');
      case 'Action Sequence':
        // Should have action_to_action
        return sequence.includes('action_to_action');
      case 'Intimate Exchange':
        // Should have subject_to_subject
        return sequence.includes('subject_to_subject');
      default:
        // Standard should have variety
        return variety >= 2;
    }
  }

  private generateSummary(
    validations: TransitionValidation[],
    rhythm: TransitionValidationReport['rhythmAnalysis'],
    score: number
  ): string {
    const validCount = validations.filter(v => v.isValid).length;
    const invalidCount = validations.length - validCount;
    
    if (invalidCount === 0) {
      return `All ${validations.length} transitions properly enforced (score: ${score}/100). ${rhythm.description}`;
    } else {
      return `${invalidCount} of ${validations.length} transitions have issues (score: ${score}/100). ${rhythm.suggestions[0] || ''}`;
    }
  }
}
