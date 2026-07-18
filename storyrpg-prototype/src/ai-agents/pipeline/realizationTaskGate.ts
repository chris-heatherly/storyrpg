import type {
  NarrativeRealizationOwnerStage,
  NarrativeRealizationTask,
} from '../../types/narrativeContract';
import {
  collectNarrativeEvidenceSurfaceIndex,
  collectRouteEvidenceSurfaceIndex,
  type NarrativeEvidenceSurfaceIndex,
} from '../validators/encounterTextSurfaces';
import {
  inferNarrativeVerificationAuthority,
  isDeterministicNarrativeAtom,
} from './realizationVerificationAuthority';
import { literalPhraseMatch } from '../utils/literalPhraseMatch';
import {
  evaluateTaskSatisfaction,
  type NarrativeAtomVerdict,
} from './realizationTaskSatisfaction';

export interface RealizationTaskGateFinding {
  code:
    | 'OWNER_REALIZATION_MISSING'
    | 'OWNER_FORBIDDEN_EVIDENCE_PRESENT'
    | 'SEMANTIC_REALIZATION_MISSING'
    | 'SEMANTIC_FORBIDDEN_EVIDENCE_PRESENT'
    | 'SEMANTIC_VALIDATION_INCONCLUSIVE'
    | 'SEMANTIC_VALIDATION_UNAVAILABLE';
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
  matchStrategy?: NarrativeRealizationTask['evidenceAtoms'][number]['matchStrategy'];
  verificationAuthority?: NarrativeRealizationTask['evidenceAtoms'][number]['verificationAuthority'];
  score: number;
  matchedTerms: string[];
  missingTerms: string[];
}

export function prioritizeOwnerRepairFindings(
  findings: RealizationTaskGateFinding[],
  tasks: NarrativeRealizationTask[],
): RealizationTaskGateFinding[] {
  const taskById = new Map(tasks.map((task) => [task.id, task]));
  // Infra judge outcomes are never authored-content repair targets — retry the
  // judge / defer to final regression instead of spending scene-prose budget.
  const contentFindings = findings.filter((finding) =>
    finding.code !== 'SEMANTIC_VALIDATION_INCONCLUSIVE'
    && finding.code !== 'SEMANTIC_VALIDATION_UNAVAILABLE',
  );
  return [...contentFindings].sort((left, right) => {
    const leftTask = taskById.get(left.taskId);
    const rightTask = taskById.get(right.taskId);
    const leftPriority = leftTask?.canonicalEventId ? 0 : left.code === 'OWNER_FORBIDDEN_EVIDENCE_PRESENT' ? 1 : 2;
    const rightPriority = rightTask?.canonicalEventId ? 0 : right.code === 'OWNER_FORBIDDEN_EVIDENCE_PRESENT' ? 1 : 2;
    return leftPriority - rightPriority || left.fingerprint.localeCompare(right.fingerprint);
  });
}

function findingScopeKey(finding: RealizationTaskGateFinding): string {
  return [finding.code, finding.taskId, finding.sceneId, finding.outcomeTier ?? ''].join('::');
}

function findingEvidenceIds(finding: RealizationTaskGateFinding): Set<string> {
  return new Set([
    ...(finding.missingEvidenceAtoms ?? []),
    ...(finding.matchedForbiddenAtoms ?? []),
  ]);
}

/** Count missing + forbidden atom evidence per task (fallback: 1 per finding). */
export function countTaskMisses(findings: RealizationTaskGateFinding[]): Map<string, number> {
  const misses = new Map<string, number>();
  for (const finding of findings) {
    const atomCount = (finding.missingEvidenceAtoms?.length ?? 0)
      + (finding.matchedForbiddenAtoms?.length ?? 0);
    const n = atomCount > 0 ? atomCount : 1;
    misses.set(finding.taskId, (misses.get(finding.taskId) ?? 0) + n);
  }
  return misses;
}

export function totalTaskMissCount(findings: RealizationTaskGateFinding[]): number {
  let total = 0;
  for (const count of countTaskMisses(findings).values()) total += count;
  return total;
}

/**
 * Best-candidate hill-climb acceptance. A previously satisfied task may never
 * become a new blocker; within that guard a candidate is adopted when it
 * clears its target without raising total misses, OR when it makes strict net
 * progress (fewer total misses) even if the target fingerprint persists —
 * partial wins advance the baseline instead of being discarded and re-fought.
 * Atom fingerprints may still move within a task because a rewrite can resolve
 * one clause while exposing another.
 */
export function shouldAdoptOwnerRepairCandidate(input: {
  previous: RealizationTaskGateFinding[];
  candidate: RealizationTaskGateFinding[];
  targetFingerprint: string;
}): boolean {
  const previousTaskIds = new Set(input.previous.map((finding) => finding.taskId));
  if (input.candidate.some((finding) => !previousTaskIds.has(finding.taskId))) return false;
  const previousMisses = totalTaskMissCount(input.previous);
  const candidateMisses = totalTaskMissCount(input.candidate);
  const candidateFingerprints = new Set(input.candidate.map((finding) => finding.fingerprint));
  if (!candidateFingerprints.has(input.targetFingerprint)) return candidateMisses <= previousMisses;
  return candidateMisses < previousMisses;
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
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function structuredEntityEvidence(prefix: 'consequence' | 'evidence', value: string): string[] {
  const normalized = normalize(value).replace(/^(?:char|character|npc)\s+/, '');
  const terms = normalized.split(' ').filter(Boolean);
  return Array.from(new Set([
    `${prefix}:${value}`,
    normalized ? `${prefix}:${normalized.replace(/\s+/g, '-')}` : undefined,
    terms[0] ? `${prefix}:${terms[0]}` : undefined,
  ].filter((item): item is string => Boolean(item))));
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

const GENERIC_LOCATION_TERMS = new Set([
  'apartment', 'bar', 'bookshop', 'bridge', 'building', 'cafe', 'club', 'garden', 'gardens',
  'home', 'hotel', 'house', 'park', 'restaurant', 'road', 'room', 'square', 'station', 'street',
]);

const LOCATION_TYPE_ALIASES: Record<string, string[]> = {
  book: ['bookshop'],
  books: ['bookshop'],
  bookstore: ['bookshop'],
  nightclub: ['club'],
  pub: ['bar'],
  avenue: ['street'],
  boulevard: ['street'],
  residence: ['home', 'house'],
  estate: ['house'],
};

function locationIdentityMatches(pattern: string, text: string): boolean {
  const patternTerms = normalize(pattern).split(' ').filter(Boolean);
  const textTerms = new Set(normalize(text).split(' ').filter(Boolean));
  const identityTerms = patternTerms.filter((term) => term.length >= 4 && !GENERIC_LOCATION_TERMS.has(term));
  if (identityTerms.length === 0) return evidenceMatches(pattern, text);
  return identityTerms.every((term) => [...textTerms].some((candidate) =>
    candidate === term || candidate.startsWith(term) || term.startsWith(candidate)));
}

function sceneLocationNames(sceneContent: unknown): string[] {
  if (!sceneContent || typeof sceneContent !== 'object') return [];
  const scene = sceneContent as Record<string, unknown>;
  const setting = scene.settingContext && typeof scene.settingContext === 'object'
    ? scene.settingContext as Record<string, unknown>
    : undefined;
  // Assembly projects the owner-stage settingContext.locationName into
  // timeline.location on the runtime Scene shape. Reading only the owner-shape
  // fields made identical prose pass owner validation and fail final
  // validation after assembly (owner/final schema drift).
  const timeline = scene.timeline && typeof scene.timeline === 'object'
    ? scene.timeline as Record<string, unknown>
    : undefined;
  return [scene.locationName, setting?.locationName, timeline?.location]
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0);
}

function contextualLocationIdentityMatches(input: {
  atom: NarrativeRealizationTask['evidenceAtoms'][number];
  pattern: string;
  text: string;
  sceneContent?: unknown;
}): boolean {
  if (locationIdentityMatches(input.pattern, input.text)) return true;
  const canonicalLocations = sceneLocationNames(input.sceneContent);
  if (!canonicalLocations.some((location) => normalize(location) === normalize(input.pattern))) return false;
  const requiredTypes = normalize(input.pattern)
    .split(' ')
    .flatMap((term) => GENERIC_LOCATION_TERMS.has(term) ? [term] : (LOCATION_TYPE_ALIASES[term] ?? []));
  const normalizedText = normalize(input.text);
  if (requiredTypes.length === 0) return false;
  return requiredTypes.some((term) => new RegExp(
    `(?:\\b(?:at|back|enter|inside|into|reach|return|within)\\b.{0,48}\\b${term}\\b|\\b${term}\\b.{0,48}\\b(?:arriv(?:e|es|ed|ing)|enter(?:s|ed|ing)?|inside|step(?:s|ped|ping)?)\\b|\\b(?:her|his|my|our|the|their|your)\\s+(?:\\w+\\s+){0,4}${term}\\b)`,
  ).test(normalizedText));
}

function temporalFamily(value: string): 'dawn' | 'morning' | 'day' | 'evening' | 'night' | undefined {
  const normalized = normalize(value);
  if (/\b(?:dawn|sunrise|daybreak)\b/.test(normalized)) return 'dawn';
  if (/\b(?:morning|breakfast)\b/.test(normalized)) return 'morning';
  if (/\b(?:midday|noon|afternoon|daytime)\b/.test(normalized)) return 'day';
  if (/\b(?:dusk|sunset|evening|twilight)\b/.test(normalized)) return 'evening';
  if (/\b(?:night|midnight|late night|after dark)\b/.test(normalized)) return 'night';
  const clock = normalized.match(/\b(\d{1,2})\s*(am|pm)\b/);
  if (!clock) return undefined;
  const hour = Number(clock[1]) % 12;
  if (clock[2] === 'am') return hour >= 5 ? 'morning' : 'night';
  return hour >= 5 && hour < 9 ? 'evening' : hour >= 9 || hour < 5 ? 'night' : 'day';
}

function temporalOrientationMatches(pattern: string, text: string): boolean {
  if (evidenceMatches(pattern, text)) return true;
  const requiredFamily = temporalFamily(pattern);
  return Boolean(requiredFamily && temporalFamily(text) === requiredFamily);
}

function transitionActionMatches(atom: NarrativeRealizationTask['evidenceAtoms'][number], text: string): boolean {
  const normalizedText = normalize(text);
  const hasMovement = /\b(?:arriv(?:e|es|ed|ing)|cross(?:es|ed|ing)?|depart(?:s|ed|ing)?|drive|drives|drove|driven|enter(?:s|ed|ing)?|head(?:s|ed|ing)?|leave|leaves|left|reach(?:es|ed|ing)?|step(?:s|ped|ping)?|travel(?:s|ed|ing)?|walk(?:s|ed|ing)?)\b/.test(normalizedText);
  if (!hasMovement) return false;
  const destination = atom.referencedLocations?.at(-1);
  return !destination || locationIdentityMatches(destination, text);
}

function stateTransitionMatches(atom: NarrativeRealizationTask['evidenceAtoms'][number], pattern: string, text: string): boolean {
  if (!evidenceMatches(pattern, text)) return false;
  if (atom.sourceText && evidenceMatches(atom.sourceText, text)) return true;
  return /\b(?:arriv(?:e|es|ed|ing)|becom(?:e|es|ing)|became|bring|brings|brought|carry|carries|carried|enter(?:s|ed|ing)?|leave|leaves|left|move|moves|moved|place|places|placed|put|puts|set|sets|take|takes|took)\b/.test(normalize(text));
}

function scopeTerms(task: NarrativeRealizationTask): string[] {
  const value = task.evidenceScope?.npcId || task.evidenceScope?.groupId;
  if (!value) return [];
  return normalize(value)
    .replace(/^char\s+/, '')
    .split(' ')
    .filter((term) => term.length >= 4);
}

function semanticTransitionPresent(pattern: string, text: string): boolean {
  const needle = normalize(pattern);
  const haystack = normalize(text);
  if (haystack.includes(needle)) return true;
  if (/\b(?:form|found|start|name|christen|born)\b/.test(needle)) {
    return /\b(?:form(?:s|ed|ing)?|found(?:s|ed|ing)?|start(?:s|ed|ing)?|nam(?:e|es|ed|ing)|christen(?:s|ed|ing)?|born)\b/.test(haystack)
      || (/\b(?:toast|glass|glasses|raise|lift)\b/.test(haystack)
        && /\bto (?:the )?.*\b(?:club|circle|crew|society)\b/.test(haystack));
  }
  if (/\b(?:become|begin|befriend|bond|welcome|accept|offer|call)\b/.test(needle)) {
    return /\b(?:becom(?:e|es|ing)|became|beg(?:in|ins|an|un|inning)|befriend(?:s|ed|ing)?|bond(?:s|ed|ing)?|welcom(?:e|es|ed|ing)|accept(?:s|ed|ing)?|offer(?:s|ed|ing)?|call(?:s|ed|ing)?)\b/.test(haystack);
  }
  return true;
}

function relationshipEvidenceMatches(
  task: NarrativeRealizationTask,
  atom: NarrativeRealizationTask['evidenceAtoms'][number],
  pattern: string,
  text: string,
  sceneContent?: unknown,
): boolean {
  if (atom.matchStrategy === 'location_identity') {
    return contextualLocationIdentityMatches({ atom, pattern, text, sceneContent });
  }
  if (atom.matchStrategy === 'temporal_orientation') return temporalOrientationMatches(pattern, text);
  if (atom.matchStrategy === 'transition_action') return transitionActionMatches(atom, text);
  if (atom.matchStrategy === 'state_transition') return stateTransitionMatches(atom, pattern, text);
  const kind = atom.kind;
  // r115: a lexical atom is a codename/coined-title EXACT phrase — plain
  // substring containment let the forbidden codename "The Mountain" match
  // inside "the mountains" (a common noun). Literal means literal: whole
  // tokens, in order, never a partial-word match.
  if (kind === 'lexical') return literalPhraseMatch(pattern, text);
  if (kind !== 'relationship_label') {
    if ((atom.semanticRole === 'relationship_change' || atom.semanticRole === 'state_change')
      && !semanticTransitionPresent(pattern, text)) return false;
    return evidenceMatches(pattern, text);
  }
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
  return surfaces.flatMap((surface) => index[surface]);
}

function choicesForTaskInput(input: { sceneContent?: unknown; choiceSet?: unknown }): unknown[] {
  if (input.choiceSet && typeof input.choiceSet === 'object') {
    return (input.choiceSet as { choices?: unknown[] }).choices ?? [];
  }
  if (!input.sceneContent || typeof input.sceneContent !== 'object') return [];
  const beats = (input.sceneContent as { beats?: unknown[] }).beats ?? [];
  return beats.flatMap((beat) => beat && typeof beat === 'object'
    ? ((beat as { choices?: unknown[] }).choices ?? [])
    : []);
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
    return choicesForTaskInput(input).map((choice) => {
      if (!choice || typeof choice !== 'object') return [];
      const record = choice as Record<string, unknown>;
      const structured = [
        typeof record.relationshipMilestoneId === 'string' ? `milestone:${record.relationshipMilestoneId}` : undefined,
        typeof record.relationshipGroupId === 'string' ? `group:${record.relationshipGroupId}` : undefined,
        ...((record.consequences as Array<Record<string, unknown>> | undefined) ?? [])
          .filter((consequence) => consequence?.type === 'relationship')
          .flatMap((consequence) => typeof consequence.npcId === 'string'
            ? structuredEntityEvidence('consequence', consequence.npcId)
            : []),
        ...((record.relationshipValueEvidence as Array<Record<string, unknown>> | undefined) ?? [])
          .flatMap((evidence) => typeof evidence?.npcId === 'string'
            ? structuredEntityEvidence('evidence', evidence.npcId)
            : []),
      ].filter((value): value is string => typeof value === 'string');
      const text = textsForSurfaces(collectNarrativeEvidenceSurfaceIndex({ choiceSet: { choices: [choice] } }), target.surfaces);
      return [...text, normalize(structured.join(' '))];
    });
  }
  if (target.scope === 'all_choice_outcomes') {
    return choicesForTaskInput(input).flatMap((choice) => {
      if (!choice || typeof choice !== 'object') return [];
      const outcomeTexts = (choice as { outcomeTexts?: Record<string, unknown> }).outcomeTexts;
      return ['success', 'partial', 'failure'].map((tier) => {
        const text = outcomeTexts?.[tier];
        return typeof text === 'string' ? [normalize(text)] : [];
      });
    });
  }
  return target.outcomeTiers.map((outcomeTier) => textsForSurfaces(
    collectRouteEvidenceSurfaceIndex({ ...input, outcomeTier }),
    target.surfaces,
  ));
}

export interface NarrativeTaskEvidenceTextGroup {
  groupKey: string;
  texts: string[];
  entries: Array<{ surface: NarrativeRealizationTask['target']['surfaces'][number]; text: string }>;
}

/** Reader-facing candidate groups already restricted to the task's owner,
 * route, terminal, option, and outcome surfaces. Semantic judges consume this
 * view; they never receive planning metadata or prose from sibling routes. */
export function collectNarrativeTaskEvidenceTextGroups(input: {
  sceneContent?: unknown;
  choiceSet?: unknown;
  encounter?: unknown;
  task: NarrativeRealizationTask;
}): NarrativeTaskEvidenceTextGroup[] {
  const target = input.task.target;
  const indexedEntries = (index: NarrativeEvidenceSurfaceIndex, surfaces: typeof target.surfaces) =>
    surfaces.flatMap((surface) => index[surface].map((text) => ({ surface, text })));
  let groups: Array<Array<{ surface: typeof target.surfaces[number]; text: string }>>;
  if (target.scope === 'owner') {
    groups = [indexedEntries(collectNarrativeEvidenceSurfaceIndex(input), target.surfaces)];
  } else if (target.scope === 'route_path') {
    groups = [indexedEntries(collectRouteEvidenceSurfaceIndex({ ...input, outcomeTier: target.outcomeTier }), target.surfaces)];
  } else if (target.scope === 'route_terminal') {
    const terminalSurfaces = target.surfaces.filter((surface) => surface === 'encounter_outcome' || surface === 'terminal_storylet');
    groups = [indexedEntries(collectRouteEvidenceSurfaceIndex({ ...input, outcomeTier: target.outcomeTier }), terminalSurfaces)];
  } else if (target.scope === 'all_choice_outcomes') {
    groups = choicesForTaskInput(input).flatMap((choice) => {
      if (!choice || typeof choice !== 'object') return [];
      const outcomeTexts = (choice as { outcomeTexts?: Record<string, unknown> }).outcomeTexts;
      return ['success', 'partial', 'failure'].map((tier) => {
        const text = outcomeTexts?.[tier];
        return typeof text === 'string' ? [{ surface: 'choice_outcome' as const, text }] : [];
      });
    });
  } else if (target.scope === 'all_options') {
    groups = choicesForTaskInput(input).map((choice) => indexedEntries(
      collectNarrativeEvidenceSurfaceIndex({ choiceSet: { choices: [choice] } }),
      target.surfaces,
    ));
  } else {
    groups = target.outcomeTiers.map((outcomeTier) => indexedEntries(
      collectRouteEvidenceSurfaceIndex({ ...input, outcomeTier }),
      target.surfaces,
    ));
  }
  return groups.map((entries, index) => ({
    groupKey: `${target.scope}:${index + 1}`,
    entries,
    texts: entries.map((entry) => entry.text),
  }));
}

function evaluateTaskGroup(
  task: NarrativeRealizationTask,
  groupKey: string,
  texts: string[],
  sceneContent?: unknown,
): { missing: string[]; forbidden: string[]; diagnostics: EvidenceMatchDiagnostic[]; atomVerdicts: NarrativeAtomVerdict[] } {
  const missing: string[] = [];
  const forbidden: string[] = [];
  const diagnostics: EvidenceMatchDiagnostic[] = [];
  const atomVerdicts: NarrativeAtomVerdict[] = [];
  const deterministicAtoms = task.evidenceAtoms.filter(isDeterministicNarrativeAtom);
  const positiveAtoms = deterministicAtoms.filter((atom) => atom.polarity !== 'forbidden');
  const matchedPositiveAtoms = new Set<string>();
  for (const atom of deterministicAtoms) {
    let best: EvidenceMatchDiagnostic = {
      atomId: atom.id,
      matched: false,
      matchStrategy: atom.matchStrategy ?? 'default',
      verificationAuthority: inferNarrativeVerificationAuthority(atom),
      score: 0,
      matchedTerms: [],
      missingTerms: [],
    };
    for (const pattern of atom.acceptedPatterns) {
      for (const text of texts) {
        const matched = relationshipEvidenceMatches(task, atom, pattern, text, sceneContent);
        const score = evidenceMatchScore(pattern, text);
        if (matched || score.score > best.score) {
          best = {
            atomId: atom.id,
            matched,
            bestPattern: pattern,
            matchStrategy: atom.matchStrategy ?? 'default',
            verificationAuthority: inferNarrativeVerificationAuthority(atom),
            ...score,
            score: matched ? Math.max(score.score, 1) : score.score,
          };
        }
      }
    }
    const matched = best.matched;
    diagnostics.push(best);
    atomVerdicts.push({
      taskId: task.id,
      atomId: atom.id,
      groupKey,
      authority: inferNarrativeVerificationAuthority(atom),
      outcome: atom.polarity === 'forbidden'
        ? (matched ? 'miss' : 'pass')
        : (matched ? 'pass' : 'miss'),
    });
    if (atom.polarity === 'forbidden') {
      if (matched) forbidden.push(atom.id);
    } else {
      if (matched) matchedPositiveAtoms.add(atom.id);
      if (task.minimumEvidenceHits == null && atom.required && !matched) missing.push(atom.id);
    }
  }
  if (task.minimumEvidenceHits != null && matchedPositiveAtoms.size < task.minimumEvidenceHits) {
    const unmatched = positiveAtoms.filter((atom) => !matchedPositiveAtoms.has(atom.id));
    const requiredUnmatched = unmatched.filter((atom) => atom.required !== false);
    // Keep evaluateTaskGroup diagnostics aligned with evaluateTaskSatisfaction:
    // optional atoms are candidates, not silent mandatory blockers.
    missing.push(...(requiredUnmatched.length > 0 ? requiredUnmatched : unmatched).map((atom) => atom.id));
  }
  for (const group of task.evidenceGroups ?? []) {
    const groupAtoms = group.atomIds
      .map((atomId) => task.evidenceAtoms.find((atom) => atom.id === atomId))
      .filter((atom): atom is NarrativeRealizationTask['evidenceAtoms'][number] => Boolean(
        atom && atom.polarity !== 'forbidden' && isDeterministicNarrativeAtom(atom),
      ));
    if (groupAtoms.length === 0) continue;
    const matched = groupAtoms.filter((atom) => matchedPositiveAtoms.has(atom.id));
    const requiredHits = group.minimumEvidenceHits ?? (group.requirement === 'all' ? groupAtoms.length : 1);
    const groupSatisfied = group.requirement === 'any'
      ? matched.length >= 1
      : matched.length >= requiredHits;
    if (!groupSatisfied) {
      missing.push(...groupAtoms.filter((atom) => !matchedPositiveAtoms.has(atom.id)).map((atom) => atom.id));
    }
  }
  return { missing: [...new Set(missing)], forbidden: [...new Set(forbidden)], diagnostics, atomVerdicts };
}

export function evaluateDeterministicRealizationTaskVerdicts(input: {
  sceneId: string;
  tasks?: NarrativeRealizationTask[];
  sceneContent?: unknown;
  choiceSet?: unknown;
  encounter?: unknown;
  mode?: 'owner' | 'final_regression';
  currentStage?: NarrativeRealizationOwnerStage;
}): NarrativeAtomVerdict[] {
  return (input.tasks ?? []).flatMap((task) => {
    if ((input.mode ?? 'owner') === 'owner' && input.currentStage && task.ownerStage !== input.currentStage) return [];
    const semanticGroups = collectNarrativeTaskEvidenceTextGroups({ ...input, task });
    const deterministicGroups = taskTextGroups({ ...input, task });
    const groups = semanticGroups.length > 0
      ? semanticGroups
      : (deterministicGroups.length > 0 ? deterministicGroups : [[]]).map((texts, index) => ({
          groupKey: `${task.target.scope}:${index + 1}`, texts, entries: [],
        }));
    return groups.flatMap((group, index) =>
      evaluateTaskGroup(task, group.groupKey, deterministicGroups[index] ?? group.texts, input.sceneContent).atomVerdicts);
  });
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
    // final_regression-phase tasks (reveal-timing negative contracts) are
    // enforced only by the final semantic contract — owner stages skip them
    // to avoid per-scene judge spend and mid-generation churn.
    if ((input.mode ?? 'owner') !== 'final_regression' && task.enforcementPhase === 'final_regression') continue;
    if ((input.mode ?? 'owner') === 'owner' && input.currentStage && task.ownerStage !== input.currentStage) continue;
    const semanticGroups = collectNarrativeTaskEvidenceTextGroups({ ...input, task });
    const deterministicGroups = taskTextGroups({ ...input, task });
    const groups = semanticGroups.length > 0
      ? semanticGroups
      : (deterministicGroups.length > 0 ? deterministicGroups : [[]]).map((texts, index) => ({
          groupKey: `${task.target.scope}:${index + 1}`, texts, entries: [],
        }));
    const evaluations = groups
      .map((group, index) => {
        const evaluated = evaluateTaskGroup(task, group.groupKey, deterministicGroups[index] ?? group.texts, input.sceneContent);
        return {
          ...evaluated,
          satisfaction: evaluateTaskSatisfaction(task, evaluated.atomVerdicts),
        };
      });
    const deterministicRequiredAtomIds = task.evidenceAtoms
      .filter((atom) => isDeterministicNarrativeAtom(atom) && atom.required && atom.polarity !== 'forbidden')
      .map((atom) => atom.id);
    const fallback = { missing: deterministicRequiredAtomIds, forbidden: [], diagnostics: [], atomVerdicts: [], satisfaction: evaluateTaskSatisfaction(task, []) };
    const bestPositive = evaluations.reduce((best, candidate) => candidate.satisfaction.missingAtomIds.length < best.satisfaction.missingAtomIds.length ? candidate : best, evaluations[0] ?? fallback);
    const missing = task.target.scope === 'any_route' && evaluations.some((evaluation) => evaluation.satisfaction.status === 'satisfied' || evaluation.satisfaction.status === 'pending')
      ? []
      : task.target.scope === 'all_options' || task.target.scope === 'all_choice_outcomes'
        ? (evaluations.length > 0
          ? [...new Set(evaluations.flatMap((evaluation) => evaluation.satisfaction.status === 'missing'
            ? evaluation.satisfaction.missingAtomIds.filter((atomId) => task.evidenceAtoms.find((atom) => atom.id === atomId)?.polarity !== 'forbidden')
            : []))]
          : deterministicRequiredAtomIds)
        : bestPositive.satisfaction.status === 'missing'
          ? bestPositive.satisfaction.missingAtomIds.filter((atomId) => task.evidenceAtoms.find((atom) => atom.id === atomId)?.polarity !== 'forbidden')
          : [];
    const forbidden = [...new Set(evaluations.flatMap((evaluation) => evaluation.satisfaction.status === 'missing'
      ? evaluation.satisfaction.missingAtomIds.filter((atomId) => task.evidenceAtoms.find((atom) => atom.id === atomId)?.polarity === 'forbidden')
      : []))];
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
