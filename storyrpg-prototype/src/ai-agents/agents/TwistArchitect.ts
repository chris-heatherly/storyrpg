/**
 * TwistArchitect — schedules a reversal or revelation per episode (or per arc).
 *
 * Reads the StoryArchitect EpisodeBlueprint (and optionally the SeasonBible /
 * ThreadLedger) and produces a TwistPlan that identifies:
 *   - which scene/beat hosts the twist,
 *   - which scene/beat should plant the foreshadow,
 *   - the kind of twist (reversal, revelation, betrayal, reframe),
 *   - hints passed to SceneWriter via `twistDirectives`.
 *
 * The downstream SceneWriter already consumes `twistDirectives` and sets
 * `plotPointType` on the relevant beat.
 */

import { AgentConfig } from '../config';
import { BaseAgent, AgentResponse } from './BaseAgent';
import { EpisodeBlueprint } from './StoryArchitect';
import { SeasonBible, ThreadLedger } from '../../types';
import type {
  StoryAnchors,
  SevenPointStructure,
  StructuralRole,
} from '../../types/sourceAnalysis';

export type TwistKind = 'reversal' | 'revelation' | 'betrayal' | 'reframe';

export interface TwistPlan {
  /** Episode id this plan applies to. */
  episodeId: string;
  /** Headline description of the twist. */
  headline: string;
  /** Kind of twist. */
  kind: TwistKind;
  /** Scene + beat where the twist lands. */
  twistSceneId: string;
  twistBeatId: string;
  /** Scene + beat where foreshadowing is planted (must precede twist). */
  foreshadowSceneId: string;
  foreshadowBeatId: string;
  /** Author note on *why* the twist is surprising-but-inevitable. */
  rationale: string;
  /** Optional pointer to a NarrativeThread id this twist resolves. */
  threadId?: string;
  /** Per-beat directives consumed by SceneWriter.input.twistDirectives. */
  directives: Array<{
    sceneId: string;
    beatId: string;
    beatRole: 'foreshadow' | 'misdirect' | 'reveal' | 'aftermath';
    twistKind: TwistKind;
    hint: string;
  }>;
}

export interface TwistArchitectInput {
  episodeBlueprint: EpisodeBlueprint;
  seasonBible?: SeasonBible;
  threadLedger?: ThreadLedger;

  /**
   * Season-level narrative anchors. Twists SHOULD reframe one of these
   * (especially Stakes or Goal) rather than inventing unrelated reveals.
   */
  seasonAnchors?: StoryAnchors;

  /** Season-level 7-point beat map for placing foreshadow + reveal. */
  seasonSevenPoint?: SevenPointStructure;

  /**
   * The beat(s) this episode carries. Episodes carrying Midpoint or
   * Plot Turn 2 are natural homes for the season's biggest twists.
   */
  episodeStructuralRole?: StructuralRole[];
}

export class TwistArchitect extends BaseAgent {
  constructor(config: AgentConfig) {
    super('Twist Architect', config);
    this.includeSystemPrompt = true;
  }

  protected getAgentSpecificPrompt(): string {
    return `
## Your Role: Twist Architect

Each episode needs ONE memorable reversal, revelation, betrayal, or reframe —
the kind of moment that recontextualizes earlier events. You schedule it.

**Kinds**
- **reversal**: An expected outcome flips (the trusted guard betrays).
- **revelation**: A fact is uncovered that changes the meaning of prior events.
- **betrayal**: A trusted character acts against the protagonist.
- **reframe**: The *interpretation* of prior events shifts (identity, motive,
  timeline) without adding new facts.

**Rules**
1. Twists must be **surprising-but-inevitable**. Plant foreshadow at least
   ONE scene before the twist beat.
2. Avoid "gotcha" twists — the player should be able to look back and see the
   planted evidence.
3. The twist must change *stakes* or *player stance*, not just plot facts.
4. Emit at least two directives: one "foreshadow" beat (earlier) and one
   "reveal" beat (the twist landing). Optionally add "misdirect" or
   "aftermath" directives.
5. If a NarrativeThread already carries a revelation, reuse it (set
   \`threadId\`) instead of inventing a new one.

**REQUIRED JSON STRUCTURE**
\`\`\`json
{
  "episodeId": "episode-1",
  "headline": "The mentor is the informant",
  "kind": "revelation",
  "twistSceneId": "scene-06",
  "twistBeatId": "beat-06-05",
  "foreshadowSceneId": "scene-03",
  "foreshadowBeatId": "beat-03-02",
  "rationale": "Player observed mentor flinch at the wrong name in scene-03; the letter in scene-06 names him.",
  "threadId": "mentor-loyalty",
  "directives": [
    { "sceneId": "scene-03", "beatId": "beat-03-02", "beatRole": "foreshadow", "twistKind": "revelation", "hint": "Have mentor react oddly to the agency name." },
    { "sceneId": "scene-06", "beatId": "beat-06-05", "beatRole": "reveal", "twistKind": "revelation", "hint": "Mentor's letter lays out the betrayal." }
  ]
}
\`\`\`

Return ONLY JSON.
`;
  }

  async execute(input: TwistArchitectInput): Promise<AgentResponse<TwistPlan>> {
    const prompt = this.buildPrompt(input);
    try {
      const response = await this.callLLM([{ role: 'user', content: prompt }]);
      let plan: TwistPlan;
      try {
        plan = this.parseJSON<TwistPlan>(response);
      } catch (parseError) {
        console.error('[TwistArchitect] JSON parse failed:', response.substring(0, 500));
        throw parseError;
      }
      plan = this.normalizePlan(plan, input);
      return { success: true, data: plan, rawResponse: response };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error('[TwistArchitect] Error:', msg);
      // Fail open: skip twist rather than block generation.
      return {
        success: true,
        data: this.emptyPlan(input.episodeBlueprint.episodeId),
        error: msg,
      };
    }
  }

  private buildPrompt(input: TwistArchitectInput): string {
    const bp = input.episodeBlueprint;
    const scenes = bp.scenes
      .map(s => {
        const beats = Array.isArray(
          (s as unknown as { beatOutlines?: Array<{ id: string; summary: string }> }).beatOutlines,
        )
          ? (s as unknown as { beatOutlines: Array<{ id: string; summary: string }> }).beatOutlines
          : [];
        const beatLines = beats
          .slice(0, 6)
          .map(b => `    - ${b.id}: ${b.summary}`)
          .join('\n');
        return `- ${s.id} (${s.purpose}): ${s.description}${beatLines ? '\n' + beatLines : ''}`;
      })
      .join('\n');

    const threadBlock = input.threadLedger?.threads?.length
      ? `\n## Thread Ledger (reuse a reveal thread if possible)\n${JSON.stringify(
          input.threadLedger.threads.map(t => ({
            id: t.id,
            kind: t.kind,
            label: t.label,
            description: t.description,
          })),
          null,
          2,
        )}\n`
      : '';

    return `# Episode: ${bp.episodeId}\n\n## Scenes\n${scenes}\n${threadBlock}\nSchedule the episode's twist using the REQUIRED JSON STRUCTURE.`;
  }

  private normalizePlan(plan: TwistPlan, input: TwistArchitectInput): TwistPlan {
    const allowed: TwistKind[] = ['reversal', 'revelation', 'betrayal', 'reframe'];
    const kind = allowed.includes(plan.kind) ? plan.kind : 'revelation';
    return {
      episodeId: plan.episodeId || input.episodeBlueprint.episodeId,
      headline: plan.headline || 'Untitled twist',
      kind,
      twistSceneId: plan.twistSceneId || '',
      twistBeatId: plan.twistBeatId || '',
      foreshadowSceneId: plan.foreshadowSceneId || '',
      foreshadowBeatId: plan.foreshadowBeatId || '',
      rationale: plan.rationale || '',
      threadId: plan.threadId,
      directives: Array.isArray(plan.directives)
        ? plan.directives.map(d => ({
            sceneId: d.sceneId,
            beatId: d.beatId,
            beatRole: d.beatRole,
            twistKind: allowed.includes(d.twistKind) ? d.twistKind : kind,
            hint: d.hint || '',
          }))
        : [],
    };
  }

  private emptyPlan(episodeId: string): TwistPlan {
    return {
      episodeId,
      headline: '',
      kind: 'revelation',
      twistSceneId: '',
      twistBeatId: '',
      foreshadowSceneId: '',
      foreshadowBeatId: '',
      rationale: '',
      directives: [],
    };
  }
}
