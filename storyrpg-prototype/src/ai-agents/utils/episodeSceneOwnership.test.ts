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
    expect(scenes[1].requiredBeats?.map((beat) => beat.tier)).toEqual(['authored']);
    expect(scenes[1].requiredBeats?.[0].id).toBe('coldopen-guide');
    expect(scenes[1].treatmentAtomIds?.length).toBeGreaterThan(0);
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
