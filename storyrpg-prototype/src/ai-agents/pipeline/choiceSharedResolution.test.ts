import { describe, expect, it } from 'vitest';
import {
  materializeSharedChoiceResolution,
  withReplacedSharedChoiceResolution,
} from './choiceSharedResolution';

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

  it('replaces only the shared projection and preserves tier-specific prose', () => {
    const set = {
      sharedResolutionText: 'They call the group the Lantern Circle.',
      choices: [{
        outcomeTexts: {
          success: 'The answer earns a smile. They call the group the Lantern Circle.',
          partial: 'The answer leaves a bruise. They call the group the Lantern Circle.',
          failure: 'The answer lands badly. They call the group the Lantern Circle.',
        },
      }],
    };

    const repaired = withReplacedSharedChoiceResolution(
      set,
      'The test ends; all three choose friendship and name it the Lantern Circle.',
    );

    expect(repaired).not.toBe(set);
    expect(set.choices[0].outcomeTexts.success).toContain('They call the group');
    expect(repaired.choices[0].outcomeTexts.success).toBe(
      'The answer earns a smile. The test ends; all three choose friendship and name it the Lantern Circle.',
    );
    expect(repaired.choices[0].outcomeTexts.partial).toContain('The answer leaves a bruise.');
    expect(repaired.choices[0].outcomeTexts.failure).toContain('The answer lands badly.');
    expect(JSON.stringify(repaired)).not.toContain('They call the group the Lantern Circle.');
  });
});
