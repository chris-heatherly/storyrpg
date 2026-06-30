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
    locations: ['port city'],
    npcsInvolved: ['protagonist'],
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
- **Hook:** Avery is pinned to a tree, rescued by Night Signal, and the post does 80,000 reads.
- **Midpoint:** Avery sees herself alone in Rowan's mirror; Morgan confesses two truths; the genre changes; the blog skips a day.
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
    expect(findBeat?.sourceText).toContain("Rowan's mirror");
    expect(findBeat?.eventAtoms.join(' ')).toContain('Morgan confesses two truths');
    expect(findBeat?.requiredRealization).toContain('mechanic_pressure');
  });

  it('assigns beat contracts to scenes, required beats, and pressure metadata', () => {
    const plan = {
      totalEpisodes: 8,
      legacyStructure: {
        hook: 'hook',
        plotTurn1: 'turn',
        pinch1: 'pinch',
        midpoint: 'Avery sees herself alone in Rowan mirror and the genre changes.',
        pinch2: 'pinch2',
        climax: 'climax',
        resolution: 'resolution',
      },
      treatmentSeasonGuidance: {
        seasonSpine: '- **Midpoint:** Avery sees herself alone in Rowan mirror and the genre changes.',
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
    const hookText = "Avery lands in port city with two suitcases and her grandmother's address; by night three she's at a rooftop bar.";
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

  it('atomizes broad ordinary-world bundles before assigning scene prose contracts', () => {
    const broadYou =
      "The protagonist's ordinary world is reinvention-as-performance. They arrive in the port city with two bags and an old address, gather a new circle over bitter drinks, and protect themself the way they always have — by observing, ordering second, and writing the piece later. Opening promise: a wounded newcomer gets a glamorous new life and their own byline. The staged rescue and the viral anonymous post close the beat by making them a name.";
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
        dramaticPurpose: 'The protagonist arrives in the port city with two bags and an old address.',
      },
      {
        ...scene('s1-new-circle', 1, 1, 'setup'),
        title: 'New circle drinks',
        dramaticPurpose: 'The protagonist gathers a new circle over bitter drinks and learns to protect themself by observing the room.',
      },
      {
        ...scene('s1-public-rescue', 1, 2, 'turn'),
        title: 'Public rescue',
        dramaticPurpose: 'The staged rescue happens in the park and the anonymous rescuer appears.',
      },
      {
        ...scene('s1-publication-aftermath', 1, 3, 'release'),
        title: 'Publication aftermath',
        dramaticPurpose: 'The viral anonymous post makes the protagonist a name.',
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
      expect.arrayContaining(['s1-arrival-cold-open', 's1-new-circle', 's1-public-rescue', 's1-publication-aftermath']),
    );
    expect(boundContractTexts).toEqual(expect.arrayContaining([
      expect.stringContaining('arrive in the port city'),
      expect.stringContaining('new circle'),
      expect.stringContaining('staged rescue'),
      expect.stringContaining('viral'),
    ]));
    expect(boundContractTexts).not.toContain(broadYou);
    expect(requiredBeatTexts.some((text) => text.includes('arrive in the port city') && text.includes('staged rescue'))).toBe(false);
    expect(requiredBeatTexts.some((text) => text.includes('new circle') && text.includes('viral'))).toBe(false);
  });

  it('recomputes stale preanalyzed event atoms before assigning scene prose contracts', () => {
    const bundled =
      'The protagonist forms the night circle, starts the public journal, and turns a rescue into public proof.';
    const staleContract: StoryCircleBeatRealizationContract = {
      id: 'story-circle-you-stale-bundled-actions',
      beat: 'you',
      sourceText: bundled,
      targetEpisodeNumber: 1,
      requiredRealization: ['season_plan', 'scene_turn', 'final_prose', 'mechanic_pressure'],
      eventAtoms: [bundled],
      stateChange: bundled,
      targetSceneIds: [],
      blockingLevel: 'treatment',
    };
    const plan = {
      totalEpisodes: 1,
      storyCircleBeatContracts: [staleContract],
    } as unknown as SeasonPlan;
    const scenes = [
      {
        ...scene('s1-circle', 1, 0, 'setup'),
        dramaticPurpose: 'The protagonist forms the night circle.',
      },
      {
        ...scene('s1-journal', 1, 1, 'turn'),
        dramaticPurpose: 'The protagonist starts the public journal and turns a rescue into public proof.',
      },
    ];

    assignStoryCircleBeatContractsToScenes(plan, scenes);
    const requiredBeatTexts = scenes.flatMap((candidate) =>
      (candidate.requiredBeats ?? []).map((beat) => beat.mustDepict)
    );

    expect(requiredBeatTexts).toEqual(expect.arrayContaining([
      'The protagonist forms the night circle',
      'The protagonist starts the public journal',
      'The protagonist turns a rescue into public proof',
    ]));
    expect(requiredBeatTexts).not.toContain(bundled);
  });

  it('does not split descriptive appositives as separate action atoms', () => {
    const contracts = buildStoryCircleBeatContracts({
      totalEpisodes: 1,
      treatmentSourced: true,
      guidance: {
        seasonSpine:
          '- **You:** The protagonist arrives in the capital as a careful observer, wounded traveler with one bag, and writer trying to rebuild.',
      },
    });

    expect(contracts[0].eventAtoms).toEqual([
      'The protagonist arrives in the capital as a careful observer, wounded traveler with one bag, and writer trying to rebuild',
    ]);
  });

  it('does split shared-subject action series into separate action atoms', () => {
    const contracts = buildStoryCircleBeatContracts({
      totalEpisodes: 1,
      treatmentSourced: true,
      guidance: {
        seasonSpine:
          '- **You:** The protagonist forms the night circle, starts the public journal, and turns a rescue into public proof.',
      },
    });

    expect(contracts[0].eventAtoms).toEqual([
      'The protagonist forms the night circle',
      'The protagonist starts the public journal',
      'The protagonist turns a rescue into public proof',
    ]);
  });

  it('builds episode-circle contracts for all eight beats in a compact three-scene episode', () => {
    const contracts = buildEpisodeCircleBeatContracts({
      episodeNumber: 3,
      storyCircleRole: [{ beat: 'find', roleKind: 'primary' }],
      episodeCircle: {
        you: 'Avery starts the night believing the club can still be ordinary glamour.',
        need: 'Avery needs proof that Jordan is not another performance.',
        go: 'Avery crosses into the members-only corridor where old social rules stop working.',
        search: 'Avery tests charm, suspicion, and trust while the corridor keeps changing.',
        find: 'Avery finds Jordan hiding the invitation ledger in the mirrored office.',
        take: 'Avery takes the ledger and loses Jordan’s easy trust in the same breath.',
        return: 'Avery carries the ledger back to the rooftop with everyone watching.',
        change: 'Avery chooses to publish nothing yet and becomes a participant instead of an observer.',
      },
      scenes: [
        { id: 's3-1', order: 0, narrativeRole: 'setup', description: 'club glamour and Jordan doubt' },
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

  it('keeps aggregate episode-circle synopsis text out of final-prose enforcement', () => {
    const aggregate =
      'Name the episode pressure: The protagonist arrives with two bags, forms a fragile circle over bitter drinks, notices a stranger at a rooftop door, survives a park attack, writes at 4am, and watches the public post go viral.';

    const contracts = buildEpisodeCircleBeatContracts({
      episodeNumber: 1,
      episodeCircle: {
        you: aggregate,
      },
      scenes: [
        { id: 'arrival', order: 0, narrativeRole: 'setup', description: 'arrival with two bags' },
        { id: 'circle', order: 1, narrativeRole: 'development', description: 'fragile circle and bitter drinks' },
        { id: 'aftermath', order: 2, narrativeRole: 'release', description: 'public post aftermath' },
      ],
    });

    expect(contracts).toHaveLength(1);
    expect(contracts[0].requiredRealization).not.toContain('final_prose');
    expect(contracts[0].requiredRealization).not.toContain('mechanic_pressure');
  });

  it('treats meta episode known-world instructions as aggregate planning text', () => {
    const aggregate =
      'In "Opening Night", establish the episode known world before disruption: the protagonist arrives in a new city, establishes an observer persona, and protects an independent voice through a public journal.';

    const contracts = buildEpisodeCircleBeatContracts({
      episodeNumber: 1,
      episodeCircle: {
        you: aggregate,
      },
      scenes: [
        { id: 'arrival', order: 0, narrativeRole: 'setup', description: 'arrival in a new city' },
        { id: 'journal', order: 1, narrativeRole: 'release', description: 'public journal aftermath' },
      ],
    });

    expect(contracts).toHaveLength(1);
    expect(contracts[0].requiredRealization).toEqual(['season_plan', 'scene_turn']);
  });

});
