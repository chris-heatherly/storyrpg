/**
 * Unit tests for the EncounterAnchorContentValidator (Remediation §4.2).
 *
 * Covered:
 *  - an authored encounter anchor whose final scene depicts its centralConflict +
 *    required beats PASSES (no errors);
 *  - an authored encounter anchor shipped as an empty encounter shell (no
 *    reader-facing beats) ERRORS (the empty-placeholder hole);
 *  - an anchor whose prose omits an authored required beat ERRORS;
 *  - a dropped anchor (no final scene) ERRORS;
 *  - an INFERRED encounter (no authored content) is exempt — never asserted against;
 *  - connective-tier beats are exempt (legitimate-invention band).
 */

import { describe, expect, it } from 'vitest';
import {
  EncounterAnchorContentValidator,
  type EncounterAnchorContentContext,
} from './EncounterAnchorContentValidator';
import type { PlannedScene, SeasonScenePlan } from '../../types/scenePlan';
import type { Story, Scene } from '../../types';

const validator = new EncounterAnchorContentValidator();

function plannedEncounter(overrides: Partial<PlannedScene> = {}): PlannedScene {
  return {
    id: 'enc-3-1',
    episodeNumber: 3,
    order: 0,
    kind: 'encounter',
    title: 'Wall Breach',
    dramaticPurpose: 'x',
    narrativeRole: 'turn',
    locations: [],
    npcsInvolved: [],
    setsUp: [],
    paysOff: [],
    encounter: {
      type: 'combat',
      difficulty: 'hard',
      relevantSkills: ['tactics'],
      isBranchPoint: true,
      centralConflict: 'Darian poisons the well during the wall breach',
      requiredBeats: [
        {
          id: 'enc-3-1-rb1',
          sourceTurn: 'Darian slips poison into the garrison well as the wall is breached.',
          mustDepict: 'Darian administers poison to the garrison well',
          tier: 'signature',
        },
      ],
    },
    ...overrides,
  };
}

function scenePlanOf(scenes: PlannedScene[]): SeasonScenePlan {
  const byEpisode: Record<number, string[]> = {};
  for (const s of scenes) (byEpisode[s.episodeNumber] ??= []).push(s.id);
  return { scenes, byEpisode, setupPayoffEdges: [] };
}

function sceneWithBeats(id: string, beatTexts: string[]): Scene {
  return {
    id,
    name: id,
    startingBeatId: `${id}-b0`,
    beats: beatTexts.map((text, i) => ({ id: `${id}-b${i}`, text })),
  };
}

function storyWith(scenes: Scene[]): Story {
  return {
    episodes: [
      {
        id: 'ep-3',
        number: 3,
        title: 'The Siege Tightens',
        synopsis: '',
        coverImage: { type: 'image', url: '' },
        scenes,
        startingSceneId: scenes[0]?.id ?? '',
      },
    ],
  } as unknown as Story;
}

function errorsOf(story: Story, ctx: EncounterAnchorContentContext): string[] {
  return validator
    .validate(story, ctx)
    .issues.filter((i) => i.severity === 'error')
    .map((i) => i.message);
}

describe('EncounterAnchorContentValidator — passing case', () => {
  it('PASSES when the final scene depicts the central conflict and the required beat', () => {
    const planned = plannedEncounter();
    const story = storyWith([
      sceneWithBeats('enc-3-1', [
        'The wall breach opened a ragged gap in the stone.',
        'In the chaos, Darian poured a vial of poison into the garrison well, unseen.',
      ]),
    ]);
    const errs = errorsOf(story, { scenePlan: scenePlanOf([planned]) });
    expect(errs).toHaveLength(0);
  });
});

describe('EncounterAnchorContentValidator — failing cases', () => {
  it('ERRORS when the authored encounter anchor ships as an empty shell (no reader-facing beats)', () => {
    const planned = plannedEncounter();
    // Encounter present but no beats anywhere — the empty_scene hole.
    const emptyEncounterScene: Scene = {
      id: 'enc-3-1',
      name: 'Wall Breach',
      startingBeatId: '',
      beats: [],
      encounter: {
        id: 'enc-3-1',
        type: 'combat',
        name: 'Wall Breach',
        description: 'x',
        goalClock: { current: 0, max: 6, label: 'goal' },
        threatClock: { current: 0, max: 6, label: 'threat' },
        stakes: { victory: 'v', defeat: 'd' },
        phases: [],
        startingPhaseId: '',
        outcomes: {},
      } as unknown as Scene['encounter'],
    };
    const errs = errorsOf(storyWith([emptyEncounterScene]), { scenePlan: scenePlanOf([planned]) });
    expect(errs.some((m) => /no reader-facing beats/.test(m))).toBe(true);
  });

  it('ERRORS when the prose omits an authored required beat', () => {
    const planned = plannedEncounter();
    const story = storyWith([
      sceneWithBeats('enc-3-1', [
        'The wall breach opened a ragged gap and the defenders scrambled to hold the line.',
        // Conflict (breach) mentioned, but Darian/poison/well never depicted.
      ]),
    ]);
    const errs = errorsOf(story, { scenePlan: scenePlanOf([planned]) });
    expect(errs.some((m) => /required beat enc-3-1-rb1/.test(m))).toBe(true);
  });

  it('ERRORS when an authored anchor produced no final scene (dropped)', () => {
    const planned = plannedEncounter();
    const story = storyWith([sceneWithBeats('some-other-scene', ['unrelated prose'])]);
    const errs = errorsOf(story, { scenePlan: scenePlanOf([planned]) });
    expect(errs.some((m) => /was dropped/.test(m))).toBe(true);
  });
});

describe('EncounterAnchorContentValidator — exemptions (legitimate inference survives)', () => {
  it('does NOT assert against an inferred encounter (no authored content)', () => {
    const inferred = plannedEncounter({
      id: 'enc-5-1',
      episodeNumber: 5,
      encounter: {
        type: 'combat',
        difficulty: 'moderate',
        relevantSkills: [],
        isBranchPoint: false,
        // no centralConflict, no requiredBeats — purely inferred
      },
    });
    // Even with an empty final scene, an inferred encounter is exempt.
    const emptyScene: Scene = { id: 'enc-5-1', name: 'x', startingBeatId: '', beats: [] };
    const result = validator.validate(storyWith([emptyScene]), {
      scenePlan: scenePlanOf([inferred]),
    });
    expect(result.issues).toHaveLength(0);
    expect(result.valid).toBe(true);
  });

  it('does NOT require connective-tier beats to be depicted', () => {
    const planned = plannedEncounter({
      encounter: {
        type: 'combat',
        difficulty: 'hard',
        relevantSkills: [],
        isBranchPoint: false,
        centralConflict: 'the wall breach',
        requiredBeats: [
          {
            id: 'enc-3-1-rbC',
            sourceTurn: 'connective tissue the model may invent',
            mustDepict: 'some entirely invented bridging detail nowhere in prose',
            tier: 'connective',
          },
        ],
      },
    });
    const story = storyWith([
      sceneWithBeats('enc-3-1', ['The wall breach opened a ragged gap in the stone.']),
    ]);
    const errs = errorsOf(story, { scenePlan: scenePlanOf([planned]) });
    expect(errs).toHaveLength(0);
  });
});
