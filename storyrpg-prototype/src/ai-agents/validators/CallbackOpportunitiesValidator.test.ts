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

describe('CallbackOpportunitiesValidator referential-flag filter (Fix 3i)', () => {
  it('excludes one-shot tint/expr/moment flags from callback-debt accounting', async () => {
    const validator = new CallbackOpportunitiesValidator();
    const result = await validator.validate({
      scenes: [makeScene('s1', [{ id: 'b1', text: 'plain' }])],
      choices: [
        {
          id: 'c1',
          sceneId: 's1',
          text: 'react',
          consequences: [
            { type: 'setFlag', flag: 'tint:distant' },
            { type: 'setFlag', flag: 'expr:wry' },
            { type: 'setFlag', flag: 'moment:held' },
            { type: 'setFlag', flag: 'route_spared_the_guard' },
          ] as any,
        },
      ],
    });

    // Only the referential route_* flag counts toward "should be referenced".
    expect(result.metrics.flagsSet).toBe(1);
  });
});

describe('CallbackOpportunitiesValidator flag-reference detection (Issue 1a)', () => {
  it('counts a flag referenced by an exact condition and avoids substring false positives', async () => {
    const validator = new CallbackOpportunitiesValidator();
    const result = await validator.validate({
      scenes: [makeScene('s1', [{
        id: 'b1', text: 'default',
        textVariants: [{ condition: { type: 'flag', flag: 'met_andrei_before_attack', value: true }, text: 'he remembers you' }],
      }])],
      choices: [{
        id: 'c1', sceneId: 's1', text: 'x',
        consequences: [
          { type: 'setFlag', flag: 'met_andrei_before_attack' },
          { type: 'setFlag', flag: 'andrei' }, // substring of the above — must NOT be falsely counted
        ] as any,
      }],
    });
    expect(result.metrics.flagsSet).toBe(2);
    expect(result.metrics.flagsReferenced).toBe(1); // only the exact match, not 'andrei'
  });

  it('walks compound and/or/not conditions to find referenced flags', async () => {
    const validator = new CallbackOpportunitiesValidator();
    const result = await validator.validate({
      scenes: [makeScene('s1', [{
        id: 'b1', text: 'default',
        textVariants: [{
          condition: { type: 'and', conditions: [
            { type: 'not', condition: { type: 'flag', flag: 'signed_republic_as_is', value: true } },
            { type: 'or', conditions: [{ type: 'flag', flag: 'helped_carmen', value: true }] },
          ] },
          text: 'variant',
        }],
      }])],
      choices: [{
        id: 'c1', sceneId: 's1', text: 'x',
        consequences: [
          { type: 'setFlag', flag: 'signed_republic_as_is' },
          { type: 'setFlag', flag: 'helped_carmen' },
        ] as any,
      }],
    });
    expect(result.metrics.flagsReferenced).toBe(2);
  });
});
