import { describe, expect, it } from 'vitest';
import type { PlannedScene } from '../../types/scenePlan';
import { finalizeEpisodeSceneOwnership } from './episodeSceneOwnership';
import { attachSceneConstructionProfiles, buildSceneConstructionProfileSection } from './sceneConstructionProfile';

function scene(overrides: Partial<PlannedScene>): PlannedScene {
  return {
    id: overrides.id ?? 's1-1',
    episodeNumber: overrides.episodeNumber ?? 1,
    order: overrides.order ?? 0,
    kind: overrides.kind ?? 'standard',
    title: overrides.title ?? 'Opening',
    dramaticPurpose: overrides.dramaticPurpose ?? 'The protagonist reaches the threshold under pressure.',
    narrativeRole: overrides.narrativeRole ?? 'setup',
    locations: overrides.locations ?? ['Station'],
    npcsInvolved: overrides.npcsInvolved ?? [],
    timeOfDay: overrides.timeOfDay,
    setsUp: [],
    paysOff: [],
    requiredBeats: overrides.requiredBeats,
    storyCircleBeatContracts: overrides.storyCircleBeatContracts,
    turnContract: overrides.turnContract,
    encounter: overrides.encounter,
  };
}

describe('episodeSceneOwnership finalizer', () => {
  it('routes non-opening cold-open beats to one scene owner and removes coldopen tier from later scenes', () => {
    const scenes = [
      scene({
        id: 's1-cold-open',
        order: 0,
        title: 'Cold open',
        dramaticPurpose: 'The protagonist arrives in the city with a private wound.',
        storyCircleBeatContracts: [{
          id: 'sc-you',
          beat: 'you',
          sourceText: 'The protagonist arrives with a visible private wound.',
          targetEpisodeNumber: 1,
          requiredRealization: ['scene_turn', 'final_prose'],
          eventAtoms: ['The protagonist arrives with a visible private wound.'],
          targetSceneIds: ['s1-cold-open'],
          blockingLevel: 'structural',
        }],
      }),
      scene({
        id: 's1-guide',
        order: 1,
        title: 'Guide meeting',
        dramaticPurpose: 'The protagonist meets a local guide who opens the next threshold.',
        requiredBeats: [{
          id: 'coldopen-guide',
          tier: 'coldopen',
          sourceTurn: 'The protagonist meets a local guide at the station.',
          mustDepict: 'The protagonist meets a local guide at the station.',
        }],
      }),
    ];

    const result = finalizeEpisodeSceneOwnership(scenes);

    expect(result.routedObligations.map((item) => item.id)).toContain('coldopen-guide');
    expect(scenes[1].requiredBeats).toBeUndefined();
    expect(scenes[0].requiredBeats?.map((beat) => beat.id)).toContain('coldopen-guide');
    expect(scenes[0].treatmentAtomIds?.length).toBeGreaterThan(0);
  });

  it('assigns concrete encounter atoms to encounter scenes instead of standard setup scenes', () => {
    const scenes = [
      scene({
        id: 's1-setup',
        order: 0,
        title: 'Setup',
        dramaticPurpose: 'The protagonist hears rumors before walking toward danger.',
        requiredBeats: [{
          id: 'misbound-threat',
          tier: 'authored',
          sourceTurn: 'In the park at night, an attacker attacks the protagonist before help arrives.',
          mustDepict: 'In the park at night, an attacker attacks the protagonist before help arrives.',
        }],
      }),
      scene({
        id: 's1-encounter',
        order: 1,
        kind: 'encounter',
        title: 'Park threat',
        dramaticPurpose: 'In the park at night, the protagonist is attacked and must survive.',
        locations: ['Park'],
        encounter: {
          type: 'combat',
          difficulty: 'moderate',
          relevantSkills: ['notice'],
          description: 'An attacker corners the protagonist in the park.',
          isBranchPoint: true,
        },
      }),
    ];

    finalizeEpisodeSceneOwnership(scenes);

    expect(scenes[1].treatmentAtomIds?.length).toBeGreaterThan(0);
    expect(scenes[0].sourceContextIds?.length).toBeGreaterThan(0);
    expect(scenes[0].requiredBeats).toBeUndefined();
    expect((scenes[1] as unknown as { encounterStakes?: string }).encounterStakes).toContain('immediate safety');
    expect((scenes[1] as unknown as { encounterBuildup?: string }).encounterBuildup).toContain('personal');
    expect((scenes[1] as unknown as { encounterBeatPlan?: string[] }).encounterBeatPlan?.length).toBeGreaterThanOrEqual(3);
  });

  it('drops required beats whose id belongs to another episode (bite-me 2026-07-02 cross-episode bleed)', () => {
    const scenes = [
      scene({
        id: 's1-1',
        order: 0,
        title: 'Opening',
        requiredBeats: [
          {
            id: 's1-1-rb1',
            tier: 'authored',
            sourceTurn: 'The protagonist arrives in the city.',
            mustDepict: 'The protagonist arrives in the city.',
          },
          {
            id: 's3-4-rb1',
            tier: 'authored',
            sourceTurn: 'Victor gently frames the blog as a privacy problem.',
            mustDepict: 'Victor gently frames the blog as a privacy problem.',
          },
          {
            id: 's2-2-rb1-action-1',
            tier: 'authored',
            sourceTurn: 'The blog becomes a real local curiosity.',
            mustDepict: 'The blog becomes a real local curiosity.',
          },
        ],
      }),
      scene({ id: 's1-2', order: 1, title: 'Development' }),
    ];

    const result = finalizeEpisodeSceneOwnership(scenes, { episodeNumber: 1 });

    const beatIds = (scenes[0].requiredBeats ?? []).map((beat) => beat.id);
    expect(beatIds).toContain('s1-1-rb1');
    expect(beatIds).not.toContain('s3-4-rb1');
    expect(beatIds).not.toContain('s2-2-rb1-action-1');
    expect(result.diagnostics.filter((diag) => diag.reason.includes('belongs to episode'))).toHaveLength(2);
  });

  it('keeps threat atoms off an opening scene whose stakes/purpose quote the episode synopsis (bite-me 2026-07-02)', () => {
    // The deterministic skeleton copies the whole-episode synopsis into every
    // standard scene's stakes and composed purpose. Threat cues in that shared
    // text must NOT make the opening scene a threat owner — the attack atom
    // belongs to the scene whose own TURN dramatizes it.
    const synopsis = 'The protagonist arrives in the city with two suitcases. '
      + 'Walking home through the park, she is attacked and rescued by a stranger. '
      + 'At 4am she turns the night into her first post.';
    const attackTurn = 'Walking home through the park, she is attacked and rescued by a stranger.';
    const opening = scene({
      id: 's1-1',
      order: 0,
      title: 'setup scene 1',
      dramaticPurpose: `setup — ${synopsis}`,
      turnContract: {
        turnId: 's1-1-turn',
        source: 'planner',
        centralTurn: 'The protagonist arrives in the city with two suitcases.',
        beforeState: 'Before the turn.',
        turnEvent: 'The protagonist arrives in the city with two suitcases.',
        afterState: 'After the turn.',
        handoff: 'Carry the arrival forward.',
      },
    });
    opening.stakes = synopsis;
    const attackScene = scene({
      id: 's1-3',
      order: 1,
      title: 'development scene 3',
      narrativeRole: 'development',
      dramaticPurpose: `development — ${synopsis}`,
      locations: ['Park'],
      turnContract: {
        turnId: 's1-3-turn',
        source: 'planner',
        centralTurn: attackTurn,
        beforeState: 'Before the turn.',
        turnEvent: attackTurn,
        afterState: 'After the turn.',
        handoff: 'Carry the rescue forward.',
      },
      requiredBeats: [{
        id: 'attack-turn',
        tier: 'authored',
        sourceTurn: attackTurn,
        mustDepict: attackTurn,
      }],
    });
    attackScene.stakes = synopsis;
    const scenes = [opening, attackScene];

    finalizeEpisodeSceneOwnership(scenes);

    expect(scenes[0].kind).toBe('standard');
    expect((scenes[0] as unknown as { isEncounter?: boolean }).isEncounter).toBeFalsy();
    expect((scenes[0] as unknown as { encounterDescription?: string }).encounterDescription).toBeUndefined();
    expect(scenes[1].kind).toBe('encounter');
    expect(scenes[1].encounter?.description).toContain('attacked');
  });

  it('upgrades the concrete threat scene when the existing encounter owner is abstract', () => {
    const scenes = [
      scene({
        id: 's1-arrival',
        order: 0,
        title: 'Arrival',
        dramaticPurpose: 'The protagonist arrives in the city.',
      }),
      scene({
        id: 's1-walk-home',
        order: 1,
        kind: 'standard',
        title: 'Walk home',
        dramaticPurpose: 'Walking through the park, the protagonist is attacked and must survive.',
        locations: ['Park'],
        requiredBeats: [{
          id: 'live-threat',
          tier: 'authored',
          sourceTurn: 'Walking through the park, an attacker attacks the protagonist before a stranger intervenes.',
          mustDepict: 'Walking through the park, an attacker attacks the protagonist before a stranger intervenes.',
        }],
      }),
      scene({
        id: 'treatment-enc-1-1',
        order: 2,
        kind: 'encounter',
        title: 'Abstract encounter pressure',
        dramaticPurpose: 'Can the protagonist feel wanted while the city watches?',
        encounter: {
          type: 'social',
          difficulty: 'moderate',
          relevantSkills: ['composure'],
          description: 'Can the protagonist feel wanted while the city watches?',
          centralConflict: 'Can the protagonist feel wanted while the city watches?',
          isBranchPoint: true,
        },
      }),
    ];

    finalizeEpisodeSceneOwnership(scenes);

    expect(scenes[1].kind).toBe('encounter');
    expect((scenes[1] as unknown as { isEncounter?: boolean }).isEncounter).toBe(true);
    expect(scenes[1].encounter?.description).toContain('attacker attacks');
    expect(scenes[1].treatmentAtomIds?.length).toBeGreaterThan(0);
    expect((scenes[1] as unknown as { encounterStakes?: string }).encounterStakes).toContain('immediate safety');
    expect((scenes[1] as unknown as { encounterBuildup?: string }).encounterBuildup).toContain('personal');
    expect((scenes[1] as unknown as { encounterBeatPlan?: string[] }).encounterBeatPlan?.length).toBeGreaterThanOrEqual(3);
    expect(scenes[2].treatmentAtomIds ?? []).toEqual([]);
  });

  it('finalizes blueprint-like scenes using the caller episode number', () => {
    const scenes = [
      {
        id: 's1-arrival',
        kind: 'standard',
        title: 'Arrival',
        dramaticPurpose: 'The traveler arrives in the city.',
        narrativeRole: 'setup',
        locations: ['Station'],
        npcsInvolved: [],
        setsUp: [],
        paysOff: [],
      },
      {
        id: 's1-threat',
        kind: 'standard',
        title: 'Threat',
        dramaticPurpose: 'Walking through the park, the traveler is attacked and must survive.',
        narrativeRole: 'turn',
        locations: ['Park'],
        npcsInvolved: [],
        setsUp: [],
        paysOff: [],
        requiredBeats: [{
          id: 'threat',
          tier: 'authored',
          sourceTurn: 'Walking through the park, an attacker attacks the traveler before help arrives.',
          mustDepict: 'Walking through the park, an attacker attacks the traveler before help arrives.',
        }],
      },
    ] as unknown as PlannedScene[];

    finalizeEpisodeSceneOwnership(scenes, { episodeNumber: 1 });

    expect(scenes.map((item) => item.episodeNumber)).toEqual([1, 1]);
    expect(scenes.map((item) => item.order)).toEqual([0, 1]);
    expect(scenes[1].kind).toBe('encounter');
    expect((scenes[1] as unknown as { isEncounter?: boolean }).isEncounter).toBe(true);
    expect((scenes[1] as unknown as { encounterStakes?: string }).encounterStakes).toContain('immediate safety');
    expect((scenes[1] as unknown as { encounterBuildup?: string }).encounterBuildup).toContain('personal');
    expect((scenes[1] as unknown as { encounterBeatPlan?: string[] }).encounterBeatPlan?.length).toBeGreaterThanOrEqual(3);
    expect(scenes[1].treatmentAtomIds?.length).toBeGreaterThan(0);
  });

  it('keeps routed playable atoms as context only in the source scene', () => {
    const scenes = [
      scene({
        id: 's1-arrival',
        order: 0,
        title: 'Arrival',
        dramaticPurpose: 'The protagonist arrives in the city.',
        requiredBeats: [{
          id: 'broad-chain',
          tier: 'authored',
          sourceTurn: 'The protagonist arrives with two suitcases and then is attacked in the park.',
          mustDepict: 'The protagonist arrives with two suitcases and then is attacked in the park.',
        }],
      }),
      scene({
        id: 's1-park',
        order: 1,
        kind: 'standard',
        title: 'Park threat',
        dramaticPurpose: 'In the park, an attacker attacks the protagonist.',
        locations: ['Park'],
      }),
    ];

    finalizeEpisodeSceneOwnership(scenes);

    expect(scenes[0].requiredBeats).toBeUndefined();
    expect(scenes[0].sourceContextIds?.length).toBeGreaterThan(0);
    expect(scenes[1].kind).toBe('encounter');
    expect(scenes[1].treatmentAtomIds?.length).toBeGreaterThan(0);
  });

  it('is idempotent: re-finalizing the same scene graph preserves routed ownership (C2)', () => {
    const scenes = [
      scene({
        id: 's1-arrival',
        order: 0,
        title: 'Arrival',
        dramaticPurpose: 'The protagonist arrives in the city.',
        requiredBeats: [{
          id: 'broad-chain',
          tier: 'authored',
          sourceTurn: 'The protagonist arrives with two suitcases and then is attacked in the park.',
          mustDepict: 'The protagonist arrives with two suitcases and then is attacked in the park.',
        }],
      }),
      scene({
        id: 's1-park',
        order: 1,
        kind: 'standard',
        title: 'Park threat',
        dramaticPurpose: 'In the park, an attacker attacks the protagonist.',
        locations: ['Park'],
      }),
    ];

    finalizeEpisodeSceneOwnership(scenes);
    // Routed ownership landed on the park scene, and the source contract was
    // drained off the arrival scene.
    expect(scenes[1].treatmentAtomIds?.length).toBeGreaterThan(0);
    expect(scenes[0].requiredBeats).toBeUndefined();

    // Snapshot the enumerable scene state (the persisted shape) after the first
    // finalize. Before the idempotency guard, a second finalize would run
    // clearStaleOwnership and then fail to re-derive the drained atom, wiping
    // scenes[1].treatmentAtomIds to undefined.
    const afterFirst = JSON.parse(JSON.stringify(scenes));

    finalizeEpisodeSceneOwnership(scenes);

    expect(scenes[1].treatmentAtomIds?.length).toBeGreaterThan(0);
    expect(JSON.parse(JSON.stringify(scenes))).toEqual(afterFirst);

    // A third pass is also a no-op.
    finalizeEpisodeSceneOwnership(scenes);
    expect(JSON.parse(JSON.stringify(scenes))).toEqual(afterFirst);
  });

  it('feeds owned treatment atoms into the focused construction prompt', () => {
    const scenes = [
      scene({
        id: 's1-1',
        order: 0,
        requiredBeats: [{
          id: 'arrival',
          tier: 'authored',
          sourceTurn: 'The protagonist arrives at the station at dusk.',
          mustDepict: 'The protagonist arrives at the station at dusk.',
        }],
      }),
    ];

    finalizeEpisodeSceneOwnership(scenes);
    attachSceneConstructionProfiles(scenes);
    const prompt = buildSceneConstructionProfileSection(scenes[0]);

    expect(prompt).toContain('treatmentAtom');
    expect(prompt).toContain('Primary turn');
    expect(prompt).not.toContain('ensemble tour');
  });
});
