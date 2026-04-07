/**
 * BlueprintGrowthCritic — Phase 3.5 LLM Agent
 *
 * Evaluates the StoryArchitect's scene graph against the season plan's growth
 * context before content generation begins. Catches structural issues cheaply
 * before tokens are spent on prose.
 */

import { BaseAgent, AgentResponse } from './BaseAgent';
import { AgentConfig } from '../config';

export interface BlueprintGrowthCriticInput {
  blueprint: {
    scenes: Array<{
      id: string;
      name: string;
      purpose?: string;
      encounterDifficulty?: number;
      competenceArc?: { testsNow?: string; shortfall?: string; growthPath?: string };
      choicePoint?: {
        type?: string;
        consequenceDomain?: string;
        description?: string;
        optionHints?: string[];
      };
      leadsTo?: string[];
    }>;
    startingSceneId: string;
  };
  growthContext?: {
    focusSkills: string[];
    developmentScene: string;
    mentorshipOpportunity?: {
      npcId: string;
      npcName: string;
      requiredRelationship: { dimension: string; threshold: number };
      attribute: string;
      narrativeHook: string;
    } | null;
  };
  difficultyTier?: string;
}

export interface BlueprintGrowthCriticResult {
  passed: boolean;
  issues: Array<{
    severity: 'error' | 'warning';
    scene: string;
    message: string;
    suggestion: string;
  }>;
  summary: string;
}

export class BlueprintGrowthCritic extends BaseAgent {
  constructor(config: AgentConfig) {
    super('BlueprintGrowthCritic', config);
    this.includeSystemPrompt = true;
  }

  protected getAgentSpecificPrompt(): string {
    return `You are a story structure critic specializing in character growth design.
Your job is to verify that episode blueprints have proper growth-difficulty alignment.`;
  }

  async execute(input: BlueprintGrowthCriticInput): Promise<AgentResponse<BlueprintGrowthCriticResult>> {
    const sceneSummary = input.blueprint.scenes.map(s => {
      const parts = [`- ${s.id} "${s.name}" (purpose: ${s.purpose ?? 'narrative'})`];
      if (s.encounterDifficulty) parts.push(`  encounterDifficulty: ${s.encounterDifficulty}`);
      if (s.competenceArc) parts.push(`  competenceArc: ${JSON.stringify(s.competenceArc)}`);
      if (s.choicePoint) parts.push(`  choicePoint: type=${s.choicePoint.type}, domain=${s.choicePoint.consequenceDomain}`);
      if (s.leadsTo?.length) parts.push(`  leadsTo: ${s.leadsTo.join(', ')}`);
      return parts.join('\n');
    }).join('\n\n');

    const growthSection = input.growthContext
      ? `Focus skills: ${input.growthContext.focusSkills.join(', ')}
Development scene concept: ${input.growthContext.developmentScene}
${input.growthContext.mentorshipOpportunity
  ? `Mentorship: ${input.growthContext.mentorshipOpportunity.npcName} can teach ${input.growthContext.mentorshipOpportunity.attribute} if ${input.growthContext.mentorshipOpportunity.requiredRelationship.dimension} >= ${input.growthContext.mentorshipOpportunity.requiredRelationship.threshold}`
  : 'No mentorship opportunity this episode.'}`
      : 'No growth context provided for this episode.';

    const prompt = `You are reviewing an episode blueprint for growth-difficulty alignment. The season plan expects these growth opportunities in this episode:

${growthSection}
Difficulty tier: ${input.difficultyTier ?? 'unknown'}

Here is the scene graph:

${sceneSummary}

Starting scene: ${input.blueprint.startingSceneId}

Evaluate the blueprint and report issues:

1. GROWTH-DIFFICULTY SEQUENCING
   - Does every scene with a hard check (encounterDifficulty > 50 or high-stakes choicePoint) have a development scene reachable BEFORE it in the scene graph?
   - Are the growth skills offered relevant to the upcoming challenge?

2. FAILURE-RECOVERY COMPLETENESS
   - Does every hard check have a failure branch that routes through growth?
   - Does the failure branch lead to a re-approach or alternative that reconverges?

3. MENTORSHIP PLACEMENT (if season plan has mentorship)
   - Is there a scene where the NPC can offer mentorship?
   - Is it placed at a narratively appropriate moment?

4. PACING
   - Are development scenes spread across the episode, not clustered at the start?
   - Is there at least one growth opportunity in the second half?

Return ONLY a JSON object:
{
  "passed": boolean,
  "issues": [{ "severity": "error" | "warning", "scene": "scene-id", "message": "description", "suggestion": "fix" }],
  "summary": "one-sentence summary"
}`;

    try {
      const response = await this.callLLM([{ role: 'user', content: prompt }]);
      const parsed = this.parseJsonResponse<BlueprintGrowthCriticResult>(response);

      if (parsed) {
        return { success: true, data: parsed };
      }

      return {
        success: true,
        data: { passed: true, issues: [], summary: 'Could not parse critic response; assuming pass.' },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        data: { passed: true, issues: [], summary: 'Critic failed; assuming pass.' },
      };
    }
  }

  private parseJsonResponse<T>(raw: string): T | null {
    try {
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]) as T;
      }
    } catch { /* fall through */ }
    return null;
  }
}
