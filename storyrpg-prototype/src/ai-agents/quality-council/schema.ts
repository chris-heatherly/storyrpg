import type { StructuredJsonSchema } from '../agents/BaseAgent';
import {
  COUNCIL_CATEGORIES,
  COUNCIL_REPAIR_ROUTES,
  CouncilAgentOutput,
  CouncilCategory,
  CouncilCheckpoint,
  CouncilConfidence,
  CouncilFinding,
  CouncilRepairRoute,
  CouncilSeverity,
  StoryCouncilCandidateComparison,
  StoryCouncilCandidateEvaluation,
} from './types';

const severities: readonly CouncilSeverity[] = ['info', 'warning', 'error'] as const;
const confidences: readonly CouncilConfidence[] = ['low', 'medium', 'high'] as const;
const candidateScoreKeys = [
  'dramaticCausality',
  'characterPressure',
  'playerAgency',
  'routeDifferentiation',
  'setupPayoff',
  'relationshipPacing',
  'sceneEconomy',
  'sourceFidelity',
] as const;

export function buildCandidateComparisonSchema(): StructuredJsonSchema {
  return {
    name: 'story_council_candidate_comparison',
    description: 'Blinded Story Council comparison of already-qualified planning candidates.',
    maxOutputTokens: 4096,
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['summary', 'winnerId', 'complementaryMerits', 'evaluations'],
      properties: {
        summary: { type: 'string' },
        winnerId: { type: 'string' },
        complementaryMerits: { type: 'boolean' },
        evaluations: {
          type: 'array',
          minItems: 2,
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['candidateId', 'scores', 'strengths', 'risks'],
            properties: {
              candidateId: { type: 'string' },
              scores: {
                type: 'object',
                additionalProperties: false,
                required: [...candidateScoreKeys],
                properties: Object.fromEntries(candidateScoreKeys.map((key) => [key, {
                  type: 'number', minimum: 0, maximum: 100,
                }])),
              },
              strengths: { type: 'array', items: { type: 'string' }, maxItems: 5 },
              risks: { type: 'array', items: { type: 'string' }, maxItems: 5 },
            },
          },
        },
      },
    },
  };
}

function boundedScore(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.min(100, parsed)) : 0;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((item) => String(item || '').trim()).filter(Boolean).slice(0, 5)
    : [];
}

export function normalizeCandidateComparison(
  value: Partial<StoryCouncilCandidateComparison> | undefined,
  allowedCandidateIds: string[],
): StoryCouncilCandidateComparison | undefined {
  if (!value || !allowedCandidateIds.includes(String(value.winnerId || ''))) return undefined;
  const evaluations = (Array.isArray(value.evaluations) ? value.evaluations : [])
    .map((raw): StoryCouncilCandidateEvaluation | undefined => {
      const candidateId = String(raw?.candidateId || '');
      if (!allowedCandidateIds.includes(candidateId)) return undefined;
      const scores = raw?.scores as unknown as Record<string, unknown> | undefined;
      return {
        candidateId,
        scores: {
          dramaticCausality: boundedScore(scores?.dramaticCausality),
          characterPressure: boundedScore(scores?.characterPressure),
          playerAgency: boundedScore(scores?.playerAgency),
          routeDifferentiation: boundedScore(scores?.routeDifferentiation),
          setupPayoff: boundedScore(scores?.setupPayoff),
          relationshipPacing: boundedScore(scores?.relationshipPacing),
          sceneEconomy: boundedScore(scores?.sceneEconomy),
          sourceFidelity: boundedScore(scores?.sourceFidelity),
        },
        strengths: stringList(raw?.strengths),
        risks: stringList(raw?.risks),
      };
    })
    .filter((entry): entry is StoryCouncilCandidateEvaluation => Boolean(entry));
  const evaluatedIds = new Set(evaluations.map((evaluation) => evaluation.candidateId));
  if (evaluatedIds.size !== allowedCandidateIds.length
    || allowedCandidateIds.some((candidateId) => !evaluatedIds.has(candidateId))) return undefined;
  return {
    summary: String(value.summary || 'Story Council candidate comparison completed.'),
    winnerId: String(value.winnerId),
    complementaryMerits: value.complementaryMerits === true,
    evaluations,
  };
}

export interface CouncilParseDiagnostics {
  parseStatus: 'ok' | 'recovered' | 'raw_findings_dropped' | 'error';
  parseError?: string;
  rawFindingCountEstimate: number;
  droppedFindingCount: number;
}

export function buildCouncilOutputSchema(name: string): StructuredJsonSchema {
  return {
    name,
    description: 'Quality Council findings mapped to StoryRPG quality categories and repair routes.',
    maxOutputTokens: 4096,
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['summary', 'findings'],
      properties: {
        summary: { type: 'string' },
        findings: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['id', 'checkpoint', 'category', 'severity', 'confidence', 'evidence', 'repairRoute'],
            properties: {
              id: { type: 'string' },
              checkpoint: { type: 'string' },
              category: { type: 'string', enum: [...COUNCIL_CATEGORIES] },
              severity: { type: 'string', enum: [...severities] },
              confidence: { type: 'string', enum: [...confidences] },
              evidence: { type: 'array', items: { type: 'string' } },
              target: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  episodeId: { type: 'string' },
                  sceneId: { type: 'string' },
                  beatId: { type: 'string' },
                  choiceId: { type: 'string' },
                },
              },
              repairRoute: { type: 'string', enum: [...COUNCIL_REPAIR_ROUTES] },
              validatorMapping: { type: 'string' },
            },
          },
        },
      },
    },
  };
}

function asEnum<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? value as T : fallback;
}

export function normalizeCouncilOutput(
  output: Partial<CouncilAgentOutput> | undefined,
  checkpoint: CouncilCheckpoint,
): CouncilAgentOutput {
  const normalized = normalizeCouncilOutputWithDiagnostics(output, checkpoint);
  return normalized.output;
}

export function normalizeCouncilOutputWithDiagnostics(
  output: Partial<CouncilAgentOutput> | undefined,
  checkpoint: CouncilCheckpoint,
  rawResponse?: string,
): { output: CouncilAgentOutput; diagnostics: CouncilParseDiagnostics } {
  const recovered = !Array.isArray(output?.findings) ? extractCouncilOutputFromRawResponse(rawResponse) : undefined;
  const source = Array.isArray(output?.findings) ? output : recovered;
  const rawFindings = Array.isArray(source?.findings) ? source!.findings : [];
  let droppedFindingCount = 0;
  const findings: CouncilFinding[] = rawFindings
    .map((raw, index): CouncilFinding | null => {
      const candidate = raw as Partial<CouncilFinding> & {
        repair?: unknown;
        repair_route?: unknown;
      };
      const evidence = normalizeEvidence(candidate.evidence);
      if (evidence.length === 0) {
        droppedFindingCount += 1;
        return null;
      }
      const rawTarget = candidate.target;
      const target: CouncilFinding['target'] = rawTarget && typeof rawTarget === 'object' ? {} : undefined;
      if (target && rawTarget) {
        if (rawTarget.episodeId) target.episodeId = String(rawTarget.episodeId);
        if (rawTarget.sceneId) target.sceneId = String(rawTarget.sceneId);
        if (rawTarget.beatId) target.beatId = String(rawTarget.beatId);
        if (rawTarget.choiceId) target.choiceId = String(rawTarget.choiceId);
      }
      const repairRoute = candidate.repairRoute ?? candidate.repair ?? candidate.repair_route;
      return {
        id: String(candidate.id || `${checkpoint}-${index + 1}`),
        checkpoint,
        category: normalizeCategory(candidate.category, evidence.join(' ')),
        severity: asEnum<CouncilSeverity>(candidate.severity, severities, 'warning'),
        confidence: asEnum<CouncilConfidence>(candidate.confidence, confidences, 'medium'),
        evidence,
        target,
        repairRoute: asEnum<CouncilRepairRoute>(repairRoute, COUNCIL_REPAIR_ROUTES, 'none'),
        validatorMapping: candidate.validatorMapping ? String(candidate.validatorMapping) : undefined,
      };
    })
    .filter((finding): finding is CouncilFinding => !!finding);

  const rawFindingCountEstimate = estimateRawFindingCount(rawResponse, rawFindings.length);
  let parseStatus: CouncilParseDiagnostics['parseStatus'] = recovered ? 'recovered' : 'ok';
  let parseError: string | undefined;
  if (rawFindingCountEstimate > 0 && findings.length === 0) {
    parseStatus = 'raw_findings_dropped';
    parseError = 'Raw Quality Council output appears to contain findings, but none survived normalization.';
  } else if (!source && rawResponse && rawFindingCountEstimate > 0) {
    parseStatus = 'error';
    parseError = 'Quality Council raw output could not be parsed into the council schema.';
  }

  const councilOutput = {
    summary: String(output?.summary || (findings.length > 0 ? `${findings.length} council finding(s).` : 'No council findings.')),
    findings,
  };

  return {
    output: councilOutput,
    diagnostics: {
      parseStatus,
      parseError,
      rawFindingCountEstimate,
      droppedFindingCount,
    },
  };
}

function normalizeEvidence(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => String(item || '').trim()).filter(Boolean).slice(0, 5);
  if (typeof value === 'string' && value.trim()) return [value.trim()].slice(0, 5);
  return [];
}

function normalizeCategory(value: unknown, evidenceText: string): CouncilCategory {
  if (COUNCIL_CATEGORIES.includes(value as CouncilCategory)) return value as CouncilCategory;
  const haystack = `${String(value || '')} ${evidenceText}`.toLowerCase();
  if (/choice|agency|option|decision/.test(haystack)) return 'choice-agency';
  if (/branch|route|residue|consequence/.test(haystack)) return 'branch-residue';
  if (/encounter|combat|challenge/.test(haystack)) return 'encounter-quality';
  if (/treatment|source|outline|coverage|fidelity/.test(haystack)) return 'treatment-fidelity';
  if (/mechanic|stat|dice|score|fiction-first/.test(haystack)) return 'fiction-first-mechanics';
  if (/character|relationship|npc/.test(haystack)) return 'character-relationship';
  if (/circle|need|go|search|find|take|return|change/.test(haystack)) return 'story-circle-spine';
  if (/structure|act|climax|midpoint|turn/.test(haystack)) return 'dramatic-structure';
  return 'scene-coherence';
}

export function extractCouncilOutputFromRawResponse(rawResponse: string | undefined): Partial<CouncilAgentOutput> | undefined {
  if (!rawResponse) return undefined;
  const candidates = [
    ...Array.from(rawResponse.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)).map((match) => match[1]),
    rawResponse.slice(rawResponse.indexOf('{'), rawResponse.lastIndexOf('}') + 1),
  ].filter((candidate) => candidate && candidate.trim().startsWith('{'));
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === 'object') return parsed as Partial<CouncilAgentOutput>;
    } catch {
      // Try the next candidate.
    }
  }
  return undefined;
}

export function estimateRawFindingCount(rawResponse: string | undefined, parsedFindingCount = 0): number {
  if (parsedFindingCount > 0) return parsedFindingCount;
  if (!rawResponse) return 0;
  const severityMentions = rawResponse.match(/"severity"\s*:\s*"(?:info|warning|error)"/gi)?.length ?? 0;
  if (severityMentions > 0) return severityMentions;
  const findingsArray = rawResponse.match(/"findings"\s*:\s*\[/i);
  if (findingsArray && !/"findings"\s*:\s*\[\s*\]/i.test(rawResponse)) return 1;
  const markdownFindings = rawResponse.match(/(?:^|\n)\s*(?:[-*]|\d+[.)])\s+(?:finding|issue|error|warning)\b/gi)?.length ?? 0;
  return markdownFindings;
}
