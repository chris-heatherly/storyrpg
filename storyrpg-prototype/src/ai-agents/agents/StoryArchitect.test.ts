import { describe, it, expect } from 'vitest';
import { StoryArchitect, type StoryArchitectInput } from './StoryArchitect';

const config = {
  provider: 'anthropic' as const,
  model: 'test-model',
  apiKey: 'test-key',
  maxTokens: 1024,
  temperature: 0.1,
};

function makeInput(overrides?: Partial<StoryArchitectInput>): StoryArchitectInput {
  return {
    storyTitle: 'Test Story',
    genre: 'Drama',
    synopsis: 'A test story about choices.',
    tone: 'Tense',
    episodeNumber: 1,
    episodeTitle: 'The Beginning',
    episodeSynopsis: 'Everything starts here.',
    protagonistDescription: 'Alex, a determined explorer.',
    availableNPCs: [],
    worldContext: 'A world of mystery.',
    currentLocation: 'The city center',
    targetSceneCount: 6,
    majorChoiceCount: 3,
    ...overrides,
  };
}

// -----------------------------------------------------------------------
// buildSeasonPlanDirectivesSection
// -----------------------------------------------------------------------

describe('StoryArchitect.buildSeasonPlanDirectivesSection', () => {
  const architect = new StoryArchitect(config);

  it('returns empty string when no directives', () => {
    const input = makeInput();
    const result = (architect as any).buildSeasonPlanDirectivesSection(input);
    expect(result).toBe('');
  });

  it('returns empty string when seasonPlanDirectives is undefined', () => {
    const input = makeInput({ seasonPlanDirectives: undefined });
    const result = (architect as any).buildSeasonPlanDirectivesSection(input);
    expect(result).toBe('');
  });

  it('includes GROWTH PLAN section when growthContext is present', () => {
    const input = makeInput({
      seasonPlanDirectives: {
        growthContext: {
          focusSkills: ['persuasion', 'athletics'],
          developmentScene: 'Training in the courtyard',
          mentorshipOpportunity: null,
        },
      },
    });
    const result = (architect as any).buildSeasonPlanDirectivesSection(input);
    expect(result).toContain('GROWTH PLAN FOR THIS EPISODE');
    expect(result).toContain('persuasion, athletics');
    expect(result).toContain('Training in the courtyard');
  });

  it('includes mentorship details when mentorshipOpportunity is provided', () => {
    const input = makeInput({
      seasonPlanDirectives: {
        growthContext: {
          focusSkills: ['persuasion'],
          developmentScene: 'Study session',
          mentorshipOpportunity: {
            npcId: 'marcus',
            npcName: 'Marcus',
            requiredRelationship: { dimension: 'respect', threshold: 60 },
            attribute: 'courage',
            narrativeHook: 'Marcus offers to train you',
          },
        },
      },
    });
    const result = (architect as any).buildSeasonPlanDirectivesSection(input);
    expect(result).toContain('Marcus can teach courage');
    expect(result).toContain('respect >= 60');
    expect(result).toContain('Marcus offers to train you');
    expect(result).toContain('MENTORSHIP SCENE');
  });

  it('omits mentorship line and mentorship scene guidance when mentorshipOpportunity is null', () => {
    const input = makeInput({
      seasonPlanDirectives: {
        growthContext: {
          focusSkills: ['stealth'],
          developmentScene: 'Shadow practice',
          mentorshipOpportunity: null,
        },
      },
    });
    const result = (architect as any).buildSeasonPlanDirectivesSection(input);
    expect(result).toContain('No mentorship opportunity this episode');
    expect(result).not.toContain('MENTORSHIP SCENE');
  });

  it('includes difficulty tier and development scene instructions', () => {
    const input = makeInput({
      seasonPlanDirectives: {
        difficultyTier: 'hard',
        growthContext: {
          focusSkills: ['athletics'],
          developmentScene: 'Obstacle course',
        },
      },
    });
    const result = (architect as any).buildSeasonPlanDirectivesSection(input);
    expect(result).toContain('hard');
    expect(result).toContain('DEVELOPMENT SCENES');
    expect(result).toContain('FAILURE-RECOVERY BRANCH');
  });

  it('includes adapted story-craft guidance without requiring combat-only pressure', () => {
    const input = makeInput();
    const result = (architect as any).buildPrompt(input);

    expect(result).toContain('Pressure, not mandatory combat');
    expect(result).toContain('romantic vulnerability');
    expect(result).toContain('Plans go wrong');
    expect(result).toContain('Do not require every conversation to become an argument');
  });
});
