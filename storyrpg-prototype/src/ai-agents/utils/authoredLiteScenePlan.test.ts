import { describe, expect, it } from 'vitest';
import type { SeasonEpisode } from '../../types/seasonPlan';
import type { PlannedScene } from '../../types/scenePlan';
import {
  attachAuthoredLiteResidueHooks,
  consolidateAuthoredLiteScenes,
  enforceNpcIntroOrderOnScenes,
  inferAuthoredEncounterPresentation,
  introOrderConstraintPairs,
  isIntroducesEpisodeTurn,
  repairIntroOrderTurnAssignment,
} from './authoredLiteScenePlan';

function liteEpisode(overrides: Partial<SeasonEpisode> = {}): SeasonEpisode {
  return {
    episodeNumber: 1,
    title: 'Episode 1',
    synopsis: 'Synopsis',
    storyCircleRole: [{ beat: 'you', roleKind: 'primary' }],
    treatmentGuidance: {
      sourceKind: 'authored_lite',
      episodeTurns: [
        'She arrives with two suitcases.',
        'She explores the streets.',
        'She wanders into a bookshop and befriends the owner.',
        'Stela introduces Mika to the secret nightlife club.',
      ],
    },
    mainCharacters: ['Protagonist', 'Stela Pavel', 'Mika Novak'],
    ...overrides,
  } as SeasonEpisode;
}

function scene(id: string, order: number, extra: Partial<PlannedScene> = {}): PlannedScene {
  return {
    id,
    episodeNumber: 1,
    order,
    kind: 'standard',
    title: id,
    dramaticPurpose: extra.dramaticPurpose ?? id,
    narrativeRole: extra.narrativeRole ?? 'development',
    locations: ['City'],
    npcsInvolved: extra.npcsInvolved ?? ['Protagonist'],
    setsUp: [],
    paysOff: [],
    hasChoice: extra.hasChoice ?? true,
    budgetWeight: 1,
    ...extra,
  };
}

describe('authoredLiteScenePlan intro order', () => {
  it('detects intro-order constraints between social establishment and introduces turns', () => {
    const turns = liteEpisode().treatmentGuidance!.episodeTurns!;
    expect(isIntroducesEpisodeTurn(turns[3])).toBe(true);
    expect(introOrderConstraintPairs(turns)).toEqual([[3, 2]]);
  });

  it('repairs turn assignment so introduces binds after social establishment', () => {
    const turns = liteEpisode().treatmentGuidance!.episodeTurns!;
    const assignment = [0, 1, 1, 1];
    expect(repairIntroOrderTurnAssignment(turns, assignment, 3)).toBeGreaterThan(0);
    expect(assignment[3]).toBeGreaterThan(assignment[2]);
  });

  it('removes not-yet-introduced NPCs from earlier scenes', () => {
    const turns = liteEpisode().treatmentGuidance!.episodeTurns!;
    const scenes = [
      scene('s1-1', 0, { npcsInvolved: ['Protagonist', 'Mika Novak'] }),
      scene('s1-2', 1, { npcsInvolved: ['Protagonist', 'Stela Pavel'] }),
      scene('s1-3', 2, { npcsInvolved: ['Protagonist', 'Stela Pavel'] }),
      scene('s1-4', 3, { npcsInvolved: ['Protagonist', 'Stela Pavel', 'Mika Novak'] }),
    ];
    const assignment = [0, 1, 2, 3];
    expect(enforceNpcIntroOrderOnScenes(liteEpisode(), scenes, turns, assignment)).toBeGreaterThan(0);
    expect(scenes[0].npcsInvolved).not.toContain('Mika Novak');
    expect(scenes[3].npcsInvolved).toContain('Mika Novak');
  });
});

describe('authoredLiteScenePlan scene budget', () => {
  it('merges adjacent late-night writing and viral aftermath scenes', () => {
    const scenes = [
      scene('s1-5', 0, {
        dramaticPurpose: 'At 4am she drafts the anonymous blog post under a codename.',
        requiredBeats: [{ id: 'rb1', tier: 'authored', mustDepict: 'late night writing', sourceTurn: 'writing' }],
      }),
      scene('s1-6', 1, {
        dramaticPurpose: 'By evening the post goes viral with climbing readership.',
        requiredBeats: [{ id: 'rb2', tier: 'authored', mustDepict: 'viral aftermath', sourceTurn: 'viral' }],
      }),
    ];
    expect(consolidateAuthoredLiteScenes(liteEpisode(), scenes)).toBeGreaterThan(0);
    expect(scenes).toHaveLength(1);
    expect(scenes[0].requiredBeats?.length).toBe(2);
  });

  it('trims surplus standard scenes without authored beats', () => {
    const ep = liteEpisode({
      treatmentGuidance: {
        sourceKind: 'authored_lite',
        episodeTurns: ['Turn one.', 'Turn two.'],
      },
    });
    const scenes = [
      scene('s1-1', 0, { requiredBeats: [{ id: 'rb1', tier: 'authored', mustDepict: 'Turn one.', sourceTurn: 'Turn one.' }] }),
      scene('s1-2', 1, { requiredBeats: [{ id: 'rb2', tier: 'authored', mustDepict: 'Turn two.', sourceTurn: 'Turn two.' }] }),
      scene('s1-extra', 2, { dramaticPurpose: 'Extra connective filler with no authored beat.' }),
    ];
    expect(consolidateAuthoredLiteScenes(ep, scenes)).toBe(1);
    expect(scenes.map((item) => item.id)).toEqual(['s1-1', 's1-2']);
  });
});

describe('authoredLiteScenePlan encounter + residue', () => {
  it('infers survival presentation for threat encounters', () => {
    expect(inferAuthoredEncounterPresentation('She is attacked in the park and rescued by a stranger.')).toEqual({
      type: 'survival',
      style: 'dramatic',
    });
  });

  it('does not classify threat rescue as romantic', () => {
    const inferred = inferAuthoredEncounterPresentation('A romantic rescue after the attack saves her.');
    expect(inferred.type).toBe('survival');
  });

  it('attaches residue hooks as mechanic-pressure contracts on choice scenes', () => {
    const scenes = [
      scene('s1-3', 0, { hasChoice: true, requiredBeats: [{ id: 'rb', tier: 'authored', mustDepict: 'Publish the blog post.', sourceTurn: 'blog' }] }),
    ];
    const attached = attachAuthoredLiteResidueHooks(liteEpisode(), scenes, [{
      id: 'residue:blog_tone',
      source: 'deterministic_fallback',
      sourceEpisodeNumber: 1,
      choiceAnchor: 'Publish the blog post',
      flag: 'blog_tone_wary',
      conditionKey: 'blog_tone_wary',
      kind: 'identity',
      payoffPolicy: 'terminal_slice_ok',
      targetEpisodeNumbers: [2],
      authoringGuidance: 'Blog framing choice sets wary tone.',
      requiredSurface: ['choice_text'],
      priority: 'moderate',
      sourceMaterial: {},
    }]);
    expect(attached).toBe(1);
    expect(scenes[0].mechanicPressure?.[0]?.mechanicRef?.flag).toBe('blog_tone_wary');
  });
});
