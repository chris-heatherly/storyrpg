import type { SeasonArc } from '../../types/seasonPlan';
import type { SourceMaterialAnalysis } from '../../types/sourceAnalysis';
import { arcGuidanceId } from '../utils/arcPressureContracts';

export type SeasonArcTopologyIssueCode =
  | 'authored_arc_missing'
  | 'authored_arc_duplicate'
  | 'unknown_arc_rejected';

export interface CanonicalSeasonArcSkeleton {
  id: string;
  name: string;
  description: string;
  episodeRange: { start: number; end: number };
  sourceText: string;
  sourceArcIndex: number;
}

export interface SeasonArcTopologyIssue {
  code: SeasonArcTopologyIssueCode;
  arcId?: string;
  candidateArcId?: string;
  message: string;
}

export interface SeasonArcTopologyReconciliation {
  arcs: Partial<SeasonArc>[];
  acceptedEnrichments: Partial<SeasonArc>[];
  missingArcIds: string[];
  issues: SeasonArcTopologyIssue[];
  requiresLlmRepair: boolean;
}

export interface SeasonArcTopologyReconciliationOptions {
  /** Legacy checkpoint migration only; new provider output must use stable arc IDs. */
  allowLegacyIdentityMatching?: boolean;
}

function normalizedIdentity(value: unknown): string {
  return typeof value === 'string'
    ? value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
    : '';
}

function sameRange(
  left: Partial<SeasonArc>['episodeRange'] | undefined,
  right: CanonicalSeasonArcSkeleton['episodeRange'],
): boolean {
  return left?.start === right.start && left?.end === right.end;
}

function matchingSkeleton(
  candidate: Partial<SeasonArc>,
  canonical: CanonicalSeasonArcSkeleton[],
  options: SeasonArcTopologyReconciliationOptions,
): CanonicalSeasonArcSkeleton | undefined {
  const candidateId = normalizedIdentity(candidate.id);
  if (candidateId) {
    const byId = canonical.find((arc) => normalizedIdentity(arc.id) === candidateId);
    if (byId) return byId;
  }

  if (options.allowLegacyIdentityMatching !== true) return undefined;

  const candidateName = normalizedIdentity(candidate.name);
  if (candidateName) {
    const byName = canonical.find((arc) => normalizedIdentity(arc.name) === candidateName);
    if (byName) return byName;
  }

  return canonical.find((arc) => sameRange(candidate.episodeRange, arc.episodeRange));
}

export function compileCanonicalSeasonArcTopology(
  analysis: Pick<
    SourceMaterialAnalysis,
    'totalEstimatedEpisodes' | 'storyArcs' | 'treatmentSeasonGuidance'
  >,
): CanonicalSeasonArcSkeleton[] {
  const authoredArcs = analysis.treatmentSeasonGuidance?.arcGuidance?.arcs ?? [];
  if (authoredArcs.length === 0) return [];

  const totalEpisodes = Math.max(1, analysis.totalEstimatedEpisodes || 1);
  return authoredArcs
    .slice()
    .sort((left, right) => left.arcIndex - right.arcIndex)
    .map((guidance) => {
      const sourceArc = analysis.storyArcs.find((arc) =>
        arc.id === arcGuidanceId(guidance)
        || normalizedIdentity(arc.name) === normalizedIdentity(guidance.title)
        || (
          guidance.episodeRange
          && arc.estimatedEpisodeRange.start === guidance.episodeRange.start
          && arc.estimatedEpisodeRange.end === guidance.episodeRange.end
        )
      );
      const sourceRange = guidance.episodeRange ?? sourceArc?.estimatedEpisodeRange ?? {
        start: 1,
        end: totalEpisodes,
      };
      const start = Math.max(1, Math.min(totalEpisodes, sourceRange.start));
      const end = Math.max(start, Math.min(totalEpisodes, sourceRange.end));

      return {
        id: arcGuidanceId(guidance),
        name: guidance.title,
        description: guidance.arcDramaticQuestion
          || sourceArc?.description
          || guidance.relationToSeasonQuestion
          || guidance.sourceText,
        episodeRange: { start, end },
        sourceText: guidance.sourceText,
        sourceArcIndex: guidance.arcIndex,
      };
    });
}

/**
 * Treat provider arcs as enrichments of a canonical authored topology. Missing
 * arcs require another authoring call; unknown arcs are discarded because a
 * downstream model cannot expand or collapse treatment-owned structure.
 */
export function reconcileAuthoredSeasonArcs(
  canonical: CanonicalSeasonArcSkeleton[],
  candidateArcs: unknown,
  options: SeasonArcTopologyReconciliationOptions = {},
): SeasonArcTopologyReconciliation {
  const candidates = Array.isArray(candidateArcs)
    ? candidateArcs.filter((arc): arc is Partial<SeasonArc> => Boolean(arc) && typeof arc === 'object')
    : [];
  const acceptedById = new Map<string, Partial<SeasonArc>>();
  const duplicatedArcIds = new Set<string>();
  const issues: SeasonArcTopologyIssue[] = [];

  for (const candidate of candidates) {
    const skeleton = matchingSkeleton(candidate, canonical, options);
    if (!skeleton) {
      issues.push({
        code: 'unknown_arc_rejected',
        candidateArcId: candidate.id,
        message: `Rejected provider arc "${candidate.name || candidate.id || 'unknown'}" because it does not carry a recognized authored arc ID.`,
      });
      continue;
    }
    if (acceptedById.has(skeleton.id)) {
      acceptedById.delete(skeleton.id);
      duplicatedArcIds.add(skeleton.id);
      issues.push({
        code: 'authored_arc_duplicate',
        arcId: skeleton.id,
        candidateArcId: candidate.id,
        message: `Provider returned multiple enrichments for authored arc "${skeleton.id}".`,
      });
      continue;
    }
    if (duplicatedArcIds.has(skeleton.id)) continue;
    acceptedById.set(skeleton.id, candidate);
  }

  const missingArcIds: string[] = [];
  const arcs = canonical.map((skeleton) => {
    const enrichment = acceptedById.get(skeleton.id);
    if (!enrichment) {
      missingArcIds.push(skeleton.id);
      issues.push({
        code: 'authored_arc_missing',
        arcId: skeleton.id,
        message: `Provider omitted authored arc "${skeleton.id}" (${skeleton.name}, Episodes ${skeleton.episodeRange.start}-${skeleton.episodeRange.end}).`,
      });
    }
    return {
      ...(enrichment ?? {}),
      id: skeleton.id,
      name: skeleton.name,
      description: skeleton.description,
      episodeRange: { ...skeleton.episodeRange },
    };
  });

  return {
    arcs,
    acceptedEnrichments: [...acceptedById.values()],
    missingArcIds,
    issues,
    requiresLlmRepair: missingArcIds.length > 0,
  };
}
