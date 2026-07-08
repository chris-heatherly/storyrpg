import { describe, expect, it } from 'vitest';
import {
  compileEpisodeSpine,
  decomposeTreatmentTurns,
  splitPostConditionalTurn,
} from './compileEpisodeSpine';
import type { SeasonEpisode } from '../../types/seasonPlan';

function liteEpisode(overrides: Partial<SeasonEpisode> = {}): SeasonEpisode {
  return {
    episodeNumber: 1,
    title: 'Ep1',
    synopsis: '',
    status: 'planned',
    dependsOn: [],
    setupsForEpisodes: [],
    resolvesPlotsFrom: [],
    introducesCharacters: [],
    locations: ['Bucharest', 'Lumina Books', 'Vâlcescu Club', 'Cișmigiu Gardens', 'Kylie Apartment'],
    mainCharacters: ['Kylie', 'Stela', 'Mika'],
    estimatedSceneCount: 6,
    sourceChapters: [],
    treatmentGuidance: {
      sourceKind: 'authored_lite',
      episodeTurns: [
        'She explores the streets of Bucharest and wanders into a bookshop owned by Stela who befriends her.',
        'After testing Kylie, the three become friends and form the Dusk Club.',
        'On the rooftop bar at sunset, two suitors compete for her attention.',
        'Walking home through Cismigiu Gardens, Kylie is attacked and Victor rescues her.',
        'At her apartment doorstep, Victor vanishes through the keycard door.',
        'At 4am she writes the blog post as Mr. Midnight.',
        'By evening the post goes viral at the club.',
      ],
    },
    storyCircleRole: [{ beat: 'you', roleKind: 'primary' }],
    ...overrides,
  } as SeasonEpisode;
}

describe('splitPostConditionalTurn', () => {
  it('splits testing precondition from group formation outcome', () => {
    const parts = splitPostConditionalTurn(
      'After testing Kylie, the three become friends and form the Dusk Club.',
    );
    expect(parts).toHaveLength(2);
    expect(parts[0]).toMatch(/testing/i);
    expect(parts[1]).toMatch(/dusk club/i);
  });
});

describe('decomposeTreatmentTurns', () => {
  it('expands post-conditional turns in a list', () => {
    const turns = decomposeTreatmentTurns([
      'She arrives in Bucharest.',
      'After testing Kylie, the three become friends and form the Dusk Club.',
    ]);
    expect(turns.length).toBe(3);
  });
});

describe('compileEpisodeSpine', () => {
  it('produces one unit per decomposed turn with prerequisites on bond', () => {
    const spine = compileEpisodeSpine(liteEpisode());
    expect(spine).toBeDefined();
    expect(spine!.units.length).toBeGreaterThanOrEqual(8);

    const bond = spine!.units.find((unit) => unit.kind === 'bond');
    const test = spine!.units.find((unit) => unit.kind === 'test');
    expect(test).toBeDefined();
    expect(bond).toBeDefined();
    expect(bond!.prerequisites).toContain(test!.id);
  });

  it('assigns staged_rescue profile to threat encounter unit', () => {
    const spine = compileEpisodeSpine(liteEpisode());
    const rescue = spine!.units.find((unit) => unit.encounterProfile === 'staged_rescue');
    expect(rescue).toBeDefined();
    expect(rescue!.sceneKind).toBe('encounter');
  });

  it('assigns late_night_writing before viral aftermath and staged_rescue on threat', () => {
    const spine = compileEpisodeSpine(liteEpisode());
    const kinds = spine!.units.map((unit) => unit.kind);
    const writingIdx = kinds.indexOf('late_night_writing');
    const aftermathIdx = kinds.indexOf('aftermath');
    expect(writingIdx).toBeGreaterThanOrEqual(0);
    expect(aftermathIdx).toBeGreaterThan(writingIdx);

    const testIdx = kinds.indexOf('test');
    const bondIdx = kinds.indexOf('bond');
    expect(testIdx).toBeGreaterThanOrEqual(0);
    expect(bondIdx).toBeGreaterThan(testIdx);

    const rescue = spine!.units.find((unit) => unit.encounterProfile === 'staged_rescue');
    expect(rescue).toBeDefined();
  });

  it('assigns exactly one location per unit', () => {
    const spine = compileEpisodeSpine(liteEpisode());
    for (const unit of spine!.units) {
      expect(unit.locationId).toBeTruthy();
    }
  });

  it('returns undefined for non-treatment episodes', () => {
    const ep = liteEpisode({ treatmentGuidance: undefined });
    expect(compileEpisodeSpine(ep)).toBeUndefined();
  });
});
