import { describe, expect, it } from 'vitest';

import {
  buildDefaultCliffhangerPlan,
  getCliffhangerDefaultsForStoryCircleBeat,
} from './cliffhangerPlanning';
import type { EpisodeOutline, StoryCircleBeat } from '../../types/sourceAnalysis';

function episode(beat: StoryCircleBeat, episodeNumber = 2): EpisodeOutline {
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
    storyCircleRole: [{ beat, roleKind: 'primary', source: 'distribution' }],
    narrativeFunction: {
      setup: 'The protagonist enters pressure.',
      conflict: 'The antagonist corners the protagonist.',
      resolution: 'The protagonist survives with a cost.',
    },
  };
}

describe('cliffhangerPlanning', () => {
  it('maps all Story Circle beats to a default cliffhanger style', () => {
    const roles: StoryCircleBeat[] = ['you', 'need', 'go', 'search', 'find', 'take', 'return', 'change'];

    for (const role of roles) {
      const defaults = getCliffhangerDefaultsForStoryCircleBeat(role, 2, 8);
      expect(defaults.type).toBeTruthy();
      expect(defaults.intensity).toBeTruthy();
      expect(defaults.newOpenQuestion.length).toBeGreaterThan(20);
    }
  });

  it('forces episode 1 to a high-intensity shock ending', () => {
    const plan = buildDefaultCliffhangerPlan({
      episode: episode('you', 1),
      totalEpisodes: 8,
      seasonStakes: 'The city survives.',
    });

    expect(plan.type).toBe('shock');
    expect(plan.intensity).toBe('high');
    expect(plan.storyCircleLaunchBeat).toBe('go');
  });

  it('keeps search, find, and take cliffhangers at high pressure', () => {
    const find = buildDefaultCliffhangerPlan({ episode: episode('find', 4), totalEpisodes: 8 });
    const take = buildDefaultCliffhangerPlan({ episode: episode('take', 6), totalEpisodes: 8 });
    const search = buildDefaultCliffhangerPlan({ episode: episode('search', 3), totalEpisodes: 8 });

    expect(find.intensity).toBe('high');
    expect(find.type).toBe('reframe');
    expect(take.intensity).toBe('high');
    expect(take.type).toBe('emotional_hook');
    expect(search.intensity).toBe('high');
  });
});
