import { describe, expect, it } from 'vitest';
import { normalizeChoiceSetStatChecks, normalizeChoiceStatCheck, normalizeStoryStatChecks } from './statCheckNormalization';

describe('statCheckNormalization', () => {
  it('clamps difficulty and normalizes positive skill weights', () => {
    const normalized = normalizeChoiceStatCheck({
      difficulty: 30,
      skillWeights: { persuasion: 2, perception: 1, stealth: 0 },
    } as never);

    expect(normalized?.difficulty).toBe(35);
    expect(normalized?.skillWeights).toEqual({ persuasion: 0.6667, perception: 0.3333 });
  });

  it('normalizes choice sets in place for validation and assembly callers', () => {
    const choiceSets = [
      {
        choices: [
          { id: 'c1', statCheck: { difficulty: 90, skillWeights: { persuasion: 3, perception: 1 } } },
          { id: 'c2' },
        ],
      },
    ];

    expect(normalizeChoiceSetStatChecks(choiceSets)).toBe(choiceSets);
    expect(choiceSets[0].choices[0].statCheck).toEqual({
      difficulty: 80,
      skillWeights: { persuasion: 0.75, perception: 0.25 },
    });
    expect(choiceSets[0].choices[1].statCheck).toBeUndefined();
  });

  it('repairs all-invalid skill weights by preserving the authored skill axis', () => {
    const normalized = normalizeChoiceStatCheck({
      difficulty: 35,
      skillWeights: { deception: -1 },
    } as never);

    expect(normalized?.skillWeights).toEqual({ deception: 1 });
  });

  it('normalizes final story stat checks in place', () => {
    const story = {
      episodes: [{
        scenes: [{
          beats: [{
            choices: [{
              id: 'c1',
              statCheck: { difficulty: 20, skillWeights: { deception: -1 } },
            }],
          }],
        }],
      }],
    } as never;

    expect(normalizeStoryStatChecks(story)).toBe(1);
    expect(story.episodes[0].scenes[0].beats[0].choices[0].statCheck).toEqual({
      difficulty: 35,
      skillWeights: { deception: 1 },
    });
  });
});
