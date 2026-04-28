/**
 * Three-Tier Visual Validation
 *
 * Tier 1: Deterministic inline checks (text-artifact, file integrity, structural diversity)
 * Tier 2: Consolidated vision review (1 LLM call per scene, post-assembly, non-blocking)
 * Tier 3: Targeted regeneration of flagged images (never discards originals)
 */

import type { GeneratedImage, ImagePrompt } from '../agents/ImageGenerator';
import type { ArtStyleProfile } from './artStyleProfile';

export interface Tier1CheckResult {
  passed: boolean;
  reason?: string;
  shouldRetry: boolean;
}

export interface Tier2ShotReport {
  shotId: string;
  beatId: string;
  scores: {
    expression: number;
    pose: number;
    flow: number;
    setting: number;
  };
  averageScore: number;
  flagged: boolean;
  reason?: string;
}

export interface Tier2SceneReport {
  sceneId: string;
  shotReports: Tier2ShotReport[];
  overallScore: number;
  flaggedCount: number;
}

export interface VisualQAReport {
  generatedAt: string;
  storyId?: string;
  scenes: Tier2SceneReport[];
  totalImages: number;
  totalFlagged: number;
  overallScore: number;
}

export interface Tier3RegenTarget {
  sceneId: string;
  shotId: string;
  beatId: string;
  reason: string;
  originalPrompt?: ImagePrompt;
}

/**
 * Tier 1: Deterministic inline checks.
 * Runs immediately after each image is generated.
 */
export function runTier1Checks(result: GeneratedImage, identifier: string): Tier1CheckResult {
  if (!result.imageUrl && !result.imageData) {
    if (result.imagePath?.endsWith('.prompt.txt')) {
      return { passed: false, reason: 'Placeholder prompt file, not an actual image', shouldRetry: true };
    }
    return { passed: false, reason: 'No image URL or data returned', shouldRetry: true };
  }

  if (result.metadata?.format === 'prompt') {
    return { passed: false, reason: 'Prompt-only placeholder, no image generated', shouldRetry: true };
  }

  if (result.imageData) {
    try {
      const decoded = Buffer.from(result.imageData, 'base64');
      if (decoded.length < 1000) {
        return { passed: false, reason: `Image data suspiciously small (${decoded.length} bytes)`, shouldRetry: true };
      }
    } catch {
      return { passed: false, reason: 'Invalid base64 image data', shouldRetry: true };
    }
  }

  if (result.metadata?.finishReason === 'SAFETY' || result.metadata?.blockReason) {
    return { passed: false, reason: `Safety filter: ${result.metadata.blockReason || result.metadata.finishReason}`, shouldRetry: true };
  }

  return { passed: true, shouldRetry: false };
}

export interface SceneDiversityCheck {
  cameraAngles: string[];
  shotTypes: string[];
}

/**
 * Tier 1: Structural diversity check across a scene's shots.
 * Returns warnings (not blocking) about repeated angles/types.
 *
 * C5: Under an `ArtStyleProfile` that whitelists `centered-composition` or
 * `stiff-pose-ok` we relax the repetition threshold — those styles
 * intentionally reuse symmetrical / tableau staging and we shouldn't
 * spam the operator with false-positive diversity warnings.
 */
export function checkStructuralDiversity(
  shots: Array<{ cameraAngle?: string; shotType?: string; beatId: string }>,
  styleProfile?: ArtStyleProfile,
): { acceptable: boolean; warnings: string[] } {
  const warnings: string[] = [];
  if (shots.length <= 2) return { acceptable: true, warnings };

  const angleCounts = new Map<string, number>();
  const typeCounts = new Map<string, number>();

  for (const shot of shots) {
    const angle = (shot.cameraAngle || 'unknown').toLowerCase();
    const type = (shot.shotType || 'unknown').toLowerCase();
    angleCounts.set(angle, (angleCounts.get(angle) || 0) + 1);
    typeCounts.set(type, (typeCounts.get(type) || 0) + 1);
  }

  const relaxesRepetition = !!styleProfile && (
    styleProfile.acceptableDeviations.includes('no-symmetrical-composition') ||
    styleProfile.acceptableDeviations.includes('no-dead-center') ||
    styleProfile.acceptableDeviations.includes('asymmetric-body-language') ||
    styleProfile.acceptableDeviations.includes('mid-action-posing')
  );
  const thresholdFactor = relaxesRepetition ? 0.8 : 0.6;
  const threshold = Math.ceil(shots.length * thresholdFactor);
  for (const [angle, count] of angleCounts) {
    if (count >= threshold) {
      warnings.push(`Camera angle "${angle}" used ${count}/${shots.length} times`);
    }
  }
  for (const [type, count] of typeCounts) {
    if (count >= threshold) {
      warnings.push(`Shot type "${type}" used ${count}/${shots.length} times`);
    }
  }

  return { acceptable: warnings.length === 0, warnings };
}

/**
 * Tier 2: Build the vision prompt for a consolidated per-scene review.
 * The caller sends this prompt + images to a vision LLM.
 *
 * C5: If an `ArtStyleProfile` is supplied, the rubric is rewritten so the
 * vision model evaluates the image against THIS style's intent instead of
 * a generic cinematic default. Styles that whitelist `stiff-pose-ok` /
 * `centered-composition` soften the pose rubric so we don't flag
 * tableau-style or icon-style intentional stasis.
 */
export function buildTier2VisionPrompt(
  sceneId: string,
  shots: Array<{ shotId: string; beatId: string; promptSummary: string }>,
  styleProfile?: ArtStyleProfile,
): string {
  const shotLines = shots.map((s, i) =>
    `Image ${i + 1} (${s.shotId}): ${s.promptSummary}`
  ).join('\n');

  const allowsStaticPose = !!styleProfile && (
    styleProfile.acceptableDeviations.includes('asymmetric-body-language') ||
    styleProfile.acceptableDeviations.includes('mid-action-posing')
  );
  const poseRubric = allowsStaticPose
    ? `- pose: Is the pose intentional and consistent with the "${styleProfile?.name}" style's visual grammar? Do NOT penalize static or symmetrical poses — they are part of this style.`
    : `- pose: Is the pose dynamic and purposeful (not stiff, neutral, or mannequin-like)?`;

  const styleHeader = styleProfile
    ? `\nThis scene is rendered in the "${styleProfile.name}" style: ${styleProfile.renderingTechnique}\nEvaluate the images AGAINST THIS STYLE — do not expect photoreal lighting, cinematic depth-of-field, or Hollywood staging unless the style explicitly calls for them.\n`
    : '';

  const styleSpecificChecks = styleProfile && styleProfile.inappropriateVocabulary.length > 0
    ? `\nAdditionally flag any image that shows: ${styleProfile.inappropriateVocabulary.slice(0, 6).join(', ')} — these contradict the active style.`
    : '';

  return `You are reviewing ${shots.length} sequential story beat images for scene "${sceneId}".
${styleHeader}
For EACH image, rate these qualities on a 1–5 scale:
- expression: Does the character's facial expression match the requested emotion?
${poseRubric}
- flow: Does this image flow visually from the previous one (consistent setting, logical progression)?
- setting: Does the environment match the scene description?

${shotLines}

Return ONLY a JSON array:
[
  { "shotId": "...", "expression": N, "pose": N, "flow": N, "setting": N, "flagged": true/false, "reason": "one sentence if flagged" },
  ...
]

Flag any image where ANY score is below 3. For the first image, give flow a 5 (no predecessor).${styleSpecificChecks}`;
}

/**
 * Tier 2: Parse the vision LLM response into a scene report.
 */
export function parseTier2Response(
  sceneId: string,
  shots: Array<{ shotId: string; beatId: string }>,
  llmResponse: string,
): Tier2SceneReport {
  const fallbackReport: Tier2SceneReport = {
    sceneId,
    shotReports: shots.map(s => ({
      shotId: s.shotId,
      beatId: s.beatId,
      scores: { expression: 3, pose: 3, flow: 3, setting: 3 },
      averageScore: 3,
      flagged: false,
    })),
    overallScore: 3,
    flaggedCount: 0,
  };

  try {
    const jsonMatch = llmResponse.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return fallbackReport;

    const parsed = JSON.parse(jsonMatch[0]) as Array<{
      shotId: string;
      expression: number;
      pose: number;
      flow: number;
      setting: number;
      flagged?: boolean;
      reason?: string;
    }>;

    const shotReports: Tier2ShotReport[] = [];
    for (const shot of shots) {
      const llmEntry = parsed.find(p => p.shotId === shot.shotId);
      if (!llmEntry) {
        shotReports.push({
          shotId: shot.shotId,
          beatId: shot.beatId,
          scores: { expression: 3, pose: 3, flow: 3, setting: 3 },
          averageScore: 3,
          flagged: false,
        });
        continue;
      }

      const scores = {
        expression: clampScore(llmEntry.expression),
        pose: clampScore(llmEntry.pose),
        flow: clampScore(llmEntry.flow),
        setting: clampScore(llmEntry.setting),
      };
      const avg = (scores.expression + scores.pose + scores.flow + scores.setting) / 4;
      const flagged = llmEntry.flagged === true || scores.expression < 3 || scores.pose < 3 || scores.flow < 3 || scores.setting < 3;

      shotReports.push({
        shotId: shot.shotId,
        beatId: shot.beatId,
        scores,
        averageScore: Math.round(avg * 10) / 10,
        flagged,
        reason: llmEntry.reason,
      });
    }

    const avgScore = shotReports.length > 0
      ? shotReports.reduce((sum, r) => sum + r.averageScore, 0) / shotReports.length
      : 3;

    return {
      sceneId,
      shotReports,
      overallScore: Math.round(avgScore * 10) / 10,
      flaggedCount: shotReports.filter(r => r.flagged).length,
    };
  } catch {
    return fallbackReport;
  }
}

/**
 * Tier 3: Identify images that need targeted regeneration from a QA report.
 */
export function identifyRegenTargets(
  report: VisualQAReport,
  scoreThreshold: number = 2.5,
): Tier3RegenTarget[] {
  const targets: Tier3RegenTarget[] = [];
  for (const scene of report.scenes) {
    for (const shot of scene.shotReports) {
      if (shot.flagged && shot.averageScore < scoreThreshold) {
        targets.push({
          sceneId: scene.sceneId,
          shotId: shot.shotId,
          beatId: shot.beatId,
          reason: shot.reason || `Average score ${shot.averageScore} below threshold ${scoreThreshold}`,
        });
      }
    }
  }
  return targets;
}

function clampScore(n: unknown): number {
  const val = typeof n === 'number' ? n : 3;
  return Math.max(1, Math.min(5, Math.round(val)));
}
