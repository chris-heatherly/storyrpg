import { describe, expect, it } from 'vitest';
import type { Story } from '../../types/story';
import {
  buildPlayerFacingProseRepairHandler,
  repairPlayerReferenceProse,
} from './playerFacingProseRepairHandler';

describe('repairPlayerReferenceProse', () => {
  it('rewrites player-facing meta references into in-fiction prose', () => {
    const result = repairPlayerReferenceProse(
      "You search for any sign of the player opposite you, but the other player's identity stays hidden.",
    );

    expect(result.changed).toBe(true);
    expect(result.value).toBe(
      "You search for any sign of the person opposite you, but the other person's identity stays hidden.",
    );
  });
});

describe('buildPlayerFacingProseRepairHandler', () => {
  it('repairs choice reaction and outcome text when final contract flags a player reference', () => {
    const story = {
      episodes: [{
        scenes: [{
          id: 's1',
          beats: [{
            id: 'b1',
            text: 'The card waits under the door.',
            choices: [{
              id: 'c1',
              text: 'Read it.',
              reactionText: 'You search for any sign of the player opposite you.',
              outcomeTexts: {
                partial: "The other player's identity remains hidden.",
              },
            }],
          }],
        }],
      }],
    } as unknown as Story;
    const handler = buildPlayerFacingProseRepairHandler();

    const result = handler({
      story,
      blockingIssues: [{
        type: 'qa_blocker_present',
        validator: 'IntegratedBestPracticesValidator',
        message: 'Player-facing text "c1:reaction" leaks meta-narration (addresses "the player").',
      }],
    });

    expect(result.changed).toBe(true);
    const choice = (story as any).episodes[0].scenes[0].beats[0].choices[0];
    expect(choice.reactionText).toBe('You search for any sign of the person opposite you.');
    expect(choice.outcomeTexts.partial).toBe("The other person's identity remains hidden.");
  });

  it('does nothing without a matching final-contract blocker', () => {
    const story = { episodes: [{ scenes: [{ beats: [{ text: 'The player is listed in metadata only.' }] }] }] } as unknown as Story;
    const result = buildPlayerFacingProseRepairHandler()({ story, blockingIssues: [] });

    expect(result.changed).toBe(false);
  });
});
