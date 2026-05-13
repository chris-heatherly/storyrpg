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
});
