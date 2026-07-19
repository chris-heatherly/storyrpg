import type { AgentConfig } from '../config';
import { AgentResponse, BaseAgent } from '../agents/BaseAgent';
import {
  buildCandidateComparisonSchema,
  buildCouncilOutputSchema,
  normalizeCandidateComparison,
  normalizeCouncilOutputWithDiagnostics,
} from './schema';
import type {
  CouncilAgentOutput,
  CouncilCheckpoint,
  StoryCouncilCandidateComparison,
} from './types';

export interface QualityCouncilAgentInput {
  brief?: unknown;
  sourceAnalysis?: unknown;
  seasonPlan?: unknown;
  episodeBlueprint?: unknown;
  sceneContents?: unknown;
  choiceSets?: unknown;
  story?: unknown;
  qaReport?: unknown;
  bestPracticesReport?: unknown;
  finalStoryContractReport?: unknown;
  qualityScore?: number;
  notes?: string;
}

export interface CandidateComparisonAgentInput {
  stage: 'episode-blueprint';
  lockedContext: unknown;
  candidates: Array<{ candidateId: string; artifact: unknown }>;
}

export class CandidateComparisonAgent extends BaseAgent {
  constructor(config: AgentConfig) {
    super('Story Council Candidate Judge', { ...config, temperature: Math.min(config.temperature ?? 0.25, 0.3) });
    this.includeSystemPrompt = true;
  }

  protected getAgentSpecificPrompt(): string {
    return `
## Your Role: Story Council Blinded Planning Judge

Compare only the anonymous, already-qualified planning candidates provided.
You are not a validator and you do not create blocking findings. Deterministic
contracts, source authority, topology, and owner-stage gates have already run.

Score each candidate from 0-100 on the requested dimensions. Prefer executable,
causal interactive-fiction plans over attractive synopsis language. Do not infer
author identity, provider, or model. Select one candidate id. Mark
complementaryMerits=true only when the strongest merits can coexist coherently.
Return only JSON matching the schema.
`;
  }

  async compare(input: CandidateComparisonAgentInput): Promise<AgentResponse<StoryCouncilCandidateComparison>> {
    const allowedIds = input.candidates.map((candidate) => candidate.candidateId);
    try {
      const { data, rawResponse } = await this.callLLMForJson<Partial<StoryCouncilCandidateComparison>>([
        {
          role: 'user',
          content: [
            `# Story Council Candidate Comparison: ${input.stage}`,
            '\n## Locked Context',
            JSON.stringify(compact(input.lockedContext, 10000), null, 2),
            '\n## Anonymous Candidates',
            JSON.stringify(input.candidates.map((candidate) => ({
              candidateId: candidate.candidateId,
              artifact: compact(candidate.artifact, 16000),
            })), null, 2),
          ].join('\n'),
        },
      ], { jsonSchema: buildCandidateComparisonSchema() });
      const normalized = normalizeCandidateComparison(data, allowedIds);
      if (!normalized) {
        return { success: false, rawResponse, error: 'Candidate comparison did not select a valid candidate id.' };
      }
      return { success: true, data: normalized, rawResponse };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async execute(input: unknown): Promise<AgentResponse<StoryCouncilCandidateComparison>> {
    return this.compare(input as CandidateComparisonAgentInput);
  }
}

abstract class QualityCouncilAgent extends BaseAgent {
  protected abstract readonly checkpoint: CouncilCheckpoint;
  protected abstract readonly councilRole: string;

  constructor(name: string, config: AgentConfig) {
    super(name, config);
    this.includeSystemPrompt = true;
  }

  protected getAgentSpecificPrompt(): string {
    return `
## Your Role: ${this.councilRole}

You are an independent holdout reviewer in StoryRPG's optional Story Council. You do not author content.
You inspect current typed artifacts and produce bounded diagnostic findings.

Rules:
- Deterministic validators remain authoritative. Do not invent new hard gates.
- Map each issue to an existing StoryRPG quality category and repair route.
- Use "error" only for concrete, evidence-backed defects.
- Prefer "warning" for craft concerns.
- Evidence must quote or summarize specific artifact facts, not taste.
- Never expose stats, dice, thresholds, or raw mechanics as player-facing advice.
- Return only JSON matching the provided schema.
`;
  }

  async review(input: QualityCouncilAgentInput): Promise<AgentResponse<CouncilAgentOutput>> {
    const prompt = this.buildPrompt(input);
    try {
      const { data, rawResponse } = await this.callLLMForJson<Partial<CouncilAgentOutput>>(
        [{ role: 'user', content: prompt }],
        { jsonSchema: buildCouncilOutputSchema(`${this.checkpoint.replace(/-/g, '_')}_quality_council`) },
      );
      const normalized = normalizeCouncilOutputWithDiagnostics(data, this.checkpoint, rawResponse);
      return {
        success: true,
        data: normalized.output,
        rawResponse,
        metadata: { councilParseDiagnostics: normalized.diagnostics },
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      const normalized = normalizeCouncilOutputWithDiagnostics(
        { summary: `Quality Council ${this.checkpoint} failed: ${msg}`, findings: [] },
        this.checkpoint,
      );
      return {
        success: false,
        error: msg,
        data: normalized.output,
        metadata: { councilParseDiagnostics: { ...normalized.diagnostics, parseStatus: 'error', parseError: msg } },
      };
    }
  }

  async execute(input: unknown): Promise<AgentResponse<CouncilAgentOutput>> {
    return this.review((input || {}) as QualityCouncilAgentInput);
  }

  private buildPrompt(input: QualityCouncilAgentInput): string {
    return [
      `# Story Council Holdout: ${this.checkpoint}`,
      input.notes ? `\n## Notes\n${input.notes}` : '',
      '\n## Artifact Packet',
      JSON.stringify(compactCouncilInput(input), null, 2),
      '\nReturn a compact council report. Findings must use checkpoint="' + this.checkpoint + '".',
    ].filter(Boolean).join('\n');
  }
}

function compactCouncilInput(input: QualityCouncilAgentInput): Record<string, unknown> {
  return {
    brief: compact(input.brief, 8000),
    sourceAnalysis: compact(input.sourceAnalysis, 10000),
    seasonPlan: compact(input.seasonPlan, 12000),
    episodeBlueprint: compact(input.episodeBlueprint, 10000),
    sceneContents: compact(input.sceneContents, 14000),
    choiceSets: compact(input.choiceSets, 12000),
    story: compact(input.story, 16000),
    qaReport: compact(input.qaReport, 8000),
    bestPracticesReport: compact(input.bestPracticesReport, 8000),
    finalStoryContractReport: compact(input.finalStoryContractReport, 10000),
    qualityScore: input.qualityScore,
  };
}

function compact(value: unknown, maxChars: number): unknown {
  if (value === undefined || value === null) return undefined;
  const text = JSON.stringify(value);
  if (!text || text.length <= maxChars) return value;
  return {
    truncated: true,
    maxChars,
    jsonPrefix: text.slice(0, maxChars),
  };
}

export class PlanCouncilAgent extends QualityCouncilAgent {
  protected readonly checkpoint = 'plan' as const;
  protected readonly councilRole = 'Plan Council: review season structure, Story Circle loop, promises, escalation, treatment obligations, and arc pressure before expensive generation.';
  constructor(config: AgentConfig) { super('Plan Council', config); }
}

export class ChoiceCouncilAgent extends QualityCouncilAgent {
  protected readonly checkpoint = 'choice' as const;
  protected readonly councilRole = 'Choice Council: review choice agency, want/cost/identity, consequence memory, branch residue, and fiction-first wording.';
  constructor(config: AgentConfig) { super('Choice Council', config); }
}

export class RoutePlaytestCouncilAgent extends QualityCouncilAgent {
  protected readonly checkpoint = 'route-playtest' as const;
  protected readonly councilRole = 'Route Playtest Council: simulate routes and identify cosmetic branching, erased residue, impossible state, and weak consequence memory.';
  constructor(config: AgentConfig) { super('Route Playtest Council', config); }
}

export class FinalCouncilAgent extends QualityCouncilAgent {
  protected readonly checkpoint = 'final' as const;
  protected readonly councilRole = 'Final Council: regression-oriented audit across final story, validator reports, treatment fidelity, and quality evidence.';
  constructor(config: AgentConfig) { super('Final Council', config); }
}
