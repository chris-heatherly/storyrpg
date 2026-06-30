import type { NarrativeSequenceIntent } from '../../types';
import type { BeatCoveragePlan } from '../../types';

export interface SequenceAuditPanel {
  id?: string;
  beatId?: string;
  family?: string;
  narrativeText?: string;
  visualMoment?: string;
  primaryAction?: string;
  emotionalRead?: string;
  relationshipDynamic?: string;
  mustShowDetail?: string;
  visibleCost?: string;
  visualNarrative?: string;
  sequenceIntent?: NarrativeSequenceIntent;
  coveragePlan?: BeatCoveragePlan;
  storyboardRole?: string;
}

export interface SequenceContinuityIssue {
  panelId: string;
  category: 'missing_sequence_objective' | 'missing_visual_thread' | 'missing_sequence_turn';
  severity: 'warning';
  message: string;
  suggestion: string;
}

export interface SequenceContinuityAuditOptions {
  requireCoveragePlan?: boolean;
  requireShotVariety?: boolean;
}

function panelId(panel: SequenceAuditPanel, index: number): string {
  return panel.id || panel.beatId || `panel-${index + 1}`;
}

function panelText(panel: SequenceAuditPanel): string {
  return [
    panel.narrativeText,
    panel.visualMoment,
    panel.primaryAction,
    panel.emotionalRead,
    panel.relationshipDynamic,
    panel.mustShowDetail,
    panel.visibleCost,
    panel.visualNarrative,
    panel.storyboardRole,
    panel.sequenceIntent?.objective,
    panel.sequenceIntent?.activity,
    panel.sequenceIntent?.obstacle,
    panel.sequenceIntent?.startState,
    panel.sequenceIntent?.turningPoint,
    panel.sequenceIntent?.endState,
    panel.sequenceIntent?.visualThread,
    panel.sequenceIntent?.mechanicThread,
  ].filter(Boolean).join(' ').toLowerCase();
}

function hasSequenceObjective(panel: SequenceAuditPanel): boolean {
  return Boolean(panel.sequenceIntent?.objective || panel.sequenceIntent?.activity);
}

function hasVisualThread(panel: SequenceAuditPanel): boolean {
  return Boolean(panel.sequenceIntent?.visualThread || panel.mustShowDetail || panel.relationshipDynamic || panel.visibleCost);
}

function hasTurn(panel: SequenceAuditPanel): boolean {
  const text = panelText(panel);
  return Boolean(panel.sequenceIntent?.turningPoint || panel.sequenceIntent?.endState)
    || /\b(changes?|shifts?|turns?|reveals?|gives?|takes?|loses?|gains?|backs? away|steps? closer|breaks?|settles?|chooses?|refuses?)\b/i.test(text);
}

function isQuietAllowed(panel: SequenceAuditPanel): boolean {
  return /\b(rest|aftermath|quiet|settle|recover|relief|somber|release|taking stock|recalibrat)\b/i.test(panelText(panel));
}

export function auditSequenceContinuity(panels: SequenceAuditPanel[], options: SequenceContinuityAuditOptions = {}): SequenceContinuityIssue[] {
  const issues: SequenceContinuityIssue[] = [];
  if (panels.length < 2) return issues;

  const missingObjectiveRun = panels.filter((panel) => !hasSequenceObjective(panel));
  if (missingObjectiveRun.length === panels.length) {
    const last = panels[panels.length - 1];
    issues.push({
      panelId: panelId(last, panels.length - 1),
      category: 'missing_sequence_objective',
      severity: 'warning',
      message: 'Storyboard chunk has multiple panels but no sequence objective or visible activity.',
      suggestion: 'Add or derive sequenceIntent so the panels share an objective, activity, obstacle, turn, and handoff.',
    });
  }

  for (let index = 1; index < panels.length; index += 1) {
    const previous = panels[index - 1];
    const panel = panels[index];
    if (!hasVisualThread(panel) && !hasVisualThread(previous)) {
      issues.push({
        panelId: panelId(panel, index),
        category: 'missing_visual_thread',
        severity: 'warning',
        message: 'Adjacent storyboard panels do not preserve a visible thread such as a prop, distance, blocking, cost, clue, or motif.',
        suggestion: 'Carry a visualThread across the sequence so the storyboard reads as a connected action, argument, investigation, travel, or aftermath.',
      });
    }
  }

  if (options.requireCoveragePlan) {
    for (let index = 0; index < panels.length; index += 1) {
      const panel = panels[index];
      if (isQuietAllowed(panel)) continue;
      if (!panel.coveragePlan) {
        issues.push({
          panelId: panelId(panel, index),
          category: 'missing_visual_thread',
          severity: 'warning',
          message: 'Storyboard panel is missing a coveragePlan, so shot scale, angle, staging, visible cast, and continuity are being inferred too late.',
          suggestion: 'Run SequenceDirector or author coveragePlan before image generation.',
        });
      }
    }
  }

  if (options.requireShotVariety) {
    const coverageKeys = panels
      .map((panel) => panel.coveragePlan)
      .filter(Boolean)
      .map((coverage) => `${coverage!.shotDistance}|${coverage!.cameraAngle}|${coverage!.cameraSide}|${coverage!.stagingPattern}`);
    if (coverageKeys.length >= 3 && new Set(coverageKeys).size <= 1) {
      issues.push({
        panelId: panelId(panels[panels.length - 1], panels.length - 1),
        category: 'missing_sequence_turn',
        severity: 'warning',
        message: 'Storyboard sequence repeats the same coverage shape across the scene.',
        suggestion: 'Vary shot distance, angle, camera side, staging pattern, focal subject, or continuity mode according to the sequence role.',
      });
    }
  }

  const terminal = panels[panels.length - 1];
  if (!hasTurn(terminal) && !isQuietAllowed(terminal)) {
    issues.push({
      panelId: panelId(terminal, panels.length - 1),
      category: 'missing_sequence_turn',
      severity: 'warning',
      message: 'Storyboard sequence ends without a visible turn, consequence, or recalibrated end state.',
      suggestion: 'Make the final panel show what changed: leverage, trust, evidence, proximity, risk, resource, identity, knowledge, or aftermath posture.',
    });
  }

  return issues;
}
