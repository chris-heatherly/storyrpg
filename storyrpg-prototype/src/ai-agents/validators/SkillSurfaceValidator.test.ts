import { describe, expect, it } from 'vitest';
import { SkillSurfaceValidator } from './SkillSurfaceValidator';

describe('SkillSurfaceValidator', () => {
  it('flags passive insights that leak mechanics', () => {
    const validator = new SkillSurfaceValidator();
    const result = validator.validate({
      scenes: [
        {
          id: 'scene-1',
          name: 'Office',
          beats: [
            {
              id: 'beat-1',
              text: 'The office is dark.',
              skillInsights: [
                {
                  id: 'bad',
                  skillWeights: { investigation: 1 },
                  threshold: 55,
                  text: 'Investigation check success gives +15 bonus.',
                },
              ],
              choices: [],
            },
          ],
        },
      ],
    });

    expect(result.valid).toBe(false);
    expect(result.issues[0].message).toContain('leaks mechanics');
  });

  it('accepts fiction-first passive insight and prepared advantage surfaces', () => {
    const validator = new SkillSurfaceValidator();
    const result = validator.validate({
      scenes: [
        {
          id: 'scene-1',
          name: 'Office',
          beats: [
            {
              id: 'beat-1',
              text: 'The office is dark.',
              skillInsights: [
                {
                  id: 'scrapes',
                  skillWeights: { investigation: 1 },
                  threshold: 55,
                  text: 'The scrape marks beneath the desk point toward the window.',
                },
              ],
              choices: [
                {
                  id: 'choice-1',
                  text: 'Use the old promise',
                  choiceType: 'strategic',
                  statCheck: {
                    skillWeights: { persuasion: 1 },
                    difficulty: 65,
                    modifiers: [
                      {
                        id: 'promise',
                        condition: { type: 'flag', flag: 'kept_promise', value: true },
                        delta: 15,
                        reason: 'Promise creates leverage.',
                        hint: 'The promise she made still gives you a way in.',
                      },
                    ],
                  },
                  failureResidue: { kind: 'damaged_trust', description: 'Trust strains under the attempt.' },
                } as any,
              ],
            },
          ],
        },
      ],
    });

    expect(result.issues.filter((issue) => issue.severity === 'error')).toHaveLength(0);
  });
});
