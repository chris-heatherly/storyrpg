import { describe, expect, it } from 'vitest';

import { applySequenceDirectorPlan } from './SequenceDirector';
import type { SceneContent } from './SceneWriter';
import { auditSequencePlanSpecificity } from '../validators/sequencePlanSpecificityAudit';

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
    expect(scene.sceneVisualSequencePlan?.anchorZones?.length).toBeGreaterThan(0);
    expect(scene.sceneVisualSequencePlan?.boundaryOrThreshold).toBeTruthy();
    expect(scene.sequenceIntent?.activity).toBeTruthy();
    expect(auditSequencePlanSpecificity(scene.sceneVisualSequencePlan).passed).toBe(true);

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

  it('preserves a strong authored scene visual sequence plan while filling gaps', () => {
    const scene = sceneFor('authored-plan', 'Mara slides the glass across the bar without looking at Ilya.');
    scene.sceneVisualSequencePlan = {
      objective: 'Mara tests whether Ilya will protect her secret without asking for the price.',
      activity: 'Mara moves the untouched glass from her side of the bar to the exact find between them.',
      obstacle: 'The bartender keeps returning to the mirror behind them, making every glance risky.',
      geography: 'A narrow red bar with Mara at the left stool, Ilya at the right stool, the mirror behind the bottles, and the exit behind Mara.',
      movementLine: 'The glass travels left-to-right across the bar while both characters refuse direct eye contact.',
      visualThread: 'the untouched glass becoming a border neither character wants to cross',
      shotRhythm: ['relationship', 'insert', 'reaction'],
      powerBlocking: 'Mara begins closer to the exit; the glass reaches the find; Ilya ends with his hand stopping short of it.',
      turningPoint: 'Ilya stops the glass with one finger but does not take it.',
      endState: 'The glass sits between them as a visible truce with no trust yet.',
      anchorZones: ['Mara left of the bar near the exit', 'the glass at the find', 'Ilya right of the bar under the mirror'],
      boundaryOrThreshold: 'the find of the bar is the trust line neither fully crosses',
      // Intentionally weak so SequenceDirector still repairs only this field.
      physicalCarrier: 'tbd',
      rhythmIntent: 'Hold the bar axis but let each panel find the most expressive subject for the changing truce.',
      avoid: ['turning the exchange into a generic centered two-shot'],
    };

    applySequenceDirectorPlan(scene);

    expect(scene.sceneVisualSequencePlan?.geography).toContain('narrow red bar');
    expect(scene.sceneVisualSequencePlan?.movementLine).toContain('left-to-right');
    expect(scene.sceneVisualSequencePlan?.visualThread).toContain('untouched glass');
    expect(scene.sceneVisualSequencePlan?.shotRhythm).toEqual(['relationship', 'insert', 'reaction']);
    expect(scene.sceneVisualSequencePlan?.physicalCarrier).toMatch(/glass/i);
    expect(scene.sceneVisualSequencePlan?.avoid).toContain('turning the exchange into a generic centered two-shot');
  });

  it('gives quiet dialogue a physical carrier', () => {
    const scene = sceneFor('quiet-blog', 'Mara sits at the laptop and writes the draft while the phone glows beside the bed.');

    applySequenceDirectorPlan(scene);

    expect(scene.sceneVisualSequencePlan?.physicalCarrier).toMatch(/laptop|phone|draft/i);
    expect(auditSequencePlanSpecificity(scene.sceneVisualSequencePlan, { requirePhysicalCarrier: true }).passed).toBe(true);
  });

  it('flags generic sequence plans', () => {
    const result = auditSequencePlanSpecificity({
      objective: 'visible emotional shift',
      activity: 'visible exchange',
      obstacle: 'pressure',
      geography: 'Blog Launch geography',
      movementLine: 'track power through distance',
      visualThread: 'visible emotional shift',
      shotRhythm: ['establishing', 'relationship'],
      powerBlocking: 'Track power through height, foreground/background, distance, who controls the key object, and who has a clear exit.',
      turningPoint: 'A visible shift changes leverage, attention, distance, or object control.',
      endState: 'new emotional position',
    });

    expect(result.passed).toBe(false);
    expect(result.issues.some((issue) => issue.field === 'geography')).toBe(true);
    expect(result.issues.some((issue) => issue.field === 'powerBlocking')).toBe(true);
  });
});
