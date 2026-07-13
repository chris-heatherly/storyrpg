import type { SeasonPlan } from '../../types/seasonPlan';
import type { SourceMaterialAnalysis } from '../../types/sourceAnalysis';
import { stableHash } from './artifacts/store';
import { PipelineError } from './errors';

export const GENERATION_MANIFEST_VERSION = 1 as const;

export type GenerationSourceKind = 'invent' | 'authored' | 'authored_lite' | 'derived_from_lite';

export interface GenerationManifest {
  version: typeof GENERATION_MANIFEST_VERSION;
  sourceKind: GenerationSourceKind;
  requestedEpisodes: number[];
  sourceAnalysisHash?: string;
  seasonPlanId?: string;
  seasonPlanHash?: string;
  narrativeGraphHash?: string;
  compilerVersion?: string;
}

export interface GenerationPreflightIssue {
  code:
    | 'generation_manifest_missing'
    | 'generation_manifest_version_invalid'
    | 'generation_manifest_copy_mismatch'
    | 'generation_source_kind_mismatch'
    | 'generation_source_analysis_hash_mismatch'
    | 'generation_season_plan_missing'
    | 'generation_season_plan_id_mismatch'
    | 'generation_season_plan_hash_mismatch'
    | 'generation_season_graph_missing'
    | 'generation_season_graph_invalid'
    | 'generation_season_graph_hash_mismatch'
    | 'generation_episode_missing'
    | 'generation_episode_scene_plan_missing'
    | 'generation_episode_event_plan_missing'
    | 'generation_episode_event_plan_invalid'
    | 'generation_episode_scope_mismatch';
  message: string;
  episodeNumber?: number;
}

/** Hash the exact JSON wire representation so browser Date objects match worker hydration. */
export function generationArtifactHash(value: unknown): string {
  return stableHash(JSON.parse(JSON.stringify(value)));
}

interface GenerationBriefSurface {
  seasonPlan?: SeasonPlan;
  generationManifest?: GenerationManifest;
}

export function inferGenerationSourceKind(
  analysis?: SourceMaterialAnalysis | null,
): GenerationSourceKind {
  if (!analysis) return 'invent';
  const declared = analysis.treatmentSeasonGuidance?.sourceKind
    ?? analysis.episodeBreakdown?.find((episode) => episode.treatmentGuidance?.sourceKind)?.treatmentGuidance?.sourceKind;
  if (declared) return declared;
  if (analysis.treatmentMetadata?.formatVersion === 'story-treatment-lite') return 'authored_lite';
  if (analysis.sourceFormat === 'story_treatment' || analysis.treatmentMetadata?.detected) return 'authored';
  return 'invent';
}

export function requiresCanonicalSeasonPlan(sourceKind: GenerationSourceKind): boolean {
  return sourceKind !== 'invent';
}

export function normalizeRequestedEpisodes(
  episodeRange: { start: number; end: number; specific?: number[] } | undefined,
  fallbackEpisode = 1,
): number[] {
  const values = episodeRange?.specific?.length
    ? episodeRange.specific
    : episodeRange
      ? Array.from({ length: Math.max(0, episodeRange.end - episodeRange.start + 1) }, (_, index) => episodeRange.start + index)
      : [fallbackEpisode];
  return [...new Set(values.filter((episode) => Number.isInteger(episode) && episode > 0))].sort((a, b) => a - b);
}

export function buildGenerationManifest(input: {
  sourceAnalysis?: SourceMaterialAnalysis | null;
  seasonPlan?: SeasonPlan | null;
  requestedEpisodes: number[];
}): GenerationManifest {
  const graph = input.seasonPlan?.scenePlan?.narrativeContractGraph;
  return {
    version: GENERATION_MANIFEST_VERSION,
    sourceKind: inferGenerationSourceKind(input.sourceAnalysis),
    requestedEpisodes: normalizeRequestedEpisodes(
      input.requestedEpisodes.length > 0
        ? { start: Math.min(...input.requestedEpisodes), end: Math.max(...input.requestedEpisodes), specific: input.requestedEpisodes }
        : undefined,
    ),
    sourceAnalysisHash: input.sourceAnalysis ? generationArtifactHash(input.sourceAnalysis) : undefined,
    seasonPlanId: input.seasonPlan?.id,
    seasonPlanHash: input.seasonPlan ? generationArtifactHash(input.seasonPlan) : undefined,
    narrativeGraphHash: graph?.sourceHash,
    compilerVersion: graph?.compilerVersion,
  };
}

export function validateGenerationPreflight(input: {
  brief: GenerationBriefSurface;
  sourceAnalysis?: SourceMaterialAnalysis | null;
  episodeRange?: { start: number; end: number; specific?: number[] };
  manifest?: GenerationManifest;
  fallbackEpisode?: number;
}): GenerationPreflightIssue[] {
  const manifest = input.manifest ?? input.brief.generationManifest;
  const actualSourceKind = inferGenerationSourceKind(input.sourceAnalysis);
  const requestedEpisodes = normalizeRequestedEpisodes(input.episodeRange, input.fallbackEpisode);
  const issues: GenerationPreflightIssue[] = [];

  if (!manifest) {
    if (requiresCanonicalSeasonPlan(actualSourceKind)) {
      issues.push({ code: 'generation_manifest_missing', message: `A ${actualSourceKind} run requires an immutable generation manifest.` });
    }
    return issues;
  }
  if (manifest.version !== GENERATION_MANIFEST_VERSION) {
    issues.push({ code: 'generation_manifest_version_invalid', message: `Generation manifest version ${manifest.version} is unsupported.` });
  }
  if (
    input.manifest
    && input.brief.generationManifest
    && generationArtifactHash(input.manifest) !== generationArtifactHash(input.brief.generationManifest)
  ) {
    issues.push({ code: 'generation_manifest_copy_mismatch', message: 'Worker manifest does not match the manifest embedded in the creative brief.' });
  }
  if (manifest.sourceKind !== actualSourceKind) {
    issues.push({ code: 'generation_source_kind_mismatch', message: `Generation manifest sourceKind ${manifest.sourceKind} does not match source analysis ${actualSourceKind}.` });
  }
  if (input.sourceAnalysis && manifest.sourceAnalysisHash !== generationArtifactHash(input.sourceAnalysis)) {
    issues.push({ code: 'generation_source_analysis_hash_mismatch', message: 'Source analysis changed after the generation manifest was committed.' });
  }
  if (manifest.requestedEpisodes.join(',') !== requestedEpisodes.join(',')) {
    issues.push({ code: 'generation_episode_scope_mismatch', message: `Generation manifest episodes [${manifest.requestedEpisodes.join(', ')}] do not match requested episodes [${requestedEpisodes.join(', ')}].` });
  }

  if (!requiresCanonicalSeasonPlan(actualSourceKind)) return issues;

  const plan = input.brief.seasonPlan;
  if (!plan) {
    issues.push({ code: 'generation_season_plan_missing', message: `A ${actualSourceKind} run cannot start without its canonical season plan.` });
    return issues;
  }
  if (manifest.seasonPlanId !== plan.id) {
    issues.push({ code: 'generation_season_plan_id_mismatch', message: `Generation manifest plan ${manifest.seasonPlanId || 'missing'} does not match attached plan ${plan.id}.` });
  }
  if (manifest.seasonPlanHash !== generationArtifactHash(plan)) {
    issues.push({ code: 'generation_season_plan_hash_mismatch', message: 'Season plan changed after the generation manifest was committed.' });
  }

  const scenePlan = plan.scenePlan;
  const graph = scenePlan?.narrativeContractGraph;
  if (!graph) {
    issues.push({ code: 'generation_season_graph_missing', message: 'Canonical NarrativeContractGraph is missing from the season plan.' });
  } else {
    if (!graph.validation?.passed) {
      issues.push({ code: 'generation_season_graph_invalid', message: 'Canonical NarrativeContractGraph did not pass compilation validation.' });
    }
    if (manifest.narrativeGraphHash !== graph.sourceHash || manifest.compilerVersion !== graph.compilerVersion) {
      issues.push({ code: 'generation_season_graph_hash_mismatch', message: 'NarrativeContractGraph revision does not match the committed generation manifest.' });
    }
  }

  for (const episodeNumber of requestedEpisodes) {
    const episode = plan.episodes?.find((candidate) => candidate.episodeNumber === episodeNumber);
    if (!episode) {
      issues.push({ code: 'generation_episode_missing', episodeNumber, message: `Season plan has no Episode ${episodeNumber}.` });
      continue;
    }
    const plannedScenes = scenePlan?.scenes?.filter((scene) => scene.episodeNumber === episodeNumber) ?? [];
    if (plannedScenes.length === 0 || !episode.plannedScenes?.length) {
      issues.push({ code: 'generation_episode_scene_plan_missing', episodeNumber, message: `Episode ${episodeNumber} has no canonical planned scenes.` });
    }
    const eventPlan = scenePlan?.episodeEventPlans?.[episodeNumber];
    if (!eventPlan) {
      issues.push({ code: 'generation_episode_event_plan_missing', episodeNumber, message: `Episode ${episodeNumber} has no immutable EpisodeEventPlan.` });
    } else if (!eventPlan.validation?.passed || eventPlan.sourceGraphHash !== graph?.sourceHash) {
      issues.push({ code: 'generation_episode_event_plan_invalid', episodeNumber, message: `Episode ${episodeNumber} EpisodeEventPlan is invalid or references a different graph revision.` });
    }
  }
  return issues;
}

export function assertGenerationPreflight(input: Parameters<typeof validateGenerationPreflight>[0]): void {
  const issues = validateGenerationPreflight(input);
  if (issues.length === 0) return;
  throw new PipelineError(
    `[GenerationPreflight] ${issues.map((issue) => issue.message).join(' | ')}`,
    'generation_preflight',
    {
      context: { issues },
      failure: {
        code: 'generation_preflight_invalid',
        ownerStage: 'season_plan',
        retryClass: 'none',
        issueCodes: issues.map((issue) => issue.code),
        repairTarget: 'generation-manifest',
      },
    },
  );
}

/** Last-resort defense for direct FullStoryPipeline callers that bypass the service preflight. */
export function assertCanonicalPlanAttached(
  brief: GenerationBriefSurface,
  analysis: SourceMaterialAnalysis,
): void {
  if (brief.seasonPlan || !requiresCanonicalSeasonPlan(inferGenerationSourceKind(analysis))) return;
  throw new PipelineError(
    'Treatment-sourced run has no canonical season plan. Generation cannot select an invent-mode compatibility path.',
    'generation_preflight',
    {
      failure: {
        code: 'generation_preflight_invalid',
        ownerStage: 'season_plan',
        retryClass: 'none',
        issueCodes: ['generation_season_plan_missing'],
        repairTarget: 'generation-manifest',
      },
    },
  );
}
