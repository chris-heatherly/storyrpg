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
} from './types';

const severities: readonly CouncilSeverity[] = ['info', 'warning', 'error'] as const;
const confidences: readonly CouncilConfidence[] = ['low', 'medium', 'high'] as const;

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
  const rawFindings = Array.isArray(output?.findings) ? output!.findings : [];
  const findings: CouncilFinding[] = rawFindings
    .map((raw, index): CouncilFinding | null => {
      const candidate = raw as Partial<CouncilFinding>;
      const evidence = Array.isArray(candidate.evidence)
        ? candidate.evidence.map((item) => String(item || '').trim()).filter(Boolean).slice(0, 5)
        : [];
      if (evidence.length === 0) return null;
      const rawTarget = candidate.target;
      const target: CouncilFinding['target'] = rawTarget && typeof rawTarget === 'object' ? {} : undefined;
      if (target && rawTarget) {
        if (rawTarget.episodeId) target.episodeId = String(rawTarget.episodeId);
        if (rawTarget.sceneId) target.sceneId = String(rawTarget.sceneId);
        if (rawTarget.beatId) target.beatId = String(rawTarget.beatId);
        if (rawTarget.choiceId) target.choiceId = String(rawTarget.choiceId);
      }
      return {
        id: String(candidate.id || `${checkpoint}-${index + 1}`),
        checkpoint,
        category: asEnum<CouncilCategory>(candidate.category, COUNCIL_CATEGORIES, 'scene-coherence'),
        severity: asEnum<CouncilSeverity>(candidate.severity, severities, 'warning'),
        confidence: asEnum<CouncilConfidence>(candidate.confidence, confidences, 'medium'),
        evidence,
        target,
        repairRoute: asEnum<CouncilRepairRoute>(candidate.repairRoute, COUNCIL_REPAIR_ROUTES, 'none'),
        validatorMapping: candidate.validatorMapping ? String(candidate.validatorMapping) : undefined,
      };
    })
    .filter((finding): finding is CouncilFinding => !!finding);

  return {
    summary: String(output?.summary || (findings.length > 0 ? `${findings.length} council finding(s).` : 'No council findings.')),
    findings,
  };
}
