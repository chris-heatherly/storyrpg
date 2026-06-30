/**
 * Episode-granularity completion watermarks (Consistency Plan WS1a).
 *
 * After an episode fully assembles (content + season-canon seal), the pipeline
 * writes two artifacts into the run directory:
 *
 *   checkpoints/episode-{N}-complete.json   — small watermark (metadata only)
 *   checkpoints/episode-{N}-assembled.json  — the full assembled Episode
 *
 * A resumed run pointed at the same output directory probes these per requested
 * episode and rehydrates completed episodes instead of regenerating (and
 * re-paying for) them. A watermark without a loadable assembled artifact — or
 * with a mismatched episode number — is treated as not-complete, so a torn
 * write degrades to regeneration, never to a corrupt resume.
 */

import type { Episode } from '../../types';
import { isPlanningRegisterText } from '../constants/planningRegisterText';
import {
  ArtifactRevisionStore,
  type ArtifactRef,
  type ArtifactValidationSummary,
  type EpisodeContextIn,
  type EpisodeContextOut,
  buildEpisodeContextIn,
  deriveEpisodeContextOut,
  defaultValidationSummary,
} from './artifacts';

export interface EpisodeCompletionWatermark {
  version: 1;
  episodeNumber: number;
  title: string;
  completedAt: string;
  sceneCount: number;
  assembledArtifact: string;
  lock?: EpisodeCompletionLockEvidence;
  artifacts?: EpisodeCompletionArtifactRefs;
}

export type ArtifactSaver = (name: string, data: unknown) => Promise<void>;
export type ArtifactLoader = <T>(name: string) => T | null;

export interface EpisodeCompletionLockEvidence {
  runtimeContractPassed?: boolean;
  canonSealed?: boolean;
  incrementalContractArtifact?: string;
  seasonCanonArtifact?: string;
  seasonLedgerArtifact?: string;
  episodeStateSnapshotArtifact?: string;
}

export interface EpisodeCompletionArtifactRefs {
  contextIn?: ArtifactRef;
  runtimeEpisode?: ArtifactRef;
  validationReport?: ArtifactRef;
  contextOut?: ArtifactRef;
  upstream?: ArtifactRef[];
}

export interface EpisodeShadowArtifactOptions {
  storyId: string;
  runId: string;
  load: ArtifactLoader;
  contextIn?: EpisodeContextIn;
  validation?: ArtifactValidationSummary;
  upstream?: ArtifactRef[];
  onError?: (error: Error) => void;
}

export function episodeCompleteArtifact(episodeNumber: number): string {
  return `checkpoints/episode-${episodeNumber}-complete.json`;
}

export function episodeAssembledArtifact(episodeNumber: number): string {
  return `checkpoints/episode-${episodeNumber}-assembled.json`;
}

/**
 * Persist the assembled episode then its watermark (in that order, so a crash
 * between the two writes leaves no watermark pointing at a missing artifact).
 */
export async function writeEpisodeCompletion(options: {
  episode: Episode;
  episodeNumber: number;
  title: string;
  save: ArtifactSaver;
  shadowArtifacts?: EpisodeShadowArtifactOptions;
  lock?: EpisodeCompletionLockEvidence;
  validation?: ArtifactValidationSummary;
}): Promise<EpisodeCompletionWatermark> {
  const { episode, episodeNumber, title, save, shadowArtifacts } = options;
  const assembledArtifact = episodeAssembledArtifact(episodeNumber);
  await save(assembledArtifact, episode);
  const shadowRefs = shadowArtifacts
    ? await writeEpisodeShadowArtifacts({
      episode,
      episodeNumber,
      title,
      save,
      ...shadowArtifacts,
      validation: options.validation ?? shadowArtifacts.validation,
    })
    : undefined;
  const watermark: EpisodeCompletionWatermark = {
    version: 1,
    episodeNumber,
    title,
    completedAt: new Date().toISOString(),
    sceneCount: Array.isArray(episode.scenes) ? episode.scenes.length : 0,
    assembledArtifact,
    ...(options.lock ? { lock: options.lock } : {}),
    ...(shadowRefs ? { artifacts: shadowRefs } : {}),
  };
  await save(episodeCompleteArtifact(episodeNumber), watermark);

  return watermark;
}

async function writeEpisodeShadowArtifacts(options: {
  episode: Episode;
  episodeNumber: number;
  title: string;
  save: ArtifactSaver;
} & EpisodeShadowArtifactOptions): Promise<EpisodeCompletionArtifactRefs | undefined> {
  try {
    const store = new ArtifactRevisionStore({
      save: options.save,
      load: options.load,
    });
    const previousContextOut = options.episodeNumber > 1
      ? store.loadCurrent<EpisodeContextOut>('context-out', options.episodeNumber - 1)
      : null;
    const upstream = [
      ...(options.upstream ?? []),
      ...(previousContextOut ? [store.refFor(previousContextOut)] : []),
    ];
    const contextInPayload = options.contextIn ?? buildEpisodeContextIn({
      storyId: options.storyId,
      episodeNumber: options.episodeNumber,
      previousContextOut: previousContextOut?.payload,
    });
    const contextIn = await store.saveRevision({
      kind: 'context-in',
      storyId: options.storyId,
      runId: options.runId,
      episodeNumber: options.episodeNumber,
      payload: contextInPayload,
      status: 'valid',
      upstream,
      provenance: { phase: `episode_${options.episodeNumber}`, agent: 'EpisodeContextBuilder' },
      validation: defaultValidationSummary('context-in'),
    });
    const contextInRef = store.refFor(contextIn);

    const runtimeEpisode = await store.saveRevision({
      kind: 'runtime-episode',
      storyId: options.storyId,
      runId: options.runId,
      episodeNumber: options.episodeNumber,
      payload: options.episode,
      status: 'valid',
      upstream: [contextInRef],
      provenance: { phase: `episode_${options.episodeNumber}`, agent: 'FullStoryPipeline' },
      validation: options.validation ?? defaultValidationSummary('runtime-episode'),
    });
    const runtimeRef = store.refFor(runtimeEpisode);

    const validationReport = await store.saveRevision({
      kind: 'validation-report',
      storyId: options.storyId,
      runId: options.runId,
      episodeNumber: options.episodeNumber,
      payload: {
        title: options.title,
        episodeNumber: options.episodeNumber,
        runtimeEpisode: runtimeRef,
        validation: options.validation ?? defaultValidationSummary('runtime-episode'),
      },
      status: 'valid',
      upstream: [runtimeRef],
      provenance: { phase: `episode_${options.episodeNumber}`, agent: 'ArtifactValidationGate' },
      validation: options.validation ?? defaultValidationSummary('validation-report'),
    });

    const contextOut = await store.saveRevision({
      kind: 'context-out',
      storyId: options.storyId,
      runId: options.runId,
      episodeNumber: options.episodeNumber,
      payload: deriveEpisodeContextOut({
        storyId: options.storyId,
        episode: options.episode,
        contextIn: contextInPayload,
      }),
      status: 'valid',
      upstream: [runtimeRef, store.refFor(validationReport)],
      provenance: { phase: `episode_${options.episodeNumber}`, agent: 'EpisodeContextBuilder' },
      validation: defaultValidationSummary('context-out'),
    });
    return {
      contextIn: contextInRef,
      runtimeEpisode: runtimeRef,
      validationReport: store.refFor(validationReport),
      contextOut: store.refFor(contextOut),
      upstream,
    };
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    if (options.onError) {
      options.onError(err);
    } else {
      console.warn(`[EpisodeArtifacts] Shadow artifact write failed for episode ${options.episodeNumber}: ${err.message}`);
    }
    return undefined;
  }
}

export interface ResumedEpisode {
  episode: Episode;
  watermark: EpisodeCompletionWatermark;
}

/**
 * Probe one episode number for a valid completion watermark + assembled
 * episode. Returns null unless both load and agree on the episode number.
 */
export function loadCompletedEpisode(
  episodeNumber: number,
  load: ArtifactLoader,
): ResumedEpisode | null {
  const watermark = load<EpisodeCompletionWatermark>(episodeCompleteArtifact(episodeNumber));
  if (!watermark || watermark.version !== 1 || watermark.episodeNumber !== episodeNumber) return null;
  if (watermark.lock?.runtimeContractPassed === false) return null;
  if (watermark.lock?.seasonCanonArtifact && watermark.lock.canonSealed !== true) return null;
  const incrementalContract = load<{
    passed?: boolean;
    blockingCount?: number;
    blockingIssues?: unknown[];
  }>(`episode-${episodeNumber}-incremental-contract.json`);
  if (
    incrementalContract
    && (
      incrementalContract.passed === false
      || (incrementalContract.blockingCount ?? 0) > 0
      || (incrementalContract.blockingIssues?.length ?? 0) > 0
    )
  ) {
    return null;
  }
  const episode = load<Episode>(watermark.assembledArtifact);
  if (!episode || typeof episode !== 'object') return null;
  if (typeof episode.number === 'number' && episode.number !== episodeNumber) return null;
  if (!Array.isArray(episode.scenes) || episode.scenes.length === 0) return null;
  return { episode, watermark };
}

/** Which of the requested episodes already completed in this run directory. */
export function detectCompletedEpisodes(
  episodeNumbers: number[],
  load: ArtifactLoader,
): number[] {
  return episodeNumbers.filter((n) => loadCompletedEpisode(n, load) !== null);
}

/**
 * Split planned episode specs into already-completed (rehydrated from
 * watermarks) and still-pending. A fresh run dir has no watermarks, so this
 * is a no-op outside resume.
 */
export function partitionResumableEpisodes<S extends { episodeNumber: number }>(
  specs: S[],
  load: ArtifactLoader,
): { pending: S[]; resumed: Array<{ spec: S } & ResumedEpisode> } {
  const pending: S[] = [];
  const resumed: Array<{ spec: S } & ResumedEpisode> = [];
  for (const spec of specs) {
    const hit = loadCompletedEpisode(spec.episodeNumber, load);
    if (hit) resumed.push({ spec, ...hit });
    else pending.push(spec);
  }
  return { pending, resumed };
}

export function loadResumedEpisodeDiagnostics<Q = unknown, B = unknown>(
  episodeNumber: number,
  load: ArtifactLoader,
): { qaReport?: Q; bestPracticesReport?: B; incrementalContract?: ResumedIncrementalContractShape } {
  const qaReport =
    load<Q>(`episode-${episodeNumber}-qa-report.post-repair.json`) ??
    load<Q>(`episode-${episodeNumber}-qa-report.json`) ??
    undefined;
  const bestPracticesReport =
    load<B>(`episode-${episodeNumber}-best-practices-report.json`) ??
    undefined;
  const incrementalContract =
    load<ResumedIncrementalContractShape>(`episode-${episodeNumber}-incremental-contract.json`) ??
    undefined;
  return { qaReport, bestPracticesReport, incrementalContract };
}

interface ResumedQAReportShape {
  overallScore?: number;
  qualityScore?: number;
  passesQA?: boolean;
  criticalIssues?: unknown[];
  voice?: {
    overallScore?: number;
    recommendations?: unknown[];
  };
}

interface ResumedBestPracticesShape {
  overallPassed?: boolean;
  blockingIssues?: unknown[];
}

interface ResumedContractIssueShape {
  validator?: string;
  severity?: string;
  type?: string;
  message?: string;
}

interface ResumedIncrementalContractShape {
  passed?: boolean;
  blockingCount?: number;
  blockingIssues?: ResumedContractIssueShape[];
  warnings?: ResumedContractIssueShape[];
}

export interface ResumedEpisodeInvalidationInput {
  episode?: Episode;
  qaReport?: ResumedQAReportShape;
  bestPracticesReport?: ResumedBestPracticesShape;
  incrementalContract?: ResumedIncrementalContractShape;
  requireQaReport?: boolean;
  requireBestPracticesReport?: boolean;
}

const QUALITY_SCAN_SKIPPED_KEY = /(id|flag|next|starting|imageData|base64|url|path|uri|sha|hash)$/i;
const RESUMED_EPISODE_MIN_QA_SCORE = 90;

function hasPlanningRegisterLeak(value: unknown, key = ''): boolean {
  if (typeof value === 'string') {
    if (QUALITY_SCAN_SKIPPED_KEY.test(key)) return false;
    return isPlanningRegisterText(value);
  }
  if (!value || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some((item) => hasPlanningRegisterLeak(item, key));
  return Object.entries(value as Record<string, unknown>).some(([childKey, child]) =>
    !QUALITY_SCAN_SKIPPED_KEY.test(childKey) && hasPlanningRegisterLeak(child, childKey),
  );
}

export function findResumedEpisodeInvalidationReasons(input: ResumedEpisodeInvalidationInput): string[] {
  const reasons: string[] = [];
  const qa = input.qaReport;
  const bp = input.bestPracticesReport;

  if (input.requireQaReport && !qa) {
    reasons.push('missing_qa_report');
  }
  if (qa) {
    if (qa.passesQA === false) reasons.push('qa_failed');
    const qaScore = typeof qa.qualityScore === 'number' ? qa.qualityScore : qa.overallScore;
    if (typeof qaScore === 'number' && qaScore < RESUMED_EPISODE_MIN_QA_SCORE) reasons.push('qa_below_quality_floor');
    if ((qa.criticalIssues?.length ?? 0) > 0) reasons.push('qa_critical_issues');
    const voiceRecommendations = (qa.voice?.recommendations ?? []).join(' ');
    if ((qa.voice?.overallScore ?? 0) <= 0 && /voice check failed|manual review required/i.test(voiceRecommendations)) {
      reasons.push('voice_validation_failed_closed');
    }
  }

  if (input.requireBestPracticesReport && !bp) {
    reasons.push('missing_best_practices_report');
  }
  if (bp) {
    if (bp.overallPassed === false) reasons.push('best_practices_failed');
    if ((bp.blockingIssues?.length ?? 0) > 0) reasons.push('best_practices_blocking_issues');
  }

  const contract = input.incrementalContract;
  if (contract) {
    if (contract.passed === false || (contract.blockingCount ?? 0) > 0 || (contract.blockingIssues?.length ?? 0) > 0) {
      reasons.push('incremental_contract_failed');
    }
    const treatmentWarnings = (contract.warnings ?? []).filter((issue) =>
      issue.validator === 'RequiredBeatRealizationValidator'
      || issue.type === 'treatment_fidelity_violation'
      || /authored required beat is missing/i.test(issue.message ?? ''),
    );
    if (treatmentWarnings.length > 0) reasons.push('treatment_realization_warning');
  }

  if (input.episode && hasPlanningRegisterLeak(input.episode)) {
    reasons.push('planning_register_prose');
  }

  return Array.from(new Set(reasons));
}
