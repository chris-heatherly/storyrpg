import { describe, expect, it } from 'vitest';

import {
  buildDefaultCliffhangerPlan,
  getCliffhangerDefaultsForRole,
} from './cliffhangerPlanning';
import type { EpisodeOutline, StructuralRole } from '../../types/sourceAnalysis';

function episode(role: StructuralRole, episodeNumber = 2): EpisodeOutline {
  return {
    episodeNumber,
    title: `Episode ${episodeNumber}`,
    synopsis: 'A test episode.',
    sourceChapters: [],
    sourceSummary: '',
    plotPoints: [],
    mainCharacters: [],
    supportingCharacters: [],
    locations: [],
    estimatedSceneCount: 4,
    estimatedChoiceCount: 2,
    structuralRole: [role],
    narrativeFunction: {
      setup: 'The protagonist enters pressure.',
      conflict: 'The antagonist corners the protagonist.',
      resolution: 'The protagonist survives with a cost.',
    },
  };
}

describe('cliffhangerPlanning', () => {
  it('maps all structural roles to a default cliffhanger style', () => {
    const roles: StructuralRole[] = [
      'hook',
      'plotTurn1',
      'pinch1',
      'midpoint',
      'pinch2',
      'climax',
      'resolution',
      'rising',
      'falling',
    ];

    for (const role of roles) {
      const defaults = getCliffhangerDefaultsForRole(role, 2, 8);
      expect(defaults.type).toBeTruthy();
      expect(defaults.intensity).toBeTruthy();
      expect(defaults.newOpenQuestion.length).toBeGreaterThan(20);
    }
  });

  it('forces episode 1 to a high-intensity shock ending', () => {
    const plan = buildDefaultCliffhangerPlan({
      episode: episode('hook', 1),
      totalEpisodes: 8,
      seasonStakes: 'The city survives.',
    });

    expect(plan.type).toBe('shock');
    expect(plan.intensity).toBe('high');
    expect(plan.mappedStructuralRole).toBe('hook');
  });

  it('makes midpoint and pinch2 sharper than ordinary buffer episodes', () => {
    const midpoint = buildDefaultCliffhangerPlan({ episode: episode('midpoint', 4), totalEpisodes: 8 });
    const pinch2 = buildDefaultCliffhangerPlan({ episode: episode('pinch2', 6), totalEpisodes: 8 });
    const rising = buildDefaultCliffhangerPlan({ episode: episode('rising', 3), totalEpisodes: 8 });

    expect(midpoint.intensity).toBe('high');
    expect(midpoint.type).toBe('reframe');
    expect(pinch2.intensity).toBe('high');
    expect(pinch2.type).toBe('emotional_hook');
    expect(rising.intensity).toBe('medium');
  });
});
