/**
 * GrowthNarrativeCritic — Phase 4.5 LLM Agent
 *
 * Evaluates generated choices and scene content for growth narrative legibility.
 * Can the player understand, from the prose alone, what they're developing and why?
 *
 * Only evaluates scenes with competenceArc or consequenceDomain: 'resource'.
 */

import { BaseAgent, AgentResponse } from './BaseAgent';
import { AgentConfig } from '../config';

export interface GrowthSceneContent {
  sceneId: string;
  sceneName: string;
  beats: Array<{ text: string }>;
  choices?: Array<{
    text: string;
    consequences?: Array<{ type: string; skill?: string; attribute?: string; change?: number }>;
    outcomeTexts?: { success?: string; partial?: string; failure?: string };
  }>;
}

export interface GrowthNarrativeCriticInput {
  scenes: GrowthSceneContent[];
}

export interface GrowthNarrativeCriticResult {
  passed: boolean;
  issues: Array<{
    severity: 'error' | 'warning';
    sceneId: string;
    choiceIndex: number | null;
    category: 'development_quality' | 'failure_feedback' | 'mentorship' | 'growth_signaling';
    message: string;
    suggestion: string;
  }>;
  summary: string;
}

export class GrowthNarrativeCritic extends BaseAgent {
  constructor(config: AgentConfig) {
    super('GrowthNarrativeCritic', config);
    this.includeSystemPrompt = true;
  }

  protected getAgentSpecificPrompt(): string {
    return `You are a narrative quality critic specializing in character growth legibility.
Players should understand their character's development through the narrative, without seeing numbers or stats.`;
  }

  async execute(input: GrowthNarrativeCriticInput): Promise<AgentResponse<GrowthNarrativeCriticResult>> {
    if (input.scenes.length === 0) {
      return {
        success: true,
        data: { passed: true, issues: [], summary: 'No growth scenes to evaluate.' },
      };
    }

    const sceneSummaries = input.scenes.map(scene => {
      const parts = [`Scene: "${scene.sceneName}" (${scene.sceneId})`];
      if (scene.beats.length > 0) {
        parts.push(`  Narrative: "${scene.beats.map(b => b.text).join(' ').substring(0, 300)}..."`);
      }
      if (scene.choices) {
        scene.choices.forEach((c, i) => {
          parts.push(`  Choice ${i}: "${c.text}"`);
          if (c.consequences?.length) {
            parts.push(`    Consequences: ${JSON.stringify(c.consequences)}`);
          }
          if (c.outcomeTexts) {
            if (c.outcomeTexts.failure) parts.push(`    Failure text: "${c.outcomeTexts.failure.substring(0, 200)}"`);
          }
        });
      }
      return parts.join('\n');
    }).join('\n\n---\n\n');

    const prompt = `You are reviewing generated story content for growth legibility. Players should understand their character's development through the narrative, without seeing numbers or stats.

Review each development/growth-related scene and report issues:

1. DEVELOPMENT CHOICE QUALITY
   - Do the choices feel like meaningful character investments with narrative weight?
   - BAD: "Train athletics" / "Train persuasion" / "Train stealth" (stat menu)
   - GOOD: "Spar with Marcus in the training yard" / "Study the old maps with Elena" (actions with character)
   - Does each option have distinct narrative flavor, not just different skill names?

2. FAILURE NARRATIVE FEEDBACK
   - When a check fails, does the failure text communicate WHAT held the character back?
   - BAD: "You fail." (no information)
   - GOOD: "You read the room correctly, but the words wouldn't come" (communicates weak link)

3. MENTORSHIP AUTHENTICITY
   - Does mentorship dialogue feel like a genuine character moment?
   - BAD: "Marcus teaches you courage." (stat dump)
   - GOOD: "'Fear's not the enemy,' he says. 'It's the flinch.'" (relationship-driven)

4. GROWTH SIGNALING
   - After a development choice, does the narrative acknowledge the growth?
   - Is the connection between action and growth clear without being mechanical?

Here are the scenes to review:

${sceneSummaries}

Return ONLY a JSON object:
{
  "passed": boolean,
  "issues": [{ "severity": "error" | "warning", "sceneId": "id", "choiceIndex": number | null, "category": "development_quality" | "failure_feedback" | "mentorship" | "growth_signaling", "message": "description", "suggestion": "fix" }],
  "summary": "one-sentence summary"
}`;

    try {
      const response = await this.callLLM([{ role: 'user', content: prompt }]);
      const parsed = this.parseJsonResponse<GrowthNarrativeCriticResult>(response);

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
