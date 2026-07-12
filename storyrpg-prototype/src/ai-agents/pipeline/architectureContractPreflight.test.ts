import { describe, expect, it } from 'vitest';
import { validateCanonicalEpisodeSceneOrder, validateEpisodeArchitectureContract } from './architectureContractPreflight';

describe('validateEpisodeArchitectureContract', () => {
  it('rejects relationship labels that contradict the scene pacing contract', () => {
    const conflicts = validateEpisodeArchitectureContract([{
      id: 's1-2',
      name: 'Stela and Kylie are friends',
      description: 'The bookshop owner declares them friends.',
      relationshipPacing: [{
        id: 'rel-stela',
        source: 'treatment',
        npcId: 'stela',
        startStage: 'unmet',
        targetStage: 'spark',
        allowedLabels: ['spark', 'invitation'],
        blockedLabels: ['friend'],
        requiredEvidence: [],
        minScenesSinceIntroduction: 0,
        maxDeltaThisScene: 8,
        mechanicDimensions: ['trust'],
      }],
    }]);

    expect(conflicts.map((conflict) => conflict.code)).toContain('PLAN_RELATIONSHIP_STAGE_CONTRADICTION');
  });

  it('rejects meaningful action planned across multiple major locations', () => {
    const conflicts = validateEpisodeArchitectureContract([{
      id: 's1-2',
      location: 'Lumina Books',
      locations: ['Lumina Books', 'Valescu Club'],
      description: 'Stela introduces Kylie to the Valescu Club nightlife.',
      sceneEventOwnership: {
        id: 's1-2-event-ownership',
        episodeNumber: 1,
        sceneId: 's1-2',
        ownedEvents: [],
        priorEventsWithinEpisode: [],
        localAftermathEvents: [],
        forbiddenRestageEvents: [],
        sourceContractIds: ['treatment:scene:s1-2'],
        diagnostics: [],
        promptGuidance: [],
      },
      relationshipPacing: [],
    }]);

    expect(conflicts.map((conflict) => conflict.code)).toContain('PLAN_MULTI_LOCATION_SCENE');
  });

  it('does not treat an authored befriend action or downstream venue mention as settled membership or physical staging', () => {
    const conflicts = validateEpisodeArchitectureContract([{
      id: 's1-2',
      location: 'Lumina Books',
      description: 'Stela befriends Kylie and introduces her to Valescu Club.',
      requiredBeats: [{
        id: 's1-2-rb1',
        sourceTurn: 'Stela befriends Kylie and introduces her to Valescu Club.',
        mustDepict: 'Stela befriends Kylie and introduces her to Valescu Club.',
        tier: 'authored',
      }],
      sceneEventOwnership: {
        id: 's1-2-event-ownership',
        episodeNumber: 1,
        sceneId: 's1-2',
        ownedEvents: [],
        priorEventsWithinEpisode: [],
        localAftermathEvents: [],
        forbiddenRestageEvents: [],
        sourceContractIds: ['treatment:scene:s1-2'],
        diagnostics: [],
        promptGuidance: [],
      },
      relationshipPacing: [{
        id: 's1-2-rel-stela',
        source: 'treatment',
        npcId: 'stela',
        startStage: 'unmet',
        targetStage: 'spark',
        allowedLabels: ['spark', 'new acquaintance'],
        blockedLabels: ['friend', 'friends'],
        requiredEvidence: [],
        minScenesSinceIntroduction: 1,
        maxDeltaThisScene: 8,
        mechanicDimensions: ['trust'],
      }],
    }]);

    expect(conflicts).toEqual([]);
  });

  it('rejects encounter source synopsis copied into its authored description', () => {
    const source = 'Walking home through the park, she is attacked and rescued.';
    const conflicts = validateEpisodeArchitectureContract([{
      id: 'enc-1',
      kind: 'encounter',
      isEncounter: true,
      encounter: { description: source, sourceSynopsis: source },
    }]);

    expect(conflicts.map((conflict) => conflict.code)).toContain('PLAN_READER_TEXT_SOURCE_LEAK');
  });

  it('rejects group milestone and pacing target-stage drift', () => {
    const conflicts = validateEpisodeArchitectureContract([{
      id: 's1-4',
      relationshipPacing: [{
        id: 'rel-group',
        source: 'choice',
        groupId: 'dusk-club',
        startStage: 'unmet',
        targetStage: 'spark',
        allowedLabels: ['provisional circle'],
        blockedLabels: [],
        requiredEvidence: [],
        minScenesSinceIntroduction: 1,
        maxDeltaThisScene: 6,
        mechanicDimensions: ['trust'],
        milestone: {
          id: 'milestone-dusk-club',
          kind: 'group_formation',
          sourceText: 'The three become friends.',
          subjectType: 'group',
          subjectId: 'dusk-club',
          targetStage: 'friend',
          introductionSceneIds: ['s1-2'],
          testSceneIds: ['s1-3'],
          choiceSceneId: 's1-4',
          memberNpcIds: ['mika'],
          requiredEvidenceTags: ['respected_agency'],
        },
      }],
    }]);

    expect(conflicts.map((conflict) => conflict.code)).toContain('PLAN_MILESTONE_STAGE_CONFLICT');
  });

  it('rejects a blueprint that omits a locked authored scene', () => {
    const conflicts = validateCanonicalEpisodeSceneOrder(
      [{ id: 's1-1' }, { id: 's1-2' }, { id: 's1-7' }],
      { sceneOrder: ['s1-1', 's1-2', 's1-6', 's1-7'] },
    );
    expect(conflicts[0]).toMatchObject({
      code: 'PLAN_SCENE_ORDER_DRIFT',
      sceneId: 's1-6',
    });
    expect(conflicts[0]?.message).toContain('s1-6');
  });

  it('rejects distinct scene ids that duplicate the same planned dramatic turn', () => {
    const conflicts = validateEpisodeArchitectureContract([
      {
        id: 's1-5',
        name: 'Rooftop watchers',
        description: 'After the club, Kylie notices a man in a charcoal suit and another man watching him.',
        location: 'Valescu rooftop',
        turnContract: {
          turnId: 's1-5-turn', source: 'treatment', centralTurn: 'Kylie notices two men watching on the rooftop.',
          beforeState: 'Kylie enjoys the party.', turnEvent: 'Kylie notices two men watching.', afterState: 'Kylie is being watched.', handoff: 'The night turns dangerous.',
        },
        narrativeEventIds: ['ep1-watchers'],
        narrativeEventPlanVersion: 3,
      },
      {
        id: 's1-6',
        name: 'A second rooftop look',
        description: 'On the rooftop after the club, Kylie notices the charcoal-suited man and another man watching him.',
        location: 'Valescu rooftop',
        turnContract: {
          turnId: 's1-6-turn', source: 'planner', centralTurn: 'Kylie notices two men watching on the rooftop.',
          beforeState: 'Kylie enjoys the party.', turnEvent: 'Kylie notices two men watching.', afterState: 'Kylie is being watched.', handoff: 'The night turns dangerous.',
        },
        narrativeEventIds: ['ep1-watchers'],
        narrativeEventPlanVersion: 3,
      },
    ]);

    expect(conflicts.some((conflict) => conflict.code === 'PLAN_DUPLICATE_SCENE_TURN')).toBe(true);
  });

  it('uses high-confidence semantic overlap as a duplicate fallback when event ids drift', () => {
    const conflicts = validateEpisodeArchitectureContract([
      {
        id: 's1-5',
        name: 'Rooftop watchers',
        description: 'Kylie notices two men watching on the rooftop after the club.',
        location: 'Valescu rooftop',
        turnContract: {
          centralTurn: 'Kylie notices two men watching on the rooftop.',
          turnEvent: 'Kylie notices two men watching.',
        },
        narrativeEventPlanVersion: 3,
      },
      {
        id: 's1-6',
        name: 'Rooftop watchers',
        description: 'Kylie notices two men watching on the rooftop after the club.',
        location: 'Valescu rooftop',
        turnContract: {
          centralTurn: 'Kylie notices two men watching on the rooftop.',
          turnEvent: 'Kylie notices two men watching.',
        },
        narrativeEventPlanVersion: 3,
      },
    ]);

    expect(conflicts.some((conflict) => conflict.code === 'PLAN_DUPLICATE_SCENE_TURN')).toBe(true);
  });
});
