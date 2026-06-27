import { describe, expect, it } from 'vitest';
import type { SeasonPlan } from '../../types/seasonPlan';
import type { PlannedScene } from '../../types/scenePlan';
import {
  assignStoryCircleBeatContractsToScenes,
  buildStoryCircleBeatContracts,
} from './storyCircleBeatContracts';

function scene(id: string, episodeNumber: number, order: number, role: PlannedScene['narrativeRole']): PlannedScene {
  return {
    id,
    episodeNumber,
    order,
    kind: 'standard',
    title: `${role} scene`,
    dramaticPurpose: role === 'turn' ? 'The mirror changes the genre and the blog skips a day.' : `${role} purpose`,
    narrativeRole: role,
    locations: ['Bucharest'],
    npcsInvolved: ['kylie'],
    setsUp: [],
    paysOff: [],
    hasChoice: role === 'turn',
  };
}

describe('storyCircleBeatContracts', () => {
  it('builds authored contracts from Section 7 beat text', () => {
    const contracts = buildStoryCircleBeatContracts({
      totalEpisodes: 8,
      treatmentSourced: true,
      guidance: {
        seasonSpine: `
- **Hook:** Kylie is pinned to a tree, rescued by Mr. Midnight, and the post does 80,000 reads.
- **Midpoint:** Kylie sees herself alone in Victor's mirror; Stela confesses two truths; the genre changes; the blog skips a day.
        `,
        beatEpisodeAnchors: { hook: 1, midpoint: 5 },
      },
      legacyStructure: {
        hook: 'fallback hook',
        plotTurn1: '',
        pinch1: '',
        midpoint: 'fallback midpoint',
        pinch2: '',
        climax: '',
        resolution: '',
      },
    });

    const findBeat = contracts.find((contract) => contract.beat === 'find');
    expect(findBeat?.blockingLevel).toBe('treatment');
    expect(findBeat?.targetEpisodeNumber).toBe(5);
    expect(findBeat?.sourceText).toContain("Victor's mirror");
    expect(findBeat?.eventAtoms.join(' ')).toContain('Stela confesses two truths');
    expect(findBeat?.requiredRealization).toContain('mechanic_pressure');
  });

  it('assigns beat contracts to scenes, required beats, and pressure metadata', () => {
    const plan = {
      totalEpisodes: 8,
      legacyStructure: {
        hook: 'hook',
        plotTurn1: 'turn',
        pinch1: 'pinch',
        midpoint: 'Kylie sees herself alone in Victor mirror and the genre changes.',
        pinch2: 'pinch2',
        climax: 'climax',
        resolution: 'resolution',
      },
      treatmentSeasonGuidance: {
        seasonSpine: '- **Midpoint:** Kylie sees herself alone in Victor mirror and the genre changes.',
        beatEpisodeAnchors: { midpoint: 5 },
      },
    } as unknown as SeasonPlan;
    const scenes = [
      scene('s5-1', 5, 0, 'setup'),
      scene('s5-2', 5, 1, 'turn'),
      scene('s5-3', 5, 2, 'release'),
    ];

    const contracts = assignStoryCircleBeatContractsToScenes(plan, scenes);
    const target = scenes.find((candidate) => candidate.id === 's5-2');

    expect(contracts.find((contract) => contract.beat === 'find')?.targetSceneIds).toContain('s5-2');
    expect(target?.storyCircleBeatContracts?.[0].beat).toBe('find');
    expect(target?.requiredBeats?.some((beat) => beat.id.includes('story-circle-find'))).toBe(true);
    expect(target?.mechanicPressure?.some((pressure) => pressure.id.includes('story-circle-find'))).toBe(true);
  });

  it('does not hard-bind legacy Story Circle prose when Story Circle already owns the authored beat', () => {
    const hookText = "Kylie lands in Bucharest with two suitcases and her grandmother's address; by night three she's at a rooftop bar.";
    const plan = {
      totalEpisodes: 8,
      legacyStructure: {
        hook: hookText,
        plotTurn1: '',
        pinch1: '',
        midpoint: '',
        pinch2: '',
        climax: '',
        resolution: '',
      },
      treatmentSeasonGuidance: {
        seasonSpine: `- **Hook:** ${hookText}`,
        beatEpisodeAnchors: { hook: 1 },
      },
    } as unknown as SeasonPlan;
    const scenes = [
      {
        ...scene('s1-arrival-cold-open', 1, 0, 'setup'),
        title: 'Arrival cold open',
        storyCircleBeatContracts: [{
          id: 'story-circle-you',
          beat: 'you',
          sourceText: hookText,
          targetEpisodeNumber: 1,
          requiredRealization: ['season_plan', 'scene_turn', 'final_prose'],
          eventAtoms: [hookText],
          targetSceneIds: ['s1-arrival-cold-open'],
          blockingLevel: 'treatment',
        }],
      },
      scene('s1-1', 1, 1, 'setup'),
    ];

    const contracts = assignStoryCircleBeatContractsToScenes(plan, scenes);

    expect(contracts.find((contract) => contract.beat === 'you')?.targetSceneIds).toEqual([]);
    expect(scenes.filter((candidate) => candidate.id !== 's1-arrival-cold-open').some((candidate) => (candidate.storyCircleBeatContracts ?? []).length > 0)).toBe(false);
    expect(scenes.some((candidate) => (candidate.requiredBeats ?? []).some((beat) => beat.id.includes('story-circle-you')))).toBe(false);
  });
});
