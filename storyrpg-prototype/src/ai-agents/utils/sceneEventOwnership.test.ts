import { describe, expect, it } from 'vitest';
import {
  attachSceneEventOwnershipProfiles,
  buildSceneEventOwnershipPromptSection,
  type SceneEventOwnershipSceneLike,
} from './sceneEventOwnership';
import type { SceneConstructionObligation, SceneConstructionProfile } from '../../types/scenePlan';

describe('sceneEventOwnership', () => {
  function constructionProfile(
    sceneId: string,
    text: string,
    obligations: SceneConstructionObligation[] = [],
  ): SceneConstructionProfile {
    const primary = {
      source: 'sceneTurn' as const,
      id: `${sceneId}-turn`,
      slot: 'primary_turn' as const,
      text,
      reason: 'One scene, one dramatic turn.',
      hardUnits: 1,
      softUnits: 0,
    };
    const allObligations = obligations.length > 0 ? obligations : [primary];
    const hardUnits = allObligations.reduce((sum, item) => sum + item.hardUnits, 0);
    const softUnits = allObligations.reduce((sum, item) => sum + item.softUnits, 0);
    return {
      id: `profile:${sceneId}`,
      sceneId,
      episodeNumber: 1,
      primaryTurn: {
        id: primary.id,
        source: 'sceneTurn',
        text,
        beforeState: 'Before.',
        turnEvent: text,
        afterState: 'After.',
        handoff: 'Carry pressure forward.',
        sourceContractIds: [primary.id],
      },
      obligations: allObligations,
      sourceContractIds: allObligations.map((item) => item.id),
      activeCast: [],
      capacity: {
        hardUnits,
        softUnits,
        totalUnits: hardUnits + softUnits,
        maxHardUnits: 3,
        maxTotalUnits: 5,
        activeCastCount: 0,
        maxActiveCast: 3,
        activeConflictCount: 1,
        introductionCount: 0,
        explicitTimeCueCount: 0,
        explicitLocationCueCount: 0,
        beatBudget: { min: 3, recommended: 4, max: 8 },
      },
      routedObligationIds: [],
      conflictDiagnostics: [],
      promptGuidance: [],
    };
  }

  it('assigns incoming context and forbids restaging duplicate-sensitive prior events', () => {
    const scenes: SceneEventOwnershipSceneLike[] = [
      {
        id: 's1',
        turnContract: {
          turnId: 's1-turn',
          source: 'treatment' as const,
          centralTurn: 'A courier hands the protagonist a private club key card at the side entrance.',
          turnEvent: 'A courier hands the protagonist a private club key card at the side entrance.',
          beforeState: 'Outside.',
          afterState: 'Access changes.',
          handoff: 'Carry the access forward.',
        },
      },
      {
        id: 's2',
        turnContract: {
          turnId: 's2-turn',
          source: 'treatment' as const,
          centralTurn: 'The protagonist meets the table on the rooftop terrace.',
          turnEvent: 'The protagonist meets the table on the rooftop terrace.',
          beforeState: 'Alone.',
          afterState: 'Observed.',
          handoff: 'Carry social pressure forward.',
        },
      },
    ];

    const issues = attachSceneEventOwnershipProfiles(scenes);

    expect(issues).toEqual([]);
    expect(scenes[0].sceneEventOwnership?.ownedEvents.map((event) => event.cue)).toContain('venueDoor');
    expect(scenes[1].sceneEventOwnership?.incomingContext.map((event) => event.cue)).toContain('venueDoor');
    expect(scenes[1].sceneEventOwnership?.forbiddenRestageEvents.map((event) => event.cue)).toContain('venueDoor');
  });

  it('grants no cue ownership to a generic planner scaffold turn (bite-me 2026-07-04 s1-6)', () => {
    const scenes: SceneEventOwnershipSceneLike[] = [
      {
        id: 's1-6-release',
        kind: 'standard',
        turnContract: {
          turnId: 's1-6-turn',
          source: 'planner' as const,
          centralTurn: 'Let the fallout settle into the next pressure: Kylie arrives in Bucharest with two suitcases, meets the table on the rooftop terrace, and writes the first blog post at 4am.',
          turnEvent: 'Let the fallout settle into the next pressure: Kylie arrives in Bucharest with two suitcases, meets the table on the rooftop terrace, and writes the first blog post at 4am.',
          beforeState: 'Before.',
          afterState: 'After.',
          handoff: 'Bridge forward.',
        },
      },
    ];

    attachSceneEventOwnershipProfiles(scenes);

    expect(scenes[0].sceneEventOwnership?.ownedEvents).toEqual([]);
  });

  it('demotes a non-encounter scene duplicating threatEncounter to aftermath instead of erroring (bite-me 2026-07-04 scene-4)', () => {
    const scenes: SceneEventOwnershipSceneLike[] = [
      {
        id: 's3-ambush',
        kind: 'encounter',
        isEncounter: true,
        sceneConstructionProfile: constructionProfile(
          's3-ambush',
          'In the park, rough hands grab your coat and an attacker pins you against the fence.',
        ),
      },
      {
        id: 's4-reflection',
        kind: 'standard',
        sceneConstructionProfile: constructionProfile(
          's4-reflection',
          'Rough hands grab your coat again as the memory of the attacker replays while you sit at your desk.',
        ),
      },
    ];

    const issues = attachSceneEventOwnershipProfiles(scenes);

    expect(issues.filter((issue) => issue.severity === 'error')).toEqual([]);
    expect(issues.some((issue) => issue.severity === 'warning' && issue.message.includes('Demoted duplicate ownership of threatEncounter'))).toBe(true);
    expect(scenes[0].sceneEventOwnership?.ownedEvents.map((event) => event.cue)).toContain('threatEncounter');
    expect(scenes[1].sceneEventOwnership?.ownedEvents.map((event) => event.cue)).not.toContain('threatEncounter');
    expect(scenes[1].sceneEventOwnership?.forbiddenRestageEvents.map((event) => event.cue)).toContain('threatEncounter');
  });

  it('keeps duplicate threatEncounter ownership blocking when the later scene is encounter-capable', () => {
    const scenes: SceneEventOwnershipSceneLike[] = [
      {
        id: 's3-ambush',
        kind: 'encounter',
        isEncounter: true,
        sceneConstructionProfile: constructionProfile(
          's3-ambush',
          'In the park, rough hands grab your coat and an attacker pins you against the fence.',
        ),
      },
      {
        id: 's5-second-ambush',
        kind: 'encounter',
        isEncounter: true,
        sceneConstructionProfile: constructionProfile(
          's5-second-ambush',
          'In the alley, the attacker lunges and rough hands grab your wrist before you can scream.',
        ),
      },
    ];

    const issues = attachSceneEventOwnershipProfiles(scenes);

    expect(issues.some((issue) => issue.severity === 'error' && issue.message.includes('threatEncounter'))).toBe(true);
  });

  it('blocks out-of-order route event ownership before prose generation', () => {
    const scenes: SceneEventOwnershipSceneLike[] = [
      {
        id: 's1',
        turnContract: {
          turnId: 's1-turn',
          source: 'treatment' as const,
          centralTurn: 'The protagonist meets the group at a rooftop bar.',
          turnEvent: 'The protagonist meets the group at a rooftop bar.',
          beforeState: 'Alone.',
          afterState: 'Known.',
          handoff: 'Carry social pressure forward.',
        },
      },
      {
        id: 's2',
        turnContract: {
          turnId: 's2-turn',
          source: 'treatment' as const,
          centralTurn: 'A courier hands over a private club key card at the side entrance.',
          turnEvent: 'A courier hands over a private club key card at the side entrance.',
          beforeState: 'Outside.',
          afterState: 'Access changes.',
          handoff: 'Carry access forward.',
        },
      },
    ];

    const issues = attachSceneEventOwnershipProfiles(scenes);

    expect(issues.some((issue) => issue.message.includes('out of order'))).toBe(true);
  });

  it('does not resurrect construction-routed raw beats as owned scene events', () => {
    const scenes: SceneEventOwnershipSceneLike[] = [
      {
        id: 's1',
        sceneConstructionProfile: constructionProfile('s1', 'The traveler arrives in the city with two suitcases and an old address.'),
        requiredBeats: [
          {
            id: 'routed-blog-aftermath',
            tier: 'coldopen',
            mustDepict: 'By evening, the anonymous post has gone viral and the dashboard keeps climbing.',
            sourceTurn: 'By evening, the anonymous post has gone viral and the dashboard keeps climbing.',
          },
        ],
      },
      {
        id: 's2',
        sceneConstructionProfile: constructionProfile('s2', 'The traveler meets the table at the rooftop bar.'),
      },
    ];

    const issues = attachSceneEventOwnershipProfiles(scenes);

    expect(issues).toEqual([]);
    expect(scenes[0].sceneEventOwnership?.ownedEvents.map((event) => event.cue)).toEqual(['arrival']);
  });

  it('uses canonical chronology keys so helper scenes preserve their event ownership', () => {
    const scenes: SceneEventOwnershipSceneLike[] = [
      {
        id: 's1-arrival-cold-open',
        ownedChronologyKeys: ['arrival'],
        sceneConstructionProfile: constructionProfile(
          's1-arrival-cold-open',
          'Her old address is the only thing that makes the city feel possible.',
          [
            {
              source: 'sceneTurn',
              id: 's1-arrival-cold-open-turn',
              slot: 'primary_turn',
              text: 'Her old address is the only thing that makes the city feel possible.',
              reason: 'One scene, one dramatic turn.',
              hardUnits: 1,
              softUnits: 0,
            },
            {
              source: 'requiredBeat',
              id: 'social-support',
              slot: 'must_support',
              text: 'The traveler meets the table at the rooftop bar.',
              reason: 'Support pressure.',
              hardUnits: 0,
              softUnits: 0,
            },
          ],
        ),
      },
      {
        id: 's1-1',
        sceneConstructionProfile: constructionProfile('s1-1', 'The traveler arrives in the city with two suitcases.'),
      },
    ];

    const issues = attachSceneEventOwnershipProfiles(scenes);

    expect(issues).toEqual([]);
    expect(scenes[0].sceneEventOwnership?.ownedEvents.map((event) => event.cue)).toEqual(['arrival']);
    expect(scenes[1].sceneEventOwnership?.ownedEvents.map((event) => event.cue)).toEqual(['arrival']);
  });

  it('ignores earlier cues in broad support text when the primary scene event is later', () => {
    const scenes: SceneEventOwnershipSceneLike[] = [
      {
        id: 's1',
        sceneConstructionProfile: constructionProfile('s1', 'The traveler arrives in the city with two suitcases and an old address.'),
      },
      {
        id: 's2',
        sceneConstructionProfile: constructionProfile(
          's2',
          'The traveler meets the table at the rooftop bar.',
          [
            {
              source: 'sceneTurn',
              id: 's2-turn',
              slot: 'primary_turn',
              text: 'The traveler meets the table at the rooftop bar.',
              reason: 'One scene, one dramatic turn.',
              hardUnits: 1,
              softUnits: 0,
            },
            {
              source: 'treatmentField',
              id: 'broad-setup',
              slot: 'must_support',
              text: 'The traveler arrives in the city with two suitcases, then meets a new circle at a rooftop bar.',
              reason: 'Support text from a broad treatment sentence.',
              hardUnits: 0.5,
              softUnits: 0,
            },
          ],
        ),
      },
    ];

    const issues = attachSceneEventOwnershipProfiles(scenes);

    expect(issues).toEqual([]);
    expect(scenes[1].sceneEventOwnership?.ownedEvents.map((event) => event.cue)).toEqual(['socialMeet']);
  });

  it('does not let broad support text own later threat or blog events', () => {
    const scenes: SceneEventOwnershipSceneLike[] = [
      {
        id: 's1-arrival',
        sceneConstructionProfile: constructionProfile(
          's1-arrival',
          'The traveler arrives in the city with two suitcases and an old address.',
          [
            {
              source: 'sceneTurn',
              id: 's1-arrival-turn',
              slot: 'primary_turn',
              text: 'The traveler arrives in the city with two suitcases and an old address.',
              reason: 'One scene, one dramatic turn.',
              hardUnits: 1,
              softUnits: 0,
            },
            {
              source: 'mechanicPressure',
              id: 'episode-summary-pressure',
              slot: 'must_support',
              text: 'The traveler arrives in the city, meets a new circle at a rooftop bar, is attacked in the park, writes a post at 4am, and goes viral by evening.',
              reason: 'Broad episode pressure.',
              hardUnits: 0.25,
              softUnits: 0,
            },
          ],
        ),
      },
      {
        id: 's1-park',
        isEncounter: true,
        sceneConstructionProfile: constructionProfile(
          's1-park',
          'In the park, an attacker corners the traveler before help arrives.',
        ),
      },
      {
        id: 's1-blog',
        sceneConstructionProfile: constructionProfile(
          's1-blog',
          'At 4am the traveler writes the first anonymous public post under a codename.',
        ),
      },
    ];

    const issues = attachSceneEventOwnershipProfiles(scenes);

    expect(issues).toEqual([]);
    expect(scenes[0].sceneEventOwnership?.ownedEvents.map((event) => event.cue)).toEqual(['arrival']);
    expect(scenes[1].sceneEventOwnership?.ownedEvents.map((event) => event.cue)).toEqual(['threatEncounter']);
    expect(scenes[2].sceneEventOwnership?.ownedEvents.map((event) => event.cue)).toEqual(['lateNightWriting']);
  });

  it('allows concrete non-abstract support only when it matches the primary turn cue', () => {
    const scenes: SceneEventOwnershipSceneLike[] = [
      {
        id: 's1-social',
        sceneConstructionProfile: constructionProfile(
          's1-social',
          'The traveler meets the new circle at the rooftop bar.',
          [
            {
              source: 'sceneTurn',
              id: 's1-social-turn',
              slot: 'primary_turn',
              text: 'The traveler meets the new circle at the rooftop bar.',
              reason: 'One scene, one dramatic turn.',
              hardUnits: 1,
              softUnits: 0,
            },
            {
              source: 'requiredBeat',
              id: 'same-social-detail',
              slot: 'must_support',
              text: 'At the rooftop bar, the group gathers around the traveler.',
              reason: 'Concrete same-turn support.',
              hardUnits: 0,
              softUnits: 0,
            },
          ],
        ),
      },
    ];

    const issues = attachSceneEventOwnershipProfiles(scenes);

    expect(issues).toEqual([]);
    expect(scenes[0].sceneEventOwnership?.ownedEvents.map((event) => event.cue)).toEqual(['socialMeet']);
  });

  it('does not let stale raw turn text override a normalized construction profile', () => {
    const scenes: SceneEventOwnershipSceneLike[] = [
      {
        id: 's1-writing',
        sceneConstructionProfile: constructionProfile(
          's1-writing',
          'At 4am the protagonist writes the first anonymous public post under a codename.',
        ),
        turnContract: {
          turnId: 's1-writing-turn',
          source: 'treatment' as const,
          centralTurn: 'At 4am the protagonist writes the first anonymous public post under a codename, and by evening the post has gone viral.',
          turnEvent: 'At 4am the protagonist writes the first anonymous public post under a codename, and by evening the post has gone viral.',
          beforeState: 'Unseen.',
          afterState: 'Public.',
          handoff: 'Carry public pressure.',
        },
      },
      {
        id: 's1-blog-aftermath',
        sceneConstructionProfile: constructionProfile(
          's1-blog-aftermath',
          'The anonymous post becomes visible public pressure as strangers react to it online.',
        ),
      },
    ];

    const issues = attachSceneEventOwnershipProfiles(scenes);

    expect(issues).toEqual([]);
    expect(scenes[0].sceneEventOwnership?.ownedEvents.map((event) => event.cue)).toEqual(['lateNightWriting']);
    expect(scenes[1].sceneEventOwnership?.ownedEvents.map((event) => event.cue)).toEqual(['blogAftermath']);
  });

  it('does not let defensive writing posture own a later concrete writing event', () => {
    const scenes: SceneEventOwnershipSceneLike[] = [
      {
        id: 's1-arrival',
        sceneConstructionProfile: constructionProfile(
          's1-arrival',
          'The protagonist arrives in the city as a wounded observer, hiding behind a codenamed blog and using writing to curate life from a safe distance.',
        ),
      },
      {
        id: 's1-threat',
        sceneConstructionProfile: constructionProfile(
          's1-threat',
          'In the park, an attacker grabs the protagonist before a stranger rescues them.',
        ),
      },
      {
        id: 's1-writing',
        sceneConstructionProfile: constructionProfile(
          's1-writing',
          'At 4am the protagonist writes the first anonymous public post under a codename.',
        ),
      },
    ];

    const issues = attachSceneEventOwnershipProfiles(scenes);

    expect(issues).toEqual([]);
    expect(scenes[0].sceneEventOwnership?.ownedEvents.map((event) => event.cue)).toEqual(['arrival']);
    expect(scenes[2].sceneEventOwnership?.ownedEvents.map((event) => event.cue)).toEqual(['lateNightWriting']);
  });

  it('does not let mismatched abstract support own a second route event', () => {
    const scenes: SceneEventOwnershipSceneLike[] = [
      {
        id: 's1-writing',
        sceneConstructionProfile: constructionProfile(
          's1-writing',
          'At 4am the protagonist writes the first anonymous public post under a codename.',
          [
            {
              source: 'sceneTurn',
              id: 's1-writing-turn',
              slot: 'primary_turn',
              text: 'At 4am the protagonist writes the first anonymous public post under a codename.',
              reason: 'One scene, one dramatic turn.',
              hardUnits: 1,
              softUnits: 0,
            },
            {
              source: 'storyCircle',
              id: 'story-circle-authored-life',
              slot: 'must_support',
              text: 'The protagonist turns the dangerous encounter into the first viral proof that they can author a new life.',
              reason: 'Story Circle contract must support the turn.',
              hardUnits: 0,
              softUnits: 0,
            },
          ],
        ),
      },
      {
        id: 's1-blog-aftermath',
        sceneConstructionProfile: constructionProfile(
          's1-blog-aftermath',
          'The anonymous post becomes visible public pressure as strangers react to it online.',
        ),
      },
    ];

    const issues = attachSceneEventOwnershipProfiles(scenes);

    expect(issues).toEqual([]);
    expect(scenes[0].sceneEventOwnership?.ownedEvents.map((event) => event.cue)).toEqual(['lateNightWriting']);
    expect(scenes[1].sceneEventOwnership?.ownedEvents.map((event) => event.cue)).toEqual(['blogAftermath']);
  });

  it('renders owned events and context separately for SceneWriter', () => {
    const scenes: SceneEventOwnershipSceneLike[] = [
      {
        id: 's1',
        turnContract: {
          turnId: 's1-turn',
          source: 'treatment' as const,
          centralTurn: 'The host hands the traveler a private club key card at the side entrance.',
          turnEvent: 'The host hands the traveler a private club key card at the side entrance.',
          beforeState: 'Outside.',
          afterState: 'Inside the threshold.',
          handoff: 'Carry access residue.',
        },
      },
      {
        id: 's2',
        turnContract: {
          turnId: 's2-turn',
          source: 'treatment' as const,
          centralTurn: 'The traveler writes the first public blog post at 4am.',
          turnEvent: 'The traveler writes the first public blog post at 4am.',
          beforeState: 'Shaken.',
          afterState: 'Public.',
          handoff: 'Carry public pressure.',
        },
      },
    ];
    attachSceneEventOwnershipProfiles(scenes);

    const prompt = buildSceneEventOwnershipPromptSection(scenes[1]);

    expect(prompt).toContain('Owned events — HARD CONTRACT');
    expect(prompt).toContain('Already happened before this scene');
    expect(prompt).toContain('Do not restage');
  });
});
