/**
 * Pose Diversity Validator Agent
 * 
 * Analyzes a sequence of generated images to detect:
 * - Repeated poses across consecutive images
 * - Monotonous compositions (too similar camera angles, distances)
 * - Static/rigid poses that lack dynamism
 * - Symmetrical "mannequin" poses
 * 
 * Can work with:
 * - Image data (vision model analysis)
 * - Prompt specifications (structural analysis)
 * - Generated pose specs from StoryboardAgent
 * 
 * Returns a report with specific images flagged for regeneration.
 */

import { AgentConfig } from '../config';
import { BaseAgent, AgentResponse, AgentMessage } from '../BaseAgent';
import { PoseSpecification, LightingSpecification } from './StoryboardAgent';
import { ImagePrompt } from '../ImageGenerator';
import { POSE_DIVERSITY_CHECKLIST, FORBIDDEN_DEFAULTS } from '../../prompts';
import { downsampleBatch } from '../../utils/imageResizer';

// Individual shot metadata for diversity checking
export interface ShotMetadata {
  shotId: string;
  beatId: string;
  shotType: string;
  cameraAngle: string;
  horizontalAngle: string;
  pose?: PoseSpecification;
  poseDescription?: string;
  prompt?: ImagePrompt;
  // If we have the actual generated image
  imageData?: string;
  imageMimeType?: string;
}

// Diversity issue found in analysis
export interface DiversityIssue {
  type: 'pose_repetition' | 'angle_repetition' | 'static_pose' | 'symmetrical_pose' | 
        'composition_monotony' | 'lighting_monotony' | 'missing_line_of_action';
  severity: 'error' | 'warning';
  shotIds: string[]; // Which shots are involved
  description: string;
  recommendation: string;
}

// Full diversity report
export interface DiversityReport {
  isAcceptable: boolean;
  overallScore: number; // 0-100, 70+ is acceptable
  totalShots: number;
  issueCount: number;
  issues: DiversityIssue[];
  shotsToRegenerate: string[]; // Shot IDs that should be regenerated
  regenerationGuidance: Map<string, string>; // shotId -> specific guidance for regeneration
  summary: string;
}

// Request for diversity validation
export interface DiversityValidationRequest {
  shots: ShotMetadata[];
  strictMode?: boolean; // If true, lower tolerance for repetition
  includeVisionAnalysis?: boolean; // If true and images provided, use vision model
}

export class PoseDiversityValidator extends BaseAgent {
  constructor(config: AgentConfig) {
    super('Pose Diversity Validator', config);
  }

  async execute(input: DiversityValidationRequest): Promise<AgentResponse<DiversityReport>> {
    console.log(`[PoseDiversityValidator] Analyzing ${input.shots.length} shots for pose diversity`);
    
    const issues: DiversityIssue[] = [];
    const shotsToRegenerate = new Set<string>();
    const regenerationGuidance = new Map<string, string>();

    // 1. Structural analysis (from pose specs and prompts)
    const structuralIssues = this.analyzeStructuralDiversity(input.shots, input.strictMode);
    issues.push(...structuralIssues);

    // 2. Vision analysis if images are provided and requested
    if (input.includeVisionAnalysis && input.shots.some(s => s.imageData)) {
      const visionIssues = await this.analyzeVisualDiversity(input.shots);
      issues.push(...visionIssues);
    }

    // 3. Determine which shots need regeneration
    for (const issue of issues) {
      if (issue.severity === 'error') {
        issue.shotIds.forEach(id => shotsToRegenerate.add(id));
      }
    }

    // 4. Generate regeneration guidance for each flagged shot
    for (const shotId of shotsToRegenerate) {
      const shot = input.shots.find(s => s.shotId === shotId);
      const relevantIssues = issues.filter(i => i.shotIds.includes(shotId));
      
      if (shot) {
        const guidance = this.generateRegenerationGuidance(shot, relevantIssues, input.shots);
        regenerationGuidance.set(shotId, guidance);
      }
    }

    // 5. Calculate overall score
    const overallScore = this.calculateDiversityScore(input.shots.length, issues);
    const isAcceptable = overallScore >= 70 && !issues.some(i => i.severity === 'error');

    const report: DiversityReport = {
      isAcceptable,
      overallScore,
      totalShots: input.shots.length,
      issueCount: issues.length,
      issues,
      shotsToRegenerate: Array.from(shotsToRegenerate),
      regenerationGuidance,
      summary: this.generateSummary(issues, overallScore)
    };

    return { success: true, data: report };
  }

  protected getAgentSpecificPrompt(): string {
    return `
## Your Role: Pose Diversity Validator

You analyze sequences of images or image specifications to detect visual monotony.

${POSE_DIVERSITY_CHECKLIST}

${FORBIDDEN_DEFAULTS}

## Your Analysis Criteria

### POSE REPETITION (ERROR)
Flag when two consecutive shots have:
- Same line of action (both S-curve, both C-curve, etc.)
- Same weight distribution
- Same arm position category
- Same torso twist direction

### ANGLE REPETITION (ERROR if 3+, WARNING if 2)
Flag when shots have:
- Same camera angle 3+ times consecutively
- Same horizontal staging 3+ times consecutively
- Same shot distance 2+ times consecutively

### STATIC POSE (ERROR)
Flag when a pose shows:
- Straight vertical spine (no curve)
- Symmetrical arm positions
- Weight evenly distributed (50/50)
- Square-on to camera without justification

### COMPOSITION MONOTONY (WARNING)
Flag when shots have:
- Same focal point placement repeatedly
- Similar depth layer arrangements
- Repetitive lighting direction

## Output Quality Standards
A passing sequence should have:
- No consecutive pose repetition
- Camera angle variety (rotate through options)
- Each character pose distinctly different
- Clear line of action in every shot
`;
  }

  /**
   * Analyze structural diversity from pose specs and shot metadata
   */
  private analyzeStructuralDiversity(shots: ShotMetadata[], strictMode?: boolean): DiversityIssue[] {
    const issues: DiversityIssue[] = [];

    // Check consecutive poses
    for (let i = 1; i < shots.length; i++) {
      const prev = shots[i - 1];
      const curr = shots[i];

      // Check line of action repetition
      if (prev.pose?.lineOfAction && curr.pose?.lineOfAction) {
        if (prev.pose.lineOfAction === curr.pose.lineOfAction) {
          issues.push({
            type: 'pose_repetition',
            severity: 'error',
            shotIds: [prev.shotId, curr.shotId],
            description: `Consecutive shots ${prev.shotId} and ${curr.shotId} both use ${prev.pose.lineOfAction} line of action`,
            recommendation: `Change shot ${curr.shotId} to use a different line of action (try ${this.suggestAlternativeLineOfAction(prev.pose.lineOfAction)})`
          });
        }
      }

      // Check weight distribution repetition (warning-only — weight similarity is common in dialog)
      if (prev.pose?.weightDistribution && curr.pose?.weightDistribution) {
        if (prev.pose.weightDistribution === curr.pose.weightDistribution) {
          issues.push({
            type: 'pose_repetition',
            severity: 'warning',
            shotIds: [prev.shotId, curr.shotId],
            description: `Consecutive shots have same weight distribution: ${prev.pose.weightDistribution}`,
            recommendation: `Vary weight distribution in shot ${curr.shotId} to ${this.suggestAlternativeWeight(prev.pose.weightDistribution)}`
          });
        }
      }

      // Check arm position repetition
      if (prev.pose?.armPosition && curr.pose?.armPosition) {
        if (prev.pose.armPosition === curr.pose.armPosition) {
          issues.push({
            type: 'pose_repetition',
            severity: strictMode ? 'error' : 'warning',
            shotIds: [prev.shotId, curr.shotId],
            description: `Consecutive shots have same arm position: ${prev.pose.armPosition}`,
            recommendation: `Change arm position in shot ${curr.shotId} to create variety`
          });
        }
      }

      // Check shot type repetition (warning — same-distance consecutives are common in shot/reverse-shot)
      if (prev.shotType === curr.shotType) {
        issues.push({
          type: 'composition_monotony',
          severity: 'warning',
          shotIds: [prev.shotId, curr.shotId],
          description: `Consecutive shots both use ${prev.shotType}`,
          recommendation: `Change shot ${curr.shotId} to a different distance (try ${this.suggestAlternativeShotType(prev.shotType)})`
        });
      }
    }

    // Check camera angle repetition (3+ in a row)
    for (let i = 2; i < shots.length; i++) {
      if (shots[i - 2].cameraAngle === shots[i - 1].cameraAngle && 
          shots[i - 1].cameraAngle === shots[i].cameraAngle) {
        issues.push({
          type: 'angle_repetition',
          severity: 'error',
          shotIds: [shots[i - 2].shotId, shots[i - 1].shotId, shots[i].shotId],
          description: `Three consecutive shots use ${shots[i].cameraAngle} camera angle`,
          recommendation: `Change at least one shot to a different angle (try ${this.suggestAlternativeAngle(shots[i].cameraAngle)})`
        });
      }
    }

    // Check for missing line of action
    for (const shot of shots) {
      if (!shot.pose?.lineOfAction && !shot.poseDescription?.match(/S-curve|C-curve|diagonal/i)) {
        issues.push({
          type: 'missing_line_of_action',
          severity: 'warning',
          shotIds: [shot.shotId],
          description: `Shot ${shot.shotId} has no specified line of action`,
          recommendation: `Add explicit line of action (S-curve, C-curve, or diagonal) to ensure dynamic pose`
        });
      }
    }

    // Check for static pose indicators
    for (const shot of shots) {
      const poseDesc = shot.poseDescription?.toLowerCase() || '';
      const prompt = shot.prompt?.prompt?.toLowerCase() || '';
      const combined = poseDesc + ' ' + prompt;

      if (combined.includes('standing straight') || 
          combined.includes('arms at sides') ||
          combined.includes('facing camera') ||
          (shot.pose?.emotionalQuality === 'neutral' && shot.pose?.torsoTwist === 'square')) {
        issues.push({
          type: 'static_pose',
          severity: 'error',
          shotIds: [shot.shotId],
          description: `Shot ${shot.shotId} appears to have a static/rigid pose`,
          recommendation: `Add dynamic elements: curved spine, asymmetric arms, twisted torso, clear weight shift`
        });
      }
    }

    return issues;
  }

  /**
   * Analyze visual diversity using vision model (when images are provided)
   */
  private static readonly MAX_VISION_IMAGES = 8;

  private async analyzeVisualDiversity(shots: ShotMetadata[]): Promise<DiversityIssue[]> {
    const issues: DiversityIssue[] = [];
    const shotsWithImages = shots.filter(s => s.imageData && s.imageMimeType);

    if (shotsWithImages.length < 2) {
      return issues;
    }

    // Cap images to avoid exceeding Anthropic's multi-image size limits.
    // For large scenes, sample every Nth shot to stay within budget.
    let sampled = shotsWithImages;
    if (shotsWithImages.length > PoseDiversityValidator.MAX_VISION_IMAGES) {
      const step = Math.ceil(shotsWithImages.length / PoseDiversityValidator.MAX_VISION_IMAGES);
      sampled = shotsWithImages.filter((_, i) => i % step === 0).slice(0, PoseDiversityValidator.MAX_VISION_IMAGES);
      console.log(`[PoseDiversityValidator] Sampling ${sampled.length} of ${shotsWithImages.length} images for vision analysis (every ${step}th shot)`);
    }

    // Downscale images to stay within Anthropic's multi-image limits
    // (max 2000px per dimension, ~20MB total payload)
    const rawImages = sampled.map(s => ({
      data: s.imageData!,
      mimeType: s.imageMimeType!,
      shotId: s.shotId,
    }));
    const resizedImages = await downsampleBatch(rawImages);

    // Rebuild sampled list to match the (possibly truncated) resized batch
    const resizedShotIds = new Set(resizedImages.map(r => r.shotId));
    const resizedSampled = sampled.filter(s => resizedShotIds.has(s.shotId));

    const imageContent: any[] = [
      { type: 'text', text: this.buildVisionAnalysisPrompt(resizedSampled) }
    ];

    for (const ri of resizedImages) {
      imageContent.push({
        type: 'image',
        source: {
          type: 'base64',
          media_type: ri.mimeType,
          data: ri.data,
        }
      });
      imageContent.push({ type: 'text', text: `[Shot ${ri.shotId}]` });
    }

    try {
      const messages: AgentMessage[] = [{ role: 'user', content: imageContent }];
      const response = await this.callLLM(messages);
      const visionReport = this.parseJSON<{ issues: DiversityIssue[] }>(response);
      
      if (visionReport.issues) {
        issues.push(...visionReport.issues);
      }
    } catch (error) {
      console.warn(`[PoseDiversityValidator] Vision analysis failed (${sampled.length} images):`, error);
    }

    return issues;
  }

  private buildVisionAnalysisPrompt(shots: ShotMetadata[]): string {
    return `
Analyze these ${shots.length} sequential images for pose diversity and visual monotony.

## Check For:
1. **Pose Repetition**: Do any consecutive images show characters in the same pose?
2. **Static Poses**: Are characters standing rigidly with straight spines and arms at sides?
3. **Symmetrical Poses**: Are poses mirror-symmetrical (mannequin-like)?
4. **Camera Angle Repetition**: Are angles too similar across images?
5. **Composition Monotony**: Is the focal point always in the same place?

## For Each Issue Found, Return:
{
  "issues": [
    {
      "type": "pose_repetition | static_pose | symmetrical_pose | angle_repetition | composition_monotony",
      "severity": "error | warning",
      "shotIds": ["shot-ids-involved"],
      "description": "What the issue is",
      "recommendation": "How to fix it"
    }
  ]
}

If no issues found, return: { "issues": [] }

Analyze the images now:
`;
  }

  /**
   * Generate specific guidance for regenerating a flagged shot
   */
  private generateRegenerationGuidance(
    shot: ShotMetadata, 
    issues: DiversityIssue[],
    allShots: ShotMetadata[]
  ): string {
    const guidance: string[] = [];
    
    // Find what the previous and next shots use
    const shotIndex = allShots.findIndex(s => s.shotId === shot.shotId);
    const prevShot = shotIndex > 0 ? allShots[shotIndex - 1] : null;
    const nextShot = shotIndex < allShots.length - 1 ? allShots[shotIndex + 1] : null;

    guidance.push(`Regenerate shot ${shot.shotId} with the following changes:`);

    for (const issue of issues) {
      switch (issue.type) {
        case 'pose_repetition':
          if (prevShot?.pose?.lineOfAction) {
            guidance.push(`- Use ${this.suggestAlternativeLineOfAction(prevShot.pose.lineOfAction)} line of action (previous shot uses ${prevShot.pose.lineOfAction})`);
          }
          if (prevShot?.pose?.weightDistribution) {
            guidance.push(`- Shift weight to ${this.suggestAlternativeWeight(prevShot.pose.weightDistribution)} (previous uses ${prevShot.pose.weightDistribution})`);
          }
          break;

        case 'static_pose':
          guidance.push(`- Add clear S-curve or C-curve through the spine`);
          guidance.push(`- Make arms asymmetric (one gesture, one relaxed)`);
          guidance.push(`- Twist torso relative to hips`);
          guidance.push(`- Shift weight clearly to one leg`);
          break;

        case 'symmetrical_pose':
          guidance.push(`- Break symmetry: different arm positions left vs right`);
          guidance.push(`- Different leg positions (one bent, one straight)`);
          guidance.push(`- Tilt head/shoulders/hips at different angles`);
          break;

        case 'angle_repetition':
          guidance.push(`- Change camera angle to ${this.suggestAlternativeAngle(shot.cameraAngle)}`);
          break;

        case 'composition_monotony':
          guidance.push(`- Change shot type to ${this.suggestAlternativeShotType(shot.shotType)}`);
          guidance.push(`- Move focal point to different thirds position`);
          break;
      }
    }

    return guidance.join('\n');
  }

  private suggestAlternativeLineOfAction(current: string): string {
    const options = ['S-curve', 'C-curve', 'diagonal', 'coiled'];
    return options.filter(o => o !== current)[Math.floor(Math.random() * 3)] || 'C-curve';
  }

  private suggestAlternativeWeight(current: string): string {
    const options = ['left', 'right', 'forward', 'backward', 'off-balance'];
    return options.filter(o => o !== current)[Math.floor(Math.random() * 4)] || 'forward';
  }

  private suggestAlternativeAngle(current: string): string {
    const options = ['Eye-level', 'Low', 'High', 'Dutch', 'Worm\'s eye'];
    return options.filter(o => o !== current)[Math.floor(Math.random() * 4)] || 'Low';
  }

  private suggestAlternativeShotType(current: string): string {
    const options = ['ELS', 'LS', 'MLS', 'MS', 'MCU', 'CU', 'ECU'];
    const currentIndex = options.indexOf(current);
    // Suggest something at least 2 steps away
    if (currentIndex <= 2) return options[currentIndex + 2] || 'CU';
    if (currentIndex >= 4) return options[currentIndex - 2] || 'MLS';
    return currentIndex % 2 === 0 ? options[currentIndex + 2] : options[currentIndex - 2];
  }

  private calculateDiversityScore(totalShots: number, issues: DiversityIssue[]): number {
    if (totalShots === 0) return 100;
    
    let score = 100;
    
    for (const issue of issues) {
      if (issue.severity === 'error') {
        score -= 10;
      } else {
        score -= 3;
      }
    }

    // Floor at 20 so the score can't be nuked to 0 by structural issues alone
    return Math.max(20, score);
  }

  private generateSummary(issues: DiversityIssue[], score: number): string {
    if (issues.length === 0) {
      return 'Excellent pose diversity - no issues detected.';
    }

    const errorCount = issues.filter(i => i.severity === 'error').length;
    const warningCount = issues.filter(i => i.severity === 'warning').length;

    if (score >= 70) {
      return `Acceptable diversity (score: ${score}). ${warningCount} warnings to consider addressing.`;
    } else {
      return `Diversity issues detected (score: ${score}). ${errorCount} errors require regeneration, ${warningCount} warnings.`;
    }
  }
}
