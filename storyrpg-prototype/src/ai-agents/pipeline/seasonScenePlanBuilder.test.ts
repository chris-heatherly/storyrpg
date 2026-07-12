import { describe, expect, it } from 'vitest';
import {
  buildSeasonScenePlan,
  scenesForEpisode,
  edgesForEpisode,
  bindAuthoredTurnsToScenes,
  compileAuthoredRelationshipMilestones,
  encounterIsCoveredByAuthoredTurns,
  repairRouteCueSceneOrder,
  rebuildTreatmentSeasonScenePlan,
  syncGenericSceneTitlesFromAuthoredBeats,
  projectSpineOntoScenes,
} from './seasonScenePlanBuilder';
import type { SeasonPlan, SeasonEpisode } from '../../types/seasonPlan';
import type { PlannedScene } from '../../types/scenePlan';
import type { StoryCircleBeat } from '../../types/sourceAnalysis';

function episode(
  episodeNumber: number,
  storyCircleRole: StoryCircleBeat[],
  opts: Partial<SeasonEpisode> = {},
): SeasonEpisode {
  return {
    episodeNumber,
    title: `Episode ${episodeNumber}`,
    synopsis: `Synopsis ${episodeNumber}`,
    sourceChapters: [],
    sourceSummary: '',
    plotPoints: [],
    mainCharacters: ['protagonist', 'ally'],
    supportingCharacters: [],
    locations: ['town'],
    estimatedSceneCount: 5,
    estimatedChoiceCount: 3,
    storyCircleRole,
    narrativeFunction: { setup: '', conflict: '', resolution: '' },
    status: 'planned',
    dependsOn: [],
    setupsForEpisodes: [],
    resolvesPlotsFrom: [],
    introducesCharacters: [],
    ...opts,
  } as SeasonEpisode;
}

function plan(episodes: SeasonEpisode[], extra: Partial<SeasonPlan> = {}): SeasonPlan {
  return {
    storyCircle: {
      you: '',
      need: '',
      go: 'Inciting incident',
      search: 'First setback',
      find: 'Reversal',
      take: 'Crisis',
      return: 'Confrontation',
      change: 'Aftermath',
    },
    episodes,
    consequenceChains: [],
    choiceMoments: [],
    informationLedger: [],
    ...extra,
  } as unknown as SeasonPlan;
}

describe('buildSeasonScenePlan', () => {
  it('enumerates scenes per episode at the season level', () => {
    const p = plan([episode(1, ['you']), episode(2, ['find'])]);
    const sp = buildSeasonScenePlan(p);

    expect(sp.scenes.length).toBeGreaterThan(0);
    expect(Object.keys(sp.byEpisode).sort()).toEqual(['1', '2']);
    // Each episode has at least the minimum spine.
    expect(scenesForEpisode(sp, 1).length).toBeGreaterThanOrEqual(3);
    expect(scenesForEpisode(sp, 2).length).toBeGreaterThanOrEqual(3);
  });

  it('uses episode-local treatment pressure before global Story Circle event prose', () => {
    const ep = episode(3, ['go'], {
      title: 'The Weekend',
      synopsis: "Kylie crosses the threshold into Victor's isolated country estate.",
      locations: ["Victor's Estate"],
      treatmentGuidance: {
        episodePromise: 'What does Kylie look like when she lets herself be courted?',
        openingSituation: 'The drive north with Mika in the back seat and Stela texting warnings.',
        synopsis: "Kylie spends the weekend at Victor's estate and notices the first impossible cracks.",
        encounterBuildup: "Victor's attention, the rose garden, the dinner toast, and the unnamed model crying in the powder room.",
        majorChoicePressures: [
          "Publish the pre-weekend post or protect Victor's privacy.",
          'Drink the dark wine or refuse it.',
          'Press Ileana gently or let her go.',
        ],
        encounterAnchors: ['The kiss in the hedge maze at midnight.'],
        endingPressure: "Radu's scarf appears on Kylie's doormat even though she never gave him her address.",
      } as SeasonEpisode['treatmentGuidance'],
      plannedEncounters: [
        {
          id: 'treatment-enc-3-1',
          description: 'The kiss in the hedge maze at midnight.',
          type: 'social',
          difficulty: 'moderate',
          npcsInvolved: ['victor'],
          stakes: 'Kylie risks confusing glamour for safety.',
          relevantSkills: ['empathy'],
          isBranchPoint: false,
        },
      ],
    });

    const sp = buildSeasonScenePlan(plan([ep], {
      storyCircle: {
        you: '',
        need: '',
        go: 'The attack in the park and the rescue by Victor, pulling her into the supernatural web.',
        search: 'First setback',
        find: 'Reversal',
        take: 'Crisis',
        return: 'Confrontation',
        change: 'Aftermath',
      },
    }));
    const standardSceneText = scenesForEpisode(sp, 3)
      .filter((scene) => scene.kind === 'standard')
      .map((scene) => [
        scene.dramaticPurpose,
        scene.turnContract?.centralTurn,
        scene.turnContract?.turnEvent,
      ].join(' '))
      .join('\n');

    expect(standardSceneText).toContain("Victor's estate");
    expect(standardSceneText).toContain('dark wine');
    expect(standardSceneText).not.toMatch(/attack in the park|rescue by Victor|Cismigiu/i);
  });

  it('keeps raw multi-event treatment summaries and season-ledger meta out of scene contracts', () => {
    // Live-run regression (Bite Me ep1, 2026-07-05): the episode guidance
    // synopsis was the whole treatment paragraph (arrival + bookshop + Dusk
    // Club formation + rooftop bar + attack + rescue + viral post) and
    // endingPressure was a season-anchor ledger sentence. Both were joined
    // into EVERY standard scene's dramaticPurpose, overloading s1-2's
    // contract and eventually leaking treatment text into reader prose.
    const broadSynopsis =
      'Kylie arrives in Bucharest with two suitcases and her grandmother\'s address. '
      + 'She explores the streets of Bucharest and wanders into a bookshop owned by Stela who befriends her '
      + 'and introduces Kylie to the secret nightlife world of Valescu Club and her other friend Mika. '
      + 'After testing Kylie, the three become friends and form the Dusk Club. '
      + 'At a rooftop bar she catches the attention of a man in a charcoal suit and a rougher man near the kitchen. '
      + 'Walking home through Cismigiu, she is attacked and rescued by the impossibly handsome stranger. '
      + 'At 4am she turns the night into the first Dating After Dusk post and by evening the post has gone viral.';
    const ep = episode(1, ['you'], {
      title: 'Dating After Dusk',
      synopsis: broadSynopsis,
      treatmentGuidance: {
        episodePromise: 'Can Kylie start over, feel wanted, and write under her own name in a city that is already watching her?',
        synopsis: broadSynopsis,
        endingPressure: "The blog, Dusk Club, Victor's staged courtship, Stela's protection, and Kylie's first authored act all become live season anchors.",
      } as SeasonEpisode['treatmentGuidance'],
    });

    const sp = buildSeasonScenePlan(plan([ep]));

    for (const scene of scenesForEpisode(sp, 1)) {
      const contractText = [scene.dramaticPurpose, scene.stakes, scene.turnContract?.centralTurn].join(' ');
      expect(contractText, `scene ${scene.id} contract carries the multi-event summary`)
        .not.toContain('wanders into a bookshop');
      expect(contractText, `scene ${scene.id} contract carries the multi-event summary`)
        .not.toContain('rooftop bar');
      expect(contractText, `scene ${scene.id} contract carries season-ledger meta`)
        .not.toMatch(/live season anchors/i);
      // The single-question episode promise is still allowed through.
    }
    const allText = scenesForEpisode(sp, 1).map((scene) => scene.dramaticPurpose).join(' ');
    expect(allText).toContain('Can Kylie start over');
  });

  it('represents encounters as kind:"encounter" scenes whose id is the encounter id', () => {
    const ep = episode(1, ['return'], {
      plannedEncounters: [
        {
          id: 'enc-showdown',
          type: 'combat',
          description: 'The rooftop showdown',
          difficulty: 'hard',
          npcsInvolved: ['rival'],
          stakes: 'Survival',
          relevantSkills: ['combat'],
          isBranchPoint: true,
          branchOutcomes: { victory: 'win', partialVictory: 'costly', defeat: 'lose', escape: 'flee' },
        },
      ],
    });
    const sp = buildSeasonScenePlan(plan([ep]));
    const encounterScenes = sp.scenes.filter((s) => s.kind === 'encounter');
    expect(encounterScenes).toHaveLength(1);
    expect(encounterScenes[0].id).toBe('enc-showdown');
    expect(encounterScenes[0].encounter?.type).toBe('combat');
    expect(encounterScenes[0].narrativeRole).toBe('turn');
  });

  it('preserves the full authored encounter description and truncates titles at word boundaries', () => {
    // G12 endsong: the siege anchor was sliced mid-word ("…(wall bre") for the
    // title and the full description was lost, starving EncounterArchitect.
    const longDescription =
      'The siege itself — a sustained defensive set piece (wall breach + repulse) culminating in the strategic choice to evacuate.';
    const centralConflict = "Aethavyr's flawless-protector image is eroded by an unwinnable situation.";
    const ep = episode(3, ['return'], {
      plannedEncounters: [
        {
          id: 'treatment-enc-3-1',
          type: 'combat',
          description: longDescription,
          difficulty: 'hard',
          npcsInvolved: ['aethavyr'],
          stakes: 'The fort, supplies, lives',
          relevantSkills: ['resolve'],
          centralConflict,
          isBranchPoint: false,
        },
      ],
    });
    const sp = buildSeasonScenePlan(plan([ep]));
    const enc = sp.scenes.find((s) => s.id === 'treatment-enc-3-1')!;

    // Full description survives on the encounter sub-object.
    expect(enc.encounter?.sourceSynopsis).toBe(longDescription);
    expect(enc.encounter?.description).toBeUndefined();
    // The brief carries the authored content, not role boilerplate.
    expect(enc.dramaticPurpose).toContain(longDescription);
    expect(enc.dramaticPurpose).toContain(centralConflict);
    // The display title is short and never cut mid-word.
    expect(enc.title.length).toBeLessThanOrEqual(60);
    expect(enc.title).not.toMatch(/\(wall bre$/);
    expect(enc.title.endsWith('…')).toBe(true);
  });

  it('wires forward setup/payoff edges from consequence chains', () => {
    const p = plan([episode(1, ['you']), episode(2, ['find']), episode(3, ['return'])], {
      consequenceChains: [
        {
          id: 'chain-1',
          origin: { episodeNumber: 1, description: 'A bargain struck' },
          consequences: [{ episodeNumber: 3, description: 'The bill comes due', severity: 'dramatic' }],
        },
      ],
    });
    const sp = buildSeasonScenePlan(p);
    const crossEdges = sp.setupPayoffEdges.filter((e) => e.span === 'cross_episode');
    expect(crossEdges).toHaveLength(1);
    const edge = crossEdges[0];
    const from = sp.scenes.find((s) => s.id === edge.from)!;
    const to = sp.scenes.find((s) => s.id === edge.to)!;
    // Forward in time.
    expect(from.episodeNumber).toBe(1);
    expect(to.episodeNumber).toBe(3);
    // The per-scene arrays agree with the edge.
    expect(from.setsUp).toContain(to.id);
    expect(to.paysOff).toContain(from.id);
  });

  it('binds each authored episode turn to a scene as a required beat (no single-string fold)', () => {
    const ep = episode(1, ['you'], {
      estimatedSceneCount: 4,
      treatmentGuidance: {
        episodeTurns: [
          'Darian assaults the battlement',
          'Aethavyr leaps to the rescue on instinct',
          'Lysandra names him Aethavyr',
        ],
      },
    });
    const sp = buildSeasonScenePlan(plan([ep]));
    const scenes = scenesForEpisode(sp, 1);
    const allBeats = scenes.flatMap((s) => s.requiredBeats ?? []);
    // Every authored turn lands as exactly one required beat.
    expect(allBeats.map((b) => b.sourceTurn).sort()).toEqual(
      [
        'Aethavyr leaps to the rescue on instinct',
        'Darian assaults the battlement',
        'Lysandra names him Aethavyr',
      ],
    );
    // Beats are authored-tier and carry mustDepict text.
    for (const beat of allBeats) {
      expect(beat.tier).toBe('authored');
      expect(beat.mustDepict.length).toBeGreaterThan(0);
      expect(beat.id).toMatch(/-rb\d+$/);
    }
    const turnContracts = scenes.map((s) => s.turnContract).filter(Boolean);
    expect(turnContracts.some((contract) => contract?.source === 'treatment' && contract.centralTurn === 'Darian assaults the battlement')).toBe(true);
    expect(turnContracts.some((contract) => contract?.source === 'treatment' && contract.centralTurn === 'Aethavyr leaps to the rescue on instinct')).toBe(true);
    expect(turnContracts.some((contract) => contract?.source === 'treatment' && contract.centralTurn === 'Lysandra names him Aethavyr')).toBe(true);
    // The dramaticPurpose no longer folds the turn text in.
    for (const s of scenes) {
      expect(s.dramaticPurpose).not.toContain('Darian assaults the battlement');
    }
  });

  it('infers turn contracts for non-treatment planned scenes', () => {
    const sp = buildSeasonScenePlan(plan([episode(1, ['you'])]));
    const scenes = scenesForEpisode(sp, 1);

    expect(scenes.length).toBeGreaterThan(0);
    expect(scenes.every((s) => s.turnContract?.centralTurn)).toBe(true);
    expect(scenes.some((s) => s.turnContract?.source === 'planner' || s.turnContract?.source === 'choice')).toBe(true);
  });

  it('does not use broad episode synopsis text as a scene-local choice turn', () => {
    const broadSynopsis = [
      'The blog goes viral and turns the protagonist into public fodder.',
      'After a failed date montage, she finally goes to the velvet club for a two-hour conversation.',
      'Later her cab breaks down on a mountain road and a stranger fixes it before an anonymous warning arrives.',
    ].join(' ');
    const ep = episode(2, ['go'], {
      synopsis: broadSynopsis,
      locations: ['city'],
    });

    const scenes = scenesForEpisode(buildSeasonScenePlan(plan([ep])), 2);
    const opening = scenes[0];

    expect(opening.turnContract?.centralTurn).toBe(opening.dramaticPurpose);
    expect(opening.turnContract?.centralTurn).not.toContain('mountain road');
  });

  it('paces first-meeting treatment relationship turns below earned friendship', () => {
    const ep = episode(1, ['you'], {
      mainCharacters: ['kylie', 'mika', 'stela'],
      treatmentGuidance: {
        episodeTurns: [
          'Mika adopts Kylie at the door of Vâlcescu Club, swaps out her American shoes, and hands her a key card to the side entrance.',
          'At a Lipscani bookshop, Stela presses a chunk of rose quartz into Kylie’s hand — this one wants to be with you, love — and the Dusk Club is now three.',
        ],
      },
    });
    const sp = buildSeasonScenePlan(plan([ep]));
    const scenes = scenesForEpisode(sp, 1);

    const firstMeetingContracts = scenes.flatMap((s) => s.relationshipPacing ?? []);
    expect(firstMeetingContracts.some((c) => c.npcId === 'char-mika' && ['spark', 'acquaintance'].includes(c.targetStage))).toBe(true);
    expect(firstMeetingContracts.some((c) => c.npcId === 'char-mika' && c.blockedLabels.includes('friend'))).toBe(true);
    expect(firstMeetingContracts.some((c) => c.groupId === 'dusk-club' && c.allowedLabels.includes('provisional name'))).toBe(true);
    expect(firstMeetingContracts.every((c) => c.targetStage !== 'trusted_ally' && c.targetStage !== 'intimate')).toBe(true);
  });

  it('does not advance repeated group mentions past acquaintance without relationship-choice evidence', () => {
    const ep = episode(1, ['you'], {
      estimatedSceneCount: 5,
      mainCharacters: ['protagonist', 'ally-a', 'ally-b'],
      treatmentGuidance: {
        episodeTurns: [
          'At the station, the protagonist hears a circle name used as a dare, not a settled bond.',
          'At the archive, ally-a repeats the circle name while testing whether the protagonist listens.',
          'At the cafe, ally-b jokes that the circle could become useful if everyone survives the week.',
          'At the alley door, the circle name carries tension but no one has chosen membership yet.',
          'At the safehouse, the circle still feels provisional until someone risks something for it.',
        ],
      },
    });
    const sp = buildSeasonScenePlan(plan([ep]));
    const groupContracts = scenesForEpisode(sp, 1)
      .flatMap((scene) => scene.relationshipPacing ?? [])
      .filter((contract) => contract.groupId);

    expect(groupContracts.length).toBeGreaterThan(1);
    expect(groupContracts.every((contract) => ['spark', 'acquaintance'].includes(contract.targetStage))).toBe(true);
    expect(groupContracts.every((contract) => contract.targetStage !== 'tentative_ally')).toBe(true);
  });

  it('fails plan-time compatibility when a binding friendship/group milestone has no prior introduction', () => {
    const scene = {
      id: 's1-1',
      episodeNumber: 1,
      order: 0,
      kind: 'standard',
      title: 'Instant Club',
      dramaticPurpose: 'The group forms.',
      narrativeRole: 'turn',
      locations: ['club'],
      npcsInvolved: ['mika', 'stela'],
      setsUp: [],
      paysOff: [],
      requiredBeats: [{
        id: 's1-1-rb1',
        sourceTurn: 'After testing Kylie, Mika and Stela become friends with her and form the Dusk Club.',
        mustDepict: 'After testing Kylie, Mika and Stela become friends with her and form the Dusk Club.',
        tier: 'authored',
      }],
    } as PlannedScene;

    expect(() => compileAuthoredRelationshipMilestones([scene]))
      .toThrow(/no compatible earning path/);
  });

  it('does not create relationship pacing contracts for the protagonist', () => {
    const ep = episode(1, ['you'], {
      mainCharacters: ['Kylie Marinescu', 'Mika Dragan'],
      treatmentGuidance: {
        episodeTurns: [
          'Mika adopts Kylie at the door of Vâlcescu Club, swaps out her American shoes, and hands her a key card to the side entrance.',
        ],
      },
    });
    const sp = buildSeasonScenePlan(plan([ep], {
      protagonist: { id: 'char-kylie-marinescu', name: 'Kylie Marinescu', description: '' },
    } as any));
    const contracts = scenesForEpisode(sp, 1).flatMap((s) => s.relationshipPacing ?? []);

    expect(contracts.some((c) => c.npcId === 'char-mika-dragan')).toBe(true);
    expect(contracts.some((c) => c.npcId === 'char-kylie-marinescu' || c.npcId === 'Kylie Marinescu')).toBe(false);
  });

  it('produces a signature device on the anchor scene from the visual anchor', () => {
    const ep = episode(1, ['return'], {
      estimatedSceneCount: 4,
      treatmentGuidance: {
        episodeTurns: ['The duel begins'],
        visualAnchor: 'The joined-blood archive floor lights up',
      },
      plannedEncounters: [
        {
          id: 'enc-duel',
          type: 'combat',
          description: 'rooftop duel',
          difficulty: 'hard',
          npcsInvolved: ['rival'],
          stakes: 'survival',
          relevantSkills: ['combat'],
          isBranchPoint: true,
        },
      ],
    });
    const sp = buildSeasonScenePlan(plan([ep]));
    const scenes = scenesForEpisode(sp, 1);
    // The signature lands on the encounter (the episode's hinge/anchor).
    const anchor = scenes.find((s) => s.kind === 'encounter')!;
    expect(anchor.signatureMoment).toBe('The joined-blood archive floor lights up');
    // And it is also a discrete tier:'signature' required beat for the validator.
    const sigBeats = (anchor.requiredBeats ?? []).filter((b) => b.tier === 'signature');
    expect(sigBeats).toHaveLength(1);
    expect(sigBeats[0].mustDepict).toBe('The joined-blood archive floor lights up');
    // No other scene carries the signature.
    for (const s of scenes.filter((x) => x.id !== anchor.id)) {
      expect(s.signatureMoment).toBeUndefined();
    }
  });

  it('falls back to majorChoicePressures + encounterAnchors when the treatment has no episodeTurns', () => {
    // The bite-me treatment schema authors per-episode beats via "Major choice
    // pressure" + "Encounter anchor" and carries no "Episode turns" section, so
    // episodeTurns/visualAnchor parse empty. The binding must still engage.
    const ep = episode(1, ['you'], {
      estimatedSceneCount: 4,
      treatmentGuidance: {
        episodeTurns: [],
        majorChoicePressures: [
          'Accept Andrei\'s invitation to dinner, or politely deflect',
          'Follow Mika to the back room, or stay at the booth',
          'Cut through the park, or take the long way home',
        ],
        encounterAnchors: ['The first night at Vâlcescu — meeting Andrei across a candlelit booth'],
      },
    });
    const sp = buildSeasonScenePlan(plan([ep]));
    const scenes = scenesForEpisode(sp, 1);
    const allBeats = scenes.flatMap((s) => s.requiredBeats ?? []);
    // The choice-pressure beats are bound as authored required beats (none dropped).
    const authored = allBeats.filter((b) => b.tier === 'authored');
    expect(authored.map((b) => b.sourceTurn).sort()).toEqual([
      'Accept Andrei\'s invitation to dinner, or politely deflect',
      'Cut through the park, or take the long way home',
      'Follow Mika to the back room, or stay at the booth',
    ]);
    // The encounter anchor becomes the signature device, even with no visualAnchor.
    const sig = allBeats.find((b) => b.tier === 'signature');
    expect(sig?.mustDepict).toContain('candlelit booth');
    expect(scenes.some((s) => s.signatureMoment?.includes('candlelit booth'))).toBe(true);
  });

  it('budgets enough scenes to carry more authored turns than the estimate', () => {
    const ep = episode(1, ['you'], {
      estimatedSceneCount: 3,
      treatmentGuidance: {
        episodeTurns: Array.from({ length: 9 }, (_, i) => `Turn ${i + 1}`),
      },
    });
    const sp = buildSeasonScenePlan(plan([ep]));
    const scenes = scenesForEpisode(sp, 1);
    // All 9 turns are bound, none dropped.
    const allBeats = scenes.flatMap((s) => s.requiredBeats ?? []);
    expect(allBeats).toHaveLength(9);
    const treatmentContracts = scenes.filter((s) => s.turnContract?.source === 'treatment');
    expect(treatmentContracts).toHaveLength(9);
    // Scene count grew beyond the estimate (and the normal 8 cap) to fit them.
    expect(scenes.length).toBeGreaterThan(3);
  });

  it('binds each authored turn to the scene that dramatizes it, not its positional slot (bite-me-g13 off-by-one)', () => {
    // The LLM scene plan authors a connective opening scene ("arrival") that maps to
    // NO authored turn, which used to cascade every turn one scene early — landing the
    // bookshop turn on the nightclub scene. Content-matched binding fixes the alignment.
    const richScene = (id: string, title: string, dramaticPurpose: string, location: string): PlannedScene => ({
      id,
      episodeNumber: 1,
      order: 0,
      kind: 'standard',
      title,
      dramaticPurpose,
      narrativeRole: 'development',
      locations: [location],
      npcsInvolved: [],
      setsUp: [],
      paysOff: [],
    });
    const scenes: PlannedScene[] = [
      richScene('s1-1', 'Veronica\'s Address', 'Kylie arrives in Bucharest with two suitcases and her grandmother\'s address.', 'apartment courtyard'),
      richScene('s1-2', 'American Shoes', 'Mika adopts Kylie at the door of the Vâlcescu Club and swaps her shoes.', 'Vâlcescu Club door'),
      richScene('s1-3', 'The Stone That Wants You', 'At the Lipscani bookshop Stela presses rose quartz into Kylie\'s hand.', 'Lumina Books, Lipscani'),
    ];
    const ep = episode(1, ['you'], {
      treatmentGuidance: {
        episodeTurns: [
          'Mika adopts Kylie at the door of the Vâlcescu Club and swaps out her American shoes.',
          'At a Lipscani bookshop, Stela presses a chunk of rose quartz into Kylie\'s hand.',
        ],
      },
    } as Partial<SeasonEpisode>);

    bindAuthoredTurnsToScenes(ep, scenes);

    const beatScene = (needle: string): string | undefined =>
      scenes.find((s) => (s.requiredBeats ?? []).some((b) => b.mustDepict.includes(needle)))?.id;
    // The Vâlcescu turn lands on the Vâlcescu scene; the bookshop turn on the bookshop scene.
    expect(beatScene('Vâlcescu Club')).toBe('s1-2');
    expect(beatScene('rose quartz')).toBe('s1-3');
    // The connective arrival scene carries no authored turn.
    expect(scenes.find((s) => s.id === 's1-1')?.requiredBeats ?? []).toHaveLength(0);
  });

  it('merges authored turns that duplicate the cold-open hook so later events keep their own scenes (bite-me run #7)', () => {
    const ep = episode(1, ['you'], {
      estimatedSceneCount: 4,
      storyCircleRole: [{ beat: 'you' }] as never,
      treatmentGuidance: {
        episodeTurns: [
          'Kylie arrives in Bucharest with two suitcases and her grandmother address.',
          'She forms the Dusk Club with Mika and Stela over velvet booths and negronis.',
          'At a rooftop bar she catches the attention of a man in a charcoal suit.',
        ],
      },
    });
    const scenes = scenesForEpisode(buildSeasonScenePlan(plan([ep], {
      storyCircle: {
        you: 'Kylie arrives in Bucharest with two suitcases, her grandmother address, and the intent to rebuild. '
          + 'She turns the night into her first viral post.',
        need: '', go: '', search: '', find: '', take: '', return: '', change: '',
      },
    })), 1);

    // Release-scene turns are composed boilerplate that quotes episode text
    // ("Let the fallout settle into the next pressure: …") — a separate known
    // filler class; spine binding only targets content scenes.
    const sceneFacts = scenes.filter((s) => s.narrativeRole !== 'release').map((s) => ({
      id: s.id,
      turn: String(s.turnContract?.turnEvent ?? ''),
      authored: (s.requiredBeats ?? []).filter((b) => b.tier === 'authored').map((b) => String(b.mustDepict)),
      coldopen: (s.requiredBeats ?? []).filter((b) => b.tier === 'coldopen').length,
    }));
    const hookOwner = sceneFacts.find((s) => s.coldopen > 0);
    // The description's arrival sentence duplicates the cold-open hook: no
    // OTHER scene may carry the arrival as its turn or an authored beat.
    const arrivalElsewhere = sceneFacts.filter((s) =>
      s.id !== hookOwner?.id
      && (/two suitcases/.test(s.turn) || s.authored.some((t) => /two suitcases/.test(t))));
    expect(arrivalElsewhere).toHaveLength(0);
    // The formation therefore owns a scene of its own (as its primary turn or
    // an authored beat), distinct from the hook owner.
    const formationOwner = sceneFacts.find((s) =>
      /Dusk Club/.test(s.turn) || s.authored.some((t) => /Dusk Club/.test(t)));
    expect(formationOwner).toBeDefined();
    expect(formationOwner!.id).not.toBe(hookOwner?.id);
  });

  it('floors the pacing start stage for treatment-declared prior bonds (bite-me 2026-07-02 Mika)', () => {
    const ep = episode(1, ['you'], {
      estimatedSceneCount: 4,
      mainCharacters: ['Mika Dragan', 'Stela Pavel'],
      treatmentGuidance: {
        episodeTurns: ['Mika Dragan pulls Kylie into a hug and adopts her into the group over negronis.'],
      },
    });
    const p = plan([ep], {
      sourceCanon: {
        facts: [{
          id: 'canon-npc-npc_profile-char-mika-dragan',
          domain: 'npc',
          kind: 'npc_profile',
          subjectId: 'char-mika-dragan',
          value: {
            name: 'Mika Dragan',
            role: 'ally',
            relationshipToProtagonist: "Kylie's best friend, placed in Kylie's life before Kylie arrived.",
          },
        }, {
          id: 'canon-npc-npc_profile-char-stela-pavel',
          domain: 'npc',
          kind: 'npc_profile',
          subjectId: 'char-stela-pavel',
          value: {
            name: 'Stela Pavel',
            role: 'ally',
            relationshipToProtagonist: 'The reliable truth source Kylie meets at the bookshop.',
          },
        }],
      } as never,
    });
    const scenes = scenesForEpisode(buildSeasonScenePlan(p), 1);

    const contracts = scenes.flatMap((s) => s.relationshipPacing ?? []);
    const mika = contracts.find((c) => c.npcId && /mika/i.test(String(c.npcId)));
    const stela = contracts.find((c) => c.npcId && /stela/i.test(String(c.npcId)));
    expect(mika).toBeDefined();
    // Declared prior bond: warm-familiar language allowed from scene one.
    expect(['acquaintance', 'tentative_ally', 'friend', 'trusted_ally', 'intimate']).toContain(mika!.startStage);
    expect(mika!.blockedLabels).not.toContain('friend');
    // No declared bond: the positional ladder still applies.
    if (stela) {
      expect(['unmet', 'noticed', 'spark']).toContain(stela.startStage);
      expect(stela.blockedLabels).toContain('friend');
    }
  });

  it('scopes the story-circle cold-open hook to the first sentence, not the whole-episode summary (bite-me 2026-07-02)', () => {
    const youText = 'Kylie Marinescu arrives in Bucharest as a charming, wounded observer with two suitcases and the intent to rebuild. '
      + 'She forms the Dusk Club, starts Dating After Dusk, and turns a terrifying rescue by Mr. Midnight into the first viral proof that she can author a new life.';
    const ep = episode(1, ['you'], {
      estimatedSceneCount: 4,
      // The hook condition reads role.beat — pass the object shape real season
      // plans carry (the helper's bare-string shorthand never triggers the hook).
      storyCircleRole: [{ beat: 'you' }] as never,
      treatmentGuidance: { episodePromise: 'Reinvention under new eyes.' },
    });
    const scenes = scenesForEpisode(buildSeasonScenePlan(plan([ep], {
      storyCircle: {
        you: youText, need: '', go: '', search: '', find: '', take: '', return: '', change: '',
      },
    })), 1);

    const coldOpenBeats = scenes.flatMap((s) => (s.requiredBeats ?? []).filter((b) => b.tier === 'coldopen'));
    expect(coldOpenBeats.length).toBeGreaterThan(0);
    const joined = coldOpenBeats.map((b) => b.mustDepict).join(' ');
    expect(joined).toContain('arrives in Bucharest');
    // The later spine events must NOT be part of the opening scene's mustDepict.
    expect(joined).not.toContain('Dusk Club');
    expect(joined).not.toContain('viral proof');
  });

  it('never uses a question-shaped encounter anchor as the signature device (bite-me 2026-07-03 s1-5 INVERTED)', () => {
    const ep = episode(1, ['you'], {
      estimatedSceneCount: 4,
      treatmentGuidance: {
        episodeTurns: ['Walking home through the park, she is attacked and rescued by a stranger.'],
        encounterAnchors: [
          'Can Kylie start over, feel wanted, and write under her own name in a city that is already watching her?',
          'Walking home through the park, she is attacked and rescued by a stranger.',
        ],
      },
    });
    const scenes = scenesForEpisode(buildSeasonScenePlan(plan([ep])), 1);

    const signatures = scenes
      .map((s) => s.signatureMoment)
      .filter((value): value is string => Boolean(value));
    for (const signature of signatures) {
      expect(signature).not.toContain('Can Kylie start over');
    }
    const signatureBeats = scenes.flatMap((s) => (s.requiredBeats ?? []).filter((b) => b.tier === 'signature'));
    for (const beat of signatureBeats) {
      expect(String(beat.mustDepict)).not.toContain('Can Kylie start over');
    }
  });

  it('scopes a run-on single-sentence You beat to its first event and never pins the arrival to a later venue (bite-me 2026-07-02T23-54-38)', () => {
    // One giant sentence mixing arrival + club imagery: the hook must carry
    // only the arrival event, and the opening scene's location must not be
    // re-pinned to the club named later in the sentence.
    const youText = 'Kylie Marinescu arrives in Bucharest as a charming, wounded observer with two suitcases, '
      + 'hiding behind her grandmother address and a cancelled engagement, defaulting to letting others choose her '
      + 'while sipping dark negronis at the Valescu Club with Mika.';
    const ep = episode(1, ['you'], {
      estimatedSceneCount: 4,
      locations: ['Valescu Club', 'Lipscani Apartment'],
      storyCircleRole: [{ beat: 'you' }] as never,
      treatmentGuidance: { episodePromise: 'Reinvention under new eyes.' },
    });
    const scenes = scenesForEpisode(buildSeasonScenePlan(plan([ep], {
      storyCircle: {
        you: youText, need: '', go: '', search: '', find: '', take: '', return: '', change: '',
      },
    })), 1);

    const opening = scenes.find((s) => (s.requiredBeats ?? []).some((b) => b.tier === 'coldopen'));
    expect(opening).toBeDefined();
    const hook = (opening!.requiredBeats ?? []).find((b) => b.tier === 'coldopen')!;
    expect(String(hook.mustDepict)).toContain('arrives in Bucharest');
    // The club clause belongs to a later event, not the arrival hook.
    expect(String(hook.mustDepict)).not.toMatch(/negronis|Valescu Club/);
    expect(opening!.locations ?? []).not.toContain('Valescu Club');
  });

  it('binds concrete cold-open beats and consequence seeds without treatment labels (WS1.3)', () => {
    const ep = episode(1, ['you'], {
      estimatedSceneCount: 4,
      treatmentGuidance: {
        episodeTurns: ['Mika adopts Kylie at the Vâlcescu Club door.'],
        coldOpenFunction: 'Hook — Kylie unpacks in a Belle Époque walk-up as the sun sets through the Lipscani window; promise — reinvention, glamour, a city that owes her a better story; stakes — a FaceTime to her niece Sadie ("are there vampires in Romania?").',
        consequenceSeeds: [
          'Mika\'s house negroni one shade too dark.',
          'The stray dog in the courtyard, watching.',
        ],
      },
    });
    const scenes = scenesForEpisode(buildSeasonScenePlan(plan([ep])), 1);
    const seedBeats = scenes.flatMap((s) => (s.requiredBeats ?? []).filter((b) => b.tier === 'seed'));
    const coldOpenBeats = scenes.flatMap((s) => (s.requiredBeats ?? []).filter((b) => b.tier === 'coldopen'));
    // Cold open is split out from the generic seeds so it can be enforced on its own (WS1.3).
    expect(coldOpenBeats.map((beat) => beat.mustDepict)).toEqual([
      'Kylie unpacks in a Belle Époque walk-up as the sun sets through the Lipscani window; a FaceTime to her niece Sadie ("are there vampires in Romania?").',
    ]);
    expect(coldOpenBeats.map((beat) => beat.mustDepict).join(' ')).not.toMatch(/\bHook\s*—|\bpromise\s*—|\bstakes\s*—/i);
    expect(seedBeats).toHaveLength(2); // the two consequence seeds
    expect(seedBeats.some((b) => b.mustDepict.includes('negroni'))).toBe(true);
    expect(seedBeats.some((b) => b.mustDepict.includes('stray dog'))).toBe(true);
    // The cold open remains a single enforceable beat after rebind/repair.
    expect(coldOpenBeats).toHaveLength(1);
  });

  it('pins a scene setting to the location its authored turn names (no collapse-to-first)', () => {
    const ep = episode(1, ['you'], {
      estimatedSceneCount: 4,
      locations: ['Kylie\'s Lipscani Apartment', 'Vâlcescu Club', 'Cișmigiu Gardens', 'Lumina Books'],
      treatmentGuidance: {
        episodeTurns: [
          'The Dusk Club gathers at the Vâlcescu Club door.',
          'At a Lipscani bookshop, Stela presses a chunk of rose quartz into Kylie\'s hand.',
          'Walking home through Cișmigiu Gardens at 1am, a shadow strikes.',
        ],
      },
    });
    const scenes = scenesForEpisode(buildSeasonScenePlan(plan([ep])), 1);
    const sceneOf = (needle: string) =>
      scenes.find((s) => (s.requiredBeats ?? []).some((b) => b.mustDepict.includes(needle)));
    // The Cișmigiu turn's scene is set to Cișmigiu Gardens, not the first location.
    expect(sceneOf('Cișmigiu')?.locations).toEqual(['Cișmigiu Gardens']);
    expect(sceneOf('Vâlcescu Club')?.locations).toEqual(['Vâlcescu Club']);
    expect(sceneOf('rose quartz')?.locations).toEqual(['Lumina Books']);
    expect(sceneOf('rose quartz')?.locations).not.toEqual(['Kylie\'s Lipscani Apartment']);
  });

  it('pins fallback major-choice pressure scenes to named locations', () => {
    const ep = episode(1, ['you'], {
      estimatedSceneCount: 5,
      locations: ['Kylie\'s Lipscani Apartment', 'Vâlcescu Club', 'Cișmigiu Gardens', 'Lumina Books'],
      treatmentGuidance: {
        episodeTurns: [],
        majorChoicePressures: [
          'Mika adopts Kylie at the door of Vâlcescu Club on night two.',
          'At a Lipscani bookshop, Stela presses a chunk of rose quartz into Kylie\'s hand.',
          'Walking home through Cișmigiu Gardens at 1am, a shadow strikes.',
        ],
      },
    });
    const scenes = scenesForEpisode(buildSeasonScenePlan(plan([ep])), 1);
    const sceneOf = (needle: string) =>
      scenes.find((s) => (s.requiredBeats ?? []).some((b) => b.mustDepict.includes(needle)));

    expect(sceneOf('Vâlcescu')?.locations).toEqual(['Vâlcescu Club']);
    expect(sceneOf('rose quartz')?.locations).toEqual(['Lumina Books']);
    expect(sceneOf('Cișmigiu')?.locations).toEqual(['Cișmigiu Gardens']);
  });

  it('infers authored Bite Me venues when episode locations only name the apartment', () => {
    const ep = episode(1, ['you'], {
      estimatedSceneCount: 5,
      locations: ['Kylie\'s Lipscani Apartment'],
      treatmentGuidance: {
        majorChoicePressures: [
          "Accept Mika's key card or leave the club untouched.",
          "Accept Stela's quartz or refuse the warding invitation.",
          "Walk over to Victor or follow Mika's warning.",
        ],
        encounterAnchors: [
          'The rooftop bar at sunset where the Dusk Club locks into place.',
          'Cismigiu at 1am — fog, a shadow, a scream, a rescue.',
        ],
      },
      plannedEncounters: [
        {
          id: 'treatment-enc-1-1',
          type: 'social',
          description: 'The rooftop bar at sunset where the Dusk Club locks into place.',
          difficulty: 'easy',
        } as any,
        {
          id: 'treatment-enc-1-2',
          type: 'romantic',
          description: 'Cismigiu at 1am — fog, a shadow, a scream, a rescue.',
          difficulty: 'easy',
        } as any,
      ],
    });
    const scenes = scenesForEpisode(buildSeasonScenePlan(plan([ep], {
      storyCircle: {
        you: '',
        need: '',
        go: '',
        search: '',
        find: '',
        take: '',
        return: '',
        change: '',
      },
    })), 1);
    const keyCardScene = scenes.find((s) =>
      (s.requiredBeats ?? []).some((beat) => beat.mustDepict.includes('key card'))
    );
    const openingScene = scenes.find((s) => s.narrativeRole === 'setup');
    const rooftop = scenes.find((s) => s.id === 'treatment-enc-1-1');
    const cismigiu = scenes.find((s) => s.id === 'treatment-enc-1-2');
    expect(openingScene?.requiredBeats?.some((beat) => beat.mustDepict.includes('forms the Dusk Club'))).toBe(false);
    expect(keyCardScene?.locations).toEqual(['Vâlcescu Club']);
    expect(rooftop?.locations).toEqual(['Rooftop Bar']);
    expect(cismigiu?.locations).toEqual(['Cișmigiu Gardens']);
  });

  it('promotes a treatment-covered Bite Me attack encounter instead of appending a repeat', () => {
    const biteEncounter = {
      id: 'enc-1',
      type: 'chase',
      description: "A terrifying flight through the fog-choked Cișmigiu Gardens to escape unseen attackers, ending in Victor's staged rescue.",
      difficulty: 'moderate',
      npcsInvolved: ['Victor'],
      stakes: "Kylie's physical safety and her fragile new start in Bucharest.",
      relevantSkills: ['athletics', 'awareness'],
      isBranchPoint: false,
      branchOutcomes: {
        victory: 'Kylie gets away with Victor controlling the story.',
        defeat: 'Kylie is rescued but shaken badly.',
      },
    } as any;
    const authoredTurns = [
      'Kylie unpacks, calls Sadie, and tries to make Romania feel temporary.',
      'Mika adopts Kylie at the door of Vâlcescu Club and hands her a key card.',
      'At Lumina Books, Stela presses rose quartz into Kylie’s hand.',
      'On the rooftop bar, Victor and Radu watch Kylie too carefully.',
      'Walking home through Cișmigiu Gardens at 1am, Kylie is attacked by a shadow, pinned to a tree, and rescued by a man in a charcoal suit who walks her home and vanishes.',
      'Unable to sleep, Kylie writes the first Dating After Dusk post about Mr. Midnight; by morning it has gone viral.',
      'Black roses and a cream-stock card arrive at Kylie’s apartment door just as Stela calls with a nightmare and an herb warning.',
    ];
    expect(encounterIsCoveredByAuthoredTurns(biteEncounter, authoredTurns)).toBe(true);

    const ep = episode(1, ['you'], {
      estimatedSceneCount: 7,
      locations: ["Kylie's Lipscani Apartment", 'Vâlcescu Club', 'Lumina Books', 'Rooftop Bar', 'Cișmigiu Gardens'],
      mainCharacters: ['Kylie', 'Mika', 'Stela', 'Victor', 'Radu'],
      treatmentGuidance: { episodeTurns: authoredTurns },
      plannedEncounters: [biteEncounter],
    });
    const scenes = scenesForEpisode(buildSeasonScenePlan(plan([ep])), 1);
    const encounterScenes = scenes.filter((s) => s.kind === 'encounter');
    expect(encounterScenes).toHaveLength(1);
    expect(encounterScenes[0].id).toBe('enc-1');
    expect(encounterScenes[0].encounter?.sourceSynopsis).toContain('Cișmigiu Gardens');
    expect(encounterScenes[0].encounter?.description).toBeUndefined();
    expect((encounterScenes[0].requiredBeats ?? []).some((beat) => beat.mustDepict.includes('pinned to a tree'))).toBe(true);

    const encounterIndex = scenes.findIndex((s) => s.id === 'enc-1');
    const rosesIndex = scenes.findIndex((s) =>
      (s.requiredBeats ?? []).some((beat) => beat.mustDepict.includes('Black roses')),
    );
    expect(encounterIndex).toBeGreaterThanOrEqual(0);
    expect(rosesIndex).toBeGreaterThan(encounterIndex);
    expect(scenes.filter((s) => s.encounter?.sourceSynopsis?.includes('Cișmigiu Gardens'))).toHaveLength(1);
  });

  it('keeps an uncovered planned encounter as a standalone encounter scene', () => {
    const ep = episode(1, ['you'], {
      treatmentGuidance: {
        episodeTurns: ['Mika gives Kylie a key card at the club.', 'Stela sells Kylie a chunk of rose quartz.'],
      },
      plannedEncounters: [{
        id: 'enc-later',
        type: 'chase',
        description: 'A midnight chase through the old park ends in a rescue.',
        difficulty: 'moderate',
        npcsInvolved: ['Victor'],
        stakes: 'Survival',
        relevantSkills: ['athletics'],
        isBranchPoint: false,
      } as any],
    });
    const scenes = scenesForEpisode(buildSeasonScenePlan(plan([ep])), 1);
    expect(scenes.filter((s) => s.kind === 'encounter' && s.id === 'enc-later')).toHaveLength(1);
  });

  it('does not treat setup-only foreshadowing as encounter coverage', () => {
    const encounter = {
      id: 'enc-park',
      type: 'chase',
      description: 'The park attack forces Kylie to flee until Victor rescues her.',
      difficulty: 'moderate',
      npcsInvolved: ['Victor'],
      stakes: 'Survival',
      relevantSkills: ['athletics'],
      isBranchPoint: false,
    } as any;
    expect(encounterIsCoveredByAuthoredTurns(encounter, [
      'Victor watches from the rooftop while danger in the park is foreshadowed.',
    ])).toBe(false);
  });

  it('distributes information-ledger entries touching the episode as advisory seed beats', () => {
    const ep = episode(1, ['you'], { estimatedSceneCount: 4, treatmentGuidance: { episodeTurns: ['A turn.'] } });
    const informationLedger = [
      { id: 'INFO-E', label: 'The blog is the thing Victor cannot control; he keeps his face out of every frame', description: 'An unphotographable man.', introducedEpisode: 1, setupTouchEpisodes: [2, 3] },
      { id: 'INFO-C', label: "Victor's Nature", description: 'Victor is a strigoi who casts no reflection.', introducedEpisode: 1, setupTouchEpisodes: [3, 4] },
      { id: 'INFO-G', label: 'A Strigoi Mama watches the line', description: 'Older entity.', introducedEpisode: 8, setupTouchEpisodes: [] },
    ] as any;
    const scenes = scenesForEpisode(buildSeasonScenePlan(plan([ep], { informationLedger })), 1);
    const seedBeats = scenes.flatMap((s) => (s.requiredBeats ?? []).filter((b) => b.tier === 'seed'));
    // INFO-E touches ep1 (introduced) → planted; INFO-G (ep8 only) → absent.
    expect(seedBeats.some((b) => b.mustDepict.includes('keeps his face out of every frame'))).toBe(true);
    expect(seedBeats.some((b) => b.mustDepict.includes('casts no reflection'))).toBe(true);
    expect(seedBeats.some((b) => b.mustDepict === "Victor's Nature")).toBe(false);
    expect(seedBeats.some((b) => b.mustDepict.includes('Strigoi Mama'))).toBe(false);
  });

  it('emits no seed beats when the treatment carries no cold open / consequence seeds (golden-stable)', () => {
    const ep = episode(1, ['you'], {
      treatmentGuidance: { episodeTurns: ['A single turn.'] },
    });
    const scenes = scenesForEpisode(buildSeasonScenePlan(plan([ep])), 1);
    expect(scenes.flatMap((s) => (s.requiredBeats ?? [])).every((b) => b.tier !== 'seed')).toBe(true);
  });

  it('slices edges that touch a given episode', () => {
    const p = plan([episode(1, ['you']), episode(2, ['return'])], {
      consequenceChains: [
        {
          id: 'c',
          origin: { episodeNumber: 1, description: 'x' },
          consequences: [{ episodeNumber: 2, description: 'y', severity: 'noticeable' }],
        },
      ],
    });
    const sp = buildSeasonScenePlan(p);
    expect(edgesForEpisode(sp, 1).length).toBe(1);
    expect(edgesForEpisode(sp, 2).length).toBe(1);
  });
});

describe('bindAuthoredTurnsToScenes — encounter scenes get no spine turns (bite-me-g18)', () => {
  const mkScene = (id: string, kind: 'standard' | 'encounter', narrativeRole: string): PlannedScene => ({
    id, episodeNumber: 3, order: 0, kind, title: id, dramaticPurpose: 'x',
    narrativeRole, locations: [], npcsInvolved: [], setsUp: [], paysOff: [],
  } as unknown as PlannedScene);

  it('binds authored turns ONLY to standard scenes, never the encounter anchor', () => {
    const ep = episode(3, ['find'], {
      treatmentGuidance: {
        episodeTurns: [
          'At the club the night locks into place.',
          'In the hedge maze at midnight the kiss happens.',
          'At Sunday breakfast Victor reframes the blog as a privacy problem.',
        ],
      },
    } as Partial<SeasonEpisode>);
    const scenes = [mkScene('s3-1', 'standard', 'setup'), mkScene('enc-3-1', 'encounter', 'turn'), mkScene('s3-4', 'standard', 'turn')];
    bindAuthoredTurnsToScenes(ep, scenes);
    const enc = scenes.find((s) => s.kind === 'encounter')!;
    // The encounter anchor carries NO authored spine turn (g18: the Sunday-breakfast turn
    // landed here and made EncounterAnchorContentValidator demand an un-depictable beat).
    expect((enc.requiredBeats ?? []).filter((b) => b.tier === 'authored')).toHaveLength(0);
    // The turns are still bound — on the standard prose scenes that can dramatize them.
    const authoredOnStd = scenes
      .filter((s) => s.kind !== 'encounter')
      .flatMap((s) => (s.requiredBeats ?? []).filter((b) => b.tier === 'authored'));
    expect(authoredOnStd.length).toBeGreaterThan(0);
  });

  it('folds composite treatment encounters into the authored scene that owns the event', () => {
    const ep = episode(1, ['you'], {
      estimatedSceneCount: 6,
      locations: ['Lipscani', 'Rooftop Bar', 'Cismigiu Gardens'],
      treatmentGuidance: {
        episodeTurns: [
          'Mika adopts Kylie at the door of Valcescu Club and hands her a key card.',
          'Stela presses a chunk of rose quartz into Kylie\'s hand at a Lipscani bookshop.',
          'At a rooftop bar at sunset, the Dusk Club locks into place and Kylie catches Victor watching her.',
          'Walking home through Cișmigiu at 1am, Kylie is pinned to a willow by a shadow and Victor rescues her.',
          'At 4am, Kylie launches Dating After Dusk and Mr. Midnight goes viral by sunset.',
        ],
        encounterAnchors: [
          'Two anchors, light then dark — the rooftop bar at sunset where the Dusk Club locks into place; then Cișmigiu at 1am, a shadow, a scream, and a rescue.',
        ],
      },
      plannedEncounters: [
        {
          id: 'treatment-enc-1-1',
          type: 'dramatic',
          description: 'Two anchors, light then dark — the rooftop bar at sunset where the Dusk Club locks into place; then Cișmigiu at 1am, a shadow, a scream, and a rescue.',
          centralConflict: 'The rooftop is the new life Kylie crossed an ocean for, and the park is the cost the city exacts for it; attention, safety, beauty, authorship, glamour, hunger, performance, romance, reinvention, and danger all twist together.',
          difficulty: 'moderate',
          npcsInvolved: ['Victor'],
          stakes: 'The city hunts back.',
          relevantSkills: ['awareness'],
          isBranchPoint: true,
        },
      ],
    } as Partial<SeasonEpisode>);

    const scenes = scenesForEpisode(buildSeasonScenePlan(plan([ep])), 1);
    const encounters = scenes.filter((scene) => scene.kind === 'encounter');
    expect(encounters).toHaveLength(1);
    expect(encounters[0].id).toBe('treatment-enc-1-1');
    expect(encounters[0].requiredBeats?.some((beat) => beat.mustDepict.includes('Cișmigiu at 1am'))).toBe(true);
    expect(encounters[0].requiredBeats?.some((beat) => beat.tier === 'signature')).toBe(false);
    expect(encounters[0].encounter?.sourceSynopsis).toContain('Cișmigiu at 1am');
    expect(encounters[0].encounter?.sourceSynopsis).not.toContain('rooftop bar at sunset');
    expect(encounters[0].encounter?.description).toBeUndefined();
    expect(scenes.filter((scene) => scene.id === 'treatment-enc-1-1')).toHaveLength(1);
  });
});

describe('mechanic pressure contracts', () => {
  it('turns treatment mechanics such as key cards and quartz into story-pressure contracts', () => {
    const ep = episode(1, ['you'], {
      locations: ['Vâlcescu Club', 'Lumina Books'],
      mainCharacters: ['mika', 'stela'],
      treatmentGuidance: {
        episodeTurns: [
          'Mika adopts Kylie at the door of Vâlcescu Club, swaps out her American shoes, and hands her a key card to the side entrance.',
          'At Lumina Books, Stela presses rose quartz into Kylie\'s hand and calls the Dusk Club three.',
        ],
      },
    } as Partial<SeasonEpisode>);

    const scenes = scenesForEpisode(buildSeasonScenePlan(plan([ep])), 1);
    const pressure = scenes.flatMap((scene) => scene.mechanicPressure ?? []);

    expect(pressure.some((contract) => contract.source === 'treatment' && contract.domain === 'item')).toBe(true);
    expect(pressure.some((contract) => contract.domain === 'relationship' && contract.blockedPayoffs.some((payoff) => /friend|trusted|inner/i.test(payoff)))).toBe(true);
  });

  it('adds pressure contracts to non-treatment choice scenes', () => {
    const ep = episode(1, ['you'], {
      estimatedSceneCount: 3,
      synopsis: 'A decision about the locked archive changes what the player can learn.',
    } as Partial<SeasonEpisode>);

    const scenes = scenesForEpisode(buildSeasonScenePlan(plan([ep])), 1);
    const choiceScenes = scenes.filter((scene) => scene.hasChoice);

    expect(choiceScenes.length).toBeGreaterThan(0);
    expect(choiceScenes.every((scene) => (scene.mechanicPressure ?? []).length > 0)).toBe(true);
  });
});

describe('repairRouteCueSceneOrder (plan-retry rung, bite-me 2026-07-03T18-19-01 regression)', () => {
  const planned = (id: string, order: number, beatText: string, kind = 'standard') => ({
    id,
    episodeNumber: 1,
    order,
    kind,
    title: id,
    dramaticPurpose: 'x',
    locations: [],
    npcsInvolved: [],
    setsUp: [],
    paysOff: [],
    stakes: 'x',
    requiredBeats: [{ id: `${id}-rb1`, tier: 'authored', mustDepict: beatText, sourceTurn: beatText }],
    // Ownership derives from slotted sources; the turn contract is the
    // primary_turn slot real planned scenes carry.
    turnContract: {
      turnId: `${id}-turn`, source: 'treatment', centralTurn: beatText, turnEvent: beatText,
      beforeState: 'x', afterState: 'x', handoff: 'x',
    },
  }) as never;

  it('swaps an inverted adjacent standard pair (socialMeet before arrival)', () => {
    const scenes = [
      planned('s1-1', 0, 'Kylie forms the Dusk Club with Mika and Stela over velvet booths and negronis.'),
      planned('s1-2', 1, 'Kylie arrives in Bucharest with two suitcases and her grandmother\'s address.'),
    ];
    const swaps = repairRouteCueSceneOrder(scenes as never, 1);
    expect(swaps).toBeGreaterThanOrEqual(1);
    expect((scenes[0] as { id: string }).id).toBe('s1-2');
    expect((scenes[0] as { order: number }).order).toBe(0);
    expect((scenes[1] as { id: string }).id).toBe('s1-1');
    expect((scenes[1] as { order: number }).order).toBe(1);
  });

  it('leaves a chronologically ordered plan untouched', () => {
    const scenes = [
      planned('s1-1', 0, 'Kylie arrives in Bucharest with two suitcases.'),
      planned('s1-2', 1, 'Kylie forms the Dusk Club with Mika and Stela over velvet booths.'),
    ];
    expect(repairRouteCueSceneOrder(scenes as never, 1)).toBe(0);
    expect((scenes[0] as { id: string }).id).toBe('s1-1');
  });

  it('does not move encounter scenes (setup-pair placement is not repairable here)', () => {
    const scenes = [
      planned('s1-1', 0, 'Walking home she is attacked in the park and rescued by a stranger.', 'encounter'),
      planned('s1-2', 1, 'Kylie arrives in Bucharest with two suitcases.'),
    ];
    expect(repairRouteCueSceneOrder(scenes as never, 1)).toBe(0);
    expect((scenes[0] as { id: string }).id).toBe('s1-1');
  });

  it('converges deterministically when two scenes share a route cue (bite-me 2026-07-04 oscillation)', () => {
    // s1-1 owns {arrival, socialMeet}, s1-2 owns {arrival}: the old
    // first-inversion swap loop flip-flopped these forever (every ordering of
    // the PAIR contains an inversion under the per-event walk unless the
    // shorter sequence comes first). Lexicographic sort settles it: {arrival}
    // before {arrival, socialMeet}, and repeated calls are a fixed point.
    const build = () => [
      planned('s1-1', 0, 'Kylie arrives in Bucharest and that same week forms the Dusk Club with Mika and Stela over velvet booths.'),
      planned('s1-2', 1, 'Kylie arrives in Bucharest with two suitcases and her grandmother\'s address.'),
    ];
    const scenes = build();
    repairRouteCueSceneOrder(scenes as never, 1);
    const firstPassIds = scenes.map((scene) => (scene as { id: string }).id);

    // Fixed point: a second call must not move anything.
    expect(repairRouteCueSceneOrder(scenes as never, 1)).toBe(0);
    expect(scenes.map((scene) => (scene as { id: string }).id)).toEqual(firstPassIds);

    // Deterministic: rebuilding from scratch reaches the same order.
    const rebuilt = build();
    repairRouteCueSceneOrder(rebuilt as never, 1);
    expect(rebuilt.map((scene) => (scene as { id: string }).id)).toEqual(firstPassIds);
  });
});

describe('projectSpineOntoScenes', () => {
  it('realigns shifted authored beats and turn contracts to explicit ESC ownership', () => {
    const makeScene = (id: string, order: number, authoredText: string): PlannedScene => ({
      id, episodeNumber: 1, order, kind: 'standard', title: id,
      dramaticPurpose: id, narrativeRole: 'development', locations: [], npcsInvolved: [], setsUp: [], paysOff: [],
      requiredBeats: [{ id: `${id}-rb1`, sourceTurn: authoredText, mustDepict: authoredText, tier: 'authored' }],
      turnContract: {
        turnId: `${id}-turn`, source: 'treatment', centralTurn: authoredText,
        beforeState: 'before', turnEvent: authoredText, afterState: 'after', handoff: `After ${authoredText}`,
      },
    });
    const scenes = [
      makeScene('s1-4', 3, 'The three become friends and form the Dusk Club.'),
      makeScene('s1-5', 4, 'At the rooftop, two strangers notice Kylie.'),
      makeScene('s1-6', 5, 'At the rooftop, two strangers notice Kylie.'),
    ];
    scenes[0].requiredBeats!.push({
      id: 's1-4-identity', sourceTurn: 'Keep the stranger anonymous.', mustDepict: 'Keep the stranger anonymous.',
      tier: 'authored', contractKind: 'identity_constraint',
    });
    const spine = {
      episodeNumber: 1, sourceHash: 'source', episodeStoryCircleBeats: ['you' as const], polarityFacets: [],
      units: [
        { id: 'ep1-u4', order: 3, text: 'Testing Kylie.', kind: 'test' as const, storyCircleFacets: [], prerequisites: [], sceneKind: 'standard' as const },
        { id: 'ep1-u5', order: 4, text: 'The three become friends and form the Dusk Club.', kind: 'bond' as const, storyCircleFacets: [], prerequisites: ['ep1-u4'], sceneKind: 'standard' as const },
        { id: 'ep1-u6', order: 5, text: 'At the rooftop, two strangers notice Kylie.', kind: 'development' as const, storyCircleFacets: [], prerequisites: ['ep1-u5'], sceneKind: 'standard' as const },
      ],
    };

    expect(projectSpineOntoScenes(scenes, spine)).toBe(3);
    for (const [index, scene] of scenes.entries()) {
      const unit = spine.units[index];
      expect(scene.spineUnitId).toBe(unit.id);
      expect(scene.turnContract?.centralTurn).toBe(unit.text);
      expect(scene.turnContract?.turnEvent).toBe(unit.text);
      expect(scene.requiredBeats?.some((beat) => beat.tier === 'authored' && beat.contractKind !== 'identity_constraint' && beat.mustDepict === unit.text)).toBe(true);
      expect(scene.requiredBeats?.filter((beat) =>
        beat.contractKind !== 'identity_constraint'
        && spine.units.some((candidate) => candidate.text === beat.mustDepict),
      ).map((beat) => beat.mustDepict)).toEqual([unit.text]);
    }
    expect(scenes[0].requiredBeats?.find((beat) => beat.contractKind === 'identity_constraint')?.mustDepict)
      .toBe('Keep the stranger anonymous.');
    expect(scenes[0].requiredBeats?.some((beat) => beat.mustDepict.includes('Dusk Club'))).toBe(false);
  });

  it('syncs a treatment scene title from final event ownership, not a stale pre-binding beat', () => {
    const scene = {
      id: 's1-street',
      episodeNumber: 1,
      order: 2,
      kind: 'standard',
      spineUnitId: 'ep1-u3',
      title: 'She enters the bookshop and meets Stela',
      dramaticPurpose: 'The street encounter changes the route.',
      narrativeRole: 'turn',
      locations: ['Old Town street'],
      npcsInvolved: [],
      setsUp: [],
      paysOff: [],
      hasChoice: false,
      requiredBeats: [{
        id: 'stale-bookshop',
        tier: 'authored',
        sourceTurn: 'She enters the bookshop and meets Stela.',
        mustDepict: 'She enters the bookshop and meets Stela.',
      }],
      sceneEventOwnership: {
        id: 's1-street-ownership',
        sceneId: 's1-street',
        ownedEvents: [{
          key: 'cue:antagonistContact',
          cue: 'antagonistContact',
          text: 'Across the street, she catches her first clear sight of the watcher.',
          sourceContractIds: ['ep1-u3'],
        }],
        incomingContext: [],
        outgoingResidue: [],
        forbiddenRestageEvents: [],
        sourceContractIds: ['ep1-u3'],
        diagnostics: [],
        promptGuidance: [],
      },
    } as PlannedScene;

    expect(syncGenericSceneTitlesFromAuthoredBeats([scene])).toBe(1);
    expect(scene.title).toContain('first clear sight of the watcher');
    expect(scene.title).not.toContain('bookshop');
  });

  it('assigns spineUnitId and staged_rescue encounterProfile onto matching scenes', () => {
    const ep = episode(1, ['you'], {
      locations: ['Bucharest', 'Lumina Books', 'Vâlcescu Club', 'Cișmigiu Gardens', 'Kylie Apartment'],
      treatmentGuidance: {
        sourceKind: 'authored_lite',
        episodeTurns: [
          'She explores the streets of Bucharest.',
          'She wanders into a bookshop owned by Stela who befriends her.',
          'After testing Kylie, the three become friends and form the Dusk Club.',
          'Walking home through Cismigiu Gardens, Kylie is attacked and Victor rescues her.',
        ],
      },
    });
    const sp = buildSeasonScenePlan(plan([ep]));
    const scenes = scenesForEpisode(sp, 1);
    expect(scenes.some((scene) => scene.spineUnitId)).toBe(true);
    const rescue = scenes.find((scene) => scene.encounterProfile === 'staged_rescue' || scene.encounter?.encounterProfile === 'staged_rescue');
    expect(rescue).toBeDefined();
    expect(sp.sourceHash).toBeTruthy();
    expect(sp.episodeSpines?.[1]?.units.some((unit) => unit.kind === 'test')).toBe(true);
  });

  it('projects ESC unit order onto scene.order (test before bond before rescue)', () => {
    const ep = episode(1, ['you'], {
      locations: ['Bucharest', 'Lumina Books', 'Vâlcescu Club', 'Cișmigiu Gardens', 'Kylie Apartment'],
      treatmentGuidance: {
        sourceKind: 'authored_lite',
        episodeTurns: [
          'She explores the streets of Bucharest.',
          'She wanders into a bookshop owned by Stela who befriends her.',
          'After testing Kylie, the three become friends and form the Dusk Club.',
          'On the rooftop bar at sunset, two suitors compete for her attention.',
          'Walking home through Cismigiu Gardens, Kylie is attacked and Victor rescues her.',
          'At 4am she writes the blog post as Mr. Midnight.',
          'By evening the post goes viral at the club.',
        ],
      },
    });
    const sp = buildSeasonScenePlan(plan([ep]));
    const spine = sp.episodeSpines?.[1];
    expect(spine).toBeDefined();
    const projected = scenesForEpisode(sp, 1)
      .filter((scene) => scene.spineUnitId)
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    const unitOrders = projected.map((scene) => spine!.units.find((unit) => unit.id === scene.spineUnitId)!.order);
    for (let i = 1; i < unitOrders.length; i += 1) {
      expect(unitOrders[i]).toBeGreaterThan(unitOrders[i - 1]);
    }
    const kindsInSceneOrder = projected.map((scene) => spine!.units.find((unit) => unit.id === scene.spineUnitId)!.kind);
    const testAt = kindsInSceneOrder.indexOf('test');
    const bondAt = kindsInSceneOrder.indexOf('bond');
    const writingAt = kindsInSceneOrder.indexOf('late_night_writing');
    const aftermathAt = kindsInSceneOrder.indexOf('aftermath');
    if (testAt >= 0 && bondAt >= 0) expect(testAt).toBeLessThan(bondAt);
    if (writingAt >= 0 && aftermathAt >= 0) expect(writingAt).toBeLessThan(aftermathAt);
    expect(projected.some((scene) => scene.hasChoice)).toBe(true);
    const milestoneOwner = projected.find((scene) =>
      (scene.relationshipPacing ?? []).some((contract) => contract.milestone?.kind === 'group_formation')
    );
    expect(milestoneOwner?.choiceType).toBe('relationship');
    const milestone = milestoneOwner?.relationshipPacing?.find((contract) => contract.milestone)?.milestone;
    expect(milestone).toMatchObject({
      subjectId: 'dusk-club',
      targetStage: 'friend',
      choiceSceneId: milestoneOwner?.id,
    });
    expect(milestone?.introductionSceneIds.length).toBeGreaterThan(0);
    expect(milestone?.testSceneIds.length).toBeGreaterThan(0);
    for (const scene of projected.filter((candidate) => candidate.id !== milestoneOwner?.id)) {
      expect(scene.dramaticPurpose).not.toMatch(/become friends and form the Dusk Club/i);
      expect(scene.stakes ?? '').not.toMatch(/become friends and form the Dusk Club/i);
      expect((scene.mechanicPressure ?? []).map((pressure) => pressure.storyPressure).join(' '))
        .not.toMatch(/become friends and form the Dusk Club/i);
    }
  });

  it('keeps the opening scene mapped to the first ESC unit after authored turn binding', () => {
    const ep = episode(1, ['you'], {
      locations: ['Bucharest', 'Lumina Books', 'Vâlcescu Club', 'Cișmigiu Gardens', "Kylie's Apartment"],
      treatmentGuidance: {
        sourceKind: 'authored_lite',
        episodeTurns: [
          "Kylie arrives in Bucharest with two suitcases and her grandmother's address.",
          'She explores the streets of Bucharest.',
          'She wanders into a bookshop owned by Stela who befriends her.',
          'After testing Kylie, the three become friends and form the Dusk Club.',
          'At a rooftop bar she catches the attention of a man in a charcoal suit.',
          'Walking home through Cismigiu Gardens, Kylie is attacked and Victor rescues her.',
          'At 4am she writes the first Dating After Dusk post.',
          'By evening the post has gone viral.',
        ],
      },
    });
    const scenePlan = buildSeasonScenePlan(plan([ep]));
    const spine = scenePlan.episodeSpines?.[1];
    const scenes = scenesForEpisode(scenePlan, 1).filter((scene) => scene.spineUnitId);

    expect(scenes[0]).toMatchObject({ id: 's1-1', spineUnitId: spine?.units[0]?.id, order: 0 });
    expect(scenes.map((scene) => scene.spineUnitId)).toEqual(
      spine?.units
        .filter((unit) => scenes.some((scene) => scene.spineUnitId === unit.id))
        .map((unit) => unit.id),
    );
  });

  it('keeps a projected scene for every ESC bond/test unit after surplus trim (Bite Me ep1)', () => {
    const ep = episode(1, ['you'], {
      estimatedSceneCount: 6,
      locations: ['Bucharest', 'Lumina Books', 'Vâlcescu Club', 'Cișmigiu Gardens', "Kylie's Apartment"],
      treatmentGuidance: {
        sourceKind: 'authored_lite',
        episodeTurns: [
          "Kylie arrives in Bucharest with two suitcases and her grandmother's address.",
          'She explores the streets of Bucharest and wanders into a bookshop owned by Stela who befriends her and introduces Kylie to the secret nightlife world of Valescu Club and her other friend Mika.',
          'After testing Kylie, the three become friends and form the Dusk Club.',
          'At a rooftop bar she catches the attention of a man in a charcoal suit and a rougher man near the kitchen.',
          'Walking home through Cismigiu, she is attacked and rescued by the impossibly handsome stranger, who walks her to her threshold and vanishes.',
          'At 4am she turns the night into the first Dating After Dusk post under the codename Mr. Midnight, and by evening the post has gone viral.',
        ],
      },
    });
    const sp = buildSeasonScenePlan(plan([ep]));
    const spine = sp.episodeSpines?.[1];
    expect(spine).toBeDefined();
    const bond = spine!.units.find((unit) => unit.kind === 'bond');
    const test = spine!.units.find((unit) => unit.kind === 'test');
    expect(bond).toBeDefined();
    expect(test).toBeDefined();
    const scenes = scenesForEpisode(sp, 1);
    expect(scenes.some((scene) => scene.spineUnitId === bond!.id)).toBe(true);
    expect(scenes.some((scene) => scene.spineUnitId === test!.id)).toBe(true);
  });

  it('replays ESC turn alignment while migrating a stale cached narrative compiler plan', () => {
    const ep = episode(1, ['you'], {
      estimatedSceneCount: 6,
      locations: ['Bucharest', 'Lumina Books', 'Valescu Club', 'Cismigiu Gardens', "Kylie's Apartment"],
      treatmentGuidance: {
        sourceKind: 'authored_lite',
        episodeTurns: [
          "Kylie arrives in Bucharest with two suitcases and her grandmother's address.",
          'She explores Bucharest and meets Stela and Mika.',
          'After testing Kylie, the three become friends and form the Dusk Club.',
          'At a rooftop bar two strangers notice Kylie.',
          'Walking home, Kylie is attacked and rescued.',
          'At 4am she writes the first Dating After Dusk post.',
        ],
      },
    });
    const sourcePlan = plan([ep]);
    const scenePlan = buildSeasonScenePlan(sourcePlan);
    const cached = JSON.parse(JSON.stringify({
      ...sourcePlan,
      scenePlan,
      episodes: [{ ...ep, plannedScenes: scenesForEpisode(scenePlan, 1) }],
    })) as SeasonPlan;
    const spine = cached.scenePlan!.episodeSpines![1];
    const testUnit = spine.units.find((unit) => unit.kind === 'test')!;
    const bondUnit = spine.units.find((unit) => unit.kind === 'bond')!;
    const nextUnit = spine.units.find((unit) => unit.order === bondUnit.order + 1)!;
    const testScene = cached.scenePlan!.scenes.find((scene) => scene.spineUnitId === testUnit.id)!;
    const bondScene = cached.scenePlan!.scenes.find((scene) => scene.spineUnitId === bondUnit.id)!;
    const shiftTurn = (scene: PlannedScene, text: string): void => {
      scene.requiredBeats = [{ id: `${scene.id}-rb1`, sourceTurn: text, mustDepict: text, tier: 'authored' }];
      scene.turnContract = {
        turnId: `${scene.id}-turn`, source: 'treatment', centralTurn: text,
        beforeState: 'before', turnEvent: text, afterState: 'after', handoff: `After ${text}`,
      };
    };
    shiftTurn(testScene, bondUnit.text);
    shiftTurn(bondScene, nextUnit.text);
    cached.scenePlan!.narrativeContractGraph!.compilerVersion = 'narrative-contract-compiler-v6';

    const migrated = rebuildTreatmentSeasonScenePlan(cached);
    const migratedTest = migrated.scenePlan!.scenes.find((scene) => scene.spineUnitId === testUnit.id)!;
    const migratedBond = migrated.scenePlan!.scenes.find((scene) => scene.spineUnitId === bondUnit.id)!;
    for (const unit of spine.units.filter((candidate) => candidate.sceneKind !== 'encounter')) {
      const owner = migrated.scenePlan!.scenes.find((scene) => scene.spineUnitId === unit.id)!;
      expect(owner.turnContract?.centralTurn, unit.id).toBe(unit.text);
    }
    expect(migratedTest.turnContract?.centralTurn).toBe(testUnit.text);
    expect(migratedTest.requiredBeats?.some((beat) => beat.mustDepict === bondUnit.text)).toBe(false);
    expect(migratedBond.turnContract?.centralTurn).toBe(bondUnit.text);
    expect(migratedBond.requiredBeats?.some((beat) => beat.mustDepict === bondUnit.text)).toBe(true);
  });

  it('floors authored-lite scenes to ESC standard units so meet/threshold are not orphaned (Bite Me ep3)', () => {
    const ep = episode(3, ['search'], {
      estimatedSceneCount: 3,
      locations: ["Victor's Estate", 'Bucharest', "Kylie's Lipscani Apartment"],
      treatmentGuidance: {
        sourceKind: 'authored_lite',
        episodeTurns: [
          'Victor gently frames the blog as a privacy problem, asking for her discretion.',
          'Beneath the romance she notices a crying model, a strange photograph, and a locked wing.',
          "Kylie returns to Bucharest feeling lucky and finds Radu's hand-knit scarf on her doorstep.",
        ],
      },
    });
    const sp = buildSeasonScenePlan(plan([ep]));
    const spine = sp.episodeSpines?.[3];
    expect(spine).toBeDefined();
    const standardUnits = spine!.units.filter((unit) => unit.sceneKind !== 'encounter');
    const scenes = scenesForEpisode(sp, 3);
    const mapped = new Set(scenes.map((scene) => scene.spineUnitId).filter(Boolean));
    for (const unit of standardUnits) {
      expect(mapped.has(unit.id), `missing projection for ${unit.id} (${unit.kind})`).toBe(true);
    }
  });

  it('skips rebuildTreatmentSeasonScenePlan when sourceHash is unchanged', () => {
    const ep = episode(1, ['you'], {
      treatmentGuidance: {
        sourceKind: 'authored_lite',
        episodeTurns: ['She arrives in Bucharest with two suitcases.'],
      },
    });
    const first = rebuildTreatmentSeasonScenePlan(plan([ep]));
    const second = rebuildTreatmentSeasonScenePlan(first);
    expect(second.scenePlan).toBe(first.scenePlan);
  });
});
