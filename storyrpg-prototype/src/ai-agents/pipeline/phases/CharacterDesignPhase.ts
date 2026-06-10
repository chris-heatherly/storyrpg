/**
 * Character Design Phase
 *
 * Phase 2 of story generation: runs CharacterDesigner to produce the
 * character bible — protagonist entry assembly, NPC dedup against the
 * protagonist (by id and name), and the season-plan character-architecture /
 * information-ledger context.
 *
 * Faithful port of FullStoryPipeline.runCharacterDesign (pure move): same
 * prompt, same events, same abort behavior. The monolith keeps a thin
 * delegating runCharacterDesign wrapper covering all three call sites
 * (initial design, PhaseValidator retry, the NPC-depth Karpathy retry).
 * `cachedPipelineMemory` is accessor-backed run-scoped state.
 */

import { CharacterBible, CharacterDesigner } from '../../agents/CharacterDesigner';
import { WorldBible } from '../../agents/WorldBuilder';
import { withTimeout, PIPELINE_TIMEOUTS } from '../../utils/withTimeout';
import { PipelineError } from '../errors';
import type { FullCreativeBrief } from '../FullStoryPipeline';
import { PipelineContext } from './index';

// ========================================
// DEPENDENCY TYPES
// ========================================

export interface CharacterDesignPhaseDeps {
  characterDesigner: Pick<CharacterDesigner, 'execute'>;
  /** Accessor-backed run-scoped state. */
  readonly cachedPipelineMemory: string | null;
}

// ========================================
// PHASE IMPLEMENTATION
// ========================================

export class CharacterDesignPhase {
  readonly name = 'character_design';

  constructor(private readonly deps: CharacterDesignPhaseDeps) {}

  async run(
    brief: FullCreativeBrief,
    worldBible: WorldBible,
    context: PipelineContext
  ): Promise<CharacterBible> {
    context.emit({ type: 'agent_start', agent: 'CharacterDesigner', message: 'Designing characters' });

    const protagonistEntry = {
      id: brief.protagonist.id,
      name: brief.protagonist.name,
      role: 'protagonist' as const,
      briefDescription: brief.protagonist.description,
      importance: 'major' as const,
      fashionStyle: brief.protagonist.fashionStyle,
    };

    // Deduplicate: filter any NPC that shares an ID or name with the protagonist
    const protId = brief.protagonist.id;
    const protName = brief.protagonist.name?.toLowerCase();
    const npcEntries = brief.npcs
      .filter(npc => npc.id !== protId && npc.name?.toLowerCase() !== protName)
      .map(npc => ({
        id: npc.id,
        name: npc.name,
        role: npc.role,
        briefDescription: npc.description,
        importance: npc.importance,
        fashionStyle: npc.fashionStyle,
      }));

    const charactersToCreate = [protagonistEntry, ...npcEntries];

    const result = await withTimeout(this.deps.characterDesigner.execute({
      storyContext: {
        title: brief.story.title,
        genre: brief.story.genre,
        tone: brief.story.tone,
        themes: brief.story.themes,
        userPrompt: brief.userPrompt,
      },
      charactersToCreate,
      worldContext: worldBible.worldRules.join('. '),
      culturalNotes: worldBible.customs,
      rawDocument: brief.rawDocument,
      memoryContext: this.deps.cachedPipelineMemory || undefined,
      seasonAnchors: brief.seasonPlan?.anchors,
      seasonSevenPoint: brief.seasonPlan?.sevenPoint,
      characterArchitecture: brief.seasonPlan?.characterArchitecture,
      informationLedger: brief.seasonPlan?.informationLedger,
    }), PIPELINE_TIMEOUTS.llmAgent, 'CharacterDesigner.execute');

    if (!result.success || !result.data) {
      throw new PipelineError(
        `Character Designer failed: ${result.error}`,
        'character_design',
        {
          agent: 'CharacterDesigner',
          context: {
            charactersRequested: charactersToCreate.length,
            characterNames: charactersToCreate.map(c => c.name),
          },
        }
      );
    }

    // Single-protagonist invariant (G12 endsong): `role: 'protagonist'` is
    // reserved for the player character. Source material with a narrative
    // co-lead (love interest, adapted novel hero) can come back from the
    // designer with a SECOND protagonist-roled profile, and downstream
    // consumers key on role — prepareValidationInput excludes role-protagonists
    // from the validator NPC roster (witness refs then hard-fail as "unknown
    // NPC" while assembly's id-based story.npcs filter keeps them), and the
    // image team resolves "the protagonist" by first role match. Demote any
    // non-player protagonist to 'ally' (core co-lead) and re-assert the player
    // character's role so role==='protagonist' is a safe key everywhere.
    const demoted: string[] = [];
    for (const character of result.data.characters) {
      const isPlayer = character.id === protId
        || (!!protName && character.name?.toLowerCase() === protName);
      if (character.role === 'protagonist' && !isPlayer) {
        character.role = 'ally';
        demoted.push(`${character.id} (${character.name})`);
      } else if (isPlayer && character.role !== 'protagonist') {
        character.role = 'protagonist';
      }
    }
    if (demoted.length > 0) {
      context.emit({
        type: 'warning',
        phase: 'character_design',
        message: `Demoted ${demoted.length} non-player 'protagonist' profile(s) to 'ally' (role is reserved for ${brief.protagonist.name}): ${demoted.join(', ')}`,
      });
    }

    context.emit({
      type: 'agent_complete',
      agent: 'CharacterDesigner',
      message: `Created ${result.data.characters.length} character profiles`,
    });

    return result.data;
  }
}
