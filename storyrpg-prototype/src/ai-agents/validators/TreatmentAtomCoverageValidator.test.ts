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

  it('counts multi-beat and encounter surfaces as treatment evidence', () => {
    const atoms = atomizeTreatmentText({
      episodeNumber: 1,
      text: 'Avery enters the bookshop owned by Mira and meets her. Avery is attacked in North Station and rescued by a stranger.',
    });
    const story = {
      episodes: [{
        id: 'ep1',
        number: 1,
        scenes: [
          {
            id: 's1',
            beats: [
              { id: 'b1', text: 'Avery enters the bookshop through a door opening onto a maze of shelves.' },
              { id: 'b2', text: 'Mira, who owns the bookshop, steps from behind the counter and Avery meets her.' },
            ],
          },
          {
            id: 'encounter',
            beats: [],
            encounter: {
              phases: [{ beats: [{ id: 'enc-b1', setupText: 'At North Station, two attackers close in before a stranger rescues you.' }] }],
            },
          },
        ],
      }],
    } as any;

    const report = new TreatmentAtomCoverageValidator().validate({ story, atoms });

    expect(report.passed).toBe(true);
    expect(report.ownership.every((item) => item.evidenceBeatIds.length > 0)).toBe(true);
  });
});
