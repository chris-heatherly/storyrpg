import type {
  NarrativeRealizationOwnerStage,
  NarrativeRealizationTask,
} from '../../types/narrativeContract';
import {
  collectNarrativeEvidenceSurfaceIndex,
  collectRouteEvidenceSurfaceIndex,
  type NarrativeEvidenceSurfaceIndex,
} from '../validators/encounterTextSurfaces';

export interface RealizationTaskGateFinding {
  code: 'OWNER_REALIZATION_MISSING' | 'OWNER_FORBIDDEN_EVIDENCE_PRESENT';
  taskId: string;
  contractId: string;
  sceneId: string;
  outcomeTier?: string;
  ownerStage: NarrativeRealizationOwnerStage;
  blocking: boolean;
  field: string;
  message: string;
  missingEvidenceAtoms?: string[];
  matchedForbiddenAtoms?: string[];
  evidenceDiagnostics?: EvidenceMatchDiagnostic[];
  fingerprint: string;
}

export interface EvidenceMatchDiagnostic {
  atomId: string;
  matched: boolean;
  bestPattern?: string;
  score: number;
  matchedTerms: string[];
  missingTerms: string[];
}

export function prioritizeOwnerRepairFindings(
  findings: RealizationTaskGateFinding[],
  tasks: NarrativeRealizationTask[],
): RealizationTaskGateFinding[] {
  const taskById = new Map(tasks.map((task) => [task.id, task]));
  return [...findings].sort((left, right) => {
    const leftTask = taskById.get(left.taskId);
    const rightTask = taskById.get(right.taskId);
    const leftPriority = leftTask?.canonicalEventId ? 0 : left.code === 'OWNER_FORBIDDEN_EVIDENCE_PRESENT' ? 1 : 2;
    const rightPriority = rightTask?.canonicalEventId ? 0 : right.code === 'OWNER_FORBIDDEN_EVIDENCE_PRESENT' ? 1 : 2;
    return leftPriority - rightPriority || left.fingerprint.localeCompare(right.fingerprint);
  });
}

/** A repair may clear its target, but may never introduce a new blocker. */
export function shouldAdoptOwnerRepairCandidate(input: {
  previous: RealizationTaskGateFinding[];
  candidate: RealizationTaskGateFinding[];
  targetFingerprint: string;
}): boolean {
  const previousFingerprints = new Set(input.previous.map((finding) => finding.fingerprint));
  const candidateFingerprints = new Set(input.candidate.map((finding) => finding.fingerprint));
  if (candidateFingerprints.has(input.targetFingerprint)) return false;
  return [...candidateFingerprints].every((fingerprint) => previousFingerprints.has(fingerprint));
}

function outcomeTierForTask(task: NarrativeRealizationTask): string | undefined {
  return task.target.scope === 'route_path' || task.target.scope === 'route_terminal'
    ? task.target.outcomeTier
    : undefined;
}

export function realizationTaskFindingFingerprint(input: {
  code: RealizationTaskGateFinding['code'];
  taskId: string;
  sceneId: string;
  outcomeTier?: string;
  evidenceAtomIds: string[];
}): string {
  return [input.code, input.taskId, input.sceneId, input.outcomeTier ?? '', [...input.evidenceAtomIds].sort().join(',')].join('::');
}

function normalize(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function evidenceMatches(pattern: string, text: string): boolean {
  const needle = normalize(pattern);
  const haystack = normalize(text);
  if (!needle || !haystack) return false;
  if (haystack.includes(needle)) return true;
  const numericAge = needle.match(/\b(\d+) year old\b/);
  if (numericAge) {
    const ageIsPresent = new RegExp(`\\b(?:at|age|aged)\\s*${numericAge[1]}\\b`).test(haystack)
      || (new RegExp(`\\b${numericAge[1]}\\b`).test(haystack) && /\b(?:year|years|age|aged|old)\b/.test(haystack));
    const remainingWords = needle
      .replace(numericAge[0], '')
      .split(' ')
      .filter((word) => word.length >= 4);
    if (ageIsPresent && remainingWords.every((word) => haystack.split(' ').some((candidate) => candidate === word || candidate.startsWith(word) || word.startsWith(candidate)))) {
      return true;
    }
  }
  const words = needle.split(' ').filter((word) => word.length >= 4);
  if (words.length === 0) return false;
  const hayWords = new Set(haystack.split(' '));
  const stem = (word: string): string => word
    .replace(/(?:ing|ed|es|s)$/i, '')
    .replace(/i$/, 'y');
  const hits = words.filter((word) => hayWords.has(word)
    || [...hayWords].some((candidate) => candidate.startsWith(word) || word.startsWith(candidate) || stem(candidate) === stem(word)));
  return hits.length / words.length >= 0.6;
}

function evidenceMatchScore(pattern: string, text: string): Omit<EvidenceMatchDiagnostic, 'atomId' | 'matched' | 'bestPattern'> {
  const needle = normalize(pattern);
  const haystack = normalize(text);
  if (!needle || !haystack) return { score: 0, matchedTerms: [], missingTerms: needle.split(' ').filter(Boolean) };
  const terms = [...new Set(needle.split(' ').filter((word) => word.length >= 4))];
  if (haystack.includes(needle)) return { score: 1, matchedTerms: terms, missingTerms: [] };
  const hayWords = new Set(haystack.split(' '));
  const stem = (word: string): string => word.replace(/(?:ing|ed|es|s)$/i, '').replace(/i$/, 'y');
  const matchedTerms = terms.filter((word) => hayWords.has(word)
    || [...hayWords].some((candidate) => candidate.startsWith(word) || word.startsWith(candidate) || stem(candidate) === stem(word)));
  return {
    score: terms.length > 0 ? matchedTerms.length / terms.length : 0,
    matchedTerms,
    missingTerms: terms.filter((term) => !matchedTerms.includes(term)),
  };
}

function scopeTerms(task: NarrativeRealizationTask): string[] {
  const value = task.evidenceScope?.npcId || task.evidenceScope?.groupId;
  if (!value) return [];
  return normalize(value)
    .replace(/^char\s+/, '')
    .split(' ')
    .filter((term) => term.length >= 4);
}

function relationshipEvidenceMatches(task: NarrativeRealizationTask, pattern: string, text: string, kind?: string): boolean {
  if (kind === 'lexical') return normalize(text).includes(normalize(pattern));
  if (kind !== 'relationship_label') return evidenceMatches(pattern, text);
  const terms = scopeTerms(task);
  if (terms.length === 0) return evidenceMatches(pattern, text);
  const normalizedText = normalize(text);
  const normalizedPattern = normalize(pattern);
  const labelIndex = normalizedText.indexOf(normalizedPattern);
  if (labelIndex < 0) return false;
  if (normalizedPattern === 'friend' || normalizedPattern === 'friends') {
    const followingWord = normalizedText.slice(labelIndex + normalizedPattern.length).trim().split(' ')[0];
    if (followingWord && !['to', 'with', 'now'].includes(followingWord)
      && !terms.some((term) => term === followingWord || term.startsWith(followingWord) || followingWord.startsWith(term))) {
      return false;
    }
  }
  return terms.some((term) => {
    const termIndex = normalizedText.indexOf(term);
    return termIndex >= 0 && Math.abs(termIndex - labelIndex) <= 56;
  });
}
function textsForSurfaces(
  index: NarrativeEvidenceSurfaceIndex,
  surfaces: NarrativeRealizationTask['target']['surfaces'],
): string[] {
  return surfaces.flatMap((surface) => index[surface]).map(normalize);
}

function taskTextGroups(input: { sceneContent?: unknown; choiceSet?: unknown; encounter?: unknown; task: NarrativeRealizationTask }): string[][] {
  const target = input.task.target;
  if (target.scope === 'owner') {
    return [textsForSurfaces(collectNarrativeEvidenceSurfaceIndex(input), target.surfaces)];
  }
  if (target.scope === 'route_path') {
    return [textsForSurfaces(collectRouteEvidenceSurfaceIndex({ ...input, outcomeTier: target.outcomeTier }), target.surfaces)];
  }
  if (target.scope === 'route_terminal') {
    const terminalSurfaces = target.surfaces.filter((surface) => surface === 'encounter_outcome' || surface === 'terminal_storylet');
    return [textsForSurfaces(
      collectRouteEvidenceSurfaceIndex({ ...input, outcomeTier: target.outcomeTier }),
      terminalSurfaces,
    )];
  }
  if (target.scope === 'all_options') {
    const raw = input.choiceSet && typeof input.choiceSet === 'object'
      ? (input.choiceSet as { choices?: unknown[] }).choices
      : undefined;
    return (raw ?? []).map((choice) => {
      if (!choice || typeof choice !== 'object') return [];
      const record = choice as Record<string, unknown>;
      const structured = [
        typeof record.relationshipMilestoneId === 'string' ? `milestone:${record.relationshipMilestoneId}` : undefined,
        typeof record.relationshipGroupId === 'string' ? `group:${record.relationshipGroupId}` : undefined,
        ...((record.consequences as Array<Record<string, unknown>> | undefined) ?? [])
          .filter((consequence) => consequence?.type === 'relationship')
          .map((consequence) => typeof consequence.npcId === 'string' ? `consequence:${consequence.npcId}` : undefined),
        ...((record.relationshipValueEvidence as Array<Record<string, unknown>> | undefined) ?? [])
          .map((evidence) => typeof evidence?.npcId === 'string' ? `evidence:${evidence.npcId}` : undefined),
      ].filter((value): value is string => typeof value === 'string');
      const text = textsForSurfaces(collectNarrativeEvidenceSurfaceIndex({ choiceSet: { choices: [choice] } }), target.surfaces);
      return [...text, normalize(structured.join(' '))];
    });
  }
  return target.outcomeTiers.map((outcomeTier) => textsForSurfaces(
    collectRouteEvidenceSurfaceIndex({ ...input, outcomeTier }),
    target.surfaces,
  ));
}

function evaluateTaskGroup(task: NarrativeRealizationTask, texts: string[]): { missing: string[]; forbidden: string[]; diagnostics: EvidenceMatchDiagnostic[] } {
  const missing: string[] = [];
  const forbidden: string[] = [];
  const diagnostics: EvidenceMatchDiagnostic[] = [];
  const positiveAtoms = task.evidenceAtoms.filter((atom) => atom.polarity !== 'forbidden');
  const matchedPositiveAtoms = new Set<string>();
  for (const atom of task.evidenceAtoms) {
    let best: EvidenceMatchDiagnostic = { atomId: atom.id, matched: false, score: 0, matchedTerms: [], missingTerms: [] };
    for (const pattern of atom.acceptedPatterns) {
      for (const text of texts) {
        const matched = relationshipEvidenceMatches(task, pattern, text, atom.kind);
        const score = evidenceMatchScore(pattern, text);
        if (matched || score.score > best.score) {
          best = { atomId: atom.id, matched, bestPattern: pattern, ...score, score: matched ? Math.max(score.score, 1) : score.score };
        }
      }
    }
    const matched = best.matched;
    diagnostics.push(best);
    if (atom.polarity === 'forbidden') {
      if (matched) forbidden.push(atom.id);
    } else {
      if (matched) matchedPositiveAtoms.add(atom.id);
      if (task.minimumEvidenceHits == null && atom.required && !matched) missing.push(atom.id);
    }
  }
  if (task.minimumEvidenceHits != null && matchedPositiveAtoms.size < task.minimumEvidenceHits) {
    missing.push(...positiveAtoms.filter((atom) => !matchedPositiveAtoms.has(atom.id)).map((atom) => atom.id));
  }
  for (const group of task.evidenceGroups ?? []) {
    const groupAtoms = group.atomIds
      .map((atomId) => task.evidenceAtoms.find((atom) => atom.id === atomId))
      .filter((atom): atom is NarrativeRealizationTask['evidenceAtoms'][number] => Boolean(atom && atom.polarity !== 'forbidden'));
    const matched = groupAtoms.filter((atom) => matchedPositiveAtoms.has(atom.id));
    const requiredHits = group.minimumEvidenceHits ?? (group.requirement === 'all' ? groupAtoms.length : 1);
    const groupSatisfied = group.requirement === 'any'
      ? matched.length >= 1
      : matched.length >= requiredHits;
    if (!groupSatisfied) {
      missing.push(...groupAtoms.filter((atom) => !matchedPositiveAtoms.has(atom.id)).map((atom) => atom.id));
    }
  }
  return { missing: [...new Set(missing)], forbidden: [...new Set(forbidden)], diagnostics };
}

export function validateOwnerRealizationTasks(input: {
  sceneId: string;
  tasks?: NarrativeRealizationTask[];
  sceneContent?: unknown;
  choiceSet?: unknown;
  encounter?: unknown;
  mode?: 'owner' | 'final_regression';
  currentStage?: NarrativeRealizationOwnerStage;
}): RealizationTaskGateFinding[] {
  const findings: RealizationTaskGateFinding[] = [];
  for (const task of input.tasks ?? []) {
    if ((input.mode ?? 'owner') === 'owner' && input.currentStage && task.ownerStage !== input.currentStage) continue;
    const evaluations = taskTextGroups({ ...input, task }).map((texts) => evaluateTaskGroup(task, texts));
    const bestPositive = evaluations.reduce((best, candidate) => candidate.missing.length < best.missing.length ? candidate : best, evaluations[0] ?? { missing: task.evidenceAtoms.filter((atom) => atom.required && atom.polarity !== 'forbidden').map((atom) => atom.id), forbidden: [], diagnostics: [] });
    const missing = task.target.scope === 'any_route' && evaluations.some((evaluation) => evaluation.missing.length === 0)
      ? []
      : task.target.scope === 'all_options'
        ? (evaluations.length > 0
          ? [...new Set(evaluations.flatMap((evaluation) => evaluation.missing))]
          : task.evidenceAtoms.filter((atom) => atom.required && atom.polarity !== 'forbidden').map((atom) => atom.id))
        : bestPositive.missing;
    const forbidden = [...new Set(evaluations.flatMap((evaluation) => evaluation.forbidden))];
    if (missing.length > 0) {
      const outcomeTier = outcomeTierForTask(task);
      findings.push({
        code: 'OWNER_REALIZATION_MISSING',
        taskId: task.id,
        contractId: task.contractId,
        sceneId: input.sceneId,
        outcomeTier,
        ownerStage: task.ownerStage,
        blocking: task.blocking,
        field: task.artifactPath || 'scene',
        message: `Owner-stage realization task ${task.id} is missing required evidence: ${missing.join(', ')}.`,
        missingEvidenceAtoms: missing,
        evidenceDiagnostics: bestPositive.diagnostics.filter((diagnostic) => missing.includes(diagnostic.atomId)),
        fingerprint: realizationTaskFindingFingerprint({
          code: 'OWNER_REALIZATION_MISSING', taskId: task.id, sceneId: input.sceneId, outcomeTier, evidenceAtomIds: missing,
        }),
      });
    }
    if (forbidden.length > 0) {
      const outcomeTier = outcomeTierForTask(task);
      findings.push({
        code: 'OWNER_FORBIDDEN_EVIDENCE_PRESENT',
        taskId: task.id,
        contractId: task.contractId,
        sceneId: input.sceneId,
        outcomeTier,
        ownerStage: task.ownerStage,
        blocking: task.blocking,
        field: task.artifactPath || 'scene',
        message: `Owner-stage realization task ${task.id} contains forbidden evidence: ${forbidden.join(', ')}.`,
        matchedForbiddenAtoms: forbidden,
        evidenceDiagnostics: evaluations.flatMap((evaluation) => evaluation.diagnostics).filter((diagnostic) => forbidden.includes(diagnostic.atomId)),
        fingerprint: realizationTaskFindingFingerprint({
          code: 'OWNER_FORBIDDEN_EVIDENCE_PRESENT', taskId: task.id, sceneId: input.sceneId, outcomeTier, evidenceAtomIds: forbidden,
        }),
      });
    }
  }
  return findings;
}
