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

describe('BranchMechanicalDivergenceValidator routing-fork detection (D3)', () => {
  it('counts choices in a leadsTo-routing-fork scene even without per-choice nextSceneId', () => {
    const validator = new BranchMechanicalDivergenceValidator();
    const result = validator.validate({
      scenes: [
        {
          id: 'scene-2',
          name: 'Hold or break formation',
          leadsTo: ['scene-3a', 'scene-3b'], // routing fork
          beats: [
            {
              id: 'beat-1',
              text: 'Decide.',
              choices: [
                // no nextSceneId / branching intent — routes via a flag
                { id: 'c1', text: 'Hold', consequences: [] },
                { id: 'c2', text: 'Break', consequences: [] },
              ],
            },
          ],
        } as any,
      ],
    });
    expect(result.metrics.branchChoices).toBe(2); // was 0 before D3
    expect(result.metrics.branchesWithoutResidue).toBe(2); // no residue → warnings
  });

  it('does not treat a single-target scene as a fork', () => {
    const validator = new BranchMechanicalDivergenceValidator();
    const result = validator.validate({
      scenes: [
        { id: 's', name: 'Linear', leadsTo: ['scene-2'], beats: [{ id: 'b', text: 't', choices: [{ id: 'c', text: 'go', consequences: [] }] }] } as any,
      ],
    });
    expect(result.metrics.branchChoices).toBe(0);
  });
});
