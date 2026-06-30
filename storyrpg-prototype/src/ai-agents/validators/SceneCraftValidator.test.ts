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

    expect(result.issues.some((issue) => issue.message.includes('physical business'))).toBe(true);
  });

  it('keeps scene-craft warnings advisory instead of failing the scene', () => {
    const result = validator.validateScene(scene({
      beats: [{
        id: 'beat-1',
        text: '"We should decide what to do," Mara says. "Yes," {{player.name}} says.',
        intensityTier: 'supporting',
      }],
    }), { dialogueHeavy: true });

    expect(result.issues.length).toBeGreaterThan(0);
    expect(result.issues.every((issue) => issue.severity === 'warning')).toBe(true);
    expect(result.passed).toBe(true);
  });

  it('warns when scenes drift outside the configured beat range', () => {
    const shortResult = validator.validateScene(scene({
      beats: [
        {
          id: 'beat-1',
          text: '{{player.name}} opens the ledger and discovers the missing witness.',
          intensityTier: 'supporting',
          primaryAction: '{{player.name}} opens the ledger',
        },
        {
          id: 'beat-2',
          text: 'Mara loses trust when the mentor signature appears.',
          intensityTier: 'supporting',
          primaryAction: 'Mara loses trust',
        },
      ],
    }), { minBeatsPerScene: 3, maxBeatsPerScene: 8 });

    const longResult = validator.validateScene(scene({
      beats: Array.from({ length: 9 }, (_, index) => ({
        id: `beat-${index + 1}`,
        text: `{{player.name}} turns clue ${index + 1} into leverage before the door closes.`,
        intensityTier: 'supporting',
        primaryAction: `turns clue ${index + 1} into leverage`,
      })),
    }), { minBeatsPerScene: 3, maxBeatsPerScene: 8 });

    expect(shortResult.issues.some((issue) => issue.message.includes('fewer beats'))).toBe(true);
    expect(longResult.issues.some((issue) => issue.message.includes('more beats'))).toBe(true);
    expect(shortResult.passed).toBe(true);
    expect(longResult.passed).toBe(true);
  });

  it('warns when key moments do not culminate scene takeaways', () => {
    const result = validator.validateScene(scene({
      keyMoments: ['A window breaks in the distant tower'],
      sceneTakeaways: ['The player learns Mara has been hiding the safe route.'],
    }));

    expect(result.issues.some((issue) => issue.message.includes('disconnected from sceneTakeaways'))).toBe(true);
    expect(result.passed).toBe(true);
  });

  it('warns on style-fighting image metadata unless the style contract allows it', () => {
    const styleFightingScene = scene({
      beats: [{
        id: 'beat-1',
        text: '{{player.name}} reveals the hidden evidence.',
        intensityTier: 'supporting',
        primaryAction: 'reveals hidden evidence in a cinematic pose',
        visualMoment: 'cinematic high contrast view of the evidence',
      }],
    });

    const warned = validator.validateScene(styleFightingScene);
    const allowed = validator.validateScene(styleFightingScene, {
      styleContextText: 'The active style contract calls for cinematic high contrast frames.',
    });

    expect(warned.issues.some((issue) => issue.message.includes('style-direction terms'))).toBe(true);
    expect(warned.passed).toBe(true);
    expect(allowed.issues.some((issue) => issue.message.includes('style-direction terms'))).toBe(false);
  });

  it('warns on direct thought or feeling exposition without failing', () => {
    const result = validator.validateScene(scene({
      beats: [{
        id: 'beat-1',
        text: 'You feel afraid as Mara realizes the door is locked.',
        intensityTier: 'supporting',
        primaryAction: 'Mara tries the locked door',
      }],
    }));

    expect(result.issues.some((issue) => issue.message.includes('directly explains thought or feeling'))).toBe(true);
    expect(result.passed).toBe(true);
  });

  it('warns when jeopardy dialogue is too casual or explanatory', () => {
    const result = validator.validateScene(scene({
      beats: [{
        id: 'beat-1',
        text: 'The blade scrapes the door. "Let me explain what this means before we run, because the reason this matters is that the attacker knows our route," Mara says.',
        intensityTier: 'dominant',
        primaryAction: 'Mara braces against the door',
        visualMoment: 'a blade scrapes through the door crack',
      }],
    }));

    expect(result.issues.some((issue) => issue.message.includes('Jeopardy dialogue'))).toBe(true);
    expect(result.passed).toBe(true);
  });

  it('warns when physical action is vague and lacks bodily impact', () => {
    const result = validator.validateScene(scene({
      beats: [{
        id: 'beat-1',
        text: 'They fight for a while until Mara wins.',
        intensityTier: 'dominant',
        primaryAction: 'They fight for a while',
      }],
    }));

    expect(result.issues.some((issue) => issue.message.includes('specific bodily movement'))).toBe(true);
    expect(result.passed).toBe(true);
  });

  it('warns when a fight or weapon scene lacks damage or destructive impact', () => {
    const result = validator.validateScene(scene({
      beats: [{
        id: 'beat-1',
        text: '{{player.name}} attacks the guard with the knife and wins.',
        intensityTier: 'dominant',
        primaryAction: '{{player.name}} attacks the guard with the knife',
      }],
    }));

    expect(result.issues.some((issue) => issue.message.includes('visible damage'))).toBe(true);
    expect(result.passed).toBe(true);
  });

  it('accepts fight/action scenes with concrete strikes, wounds, impacts, and cost', () => {
    const result = validator.validateScene(scene({
      beats: [{
        id: 'beat-1',
        text: '{{player.name}} ducks under the guard blade, hooks his wrist, and slams his shoulder into the stone rail. The impact cracks loud enough to make Mara flinch, and blood opens across the guard jaw before he collapses.',
        intensityTier: 'dominant',
        primaryAction: '{{player.name}} ducks, hooks the guard wrist, and slams him into the rail',
        visualMoment: 'the guard recoils from the cracked stone rail with blood on his jaw',
      }],
    }));

    expect(result.issues.some((issue) => issue.message.includes('visible damage'))).toBe(false);
    expect(result.issues.some((issue) => issue.message.includes('specific bodily movement'))).toBe(false);
    expect(result.passed).toBe(true);
  });

  it('warns when conflict lacks visible cost or damage', () => {
    const result = validator.validateScene(scene({
      beats: [{
        id: 'beat-1',
        text: 'Mara accuses Elian in the hallway.',
        intensityTier: 'supporting',
        primaryAction: 'Mara accuses Elian',
      }],
    }));

    expect(result.issues.some((issue) => issue.message.includes('visible cost or damage'))).toBe(true);
    expect(result.passed).toBe(true);
  });

  it('does not warn on conflict damage when the cost is emotional, social, or reputational', () => {
    const result = validator.validateScene(scene({
      beats: [{
        id: 'beat-1',
        text: 'Mara accuses Elian in front of the council, and his reputation breaks before he can answer. The exposed secret costs him the last ally who still trusted him.',
        intensityTier: 'dominant',
        primaryAction: 'Mara exposes Elian in front of the council',
      }],
    }));

    expect(result.issues.some((issue) => issue.message.includes('visible cost or damage'))).toBe(false);
    expect(result.passed).toBe(true);
  });

  it('warns when a non-final scene ending lacks resolution or forward pressure', () => {
    const result = validator.validateScene(scene({
      beats: [{
        id: 'beat-1',
        text: 'The room is quiet.',
        intensityTier: 'rest',
      }],
    }));

    expect(result.issues.some((issue) => issue.message.includes('Final beat lacks pointed resolution'))).toBe(true);
    expect(result.passed).toBe(true);
  });

  it('warns on generic description without concrete detail', () => {
    const result = validator.validateScene(scene({
      beats: [{
        id: 'beat-1',
        text: 'The place is very beautiful and somehow interesting.',
        intensityTier: 'supporting',
      }],
    }), { minBeatsPerScene: 1 });

    expect(result.issues.some((issue) => issue.message.includes('generic description'))).toBe(true);
    expect(result.passed).toBe(true);
  });

  it('warns on repeated adjacent phrasing or action language', () => {
    const result = validator.validateScene(scene({
      beats: [
        {
          id: 'beat-1',
          text: 'Mara walks to the table and opens the letter.',
          intensityTier: 'supporting',
          primaryAction: 'Mara walks to the table',
        },
        {
          id: 'beat-2',
          text: 'Mara walks to the window and opens the curtain.',
          intensityTier: 'supporting',
          primaryAction: 'Mara walks to the window',
        },
      ],
    }), { minBeatsPerScene: 1 });

    expect(result.issues.some((issue) => issue.message.includes('repeat phrasing'))).toBe(true);
    expect(result.passed).toBe(true);
  });

  it('warns on player-facing cinematic or camera vocabulary', () => {
    const result = validator.validateScene(scene({
      beats: [{
        id: 'beat-1',
        text: 'The camera pushes in for a close-up as Mara opens the torn letter.',
        intensityTier: 'supporting',
        primaryAction: 'Mara opens the torn letter',
      }],
    }), { minBeatsPerScene: 1 });

    expect(result.issues.some((issue) => issue.message.includes('cinematic or camera vocabulary'))).toBe(true);
    expect(result.passed).toBe(true);
  });

  it('warns on exposition-only dialogue without pressure or subtext', () => {
    const result = validator.validateScene(scene({
      beats: [{
        id: 'beat-1',
        text: '"Let me explain the schedule and what this means," Mara says.',
        intensityTier: 'supporting',
      }],
    }), { minBeatsPerScene: 1, dialogueHeavy: true });

    expect(result.issues.some((issue) => issue.message.includes('Dialogue lacks subtext or scene pressure'))).toBe(true);
    expect(result.passed).toBe(true);
  });

  it('warns on weak keyMoment buildup when payoff terms and pressure are absent', () => {
    const result = validator.validateScene(scene({
      keyMoments: ['Mara chooses trust over safety'],
      sceneTakeaways: ['Mara trusts the player despite the cost.'],
      beats: [{
        id: 'beat-1',
        text: 'The hallway is empty and quiet.',
        intensityTier: 'supporting',
        primaryAction: 'stands in the hallway',
      }],
    }), { minBeatsPerScene: 1 });

    expect(result.issues.some((issue) => issue.message.includes('weakly connects to keyMoment'))).toBe(true);
    expect(result.passed).toBe(true);
  });

  it('does not warn just because a scene lacks internal monologue or close first-appearance detail', () => {
    const result = validator.validateScene(scene({
      keyMoments: ['Mara chooses trust'],
      sceneTakeaways: ['Mara chooses trust.'],
      beats: [{
        id: 'beat-1',
        text: 'Rain ticks against the kitchen window while {{player.name}} folds the torn map. Mara sets her cup down and says, "I trust you." The choice costs her last safe route.',
        intensityTier: 'dominant',
        primaryAction: '{{player.name}} folds the torn map while Mara sets her cup down',
      }],
    }), { minBeatsPerScene: 1 });

    expect(result.issues.some((issue) => issue.message.includes('internal monologue'))).toBe(false);
    expect(result.issues.some((issue) => issue.message.includes('first appearance'))).toBe(false);
    expect(result.issues.some((issue) => issue.message.includes('directly explains thought or feeling'))).toBe(false);
    expect(result.passed).toBe(true);
  });

  it('accepts fresh sensory detail, pressure-aware dialogue, and externalized emotion', () => {
    const result = validator.validateScene(scene({
      keyMoments: ['Mara chooses trust'],
      sceneTakeaways: ['Mara chooses trust.'],
      beats: [{
        id: 'beat-1',
        text: 'Rain ticks against the kitchen window while {{player.name}} folds the torn map. Mara sets her cup down and says, "I trust you." The choice costs her last safe route.',
        intensityTier: 'dominant',
        primaryAction: '{{player.name}} folds the torn map while Mara sets her cup down',
        relationshipDynamic: 'Mara offers trust despite the cost',
      }],
    }), { minBeatsPerScene: 1 });

    expect(result.issues).toEqual([]);
    expect(result.passed).toBe(true);
  });

  it('allows finale resolution to end on aftermath or legacy instead of a cliffhanger', () => {
    const result = validator.validateScene(scene({
      beats: [{
        id: 'beat-1',
        text: '{{player.name}} restores the harbor lights, and tomorrow the city remembers who chose to stay.',
        intensityTier: 'rest',
        primaryAction: '{{player.name}} restores the harbor lights',
      }],
    }), { isFinalScene: true, isFinale: true });

    expect(result.issues.some((issue) => issue.message.includes('forward pressure'))).toBe(false);
    expect(result.issues.some((issue) => issue.message.includes('aftermath or legacy'))).toBe(false);
    expect(result.passed).toBe(true);
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
