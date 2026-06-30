import { describe, it, expect } from 'vitest';
import { EncounterSetPieceDepthValidator } from './EncounterSetPieceDepthValidator';
import type { Story } from '../../types';
import type { SeasonScenePlan } from '../../types/scenePlan';

function story(encounter: Record<string, unknown>): Story {
  return {
    id: 's', title: 't', genre: 'fantasy', synopsis: '', coverImage: '',
    initialState: { attributes: {} as never, skills: {} as never, tags: [], inventory: [] },
    npcs: [],
    episodes: [{
      id: 'ep-3', number: 3, title: 'E3', synopsis: '', coverImage: '', startingSceneId: 'treatment-enc-3-1',
      scenes: [{ id: 'treatment-enc-3-1', name: 'The Walls', startingBeatId: '', beats: [], encounter }],
    }],
  } as unknown as Story;
}

const siegePlan: SeasonScenePlan = {
  scenes: [{
    id: 'treatment-enc-3-1', episodeNumber: 3, order: 0, kind: 'encounter', title: 'Walls',
    dramaticPurpose: 'x', narrativeRole: 'return', locations: [], npcsInvolved: [], setsUp: [], paysOff: [],
    signatureMoment: 'The siege itself — a sustained defensive set piece (wall breach + repulse) culminating in the choice to evacuate.',
  }],
  byEpisode: { 3: ['treatment-enc-3-1'] },
  setupPayoffEdges: [],
} as unknown as SeasonScenePlan;

const run = (encounter: Record<string, unknown>, plan?: SeasonScenePlan) =>
  new EncounterSetPieceDepthValidator().validate({ story: story(encounter), plan });

describe('EncounterSetPieceDepthValidator', () => {
  it('flags a sustained set piece collapsed to one phase + flat tension curve', () => {
    const res = run(
      { phases: [{ beats: [{ id: 'p1-b1' }] }], tensionCurve: [{ beatId: 'b', tensionLevel: 3, description: 'setup tension' }] },
      siegePlan,
    );
    expect(res.valid).toBe(false);
    expect(res.issues[0].message).toMatch(/sustained set piece but collapsed/);
  });

  it('passes a sustained set piece with multiple escalating phases', () => {
    const res = run(
      { phases: [{ beats: [{ id: 'a' }] }, { beats: [{ id: 'b' }] }, { beats: [{ id: 'c' }] }], tensionCurve: [{}, {}] },
      siegePlan,
    );
    expect(res.valid).toBe(true);
    expect(res.issues).toHaveLength(0);
  });

  it('passes a sustained set piece with a ≥3-point tension curve even if single-phase', () => {
    const res = run(
      { phases: [{ beats: [{ id: 'a' }] }], tensionCurve: [{}, {}, {}, {}] },
      siegePlan,
    );
    expect(res.valid).toBe(true);
  });

  it('does NOT flag a non-set-piece encounter (no sustained intent)', () => {
    // A normal one-decision social encounter is fine.
    const res = run(
      { description: 'A tense conversation over wine.', phases: [{ beats: [{ id: 'a' }] }], tensionCurve: [{}] },
      undefined,
    );
    expect(res.valid).toBe(true);
    expect(res.issues).toHaveLength(0);
  });

  it('matches the set-piece banner from the encounter description even without a plan', () => {
    const res = run(
      { description: 'A prolonged siege: wave after wave at the eastern wall.', phases: [{ beats: [{ id: 'a' }] }], tensionCurve: [{}] },
      undefined,
    );
    expect(res.valid).toBe(false);
  });
});
