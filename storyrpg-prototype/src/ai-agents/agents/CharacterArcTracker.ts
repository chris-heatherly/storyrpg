/**
 * CharacterArcTracker — produces per-episode identity/relationship milestones.
 *
 * Given the SeasonBible's planned character arc and the current episode
 * context, the tracker emits concrete *targets* the episode must hit:
 *   - Identity axis deltas (e.g., "mercy_justice should move +15 toward justice")
 *   - Relationship trajectory targets (e.g., "Mara's trust should shift from
 *     warm → cautious by the finale")
 *   - Milestone flags that mark pivotal arc moments.
 *
 * Downstream consumers:
 *   - ChoiceAuthor reads `CharacterArcTargets` to bias consequence design so
 *     the episode advances along the planned arc.
 *   - ArcDeltaValidator compares start-vs-end identity state to these targets.
 */

import { AgentConfig } from '../config';
import { BaseAgent, AgentResponse } from './BaseAgent';
import { SeasonBible, IdentityProfile } from '../../types';
import { EpisodeBlueprint } from './StoryArchitect';
import { CharacterBible } from './CharacterDesigner';
import type {
  StoryAnchors,
  SevenPointStructure,
  StructuralRole,
} from '../../types/sourceAnalysis';

export interface IdentityAxisTarget {
  /** Identity axis key (e.g., "mercy_justice"). Must match IdentityProfile. */
  axis: keyof IdentityProfile;
  /** Signed delta target for this episode (e.g., +15). */
  delta: number;
  /** Author rationale for why the episode should move this axis. */
  rationale: string;
}

export interface RelationshipTrajectoryTarget {
  /** NPC id. */
  npcId: string;
  /** Target trust/respect/bond shift (positive or negative). */
  trustDelta?: number;
  respectDelta?: number;
  bondDelta?: number;
  /** Narrative target (e.g., "warm → cautious"). */
  trajectory: string;
  /** Author rationale. */
  rationale: string;
}

export interface ArcMilestone {
  /** Milestone id, used for flag-style tracking. */
  id: string;
  /** Scene/beat where milestone should land. */
  sceneId?: string;
  beatId?: string;
  /** Description of the arc beat (e.g., "refuses mentor's gift"). */
  description: string;
  /** Which phase of the arc this milestone occupies. */
  phase: 'establishment' | 'test' | 'turning_point' | 'commitment' | 'resolution';
}

export interface CharacterArcTargets {
  episodeId: string;
  identityTargets: IdentityAxisTarget[];
  relationshipTargets: RelationshipTrajectoryTarget[];
  milestones: ArcMilestone[];
  arcPhaseHeadline: string;
}

export interface CharacterArcTrackerInput {
  episodeBlueprint: EpisodeBlueprint;
  seasonBible: SeasonBible;
  characterBible: CharacterBible;
  /** Current identity profile at the start of the episode, if known. */
  startingIdentity?: Partial<IdentityProfile>;
  /** Episode index (1-based) for arc-phase reasoning. */
  episodeIndex: number;
  totalEpisodes: number;

  /**
   * Season narrative anchors. Identity deltas should move the protagonist
   * toward (or away from) the season Goal / Stakes, not drift randomly.
   */
  seasonAnchors?: StoryAnchors;

  /** Season-level 7-point beat map. */
  seasonSevenPoint?: SevenPointStructure;

  /**
   * Structural beat(s) this episode carries. Midpoint episodes should
   * emit a `turning_point` milestone; Climax episodes should emit
   * `commitment` or `resolution` milestones.
   */
  episodeStructuralRole?: StructuralRole[];
}

export class CharacterArcTracker extends BaseAgent {
  constructor(config: AgentConfig) {
    super('Character Arc Tracker', config);
    this.includeSystemPrompt = true;
  }

  protected getAgentSpecificPrompt(): string {
    return `
## Your Role: Character Arc Tracker

You translate a planned character arc into concrete, measurable targets for
THIS episode — identity axis deltas, relationship trajectories, and named
milestones. Downstream agents (ChoiceAuthor, validators) will honor or audit
against these targets.

**Arc phases**
1. **establishment**: Show the starting identity and its limits.
2. **test**: Challenge that identity — force a choice.
3. **turning_point**: The character commits to change (or doubles down).
4. **commitment**: Actions consistent with the new identity.
5. **resolution**: Final form; relationships restructured.

**Rules**
1. Identity deltas are signed integers in [-40, +40] per episode. Do not
   attempt the full arc in one episode.
2. Targets must match identity axes defined on \`IdentityProfile\`:
   mercy_justice, idealism_pragmatism, cautious_bold, loner_leader,
   heart_head, honest_deceptive.
3. Relationship deltas must name a real NPC id from the character bible.
4. Prefer 2-3 identity targets and 1-3 relationship targets — fewer targets
   hit well beat many targets hit weakly.
5. Milestones must anchor to blueprint scenes when possible.

**REQUIRED JSON STRUCTURE**
\`\`\`json
{
  "episodeId": "episode-1",
  "arcPhaseHeadline": "Test: Mara's loyalty is compromised for the first time",
  "identityTargets": [
    { "axis": "mercy_justice", "delta": 15, "rationale": "Mercy options are actively ironic here; justice feels earned." },
    { "axis": "honest_deceptive", "delta": -10, "rationale": "Forcing honesty even when it costs progress." }
  ],
  "relationshipTargets": [
    { "npcId": "mara", "trustDelta": -10, "bondDelta": 8, "trajectory": "warm → guarded but loyal", "rationale": "Trust cracks, bond deepens through adversity." }
  ],
  "milestones": [
    { "id": "mara-confrontation", "sceneId": "scene-04", "beatId": "beat-04-03", "description": "Mara confronts the player about the lie", "phase": "turning_point" }
  ]
}
\`\`\`

Return ONLY JSON.
`;
  }

  async execute(input: CharacterArcTrackerInput): Promise<AgentResponse<CharacterArcTargets>> {
    const prompt = this.buildPrompt(input);
    try {
      const response = await this.callLLM([{ role: 'user', content: prompt }]);
      let targets: CharacterArcTargets;
      try {
        targets = this.parseJSON<CharacterArcTargets>(response);
      } catch (parseError) {
        console.error('[CharacterArcTracker] JSON parse failed:', response.substring(0, 500));
        throw parseError;
      }
      targets = this.normalizeTargets(targets, input);
      return { success: true, data: targets, rawResponse: response };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error('[CharacterArcTracker] Error:', msg);
      return {
        success: true,
        data: {
          episodeId: input.episodeBlueprint.episodeId,
          arcPhaseHeadline: '',
          identityTargets: [],
          relationshipTargets: [],
          milestones: [],
        },
        error: msg,
      };
    }
  }

  private buildPrompt(input: CharacterArcTrackerInput): string {
    const startingIdentity = input.startingIdentity
      ? `\n## Starting Identity\n${JSON.stringify(input.startingIdentity, null, 2)}\n`
      : '';
    const arcPlan = (input.seasonBible as unknown as Record<string, unknown>) || {};
    const sceneSummary = input.episodeBlueprint.scenes
      .map(s => `- ${s.id} (${s.purpose}): ${s.description}`)
      .join('\n');
    return `# Episode ${input.episodeIndex} of ${input.totalEpisodes}: ${input.episodeBlueprint.episodeId}

## Scene Summary
${sceneSummary}

## Season Arc Plan
${JSON.stringify(arcPlan, null, 2)}
${startingIdentity}
Emit CharacterArcTargets per the REQUIRED JSON STRUCTURE above. Return ONLY JSON.`;
  }

  private normalizeTargets(targets: CharacterArcTargets, input: CharacterArcTrackerInput): CharacterArcTargets {
    const validAxes: Array<keyof IdentityProfile> = [
      'mercy_justice',
      'idealism_pragmatism',
      'cautious_bold',
      'loner_leader',
      'heart_head',
      'honest_deceptive',
    ];
    return {
      episodeId: targets.episodeId || input.episodeBlueprint.episodeId,
      arcPhaseHeadline: targets.arcPhaseHeadline || '',
      identityTargets: Array.isArray(targets.identityTargets)
        ? targets.identityTargets
            .filter(t => validAxes.includes(t.axis))
            .map(t => ({
              axis: t.axis,
              delta: Math.max(-40, Math.min(40, Math.round(Number(t.delta) || 0))),
              rationale: t.rationale || '',
            }))
        : [],
      relationshipTargets: Array.isArray(targets.relationshipTargets)
        ? targets.relationshipTargets.map(r => ({
            npcId: r.npcId,
            trustDelta: typeof r.trustDelta === 'number' ? r.trustDelta : undefined,
            respectDelta: typeof r.respectDelta === 'number' ? r.respectDelta : undefined,
            bondDelta: typeof r.bondDelta === 'number' ? r.bondDelta : undefined,
            trajectory: r.trajectory || '',
            rationale: r.rationale || '',
          }))
        : [],
      milestones: Array.isArray(targets.milestones)
        ? targets.milestones.map((m, idx) => ({
            id: m.id || `milestone-${idx + 1}`,
            sceneId: m.sceneId,
            beatId: m.beatId,
            description: m.description || '',
            phase: m.phase || 'test',
          }))
        : [],
    };
  }
}
