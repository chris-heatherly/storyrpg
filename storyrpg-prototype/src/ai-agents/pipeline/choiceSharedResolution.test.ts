import { describe, expect, it } from 'vitest';
import { materializeSharedChoiceResolution } from './choiceSharedResolution';

describe('materializeSharedChoiceResolution', () => {
  it('projects authored shared prose into every option and outcome tier exactly once', () => {
    const set = {
      sharedResolutionText: 'The three name their new alliance the Lantern Circle.',
      choices: [0, 1].map((index) => ({
        outcomeTexts: {
          success: `Success ${index}.`,
          partial: `Partial ${index}.`,
          failure: `Failure ${index}.`,
        },
      })),
    };

    expect(materializeSharedChoiceResolution(set)).toBe(6);
    expect(Object.values(set.choices[0].outcomeTexts).every((text) => text.includes('Lantern Circle'))).toBe(true);
    expect(materializeSharedChoiceResolution(set)).toBe(0);
  });
});
