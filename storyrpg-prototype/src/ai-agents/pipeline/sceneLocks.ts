import type { Episode } from '../../types';
import type { SceneValidationResult } from '../validators/IncrementalValidators';
import type { ArtifactValidationIssue, ArtifactValidationSummary } from './artifacts';

export interface SceneLockEvidence {
  version: 1;
  episodeNumber?: number;
  sceneId: string;
  sceneName: string;
  lockedAt: string;
  passed: boolean;
  regenerationRequested: SceneValidationResult['regenerationRequested'];
  issueCount: number;
  blockingIssueCount: number;
  warningCount: number;
  validation: ArtifactValidationSummary;
}

export interface EpisodeSceneLockReport {
  version: 1;
  episodeNumber: number;
  generatedAt: string;
  expectedSceneIds: string[];
  lockedSceneCount: number;
  passed: boolean;
  locks: SceneLockEvidence[];
  validation: ArtifactValidationSummary;
}

interface ExpectedScene {
  id: string;
}

export function sceneLockArtifactName(episodeNumber: number): string {
  return `episode-${episodeNumber}-scene-locks.json`;
}

export function buildSceneLockEvidence(
  result: SceneValidationResult,
  lockedAt = new Date().toISOString(),
): SceneLockEvidence {
  const issues = sceneValidationIssues(result);
  const blockingIssueCount = issues.filter((issue) => issue.severity === 'error').length;
  const warningCount = issues.filter((issue) => issue.severity === 'warning').length;
  const validation: ArtifactValidationSummary = {
    passed: result.overallPassed && blockingIssueCount === 0,
    gate: 'scene_lock',
    issues,
  };
  if (!validation.passed && issues.length === 0) {
    validation.issues.push({
      validator: 'SceneLockGate',
      severity: 'error',
      message: `Scene ${result.sceneId} failed incremental validation without structured issue detail.`,
      code: 'scene_validation_failed',
      path: scenePath(result),
    });
  }
  return {
    version: 1,
    episodeNumber: result.episodeNumber,
    sceneId: result.sceneId,
    sceneName: result.sceneName,
    lockedAt,
    passed: validation.passed,
    regenerationRequested: result.regenerationRequested,
    issueCount: validation.issues.length,
    blockingIssueCount: validation.issues.filter((issue) => issue.severity === 'error').length,
    warningCount: validation.issues.filter((issue) => issue.severity === 'warning').length,
    validation,
  };
}

export function buildEpisodeSceneLockReport(params: {
  episodeNumber: number;
  episode: Episode;
  validationResults: SceneValidationResult[];
  generatedAt?: string;
}): EpisodeSceneLockReport {
  const generatedAt = params.generatedAt ?? new Date().toISOString();
  const expectedScenes = expectedScenesForEpisode(params.episode);
  const locks = expectedScenes
    .map((scene) => latestSceneResult(params.validationResults, params.episodeNumber, scene.id))
    .filter((result): result is SceneValidationResult => Boolean(result))
    .map((result) => buildSceneLockEvidence(result, generatedAt));

  const lockedSceneIds = new Set(locks.map((lock) => lock.sceneId));
  const missingIssues = expectedScenes
    .filter((scene) => !lockedSceneIds.has(scene.id))
    .map((scene): ArtifactValidationIssue => ({
      validator: 'SceneLockGate',
      severity: 'error',
      message: `Episode ${params.episodeNumber} scene ${scene.id} has no incremental scene validation lock.`,
      code: 'missing_scene_validation_lock',
      path: `episodes[${params.episodeNumber}].scenes[${scene.id}]`,
    }));

  const lockIssues = locks.flatMap((lock) => {
    const issues = [...lock.validation.issues];
    if (!lock.passed && !issues.some((issue) => issue.severity === 'error')) {
      issues.push({
        validator: 'SceneLockGate',
        severity: 'error' as const,
        message: `Episode ${params.episodeNumber} scene ${lock.sceneId} did not pass incremental scene validation.`,
        code: 'failed_scene_validation_lock',
        path: `episodes[${params.episodeNumber}].scenes[${lock.sceneId}]`,
      });
    }
    return issues;
  });
  const issues = [...missingIssues, ...lockIssues];
  const validation: ArtifactValidationSummary = {
    passed: issues.every((issue) => issue.severity !== 'error'),
    gate: `scene_locks_ep_${params.episodeNumber}`,
    issues,
  };

  return {
    version: 1,
    episodeNumber: params.episodeNumber,
    generatedAt,
    expectedSceneIds: expectedScenes.map((scene) => scene.id),
    lockedSceneCount: locks.length,
    passed: validation.passed,
    locks,
    validation,
  };
}

export function mergeArtifactValidationSummaries(
  gate: string,
  summaries: ArtifactValidationSummary[],
): ArtifactValidationSummary {
  const issues = summaries.flatMap((summary) => summary.issues);
  const reportRefs = summaries.flatMap((summary) => summary.reportRefs ?? []);
  return {
    passed: summaries.every((summary) => summary.passed) && issues.every((issue) => issue.severity !== 'error'),
    gate,
    issues,
    ...(reportRefs.length > 0 ? { reportRefs } : {}),
  };
}

function expectedScenesForEpisode(episode: Episode): ExpectedScene[] {
  return (episode.scenes ?? [])
    .map((scene) => ({
      id: String(scene.id ?? '').trim(),
    }))
    .filter((scene) => scene.id.length > 0);
}

function latestSceneResult(
  results: SceneValidationResult[],
  episodeNumber: number,
  sceneId: string,
): SceneValidationResult | undefined {
  for (let idx = results.length - 1; idx >= 0; idx -= 1) {
    const result = results[idx];
    if (result.sceneId !== sceneId) continue;
    if (result.episodeNumber !== episodeNumber && result.episodeNumber !== undefined) continue;
    return result;
  }
  return undefined;
}

function sceneValidationIssues(result: SceneValidationResult): ArtifactValidationIssue[] {
  const issues: ArtifactValidationIssue[] = [];
  appendIssueList(issues, result, 'PovClarityValidator', result.povClarity, 'issues');
  appendIssueList(issues, result, 'IncrementalVoiceValidator', result.voice, 'issues');
  appendIssueList(issues, result, 'IncrementalStakesValidator', result.stakes, 'issues');
  appendIssueList(issues, result, 'IncrementalSensitivityChecker', result.sensitivity, 'flags', 'warning');
  appendIssueList(issues, result, 'IncrementalContinuityChecker', result.continuity, 'issues');
  appendIssueList(issues, result, 'IncrementalEncounterValidator', result.encounter, 'issues');
  appendIssueList(issues, result, 'SceneCraftValidator', result.craft, 'issues');
  appendIssueList(issues, result, 'IntensityDistributionValidator', result.intensityDistribution, 'issues');
  appendIssueList(issues, result, 'MechanicsLeakageValidator', result.mechanicsLeakage, 'issues');
  if (result.emptyScene) {
    issues.push({
      validator: 'SceneLockGate',
      severity: 'error',
      message: `Scene ${result.sceneId} has no authored beats and no runtime encounter.`,
      code: 'empty_scene',
      path: scenePath(result),
    });
  }
  return issues;
}

function appendIssueList(
  out: ArtifactValidationIssue[],
  result: SceneValidationResult,
  validator: string,
  block: unknown,
  field: 'issues' | 'flags',
  fallbackSeverity: ArtifactValidationIssue['severity'] = 'error',
): void {
  const items = issueItems(block, field);
  for (const item of items) {
    out.push({
      validator,
      severity: issueSeverity(item, fallbackSeverity),
      message: issueMessage(item),
      code: issueCode(item),
      path: issuePath(item, result),
    });
  }
}

function issueItems(block: unknown, field: 'issues' | 'flags'): unknown[] {
  if (!block || typeof block !== 'object') return [];
  const items = (block as Record<string, unknown>)[field];
  return Array.isArray(items) ? items : [];
}

function issueSeverity(
  issue: unknown,
  fallback: ArtifactValidationIssue['severity'],
): ArtifactValidationIssue['severity'] {
  if (!issue || typeof issue !== 'object') return fallback;
  const raw = (issue as Record<string, unknown>).severity;
  if (raw === 'error' || raw === 'warning' || raw === 'info') return raw;
  if (raw === 'strong') return 'error';
  if (raw === 'moderate' || raw === 'mild') return 'warning';
  return fallback;
}

function issueMessage(issue: unknown): string {
  if (!issue || typeof issue !== 'object') return 'Scene validation issue.';
  const record = issue as Record<string, unknown>;
  for (const key of ['message', 'issue', 'detail', 'context', 'excerpt']) {
    if (typeof record[key] === 'string' && record[key].trim()) return record[key] as string;
  }
  if (typeof record.type === 'string') return record.type;
  if (typeof record.category === 'string') return record.category;
  return 'Scene validation issue.';
}

function issueCode(issue: unknown): string | undefined {
  if (!issue || typeof issue !== 'object') return undefined;
  const record = issue as Record<string, unknown>;
  for (const key of ['code', 'type', 'category']) {
    if (typeof record[key] === 'string' && record[key].trim()) return record[key] as string;
  }
  return undefined;
}

function issuePath(issue: unknown, result: SceneValidationResult): string {
  if (issue && typeof issue === 'object') {
    const record = issue as Record<string, unknown>;
    if (typeof record.location === 'string' && record.location.trim()) return record.location;
    if (typeof record.beatId === 'string' && record.beatId.trim()) {
      return `${scenePath(result)}.beats[${record.beatId}]`;
    }
    const location = record.location;
    if (location && typeof location === 'object') {
      const beatId = (location as Record<string, unknown>).beatId;
      if (typeof beatId === 'string' && beatId.trim()) return `${scenePath(result)}.beats[${beatId}]`;
    }
    if (typeof record.choiceId === 'string' && record.choiceId.trim()) {
      return `${scenePath(result)}.choices[${record.choiceId}]`;
    }
  }
  return scenePath(result);
}

function scenePath(result: SceneValidationResult): string {
  return typeof result.episodeNumber === 'number'
    ? `episodes[${result.episodeNumber}].scenes[${result.sceneId}]`
    : `scenes[${result.sceneId}]`;
}
