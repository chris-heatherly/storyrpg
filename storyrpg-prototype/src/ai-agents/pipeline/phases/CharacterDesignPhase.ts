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
import type { CharacterFashionStyle } from '../../../types/sourceAnalysis';
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
    const npcVisualByName = new Map(
      (brief.seasonPlan?.treatmentSeasonGuidance?.npcGuidance ?? [])
        .filter((npc) => npc.visualIdentity?.trim())
        .map((npc) => [npc.name.toLowerCase().trim(), npc.visualIdentity!.trim()] as const),
    );
    const npcEntries = brief.npcs
      .filter(npc => npc.id !== protId && npc.name?.toLowerCase() !== protName)
      .map(npc => {
        const treatmentVisual = npcVisualByName.get(npc.name.toLowerCase().trim());
        const fashionStyle: CharacterFashionStyle | undefined = npc.fashionStyle
          || (treatmentVisual
            ? {
                styleSummary: treatmentVisual,
                styleTags: [],
                signatureGarments: [],
                materials: [],
                colorPalette: [],
                accessories: [],
                sourceEvidence: [treatmentVisual],
              }
            : undefined);
        return {
          id: npc.id,
          name: npc.name,
          role: npc.role,
          briefDescription: treatmentVisual
            ? `${npc.description || ''}\nVisual identity (immutable): ${treatmentVisual}`.trim()
            : npc.description,
          importance: npc.importance,
          fashionStyle,
        };
      });

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
      characterArchitecture: brief.seasonPlan?.characterArchitecture,
      characterTreatmentContracts: brief.seasonPlan?.characterTreatmentContracts,
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

    // G12: a freeform treatment leaves brief.protagonist as documentParser's
    // placeholder ("The Hero", he/him) while the bible carries the real identity
    // (Kylie Marinescu, she/her). Every downstream consumer — SceneWriter/
    // EncounterArchitect protagonist context, the pronoun resolver, the final
    // contract — reads brief.protagonist, so the placeholder shipped he/him
    // pronouns into encounter clocks and disarmed the pronoun repair entirely.
    // Sync the brief from the bible's protagonist entry (single source of truth
    // post-invariant) before anything else consumes it.
    const bibleProtagonist = result.data.characters.find(c => c.role === 'protagonist');
    if (bibleProtagonist?.name) {
      const changes: string[] = [];
      if (brief.protagonist.name !== bibleProtagonist.name) {
        changes.push(`name "${brief.protagonist.name}" → "${bibleProtagonist.name}"`);
        brief.protagonist.name = bibleProtagonist.name;
      }
      if (bibleProtagonist.id && brief.protagonist.id !== bibleProtagonist.id) {
        changes.push(`id "${brief.protagonist.id}" → "${bibleProtagonist.id}"`);
        brief.protagonist.id = bibleProtagonist.id;
      }
      const rawPronouns = (bibleProtagonist as { pronouns?: string }).pronouns?.trim().toLowerCase();
      const biblePronouns = rawPronouns === 'he/him' || rawPronouns === 'she/her' || rawPronouns === 'they/them'
        ? rawPronouns
        : undefined;
      if (biblePronouns && brief.protagonist.pronouns !== biblePronouns) {
        changes.push(`pronouns "${brief.protagonist.pronouns}" → "${biblePronouns}"`);
        brief.protagonist.pronouns = biblePronouns;
      }
      if (changes.length > 0) {
        context.emit({
          type: 'warning',
          phase: 'character_design',
          message: `brief.protagonist synced from character bible (placeholder or drift): ${changes.join('; ')}`,
        });
      }
    }

    return result.data;
  }
}
