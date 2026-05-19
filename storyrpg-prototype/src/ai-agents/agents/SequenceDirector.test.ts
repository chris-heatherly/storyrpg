import { describe, expect, it } from 'vitest';

import { applySequenceDirectorPlan } from './SequenceDirector';
import type { SceneContent } from './SceneWriter';

function sceneFor(kind: string, text: string): SceneContent {
  return {
    sceneId: `scene-${kind}`,
    sceneName: kind,
    beats: [
      {
        id: 'beat-1',
        text: `${kind} begins in the room.`,
        shotType: 'establishing',
        visualMoment: 'The room waits under changed light.',
      },
      {
        id: 'beat-2',
        text,
        shotType: kind === 'chase' ? 'action' : 'character',
        visualMoment: text,
        primaryAction: text,
        dramaticIntent: {
          visibleTurn: `${kind} visibly changes leverage.`,
          visualSubtextCue: 'hands, distance, and the key object carry the subtext',
          obstacle: 'pressure resists the objective',
        },
      },
      {
        id: 'beat-3',
        text: `${kind} ends with a changed posture.`,
        shotType: 'character',
        visualMoment: `${kind} ends with a changed posture.`,
        primaryAction: 'The protagonist settles into the consequence',
        dramaticIntent: {
          visibleTurn: 'The final posture proves the consequence.',
          visualSubtextCue: 'the changed distance remains visible',
          obstacle: 'the cost still lingers',
        },
      },
    ],
    startingBeatId: 'beat-1',
    moodProgression: ['tense', 'changed'],
    charactersInvolved: ['hero', 'rival'],
    keyMoments: [],
    continuityNotes: [],
  };
}

describe('SequenceDirector', () => {
  it.each([
    ['dialogue', 'Mara argues with Ilya while sliding the letter across the table.'],
    ['chase', 'Mara sprints after Ilya through the market before he disappears.'],
    ['investigation', 'Mara searches the desk and finds the hidden key under the map.'],
    ['aftermath', 'Mara sits quietly, turning the broken ring until her breathing steadies.'],
    ['branch-payoff', 'Mara acts on the player choice and takes the dangerous door alone.'],
  ])('adds sequence and coverage plans for %s scenes', (_kind, text) => {
    const scene = sceneFor(_kind, text);
    const diagnostic = applySequenceDirectorPlan(scene, { sceneDescription: 'A test room with a table and exit.' });

    expect(diagnostic.applied).toBe(true);
    expect(scene.sceneVisualSequencePlan?.objective).toBeTruthy();
    expect(scene.sceneVisualSequencePlan?.geography).toContain('test room');
    expect(scene.sequenceIntent?.activity).toBeTruthy();

    expect(diagnostic.coverageBeatIds).toEqual(['beat-1', 'beat-2', 'beat-3']);
    for (const beat of scene.beats) {
      expect(beat.coveragePlan?.shotDistance).toBeTruthy();
      expect(beat.coveragePlan?.cameraAngle).toBeTruthy();
      expect(beat.coveragePlan?.stagingPattern).toBeTruthy();
      expect(beat.coveragePlan?.coverageReason).toContain(beat.sequenceIntent?.beatRole);
      expect(beat.sequenceIntent?.visualThread).toBeTruthy();
    }
  });

  it('preserves strong authored coverage plans', () => {
    const scene = sceneFor('authored', 'Mara places the ring in Ilya\'s palm.');
    scene.beats[1].coveragePlan = {
      stagingPattern: 'insert',
      shotDistance: 'CU',
      cameraAngle: 'low angle',
      cameraSide: 'right-of-axis',
      focalCharacterIds: ['hero'],
      requiredVisibleCharacterIds: ['hero'],
      optionalVisibleCharacterIds: [],
      offscreenCharacterIds: ['rival'],
      relationshipBlocking: 'The ring controls the frame.',
      coverageReason: 'Authored insert beat.',
    };

    applySequenceDirectorPlan(scene);

    expect(scene.beats[1].coveragePlan?.stagingPattern).toBe('insert');
    expect(scene.beats[1].coveragePlan?.shotDistance).toBe('CU');
    expect(scene.beats[1].coveragePlan?.coverageReason).toBe('Authored insert beat.');
  });
});
