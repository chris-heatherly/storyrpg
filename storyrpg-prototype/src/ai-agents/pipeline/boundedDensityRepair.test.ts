import { describe, expect, it } from 'vitest';
import { runBoundedDensityRepair } from './boundedDensityRepair';

describe('runBoundedDensityRepair', () => {
  it('moves one soft pressure lane along the existing route and preserves hard contracts', () => {
    const scenes = [{
      id: 's1-1',
      leadsTo: ['s1-2'],
      authoredTreatmentFields: [
        { id: 'hard-turn', contractKind: 'turn', requiredRealization: ['final_prose'] },
        { id: 'soft-pressure', contractKind: 'pressure_lane', requiredRealization: ['final_prose'] },
      ],
    }, {
      id: 's1-2',
      leadsTo: [],
      authoredTreatmentFields: [],
    }];
    const analyze = (items: typeof scenes) => items.map((scene) => ({
      sceneId: scene.id,
      overloaded: scene.authoredTreatmentFields.length > 1,
    }));

    const result = runBoundedDensityRepair(scenes, analyze, (reports) => reports.filter((report) => report.overloaded));

    expect(result.attempted).toBe(true);
    expect(result.movedContractIds).toEqual(['soft-pressure']);
    expect(scenes[0].authoredTreatmentFields.map((field) => field.id)).toEqual(['hard-turn']);
    expect(scenes[1].authoredTreatmentFields.map((field) => field.id)).toEqual(['soft-pressure']);
    expect(result.after.every((report) => !report.overloaded)).toBe(true);
  });

  it('does not invent a route or move hard authored turns', () => {
    const scenes = [{
      id: 's1-1',
      leadsTo: ['branch-not-present'],
      authoredTreatmentFields: [
        { id: 'hard-turn', contractKind: 'turn', requiredRealization: ['final_prose'] },
        { id: 'hard-signature', contractKind: 'signature', requiredRealization: ['final_prose'] },
      ],
    }, {
      id: 's1-2',
      authoredTreatmentFields: [],
    }];
    const analyze = (items: typeof scenes) => items.map((scene) => ({
      sceneId: scene.id,
      overloaded: scene.id === 's1-1',
    }));
    const result = runBoundedDensityRepair(scenes, analyze, (reports) => reports.filter((report) => report.overloaded));
    expect(result.changed).toBe(false);
    expect(scenes[0].authoredTreatmentFields).toHaveLength(2);
  });
});
