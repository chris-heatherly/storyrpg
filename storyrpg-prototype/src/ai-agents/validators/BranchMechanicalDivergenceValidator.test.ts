import { describe, expect, it } from 'vitest';
import { BranchMechanicalDivergenceValidator } from './BranchMechanicalDivergenceValidator';

describe('BranchMechanicalDivergenceValidator', () => {
  it('flags branch choices with no mechanical residue', () => {
    const validator = new BranchMechanicalDivergenceValidator();
    const result = validator.validate({
      scenes: [
        {
          id: 'scene-1',
          name: 'Fork',
          startingBeatId: 'beat-1',
          beats: [
            {
              id: 'beat-1',
              text: 'Choose.',
              choices: [
                { id: 'c1', text: 'Go left', choiceIntent: 'branching' },
                { id: 'c2', text: 'Go right', choiceIntent: 'branching' },
              ],
            },
          ],
        } as any,
      ],
    });

    expect(result.metrics.branchesWithoutResidue).toBe(2);
    expect(result.issues.length).toBeGreaterThan(0);
  });

  it('accepts branches that leave distinct residue', () => {
    const validator = new BranchMechanicalDivergenceValidator();
    const result = validator.validate({
      scenes: [
        {
          id: 'scene-1',
          name: 'Fork',
          startingBeatId: 'beat-1',
          beats: [
            {
              id: 'beat-1',
              text: 'Choose.',
              choices: [
                { id: 'c1', text: 'Go left', nextSceneId: 'left', consequences: [{ type: 'setFlag', flag: 'went_left', value: true }] },
                { id: 'c2', text: 'Go right', nextSceneId: 'right', consequences: [{ type: 'setFlag', flag: 'went_right', value: true }] },
              ],
            },
          ],
        } as any,
      ],
    });

    expect(result.metrics.branchesWithoutResidue).toBe(0);
  });
});
