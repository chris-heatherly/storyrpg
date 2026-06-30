import { describe, expect, it } from 'vitest';
import { atomizeTreatmentText } from '../utils/treatmentEventAtomizer';
import { TreatmentAtomCoverageValidator } from './TreatmentAtomCoverageValidator';

describe('TreatmentAtomCoverageValidator', () => {
  it('blocks missing and duplicated playable treatment atoms', () => {
    const atoms = atomizeTreatmentText({
      episodeNumber: 1,
      text: 'Avery arrives at North Station. Avery meets Mira inside the archive.',
    });
    const story = {
      episodes: [{
        id: 'ep1',
        number: 1,
        scenes: [
          { id: 's1', beats: [{ id: 'b1', text: 'Avery arrives at North Station with one small bag.' }] },
          { id: 's2', beats: [{ id: 'b2', text: 'Avery arrives at North Station again in a repeated beat.' }] },
        ],
      }],
    } as any;

    const report = new TreatmentAtomCoverageValidator().validate({ story, atoms });

    expect(report.passed).toBe(false);
    expect(report.blockingIssues.map((issue) => issue.type).sort()).toEqual([
      'duplicate_atom_realization',
      'missing_required_atom',
    ]);
  });
});
