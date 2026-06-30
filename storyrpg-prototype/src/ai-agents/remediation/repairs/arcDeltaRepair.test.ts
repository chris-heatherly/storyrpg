import { describe, expect, it, vi } from 'vitest';
import type { Story } from '../../../types/story';
import {
  repairArcDelta,
  repairArcDeltaWithLLM,
  LLM_ARC_REPAIR_FLAG,
  type ArcEndpointAuthorFn,
} from './arcDeltaRepair';

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

// -----------------------------------------------------------------------
// repairArcDeltaWithLLM — gated LLM escalation (STORYRPG_LLM_ARC_REPAIR)
// -----------------------------------------------------------------------

describe('repairArcDeltaWithLLM', () => {
  const gateOnly = (flag: string) => flag === 'GATE_ARC_DELTA';
  const gateAndLLM = (flag: string) => flag === 'GATE_ARC_DELTA' || flag === LLM_ARC_REPAIR_FLAG;
  const llmOnly = (flag: string) => flag === LLM_ARC_REPAIR_FLAG;

  it('LLM flag OFF => byte-identical to the deterministic mirror (callback never called)', async () => {
    const author = vi.fn<ArcEndpointAuthorFn>().mockResolvedValue('hardened survivor');
    const llmStory = makeStory([
      { id: 'n1', name: 'Mara', description: '', arc: { startState: 'loyal' } },
    ]);
    const syncStory = makeStory([
      { id: 'n1', name: 'Mara', description: '', arc: { startState: 'loyal' } },
    ]);

    const llmResult = await repairArcDeltaWithLLM(llmStory, gateOnly, author);
    const syncResult = repairArcDelta(syncStory, gateOnly);

    expect(author).not.toHaveBeenCalled();
    expect(llmResult).toEqual(syncResult);
    expect(llmStory).toEqual(syncStory);
    expect(llmStory.npcs[0].arc).toEqual({ startState: 'loyal', endState: 'loyal' });
  });

  it('gate flag OFF => complete no-op even with the LLM flag on + a callback', async () => {
    const author = vi.fn<ArcEndpointAuthorFn>().mockResolvedValue('hardened survivor');
    const story = makeStory([
      { id: 'n1', name: 'Mara', description: '', arc: { startState: 'loyal' } },
    ]);
    const before = JSON.parse(JSON.stringify(story));

    const result = await repairArcDeltaWithLLM(story, llmOnly, author);

    expect(author).not.toHaveBeenCalled();
    expect(result.fixedCount).toBe(0);
    expect(story).toEqual(before);
  });

  it('LLM flag ON + authored endpoint => real delta instead of a mirror', async () => {
    const author = vi.fn<ArcEndpointAuthorFn>().mockResolvedValue('  betrayed and alone  ');
    const story = makeStory([
      // Missing endState — author it forward from the start.
      { id: 'n1', name: 'Mara', description: 'Loyal lieutenant', role: 'ally', arc: { startState: 'loyal', keyBeats: ['discovers the forged orders'] } },
      // Missing startState — author it backward from the end.
      { id: 'n2', name: 'Kel', description: '', arc: { endState: 'free' } },
    ]);

    const result = await repairArcDeltaWithLLM(story, gateAndLLM, author);

    expect(author).toHaveBeenCalledTimes(2);
    expect(author.mock.calls[0][0]).toMatchObject({
      npcId: 'n1',
      npcName: 'Mara',
      missingEndpoint: 'endState',
      populatedEndpoint: 'startState',
      populatedState: 'loyal',
      arcKeyBeats: ['discovers the forged orders'],
      storyTitle: 'Test',
    });
    expect(author.mock.calls[1][0]).toMatchObject({
      npcId: 'n2',
      missingEndpoint: 'startState',
      populatedEndpoint: 'endState',
      populatedState: 'free',
    });

    // Authored value is trimmed and applied to the missing side only.
    expect(story.npcs[0].arc).toMatchObject({ startState: 'loyal', endState: 'betrayed and alone' });
    expect(story.npcs[1].arc).toMatchObject({ startState: 'betrayed and alone', endState: 'free' });
    expect(result.fixedCount).toBe(2);
    expect(result.records).toHaveLength(2);
  });

  it('LLM flag ON + empty/non-string authored output => mirror fallback', async () => {
    const author = vi
      .fn<ArcEndpointAuthorFn>()
      .mockResolvedValueOnce('   ')
      .mockResolvedValueOnce(null);
    const story = makeStory([
      { id: 'n1', name: 'Mara', description: '', arc: { startState: 'loyal' } },
      { id: 'n2', name: 'Kel', description: '', arc: { endState: 'free' } },
    ]);

    const result = await repairArcDeltaWithLLM(story, gateAndLLM, author);

    expect(story.npcs[0].arc).toEqual({ startState: 'loyal', endState: 'loyal' });
    expect(story.npcs[1].arc).toEqual({ startState: 'free', endState: 'free' });
    expect(result.fixedCount).toBe(2);
  });

  it('LLM flag ON + callback rejection => mirror fallback (never throws)', async () => {
    const author = vi.fn<ArcEndpointAuthorFn>().mockRejectedValue(new Error('provider down'));
    const story = makeStory([
      { id: 'n1', name: 'Mara', description: '', arc: { startState: 'loyal' } },
    ]);

    const result = await repairArcDeltaWithLLM(story, gateAndLLM, author);

    expect(story.npcs[0].arc).toEqual({ startState: 'loyal', endState: 'loyal' });
    expect(result.fixedCount).toBe(1);
  });

  it('LLM flag ON + already-valid arcs => callback not invoked', async () => {
    const author = vi.fn<ArcEndpointAuthorFn>().mockResolvedValue('anything');
    const story = makeStory([
      { id: 'n1', name: 'Mara', description: '', arc: { startState: 'loyal', endState: 'betrayed' } },
      { id: 'n2', name: 'Kel', description: '' },
    ]);
    const before = JSON.parse(JSON.stringify(story));

    const result = await repairArcDeltaWithLLM(story, gateAndLLM, author);

    expect(author).not.toHaveBeenCalled();
    expect(result.fixedCount).toBe(0);
    expect(story).toEqual(before);
  });
});
