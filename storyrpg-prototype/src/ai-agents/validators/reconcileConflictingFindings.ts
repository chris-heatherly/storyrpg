import type { FinalStoryContractIssue } from './FinalStoryContractValidator';

/**
 * Cross-validator precedence for gate pairs whose repairs are mutually
 * exclusive on the same scene. When both validators flag the same scene as an
 * error in the same validation round, the loser is downgraded to a warning so
 * the repair loop acts on exactly one instruction instead of ping-ponging the
 * scene between contradictory rewrites.
 *
 * Rule of thumb encoded here: an authored contract (treatment-sourced
 * obligation) outranks a heuristic craft gate on the same scene.
 *
 * First entry (bite-me 2026-07-02T19-39-25, scene s1-1): the treatment event
 * ledger demanded the owned "arrival" cue be staged on-page while the spatial
 * unit gate demanded the same scene be split because the arrival spans two
 * locations — unsatisfiable in both directions.
 */
interface FindingPrecedenceRule {
  /** Validator whose finding survives at full severity. */
  winner: string;
  /** Validator whose same-scene error is downgraded to a warning. */
  loser: string;
  /** Appended to the downgraded finding's suggestion for run diagnostics. */
  note: string;
}

const FINDING_PRECEDENCE_RULES: FindingPrecedenceRule[] = [
  {
    winner: 'TreatmentEventLedgerValidator',
    loser: 'SceneSpatialUnitValidator',
    note: 'Downgraded: authored event ownership outranks the spatial-unit heuristic on this scene; stage the owned event and let transition-continuity handle the location bridge.',
  },
];

/**
 * Downgrade heuristic-craft errors that contradict an authored-contract error
 * on the same scene. Mutates severities in place and returns the number of
 * findings downgraded (for diagnostics).
 */
export function reconcileConflictingFindings(issues: FinalStoryContractIssue[]): number {
  let downgraded = 0;
  for (const rule of FINDING_PRECEDENCE_RULES) {
    const winnerScenes = new Set(
      issues
        .filter((issue) => issue.severity === 'error' && issue.validator === rule.winner && issue.sceneId)
        .map((issue) => issue.sceneId as string),
    );
    if (winnerScenes.size === 0) continue;
    for (const issue of issues) {
      if (issue.severity !== 'error' || issue.validator !== rule.loser) continue;
      if (!issue.sceneId || !winnerScenes.has(issue.sceneId)) continue;
      issue.severity = 'warning';
      issue.suggestion = issue.suggestion ? `${issue.suggestion} ${rule.note}` : rule.note;
      downgraded += 1;
    }
  }
  return downgraded;
}
