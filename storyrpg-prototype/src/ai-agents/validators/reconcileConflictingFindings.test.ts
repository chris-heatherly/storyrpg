import { describe, expect, it } from 'vitest';
import type { FinalStoryContractIssue } from './FinalStoryContractValidator';
import { reconcileConflictingFindings } from './reconcileConflictingFindings';

function eventLedgerError(sceneId: string): FinalStoryContractIssue {
  return {
    type: 'treatment_event_ledger_violation',
    severity: 'error',
    message: `Treatment event ownership miss in scene "${sceneId}".`,
    sceneId,
    validator: 'TreatmentEventLedgerValidator',
    suggestion: 'Regenerate the owning scene so it stages the owned treatment event on-page.',
  } as FinalStoryContractIssue;
}

function spatialUnitError(sceneId: string): FinalStoryContractIssue {
  return {
    type: 'treatment_fidelity_violation',
    severity: 'error',
    message: `Scene "${sceneId}" conducts meaningful action in multiple major locations.`,
    sceneId,
    validator: 'SceneSpatialUnitValidator',
    suggestion: 'Split this into one full scene per major named location.',
  } as FinalStoryContractIssue;
}

describe('reconcileConflictingFindings', () => {
  it('downgrades the spatial-unit error when the event ledger also blocks the same scene', () => {
    const issues = [eventLedgerError('s1-1'), spatialUnitError('s1-1')];

    const downgraded = reconcileConflictingFindings(issues);

    expect(downgraded).toBe(1);
    expect(issues[0].severity).toBe('error');
    expect(issues[1].severity).toBe('warning');
    expect(issues[1].suggestion).toContain('authored event ownership outranks');
  });

  it('leaves a spatial-unit error alone when the conflicting validator flags a different scene', () => {
    const issues = [eventLedgerError('s1-1'), spatialUnitError('s2-3')];

    const downgraded = reconcileConflictingFindings(issues);

    expect(downgraded).toBe(0);
    expect(issues[1].severity).toBe('error');
  });

  it('leaves a lone spatial-unit error blocking (no conflict, real defect)', () => {
    const issues = [spatialUnitError('s1-1')];

    const downgraded = reconcileConflictingFindings(issues);

    expect(downgraded).toBe(0);
    expect(issues[0].severity).toBe('error');
  });

  it('ignores winner findings that are already warnings', () => {
    const winner = { ...eventLedgerError('s1-1'), severity: 'warning' as const };
    const issues = [winner, spatialUnitError('s1-1')];

    const downgraded = reconcileConflictingFindings(issues);

    expect(downgraded).toBe(0);
    expect(issues[1].severity).toBe('error');
  });

  it('downgrades the mechanic-pressure error when a mechanics leak blocks the same scene', () => {
    const leak: FinalStoryContractIssue = {
      type: 'qa_blocker_present',
      severity: 'error',
      message: 'Player-facing text "s1-2:b3" exposes numeric stat delta.',
      sceneId: 's1-2',
      validator: 'MechanicsLeakageValidator',
      suggestion: 'Redact the raw stat delta.',
    } as FinalStoryContractIssue;
    const pressure: FinalStoryContractIssue = {
      type: 'mechanic_pressure_violation',
      severity: 'error',
      message: 'Scene "s1-2" does not surface the mechanic as visible story pressure.',
      sceneId: 's1-2',
      validator: 'NarrativeMechanicPressureValidator',
      suggestion: 'Surface the mechanic as fiction-safe pressure.',
    } as FinalStoryContractIssue;
    const issues = [leak, pressure];

    const downgraded = reconcileConflictingFindings(issues);

    expect(downgraded).toBe(1);
    expect(issues[0].severity).toBe('error');
    expect(issues[1].severity).toBe('warning');
    expect(issues[1].suggestion).toContain('fiction-first is non-negotiable');
  });
});
