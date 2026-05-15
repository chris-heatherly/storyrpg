/**
 * DivergenceValidator
 *
 * Runs the path simulator across an episode and flags branches that
 * converge to identical terminal state — cosmetic branching — or where
 * early choices produce no downstream divergence.
 *
 * Heuristics:
 *   - Group terminals by fingerprint. If fewer than 2 distinct fingerprints
 *     exist for an episode with >= 2 choice points, flag "cosmetic branching".
 *   - For each decision-point, if all children paths converge to the same
 *     fingerprint, flag the decision-point as "no-op branching".
 */

import { BaseValidator, ValidationResult, ValidationIssue } from './BaseValidator';
import { Episode } from '../../types';
import { simulateEpisodePaths, PathSimulationResult, TerminalState } from './pathSimulator';

export interface DivergenceInput {
  episode: Episode;
  /** Optional override: provide a pre-computed simulation result. */
  simulation?: PathSimulationResult;
}

export interface DivergenceMetrics {
  totalTerminals: number;
  distinctFingerprints: number;
  divergenceRatio: number;
  choicePointsEvaluated: number;
  cosmeticChoicePoints: number;
}

export interface DivergenceResult extends ValidationResult {
  metrics: DivergenceMetrics;
  /** Representative fingerprints (truncated). */
  fingerprints: string[];
}

export class DivergenceValidator extends BaseValidator {
  constructor() {
    super('DivergenceValidator');
  }

  validate(input: DivergenceInput): DivergenceResult {
    const issues: ValidationIssue[] = [];
    const sim = input.simulation || simulateEpisodePaths(input.episode);
    const terminals = sim.terminals;

    const fingerprintCounts = new Map<string, number>();
    for (const t of terminals) {
      fingerprintCounts.set(t.fingerprint, (fingerprintCounts.get(t.fingerprint) || 0) + 1);
    }

    const distinct = fingerprintCounts.size;
    const total = terminals.length;
    const divergenceRatio = total > 0 ? distinct / total : 1;
    const choicePointsEvaluated = countChoicePoints(input.episode);

    const metrics: DivergenceMetrics = {
      totalTerminals: total,
      distinctFingerprints: distinct,
      divergenceRatio,
      choicePointsEvaluated,
      cosmeticChoicePoints: 0,
    };

    if (choicePointsEvaluated >= 2 && distinct <= 1 && total > 1) {
      issues.push({
        severity: 'error',
        message: `All ${total} simulated paths converge to a single terminal state (cosmetic branching)`,
        suggestion:
          'Add consequences (flags/scores/relationships) that persist from at least one branch so the state space actually diverges.',
      });
    }

    const decisionPointConvergence = analyzeDecisionPoints(input.episode, terminals);
    metrics.cosmeticChoicePoints = decisionPointConvergence.cosmeticChoicePoints;
    for (const msg of decisionPointConvergence.issueMessages) {
      issues.push({
        severity: 'warning',
        message: msg,
        suggestion:
          'Ensure this decision point\'s choices produce different flag/score/relationship consequences.',
      });
    }

    if (sim.truncated) {
      issues.push({
        severity: 'info',
        message: `Path simulation was truncated (explored ${sim.exploredCount}, capped at terminals)`,
      });
    }

    const errors = issues.filter(i => i.severity === 'error').length;
    const warnings = issues.filter(i => i.severity === 'warning').length;
    const score = Math.max(0, 100 - errors * 30 - warnings * 8);

    const fingerprints = Array.from(fingerprintCounts.keys()).slice(0, 20);

    return {
      valid: errors === 0,
      score,
      issues,
      suggestions: issues.map(i => i.suggestion).filter((s): s is string => Boolean(s)),
      metrics,
      fingerprints,
    };
  }
}

function countChoicePoints(episode: Episode): number {
  let n = 0;
  for (const s of episode.scenes) {
    const hasBeatChoice = s.beats.some(b => b.choices && b.choices.length > 0);
    if (hasBeatChoice) n++;
  }
  return n;
}

function analyzeDecisionPoints(
  episode: Episode,
  terminals: TerminalState[],
): { cosmeticChoicePoints: number; issueMessages: string[] } {
  // For each recorded choice id, collect the set of terminal fingerprints
  // that include it in their path. If a choice's terminals all share one
  // fingerprint AND all paths in the episode share the same fingerprint
  // regardless of this choice, the choice itself is cosmetic.
  const choiceToFingerprints = new Map<string, Set<string>>();
  for (const t of terminals) {
    for (const choiceId of t.path) {
      let set = choiceToFingerprints.get(choiceId);
      if (!set) {
        set = new Set();
        choiceToFingerprints.set(choiceId, set);
      }
      set.add(t.fingerprint);
    }
  }

  let cosmetic = 0;
  const messages: string[] = [];
  for (const scene of episode.scenes) {
    const beatWithChoices = [...scene.beats].reverse().find(b => b.choices && b.choices.length > 0);
    const choices = beatWithChoices?.choices || [];
    if (!choices || choices.length < 2) continue;
    const fpSetsPerChoice = choices.map((c: { id: string }) => choiceToFingerprints.get(c.id) || new Set<string>());
    const nonEmpty = fpSetsPerChoice.filter((s: Set<string>) => s.size > 0);
    if (nonEmpty.length < 2) continue;
    const allSame = allSetsEqual(nonEmpty);
    if (allSame) {
      cosmetic++;
      messages.push(
        `Decision point in scene "${scene.id}" appears cosmetic — all choices produce the same terminal state fingerprint(s).`,
      );
    }
  }
  return { cosmeticChoicePoints: cosmetic, issueMessages: messages };
}

function allSetsEqual(sets: Array<Set<string>>): boolean {
  if (sets.length < 2) return true;
  const first = sets[0];
  for (let i = 1; i < sets.length; i++) {
    const s = sets[i];
    if (s.size !== first.size) return false;
    for (const v of s) if (!first.has(v)) return false;
  }
  return true;
}
