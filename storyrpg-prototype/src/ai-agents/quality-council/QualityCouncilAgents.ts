import type { AgentConfig } from '../config';
import { AgentResponse, BaseAgent } from '../agents/BaseAgent';
import { buildCouncilOutputSchema, normalizeCouncilOutput } from './schema';
import type { CouncilAgentOutput, CouncilCheckpoint } from './types';

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

You are part of StoryRPG's optional Quality Council. You do not author content.
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
      return {
        success: true,
        data: normalizeCouncilOutput(data, this.checkpoint),
        rawResponse,
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        error: msg,
        data: normalizeCouncilOutput({ summary: `Quality Council ${this.checkpoint} failed: ${msg}`, findings: [] }, this.checkpoint),
      };
    }
  }

  async execute(input: unknown): Promise<AgentResponse<CouncilAgentOutput>> {
    return this.review((input || {}) as QualityCouncilAgentInput);
  }

  private buildPrompt(input: QualityCouncilAgentInput): string {
    return [
      `# Quality Council Checkpoint: ${this.checkpoint}`,
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
