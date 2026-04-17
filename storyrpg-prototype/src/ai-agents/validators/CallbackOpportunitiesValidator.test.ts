import { describe, it, expect } from 'vitest';
import { CallbackOpportunitiesValidator } from './CallbackOpportunitiesValidator';

const makeScene = (id: string, beats: any[]) => ({ id, beats });

describe('CallbackOpportunitiesValidator', () => {
  it('flags a story where no text variants reference any set flags', async () => {
    const validator = new CallbackOpportunitiesValidator();
    const result = await validator.validate({
      scenes: [makeScene('s1', [{ id: 'b1', text: 'plain' }])],
      choices: [
        {
          id: 'c1',
          sceneId: 's1',
          text: 'help',
          consequences: [{ type: 'setFlag', flag: 'helped_stranger' }] as any,
        },
      ],
    });

    const codes = result.issues.map((i) => i.message);
    expect(codes.some((m) => m.includes('No text variants'))).toBe(true);
    expect(codes.some((m) => m.includes('flags set but never referenced'))).toBe(true);
    expect(result.metrics.flagsSet).toBe(1);
    expect(result.metrics.flagsReferenced).toBe(0);
  });

  it('rewards stories that reference prior-choice flags in text variants', async () => {
    const validator = new CallbackOpportunitiesValidator();
    const result = await validator.validate({
      scenes: [
        makeScene('s2', [
          {
            id: 'b1',
            text: 'default',
            textVariants: [
              {
                condition: { type: 'flag', flag: 'helped_stranger' },
                text: 'the stranger nods to you',
              },
            ],
          },
        ]),
      ],
      choices: [
        {
          id: 'c1',
          sceneId: 's1',
          text: 'help',
          consequences: [{ type: 'setFlag', flag: 'helped_stranger' }] as any,
          reminderPlan: {
            immediate: 'A subtle echo',
            shortTerm: 'Scene later',
          } as any,
        },
      ],
    });

    expect(result.metrics.flagsReferenced).toBe(1);
    expect(result.metrics.textVariantsCount).toBe(1);
    expect(result.metrics.choicesWithReminderPlans).toBe(1);
    expect(result.callbackScore).toBeGreaterThan(60);
  });

  it('warns when most choices lack consequences', async () => {
    const validator = new CallbackOpportunitiesValidator();
    const result = await validator.validate({
      scenes: [
        makeScene('s1', [
          {
            id: 'b1',
            text: 'hi',
            textVariants: [{ condition: {}, text: 'alt' }],
          },
        ]),
      ],
      choices: [
        { id: 'c1', sceneId: 's1', text: 'a' },
        { id: 'c2', sceneId: 's1', text: 'b' },
        { id: 'c3', sceneId: 's1', text: 'c' },
      ],
    });

    expect(
      result.issues.some((i) =>
        i.message.includes('choices set flags or modify state')
      )
    ).toBe(true);
  });
});
