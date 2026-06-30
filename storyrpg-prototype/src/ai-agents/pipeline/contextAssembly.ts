/**
 * Context assembly (WS2.1, AGENT_ARCHITECTURE_PLAN_2026-06-12).
 *
 * The pure "build agent X's prompt context from run inputs" helpers, extracted
 * from FullStoryPipeline (monolith ratchet). These are the functions phases
 * borrow as injected closures (ContentGenerationPhaseDeps) — the knowledge of
 * how to compress a WorldBible for a prompt, enrich an NPC roster for
 * ChoiceAuthor, or reconstruct an encounter's prior-state contract lives HERE,
 * not in the orchestrator.
 *
 * Everything in this module is pure over its inputs; the one runtime
 * dependency (the incremental validator's relationship upper bound) is an
 * injected lookup. The monolith keeps one-line delegating wrappers so the
 * existing deps wiring and prompts are byte-identical.
 */

import type { CharacterBible } from '../agents/CharacterDesigner';
import type { EncounterArchitectInput } from '../agents/EncounterArchitect';
import type { EpisodeBlueprint, SceneBlueprint } from '../agents/StoryArchitect';
import type { WorldBible } from '../agents/WorldBuilder';
import { resolveCharacterProfile } from '../utils/characterProfileResolver';
import { deriveStoryVerbs } from '../utils/storyVerbs';

export interface ChoiceAuthorNpc {
  id: string;
  name: string;
  pronouns: 'he/him' | 'she/her' | 'they/them';
  description: string;
  voiceNotes?: string;
  physicalDescription?: string;
}

/** Build enriched NPC descriptions for ChoiceAuthor with voice and physical details. */
export function buildChoiceAuthorNpcs(
  npcIds: string[],
  characterBible: CharacterBible
): ChoiceAuthorNpc[] {
  return npcIds.map(npcId => {
    const profile = resolveCharacterProfile(characterBible.characters, npcId);
    return {
      id: npcId,
      name: profile?.name || npcId,
      pronouns: (profile?.pronouns || 'he/him') as 'he/him' | 'she/her' | 'they/them',
      description: profile?.overview || '',
      voiceNotes: profile?.voiceProfile?.writingGuidance,
      physicalDescription: profile?.physicalDescription,
    };
  });
}

/**
 * Build a compact world brief for agents that need broader world context.
 * Keeps token cost low by summarizing rather than dumping full bible.
 */
export function buildCompactWorldContext(worldBible: WorldBible, locationDescription?: string): string {
  const parts: string[] = [];
  if (locationDescription) parts.push(locationDescription);
  if (worldBible.worldRules.length > 0) {
    parts.push(`World rules: ${worldBible.worldRules.slice(0, 5).join('. ')}`);
  }
  if (worldBible.tensions.length > 0) {
    parts.push(`Tensions: ${worldBible.tensions.slice(0, 3).join('. ')}`);
  }
  if (worldBible.factions && worldBible.factions.length > 0) {
    parts.push(`Factions: ${worldBible.factions.slice(0, 4).map(f => f.name + (f.overview ? ` (${f.overview.substring(0, 60)})` : '')).join('; ')}`);
  }
  if (worldBible.customs && worldBible.customs.length > 0) {
    parts.push(`Customs: ${worldBible.customs.slice(0, 3).join('. ')}`);
  }
  return parts.join('\n');
}

/** Genre/tone-native verbs for choice authoring, with optional world flavoring. */
export function deriveStoryVerbsForBrief(
  brief: { story: { genre: string; tone: string; synopsis?: string } },
  worldBible?: WorldBible
) {
  return deriveStoryVerbs({
    genre: brief.story.genre,
    tone: brief.story.tone,
    sourceSummary: brief.story.synopsis,
    worldContext: worldBible ? buildCompactWorldContext(worldBible) : undefined,
  });
}

/**
 * Infer branch type from scene blueprint context.
 * Used for visual differentiation (lighting, color, mood).
 */
export function inferBranchType(
  sceneBlueprint: SceneBlueprint,
  blueprint: EpisodeBlueprint
): 'dark' | 'hopeful' | 'neutral' | 'tragic' | 'redemption' {
  // Check mood keywords
  const moodLower = sceneBlueprint.mood.toLowerCase();

  // Dark indicators
  if (moodLower.includes('dark') || moodLower.includes('grim') ||
      moodLower.includes('ominous') || moodLower.includes('dread') ||
      moodLower.includes('desperate') || moodLower.includes('bleak')) {
    return 'dark';
  }

  // Hopeful indicators
  if (moodLower.includes('hopeful') || moodLower.includes('bright') ||
      moodLower.includes('warm') || moodLower.includes('optimistic') ||
      moodLower.includes('triumphant') || moodLower.includes('joyful')) {
    return 'hopeful';
  }

  // Tragic indicators
  if (moodLower.includes('tragic') || moodLower.includes('mournful') ||
      moodLower.includes('grief') || moodLower.includes('loss') ||
      moodLower.includes('funeral') || moodLower.includes('death')) {
    return 'tragic';
  }

  // Redemption indicators
  if (moodLower.includes('redemption') || moodLower.includes('forgiveness') ||
      moodLower.includes('reconciliation') || moodLower.includes('second chance') ||
      moodLower.includes('healing')) {
    return 'redemption';
  }

  // Check scene purpose for additional context
  if (sceneBlueprint.purpose === 'bottleneck') {
    // Bottlenecks tend to be more intense/darker
    if (moodLower.includes('tense') || moodLower.includes('conflict')) {
      return 'dark';
    }
  }

  // Check if this is on a branch path (not a bottleneck)
  // Non-bottleneck scenes after choices might have stronger tonal variation
  const isOnBranch = sceneBlueprint.purpose === 'branch' ||
    (!blueprint.bottleneckScenes?.includes(sceneBlueprint.id) &&
     blueprint.scenes.some(s => s.leadsTo?.includes(sceneBlueprint.id) && s.choicePoint));

  if (isOnBranch) {
    // Branch scenes should have more distinct tones
    // Default to slightly darker for tension
    if (moodLower.includes('tense') || moodLower.includes('suspense')) {
      return 'dark';
    }
  }

  return 'neutral';
}

/** The current achievable upper bound of an NPC relationship dimension. */
export type RelationshipUpperBoundFn = (npcId: string, dimension: string) => number;

export function buildEncounterPriorStateContext(
  encounterScene: SceneBlueprint,
  blueprint: EpisodeBlueprint,
  npcsInvolved: Array<{ id: string; name: string }>,
  flagsAlreadySet: ReadonlySet<string> | undefined,
  getRelationshipUpperBound: RelationshipUpperBoundFn | undefined
): EncounterArchitectInput['priorStateContext'] {
  const relevantFlags: Array<{ name: string; description: string; alreadySet?: boolean }> = [];
  const relevantRelationships: Array<{
    npcId: string; npcName: string;
    dimension: 'trust' | 'affection' | 'respect' | 'fear';
    operator: '==' | '!=' | '>' | '<' | '>=' | '<=';
    threshold: number; description: string;
    authored?: boolean;
    currentMaxValue?: number;
  }> = [];
  const significantChoices: string[] = [];

  // Parse encounterSetupContext directives authored by the StoryArchitect.
  // Format: "flag:<name> — <description>" or "relationship:<id>.<dim> <op> <n> — <description>"
  if (encounterScene.encounterSetupContext?.length) {
    for (const directive of encounterScene.encounterSetupContext) {
      if (directive.startsWith('flag:')) {
        const rest = directive.slice('flag:'.length);
        const dashIdx = rest.indexOf(' — ');
        const flagName = dashIdx !== -1 ? rest.slice(0, dashIdx).trim() : rest.trim();
        const flagDesc = dashIdx !== -1 ? rest.slice(dashIdx + 3).trim() : directive;
        relevantFlags.push({
          name: flagName,
          description: flagDesc,
          alreadySet: flagsAlreadySet?.has(flagName) ?? false,
        });
      } else if (directive.startsWith('relationship:')) {
        // e.g. "relationship:hindley.trust < -20 — description"
        const rest = directive.slice('relationship:'.length);
        const dashIdx = rest.indexOf(' — ');
        const expr = dashIdx !== -1 ? rest.slice(0, dashIdx).trim() : rest.trim();
        const desc = dashIdx !== -1 ? rest.slice(dashIdx + 3).trim() : directive;
        // Parse "npcId.dimension operator threshold"
        const match = expr.match(/^([^.]+)\.(\w+)\s*([<>=!]+)\s*(-?\d+)/);
        if (match) {
          const [, npcId, dimension, operator, thresholdStr] = match;
          const npc = npcsInvolved.find(n => n.id === npcId);
          const dims = ['trust', 'affection', 'respect', 'fear'] as const;
          const dim = dims.find(d => d === dimension);
          if (dim) {
            relevantRelationships.push({
              npcId,
              npcName: npc?.name || npcId,
              dimension: dim,
              operator: operator as '==' | '!=' | '>' | '<' | '>=' | '<=',
              threshold: parseInt(thresholdStr, 10),
              description: desc,
              authored: true,
            });
          }
        }
      }
      // Any directive not matching flag:/relationship: becomes a significant choice hint
      else {
        significantChoices.push(directive);
      }
    }
  }

  // Always include all blueprint-level suggestedFlags as potential payoff context
  // (the StoryArchitect defines these as flags the episode tracks).
  for (const flag of blueprint.suggestedFlags || []) {
    if (!relevantFlags.some(f => f.name === flag.name)) {
      relevantFlags.push({
        name: flag.name,
        description: flag.description,
        alreadySet: flagsAlreadySet?.has(flag.name) ?? false,
      });
    }
  }

  // Only synthesize default relationship thresholds when the blueprint provided none at all.
  // This keeps relationship payoffs feeling authored instead of boilerplate.
  const RELATIONSHIP_DIMS = ['trust', 'affection', 'respect', 'fear'] as const;
  if (relevantRelationships.length === 0) {
    for (const npc of npcsInvolved) {
      for (const dim of RELATIONSHIP_DIMS) {
        const maxVal = getRelationshipUpperBound?.(npc.id, dim) ?? 0;
        relevantRelationships.push({
          npcId: npc.id,
          npcName: npc.name,
          dimension: dim,
          operator: '>=',
          threshold: dim === 'fear' ? 40 : 20, // Sensible defaults
          description: `${npc.name}'s ${dim} level — consider authoring a variant when this value is high enough to matter`,
          authored: false,
          currentMaxValue: maxVal,
        });
      }
    }
  } else {
    // Annotate authored relationships with current achievable values
    for (const rel of relevantRelationships) {
      if (rel.currentMaxValue === undefined) {
        rel.currentMaxValue = getRelationshipUpperBound?.(rel.npcId, rel.dimension) ?? 0;
      }
    }
  }

  if (!relevantFlags.length && !relevantRelationships.length && !significantChoices.length) {
    return undefined;
  }

  return { relevantFlags, relevantRelationships, significantChoices };
}
