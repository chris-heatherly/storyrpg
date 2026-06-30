import { describe, expect, it } from 'vitest';
import type { Story } from '../../../types/story';
import { STAT_CHECK_BALANCE_FLAG, repairStatCheckBalance } from './statCheckBalanceRepair';

/**
 * Build a minimal assembled-story fixture with a single choice carrying a
 * stat check at the given difficulty. Only the fields the repair traverses are
 * populated; everything else is cast through the canonical Story type.
 */
function buildStory(difficulties: Array<number | undefined>): Story {
  return {
    id: 'story-1',
    title: 'Fixture',
    genre: 'drama',
    synopsis: '',
    coverImage: '',
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
        title: 'Episode',
        synopsis: '',
        coverImage: '' as never,
        startingSceneId: 'scene-1',
        scenes: [
          {
            id: 'scene-1',
            name: 'Scene',
            startingBeatId: 'beat-1',
            beats: [
              {
                id: 'beat-1',
                text: 'A beat.',
                choices: difficulties.map((difficulty, index) => ({
                  id: `choice-${index}`,
                  text: `Choice ${index}`,
                  ...(difficulty === undefined
                    ? {}
                    : { statCheck: { difficulty } }),
                })),
              },
            ],
          },
        ],
      },
    ],
  } as Story;
}

/** Collect every stat-check difficulty present on the story, in traversal order. */
function difficultiesOf(story: Story): number[] {
  const out: number[] = [];
  for (const episode of story.episodes) {
    for (const scene of episode.scenes) {
      for (const beat of scene.beats) {
        for (const choice of beat.choices ?? []) {
          if (choice.statCheck) {
            out.push(choice.statCheck.difficulty);
          }
        }
      }
    }
  }
  return out;
}

const enabled = () => true;
const disabled = () => false;

describe('repairStatCheckBalance', () => {
  it('is a complete no-op when the gate is disabled', () => {
    const story = buildStory([10, 99]);
    const before = JSON.stringify(story);

    const result = repairStatCheckBalance(story, disabled);

    expect(result.fixedCount).toBe(0);
    expect(result.records).toEqual([]);
    expect(JSON.stringify(story)).toBe(before);
  });

  it('clamps out-of-band difficulties into [35, 80] when enabled', () => {
    const story = buildStory([10, 99]);

    const result = repairStatCheckBalance(story, enabled);

    expect(result.fixedCount).toBe(2);
    expect(difficultiesOf(story)).toEqual([35, 80]);
    expect(result.records).toHaveLength(2);
    for (const record of result.records) {
      expect(record).toEqual({
        rule: 'StatCheckBalance',
        scope: 'autofix',
        attempted: 1,
        succeeded: true,
        degraded: false,
        blocked: false,
        attempts: 1,
      });
    }
  });

  it('leaves an already-valid story untouched (fixedCount 0)', () => {
    const story = buildStory([35, 55, 80]);
    const before = JSON.stringify(story);

    const result = repairStatCheckBalance(story, enabled);

    expect(result.fixedCount).toBe(0);
    expect(result.records).toEqual([]);
    expect(JSON.stringify(story)).toBe(before);
    expect(difficultiesOf(story)).toEqual([35, 55, 80]);
  });

  it('uses the standard gate flag name', () => {
    expect(STAT_CHECK_BALANCE_FLAG).toBe('GATE_STAT_CHECK_BALANCE');
  });

  it('ignores choices without a stat check', () => {
    const story = buildStory([undefined, 5]);

    const result = repairStatCheckBalance(story, enabled);

    expect(result.fixedCount).toBe(1);
    expect(difficultiesOf(story)).toEqual([35]);
  });
});
