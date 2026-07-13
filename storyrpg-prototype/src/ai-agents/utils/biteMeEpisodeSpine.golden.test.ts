import { describe, expect, it } from 'vitest';
import { buildSeasonScenePlan, scenesForEpisode } from '../pipeline/seasonScenePlanBuilder';
import type { SeasonEpisode, SeasonPlan } from '../../types/seasonPlan';

/**
 * Golden fixture: Bite Me Ep1 treatment turns must compile into an ESC that
 * attaches testing intent to bond, assigns staged_rescue, and projects onto scenes.
 */
describe('Bite Me Ep1 ESC golden fixture', () => {
  const ep = {
    episodeNumber: 1,
    title: 'Dating After Dusk',
    synopsis: 'Kylie arrives in Bucharest and forms the Dusk Club.',
    sourceChapters: [],
    sourceSummary: '',
    plotPoints: [],
    mainCharacters: ['Kylie', 'Stela', 'Mika', 'Victor'],
    supportingCharacters: [],
    locations: ['Bucharest', 'Lumina Books', 'Vâlcescu Club', 'Cișmigiu Gardens', "Kylie's Lipscani Apartment"],
    estimatedSceneCount: 7,
    estimatedChoiceCount: 4,
    storyCircleRole: [{ beat: 'you', roleKind: 'primary' }],
    narrativeFunction: { setup: '', conflict: '', resolution: '' },
    status: 'planned',
    dependsOn: [],
    setupsForEpisodes: [],
    resolvesPlotsFrom: [],
    introducesCharacters: [],
    treatmentGuidance: {
      sourceKind: 'authored_lite',
      episodeTurns: [
        'She explores the streets of Bucharest and wanders into a bookshop owned by Stela who befriends her.',
        'After testing Kylie, the three become friends and form the Dusk Club.',
        'On the rooftop bar at sunset, two suitors compete for her attention.',
        'Walking home through Cismigiu Gardens, Kylie is attacked and Victor rescues her.',
        'At her apartment doorstep, Victor vanishes through the keycard door.',
        'At 4am she writes the blog post as Mr. Midnight.',
        'By evening the post goes viral at the club.',
      ],
      dramaticQuestion: 'Can Kylie be known without being consumed?',
    },
  } as SeasonEpisode;

  const plan = {
    storyCircle: {
      you: 'Kylie arrives in Bucharest as a wounded observer hiding behind her writing.',
      need: 'She needs reinvention and belonging without being used.',
      go: 'She crosses into Bucharest nightlife and vampire attention.',
      search: 'She adapts under social and romantic pressure.',
      find: 'She finds provisional belonging and a dangerous rescuer.',
      take: 'The rescue and viral post exact a public cost.',
      return: 'She brings the story back into her apartment and blog.',
      change: 'She becomes an author of her own myth rather than only an observer.',
    },
    episodes: [ep],
    arcs: [{
      id: 'arc-known',
      name: 'Adored vs Known',
      description: 'Polarity between being adored and being known.',
      episodeRange: { start: 1, end: 8 },
      keyMoments: [],
      arcQuestion: 'Can she be known without being consumed?',
      identityPressureFacet: 'observer vs author',
      status: 'not_started',
      completionPercentage: 0,
    }],
    consequenceChains: [],
    choiceMoments: [],
    informationLedger: [],
  } as unknown as SeasonPlan;

  it('compiles ESC with a non-owning social test on bond and staged_rescue', () => {
    const sp = buildSeasonScenePlan(plan);
    const spine = sp.episodeSpines?.[1];
    expect(spine).toBeDefined();
    expect(sp.sourceHash).toBeTruthy();

    const bond = spine!.units.find((unit) => unit.kind === 'bond');
    expect(spine!.units.some((unit) => unit.text === 'Testing Kylie')).toBe(false);
    expect(bond).toBeDefined();
    expect(bond!.supportingIntents).toEqual([expect.objectContaining({
      kind: 'behavioral_intent',
      intentKind: 'social_test',
    })]);

    const rescue = spine!.units.find((unit) => unit.encounterProfile === 'staged_rescue');
    expect(rescue).toBeDefined();
    expect(rescue!.sceneKind).toBe('encounter');

    const scenes = scenesForEpisode(sp, 1);
    expect(scenes.some((scene) => scene.turnContract?.centralTurn === 'Testing Kylie')).toBe(false);
    expect(scenes.some((scene) => scene.behavioralIntents?.some((intent) =>
      intent.kind === 'behavioral_intent' && intent.intentKind === 'social_test'
    ))).toBe(true);
    expect(scenes.some((scene) => scene.spineUnitId)).toBe(true);
    expect(scenes.some((scene) =>
      scene.encounterProfile === 'staged_rescue'
      || scene.encounter?.encounterProfile === 'staged_rescue'
    )).toBe(true);
    expect(sp.narrativeContractGraph?.events.some((event) => event.sourceText === 'Testing Kylie')).toBe(false);
    const bondTask = sp.narrativeContractGraph?.realizationTasks?.find((task) =>
      task.evidenceAtoms.some((atom) => atom.description.includes('authored social test')),
    );
    expect(bondTask?.sceneId).toBe(scenes.find((scene) => scene.turnContract?.centralTurn?.includes('Dusk Club'))?.id);
    expect(bondTask?.evidenceAtoms[0]?.acceptedPatterns).toContain('Stela tests Kylie');
    expect(bondTask?.evidenceAtoms[0]?.acceptedPatterns).toContain('Stela asks you');
  });
});
