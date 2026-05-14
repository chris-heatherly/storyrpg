import { describe, it, expect } from 'vitest';
import { ChoiceDensityValidator } from './ChoiceDensityValidator';

function makeBeat(id: string, wordCount: number, isChoicePoint = false) {
  return {
    id,
    text: Array.from({ length: wordCount }, (_, i) => `w${i}`).join(' '),
    isChoicePoint,
  };
}

describe('ChoiceDensityValidator', () => {
  it('flags an episode with zero choice points as an error', async () => {
    const validator = new ChoiceDensityValidator();
    const result = await validator.validate({
      beats: [],
      scenes: [{ id: 's1', beats: [makeBeat('b1', 200), makeBeat('b2', 200)] }],
    });

    expect(result.metrics.choiceCount).toBe(0);
    expect(result.issues.some((i) => i.level === 'error')).toBe(true);
    expect(result.passed).toBe(false);
  });

  it('computes cumulative timing across scenes at 200 WPM', async () => {
    const validator = new ChoiceDensityValidator();
    const scenes = validator.annotateScenesWithTiming([
      { id: 's1', beats: [makeBeat('b1', 200)] },
      { id: 's2', beats: [makeBeat('b2', 100, true)] },
    ]);

    expect(scenes[0].beats[0].timing.estimatedReadingTimeSeconds).toBeCloseTo(60, 1);
    expect(scenes[1].beats[0].timing.cumulativeSeconds).toBeCloseTo(90, 1);
  });

  it('flags slow first choice when the opening narration is too long', async () => {
    const validator = new ChoiceDensityValidator({ firstChoiceMaxSeconds: 60 });
    const result = await validator.validate({
      beats: [],
      scenes: [
        {
          id: 's1',
          beats: [makeBeat('long-intro', 400), makeBeat('choice', 10, true)],
        },
      ],
    });

    expect(result.metrics.firstChoiceSeconds).toBeGreaterThan(60);
    const firstChoiceIssue = result.issues.find((i) =>
      i.message.includes('First choice appears')
    );
    expect(firstChoiceIssue).toBeDefined();
  });

  it('passes when choices are frequent and opening is fast', async () => {
    const validator = new ChoiceDensityValidator({
      firstChoiceMaxSeconds: 60,
      averageGapMaxSeconds: 90,
    });
    const result = await validator.validate({
      beats: [],
      scenes: [
        {
          id: 's1',
          beats: [
            makeBeat('b1', 50),
            makeBeat('c1', 10, true),
            makeBeat('b2', 50),
            makeBeat('c2', 10, true),
          ],
        },
      ],
    });

    expect(result.metrics.choiceCount).toBe(2);
    expect(result.issues.filter((i) => i.level === 'error')).toHaveLength(0);
  });
});
