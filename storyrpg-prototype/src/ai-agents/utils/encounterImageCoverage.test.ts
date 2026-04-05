import { describe, expect, it } from 'vitest';

import {
  collectMissingEncounterImageKeys,
  getEncounterBeats,
} from './encounterImageCoverage';

describe('encounterImageCoverage', () => {
  it('reads beats from runtime encounter phases', () => {
    const beats = getEncounterBeats({
      phases: [
        { beats: [{ id: 'beat-1' }, { id: 'beat-2' }] },
        { beats: [{ id: 'beat-3' }] },
      ],
    });

    expect(beats.map((beat) => beat.id)).toEqual(['beat-1', 'beat-2', 'beat-3']);
  });

  it('finds missing encounter images across nested situations and storylets', () => {
    const missing = collectMissingEncounterImageKeys('scene-4', {
      phases: [
        {
          beats: [
            {
              id: 'beat-1',
              choices: [
                {
                  id: 'choice-1',
                  outcomes: {
                    success: {
                      nextSituation: {
                        choices: [
                          {
                            id: 'choice-1a',
                            outcomes: {
                              failure: {},
                            },
                          },
                        ],
                      },
                    },
                    complicated: {
                      outcomeImage: 'complicated.png',
                    },
                  },
                },
              ],
            },
          ],
        },
      ],
      storylets: {
        defeat: {
          beats: [{ id: 'storylet-beat-1' }],
        },
      },
    });

    expect(missing).toEqual([
      'setup:scene-4::beat-1',
      'outcome:scene-4::beat-1::choice-1::success',
      'situation:scene-4::beat-1::choice-1::success::situation',
      'outcome:scene-4::beat-1::choice-1::success::choice-1a::failure',
      'storylet:scene-4::defeat::storylet-beat-1',
    ]);
  });
});
