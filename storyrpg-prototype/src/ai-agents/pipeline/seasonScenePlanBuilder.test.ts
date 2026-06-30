import { describe, expect, it } from 'vitest';
import {
  buildSeasonScenePlan,
  scenesForEpisode,
  edgesForEpisode,
  bindAuthoredTurnsToScenes,
  encounterIsCoveredByAuthoredTurns,
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
    expect(enc.encounter?.description).toBe(longDescription);
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
    expect(firstMeetingContracts.some((c) => c.npcId === 'mika' && ['spark', 'acquaintance'].includes(c.targetStage))).toBe(true);
    expect(firstMeetingContracts.some((c) => c.npcId === 'mika' && c.blockedLabels.includes('friend'))).toBe(true);
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

    expect(contracts.some((c) => c.npcId === 'Mika Dragan')).toBe(true);
    expect(contracts.some((c) => c.npcId === 'Kylie Marinescu')).toBe(false);
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
    expect(encounterScenes[0].encounter?.description).toContain('Cișmigiu Gardens');
    expect((encounterScenes[0].requiredBeats ?? []).some((beat) => beat.mustDepict.includes('pinned to a tree'))).toBe(true);

    const encounterIndex = scenes.findIndex((s) => s.id === 'enc-1');
    const rosesIndex = scenes.findIndex((s) =>
      (s.requiredBeats ?? []).some((beat) => beat.mustDepict.includes('Black roses')),
    );
    expect(encounterIndex).toBeGreaterThanOrEqual(0);
    expect(rosesIndex).toBeGreaterThan(encounterIndex);
    expect(scenes.filter((s) => s.encounter?.description?.includes('Cișmigiu Gardens'))).toHaveLength(1);
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
    expect(encounters[0].encounter?.description).toContain('Cișmigiu at 1am');
    expect(encounters[0].encounter?.description).not.toContain('rooftop bar at sunset');
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
