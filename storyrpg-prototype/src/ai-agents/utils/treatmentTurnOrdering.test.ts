import { describe, expect, it } from 'vitest';
import {
  assignAuthoredLiteTurnsToStandardScenes,
  chronologyRankForText,
  coalesceFragmentedEpisodeTurns,
  countAuthoredLiteSceneBudget,
  isThreatEncounterTurn,
  orderAuthoredEpisodeTurns,
  positionalTurnAssignment,
  splitCompoundSpatialEpisodeTurns,
  sortPlannedScenesByChronologyCue,
} from './treatmentTurnOrdering';
import type { PlannedScene } from '../../types/scenePlan';

describe('treatmentTurnOrdering', () => {
  it('merges fragmented codename turns', () => {
    const merged = coalesceFragmentedEpisodeTurns([
      'At 4am she turns the night into the first Dating After Dusk post under the codename Mr.',
      'Midnight, and by evening the post has gone viral.',
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toContain('Mr. Midnight');
  });

  it('detects threat encounter turns', () => {
    expect(isThreatEncounterTurn('Walking home through Cismigiu, she is attacked and rescued.')).toBe(true);
    expect(isThreatEncounterTurn('She explores the streets of Bucharest.')).toBe(false);
  });

  it('splits compound explore+bookshop turns before binding', () => {
    const split = splitCompoundSpatialEpisodeTurns([
      'She explores the streets of Bucharest and wanders into a bookshop owned by Stela who befriends her.',
    ]);
    expect(split).toHaveLength(2);
    expect(split[0]).toMatch(/explores the streets/i);
    expect(split[1]).toMatch(/bookshop/i);
  });

  it('binds pre-threat turns before encounter and post-threat after', () => {
    const scenes: PlannedScene[] = [
      { id: 's1-1', order: 0, kind: 'standard' } as PlannedScene,
      { id: 's1-2', order: 1, kind: 'standard' } as PlannedScene,
      { id: 'enc', order: 2, kind: 'encounter' } as PlannedScene,
      { id: 's1-5', order: 3, kind: 'standard' } as PlannedScene,
    ];
    const turnTargets = scenes.filter((scene) => scene.kind !== 'encounter');
    const turns = [
      'Kylie arrives in Bucharest with two suitcases.',
      'She explores the streets of Bucharest.',
      'At 4am she turns the night into the first Dating After Dusk post.',
    ];
    const assignment = assignAuthoredLiteTurnsToStandardScenes(turns, turnTargets, scenes);
    expect(assignment[0]).toBe(0);
    expect(assignment[1]).toBe(1);
    expect(assignment[2]).toBe(2);
    expect(turnTargets[assignment[2]].id).toBe('s1-5');
  });

  it('budgets one pre-encounter scene per pre-threat turn plus post-threat act', () => {
    const turns = [
      'Kylie arrives in Bucharest.',
      'She explores the streets of Bucharest.',
      'She wanders into a bookshop owned by Stela.',
      'Stela introduces Mika at Valescu Club.',
      'Walking home through Cismigiu she is attacked.',
      'At 4am she writes the first blog post.',
      'By evening the post goes viral.',
    ];
    const budget = countAuthoredLiteSceneBudget(turns, 1);
    expect(budget.preThreatScenes).toBe(4);
    expect(budget.postThreatScenes).toBe(2);
    expect(budget.totalScenes).toBe(7);
  });
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
