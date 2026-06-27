/**
 * ThreadPlanner — authors the Narrative Thread ledger.
 *
 * Reads the StoryArchitect EpisodeBlueprint (and optionally the SeasonBible)
 * and produces a ThreadLedger: seeds / clues / promises / revelations that
 * must be planted and paid off across the episode. Downstream consumers:
 *
 *   - SceneWriter reads `activeThreads` to mark beats with `plantedThreadIds`
 *     and `paidOffThreadIds`.
 *   - SetupPayoffValidator verifies every plant has a payoff (and vice versa).
 */

import { AgentConfig } from '../config';
import { BaseAgent, AgentResponse } from './BaseAgent';
import { EpisodeBlueprint } from './StoryArchitect';
import { SeasonBible, NarrativeThread, ThreadLedger } from '../../types';
import type {
  StoryAnchors,
  LegacyStructuralMap,
  StoryCircleRoleAssignment,
  StoryCircleStructure,
  StructuralRole,
} from '../../types/sourceAnalysis';
import { buildStructuralContextSection } from '../prompts/storytellingPrinciples';

export interface ThreadPlannerInput {
  episodeBlueprint: EpisodeBlueprint;
  seasonBible?: SeasonBible;
  /**
   * Optional: previously-planned threads from prior episodes. When present,
   * the planner can extend / pay-off / reframe those threads instead of
   * always inventing new ones.
   */
  priorThreads?: NarrativeThread[];

  /**
   * Season-level narrative anchors. Every planted promise SHOULD map to
   * one of these anchors so the payoff pressure flows toward the season
   * Climax. Optional so older callers still typecheck.
   */
  seasonAnchors?: StoryAnchors;

  /** Season-level legacy-structure beat map. */
  seasonLegacyStructure?: LegacyStructuralMap;
  /** Primary season-level Story Circle map. */
  seasonStoryCircle?: StoryCircleStructure;

  /**
   * Which beat(s) of the season this episode carries. Determines whether
   * threads planted in this episode should aim to pay off within the
   * same episode (Climax / Pinch 2 beats) or defer across episodes
   * (Hook / Rising beats).
   */
  episodeStructuralRole?: StructuralRole[];
  /** Primary Story Circle role(s) for this episode. */
  episodeStoryCircleRole?: StoryCircleRoleAssignment[];
}

export class ThreadPlanner extends BaseAgent {
  constructor(config: AgentConfig) {
    super('Thread Planner', config);
    this.includeSystemPrompt = true;
  }

  protected getAgentSpecificPrompt(): string {
    return `
## Your Role: Thread Planner

You author a **Narrative Thread Ledger** — the set of seeds, clues, promises,
and revelations that must be planted and paid off across an episode.

Threads come in four kinds:
- **seed**: A small concrete detail the audience can notice later (e.g., "the
  locked drawer in the mentor's desk").
- **clue**: A specific evidence item that should reward attentive readers
  (e.g., "the missing tooth on the pocket watch").
- **promise**: A stakes-level commitment the story makes to the reader
  (e.g., "you WILL have to face your mother").
- **reveal**: A revelation that reframes earlier events (e.g., "the mentor
  was the informant all along").

**Rules**
1. Every thread must have a plant and a payoff. If you can't commit to
   paying a thread off within the episode (or by \`expectedPaidOffByEpisode\`
   for multi-episode runs), drop it.
2. Avoid orphan promises (planted but never paid off — Chekhov's gun
   violation) and unplanted reveals (paid off but never planted — deus ex
   machina violation).
3. Threads should map onto concrete scenes/beats from the blueprint. Use the
   blueprint's scene + beat ids in \`plants\` and \`payoffs\`.
4. Keep it tight: 3–7 threads per episode is plenty. Do not generate more
   than one major thread per scene.
5. Information has ownership. Major clues, secrets, threats, and open
   questions should declare their tension mode through tags such as
   "mystery", "dramatic-irony", "secret", "threat", "relationship-secret",
   "theme-question", or "payoff-required". The player must know enough to
   roleplay intent before major choices.
6. Payoffs are path-aware. A branch-specific payoff must be planted on that
   branch or in a shared bottleneck before the branch. Do not pay off
   information the player could not have encountered on that reachable path.

**REQUIRED JSON STRUCTURE**
\`\`\`json
{
  "threads": [
    {
      "id": "locked-drawer",
      "kind": "seed",
      "priority": "minor",
      "label": "Locked drawer in mentor's desk",
      "description": "Player notices a locked drawer in scene-02; later it contains the key evidence.",
      "introducedInEpisode": 1,
      "expectedPaidOffByEpisode": 1,
      "plants": [{ "sceneId": "scene-02", "beatId": "beat-02-03", "note": "Visible in dialogue beat" }],
      "payoffs": [{ "sceneId": "scene-06", "beatId": "beat-06-04", "note": "Player forces it open; finds letter" }],
      "status": "planned",
      "tags": ["mystery", "locket"]
    }
  ],
  "designNotes": "Short author note about how these threads interlock."
}
\`\`\`

Status must start as "planned" — validators will promote it to "planted",
"paid_off", "dangling", or "unplanted" based on actual generated content.
`;
  }

  async execute(input: ThreadPlannerInput): Promise<AgentResponse<ThreadLedger>> {
    const prompt = this.buildPrompt(input);
    try {
      const response = await this.callLLM([{ role: 'user', content: prompt }]);
      let ledger: ThreadLedger;
      try {
        ledger = this.parseJSON<ThreadLedger>(response);
      } catch (parseError) {
        console.error('[ThreadPlanner] JSON parse failed:', response.substring(0, 500));
        throw parseError;
      }

      ledger = this.normalizeLedger(ledger);
      return { success: true, data: ledger, rawResponse: response };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error('[ThreadPlanner] Error:', msg);
      // Fail open with an empty ledger so the pipeline can proceed.
      return { success: true, data: { threads: [] }, error: msg };
    }
  }

  private buildPrompt(input: ThreadPlannerInput): string {
    const blueprint = input.episodeBlueprint;
    const sceneList = blueprint.scenes
      .map(s => {
        const beats = Array.isArray((s as unknown as { beatOutlines?: Array<{ id: string; summary: string }> }).beatOutlines)
          ? (s as unknown as { beatOutlines: Array<{ id: string; summary: string }> }).beatOutlines
          : [];
        const beatLines = beats
          .slice(0, 6)
          .map(b => `    - ${b.id}: ${b.summary}`)
          .join('\n');
        return `- ${s.id} (${s.purpose}): ${s.description}${beatLines ? '\n' + beatLines : ''}`;
      })
      .join('\n');

    const priorThreadsBlock = input.priorThreads?.length
      ? `\n## Prior Threads (still open)\n${JSON.stringify(input.priorThreads, null, 2)}\n`
      : '';
    const structuralContext = buildStructuralContextSection({
      anchors: input.seasonAnchors,
      storyCircle: input.seasonStoryCircle,
      episodeStoryCircleRole: input.episodeStoryCircleRole,
      episodeCircle: blueprint.episodeCircle,
    });

    return `# Episode: ${blueprint.episodeId}

${structuralContext}
## Scenes
${sceneList}
${priorThreadsBlock}
Plan the ThreadLedger following the REQUIRED JSON STRUCTURE above.
Return ONLY JSON.`;
  }

  private normalizeLedger(ledger: ThreadLedger): ThreadLedger {
    const threads = Array.isArray(ledger.threads) ? ledger.threads : [];
    return {
      threads: threads.map((t, idx) => ({
        id: t.id || `thread-${idx + 1}`,
        kind: (t.kind as NarrativeThread['kind']) || 'seed',
        priority: (t.priority as NarrativeThread['priority']) || 'minor',
        label: t.label || `Thread ${idx + 1}`,
        description: t.description || '',
        introducedInEpisode: t.introducedInEpisode,
        expectedPaidOffByEpisode: t.expectedPaidOffByEpisode,
        plants: Array.isArray(t.plants) ? t.plants : [],
        payoffs: Array.isArray(t.payoffs) ? t.payoffs : [],
        status: (t.status as NarrativeThread['status']) || 'planned',
        tags: Array.isArray(t.tags) ? t.tags : [],
      })),
      designNotes: ledger.designNotes,
    };
  }
}
