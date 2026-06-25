import { describe, expect, it } from 'vitest';
import type { AuthoredTreatmentFieldContract, PlannedScene } from '../../types/scenePlan';
import { rebindPlannedSceneObligations } from './plannedSceneObligationBinder';
import { analyzeEpisodeTreatmentDensity, unsafeTreatmentDensityReports } from './gateRepairRouter';

function contract(
  id: string,
  kind: AuthoredTreatmentFieldContract['contractKind'],
  sourceText: string,
  targetSceneIds: string[] = ['s1-1'],
): AuthoredTreatmentFieldContract {
  return {
    id,
    episodeNumber: 1,
    fieldName: kind,
    sourceText,
    contractKind: kind,
    requiredRealization: kind === 'encounter_anchor' ? ['encounter', 'final_prose'] : ['final_prose'],
    targetSceneIds,
    blockingLevel: 'treatment',
  };
}

function scene(overrides: Partial<PlannedScene>): PlannedScene {
  return {
    id: overrides.id ?? 's1-1',
    episodeNumber: overrides.episodeNumber ?? 1,
    order: overrides.order ?? 0,
    kind: overrides.kind ?? 'standard',
    title: overrides.title ?? 'Opening',
    dramaticPurpose: overrides.dramaticPurpose ?? 'Kylie starts the episode at Lumina Books.',
    narrativeRole: overrides.narrativeRole ?? 'setup',
    locations: overrides.locations ?? ['Lumina Books'],
    npcsInvolved: overrides.npcsInvolved ?? [],
    timeOfDay: overrides.timeOfDay,
    timeJump: overrides.timeJump,
    setsUp: [],
    paysOff: [],
    stakes: overrides.stakes,
    encounter: overrides.encounter,
    requiredBeats: overrides.requiredBeats,
    authoredTreatmentFields: overrides.authoredTreatmentFields,
    turnContract: overrides.turnContract,
    mechanicPressure: overrides.mechanicPressure,
    hasChoice: overrides.hasChoice,
  };
}

describe('planned scene obligation binder', () => {
  it('moves encounter anchors from the opening scene to the encounter scene', () => {
    const encounterAnchor = contract(
      'enc-anchor',
      'encounter_anchor',
      'The Cișmigiu park attack establishes the supernatural threat.',
    );
    const result = rebindPlannedSceneObligations([
      scene({ id: 's1-1', authoredTreatmentFields: [encounterAnchor] }),
      scene({
        id: 'treatment-enc-1-1',
        order: 1,
        kind: 'encounter',
        title: 'Cișmigiu park attack',
        dramaticPurpose: 'At 1am in Cișmigiu Gardens, Kylie is attacked and rescued.',
        locations: ['Cișmigiu Gardens'],
        encounter: {
          type: 'combat',
          difficulty: 'moderate',
          relevantSkills: ['notice'],
          description: 'Cișmigiu park attack',
          isBranchPoint: true,
        },
      }),
    ], { episodeNumber: 1 });

    expect(result.scenes.find((item) => item.id === 's1-1')?.authoredTreatmentFields ?? []).toHaveLength(0);
    expect(result.scenes.find((item) => item.id === 'treatment-enc-1-1')?.authoredTreatmentFields?.[0]?.id).toBe('enc-anchor');
    expect(result.planLevelAuthoredTreatmentFields.find((item) => item.id === 'enc-anchor')?.targetSceneIds).toEqual(['treatment-enc-1-1']);
    expect(result.report.decisions.some((decision) => decision.issueKind === 'encounter_scope_pollution')).toBe(true);
  });

  it('keeps future information obligations plan-level instead of opening-prose bound', () => {
    const futureTruth = contract(
      'future-truth',
      'information_movement',
      'INFO-VICTOR: Victor is confirmed later as a strigoi; plant this now but do not reveal it.',
    );
    const result = rebindPlannedSceneObligations([
      scene({ id: 's1-1', authoredTreatmentFields: [futureTruth] }),
      scene({ id: 's1-2', order: 1, title: 'Blog aftermath', dramaticPurpose: 'Kylie writes around what she saw.' }),
    ], { episodeNumber: 1 });

    expect(result.scenes.flatMap((item) => item.authoredTreatmentFields ?? [])).toHaveLength(0);
    expect(result.planLevelAuthoredTreatmentFields.find((item) => item.id === 'future-truth')?.targetSceneIds).toEqual([]);
    expect(result.report.decisions.find((decision) => decision.contractId === 'future-truth')?.action).toBe('ledgered');
  });

  it('moves time-coded blog obligations to the chronological matching scene', () => {
    const blogBeat = contract(
      'blog-by-6pm',
      'pressure_lane',
      'By 6pm, Kylie publishes the blog post about the weekend and the strange rescue.',
    );
    const result = rebindPlannedSceneObligations([
      scene({ id: 's1-1', title: 'Morning at Lumina', dramaticPurpose: 'Kylie arrives at Lumina Books.', authoredTreatmentFields: [blogBeat] }),
      scene({
        id: 's1-4',
        order: 3,
        title: 'Blog post by 6pm',
        dramaticPurpose: 'By 6pm, Kylie writes the blog post and chooses what to imply.',
        timeOfDay: 'evening',
        timeJump: 'later that day',
        hasChoice: true,
      }),
    ], { episodeNumber: 1 });

    expect(result.scenes.find((item) => item.id === 's1-4')?.authoredTreatmentFields?.[0]?.id).toBe('blog-by-6pm');
    expect(result.report.decisions.find((decision) => decision.contractId === 'blog-by-6pm')?.issueKind).toBe('chronology_conflict');
  });

  it('does not default unresolved encounter obligations to the first scene', () => {
    const encounterAnchor = contract('missing-encounter', 'encounter_anchor', 'A park attack should be an encounter.');
    const result = rebindPlannedSceneObligations([
      scene({ id: 's1-1', authoredTreatmentFields: [encounterAnchor] }),
      scene({ id: 's1-2', order: 1, title: 'Aftermath', dramaticPurpose: 'Kylie recovers.' }),
    ], { episodeNumber: 1 });

    expect(result.scenes.flatMap((item) => item.authoredTreatmentFields ?? [])).toHaveLength(0);
    expect(result.report.unresolved[0]?.issueKind).toBe('encounter_scope_pollution');
  });

  it('recommends more beats for valid dense scenes instead of redistributing every obligation', () => {
    const dense = scene({
      id: 's1-2',
      order: 1,
      title: 'Valid dense confrontation',
      dramaticPurpose: 'Kylie confronts Radu at Lumina with several immediate authored facts.',
      requiredBeats: [
        { id: 'rb1', sourceTurn: 'Kylie finds the card.', mustDepict: 'Kylie finds the crescent card.', tier: 'authored' },
        { id: 'rb2', sourceTurn: 'Radu warns her.', mustDepict: 'Radu warns Kylie about Victor.', tier: 'authored' },
        { id: 'rb3', sourceTurn: 'Mika interrupts.', mustDepict: 'Mika interrupts with a contradictory version.', tier: 'authored' },
        { id: 'rb4', sourceTurn: 'The door changes.', mustDepict: 'The Lumina door lock changes under Kylies hand.', tier: 'authored' },
      ],
      hasChoice: true,
      authoredTreatmentFields: [
        contract('pressure-a', 'pressure_lane', 'Kylie must choose whether to trust Radu.'),
      ],
    });
    const result = rebindPlannedSceneObligations([dense], { episodeNumber: 1 });

    expect(result.report.beatBudgetRecommendations[0]?.sceneId).toBe('s1-2');
    expect(result.report.beatBudgetRecommendations[0]?.recommendedBeatCount).toBeGreaterThan(6);
  });

  it('splits multi-time authored required beats into chronological scene-local beats', () => {
    const chain = {
      id: 'chain',
      sourceTurn: 'Kylie lands in Bucharest; by night three she is at a rooftop bar; by 1am she is pinned in Cismigiu; At 4am she writes the Mr. Midnight post.',
      mustDepict: 'Kylie lands in Bucharest; by night three she is at a rooftop bar; by 1am she is pinned in Cismigiu; At 4am she writes the Mr. Midnight post.',
      tier: 'authored' as const,
    };
    const result = rebindPlannedSceneObligations([
      scene({ id: 's1-1', title: 'Bucharest arrival', dramaticPurpose: 'Kylie lands in Bucharest.', requiredBeats: [chain] }),
      scene({ id: 's1-3', order: 2, title: 'Night three rooftop bar', dramaticPurpose: 'On night three Kylie watches Victor at the rooftop bar.' }),
      scene({ id: 's1-4', order: 3, title: 'Cismigiu at 1am', dramaticPurpose: 'At 1am Kylie is pinned in Cismigiu Gardens.' }),
      scene({ id: 's1-5', order: 4, title: '4am blog post', dramaticPurpose: 'At 4am Kylie writes the Mr. Midnight blog post.', hasChoice: true }),
    ], { episodeNumber: 1 });

    expect(result.scenes.find((item) => item.id === 's1-1')?.requiredBeats?.map((beat) => beat.mustDepict)).toEqual(['Kylie lands in Bucharest']);
    expect(result.scenes.find((item) => item.id === 's1-3')?.requiredBeats?.[0]?.mustDepict).toContain('night three');
    expect(result.scenes.find((item) => item.id === 's1-4')?.requiredBeats?.[0]?.mustDepict).toContain('1am');
    expect(result.scenes.find((item) => item.id === 's1-5')?.requiredBeats?.[0]?.mustDepict).toContain('4am');
    expect(result.report.decisions.some((decision) => decision.contractId === 'chain' && decision.issueKind === 'chronology_conflict')).toBe(true);
  });

  it('splits dense same-scene action chains without moving the event out of its scene', () => {
    const chain = {
      id: 'park-rescue-chain',
      sourceTurn: 'Walking home through Cișmigiu at 1am, Kylie is pinned to a willow by a shadow — and a second figure in a charcoal suit drops the attacker, walks her home, kisses her hand at the threshold, declines to come in, and vanishes.',
      mustDepict: 'Walking home through Cișmigiu at 1am, Kylie is pinned to a willow by a shadow — and a second figure in a charcoal suit drops the attacker, walks her home, kisses her hand at the threshold, declines to come in, and vanishes.',
      tier: 'authored' as const,
    };
    const sourceScene = scene({
      id: 's1-4',
      order: 4,
      title: 'Cismigiu at 1am',
      dramaticPurpose: chain.mustDepict,
      locations: ['Cișmigiu Gardens'],
      requiredBeats: [chain],
      hasChoice: true,
    }) as PlannedScene & { choicePoint?: { description: string } };
    sourceScene.choicePoint = { description: 'Decide how to handle the walk home.' };
    const result = rebindPlannedSceneObligations([sourceScene], { episodeNumber: 1 });

    const beats = result.scenes.find((item) => item.id === 's1-4')?.requiredBeats ?? [];
    expect(beats.map((beat) => beat.mustDepict)).toEqual([
      'Walking home through Cișmigiu at 1am, Kylie is pinned to a willow by a shadow',
      'Victor drops the attacker',
      'Victor walks her home',
    ]);
    expect(result.scenes.find((item) => item.id === 's1-4-threshold')?.requiredBeats?.map((beat) => beat.mustDepict)).toEqual([
      'Victor kisses her hand at the threshold',
      'Victor declines to come in',
      'Victor vanishes.',
    ]);
    expect(result.scenes.find((item) => item.id === 's1-4')?.turnContract?.centralTurn).toBe('Victor walks Kylie home.');
    expect(result.scenes.find((item) => item.id === 's1-4')?.turnContract?.centralTurn).not.toContain('pinned');
    expect(result.scenes.find((item) => item.id === 's1-4-threshold')?.turnContract?.centralTurn).toBe("Victor kisses Kylie's hand, declines to come in, and vanishes at the threshold.");
    expect(result.scenes.find((item) => item.id === 's1-4-threshold')?.turnContract?.centralTurn).not.toContain('pinned');
    expect((result.scenes.find((item) => item.id === 's1-4-threshold') as PlannedScene & { choicePoint?: unknown })?.choicePoint).toBeUndefined();
    expect(analyzeEpisodeTreatmentDensity(result.scenes, 1).find((report) => report.sceneId === 's1-4-threshold')?.obligations.map((item) => item.kind)).not.toContain('choice_pressure');
    expect([
      ...beats,
      ...(result.scenes.find((item) => item.id === 's1-4-threshold')?.requiredBeats ?? []),
    ].every((beat) => beat.id.startsWith('park-rescue-chain-action-'))).toBe(true);
    expect(result.report.decisions.find((decision) => decision.contractId === 'park-rescue-chain')?.issueKind).toBe('valid_dense_scene_needs_more_beats');
  });

  it('splits compact same-scene authored action series into independently enforced beats', () => {
    const keyCardSeed = {
      id: 'keycard-seed',
      sourceTurn: "The key card to Vâlcescu Club's side entrance.",
      mustDepict: "The key card to Vâlcescu Club's side entrance.",
      tier: 'seed' as const,
    };
    const chain = {
      id: 'club-door-chain',
      sourceTurn: 'Mika adopts Kylie at the door of Vâlcescu Club on night two, swaps out her "American shoes," and hands her a key card to the side entrance.',
      mustDepict: 'Mika adopts Kylie at the door of Vâlcescu Club on night two, swaps out her "American shoes," and hands her a key card to the side entrance.',
      tier: 'authored' as const,
    };
    const result = rebindPlannedSceneObligations([
      scene({
        id: 's1-1',
        title: 'Vâlcescu Club door',
        dramaticPurpose: 'Mika adopts Kylie at the club door and gives her insider access.',
        locations: ['Vâlcescu Club'],
        requiredBeats: [keyCardSeed, chain],
      }),
    ], { episodeNumber: 1 });

    expect(result.scenes[0]?.requiredBeats?.map((beat) => beat.mustDepict)).toEqual([
      'Mika adopts Kylie at the door of Vâlcescu Club on night two',
      'Mika swaps out her "American shoes,"',
      'Mika hands her a key card to the side entrance.',
    ]);
    expect(result.report.decisions.find((decision) => decision.contractId === 'club-door-chain')?.issueKind).toBe('valid_dense_scene_needs_more_beats');
  });

  it('ledgers future seed required beats instead of leaving them on the opening scene', () => {
    const result = rebindPlannedSceneObligations([
      scene({
        id: 's1-1',
        requiredBeats: [
          {
            id: 'future-seed',
            sourceTurn: 'Victor is a strigoi confirmed at the mirror later.',
            mustDepict: 'Victor is a strigoi confirmed at the mirror later.',
            tier: 'seed',
          },
        ],
      }),
    ], { episodeNumber: 1 });

    expect(result.scenes[0]?.requiredBeats ?? []).toHaveLength(0);
    expect(result.report.decisions.find((decision) => decision.contractId === 'future-seed')?.action).toBe('ledgered');
  });

  it('ledgers episode-ending summary seed beats instead of treating them as literal prose', () => {
    const result = rebindPlannedSceneObligations([
      scene({
        id: 's1-6',
        requiredBeats: [
          {
            id: 'ending-summary',
            sourceTurn: 'E1 ends on revelation + a charged bond (the staged rescue, the viral post, and a warning call).',
            mustDepict: 'E1 ends on revelation + a charged bond (the staged rescue, the viral post, and a warning call).',
            tier: 'seed',
          },
        ],
      }),
    ], { episodeNumber: 1 });

    expect(result.scenes[0]?.requiredBeats ?? []).toHaveLength(0);
    expect(result.report.decisions.find((decision) => decision.contractId === 'ending-summary')?.action).toBe('ledgered');
  });

  it('ledgers episode-ending summary authored beats instead of treating them as literal prose', () => {
    const result = rebindPlannedSceneObligations([
      scene({
        id: 's1-6',
        requiredBeats: [
          {
            id: 'ending-summary-authored',
            sourceTurn: 'E1 ends on revelation + a charged bond (the staged rescue, the viral post, and a warning call).',
            mustDepict: 'E1 ends on revelation + a charged bond (the staged rescue, the viral post, and a warning call).',
            tier: 'authored',
          },
        ],
      }),
    ], { episodeNumber: 1 });

    expect(result.scenes[0]?.requiredBeats ?? []).toHaveLength(0);
    expect(result.report.decisions.find((decision) => decision.contractId === 'ending-summary-authored')?.action).toBe('ledgered');
  });

  it('ledgers abstract dramatic questions instead of treating them as literal authored prose', () => {
    const result = rebindPlannedSceneObligations([
      scene({
        id: 's1-1',
        requiredBeats: [
          {
            id: 'arc-question',
            sourceTurn: "Can a woman fleeing a publicly-cancelled engagement actually start over — make friends, have a sex life, and let herself be wanted again — in a city that doesn't know her ex's name?",
            mustDepict: "Can a woman fleeing a publicly-cancelled engagement actually start over — make friends, have a sex life, and let herself be wanted again — in a city that doesn't know her ex's name?",
            tier: 'authored',
          },
        ],
      }),
    ], { episodeNumber: 1 });

    expect(result.scenes[0]?.requiredBeats ?? []).toHaveLength(0);
    expect(result.report.decisions.find((decision) => decision.contractId === 'arc-question')?.action).toBe('ledgered');
  });

  it('does not leave another episode required beat on the current scoped episode', () => {
    const futureBeat = {
      id: 's3-1-seed8',
      sourceTurn: "A suppressed Radu-adjacent beat during the weekend so the Sunday-night doorstep scarf lands as built-up contrast, not a cold reintroduction.",
      mustDepict: "A suppressed Radu-adjacent beat during the weekend so the Sunday-night doorstep scarf lands as built-up contrast, not a cold reintroduction.",
      tier: 'seed' as const,
    };
    const result = rebindPlannedSceneObligations([
      scene({ id: 's1-arrival-cold-open', episodeNumber: 1, requiredBeats: [futureBeat] }),
    ], { episodeNumber: 1 });

    expect(result.scenes[0]?.requiredBeats ?? []).toHaveLength(0);
    expect(result.report.decisions.find((decision) => decision.contractId === 's3-1-seed8')).toMatchObject({
      action: 'ledgered',
      issueKind: 'ledger_scope_pollution',
    });
  });

  it('rebounds another episode required beat when its episode exists in the scene plan', () => {
    const futureBeat = {
      id: 's3-1-seed8',
      sourceTurn: "A suppressed Radu-adjacent beat during the weekend so the Sunday-night doorstep scarf lands as built-up contrast, not a cold reintroduction.",
      mustDepict: "A suppressed Radu-adjacent beat during the weekend so the Sunday-night doorstep scarf lands as built-up contrast, not a cold reintroduction.",
      tier: 'seed' as const,
    };
    const result = rebindPlannedSceneObligations([
      scene({ id: 's1-arrival-cold-open', episodeNumber: 1, requiredBeats: [futureBeat] }),
      scene({ id: 's3-1', episodeNumber: 3, order: 1, title: 'Weekend estate contrast', dramaticPurpose: 'During the weekend, Kylie misses honest roughness at the estate.' }),
    ]);

    expect(result.scenes.find((item) => item.id === 's1-arrival-cold-open')?.requiredBeats ?? []).toHaveLength(0);
    expect(result.scenes.find((item) => item.id === 's3-1')?.requiredBeats?.[0]?.id).toBe('s3-1-seed8');
    expect(result.report.decisions.find((decision) => decision.contractId === 's3-1-seed8')).toMatchObject({
      action: 'rebound',
      toSceneId: 's3-1',
    });
  });

  it('splits mixed rooftop setup from the park attack encounter before density gating', () => {
    const encounterAnchor = contract(
      'mixed-anchor',
      'encounter_anchor',
      'Two anchors, light then dark — the rooftop bar at sunset on night three; then Cismigiu at 1am, fog, a shadow, a scream, and a rescue.',
      ['treatment-enc-1-1'],
    );
    const encounterConflict = contract(
      'mixed-conflict',
      'encounter_conflict',
      'The rooftop is the new life Kylie wanted, and the park is the cost the city exacts for it.',
      ['treatment-enc-1-1'],
    );
    const result = rebindPlannedSceneObligations([
      scene({
        id: 'treatment-enc-1-1',
        order: 2,
        kind: 'encounter',
        title: 'Rooftop bar at sunset',
        dramaticPurpose: 'On night three at a rooftop bar at sunset, Kylie locks eyes with Victor.',
        locations: ['Rooftop Bar'],
        encounter: {
          type: 'combat',
          difficulty: 'moderate',
          relevantSkills: ['notice'],
          description: 'On night three at a rooftop bar at sunset, Kylie locks eyes with Victor.',
          isBranchPoint: true,
        },
        requiredBeats: [
          { id: 'roof-1', sourceTurn: 'Rooftop', mustDepict: 'On night three at a rooftop bar at sunset, Kylie locks eyes with Victor.', tier: 'authored' },
          { id: 'sidecar-seed-1', sourceTurn: 'Aftermath seed', mustDepict: 'A silver token waits in the courtyard below the apartment window.', tier: 'seed' },
        ],
        authoredTreatmentFields: [
          encounterAnchor,
          encounterConflict,
          contract('roof-choice', 'major_choice_pressure', 'When Mika clocks Mr. Charcoal at the rooftop, follow her lead or walk over.', ['treatment-enc-1-1']),
          contract('aftermath-sidecar-seed', 'consequence_seed', 'A silver token waits in the courtyard below the apartment window.', ['treatment-enc-1-1']),
        ],
      }),
      scene({
        id: 's1-4',
        order: 3,
        title: 'Cismigiu attack',
        dramaticPurpose: 'At 1am in Cismigiu Gardens, Kylie is pinned to a willow by a shadow.',
        locations: ['Cismigiu Gardens'],
        requiredBeats: [
          { id: 'attack-1', sourceTurn: 'Attack', mustDepict: 'Walking home through Cismigiu at 1am, Kylie is pinned to a willow by a shadow.', tier: 'authored' },
          { id: 'home-1', sourceTurn: 'Aftermath', mustDepict: 'Victor walks her home and kisses her hand at the threshold.', tier: 'authored' },
        ],
      }),
    ], { episodeNumber: 1 });

    expect(result.scenes.find((item) => item.id === 's1-rooftop-setup')).toMatchObject({
      kind: 'standard',
      title: 'Rooftop bar at sunset',
    });
    expect(result.scenes.find((item) => item.id === 'treatment-enc-1-1')).toMatchObject({
      kind: 'encounter',
      title: 'Cișmigiu attack at 1am',
    });
    expect(result.scenes.find((item) => item.id === 's1-4')?.title).toBe('Victor walks Kylie home');
    expect(result.scenes.find((item) => item.id === 's1-4')?.dramaticPurpose).not.toContain('Cișmigiu attack');
    expect(result.scenes.find((item) => item.id === 's1-4')?.turnContract?.centralTurn).toContain('walks Kylie home');
    expect(result.scenes.find((item) => item.id === 's1-4')?.turnContract?.centralTurn).not.toContain('pinned');
    expect(result.scenes.find((item) => item.id === 's1-rooftop-setup')?.requiredBeats?.map((beat) => beat.mustDepict)).not.toContain('A silver token waits in the courtyard below the apartment window.');
    expect(result.scenes.find((item) => item.id === 's1-4')?.requiredBeats?.map((beat) => beat.mustDepict)).toContain('A silver token waits in the courtyard below the apartment window.');
    expect(result.scenes.find((item) => item.id === 's1-4')?.authoredTreatmentFields?.map((field) => field.id)).toContain('aftermath-sidecar-seed');

    const density = analyzeEpisodeTreatmentDensity(result.scenes.map((item) => ({
      ...item,
      choicePoint: item.kind === 'standard' ? { description: item.stakes || item.dramaticPurpose } : undefined,
      requiredBeats: [...(item.requiredBeats ?? []), ...(item.encounter?.requiredBeats ?? [])],
    })) as never, 1);
    expect(unsafeTreatmentDensityReports(density)).toHaveLength(0);
  });

  it('gives split blog metric scenes distinct draft and viral turn contracts', () => {
    const result = rebindPlannedSceneObligations([
      scene({
        id: 's1-5',
        title: '4am blog post',
        dramaticPurpose: 'At 4am, Kylie writes the Mr. Midnight post; by 6pm it has 80,000 reads.',
        requiredBeats: [
          { id: 'draft', sourceTurn: 'Draft', mustDepict: 'At 4am, unable to sleep, Kylie writes the Mr. Midnight post.', tier: 'authored' },
          { id: 'metric', sourceTurn: 'Metric', mustDepict: 'By 6pm it has 80,000 reads.', tier: 'authored' },
        ],
        turnContract: {
          turnId: 'combined-turn',
          source: 'treatment',
          centralTurn: 'At 4am, Kylie writes the post; by 6pm it has 80,000 reads.',
          beforeState: 'Private fear.',
          turnEvent: 'Writing and virality happen.',
          afterState: 'Public pressure.',
          handoff: 'The city notices.',
        },
      }),
    ], { episodeNumber: 1 });

    expect(result.scenes.find((item) => item.id === 's1-5')?.turnContract?.centralTurn).toContain('writes and publishes');
    expect(result.scenes.find((item) => item.id === 's1-5')?.turnContract?.centralTurn).not.toContain('80,000');
    expect(result.scenes.find((item) => item.id === 's1-5-viral-aftermath')?.turnContract?.centralTurn).toContain('publicly visible');
    expect(result.scenes.find((item) => item.id === 's1-5-viral-aftermath')?.turnContract?.turnEvent).toContain('readership number');
  });

  it('rewrites structural-label turn contracts to concrete required beats', () => {
    const result = rebindPlannedSceneObligations([
      scene({
        id: 's1-arrival-cold-open',
        title: 'Kylie arrives in Bucharest',
        dramaticPurpose: 'Hook — unpacking; promise — reinvention; stakes — a call that makes danger a joke.',
        locations: ["Kylie's Lipscani Apartment"],
        requiredBeats: [
          { id: 'unpack', sourceTurn: 'Unpack', mustDepict: 'Kylie unpacks in the apartment at sunset.', tier: 'coldopen' },
          { id: 'call', sourceTurn: 'Call', mustDepict: 'Sadie asks, "are there vampires in Romania?"', tier: 'coldopen' },
        ],
        turnContract: {
          turnId: 'structural-turn',
          source: 'treatment',
          centralTurn: 'Hook — unpacking; promise — reinvention; stakes — a call that makes danger a joke.',
          beforeState: 'Before.',
          turnEvent: 'Hook — unpacking; promise — reinvention; stakes — a call that makes danger a joke.',
          afterState: 'After.',
          handoff: 'Next.',
        },
      }),
    ], { episodeNumber: 1 });

    expect(result.scenes[0]?.turnContract?.centralTurn).toBe('Kylie unpacks in the apartment at sunset.; Sadie asks, "are there vampires in Romania?"');
    expect(result.scenes[0]?.turnContract?.centralTurn).not.toContain('Hook');
  });

  it('does not let broad choice turns pull later road and crisis obligations into the opening scene', () => {
    const roadPressure: AuthoredTreatmentFieldContract = {
      id: 'ep2-road-pressure',
      episodeNumber: 2,
      fieldName: 'pressure_lane',
      sourceText: 'On the broken-down country road, accept the chef\'s lift or wait for the tow; the hand-knit sweater smells of woodsmoke and bay leaf.',
      contractKind: 'pressure_lane',
      requiredRealization: ['final_prose'],
      targetSceneIds: ['s2-1'],
      blockingLevel: 'treatment',
    };
    const result = rebindPlannedSceneObligations([
      scene({
        id: 's2-1',
        episodeNumber: 2,
        title: 'Opening dashboard',
        locations: ["Kylie's Apartment"],
        requiredBeats: [
          { id: 's2-1-coldopen1-action-1', sourceTurn: 'Kylie at her laptop at 11am.', mustDepict: 'Kylie at her laptop at 11am, draft titled Three Dates and a Tow Truck, the blog dashboard ticking 84K to 92K.', tier: 'coldopen' },
          { id: 's2-1-coldopen1-action-2', sourceTurn: 'The dating-blog dream is working.', mustDepict: 'The dating-blog dream is working, she is being read, she is being wanted.', tier: 'coldopen' },
          { id: 's2-1-coldopen1-action-3', sourceTurn: 'The viral post puts her onstage.', mustDepict: 'The viral post has put her and the man she codenamed on a stage.', tier: 'coldopen' },
        ],
        authoredTreatmentFields: [roadPressure],
        turnContract: {
          turnId: 's2-1-turn',
          source: 'choice',
          centralTurn: 'Dating After Dusk goes viral; later she finally goes to the club; later still her cab breaks down in the mountains and a chef fixes it.',
          beforeState: 'Opening pressure.',
          turnEvent: 'A player-facing choice summarizes the episode including the later road breakdown.',
          afterState: 'Episode pressure is broadly named.',
          handoff: 'Move through later episode material.',
        },
      }),
      scene({
        id: 'treatment-enc-2-1',
        episodeNumber: 2,
        order: 1,
        kind: 'encounter',
        title: 'Club conversation',
        locations: ['Vâlcescu Club'],
        requiredBeats: [
          {
            id: 'treatment-enc-2-1-seven-point-plotTurn1',
            sourceTurn: 'Dating After Dusk goes viral. Kylie finally goes to the club and speaks with Victor; days later her cab breaks down and a chef in a hand-knit sweater fixes it, whom she nicknames The Mountain.',
            mustDepict: 'Dating After Dusk goes viral. Kylie finally goes to the club and speaks with Victor; days later her cab breaks down and a chef in a hand-knit sweater fixes it, whom she nicknames The Mountain.',
            tier: 'authored',
          },
          {
            id: 'treatment-enc-2-1-arc-pressure-arc-late-crisis',
            sourceTurn: 'At the weekend a photograph does not include the private man and the first crack between voice and approval appears.',
            mustDepict: 'At the weekend a photograph does not include the private man and the first crack between voice and approval appears.',
            tier: 'authored',
          },
        ],
        encounter: {
          type: 'social',
          difficulty: 'moderate',
          relevantSkills: ['notice'],
          description: 'The club conversation with Victor.',
          centralConflict: 'Kylie must decide how much to reveal at the club.',
          isBranchPoint: true,
        },
      }),
      scene({
        id: 's2-4',
        episodeNumber: 2,
        order: 2,
        title: 'Broken-down mountain road',
        locations: ['Broken-down mountain road near Bran'],
        requiredBeats: [
          {
            id: 's2-4-rb1',
            sourceTurn: 'The research-trip cab breaks down on the mountain road.',
            mustDepict: 'The research-trip cab breaks down on the mountain road and a shy chef in a hand-knit sweater fixes it.',
            tier: 'authored',
          },
        ],
      }),
    ], { episodeNumber: 2 });

    const opening = result.scenes.find((item) => item.id === 's2-1');
    const road = result.scenes.find((item) => item.id === 's2-4');
    const density = analyzeEpisodeTreatmentDensity(result.scenes, 2);

    expect(unsafeTreatmentDensityReports(density)).toHaveLength(0);
    expect(opening?.requiredBeats?.map((beat) => beat.id)).toEqual([
      's2-1-coldopen1-action-1',
      's2-1-coldopen1-action-2',
      's2-1-coldopen1-action-3',
    ]);
    expect(opening?.turnContract?.centralTurn).not.toContain('cab breaks down');
    expect(road?.requiredBeats?.map((beat) => beat.id)).toContain('treatment-enc-2-1-seven-point-plotTurn1-part-3');
    expect(road?.authoredTreatmentFields?.map((field) => field.id)).toContain('ep2-road-pressure');
    expect(result.scenes.flatMap((item) => item.requiredBeats ?? []).map((beat) => beat.id)).not.toContain('treatment-enc-2-1-arc-pressure-arc-late-crisis');
  });
});
