/**
 * Relationship Dynamics Analysis
 *
 * Deterministic pre-computation that evaluates NPC relationships against
 * dramatic thresholds and produces a compact brief for LLM prompt injection.
 * No LLM calls — pure code that runs instantly before encounter generation.
 */

import { Relationship } from '../../types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DramaticPossibilityType =
  | 'betrayal_risk'
  | 'betrayal_likely'
  | 'devotion'
  | 'volatile_bond'
  | 'dominated'
  | 'contempt'
  | 'factional_tension'
  | 'relationship_shift';

export interface DramaticPossibility {
  type: DramaticPossibilityType;
  description: string;
  involvedNpcIds?: string[];
}

export interface NPCDynamic {
  npcId: string;
  npcName: string;
  currentState: Record<'trust' | 'affection' | 'respect' | 'fear', number>;
  dramaticPossibilities: DramaticPossibility[];
}

export interface KnockOnEffect {
  trigger: string;
  effects: Array<{
    npcId: string;
    dimension: 'trust' | 'affection' | 'respect' | 'fear';
    direction: 'positive' | 'negative';
    reason: string;
  }>;
}

export interface RelationshipDynamicsBrief {
  npcDynamics: NPCDynamic[];
  knockOnEffects: KnockOnEffect[];
  briefText: string;
}

// ---------------------------------------------------------------------------
// Thresholds (configurable defaults)
// ---------------------------------------------------------------------------

export interface DramaticThresholds {
  betrayalRisk: number;
  betrayalLikely: number;
  devotion: number;
  volatileBondAffection: number;
  volatileBondTrust: number;
  dominated: number;
  contempt: number;
  factionalTensionAlly: number;
  factionalTensionRival: number;
  relationshipShiftDelta: number;
}

const DEFAULT_THRESHOLDS: DramaticThresholds = {
  betrayalRisk: -40,
  betrayalLikely: -60,
  devotion: 50,
  volatileBondAffection: 50,
  volatileBondTrust: 0,
  dominated: 40,
  contempt: -30,
  factionalTensionAlly: 30,
  factionalTensionRival: -20,
  relationshipShiftDelta: 20,
};

// ---------------------------------------------------------------------------
// Input types
// ---------------------------------------------------------------------------

export interface NPCInfo {
  id: string;
  name: string;
  role?: 'ally' | 'enemy' | 'neutral' | 'obstacle';
}

export interface RelationshipSnapshot {
  current: Record<string, Relationship>;
  /** Previous snapshot (e.g. start of episode) for delta detection. */
  previous?: Record<string, Relationship>;
}

// ---------------------------------------------------------------------------
// Core analysis
// ---------------------------------------------------------------------------

export function analyzeRelationshipDynamics(
  npcsInvolved: NPCInfo[],
  relationships: RelationshipSnapshot,
  allNpcs?: NPCInfo[],
  thresholds: DramaticThresholds = DEFAULT_THRESHOLDS,
): RelationshipDynamicsBrief {
  const npcDynamics: NPCDynamic[] = [];
  const knockOnEffects: KnockOnEffect[] = [];

  const involvedIds = new Set(npcsInvolved.map(n => n.id));
  const npcMap = new Map<string, NPCInfo>();
  for (const npc of npcsInvolved) npcMap.set(npc.id, npc);
  if (allNpcs) {
    for (const npc of allNpcs) {
      if (!npcMap.has(npc.id)) npcMap.set(npc.id, npc);
    }
  }

  for (const npc of npcsInvolved) {
    const rel = relationships.current[npc.id];
    if (!rel) continue;

    const state: Record<'trust' | 'affection' | 'respect' | 'fear', number> = {
      trust: rel.trust,
      affection: rel.affection,
      respect: rel.respect,
      fear: rel.fear,
    };

    const possibilities: DramaticPossibility[] = [];

    if (rel.trust <= thresholds.betrayalLikely) {
      possibilities.push({
        type: 'betrayal_likely',
        description: `${npc.name} is actively looking for an opening to betray you.`,
      });
    } else if (rel.trust <= thresholds.betrayalRisk) {
      possibilities.push({
        type: 'betrayal_risk',
        description: `${npc.name}'s loyalty is fragile. Showing weakness or siding against them could trigger a betrayal.`,
      });
    }

    if (rel.affection >= thresholds.devotion && rel.trust >= 0) {
      possibilities.push({
        type: 'devotion',
        description: `${npc.name} is deeply devoted. They would sacrifice or intervene to protect you.`,
      });
    }

    if (rel.affection >= thresholds.volatileBondAffection && rel.trust < thresholds.volatileBondTrust) {
      possibilities.push({
        type: 'volatile_bond',
        description: `${npc.name} loves you but doesn't trust you — a volatile combination.`,
      });
    }

    if (rel.fear >= thresholds.dominated) {
      possibilities.push({
        type: 'dominated',
        description: `${npc.name} is too afraid to openly resist you, but resentment may be building.`,
      });
    }

    if (rel.respect <= thresholds.contempt) {
      possibilities.push({
        type: 'contempt',
        description: `${npc.name} sees you as beneath them and may act dismissively or cruelly.`,
      });
    }

    // Factional tension: check other involved NPCs
    for (const otherNpc of npcsInvolved) {
      if (otherNpc.id === npc.id) continue;
      const otherRel = relationships.current[otherNpc.id];
      if (!otherRel) continue;

      if (rel.trust >= thresholds.factionalTensionAlly && otherRel.trust <= thresholds.factionalTensionRival) {
        possibilities.push({
          type: 'factional_tension',
          description: `Your bond with ${npc.name} makes ${otherNpc.name} nervous.`,
          involvedNpcIds: [npc.id, otherNpc.id],
        });
      }
    }

    // Relationship shift detection
    if (relationships.previous) {
      const prevRel = relationships.previous[npc.id];
      if (prevRel) {
        for (const dim of ['trust', 'affection', 'respect', 'fear'] as const) {
          const delta = Math.abs(rel[dim] - prevRel[dim]);
          if (delta >= thresholds.relationshipShiftDelta) {
            const direction = rel[dim] > prevRel[dim] ? 'risen' : 'fallen';
            possibilities.push({
              type: 'relationship_shift',
              description: `${npc.name}'s ${dim} has ${direction} sharply. Something has changed between you.`,
            });
          }
        }
      }
    }

    npcDynamics.push({ npcId: npc.id, npcName: npc.name, currentState: state, dramaticPossibilities: possibilities });
  }

  // Build knock-on effects between involved NPCs
  computeKnockOnEffects(npcsInvolved, relationships.current, npcMap, knockOnEffects);

  const briefText = formatBriefText(npcDynamics, knockOnEffects);

  return { npcDynamics, knockOnEffects, briefText };
}

// ---------------------------------------------------------------------------
// Knock-on effect computation
// ---------------------------------------------------------------------------

function computeKnockOnEffects(
  npcsInvolved: NPCInfo[],
  currentRelationships: Record<string, Relationship>,
  npcMap: Map<string, NPCInfo>,
  knockOnEffects: KnockOnEffect[],
): void {
  for (let i = 0; i < npcsInvolved.length; i++) {
    for (let j = i + 1; j < npcsInvolved.length; j++) {
      const npcA = npcsInvolved[i];
      const npcB = npcsInvolved[j];
      const relA = currentRelationships[npcA.id];
      const relB = currentRelationships[npcB.id];
      if (!relA || !relB) continue;

      // If trust differs significantly, siding with one against the other has consequences
      const trustDiff = relA.trust - relB.trust;
      if (Math.abs(trustDiff) >= 30) {
        const favored = trustDiff > 0 ? npcA : npcB;
        const slighted = trustDiff > 0 ? npcB : npcA;

        knockOnEffects.push({
          trigger: `side with ${favored.name} against ${slighted.name}`,
          effects: [
            { npcId: slighted.id, dimension: 'trust', direction: 'negative', reason: `${slighted.name} feels betrayed by your choice` },
            { npcId: favored.id, dimension: 'trust', direction: 'positive', reason: `${favored.name} appreciates your loyalty` },
          ],
        });
      }

      // If one NPC has high affection and another is romantic rival territory
      if (relA.affection >= 40 && relB.affection >= 40) {
        knockOnEffects.push({
          trigger: `show romantic attention to ${npcA.name} in front of ${npcB.name}`,
          effects: [
            { npcId: npcB.id, dimension: 'affection', direction: 'negative', reason: `${npcB.name} feels hurt and jealous` },
            { npcId: npcA.id, dimension: 'affection', direction: 'positive', reason: `${npcA.name} is flattered by the attention` },
          ],
        });
        knockOnEffects.push({
          trigger: `show romantic attention to ${npcB.name} in front of ${npcA.name}`,
          effects: [
            { npcId: npcA.id, dimension: 'affection', direction: 'negative', reason: `${npcA.name} feels hurt and jealous` },
            { npcId: npcB.id, dimension: 'affection', direction: 'positive', reason: `${npcB.name} is flattered by the attention` },
          ],
        });
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Brief text formatting
// ---------------------------------------------------------------------------

function formatBriefText(npcDynamics: NPCDynamic[], knockOnEffects: KnockOnEffect[]): string {
  if (npcDynamics.length === 0) return '';

  const lines: string[] = ['**Relationship Dynamics:**'];

  for (const npc of npcDynamics) {
    const tags = npc.dramaticPossibilities.map(p => p.type.toUpperCase().replace(/_/g, ' ')).join(', ');
    const statLine = `trust: ${npc.currentState.trust}, affection: ${npc.currentState.affection}, respect: ${npc.currentState.respect}, fear: ${npc.currentState.fear}`;

    if (npc.dramaticPossibilities.length > 0) {
      lines.push(`- ${npc.npcName} (${statLine}, ${tags}): ${npc.dramaticPossibilities[0].description}`);
      for (let i = 1; i < npc.dramaticPossibilities.length; i++) {
        lines.push(`  ${npc.dramaticPossibilities[i].description}`);
      }
    } else {
      lines.push(`- ${npc.npcName} (${statLine}): Relationship is stable.`);
    }
  }

  if (knockOnEffects.length > 0) {
    lines.push('');
    lines.push('**Knock-on effects:**');
    for (const ko of knockOnEffects) {
      const effectDescs = ko.effects.map(e => `${e.npcId} ${e.dimension} ${e.direction === 'positive' ? '+' : '-'} (${e.reason})`);
      lines.push(`- If player ${ko.trigger}: ${effectDescs.join('; ')}`);
    }
  }

  return lines.join('\n');
}
