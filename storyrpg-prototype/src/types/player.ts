// ========================================
// PLAYER STATE TYPES
// ========================================

import type { ConditionExpression } from './conditions';
import type { DelayedConsequence } from './consequences';

// Core attributes (hidden from player)
export interface PlayerAttributes {
  charm: number;      // Social magnetism, persuasion
  wit: number;        // Cleverness, quick thinking
  courage: number;    // Bravery, willingness to take risks
  empathy: number;    // Understanding others' emotions
  resolve: number;    // Mental fortitude, determination
  resourcefulness: number; // Problem-solving, adaptability
}

// Skill definitions: each skill is a weighted blend of core attributes
export interface SkillDefinition {
  name: string;
  description: string;
  attributeWeights: Partial<Record<keyof PlayerAttributes, number>>; // must sum to 1.0
}

// Skills are genre-specific (e.g., "hacking", "sword_fighting", "diplomacy")
export type PlayerSkills = Record<string, number>;

// Relationship with an NPC
export interface Relationship {
  npcId: string;
  trust: number;      // -100 to 100
  affection: number;  // -100 to 100
  respect: number;    // -100 to 100
  fear: number;       // 0 to 100
}

// Identity tags (binary traits about the character)
export type PlayerTags = Set<string>;

// ========================================
// PLAYER IDENTITY PROFILE
// ========================================

/**
 * Identity dimensions emerge from accumulated player choices.
 * Each dimension is a spectrum from -100 to +100.
 * Values near 0 mean the player hasn't strongly established that trait.
 */
export interface IdentityProfile {
  // Moral compass
  mercy_justice: number;          // -100 (mercy) to +100 (justice)
  idealism_pragmatism: number;    // -100 (idealism) to +100 (pragmatism)

  // Social style
  cautious_bold: number;          // -100 (cautious) to +100 (bold)
  loner_leader: number;           // -100 (loner) to +100 (leader)

  // Approach
  heart_head: number;             // -100 (heart/emotion) to +100 (head/logic)
  honest_deceptive: number;       // -100 (honest) to +100 (deceptive)
}

export const DEFAULT_IDENTITY_PROFILE: IdentityProfile = {
  mercy_justice: 0,
  idealism_pragmatism: 0,
  cautious_bold: 0,
  loner_leader: 0,
  heart_head: 0,
  honest_deceptive: 0,
};

// Flags are story-specific booleans
export type PlayerFlags = Record<string, boolean>;

// Scores are story-specific integers
export type PlayerScores = Record<string, number>;

// Item in inventory
export interface InventoryItem {
  itemId: string;
  name: string;
  description: string;
  quantity: number;
  equipped?: boolean;
  statModifiers?: Partial<PlayerAttributes>;
}

// Visit tracking (Plan 2: post-episode flowchart).
// Each record captures one visit to a beat during playthrough. Choice commits
// attach a `choiceId`; plain advances leave it undefined. These records power
// the post-episode flowchart recap UI and rewind flow.
export interface VisitRecord {
  episodeId: string;
  sceneId: string;
  beatId: string;
  choiceId?: string;   // set when the visit was triggered by a choice commit
  visitedAt: number;   // Date.now() at visit time
}

// Summary of a completed episode, surfaced in the recap UI.
export interface EpisodeCompletion {
  episodeId: string;
  episodeNumber?: number;
  storyId: string;
  completedAt: number;
  // Ids of choices the player committed in this episode.
  committedChoiceIds: string[];
  // Distinct beats visited in this episode.
  beatsVisited: number;
  // Distinct scenes visited in this episode.
  scenesVisited: number;
}

// Complete player state
export interface PlayerState {
  // Character identity
  characterName: string;
  characterPronouns: 'he/him' | 'she/her' | 'they/them';

  // Core stats (hidden)
  attributes: PlayerAttributes;
  skills: PlayerSkills;

  // Relationships
  relationships: Record<string, Relationship>;

  // Three-layer state architecture
  flags: PlayerFlags;   // Boolean flags
  scores: PlayerScores; // Integer scores
  tags: PlayerTags;     // Identity markers

  // Identity profile (accumulated from choices)
  identityProfile: IdentityProfile;
  previousIdentityProfile?: IdentityProfile;

  // Delayed consequences queue (butterfly effect)
  pendingConsequences: DelayedConsequence[];

  // Inventory
  inventory: InventoryItem[];

  // Story progress
  currentStoryId: string | null;
  currentEpisodeId: string | null;
  currentSceneId: string | null;
  completedEpisodes: string[];

  // Plan 2: Playback visit log. Append-only during a playthrough; consulted
  // by the post-episode flowchart and rewind engine. Trimmed on `resetGame`.
  // Optional so legacy fixtures (and persisted state from before Plan 2)
  // hydrate without requiring a migration.
  visitLog?: VisitRecord[];

  // Plan 2: Per-episode completion summaries. One entry per `completeEpisode`
  // call.
  episodeCompletions?: EpisodeCompletion[];
}

// Re-export ConditionExpression so that `PlayerState`-adjacent helpers in
// downstream modules can pull the whole player surface from one place.
export type { ConditionExpression };
