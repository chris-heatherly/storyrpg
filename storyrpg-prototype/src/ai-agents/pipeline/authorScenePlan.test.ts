import { describe, expect, it } from 'vitest';
import { normalizeAuthoredScenePlan, buildScenePlanPrompt } from './authorScenePlan';
import type { SeasonPlan, SeasonEpisode } from '../../types/seasonPlan';
import type { StructuralRole } from '../../types/sourceAnalysis';

function episode(num: number, role: StructuralRole[], opts: Partial<SeasonEpisode> = {}): SeasonEpisode {
  return {
    episodeNumber: num,
    title: `Episode ${num}`,
    synopsis: `Synopsis ${num}`,
    sourceChapters: [],
    sourceSummary: '',
    plotPoints: [],
    mainCharacters: ['protagonist'],
    supportingCharacters: [],
    locations: ['town'],
    estimatedSceneCount: 4,
    estimatedChoiceCount: 3,
    structuralRole: role,
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
    sevenPoint: { hook: 'h', plotTurn1: 'p1', pinch1: 'pi1', midpoint: 'm', pinch2: 'pi2', climax: 'c', resolution: 'r' },
    episodes,
    consequenceChains: [],
    choiceMoments: [],
    informationLedger: [],
    ...extra,
  } as unknown as SeasonPlan;
}

describe('normalizeAuthoredScenePlan', () => {
  it('returns null for garbage', () => {
    expect(normalizeAuthoredScenePlan(null, plan([episode(1, ['hook'])]))).toBeNull();
    expect(normalizeAuthoredScenePlan({ nope: true }, plan([episode(1, ['hook'])]))).toBeNull();
  });

  it('normalizes a well-formed authored plan and keeps forward setup/payoff', () => {
    const p = plan([episode(1, ['hook']), episode(2, ['climax'])]);
    const raw = {
      episodes: [
        {
          episodeNumber: 1,
          scenes: [
            { id: 's1-1', kind: 'standard', title: 'Open', dramaticPurpose: 'establish', narrativeRole: 'setup', setsUp: ['s2-1'] },
            { id: 's1-2', kind: 'standard', title: 'Build', narrativeRole: 'development' },
          ],
        },
        {
          episodeNumber: 2,
          scenes: [
            { id: 's2-1', kind: 'standard', title: 'Payoff', narrativeRole: 'payoff' },
          ],
        },
      ],
    };
    const sp = normalizeAuthoredScenePlan(raw, p)!;
    expect(sp).not.toBeNull();
    const s11 = sp.scenes.find((s) => s.id === 's1-1')!;
    const s21 = sp.scenes.find((s) => s.id === 's2-1')!;
    expect(s11.setsUp).toContain('s2-1');
    // reciprocal paysOff rebuilt from setsUp
    expect(s21.paysOff).toContain('s1-1');
    expect(sp.setupPayoffEdges.some((e) => e.from === 's1-1' && e.to === 's2-1' && e.span === 'cross_episode')).toBe(true);
  });

  it('drops a backward (earlier-episode) setup', () => {
    const p = plan([episode(1, ['hook']), episode(2, ['climax'])]);
    const raw = {
      episodes: [
        { episodeNumber: 1, scenes: [{ id: 's1-1', title: 'A', narrativeRole: 'setup' }] },
        { episodeNumber: 2, scenes: [{ id: 's2-1', title: 'B', narrativeRole: 'turn', setsUp: ['s1-1'] }] },
      ],
    };
    const sp = normalizeAuthoredScenePlan(raw, p)!;
    const s21 = sp.scenes.find((s) => s.id === 's2-1')!;
    expect(s21.setsUp).not.toContain('s1-1'); // backward ref removed
  });

  it('appends a planned encounter the model dropped, as a kind:encounter scene', () => {
    const ep = episode(1, ['climax'], {
      plannedEncounters: [
        { id: 'enc-1', type: 'social', description: 'tense parley', difficulty: 'moderate', npcsInvolved: ['rival'], stakes: 'trust', relevantSkills: ['rhetoric'], isBranchPoint: false },
      ],
    });
    const raw = {
      episodes: [
        { episodeNumber: 1, scenes: [{ id: 's1-1', title: 'Approach', narrativeRole: 'setup' }] },
      ],
    };
    const sp = normalizeAuthoredScenePlan(raw, plan([ep]))!;
    const encScenes = sp.scenes.filter((s) => s.kind === 'encounter');
    expect(encScenes).toHaveLength(1);
    expect(encScenes[0].id).toBe('enc-1');
    expect(encScenes[0].encounter?.type).toBe('social');
  });

  it('binds authored turns + the signature device onto the LLM-authored scenes', () => {
    const ep = episode(1, ['climax'], {
      estimatedSceneCount: 4,
      treatmentGuidance: {
        episodeTurns: [
          'Darian assaults the battlement',
          'Aethavyr leaps to the rescue on instinct',
          'Lysandra names him Aethavyr',
        ],
        visualAnchor: 'Aethavyr leaps from the battlement to catch the falling soldier',
      },
      plannedEncounters: [
        { id: 'enc-1', type: 'combat', description: 'wall breach', difficulty: 'hard', npcsInvolved: ['darian'], stakes: 'the wall', relevantSkills: ['combat'], isBranchPoint: true },
      ],
    });
    // A normal LLM response that does NOT echo the authored turns/signature back.
    const raw = {
      episodes: [
        {
          episodeNumber: 1,
          scenes: [
            { id: 's1-1', kind: 'standard', title: 'Open', dramaticPurpose: 'establish the calm', narrativeRole: 'setup' },
            { id: 's1-2', kind: 'standard', title: 'Build', dramaticPurpose: 'pressure rises', narrativeRole: 'development' },
            { id: 'enc-1', kind: 'encounter', encounterId: 'enc-1', title: 'Breach', dramaticPurpose: 'the wall falls', narrativeRole: 'turn' },
            { id: 's1-4', kind: 'standard', title: 'Aftermath', dramaticPurpose: 'settle', narrativeRole: 'release' },
          ],
        },
      ],
    };
    const sp = normalizeAuthoredScenePlan(raw, plan([ep]))!;
    expect(sp).not.toBeNull();
    const scenes = sp.scenes.filter((s) => s.episodeNumber === 1).sort((a, b) => a.order - b.order);

    // Every authored turn lands as exactly one tier:'authored' required beat,
    // derived deterministically from the treatment (not from the LLM response).
    const authoredBeats = scenes.flatMap((s) => (s.requiredBeats ?? []).filter((b) => b.tier === 'authored'));
    expect(authoredBeats.map((b) => b.sourceTurn).sort()).toEqual([
      'Aethavyr leaps to the rescue on instinct',
      'Darian assaults the battlement',
      'Lysandra names him Aethavyr',
    ]);
    for (const b of authoredBeats) {
      expect(b.mustDepict.length).toBeGreaterThan(0);
    }

    // The signature device lands on the encounter anchor as signatureMoment + a
    // tier:'signature' required beat.
    const anchor = scenes.find((s) => s.kind === 'encounter')!;
    expect(anchor.signatureMoment).toBe('Aethavyr leaps from the battlement to catch the falling soldier');
    expect((anchor.requiredBeats ?? []).some((b) => b.tier === 'signature')).toBe(true);

    // The release scene stays free of authored content turns.
    const release = scenes.find((s) => s.narrativeRole === 'release')!;
    expect((release.requiredBeats ?? []).filter((b) => b.tier === 'authored')).toHaveLength(0);
  });

  it('gap-fills an episode the model omitted with deterministic scenes', () => {
    const p = plan([episode(1, ['hook']), episode(2, ['climax'])]);
    const raw = { episodes: [{ episodeNumber: 1, scenes: [{ id: 's1-1', title: 'A', narrativeRole: 'setup' }] }] };
    const sp = normalizeAuthoredScenePlan(raw, p)!;
    expect(sp.byEpisode[2]?.length).toBeGreaterThanOrEqual(3); // deterministic fallback for ep 2
  });

  it('preserves an under-sized authored episode when no scene floor is requested (opt-in)', () => {
    const p = plan([episode(1, ['hook'])]);
    const raw = {
      episodes: [
        {
          episodeNumber: 1,
          scenes: [
            { id: 's1-1', kind: 'standard', title: 'A', narrativeRole: 'setup' },
            { id: 's1-2', kind: 'standard', title: 'B', narrativeRole: 'development' },
          ],
        },
      ],
    };
    const sp = normalizeAuthoredScenePlan(raw, p)!;
    expect(sp.byEpisode[1]).toEqual(['s1-1', 's1-2']); // unchanged — floor is off by default
  });

  it('rebuilds an under-sized authored episode deterministically when a scene floor is requested', () => {
    // bite-me-g13 2026-06-13: the model authored ep1 as setup + encounter (2 scenes),
    // too small to carry a scene-graph branch. With the floor on, that episode is
    // rebuilt from the deterministic spine instead of shipping a branchless episode.
    const p = plan([episode(1, ['hook'])]);
    const raw = {
      episodes: [
        {
          episodeNumber: 1,
          scenes: [
            { id: 's1-1', kind: 'standard', title: 'A', narrativeRole: 'setup' },
            { id: 'treatment-enc-1-1', kind: 'encounter', title: 'Clash', narrativeRole: 'turn' },
          ],
        },
      ],
    };
    const sp = normalizeAuthoredScenePlan(raw, p, { minScenesPerEpisode: 3 })!;
    expect(sp.byEpisode[1]!.length).toBeGreaterThanOrEqual(3); // rebuilt to the floor
  });

  it('leaves an adequately-sized authored episode untouched when a scene floor is requested', () => {
    const p = plan([episode(1, ['hook'])]);
    const raw = {
      episodes: [
        {
          episodeNumber: 1,
          scenes: [
            { id: 's1-1', kind: 'standard', title: 'A', narrativeRole: 'setup' },
            { id: 's1-2', kind: 'standard', title: 'B', narrativeRole: 'development' },
            { id: 's1-3', kind: 'standard', title: 'C', narrativeRole: 'payoff' },
          ],
        },
      ],
    };
    const sp = normalizeAuthoredScenePlan(raw, p, { minScenesPerEpisode: 3 })!;
    expect(sp.byEpisode[1]).toEqual(['s1-1', 's1-2', 's1-3']); // authored ids survive
  });
});

describe('buildScenePlanPrompt', () => {
  it('includes episodes, the seven-point spine, and encounter ids', () => {
    const ep = episode(1, ['climax'], {
      plannedEncounters: [
        { id: 'enc-x', type: 'combat', description: 'duel', difficulty: 'hard', npcsInvolved: [], stakes: 's', relevantSkills: [], isBranchPoint: true },
      ],
    });
    const prompt = buildScenePlanPrompt(plan([ep]));
    expect(prompt).toContain('Episode 1');
    expect(prompt).toContain('encounterId "enc-x"');
    expect(prompt).toContain('7-point');
  });
});
