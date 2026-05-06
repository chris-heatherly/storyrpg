import { describe, expect, it } from 'vitest';

import {
  buildGenreAwareJeopardyGuidance,
  isActionHeavyGenre,
} from '../prompts/storytellingPrinciples';
import { IncrementalSensitivityChecker } from './IncrementalValidators';
import { SceneCraftValidator } from './SceneCraftValidator';
import type { SceneContent } from '../agents/SceneWriter';

function scene(overrides: Partial<SceneContent>): SceneContent {
  return {
    sceneId: 'scene-1',
    sceneName: 'Test Scene',
    beats: [{
      id: 'beat-1',
      text: '{{player.name}} studies the torn letter while Mara watches the door. The seal reveals who sold them out.',
      intensityTier: 'supporting',
      primaryAction: '{{player.name}} studies the torn letter',
      visualMoment: '{{player.name}} holds the torn letter under a lamp',
    }],
    startingBeatId: 'beat-1',
    moodProgression: ['tense'],
    charactersInvolved: ['mara'],
    keyMoments: ['The betrayal becomes legible'],
    sceneTakeaways: ['The player learns the safe route was sold.'],
    continuityNotes: [],
    ...overrides,
  };
}

describe('SceneCraftValidator', () => {
  const validator = new SceneCraftValidator();

  it('allows romance/literary/social scenes to pass with non-combat jeopardy', () => {
    const result = validator.validateScene(scene({
      beats: [{
        id: 'beat-1',
        text: '{{player.name}} folds the invitation while Elian waits beside the piano. Saying yes would save the family name and cost the one person who trusts them.',
        intensityTier: 'supporting',
        primaryAction: '{{player.name}} folds the invitation',
        relationshipDynamic: 'Elian waits close enough to see the hesitation',
      }],
    }), { genre: 'literary romance', dialogueHeavy: true });

    expect(result.passed).toBe(true);
  });

  it('allows mystery scenes to pass with informational and moral pressure', () => {
    const result = validator.validateScene(scene({
      beats: [{
        id: 'beat-1',
        text: '{{player.name}} opens the ledger and discovers the missing witness was paid by their own mentor.',
        intensityTier: 'supporting',
        primaryAction: '{{player.name}} opens the ledger',
        mustShowDetail: 'the mentor signature beside the payment',
      }],
    }), { genre: 'mystery investigation' });

    expect(result.passed).toBe(true);
  });

  it('keeps rest beats valid inside high-intensity scenes', () => {
    const result = validator.validateScene(scene({
      beats: [
        {
          id: 'beat-1',
          text: 'Rain taps the courthouse glass.',
          intensityTier: 'rest',
        },
        {
          id: 'beat-2',
          text: '{{player.name}} reveals the hidden evidence, and the judge orders the doors locked.',
          intensityTier: 'dominant',
          primaryAction: '{{player.name}} reveals the hidden evidence',
        },
      ],
    }));

    expect(result.passed).toBe(true);
  });

  it('warns on static meetings without physical business', () => {
    const result = validator.validateScene(scene({
      beats: [{
        id: 'beat-1',
        text: '"We should decide what to do," Mara says. "Yes," {{player.name}} says. "We need a plan."',
        intensityTier: 'supporting',
      }],
    }), { dialogueHeavy: true });

    expect(result.issues.some((issue) => issue.message.includes('static meeting'))).toBe(true);
  });

  it('warns only action-heavy episodes when physical danger is absent between inciting incident and climax', () => {
    const quietScenes = [scene({
      beats: [{
        id: 'beat-1',
        text: '{{player.name}} discovers the forged map and loses the captain trust.',
        intensityTier: 'supporting',
      }],
    })];

    expect(validator.validateEpisodeScenes(quietScenes, {
      genre: 'literary romance',
      betweenIncitingAndClimax: true,
    }).passed).toBe(true);

    expect(validator.validateEpisodeScenes(quietScenes, {
      genre: 'action adventure',
      betweenIncitingAndClimax: true,
    }).issues.some((issue) => issue.message.includes('physical danger'))).toBe(true);
  });
});

describe('genre-aware craft guidance', () => {
  it('recommends physical danger for action/adventure but not for social genres', () => {
    expect(isActionHeavyGenre('action adventure')).toBe(true);
    expect(buildGenreAwareJeopardyGuidance('action adventure')).toContain('physical danger');
    expect(buildGenreAwareJeopardyGuidance('literary romance')).toContain('do not force combat');
  });

  it('keeps T-rated sensitivity authoritative for graphic violence', () => {
    const checker = new IncrementalSensitivityChecker('T');
    const result = checker.checkScene(scene({
      beats: [{
        id: 'beat-1',
        text: '{{player.name}} sees the villain mutilate the captive in the torchlight.',
      }],
    }));

    expect(result.passed).toBe(false);
    expect(result.highestSeverity).toBe('strong');
  });
});
