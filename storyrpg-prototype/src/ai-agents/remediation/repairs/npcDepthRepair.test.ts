import { describe, it, expect } from 'vitest';
import type { Story, RelationshipDimension } from '../../../types';
import { repairNPCDepth } from './npcDepthRepair';

const GATE_FLAG = 'GATE_NPC_DEPTH';
const enabled = (flag: string): boolean => flag === GATE_FLAG;
const disabled = (): boolean => false;

/** Build a minimal Story with just the NPC fields the repair reads. */
function makeStory(
  npcs: Array<{
    id: string;
    tier?: Story['npcs'][number]['tier'];
    role?: string;
    relationshipDimensions?: RelationshipDimension[];
  }>
): Story {
  return {
    id: 'story-1',
    title: 'Test',
    genre: 'drama',
    synopsis: '',
    coverImage: '',
    initialState: { attributes: {}, skills: {}, tags: [], inventory: [] },
    npcs: npcs.map((n) => ({
      id: n.id,
      name: n.id,
      description: '',
      ...(n.tier !== undefined ? { tier: n.tier } : {}),
      ...(n.role !== undefined ? { role: n.role } : {}),
      ...(n.relationshipDimensions !== undefined
        ? { relationshipDimensions: n.relationshipDimensions }
        : {}),
    })),
    episodes: [],
  } as unknown as Story;
}

describe('repairNPCDepth', () => {
  it('is a complete no-op when the gate is disabled', () => {
    const story = makeStory([{ id: 'a', tier: 'core', relationshipDimensions: ['trust'] }]);
    const before = JSON.parse(JSON.stringify(story));

    const result = repairNPCDepth(story, disabled);

    expect(result.fixedCount).toBe(0);
    expect(result.records).toEqual([]);
    expect(story).toEqual(before);
    // Story was not touched.
    expect(story.npcs[0].relationshipDimensions).toEqual(['trust']);
  });

  it('backfills missing dimensions when enabled (core needs all 4)', () => {
    const story = makeStory([
      { id: 'core', tier: 'core', relationshipDimensions: ['trust'] },
      { id: 'sup', tier: 'supporting', relationshipDimensions: [] },
      { id: 'bg', tier: 'background' }, // no relationshipDimensions at all
    ]);

    const result = repairNPCDepth(story, enabled);

    expect(result.fixedCount).toBe(3);
    expect(result.records).toHaveLength(3);
    for (const rec of result.records) {
      expect(rec).toEqual({
        rule: 'NPCDepth',
        scope: 'autofix',
        attempted: 1,
        succeeded: true,
        degraded: false,
        blocked: false,
        attempts: 1,
      });
    }

    // Core → all 4 in canonical order, existing 'trust' preserved first.
    expect(story.npcs[0].relationshipDimensions).toEqual([
      'trust',
      'affection',
      'respect',
      'fear',
    ]);
    // Supporting → at least 2, backfilled in canonical order.
    expect(story.npcs[1].relationshipDimensions).toEqual(['trust', 'affection']);
    // Background → at least 1.
    expect(story.npcs[2].relationshipDimensions).toEqual(['trust']);

    // Re-running on the now-valid story produces no further fixes.
    const second = repairNPCDepth(story, enabled);
    expect(second.fixedCount).toBe(0);
  });

  it('infers tier from role when tier is absent', () => {
    const story = makeStory([
      { id: 'villain', role: 'antagonist' }, // inferred core → 4 dims
      { id: 'merchant', role: 'neutral', relationshipDimensions: ['trust'] }, // inferred supporting → 2
      { id: 'extra', role: 'bystander' }, // inferred background → 1
    ]);

    const result = repairNPCDepth(story, enabled);

    expect(result.fixedCount).toBe(3);
    expect(story.npcs[0].relationshipDimensions).toEqual([
      'trust',
      'affection',
      'respect',
      'fear',
    ]);
    expect(story.npcs[1].relationshipDimensions).toEqual(['trust', 'affection']);
    expect(story.npcs[2].relationshipDimensions).toEqual(['trust']);
  });

  it('returns fixedCount 0 for an already-valid story when enabled', () => {
    const story = makeStory([
      {
        id: 'core',
        tier: 'core',
        relationshipDimensions: ['trust', 'affection', 'respect', 'fear'],
      },
      { id: 'sup', tier: 'supporting', relationshipDimensions: ['trust', 'respect'] },
      { id: 'bg', tier: 'background', relationshipDimensions: ['fear'] },
    ]);
    const before = JSON.parse(JSON.stringify(story));

    const result = repairNPCDepth(story, enabled);

    expect(result.fixedCount).toBe(0);
    expect(result.records).toEqual([]);
    expect(story).toEqual(before);
  });

  it('does not modify initialRelationship or fabricate values', () => {
    const story = makeStory([{ id: 'core', tier: 'core', relationshipDimensions: [] }]);
    repairNPCDepth(story, enabled);

    // Only the dimension-name tags were added; no numeric relationship invented.
    expect(story.npcs[0]).not.toHaveProperty('initialRelationship');
    expect(story.npcs[0].relationshipDimensions).toEqual([
      'trust',
      'affection',
      'respect',
      'fear',
    ]);
  });
});
