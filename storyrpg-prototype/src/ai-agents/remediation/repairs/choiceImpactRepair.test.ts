import { describe, expect, it } from 'vitest';
import { repairChoiceImpact } from './choiceImpactRepair';
import type { Story } from '../../../types/story';
import type { Choice } from '../../../types/choice';

const GATE_FLAG = 'GATE_CHOICE_IMPACT';

const allOff = () => false;
const enable =
  (...flags: string[]) =>
  (flag: string) =>
    flags.includes(flag);

/** Wrap a single choice into a minimal-but-real Story shape. */
function storyWithChoice(choice: Choice): Story {
  return {
    id: 'story-1',
    title: 'Test Story',
    genre: 'drama',
    synopsis: 'A test.',
    coverImage: 'cover.png',
    initialState: {
      attributes: {} as Story['initialState']['attributes'],
      skills: {} as Story['initialState']['skills'],
      tags: [],
      inventory: [],
    },
    npcs: [],
    episodes: [
      {
        id: 'ep-1',
        number: 1,
        title: 'Episode 1',
        synopsis: 'Ep synopsis.',
        coverImage: 'ep-cover.png',
        startingSceneId: 'scene-1',
        scenes: [
          {
            id: 'scene-1',
            name: 'Scene 1',
            startingBeatId: 'beat-1',
            beats: [
              {
                id: 'beat-1',
                text: 'A beat.',
                choices: [choice],
              },
            ],
          },
        ],
      },
    ],
  };
}

describe('repairChoiceImpact', () => {
  it('is a complete no-op when the gate flag is disabled', () => {
    const choice: Choice = {
      id: 'c1',
      text: 'Spare the herald',
      consequences: [
        { type: 'relationship', npcId: 'npc-1', dimension: 'trust', change: 10 },
      ],
      // missing impactFactors + consequenceTier
    };
    const story = storyWithChoice(choice);

    const result = repairChoiceImpact(story, allOff);

    expect(result.fixedCount).toBe(0);
    expect(result.records).toEqual([]);
    const repaired = story.episodes[0].scenes[0].beats[0].choices![0];
    expect(repaired.impactFactors).toBeUndefined();
    expect(repaired.consequenceTier).toBeUndefined();
  });

  it('backfills derivable impactFactors and consequenceTier when enabled', () => {
    const choice: Choice = {
      id: 'c1',
      text: 'Confront the captain',
      nextSceneId: 'scene-2',
      statCheck: { difficulty: 12 },
      consequences: [
        { type: 'relationship', npcId: 'npc-1', dimension: 'trust', change: -10 },
        { type: 'attribute', attribute: 'courage', change: 1 },
      ],
      // missing impactFactors + consequenceTier
    };
    const story = storyWithChoice(choice);

    const result = repairChoiceImpact(story, enable(GATE_FLAG));

    expect(result.fixedCount).toBe(2); // impactFactors + consequenceTier
    expect(result.records).toHaveLength(2);
    expect(result.records[0]).toEqual({
      rule: 'ChoiceImpact',
      scope: 'autofix',
      attempted: 1,
      succeeded: true,
      degraded: false,
      blocked: false,
      attempts: 1,
    });

    const repaired = story.episodes[0].scenes[0].beats[0].choices![0];
    // relationship (rel consequence), identity (attribute), outcome (nextSceneId),
    // process (statCheck). No 'information' (no storyVerb/memorableMoment).
    expect(repaired.impactFactors).toEqual([
      'relationship',
      'identity',
      'outcome',
      'process',
    ]);
    // nextSceneId present → structuralBranch.
    expect(repaired.consequenceTier).toBe('structuralBranch');
  });

  it('derives a callback tier and no impactFactors for an inert choice', () => {
    const choice: Choice = {
      id: 'c1',
      text: 'Nod silently',
      // no consequences, no nextSceneId, no statCheck → nothing derivable
    };
    const story = storyWithChoice(choice);

    const result = repairChoiceImpact(story, enable(GATE_FLAG));

    // impactFactors stays unset (nothing derivable, do not fabricate);
    // consequenceTier is backfilled to 'callback'.
    expect(result.fixedCount).toBe(1);
    const repaired = story.episodes[0].scenes[0].beats[0].choices![0];
    expect(repaired.impactFactors).toBeUndefined();
    expect(repaired.consequenceTier).toBe('callback');
  });

  it('is a no-op (fixedCount 0) when fields are already present', () => {
    const choice: Choice = {
      id: 'c1',
      text: 'Already complete',
      impactFactors: ['outcome'],
      consequenceTier: 'branchlet',
      consequences: [
        { type: 'relationship', npcId: 'npc-1', dimension: 'trust', change: 5 },
      ],
    };
    const story = storyWithChoice(choice);

    const result = repairChoiceImpact(story, enable(GATE_FLAG));

    expect(result.fixedCount).toBe(0);
    expect(result.records).toEqual([]);
    const repaired = story.episodes[0].scenes[0].beats[0].choices![0];
    expect(repaired.impactFactors).toEqual(['outcome']);
    expect(repaired.consequenceTier).toBe('branchlet');
  });
});
