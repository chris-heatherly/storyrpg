import type {
  NarrativeRealizationTask,
  NarrativeTaskSatisfactionExpression,
  NarrativeVerificationAuthority,
} from '../../types/narrativeContract';
import { inferNarrativeVerificationAuthority } from './realizationVerificationAuthority';

export type NarrativeAtomVerdictOutcome =
  | 'pass'
  | 'miss'
  | 'inconclusive'
  | 'unavailable';

export interface NarrativeAtomVerdict {
  taskId: string;
  atomId: string;
  groupKey: string;
  authority: NarrativeVerificationAuthority;
  outcome: NarrativeAtomVerdictOutcome;
}

export interface NarrativeTaskSatisfactionResult {
  status: 'satisfied' | 'missing' | 'pending' | 'inconclusive' | 'unavailable';
  missingAtomIds: string[];
  inconclusiveAtomIds: string[];
  unavailableAtomIds: string[];
  unresolvedAtomIds: string[];
}

function positiveAtomIds(task: NarrativeRealizationTask): string[] {
  return task.evidenceAtoms
    .filter((atom) => atom.polarity !== 'forbidden')
    .map((atom) => atom.id);
}

/** Pure compatibility normalization. New compilers persist `satisfaction`;
 * old tasks retain their historical threshold/all-required meaning. */
export function satisfactionExpressionForTask(
  task: NarrativeRealizationTask,
): NarrativeTaskSatisfactionExpression {
  if (task.satisfaction) return task.satisfaction;
  const positiveIds = positiveAtomIds(task);
  const expression: NarrativeTaskSatisfactionExpression = task.minimumEvidenceHits != null
    ? {
        allOfAtomIds: [],
        anyOfGroups: [{
          id: `${task.id}:legacy-threshold`,
          atomIds: positiveIds,
          minimumHits: task.minimumEvidenceHits,
        }],
      }
    : {
        allOfAtomIds: task.evidenceAtoms
          .filter((atom) => atom.polarity !== 'forbidden' && atom.required)
          .map((atom) => atom.id),
        anyOfGroups: [],
      };
  for (const group of task.evidenceGroups ?? []) {
    expression.anyOfGroups.push({
      id: group.id,
      atomIds: [...group.atomIds],
      minimumHits: group.requirement === 'all'
        ? group.atomIds.length
        : group.requirement === 'any'
          ? 1
          : Math.max(1, group.minimumEvidenceHits ?? 1),
    });
  }
  return expression;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

export function evaluateTaskSatisfaction(
  task: NarrativeRealizationTask,
  verdicts: NarrativeAtomVerdict[],
): NarrativeTaskSatisfactionResult {
  const byAtomId = new Map(verdicts.map((verdict) => [verdict.atomId, verdict.outcome]));
  const expression = satisfactionExpressionForTask(task);
  const missing: string[] = [];
  const inconclusive: string[] = [];
  const unavailable: string[] = [];
  const unresolved: string[] = [];

  const classify = (atomId: string): void => {
    const outcome = byAtomId.get(atomId);
    if (outcome === 'miss') missing.push(atomId);
    else if (outcome === 'inconclusive') inconclusive.push(atomId);
    else if (outcome === 'unavailable') unavailable.push(atomId);
    else if (outcome !== 'pass') unresolved.push(atomId);
  };

  for (const atomId of expression.allOfAtomIds) classify(atomId);
  for (const group of expression.anyOfGroups) {
    const passed = group.atomIds.filter((atomId) => byAtomId.get(atomId) === 'pass').length;
    if (passed >= group.minimumHits) continue;
    const candidates = group.atomIds.filter((atomId) => byAtomId.get(atomId) !== 'pass');
    const possible = candidates.filter((atomId) => byAtomId.get(atomId) !== 'miss').length;
    if (passed + possible < group.minimumHits) {
      missing.push(...candidates.filter((atomId) => byAtomId.get(atomId) === 'miss'));
      continue;
    }
    for (const atomId of candidates.filter((atomId) => byAtomId.get(atomId) !== 'miss')) classify(atomId);
  }

  for (const atom of task.evidenceAtoms.filter((candidate) => candidate.polarity === 'forbidden')) {
    classify(atom.id);
  }

  if (missing.length > 0) {
    return { status: 'missing', missingAtomIds: unique(missing), inconclusiveAtomIds: [], unavailableAtomIds: [], unresolvedAtomIds: [] };
  }
  if (unavailable.length > 0) {
    return { status: 'unavailable', missingAtomIds: [], inconclusiveAtomIds: [], unavailableAtomIds: unique(unavailable), unresolvedAtomIds: unique(unresolved) };
  }
  if (inconclusive.length > 0) {
    return { status: 'inconclusive', missingAtomIds: [], inconclusiveAtomIds: unique(inconclusive), unavailableAtomIds: [], unresolvedAtomIds: unique(unresolved) };
  }
  if (unresolved.length > 0) {
    return { status: 'pending', missingAtomIds: [], inconclusiveAtomIds: [], unavailableAtomIds: [], unresolvedAtomIds: unique(unresolved) };
  }
  return { status: 'satisfied', missingAtomIds: [], inconclusiveAtomIds: [], unavailableAtomIds: [], unresolvedAtomIds: [] };
}

export function semanticAtomsNeededForTask(
  task: NarrativeRealizationTask,
  groupKey: string,
  knownVerdicts: NarrativeAtomVerdict[],
): Set<string> {
  const relevant = knownVerdicts.filter((verdict) => verdict.groupKey === groupKey);
  if (evaluateTaskSatisfaction(task, relevant).status === 'satisfied') return new Set();
  return new Set(task.evidenceAtoms
    .filter((atom) => inferNarrativeVerificationAuthority(atom) === 'semantic_judge')
    .map((atom) => atom.id));
}
