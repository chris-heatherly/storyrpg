import { describe, expect, it } from 'vitest';
import { auditSequenceContinuity } from './sequenceContinuityAudit';

describe('auditSequenceContinuity', () => {
  it('warns when a multi-panel chunk has no sequence objective', () => {
    const issues = auditSequenceContinuity([
      { id: 'p1', narrativeText: 'Mara looks at Ilya.' },
      { id: 'p2', narrativeText: 'Ilya looks back.' },
    ]);

    expect(issues.some((issue) => issue.category === 'missing_sequence_objective')).toBe(true);
  });

  it('warns when adjacent panels do not preserve a visible thread', () => {
    const issues = auditSequenceContinuity([
      {
        id: 'p1',
        narrativeText: 'Mara starts the argument.',
        sequenceIntent: { objective: 'Win the argument', activity: 'argument', turningPoint: 'Mara presses', endState: 'Ilya yields' },
      },
      {
        id: 'p2',
        narrativeText: 'Ilya changes the subject.',
        sequenceIntent: { objective: 'Win the argument', activity: 'argument', turningPoint: 'Mara presses', endState: 'Ilya yields' },
      },
    ]);

    expect(issues.some((issue) => issue.category === 'missing_visual_thread')).toBe(true);
  });

  it('allows quiet aftermath when it names visible recalibration', () => {
    const issues = auditSequenceContinuity([
      {
        id: 'p1',
        narrativeText: 'Mara sits in quiet aftermath.',
        mustShowDetail: 'the broken cup between her hands',
        sequenceIntent: {
          objective: 'Recover after the confrontation',
          activity: 'quiet recovery',
          turningPoint: 'Her hands stop shaking',
          endState: 'Her posture steadies',
          visualThread: 'the broken cup',
        },
      },
      {
        id: 'p2',
        narrativeText: 'Her breathing settles as she sets the cup down.',
        mustShowDetail: 'the broken cup on the table',
        sequenceIntent: {
          objective: 'Recover after the confrontation',
          activity: 'quiet recovery',
          turningPoint: 'Her hands stop shaking',
          endState: 'Her posture steadies',
          visualThread: 'the broken cup',
        },
      },
    ]);

    expect(issues).toEqual([]);
  });

  it('blocks new storyboard sequences that lack coverage plans', () => {
    const issues = auditSequenceContinuity([
      {
        id: 'p1',
        narrativeText: 'Mara enters the market with Ilya behind her.',
        mustShowDetail: 'the red scarf',
        sequenceIntent: {
          objective: 'Cross the market without being recognized',
          activity: 'market crossing',
          turningPoint: 'A guard notices the scarf',
          endState: 'Mara hides the scarf',
          visualThread: 'the red scarf',
        },
      },
      {
        id: 'p2',
        narrativeText: 'The guard notices the scarf and Mara turns away.',
        mustShowDetail: 'the red scarf',
        sequenceIntent: {
          objective: 'Cross the market without being recognized',
          activity: 'market crossing',
          turningPoint: 'A guard notices the scarf',
          endState: 'Mara hides the scarf',
          visualThread: 'the red scarf',
        },
      },
    ], { requireCoveragePlan: true });

    expect(issues.some((issue) => issue.message.includes('coveragePlan'))).toBe(true);
  });

  it('passes coherent storyboard sequences with coverage and varied shots', () => {
    const baseIntent = {
      objective: 'Catch the tortoise before it disappears',
      activity: 'sidewalk pursuit',
      turningPoint: 'The tortoise slips toward the subway',
      endState: 'The protagonist catches it and the pace settles',
      visualThread: 'the tortoise moving through the city',
    };
    const issues = auditSequenceContinuity([
      {
        id: 'p1',
        narrativeText: 'She spots the tortoise on the sidewalk.',
        mustShowDetail: 'the tortoise near her shoes',
        sequenceIntent: { ...baseIntent, beatRole: 'setup' },
        coveragePlan: {
          stagingPattern: 'environment',
          shotDistance: 'LS',
          cameraAngle: 'eye-level',
          cameraSide: 'front-left',
          focalCharacterIds: ['hero'],
          requiredVisibleCharacterIds: ['hero'],
          optionalVisibleCharacterIds: [],
          offscreenCharacterIds: [],
          relationshipBlocking: 'the tortoise is low and ahead',
          coverageReason: 'setup geography',
        },
      },
      {
        id: 'p2',
        narrativeText: 'The tortoise reaches the subway stairs.',
        mustShowDetail: 'the tortoise at the stair edge',
        sequenceIntent: { ...baseIntent, beatRole: 'turn' },
        coveragePlan: {
          stagingPattern: 'insert',
          shotDistance: 'CU',
          cameraAngle: 'high angle',
          cameraSide: 'side-profile',
          focalCharacterIds: [],
          requiredVisibleCharacterIds: [],
          optionalVisibleCharacterIds: [],
          offscreenCharacterIds: ['hero'],
          relationshipBlocking: 'the stairs become the obstacle',
          coverageReason: 'turn detail',
        },
      },
      {
        id: 'p3',
        narrativeText: 'She catches the tortoise and sits with it.',
        mustShowDetail: 'the tortoise safe in both hands',
        sequenceIntent: { ...baseIntent, beatRole: 'aftermath' },
        coveragePlan: {
          stagingPattern: 'solo-reaction',
          shotDistance: 'MS',
          cameraAngle: 'low angle',
          cameraSide: 'front-right',
          focalCharacterIds: ['hero'],
          requiredVisibleCharacterIds: ['hero'],
          optionalVisibleCharacterIds: [],
          offscreenCharacterIds: [],
          relationshipBlocking: 'the chase resolves into gentle contact',
          coverageReason: 'aftermath payoff',
        },
      },
    ], { requireCoveragePlan: true, requireShotVariety: true });

    expect(issues).toEqual([]);
  });
});
