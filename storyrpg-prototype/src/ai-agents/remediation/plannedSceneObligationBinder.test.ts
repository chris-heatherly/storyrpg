import { describe, expect, it } from 'vitest';
import type { ArcPressureTreatmentContract, AuthoredTreatmentFieldContract, PlannedScene } from '../../types/scenePlan';
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

function arcPressure(
  id: string,
  contractKind: ArcPressureTreatmentContract['contractKind'],
  targetEpisodeNumbers: number[],
  targetSceneIds: string[],
  sourceText: string,
): ArcPressureTreatmentContract {
  return {
    id,
    source: 'treatment',
    arcId: 'arc-1',
    arcTitle: 'Champagne',
    fieldName: contractKind,
    sourceText,
    contractKind,
    requiredRealization: ['season_arc', 'scene_turn', 'mechanic_pressure', 'final_prose'],
    targetEpisodeNumbers,
    targetSceneIds,
    eventAtoms: [sourceText],
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
    arcPressureContracts: overrides.arcPressureContracts,
    turnContract: overrides.turnContract,
    mechanicPressure: overrides.mechanicPressure,
    hasChoice: overrides.hasChoice,
    planningOrigin: overrides.planningOrigin,
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

  it('ledgers duplicate rooftop treatment fields and same-period viral time cues before density gating', () => {
    const result = rebindPlannedSceneObligations([
      scene({
        id: 's1-3',
        order: 3,
        title: 'Rooftop bar at sunset',
        dramaticPurpose: 'On night three at a rooftop bar at sunset, Kylie clocks Victor across the room.',
        locations: ['Rooftop Bar'],
        stakes: 'Kylie decides whether to follow Mika away from the magnetic man.',
        requiredBeats: [
          { id: 'rooftop-1', sourceTurn: 'Rooftop', mustDepict: 'On night three at a rooftop bar at sunset, the friends trade worst-date stories.', tier: 'authored' },
          { id: 'black-roses', sourceTurn: 'Seed', mustDepict: 'The black roses and cream-stock card, delivered impossibly fast.', tier: 'seed' },
        ],
        authoredTreatmentFields: [
          contract('black-roses-field', 'consequence_seed', 'The black roses and cream-stock card, delivered impossibly fast.', ['s1-3']),
          contract('broad-pressure', 'pressure_lane', 'The double meet — the magnetic man in the charcoal suit across the rooftop, and the rougher man in the hand-knit sweater by the kitchen who does not fit. Scene note: Mika quietly takes control of the night; the attacker and rescuer are both Victor instruments, and the entire encounter is staged to hand Victor the role of savior.', ['s1-3']),
          contract('choice-a', 'major_choice_pressure', 'When Mika clocks Mr. Charcoal at the rooftop and steers you toward food: follow her lead, or excuse yourself and walk over.', ['s1-3']),
          contract('choice-b', 'major_choice_pressure', 'Follow Mika’s lead away from the charcoal-suited man, or excuse yourself and walk over.', ['s1-3']),
        ],
      }),
      scene({
        id: 's1-5-viral-aftermath',
        order: 6,
        title: 'The post goes viral by evening',
        dramaticPurpose: 'By evening, the Mr. Midnight post becomes public pressure.',
        requiredBeats: [
          { id: 'metric', sourceTurn: 'Metric', mustDepict: 'By 6pm it has 80,000 reads.', tier: 'authored' },
        ],
        turnContract: {
          turnId: 'viral-turn',
          source: 'treatment',
          centralTurn: 'The post becomes publicly visible by evening.',
          beforeState: 'The post is private testimony.',
          turnEvent: 'The readership number climbs high enough to become public pressure.',
          afterState: 'The city starts reading.',
          handoff: 'Move into consequence.',
        },
        authoredTreatmentFields: [
          contract('theme-note', 'theme_angle', 'Reinvention after public heartbreak — whether Kylie is allowed to want anyone again. Scene note: the rooftop toast, the rescue, and the blog all pressure the same lie across the whole episode.', ['s1-5-viral-aftermath']),
        ],
        hasChoice: false,
      }),
    ], { episodeNumber: 1 });

    const rooftopFields = result.scenes.find((item) => item.id === 's1-3')?.authoredTreatmentFields ?? [];
    expect(rooftopFields.map((field) => field.id)).toEqual(['black-roses-field', 'choice-a']);
    expect(rooftopFields.find((field) => field.id === 'black-roses-field')?.requiredRealization).not.toContain('final_prose');
    expect(result.report.decisions.some((decision) => decision.contractId === 'black-roses-field' && decision.action === 'ledgered')).toBe(true);
    expect(result.report.decisions.some((decision) => decision.contractId === 'broad-pressure' && decision.action === 'ledgered')).toBe(true);
    expect(result.report.decisions.some((decision) => decision.contractId === 'choice-b' && decision.action === 'ledgered')).toBe(true);

    const density = analyzeEpisodeTreatmentDensity(result.scenes.map((item) => ({
      ...item,
      choicePoint: item.kind === 'standard' && item.hasChoice !== false ? { description: item.stakes || item.dramaticPurpose } : undefined,
    })) as never, 1);
    expect(unsafeTreatmentDensityReports(density)).toHaveLength(0);
  });

  it('rebounds Bite Me rooftop overload obligations before density gating', () => {
    const result = rebindPlannedSceneObligations([
      scene({
        id: 's1-rooftop-setup',
        order: 3,
        title: 'Rooftop bar at sunset',
        dramaticPurpose: 'On night three at a rooftop bar at sunset, Kylie clocks Victor across the room.',
        locations: ['Rooftop Bar'],
        stakes: 'Kylie decides whether to follow Mika away from the magnetic man.',
        requiredBeats: [
          {
            id: 'rooftop-worst-dates',
            sourceTurn: 'Rooftop',
            mustDepict: 'On night three at a rooftop bar at sunset, the friends trade worst-date stories while two men watch Kylie.',
            tier: 'authored',
          },
          {
            id: 'park-attack',
            sourceTurn: 'Encounter',
            mustDepict: 'At 1am in Cișmigiu Gardens, Kylie is pinned to a willow by a shadow and Victor rescues her.',
            tier: 'authored',
          },
          {
            id: 'blog-metric',
            sourceTurn: 'Blog aftermath',
            mustDepict: 'By 6pm, the Mr. Midnight post has 80,000 reads.',
            tier: 'authored',
          },
        ],
        authoredTreatmentFields: [
          contract('enc-anchor', 'encounter_anchor', 'Two anchors, light then dark — the rooftop bar at sunset on night three; then Cișmigiu at 1am, eight seconds of fog, a shadow, a scream, and a rescue.', ['s1-rooftop-setup']),
          contract('enc-conflict', 'encounter_conflict', 'The rooftop is the new life Kylie wanted, and the park is the cost the city exacts for it.', ['s1-rooftop-setup']),
          contract('rooftop-choice', 'major_choice_pressure', 'When Mika clocks Mr. Charcoal at the rooftop and steers you toward food: follow her lead, or excuse yourself and walk over.', ['s1-rooftop-setup']),
          contract('broad-pressure', 'pressure_lane', 'The double meet — the magnetic man across the rooftop, the rougher man by the kitchen, the staged rescue, and the viral post all pressure the same lie across the episode.', ['s1-rooftop-setup']),
        ],
        turnContract: {
          turnId: 'rooftop-overload',
          source: 'treatment',
          centralTurn: 'On night three at a rooftop bar, Kylie clocks Victor; at 1am she is attacked in Cișmigiu; by 6pm, the post has 80,000 reads.',
          beforeState: 'Kylie wants a clean start.',
          turnEvent: 'Rooftop attraction, park danger, and public blog pressure collide.',
          afterState: 'Victor owns the story.',
          handoff: 'Move to the morning-after blog fallout.',
        },
        hasChoice: true,
      }),
      scene({
        id: 'treatment-enc-1-1',
        order: 4,
        kind: 'encounter',
        title: 'Cișmigiu attack at 1am',
        dramaticPurpose: 'At 1am in Cișmigiu Gardens, Kylie is pinned to a willow by a shadow.',
        locations: ['Cișmigiu Gardens'],
        encounter: {
          type: 'combat',
          difficulty: 'moderate',
          relevantSkills: ['notice'],
          description: 'At 1am in Cișmigiu Gardens, Kylie is pinned to a willow by a shadow.',
          isBranchPoint: true,
        },
      }),
      scene({
        id: 's1-5',
        order: 6,
        title: '4am blog post',
        dramaticPurpose: 'At 4am, Kylie writes the Mr. Midnight post; by 6pm it has 80,000 reads.',
        requiredBeats: [
          { id: 'draft', sourceTurn: 'Draft', mustDepict: 'At 4am, unable to sleep, Kylie writes the Mr. Midnight post.', tier: 'authored' },
          { id: 'metric', sourceTurn: 'Metric', mustDepict: 'By 6pm it has 80,000 reads.', tier: 'authored' },
        ],
        turnContract: {
          turnId: 'blog-overload',
          source: 'treatment',
          centralTurn: 'At 4am, Kylie writes the post; by 6pm it has 80,000 reads.',
          beforeState: 'Private fear.',
          turnEvent: 'Writing and virality happen.',
          afterState: 'Public pressure.',
          handoff: 'The city notices.',
        },
        hasChoice: true,
      }),
    ], { episodeNumber: 1 });

    const rooftop = result.scenes.find((item) => item.id === 's1-rooftop-setup')!;
    expect(rooftop.authoredTreatmentFields?.map((field) => field.id)).toEqual(['rooftop-choice']);
    expect(rooftop.requiredBeats?.map((beat) => beat.id)).toEqual(['rooftop-worst-dates']);
    expect(rooftop.turnContract?.centralTurn).not.toContain('1am');
    expect(rooftop.turnContract?.centralTurn).not.toContain('6pm');
    expect(result.scenes.find((item) => item.id === 'treatment-enc-1-1')?.authoredTreatmentFields?.map((field) => field.id)).toEqual(['enc-anchor', 'enc-conflict']);
    expect(result.scenes.find((item) => item.id === 'treatment-enc-1-1')?.requiredBeats?.map((beat) => beat.id) ?? []).not.toContain('rooftop-worst-dates');
    expect(result.scenes.find((item) => item.id === 's1-5')?.requiredBeats?.map((beat) => beat.id)).toContain('draft');
    expect(result.scenes.find((item) => item.id === 's1-5')?.requiredBeats?.map((beat) => beat.id) ?? []).not.toContain('blog-metric');
    expect(result.scenes.find((item) => item.id === 's1-5-viral-aftermath')?.requiredBeats?.map((beat) => beat.id)).toContain('metric');
    expect(result.scenes.find((item) => item.id === 's1-5-viral-aftermath')?.requiredBeats?.map((beat) => beat.id)).toContain('blog-metric');

    const density = analyzeEpisodeTreatmentDensity(result.scenes.map((item) => ({
      ...item,
      choicePoint: item.kind === 'standard' && item.hasChoice !== false ? { description: item.stakes || item.dramaticPurpose } : undefined,
      requiredBeats: [...(item.requiredBeats ?? []), ...(item.encounter?.requiredBeats ?? [])],
    })) as never, 1);
    expect(unsafeTreatmentDensityReports(density)).toHaveLength(0);
  });

  it('rebounds rougher kitchen entrance seeds from the club-door scene to the rooftop scene', () => {
    const result = rebindPlannedSceneObligations([
      scene({
        id: 's1-1',
        order: 1,
        title: 'Vâlcescu Club side entrance',
        dramaticPurpose: 'Mika adopts Kylie at the door of Vâlcescu Club on night two.',
        locations: ['Vâlcescu Club'],
        requiredBeats: [
          {
            id: 's1-2-seed2',
            sourceTurn: "The rougher man at the kitchen entrance who didn't fit.",
            mustDepict: "The rougher man at the kitchen entrance who didn't fit.",
            tier: 'seed',
          },
        ],
      }),
      scene({
        id: 's1-3',
        order: 3,
        title: 'Rooftop bar at sunset',
        dramaticPurpose: 'At a rooftop bar, Mika clocks Victor across the room and steers Kylie toward food.',
        locations: ['Rooftop Bar'],
        requiredBeats: [
          {
            id: 'rooftop-anchor',
            sourceTurn: 'Rooftop',
            mustDepict: 'On night three at a rooftop bar, the friends trade worst-date stories while two men watch Kylie.',
            tier: 'authored',
          },
        ],
      }),
    ], { episodeNumber: 1 });

    expect(result.scenes.find((item) => item.id === 's1-1')?.requiredBeats?.map((beat) => beat.id) ?? []).not.toContain('s1-2-seed2');
    expect(result.scenes.find((item) => item.id === 's1-3')?.requiredBeats?.map((beat) => beat.id) ?? []).toContain('s1-2-seed2');
    expect(result.report.decisions.some((decision) =>
      decision.contractId === 's1-2-seed2'
      && decision.action === 'rebound'
      && decision.toSceneId === 's1-3'
    )).toBe(true);
  });

  it('counts encounter anchor and conflict as one scene-local encounter contract', () => {
    const result = rebindPlannedSceneObligations([
      scene({
        id: 'treatment-enc-1-1',
        kind: 'encounter',
        title: 'Cișmigiu attack',
        dramaticPurpose: 'Walking home through Cișmigiu at 1am, Kylie is pinned to a willow by a shadow.',
        locations: ['Cișmigiu Gardens'],
        encounter: {
          type: 'combat',
          difficulty: 'moderate',
          relevantSkills: ['notice'],
          description: 'Walking home through Cișmigiu at 1am, Kylie is pinned to a willow by a shadow.',
          isBranchPoint: true,
        },
        turnContract: {
          turnId: 'enc-turn',
          source: 'treatment',
          centralTurn: 'Walking home through Cișmigiu at 1am, Kylie is pinned to a willow by a shadow.',
          beforeState: 'Kylie is alone.',
          turnEvent: 'The shadow attacks.',
          afterState: 'Victor rescues her.',
          handoff: 'Move to the rescue aftermath.',
        },
        requiredBeats: [
          { id: 'dog', sourceTurn: 'Seed', mustDepict: 'The stray dog in the courtyard, watching.', tier: 'seed' },
        ],
        authoredTreatmentFields: [
          contract('enc-anchor', 'encounter_anchor', 'Two anchors, light then dark — the rooftop bar at sunset on night three; then Cișmigiu at 1am, eight seconds of fog, a shadow, a scream, and a rescue.', ['treatment-enc-1-1']),
          contract('enc-conflict', 'encounter_conflict', 'The rooftop is the new life Kylie wanted, and the park is the cost the city exacts for it.', ['treatment-enc-1-1']),
          contract('park-choice', 'major_choice_pressure', 'In the park when the shadow appears: scream, run, freeze, or fight back — and the next morning, what name do you give him?', ['treatment-enc-1-1']),
        ],
      }),
    ], { episodeNumber: 1 });

    const encounter = result.scenes.find((item) => item.id === 'treatment-enc-1-1')!;
    expect(encounter.authoredTreatmentFields?.find((field) => field.id === 'park-choice')?.requiredRealization).not.toContain('final_prose');

    const density = analyzeEpisodeTreatmentDensity(result.scenes, 1);
    expect(unsafeTreatmentDensityReports(density)).toHaveLength(0);
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
            id: 'treatment-enc-2-1-Story Circle-plotTurn1',
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
    expect(road?.requiredBeats?.map((beat) => beat.id)).toContain('treatment-enc-2-1-Story Circle-plotTurn1-part-3');
    expect(road?.authoredTreatmentFields?.map((field) => field.id)).toContain('ep2-road-pressure');
    expect(result.scenes.flatMap((item) => item.requiredBeats ?? []).map((beat) => beat.id)).not.toContain('treatment-enc-2-1-arc-pressure-arc-late-crisis');
  });

  it('ledgers future endpoint and cliffhanger fields instead of binding them to the episode opening', () => {
    const endpointField = {
      id: 'ep2-end-state-change',
      episodeNumber: 2,
      fieldName: 'end_state_change',
      sourceText: 'The episode cannot be removed because it launches the entire courtship-and-mystery engine of the back half with the Casa Stelarum invitation and Ileana warning.',
      contractKind: 'end_state_change' as const,
      requiredRealization: ['final_prose' as const],
      targetSceneIds: ['s2-1'],
      blockingLevel: 'treatment' as const,
    };
    const cliffhangerField = {
      id: 'ep2-cliffhanger-question',
      episodeNumber: 2,
      fieldName: 'cliffhanger_question',
      sourceText: "Now that Casa Stelarum's invitation is in her inbox, who is the no-photo account warning her that Ileana went missing at his last party?",
      contractKind: 'cliffhanger_question' as const,
      requiredRealization: ['final_prose' as const],
      targetSceneIds: ['s2-1'],
      blockingLevel: 'treatment' as const,
    };
    const result = rebindPlannedSceneObligations([
      scene({
        id: 's2-1',
        episodeNumber: 2,
        title: 'Opening dashboard',
        locations: ["Kylie's Apartment"],
        requiredBeats: [
          {
            id: 's2-1-coldopen1',
            sourceTurn: 'Kylie at her laptop at 11am.',
            mustDepict: 'Kylie at her laptop at 11am, draft titled Three Dates and a Tow Truck, the blog dashboard ticking 84K to 92K.',
            tier: 'coldopen',
          },
          {
            id: 's2-1-seed5',
            sourceTurn: "Stela's Tower/Moon/Lovers tarot, left unexplained.",
            mustDepict: "Stela's Tower/Moon/Lovers tarot, left unexplained.",
            tier: 'seed',
          },
        ],
        authoredTreatmentFields: [endpointField, cliffhangerField],
      }),
      scene({
        id: 's2-6',
        episodeNumber: 2,
        order: 6,
        title: 'Morning inbox',
        narrativeRole: 'release',
        dramaticPurpose: 'The morning after, the inbox pressure points toward the next episode.',
      }),
    ], { episodeNumber: 2 });

    expect(result.scenes.find((item) => item.id === 's2-1')?.authoredTreatmentFields ?? []).toHaveLength(0);
    expect(result.scenes.find((item) => item.id === 's2-6')?.authoredTreatmentFields ?? []).toHaveLength(0);
    expect(result.scenes.find((item) => item.id === 's2-1')?.requiredBeats?.map((beat) => beat.id)).toEqual(['s2-1-coldopen1']);
    expect(result.planLevelAuthoredTreatmentFields.find((field) => field.id === 'ep2-end-state-change')?.targetSceneIds).toEqual([]);
    expect(result.planLevelAuthoredTreatmentFields.find((field) => field.id === 'ep2-cliffhanger-question')?.targetSceneIds).toEqual([]);
  });

  it('moves Victor booth obligations out of a dating-montage scene and into the club scene', () => {
    const victorField = {
      id: 'ep2-victor-booth',
      episodeNumber: 2,
      fieldName: 'lie_pressure',
      sourceText: "Every flattering minute in the booth confirms Kylie's Lie; Victor has read every post, says she should write whatever she likes for now, and she clocks his reaction to the codename.",
      contractKind: 'lie_pressure' as const,
      requiredRealization: ['final_prose' as const],
      targetSceneIds: ['s2-2'],
      blockingLevel: 'treatment' as const,
    };
    const result = rebindPlannedSceneObligations([
      scene({
        id: 's2-2',
        episodeNumber: 2,
        title: 'Three bad dates montage',
        locations: ["Kylie's Apartment"],
        requiredBeats: [
          {
            id: 's2-1-seed4',
            sourceTurn: "The for now in Victor's compliment is the first crack in the blog-vs-Victor conflict.",
            mustDepict: "The for now in Victor's compliment is the first crack in the blog-vs-Victor conflict.",
            tier: 'seed',
          },
        ],
        authoredTreatmentFields: [victorField],
      }),
      scene({
        id: 's2-5',
        episodeNumber: 2,
        order: 5,
        title: 'Victor booth at Vâlcescu Club',
        locations: ['Vâlcescu Club'],
        dramaticPurpose: "Kylie sits in Victor's booth while he talks about food, cities, her grandmother, and her blog.",
      }),
    ], { episodeNumber: 2 });

    expect(result.scenes.find((item) => item.id === 's2-2')?.authoredTreatmentFields ?? []).toHaveLength(0);
    expect(result.scenes.find((item) => item.id === 's2-2')?.requiredBeats ?? []).toHaveLength(0);
    expect(result.scenes.find((item) => item.id === 's2-5')?.authoredTreatmentFields?.map((field) => field.id)).toContain('ep2-victor-booth');
    expect(result.scenes.find((item) => item.id === 's2-5')?.requiredBeats?.map((beat) => beat.id)).toContain('s2-1-seed4');
  });

  it('splits public blog aftermath away from a road-breakdown scene', () => {
    const brandField = {
      id: 'ep2-brand-inbox',
      episodeNumber: 2,
      fieldName: 'consequence_seed',
      sourceText: "The brand-deal inbox and declined Republik profile reveal the blog as a public, sellable, codenamed version of Kylie's life.",
      contractKind: 'consequence_seed' as const,
      requiredRealization: ['final_prose' as const],
      targetSceneIds: ['s2-4'],
      blockingLevel: 'treatment' as const,
    };
    const result = rebindPlannedSceneObligations([
      scene({
        id: 's2-4',
        episodeNumber: 2,
        order: 4,
        title: 'Broken-down mountain road',
        locations: ['Broken-down mountain road near Bran'],
        requiredBeats: [
          {
            id: 's2-4-rb1',
            sourceTurn: 'The research-trip cab breaks down on the mountain road.',
            mustDepict: 'The research-trip cab breaks down on the mountain road and a shy chef in a hand-knit sweater fixes it.',
            tier: 'authored',
          },
          {
            id: 's2-1-seed7',
            sourceTurn: "The brand-deal inbox and the declined Republik profile are the blog's public pressure.",
            mustDepict: "The brand-deal inbox and the declined Republik profile are the blog's public pressure.",
            tier: 'seed',
          },
        ],
        authoredTreatmentFields: [brandField],
      }),
    ], { episodeNumber: 2 });

    const road = result.scenes.find((item) => item.id === 's2-4');
    const publicAftermath = result.scenes.find((item) => item.id === 's2-4-public-blog-aftermath');
    const density = analyzeEpisodeTreatmentDensity(result.scenes, 2);

    expect(road?.requiredBeats?.map((beat) => beat.id)).toEqual(['s2-4-rb1']);
    expect(road?.authoredTreatmentFields ?? []).toHaveLength(0);
    expect(publicAftermath?.requiredBeats?.map((beat) => beat.id)).toContain('s2-1-seed7');
    expect(publicAftermath?.authoredTreatmentFields?.map((field) => field.id)).toContain('ep2-brand-inbox');
    expect(unsafeTreatmentDensityReports(density)).toHaveLength(0);
  });

  it('splits social debrief and late-night writing aftermath out of a primary club conversation scene', () => {
    const result = rebindPlannedSceneObligations([
      scene({
        id: 's2-5',
        episodeNumber: 2,
        order: 5,
        title: 'The long club conversation',
        locations: ['Vâlcescu Club'],
        signatureMoment: 'The first long conversation with Victor at Vâlcescu Club — a velvet booth, candlelight, no clocks, a jazz quartet, a back-room door she clocks exactly once.',
        requiredBeats: [
          {
            id: 's2-5-sig2',
            sourceTurn: 'The first long conversation with Victor at Vâlcescu Club.',
            mustDepict: 'The first long conversation with Victor at Vâlcescu Club — a velvet booth, candlelight, no clocks, a jazz quartet, a back-room door she clocks exactly once.',
            tier: 'signature',
          },
          {
            id: 's2-5-rb1-part-1',
            sourceTurn: 'The Dusk Club convenes at Drăgan Vintage for the debrief.',
            mustDepict: 'The Dusk Club convenes at Drăgan Vintage for the debrief.',
            tier: 'authored',
          },
          {
            id: 's2-5-rb1-part-2',
            sourceTurn: 'Kylie goes home with two men\'s numbers in her phone and, at 3am, writes the chef into the dictionary as *The Mountain*.',
            mustDepict: 'Kylie goes home with two men\'s numbers in her phone and, at 3am, writes the chef into the dictionary as *The Mountain*.',
            tier: 'authored',
          },
        ],
        turnContract: {
          turnId: 's2-5-turn',
          source: 'treatment',
          centralTurn: 'The Dusk Club convenes at Drăgan Vintage for the debrief; Kylie goes home with two men\'s numbers in her phone and, at 3am, writes the chef into the dictionary as *The Mountain*.',
          beforeState: 'The club date is unresolved.',
          turnEvent: 'The social and private aftermath process the club date.',
          afterState: 'Kylie has translated the night into friend lore and blog language.',
          handoff: 'Move to the next invitation.',
        },
      }),
    ], { episodeNumber: 2 });

    const club = result.scenes.find((item) => item.id === 's2-5');
    const debrief = result.scenes.find((item) => item.id === 's2-5-debrief');
    const writing = result.scenes.find((item) => item.id === 's2-5-late-night-writing');
    const density = analyzeEpisodeTreatmentDensity(result.scenes, 2);

    expect(club?.requiredBeats?.map((beat) => beat.id)).toEqual(['s2-5-sig2']);
    expect(club?.turnContract?.centralTurn).toContain('long conversation with Victor');
    expect(club?.turnContract?.centralTurn).not.toContain('Dusk Club convenes');
    expect(club?.turnContract?.centralTurn).not.toContain('3am');
    expect(debrief?.locations).toEqual(['Drăgan Vintage']);
    expect(debrief?.planningOrigin).toMatchObject({
      kind: 'binder_split',
      splitKind: 'friend_debrief',
      parentSceneId: 's2-5',
    });
    expect(debrief?.requiredBeats?.map((beat) => beat.id)).toEqual(['s2-5-rb1-part-1']);
    expect(writing?.locations).toEqual(["Kylie's Lipscani Apartment"]);
    expect(writing?.planningOrigin).toMatchObject({
      kind: 'binder_split',
      splitKind: 'late_night_writing',
      parentSceneId: 's2-5',
    });
    expect(writing?.requiredBeats?.map((beat) => beat.id)).toEqual(['s2-5-rb1-part-2']);
    expect(writing?.turnContract?.centralTurn).toContain('public leverage');
    expect(writing?.turnContract?.turnEvent).toContain('transfers control');
    expect(unsafeTreatmentDensityReports(density)).toHaveLength(0);
    expect(result.report.decisions.some((decision) =>
      decision.contractId === 's2-5-rb1-part-1'
      && decision.toSceneId === 's2-5-debrief'
    )).toBe(true);
    expect(result.report.decisions.some((decision) =>
      decision.contractId === 's2-5-rb1-part-2'
      && decision.toSceneId === 's2-5-late-night-writing'
    )).toBe(true);
  });

  it('does not recursively split binder-created debrief and late-night writing helper scenes', () => {
    const result = rebindPlannedSceneObligations([
      scene({
        id: 's2-5-late-night-writing',
        episodeNumber: 2,
        order: 5.2,
        title: 'Late-night dictionary entry',
        locations: ["Kylie's Lipscani Apartment"],
        dramaticPurpose: 'After the Vâlcescu Club date, Kylie writes the chef into the dictionary as The Mountain.',
        planningOrigin: {
          kind: 'binder_split',
          splitKind: 'late_night_writing',
          parentSceneId: 's2-5',
          reason: 'Split late-night codename writing away from the primary scene to preserve chronology and treatment density.',
        },
        requiredBeats: [
          {
            id: 's2-5-rb1-part-2',
            sourceTurn: 'Kylie goes home with two men\'s numbers in her phone and, at 3am, writes the chef into the dictionary as *The Mountain*.',
            mustDepict: 'Kylie goes home with two men\'s numbers in her phone and, at 3am, writes the chef into the dictionary as *The Mountain*.',
            tier: 'authored',
          },
        ],
      }),
      scene({
        id: 's2-5-debrief',
        episodeNumber: 2,
        order: 5.1,
        title: 'Friend debrief',
        locations: ['Drăgan Vintage'],
        dramaticPurpose: 'After the Vâlcescu Club date, the Dusk Club convenes at Drăgan Vintage for the debrief.',
        planningOrigin: {
          kind: 'binder_split',
          splitKind: 'friend_debrief',
          parentSceneId: 's2-5',
          reason: 'Split the social debrief away from the primary date/conversation scene to preserve scene turn clarity.',
        },
        requiredBeats: [
          {
            id: 's2-5-rb1-part-1',
            sourceTurn: 'The Dusk Club convenes at Drăgan Vintage for the debrief.',
            mustDepict: 'The Dusk Club convenes at Drăgan Vintage for the debrief.',
            tier: 'authored',
          },
        ],
      }),
    ], { episodeNumber: 2 });

    expect(result.scenes.map((item) => item.id)).not.toContain('s2-5-late-night-writing-debrief');
    expect(result.scenes.map((item) => item.id)).not.toContain('s2-5-late-night-writing-late-night-writing');
    expect(result.scenes.map((item) => item.id)).not.toContain('s2-5-debrief-debrief');
    expect(result.scenes.map((item) => item.id)).not.toContain('s2-5-debrief-late-night-writing');
    expect(result.scenes.find((item) => item.id === 's2-5-late-night-writing')?.requiredBeats?.map((beat) => beat.id)).toEqual(['s2-5-rb1-part-2']);
    expect(result.scenes.find((item) => item.id === 's2-5-debrief')?.requiredBeats?.map((beat) => beat.id)).toEqual(['s2-5-rb1-part-1']);
  });

  it('does not recursively split planner-named late-night writing helper scenes that still mention the source date', () => {
    const result = rebindPlannedSceneObligations([
      scene({
        id: 's2-2-late-night-writing',
        episodeNumber: 2,
        order: 2.2,
        title: 'Late-night dictionary entry',
        locations: ["Kylie's Lipscani Apartment"],
        dramaticPurpose: 'After the Vâlcescu Club date, Kylie goes home and writes the chef into the dictionary.',
        requiredBeats: [
          {
            id: 's2-2-rb1-part-2',
            sourceTurn: 'Kylie goes home with two men\'s numbers in her phone and, at 3am, writes the chef into the dictionary as *The Mountain*.',
            mustDepict: 'Kylie goes home with two men\'s numbers in her phone and, at 3am, writes the chef into the dictionary as *The Mountain*.',
            tier: 'authored',
          },
        ],
      }),
    ], { episodeNumber: 2 });

    const writing = result.scenes.find((item) => item.id === 's2-2-late-night-writing');
    expect(result.scenes.map((item) => item.id)).not.toContain('s2-2-late-night-writing-debrief');
    expect(result.scenes.map((item) => item.id)).not.toContain('s2-2-late-night-writing-late-night-writing');
    expect(writing?.requiredBeats?.map((beat) => beat.id)).toEqual(['s2-2-rb1-part-2']);
    expect(writing?.turnContract?.centralTurn).toContain('public leverage');
    expect(writing?.turnContract?.turnEvent).toContain('transfers control');
  });

  it('routes bad-date blog reaction fragments to the debrief lane instead of the late-night codename helper', () => {
    const result = rebindPlannedSceneObligations([
      scene({
        id: 's2-2',
        episodeNumber: 2,
        order: 2,
        title: 'Three terrible dates fail in a row',
        locations: ["Kylie's Apartment"],
        requiredBeats: [
          {
            id: 's2-2-rb1',
            sourceTurn: 'Three terrible dates fail in a row — The Lawyer, The Founder, The Filmmaker — each one fed straight into the blog while the friend group reacts.',
            mustDepict: 'Three terrible dates fail in a row — The Lawyer, The Founder, The Filmmaker — each one fed straight into the blog while the friend group reacts.',
            tier: 'authored',
          },
        ],
      }),
      scene({
        id: 's2-2-debrief',
        episodeNumber: 2,
        order: 2.1,
        title: 'Friend debrief',
        locations: ['Drăgan Vintage'],
      }),
      scene({
        id: 's2-2-late-night-writing',
        episodeNumber: 2,
        order: 2.2,
        title: 'Late-night dictionary entry',
        locations: ["Kylie's Lipscani Apartment"],
      }),
    ], { episodeNumber: 2 });

    const debrief = result.scenes.find((item) => item.id === 's2-2-debrief');
    const writing = result.scenes.find((item) => item.id === 's2-2-late-night-writing');
    expect(debrief?.requiredBeats?.map((beat) => beat.mustDepict)).toEqual(expect.arrayContaining([
      expect.stringContaining('each one fed straight into the blog while the friend group reacts'),
    ]));
    expect(writing?.requiredBeats?.map((beat) => beat.mustDepict) ?? []).not.toEqual(expect.arrayContaining([
      expect.stringContaining('each one fed straight into the blog while the friend group reacts'),
    ]));
  });

  it('rebounds already-split friend/blog reaction fragments off the late-night codename helper', () => {
    const result = rebindPlannedSceneObligations([
      scene({
        id: 's2-2-debrief',
        episodeNumber: 2,
        order: 2.1,
        title: 'Friend debrief',
        locations: ['Drăgan Vintage'],
      }),
      scene({
        id: 's2-2-late-night-writing',
        episodeNumber: 2,
        order: 2.2,
        title: 'Late-night dictionary entry',
        locations: ["Kylie's Lipscani Apartment"],
        requiredBeats: [
          {
            id: 's2-2-rb1-action-3',
            sourceTurn: 'each one fed straight into the blog while the friend group reacts.',
            mustDepict: 'each one fed straight into the blog while the friend group reacts.',
            tier: 'authored',
          },
        ],
      }),
    ], { episodeNumber: 2 });

    const debrief = result.scenes.find((item) => item.id === 's2-2-debrief');
    const writing = result.scenes.find((item) => item.id === 's2-2-late-night-writing');
    expect(debrief?.requiredBeats?.map((beat) => beat.id)).toContain('s2-2-rb1-action-3');
    expect(writing?.requiredBeats?.map((beat) => beat.id) ?? []).not.toContain('s2-2-rb1-action-3');
  });

  it('rebounds friend/blog fragments even when the late-night helper has public-leverage turn text', () => {
    const result = rebindPlannedSceneObligations([
      scene({
        id: 's2-2-debrief',
        episodeNumber: 2,
        order: 2.1,
        title: 'Friend debrief',
        turnContract: {
          turnId: 's2-2-debrief-turn',
          source: 'treatment',
          centralTurn: 'The friend group convenes for a debrief that turns private romantic pressure into public social leverage.',
          beforeState: 'The date is still private pressure.',
          turnEvent: 'The debrief shifts control from private memory to group interpretation, changing what the protagonist can admit, hide, or use.',
          afterState: 'The protagonist carries both the group interpretation and the private pull of the date as competing leverage.',
          handoff: 'Hand forward to the late-night private writing aftermath.',
        },
      }),
      scene({
        id: 's2-2-late-night-writing',
        episodeNumber: 2,
        order: 2.2,
        title: 'Late-night dictionary entry',
        timeOfDay: 'night',
        turnContract: {
          turnId: 's2-2-late-night-writing-turn',
          source: 'treatment',
          centralTurn: 'At home late at night, the protagonist turns two men\'s numbers into a public codename, shifting private desire into public leverage.',
          beforeState: 'The date and debrief have left two numbers and too much meaning in the phone.',
          turnEvent: 'The writing transfers control from the men\'s invitations to her codenamed voice, while making the blog newly valuable and dangerous.',
          afterState: 'Private attraction has become public leverage, future romantic pressure, and a risk Victor cannot fully control.',
          handoff: 'Hand forward to the next invitation or consequence without restaging the date.',
        },
        requiredBeats: [
          {
            id: 's2-2-rb1-action-3',
            sourceTurn: 'each one fed straight into the blog while the friend group reacts.',
            mustDepict: 'each one fed straight into the blog while the friend group reacts.',
            tier: 'authored',
          },
        ],
      }),
    ], { episodeNumber: 2 });

    const debrief = result.scenes.find((item) => item.id === 's2-2-debrief');
    const writing = result.scenes.find((item) => item.id === 's2-2-late-night-writing');
    expect(debrief?.requiredBeats?.map((beat) => beat.id)).toContain('s2-2-rb1-action-3');
    expect(writing?.requiredBeats?.map((beat) => beat.id) ?? []).not.toContain('s2-2-rb1-action-3');
  });

  it('keeps composite choice pressure from adding final-prose density to helper aftermath scenes', () => {
    const result = rebindPlannedSceneObligations([
      scene({
        id: 's2-5-late-night-writing',
        episodeNumber: 2,
        order: 5,
        title: 'Late-night dictionary entry',
        locations: ["Kylie's Lipscani Apartment"],
        narrativeRole: 'release',
        requiredBeats: [
          {
            id: 's2-5-rb1-part-2',
            sourceTurn: 'Kylie goes home with two men\'s numbers in her phone and, at 3am, writes the chef into the dictionary as *The Mountain*.',
            mustDepict: 'Kylie goes home with two men\'s numbers in her phone and, at 3am, writes the chef into the dictionary as *The Mountain*.',
            tier: 'authored',
          },
        ],
        turnContract: {
          turnId: 's2-5-late-night-writing-turn',
          source: 'treatment',
          centralTurn: 'At home late at night, the protagonist writes the new codename into the dictionary.',
          beforeState: 'The date and debrief have left two numbers and too much meaning in the phone.',
          turnEvent: 'The protagonist turns desire and uncertainty into a codename entry.',
          afterState: 'The private night has become blog language and future romantic pressure.',
          handoff: 'Hand forward to the next invitation or consequence without restaging the date.',
        },
        authoredTreatmentFields: [
          {
            id: 'ep2-road-and-codename-choice',
            episodeNumber: 2,
            fieldName: 'major_choice_pressure',
            sourceText: 'On the broken-down country road: accept Radu\'s lift, or wait for the tow; and at 2am with both numbers in her phone, choose the chef\'s codename — *The Mountain*, *The Wolf*, or *The Cab Whisperer*.',
            contractKind: 'major_choice_pressure',
            requiredRealization: ['choice', 'consequence', 'final_prose'],
            targetSceneIds: ['s2-5-late-night-writing'],
            blockingLevel: 'treatment',
          },
          {
            id: 'ep2-club-and-codename-choice',
            episodeNumber: 2,
            fieldName: 'major_choice_pressure',
            sourceText: 'One drink and leave, stay for two, or stay for the 1am back-room jazz — and whether to ask him point-blank what he thinks of his codename.',
            contractKind: 'major_choice_pressure',
            requiredRealization: ['choice', 'consequence', 'final_prose'],
            targetSceneIds: ['s2-5-late-night-writing'],
            blockingLevel: 'treatment',
          },
        ],
      }),
    ], { episodeNumber: 2 });

    const writing = result.scenes.find((item) => item.id === 's2-5-late-night-writing');
    const density = analyzeEpisodeTreatmentDensity(result.scenes, 2);

    expect(writing?.authoredTreatmentFields?.map((field) => field.requiredRealization)).toEqual([
      ['choice', 'consequence'],
      ['choice', 'consequence'],
    ]);
    expect(unsafeTreatmentDensityReports(density)).toHaveLength(0);
  });

  it('scrubs stale arc-pressure bindings during final validation rebinding', () => {
    const midpoint = arcPressure(
      'arc-midpoint',
      'arc_midpoint_recontextualization',
      [2],
      ['s2-1'],
      'The club is a lure and the glamorous new life is a funnel.',
    );
    const lateCrisis = arcPressure(
      'arc-late-crisis',
      'arc_late_crisis',
      [3],
      ['s3-1'],
      'At the Equinox weekend the first crack between her voice and his approval appears.',
    );
    const broadQuestion = arcPressure(
      'arc-question',
      'arc_question',
      [1, 2, 3],
      ['s2-1'],
      'Can Kylie start over after public heartbreak?',
    );
    const result = rebindPlannedSceneObligations([
      scene({
        id: 's2-1',
        episodeNumber: 2,
        title: 'Blog metrics',
        dramaticPurpose: 'The blog numbers climb before Victor pulls Kylie deeper toward the club.',
        arcPressureContracts: [midpoint, lateCrisis, broadQuestion],
        requiredBeats: [
          {
            id: 's2-1-arc-pressure-arc-midpoint',
            sourceTurn: midpoint.sourceText,
            mustDepict: midpoint.sourceText,
            tier: 'authored',
          },
          {
            id: 's2-1-arc-pressure-arc-late-crisis',
            sourceTurn: lateCrisis.sourceText,
            mustDepict: lateCrisis.sourceText,
            tier: 'authored',
          },
        ],
        mechanicPressure: [
          {
            id: `${midpoint.id}-pressure`,
            source: 'treatment',
            domain: 'information',
            mechanicRef: { flag: midpoint.id },
            function: 'intensify',
            storyPressure: midpoint.sourceText,
            evidenceRequired: [midpoint.sourceText],
            visibleResidue: ['changed interpretation'],
            allowedPayoffs: ['reframe'],
            blockedPayoffs: ['summary'],
            originatingSceneId: 's2-1',
          },
          {
            id: `${lateCrisis.id}-pressure`,
            source: 'treatment',
            domain: 'resource',
            mechanicRef: { flag: lateCrisis.id },
            function: 'complicate',
            storyPressure: lateCrisis.sourceText,
            evidenceRequired: [lateCrisis.sourceText],
            visibleResidue: ['approval cracks'],
            allowedPayoffs: ['crisis'],
            blockedPayoffs: ['summary'],
            originatingSceneId: 's2-1',
          },
          {
            id: `${broadQuestion.id}-pressure`,
            source: 'treatment',
            domain: 'flag',
            mechanicRef: { flag: broadQuestion.id },
            function: 'intensify',
            storyPressure: broadQuestion.sourceText,
            evidenceRequired: [broadQuestion.sourceText],
            visibleResidue: ['season pressure'],
            allowedPayoffs: ['season arc'],
            blockedPayoffs: ['summary'],
            originatingSceneId: 's2-1',
          },
        ],
      }),
    ], { episodeNumber: 2 });

    const rebound = result.scenes.find((item) => item.id === 's2-1');
    expect(rebound?.arcPressureContracts?.map((contract) => contract.id)).toEqual(['arc-midpoint']);
    expect(rebound?.requiredBeats?.map((beat) => beat.id)).toEqual(['s2-1-arc-pressure-arc-midpoint']);
    expect(rebound?.mechanicPressure?.map((pressure) => pressure.id)).toEqual(['arc-midpoint-pressure']);
  });
});
