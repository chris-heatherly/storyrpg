/**
 * SceneCritic — optional rewrite pass that improves subtext, reversals, and
 * show-don't-tell quality on an already-authored scene.
 *
 * This is a *surgical* critic: it keeps the scene's structure, beat ids, and
 * narrative events intact but rewrites prose where it is flat, on-the-nose,
 * or lacks subtext/reversal. It is expensive and is intended to run as an
 * optional pass (gated by config).
 *
 * The caller is responsible for merging the rewritten beats back into the
 * authored SceneContent object.
 */

import { AgentConfig } from '../config';
import { BaseAgent, AgentResponse } from './BaseAgent';
import { SceneContent, GeneratedBeat } from './SceneWriter';
import { CharacterBible } from './CharacterDesigner';

export interface SceneCriticInput {
  scene: SceneContent;
  /** Optional character bible for voice consistency. */
  characterBible?: CharacterBible;
  /** Optional extra guidance for the critic (e.g. "lean into irony"). */
  directorNotes?: string;
  /** Optional minimum review threshold — beats the caller considers weak. */
  flaggedBeatIds?: string[];
}

export interface SceneCritique {
  sceneId: string;
  rewrittenBeats: GeneratedBeat[];
  /** Per-beat author notes explaining what changed and why. */
  critiqueNotes: Array<{ beatId: string; issue: string; fix: string }>;
  /** Overall take on the scene's subtext and reversal density. */
  overallCommentary: string;
}

export class SceneCritic extends BaseAgent {
  constructor(config: AgentConfig) {
    super('Scene Critic', config);
    this.includeSystemPrompt = true;
  }

  protected getAgentSpecificPrompt(): string {
    return `
## Your Role: Scene Critic

You rewrite prose that is flat, on-the-nose, or lacks subtext. You keep the
scene's beat ids, scene id, choice points, speakers, speaker moods, and
plot-point markers intact. You rewrite the *text* field of each beat (and
\`textVariants\` when relevant) to:

**Priorities**
1. **Show, don't tell.** Replace declarative emotion ("she was angry") with
   behavior ("she set the glass down too carefully"). Never add new plot.
2. **Subtext over declaration.** Characters rarely say what they mean in
   charged moments. Leverage irony, deflection, contradiction.
3. **Micro-reversal.** If a beat drifts, invert expectation — the threat
   turns funny, the ally turns guarded, the safe room becomes claustrophobic.
4. **Voice fidelity.** Honor character voice profiles; no cross-voice bleed.
5. **Sensory specificity.** Prefer concrete sensory detail over abstraction.

**Rules**
- You MUST preserve beat id, speaker, speakerMood, plotPointType, and any
  plantsThreadId / paysOffThreadId / twistKind markers.
- You MAY tighten or loosen prose length up to ±30%.
- You MUST NOT invent new NPCs, flags, or plot events.
- You MUST NOT touch the scene's choice set.

**REQUIRED JSON STRUCTURE**
\`\`\`json
{
  "sceneId": "scene-03",
  "overallCommentary": "Scene was expositional; tightened dialogue, added an ironic reversal at beat-03-04.",
  "critiqueNotes": [
    { "beatId": "beat-03-02", "issue": "On-the-nose emotional declaration", "fix": "Replaced 'she was terrified' with a behavioral tell." }
  ],
  "rewrittenBeats": [
    { "id": "beat-03-01", "text": "...rewritten prose...", "speaker": "Mara", "speakerMood": "guarded", "plotPointType": "setup" }
  ]
}
\`\`\`

Only include beats you actually rewrote in \`rewrittenBeats\` — the caller
will merge them back in, leaving untouched beats as-is. Return ONLY JSON.
`;
  }

  async execute(input: SceneCriticInput): Promise<AgentResponse<SceneCritique>> {
    const prompt = this.buildPrompt(input);
    try {
      const response = await this.callLLM([{ role: 'user', content: prompt }]);
      let critique: SceneCritique;
      try {
        critique = this.parseJSON<SceneCritique>(response);
      } catch (parseError) {
        console.error('[SceneCritic] JSON parse failed:', response.substring(0, 500));
        throw parseError;
      }
      critique = this.normalize(critique, input);
      return { success: true, data: critique, rawResponse: response };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error('[SceneCritic] Error:', msg);
      return {
        success: true,
        data: {
          sceneId: input.scene.sceneId,
          rewrittenBeats: [],
          critiqueNotes: [],
          overallCommentary: '',
        },
        error: msg,
      };
    }
  }

  private buildPrompt(input: SceneCriticInput): string {
    const beatsDump = input.scene.beats
      .map(b => {
        const flagged = input.flaggedBeatIds?.includes(b.id) ? ' [FLAGGED]' : '';
        return `### Beat ${b.id}${flagged}\n- speaker: ${b.speaker || '(narrator)'}\n- mood: ${b.speakerMood || '(neutral)'}\n- plotPointType: ${b.plotPointType || 'none'}\n- text: ${b.text}`;
      })
      .join('\n\n');

    const voiceBlock = input.characterBible
      ? `\n## Voice Profiles\n${(input.characterBible.characters || [])
          .slice(0, 6)
          .map(c => {
            const profile = (c as unknown as { voiceProfile?: { rhythm?: string; lexicon?: string; tics?: string[] } }).voiceProfile;
            return `- ${c.id || c.name}: rhythm=${profile?.rhythm || 'n/a'}, lexicon=${profile?.lexicon || 'n/a'}, tics=${(profile?.tics || []).join(', ')}`;
          })
          .join('\n')}\n`
      : '';

    const directorNotes = input.directorNotes ? `\n## Director Notes\n${input.directorNotes}\n` : '';

    return `# Scene: ${input.scene.sceneId}\n\n${beatsDump}\n${voiceBlock}${directorNotes}\nApply the Scene Critic rewrite per the REQUIRED JSON STRUCTURE above. Return ONLY JSON.`;
  }

  private normalize(critique: SceneCritique, input: SceneCriticInput): SceneCritique {
    const validIds = new Set(input.scene.beats.map(b => b.id));
    const rewrittenBeats = Array.isArray(critique.rewrittenBeats)
      ? critique.rewrittenBeats.filter(b => b && typeof b.id === 'string' && validIds.has(b.id))
      : [];
    return {
      sceneId: critique.sceneId || input.scene.sceneId,
      rewrittenBeats,
      critiqueNotes: Array.isArray(critique.critiqueNotes)
        ? critique.critiqueNotes.filter(n => n && typeof n.beatId === 'string')
        : [],
      overallCommentary: critique.overallCommentary || '',
    };
  }
}
