import { describe, expect, it } from 'vitest';
import { SceneOwnershipPreflightValidator, type SceneOwnershipPreflightScene } from './SceneOwnershipPreflightValidator';

function scene(overrides: Partial<SceneOwnershipPreflightScene>): SceneOwnershipPreflightScene {
  return {
    id: overrides.id ?? 's1-1',
    episodeNumber: overrides.episodeNumber ?? 1,
    order: overrides.order ?? 0,
    kind: overrides.kind ?? 'standard',
    title: overrides.title ?? 'Scene',
    dramaticPurpose: overrides.dramaticPurpose ?? 'The protagonist faces pressure.',
    locations: overrides.locations ?? ['Station'],
    requiredBeats: overrides.requiredBeats,
    treatmentAtomIds: overrides.treatmentAtomIds,
    ownedChronologyKeys: overrides.ownedChronologyKeys,
    storyCircleBeatContracts: overrides.storyCircleBeatContracts,
    coldOpenProfile: overrides.coldOpenProfile,
    turnContract: overrides.turnContract,
    sceneEventOwnership: overrides.sceneEventOwnership,
    sceneConstructionProfile: overrides.sceneConstructionProfile,
    spineUnitId: overrides.spineUnitId,
  };
}

describe('SceneOwnershipPreflightValidator', () => {
  it('blocks duplicate primary treatment atom ownership', () => {
    const result = new SceneOwnershipPreflightValidator().validate({
      episodeNumber: 1,
      scenes: [
        scene({ id: 's1-1', treatmentAtomIds: ['atom-1'] }),
        scene({ id: 's1-2', order: 1, treatmentAtomIds: ['atom-1'] }),
      ],
    });

    expect(result.valid).toBe(false);
    expect(result.issues.map((issue) => issue.message).join(' ')).toContain('multiple primary scene owners');
  });

  it('blocks ESC prerequisite inversions before prose generation', () => {
    const result = new SceneOwnershipPreflightValidator().validate({
      episodeNumber: 1,
      episodeSpine: {
        episodeNumber: 1,
        sourceHash: 'fixture',
        episodeStoryCircleBeats: ['you'],
        polarityFacets: [],
        units: [
          {
            id: 'write-post',
            order: 0,
            text: 'At 4am she writes the post.',
            kind: 'late_night_writing',
            storyCircleFacets: ['you'],
            prerequisites: [],
            sceneKind: 'standard',
          },
          {
            id: 'viral-aftermath',
            order: 1,
            text: 'By evening the post has gone viral.',
            kind: 'aftermath',
            storyCircleFacets: ['you'],
            prerequisites: ['write-post'],
            sceneKind: 'standard',
          },
        ],
      },
      scenes: [
        scene({ id: 'aftermath', order: 0, spineUnitId: 'viral-aftermath' }),
        scene({ id: 'writing', order: 1, spineUnitId: 'write-post' }),
      ],
    });

    expect(result.valid).toBe(false);
    expect(result.issues.map((issue) => issue.message).join(' ')).toContain('ESC causal inversion');
  });

  it('blocks aftermath ownership before its causal event owner', () => {
    const result = new SceneOwnershipPreflightValidator().validate({
      episodeNumber: 1,
      scenes: [
        scene({
          id: 'viral',
          order: 0,
          sceneEventOwnership: ownership('viral', 'blogAftermath', 'The post has already gone viral.'),
        }),
        scene({
          id: 'writing',
          order: 1,
          sceneEventOwnership: ownership('writing', 'lateNightWriting', 'At 4am she writes the first post.'),
        }),
      ],
    });

    expect(result.valid).toBe(false);
    expect(result.issues.map((issue) => issue.message).join(' ')).toContain('before its prerequisite event lateNightWriting');
  });

  it('accepts canonical causal events ordered within one scene', () => {
    const writing = ownership('writing', 'lateNightWriting', 'At 4am she writes the first post.');
    const aftermath = ownership('writing', 'blogAftermath', 'By evening the post has gone viral.');
    writing.ownedEvents[0].eventContractId = 'event:writing';
    aftermath.ownedEvents[0].eventContractId = 'event:aftermath';
    writing.ownedEvents.push(aftermath.ownedEvents[0]);
    const result = new SceneOwnershipPreflightValidator().validate({
      episodeNumber: 1,
      episodeEventPlan: {
        orderedEventIds: ['event:writing', 'event:aftermath'],
        assignments: [
          { eventId: 'event:writing', sceneId: 'writing' },
          { eventId: 'event:aftermath', sceneId: 'writing' },
        ],
      },
      scenes: [scene({ id: 'writing', sceneEventOwnership: writing })],
    });

    expect(result.valid).toBe(true);
  });

  it('blocks duplicate first-event ownership', () => {
    const result = new SceneOwnershipPreflightValidator().validate({
      episodeNumber: 1,
      scenes: [
        scene({
          id: 'first-sighting',
          order: 0,
          sceneEventOwnership: ownership('first-sighting', 'antagonistContact', 'She first sees the watcher across the bar.'),
        }),
        scene({
          id: 'duplicate-sighting',
          order: 1,
          sceneEventOwnership: ownership('duplicate-sighting', 'antagonistContact', 'For the first time, she spots the watcher outside.'),
        }),
      ],
    });

    expect(result.valid).toBe(false);
    expect(result.issues.map((issue) => issue.message).join(' ')).toContain('duplicates first-event ownership');
  });

  it('blocks non-opening cold-open required beats', () => {
    const result = new SceneOwnershipPreflightValidator().validate({
      episodeNumber: 1,
      scenes: [
        scene({ id: 's1-open', order: 0, coldOpenProfile: { storyCircleBeats: ['you'] } }),
        scene({
          id: 's1-later',
          order: 1,
          requiredBeats: [{
            id: 'cold-open-leak',
            tier: 'coldopen',
            sourceTurn: 'The protagonist arrives at the station.',
            mustDepict: 'The protagonist arrives at the station.',
          }],
        }),
      ],
    });

    expect(result.valid).toBe(false);
    expect(result.issues.map((issue) => issue.message).join(' ')).toContain('cold-open required beat');
  });

  it('blocks concrete encounter cues on non-encounter scenes', () => {
    const result = new SceneOwnershipPreflightValidator().validate({
      episodeNumber: 1,
      scenes: [
        scene({
          id: 's1-threat-summary',
          requiredBeats: [{
            id: 'threat',
            tier: 'authored',
            sourceTurn: 'In the park, an attacker attacks the protagonist.',
            mustDepict: 'In the park, an attacker attacks the protagonist.',
          }],
        }),
      ],
    });

    expect(result.valid).toBe(false);
    expect(result.issues.map((issue) => issue.message).join(' ')).toContain('encounter/threat cue');
  });

  it('allows concrete encounter cues on encounter-capable scenes', () => {
    const result = new SceneOwnershipPreflightValidator().validate({
      episodeNumber: 1,
      scenes: [
        scene({
          id: 's1-threat',
          kind: 'encounter',
          requiredBeats: [{
            id: 'threat',
            tier: 'authored',
            sourceTurn: 'In the park, an attacker attacks the protagonist.',
            mustDepict: 'In the park, an attacker attacks the protagonist.',
          }],
        }),
      ],
    });

    expect(result.valid).toBe(true);
  });

  it('blocks abstract encounter shells when a concrete encounter owner exists', () => {
    const result = new SceneOwnershipPreflightValidator().validate({
      episodeNumber: 1,
      scenes: [
        scene({
          id: 's1-threat',
          order: 0,
          kind: 'encounter',
          sceneEventOwnership: {
            id: 's1-threat-events',
            episodeNumber: 1,
            sceneId: 's1-threat',
            ownedEvents: [{
              key: 'cue:threatEncounter',
              cue: 'threatEncounter',
              text: 'An attacker corners the protagonist in the park.',
              sourceContractIds: ['atom-threat'],
            }],
            incomingContext: [],
            outgoingResidue: [],
            forbiddenRestageEvents: [],
            sourceContractIds: ['atom-threat'],
            diagnostics: [],
            promptGuidance: [],
          },
        }),
        scene({
          id: 's1-abstract-encounter',
          order: 1,
          kind: 'encounter',
          dramaticPurpose: 'Can the protagonist accept the cost of starting over?',
          turnContract: {
            turnId: 'abstract-turn',
            source: 'encounter',
            centralTurn: 'Can the protagonist accept the cost of starting over?',
            beforeState: 'Unsettled.',
            turnEvent: 'Can the protagonist accept the cost?',
            afterState: 'Still unresolved.',
            handoff: 'The pressure lingers.',
          },
          sceneEventOwnership: {
            id: 's1-abstract-events',
            episodeNumber: 1,
            sceneId: 's1-abstract-encounter',
            ownedEvents: [],
            incomingContext: [],
            outgoingResidue: [],
            forbiddenRestageEvents: [],
            sourceContractIds: [],
            diagnostics: [],
            promptGuidance: [],
          },
        }),
      ],
    });

    expect(result.valid).toBe(false);
    expect(result.issues.map((issue) => issue.message).join(' ')).toContain('abstract encounter shell');
  });

  it('allows an encounter shell when it owns a distinct playable event', () => {
    const result = new SceneOwnershipPreflightValidator().validate({
      episodeNumber: 1,
      scenes: [
        scene({
          id: 's1-threat',
          order: 0,
          kind: 'encounter',
          sceneEventOwnership: {
            id: 's1-threat-events',
            episodeNumber: 1,
            sceneId: 's1-threat',
            ownedEvents: [{
              key: 'cue:threatEncounter',
              cue: 'threatEncounter',
              text: 'An attacker corners the protagonist in the park.',
              sourceContractIds: ['atom-threat'],
            }],
            incomingContext: [],
            outgoingResidue: [],
            forbiddenRestageEvents: [],
            sourceContractIds: ['atom-threat'],
            diagnostics: [],
            promptGuidance: [],
          },
        }),
        scene({
          id: 's1-social-encounter',
          order: 1,
          kind: 'encounter',
          treatmentAtomIds: ['atom-social'],
          requiredBeats: [{
            id: 'social',
            tier: 'authored',
            sourceTurn: 'The protagonist meets a guide and is invited inside.',
            mustDepict: 'The protagonist meets a guide and is invited inside.',
          }],
        }),
      ],
    });

    expect(result.valid).toBe(true);
  });

  it('collapses location aliases before multi-location blocking', () => {
    const result = new SceneOwnershipPreflightValidator().validate({
      episodeNumber: 1,
      scenes: [
        scene({
          id: 's1-park',
          locations: ['Cismigiu Gardens'],
          requiredBeats: [{
            id: 'park-action',
            tier: 'authored',
            sourceTurn: 'Through Cismigiu, the protagonist notices a shadow.',
            mustDepict: 'Through Cismigiu, the protagonist notices a shadow.',
          }],
        }),
      ],
    });

    expect(result.issues.map((issue) => issue.message).join(' ')).not.toContain('multiple major location');
  });

  it('treats a qualified location label as one spatial anchor', () => {
    // Live FP (Phase 7 smoke, 2026-07-01): a label like "Rooftop bar in
    // Lipscani" was mined for two major cues even though it declares one place.
    const result = new SceneOwnershipPreflightValidator().validate({
      episodeNumber: 1,
      scenes: [
        scene({
          id: 's1-bar',
          locations: ['Rooftop bar in Lipscani'],
          requiredBeats: [{
            id: 'bar-action',
            tier: 'authored',
            sourceTurn: 'At a rooftop bar she catches the attention of a stranger.',
            mustDepict: 'At a rooftop bar she catches the attention of a stranger.',
          }],
        }),
      ],
    });

    expect(result.issues.map((issue) => issue.message).join(' ')).not.toContain('multiple major location');
  });

  it('allows a second location cue when the scene owns a movement event (arrival spans endpoints)', () => {
    const movementScene = scene({
      id: 's1-arrive',
      locations: ['Valescu Club'],
      sceneEventOwnership: {
        id: 'own-s1-arrive',
        sceneId: 's1-arrive',
        ownedEvents: [{ key: 'arrival-club', cue: 'arrival', text: 'She arrives at the club.', sourceContractIds: [] }],
        incomingContext: [],
        outgoingResidue: [],
        forbiddenRestageEvents: [],
        sourceContractIds: [],
        diagnostics: [],
        promptGuidance: [],
      },
      requiredBeats: [{
        id: 'arrive-action',
        tier: 'authored',
        sourceTurn: 'From Cismigiu Gardens she walks until she arrives at Valescu Club, where the doorman waves her in.',
        mustDepict: 'From Cismigiu Gardens she walks until she arrives at Valescu Club, where the doorman waves her in.',
      }],
    });

    const withCue = new SceneOwnershipPreflightValidator().validate({ episodeNumber: 1, scenes: [movementScene] });
    expect(withCue.issues.map((issue) => issue.message).join(' ')).not.toContain('multiple major location');

    const withoutCue = new SceneOwnershipPreflightValidator().validate({
      episodeNumber: 1,
      scenes: [scene({ ...movementScene, sceneEventOwnership: undefined })],
    });
    expect(withoutCue.issues.map((issue) => issue.message).join(' ')).toContain('multiple major location');
  });

  it('treats city cues as containers rather than conflicting locations', () => {
    const result = new SceneOwnershipPreflightValidator().validate({
      episodeNumber: 1,
      scenes: [
        scene({
          id: 's1-club',
          locations: ['Valcescu Club'],
          requiredBeats: [{
            id: 'club-action',
            tier: 'authored',
            sourceTurn: 'In Bucharest, the protagonist enters the Valcescu Club.',
            mustDepict: 'In Bucharest, the protagonist enters the Valcescu Club.',
          }],
        }),
      ],
    });

    expect(result.issues.map((issue) => issue.message).join(' ')).not.toContain('multiple major location');
  });

  it('requires the episode Story Circle role to have a scene owner', () => {
    const result = new SceneOwnershipPreflightValidator().validate({
      episodeNumber: 1,
      storyCircleRole: [{ beat: 'need', roleKind: 'primary' }],
      scenes: [scene({ id: 's1-open' })],
    });

    expect(result.valid).toBe(false);
    expect(result.issues.map((issue) => issue.message).join(' ')).toContain('Story Circle role "need"');
  });
});

function ownership(
  sceneId: string,
  cue: NonNullable<SceneOwnershipPreflightScene['sceneEventOwnership']>['ownedEvents'][number]['cue'],
  text: string,
): NonNullable<SceneOwnershipPreflightScene['sceneEventOwnership']> {
  return {
    id: `${sceneId}-ownership`,
    episodeNumber: 1,
    sceneId,
    ownedEvents: [{ key: `cue:${cue}`, cue, text, sourceContractIds: [`${sceneId}-contract`] }],
    incomingContext: [],
    outgoingResidue: [],
    forbiddenRestageEvents: [],
    sourceContractIds: [`${sceneId}-contract`],
    diagnostics: [],
    promptGuidance: [],
  };
}
