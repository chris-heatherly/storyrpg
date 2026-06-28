import { describe, expect, it } from 'vitest';
import type { SeasonPlan } from '../../types/seasonPlan';
import type { PlannedScene, StoryCircleBeatRealizationContract } from '../../types/scenePlan';
import {
  buildEpisodeCircleBeatContracts,
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
          beat: 'you' as const,
          sourceText: hookText,
          targetEpisodeNumber: 1,
          requiredRealization: ['season_plan', 'scene_turn', 'final_prose'],
          eventAtoms: [hookText],
          targetSceneIds: ['s1-arrival-cold-open'],
          blockingLevel: 'treatment' as const,
        } as StoryCircleBeatRealizationContract],
      },
      scene('s1-1', 1, 1, 'setup'),
    ];

    const contracts = assignStoryCircleBeatContractsToScenes(plan, scenes);

    expect(contracts.find((contract) => contract.beat === 'you')?.targetSceneIds).toEqual([]);
    expect(scenes.filter((candidate) => candidate.id !== 's1-arrival-cold-open').some((candidate) => (candidate.storyCircleBeatContracts ?? []).length > 0)).toBe(false);
    expect(scenes.some((candidate) => (candidate.requiredBeats ?? []).some((beat) => beat.id.includes('story-circle-you')))).toBe(false);
  });

  it('atomizes broad Bite Me ordinary-world bundles before assigning scene prose contracts', () => {
    const broadYou =
      "Kylie's ordinary world is reinvention-as-performance. She arrives in Bucharest with two suitcases and her grandmother's address, gathers the Dusk Club over too-dark negronis, and protects herself the way she always has — by observing, ordering second, and writing the piece later. Opening promise: a heartbroken woman gets a glamorous new life and her own byline. The staged rescue and the viral Mr. Midnight post close the beat by making her a name.";
    const plan = {
      totalEpisodes: 8,
      legacyStructure: {
        hook: broadYou,
        plotTurn1: '',
        pinch1: '',
        midpoint: '',
        pinch2: '',
        climax: '',
        resolution: '',
      },
      treatmentSeasonGuidance: {
        seasonSpine: `- **You (Ep1):** ${broadYou}`,
        storyCircleBeatEpisodeAnchors: { you: 1 },
      },
    } as unknown as SeasonPlan;
    const scenes = [
      {
        ...scene('s1-arrival-cold-open', 1, 0, 'setup'),
        title: 'Arrival cold open',
        dramaticPurpose: "Kylie arrives in Bucharest with two suitcases and her grandmother's address.",
      },
      {
        ...scene('s1-dusk-club', 1, 1, 'setup'),
        title: 'Dusk Club negronis',
        dramaticPurpose: 'Kylie meets Mika and Stela and learns to protect herself by observing the room.',
      },
      {
        ...scene('s1-cismigiu-attack', 1, 2, 'turn'),
        title: 'Cismigiu Park attack',
        dramaticPurpose: 'The staged rescue happens in the park and Mr. Midnight appears.',
      },
      {
        ...scene('s1-blog-aftermath', 1, 3, 'release'),
        title: 'Blog aftermath',
        dramaticPurpose: 'The viral Mr. Midnight post makes Kylie a name.',
      },
    ];

    const contracts = assignStoryCircleBeatContractsToScenes(plan, scenes);
    const boundContractTexts = scenes.flatMap((candidate) =>
      (candidate.storyCircleBeatContracts ?? []).map((contract) => contract.sourceText)
    );
    const requiredBeatTexts = scenes.flatMap((candidate) =>
      (candidate.requiredBeats ?? []).map((beat) => beat.mustDepict)
    );

    expect(contracts.find((contract) => contract.beat === 'you')?.targetSceneIds).toEqual(
      expect.arrayContaining(['s1-arrival-cold-open', 's1-dusk-club', 's1-cismigiu-attack', 's1-blog-aftermath']),
    );
    expect(boundContractTexts).toEqual(expect.arrayContaining([
      expect.stringContaining('arrives in Bucharest'),
      expect.stringContaining('Dusk Club'),
      expect.stringContaining('staged rescue'),
      expect.stringContaining('viral'),
    ]));
    expect(boundContractTexts).not.toContain(broadYou);
    expect(requiredBeatTexts.some((text) => text.includes('arrives in Bucharest') && text.includes('staged rescue'))).toBe(false);
    expect(requiredBeatTexts.some((text) => text.includes('Dusk Club') && text.includes('viral'))).toBe(false);
  });

  it('builds episode-circle contracts for all eight beats in a compact three-scene episode', () => {
    const contracts = buildEpisodeCircleBeatContracts({
      episodeNumber: 3,
      storyCircleRole: [{ beat: 'find', roleKind: 'primary' }],
      episodeCircle: {
        you: 'Kylie starts the night believing the club can still be ordinary glamour.',
        need: 'Kylie needs proof that Mika is not another performance.',
        go: 'Kylie crosses into the members-only corridor where old social rules stop working.',
        search: 'Kylie tests charm, suspicion, and trust while the corridor keeps changing.',
        find: 'Kylie finds Mika hiding the invitation ledger in the mirrored office.',
        take: 'Kylie takes the ledger and loses Mika’s easy trust in the same breath.',
        return: 'Kylie carries the ledger back to the rooftop with everyone watching.',
        change: 'Kylie chooses to publish nothing yet and becomes a participant instead of an observer.',
      },
      scenes: [
        { id: 's3-1', order: 0, narrativeRole: 'setup', description: 'club glamour and Mika doubt' },
        { id: 's3-2', order: 1, narrativeRole: 'turn', isEncounter: true, description: 'mirrored office reveal ledger cost' },
        { id: 's3-3', order: 2, narrativeRole: 'release', description: 'rooftop aftermath and handoff pressure' },
      ],
    });

    expect(contracts).toHaveLength(8);
    expect(contracts.every((contract) => contract.blockingLevel === 'structural')).toBe(true);
    expect(contracts.find((contract) => contract.beat === 'return')?.targetSceneIds).toEqual(['s3-3']);
    expect(contracts.find((contract) => contract.beat === 'change')?.targetSceneIds).toEqual(['s3-3']);
    expect(contracts.find((contract) => contract.beat === 'find')?.targetSceneIds.length).toBe(1);
    expect(new Set(contracts.map((contract) => contract.targetSceneIds[0])).size).toBeLessThan(8);
  });
});
