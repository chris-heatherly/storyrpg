/**
 * Episode recap utilities.
 * Used for "You Chose" / "Other Paths" / "Relationships Changed" summaries.
 */

import type { PlayerState, AppliedConsequence } from '../types';
import type { Consequence } from '../types';
import { getRelationshipDescription } from '../engine/storyEngine';

export interface EpisodeChoiceRecapItem {
  id: string;
  chosenText: string;
  summary: string;
  otherPaths: string[];
  relationshipNotes: string[];
  consequences?: AppliedConsequence[];
}

export interface EpisodeRelationshipRecapItem {
  npcId: string;
  npcName: string;
  summary: string;
}

export interface EpisodeRecapData {
  episodeTitle: string;
  youChose: EpisodeChoiceRecapItem[];
  otherPaths: string[];
  relationshipChanges: EpisodeRelationshipRecapItem[];
}

export function cloneRelationshipMap(
  relationships: PlayerState['relationships']
): PlayerState['relationships'] {
  return Object.fromEntries(
    Object.entries(relationships).map(([npcId, rel]) => [npcId, { ...rel }])
  );
}

export function applyRelationshipConsequencesToSnapshot(
  base: PlayerState['relationships'],
  consequences: Consequence[] | undefined
): PlayerState['relationships'] {
  const next = cloneRelationshipMap(base);
  for (const consequence of consequences || []) {
    if (consequence.type !== 'relationship') continue;
    const existing = next[consequence.npcId] || {
      npcId: consequence.npcId,
      trust: 0,
      affection: 0,
      respect: 0,
      fear: 0,
    };
    const minVal = consequence.dimension === 'fear' ? 0 : -100;
    next[consequence.npcId] = {
      ...existing,
      [consequence.dimension]: Math.max(
        minVal,
        Math.min(100, existing[consequence.dimension] + consequence.change)
      ),
    };
  }
  return next;
}

export function formatNpcName(
  npcId: string,
  story?: { npcs?: Array<{ id: string; name: string }> } | null
): string {
  return story?.npcs?.find((npc) => npc.id === npcId)?.name
    || npcId.replace(/^char[-_]/i, '').replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

export function summarizeRelationshipChanges(
  before: PlayerState['relationships'],
  after: PlayerState['relationships'],
  story?: { npcs?: Array<{ id: string; name: string }> } | null
): EpisodeRelationshipRecapItem[] {
  const items: EpisodeRelationshipRecapItem[] = [];
  const npcIds = new Set([...Object.keys(before || {}), ...Object.keys(after || {})]);

  for (const npcId of npcIds) {
    const prev = before[npcId];
    const next = after[npcId];
    if (!prev || !next) continue;

    const lines: string[] = [];
    for (const dimension of ['trust', 'affection', 'respect', 'fear'] as const) {
      const delta = next[dimension] - prev[dimension];
      if (delta === 0) continue;
      const verb = delta > 0 ? 'rose' : 'fell';
      lines.push(`${dimension.charAt(0).toUpperCase() + dimension.slice(1)} ${verb}; ${formatNpcName(npcId, story)} ${getRelationshipDescription(dimension, next[dimension])}.`);
    }

    if (lines.length > 0) {
      items.push({
        npcId,
        npcName: formatNpcName(npcId, story),
        summary: lines.join(' '),
      });
    }
  }

  return items;
}
