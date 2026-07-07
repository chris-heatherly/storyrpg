import { describe, expect, it } from 'vitest';
import {
  chronologyRankForText,
  orderAuthoredEpisodeTurns,
  positionalTurnAssignment,
  sortPlannedScenesByChronologyCue,
} from './treatmentTurnOrdering';
import type { PlannedScene } from '../../types/scenePlan';

describe('treatmentTurnOrdering', () => {
  it('ranks arrival before exploration and bookshop', () => {
    expect(chronologyRankForText('Kylie arrives in Bucharest with two suitcases.')).toBeLessThan(
      chronologyRankForText('She explores the streets of Bucharest.'),
    );
    expect(chronologyRankForText('She explores the streets of Bucharest.')).toBeLessThan(
      chronologyRankForText('She wanders into a bookshop owned by Stela who befriends her.'),
    );
  });

  it('orders bite-me-style turns into playback sequence', () => {
    const turns = [
      'At a rooftop bar she catches the attention of a man in a charcoal suit.',
      'Kylie arrives in Bucharest with two suitcases and her grandmother\'s address.',
      'She explores the streets of Bucharest.',
      'She wanders into a bookshop owned by Stela who befriends her.',
      'Stela introduces Kylie to the secret nightlife world of Valescu Club and her friend Mika.',
      'Walking home through Cismigiu, she is attacked and rescued by the impossibly handsome stranger.',
      'At 4am she turns the night into the first Dating After Dusk post under the codename Mr. Midnight.',
    ];
    const ordered = orderAuthoredEpisodeTurns(turns);
    expect(ordered[0]).toContain('arrives');
    expect(ordered[1]).toContain('explores');
    expect(ordered.indexOf(turns[3])).toBeLessThan(ordered.indexOf(turns[0]));
  });

  it('uses strict positional assignment for equal-length arrays', () => {
    expect(positionalTurnAssignment(4, 4)).toEqual([0, 1, 2, 3]);
  });

  it('reorders planned scenes by chronology cue rank', () => {
    const scenes: PlannedScene[] = [
      {
        id: 's1-explore',
        episodeNumber: 1,
        order: 0,
        kind: 'standard',
        title: 'She explores the streets of Bucharest',
        dramaticPurpose: 'She explores the streets of Bucharest',
        narrativeRole: 'setup',
        locations: ['City'],
        npcsInvolved: ['Protagonist'],
        setsUp: [],
        paysOff: [],
        hasChoice: true,
        budgetWeight: 1,
      },
      {
        id: 's1-arrival',
        episodeNumber: 1,
        order: 1,
        kind: 'standard',
        title: 'Kylie arrives in Bucharest with two suitcases',
        dramaticPurpose: 'Kylie arrives in Bucharest with two suitcases',
        narrativeRole: 'development',
        locations: ['City'],
        npcsInvolved: ['Protagonist'],
        setsUp: [],
        paysOff: [],
        hasChoice: true,
        budgetWeight: 1,
      },
    ];
    expect(sortPlannedScenesByChronologyCue(scenes)).toBeGreaterThan(0);
    expect(scenes[0].id).toBe('s1-arrival');
    expect(scenes[1].id).toBe('s1-explore');
  });
});
