import { describe, expect, it } from 'vitest';
import { buildSeasonScenePlan, scenesForEpisode, edgesForEpisode, bindAuthoredTurnsToScenes } from './seasonScenePlanBuilder';
import type { SeasonPlan, SeasonEpisode } from '../../types/seasonPlan';
import type { PlannedScene } from '../../types/scenePlan';
import type { StructuralRole } from '../../types/sourceAnalysis';

function episode(
  episodeNumber: number,
  structuralRole: StructuralRole[],
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
    structuralRole,
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
    sevenPoint: {
      hook: 'Ordinary world',
      plotTurn1: 'Inciting incident',
      pinch1: 'First setback',
      midpoint: 'Reversal',
      pinch2: 'Crisis',
      climax: 'Confrontation',
      resolution: 'Aftermath',
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
    const p = plan([episode(1, ['hook']), episode(2, ['midpoint'])]);
    const sp = buildSeasonScenePlan(p);

    expect(sp.scenes.length).toBeGreaterThan(0);
    expect(Object.keys(sp.byEpisode).sort()).toEqual(['1', '2']);
    // Each episode has at least the minimum spine.
    expect(scenesForEpisode(sp, 1).length).toBeGreaterThanOrEqual(3);
    expect(scenesForEpisode(sp, 2).length).toBeGreaterThanOrEqual(3);
  });

  it('represents encounters as kind:"encounter" scenes whose id is the encounter id', () => {
    const ep = episode(1, ['climax'], {
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
    const ep = episode(3, ['climax'], {
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
    const p = plan([episode(1, ['hook']), episode(2, ['midpoint']), episode(3, ['climax'])], {
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
    const ep = episode(1, ['hook'], {
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
    // The dramaticPurpose no longer folds the turn text in.
    for (const s of scenes) {
      expect(s.dramaticPurpose).not.toContain('Darian assaults the battlement');
    }
  });

  it('produces a signature device on the anchor scene from the visual anchor', () => {
    const ep = episode(1, ['climax'], {
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
    const ep = episode(1, ['hook'], {
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
    const ep = episode(1, ['hook'], {
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
    const ep = episode(1, ['hook'], {
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

  it('binds the cold open as its own enforceable tier and consequence seeds as advisory seeds (WS1.3)', () => {
    const ep = episode(1, ['hook'], {
      estimatedSceneCount: 4,
      treatmentGuidance: {
        episodeTurns: ['Mika adopts Kylie at the Vâlcescu Club door.'],
        coldOpenFunction: 'A FaceTime to her niece Sadie ("are there vampires in Romania?").',
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
    expect(coldOpenBeats).toHaveLength(1);
    expect(coldOpenBeats[0].mustDepict).toContain('vampires in Romania');
    expect(seedBeats).toHaveLength(2); // the two consequence seeds
    expect(seedBeats.some((b) => b.mustDepict.includes('negroni'))).toBe(true);
    expect(seedBeats.some((b) => b.mustDepict.includes('stray dog'))).toBe(true);
    // The cold open lands on the opening scene.
    expect((scenes[0].requiredBeats ?? []).some((b) => b.tier === 'coldopen' && b.mustDepict.includes('vampires in Romania'))).toBe(true);
  });

  it('pins a scene setting to the location its authored turn names (no collapse-to-first)', () => {
    const ep = episode(1, ['hook'], {
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
    const ep = episode(1, ['hook'], {
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

  it('distributes information-ledger entries touching the episode as advisory seed beats', () => {
    const ep = episode(1, ['hook'], { estimatedSceneCount: 4, treatmentGuidance: { episodeTurns: ['A turn.'] } });
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
    const ep = episode(1, ['hook'], {
      treatmentGuidance: { episodeTurns: ['A single turn.'] },
    });
    const scenes = scenesForEpisode(buildSeasonScenePlan(plan([ep])), 1);
    expect(scenes.flatMap((s) => (s.requiredBeats ?? [])).every((b) => b.tier !== 'seed')).toBe(true);
  });

  it('slices edges that touch a given episode', () => {
    const p = plan([episode(1, ['hook']), episode(2, ['climax'])], {
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
    const ep = episode(3, ['midpoint'], {
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
    const ep = episode(1, ['hook'], {
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
