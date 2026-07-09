import { describe, expect, it } from 'vitest';
import { StoryArchitect, type StoryArchitectInput } from './StoryArchitect';

const config = {
  provider: 'gemini' as const,
  model: 'test-model',
  apiKey: 'test-key',
  maxTokens: 1024,
  temperature: 0.1,
};

function makeInput(overrides: Partial<StoryArchitectInput> = {}): StoryArchitectInput {
  return {
    storyTitle: 'Test Story',
    genre: 'Drama',
    synopsis: 'A protagonist enters a dangerous new situation.',
    tone: 'Tense',
    episodeNumber: 1,
    episodeTitle: 'First Contact',
    episodeSynopsis: 'The protagonist is forced to decide how to respond after danger changes the rules.',
    protagonistDescription: 'A guarded protagonist trying to regain agency.',
    availableNPCs: [],
    worldContext: 'A city with hidden dangers.',
    currentLocation: 'Old City',
    targetSceneCount: 4,
    majorChoiceCount: 2,
    ...overrides,
  };
}

describe('StoryArchitect planned-scene choice pressure', () => {
  it('keeps externally resolved event text out of planned major-choice pressure', () => {
    const architect = new StoryArchitect(config) as unknown as {
      buildBlueprintFromPlannedScenes(input: StoryArchitectInput): {
        scenes: Array<{ choicePoint?: { description?: string; stakes?: { want?: string } } }>;
      };
    };

    const blueprint = architect.buildBlueprintFromPlannedScenes(makeInput({
      seasonPlanDirectives: {
        plannedScenes: [
          {
            id: 's1-1',
            episodeNumber: 1,
            order: 0,
            kind: 'standard',
            title: 'Danger at the crossing',
            dramaticPurpose: 'The protagonist has to decide what the danger means now.',
            narrativeRole: 'setup',
            locations: ['Old City'],
            npcsInvolved: [],
            setsUp: [],
            paysOff: [],
            requiredBeats: [
              {
                id: 's1-1-rb1',
                sourceTurn: 'The protagonist is rescued by a stranger before the threat reaches them.',
                mustDepict: 'The protagonist is rescued by a stranger before the threat reaches them.',
                tier: 'authored',
              },
            ],
            hasChoice: true,
          },
        ],
      },
    }));

    const description = blueprint.scenes[0].choicePoint?.description || '';
    const want = blueprint.scenes[0].choicePoint?.stakes?.want || '';
    expect(`${description} ${want}`).not.toMatch(/\brescued by\b|\bexternal rescue\b|\boutside force\b/i);
    expect(`${description} ${want}`).toMatch(/\bprotagonist\b/i);
    expect(`${description} ${want}`).toMatch(/\bdecide\b|\brespond\b|\bchoice\b/i);
  });

  it('rewrites externally resolved treatment theme pressure into player-action theme answers', () => {
    const architect = new StoryArchitect(config) as unknown as {
      applyTreatmentChoicePressureToScene(
        scene: {
          choicePoint?: {
            type?: string;
            stakes?: { want?: string; cost?: string; identity?: string };
            themeAnswer?: string;
          };
        },
        pressure: string,
        guidance: NonNullable<StoryArchitectInput['seasonPlanDirectives']>['treatmentGuidance'],
        residue: string[],
      ): void;
    };
    const scene = {
      choicePoint: {
        type: 'dilemma',
        stakes: { want: 'survive', cost: 'exposure', identity: 'witness' },
        themeAnswer: 'The protagonist is rescued by a stranger before the threat reaches them.',
      },
    };

    architect.applyTreatmentChoicePressureToScene(
      scene,
      'The protagonist is rescued by a stranger before the threat reaches them.',
      {
        sourceKind: 'authored_lite',
        themePressure: 'The protagonist is rescued by a stranger before the threat reaches them.',
      },
      [],
    );

    expect(scene.choicePoint.themeAnswer).not.toMatch(/\brescued by\b|\bexternal rescue\b|\boutside force\b/i);
    expect(scene.choicePoint.themeAnswer).toMatch(/\bPlayer\/protagonist choice\b/);
  });

  it('copies ESC unit text into turnContract for authored-lite fill-slots', () => {
    const architect = new StoryArchitect(config) as unknown as {
      buildBlueprintFromPlannedScenes(input: StoryArchitectInput): {
        scenes: Array<{ spineUnitId?: string; turnContract?: { centralTurn?: string; turnEvent?: string } }>;
      };
    };
    const escText = 'At 4am she writes the blog post as Mr. Midnight.';
    const blueprint = architect.buildBlueprintFromPlannedScenes(makeInput({
      seasonPlanDirectives: {
        episodeSpine: {
          episodeNumber: 1,
          sourceHash: 'h',
          episodeStoryCircleBeats: ['you'],
          polarityFacets: [],
          units: [{
            id: 'u-write',
            order: 0,
            text: escText,
            kind: 'late_night_writing',
            storyCircleFacets: ['you'],
            prerequisites: [],
            sceneKind: 'standard',
          }],
        },
        plannedScenes: [{
          id: 's1-1',
          episodeNumber: 1,
          order: 0,
          kind: 'standard',
          title: 'Writing',
          dramaticPurpose: 'Generic planner turn',
          narrativeRole: 'development',
          locations: ['Apartment'],
          npcsInvolved: [],
          setsUp: [],
          paysOff: [],
          requiredBeats: [],
          hasChoice: false,
          spineUnitId: 'u-write',
          turnContract: {
            turnId: 's1-1-turn',
            source: 'treatment',
            beforeState: 'before',
            afterState: 'after',
            centralTurn: 'Generic planner turn',
            turnEvent: 'Generic planner turn',
            handoff: 'next',
          },
        }],
      },
    }));

    expect(blueprint.scenes[0].spineUnitId).toBe('u-write');
    expect(blueprint.scenes[0].turnContract?.centralTurn).toBe(escText);
    expect(blueprint.scenes[0].turnContract?.turnEvent).toBe(escText);
  });
});
