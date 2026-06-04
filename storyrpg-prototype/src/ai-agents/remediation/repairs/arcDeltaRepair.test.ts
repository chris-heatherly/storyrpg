import { describe, expect, it } from 'vitest';
import type { Story } from '../../../types/story';
import { repairArcDelta } from './arcDeltaRepair';

/**
 * Build a minimal but shape-accurate Story carrying only the NPC arc data the
 * repair inspects. Other Story fields are filled with empty/neutral values.
 */
function makeStory(npcs: Story['npcs']): Story {
  return {
    id: 'story-1',
    title: 'Test',
    genre: 'drama',
    synopsis: '',
    coverImage: '',
    initialState: {
      attributes: {} as Story['initialState']['attributes'],
      skills: {} as Story['initialState']['skills'],
      tags: [],
      inventory: [],
    },
    npcs,
    episodes: [],
  };
}

const enabled = () => true;
const disabled = () => false;

describe('repairArcDelta', () => {
  it('flag-off => complete no-op (story unchanged, fixedCount 0)', () => {
    const story = makeStory([
      { id: 'n1', name: 'Mara', description: '', arc: { startState: 'loyal' } },
    ]);
    const before = JSON.parse(JSON.stringify(story));

    const result = repairArcDelta(story, disabled);

    expect(result.fixedCount).toBe(0);
    expect(result.records).toEqual([]);
    expect(story).toEqual(before);
    // The dangling endpoint must remain untouched while the gate is off.
    expect(story.npcs[0].arc?.endState).toBeUndefined();
  });

  it('flag-on + violating fixture => backfills the missing endpoint by mirroring', () => {
    const story = makeStory([
      // Missing endState.
      { id: 'n1', name: 'Mara', description: '', arc: { startState: 'loyal' } },
      // Missing startState (blank counts as missing).
      { id: 'n2', name: 'Kel', description: '', arc: { startState: '   ', endState: 'free' } },
    ]);

    const result = repairArcDelta(story, enabled);

    expect(result.fixedCount).toBe(2);
    expect(result.records).toHaveLength(2);
    expect(result.records[0]).toEqual({
      rule: 'ArcEndpointPresence',
      scope: 'autofix',
      attempted: 1,
      succeeded: true,
      degraded: false,
      blocked: false,
      attempts: 1,
    });

    // No fabricated movement: each arc now has both endpoints, mirrored.
    expect(story.npcs[0].arc).toEqual({ startState: 'loyal', endState: 'loyal' });
    expect(story.npcs[1].arc).toEqual({ startState: 'free', endState: 'free' });

    // Rule now satisfied: every declared arc has both endpoints present.
    for (const npc of story.npcs) {
      const arc = npc.arc;
      if (!arc) continue;
      const hasStart = !!arc.startState && arc.startState.trim().length > 0;
      const hasEnd = !!arc.endState && arc.endState.trim().length > 0;
      expect(hasStart && hasEnd).toBe(true);
    }
  });

  it('flag-on + already-valid fixture => fixedCount 0', () => {
    const story = makeStory([
      // Both endpoints present.
      { id: 'n1', name: 'Mara', description: '', arc: { startState: 'loyal', endState: 'betrayed' } },
      // No arc declared at all — not this repair's concern.
      { id: 'n2', name: 'Kel', description: '' },
      // Empty arc (neither endpoint) — not a "declared" arc, left untouched.
      { id: 'n3', name: 'Ivo', description: '', arc: {} },
    ]);
    const before = JSON.parse(JSON.stringify(story));

    const result = repairArcDelta(story, enabled);

    expect(result.fixedCount).toBe(0);
    expect(result.records).toEqual([]);
    expect(story).toEqual(before);
  });
});
