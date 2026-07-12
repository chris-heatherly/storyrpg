import type {
  NarrativeEvidenceTarget,
  NarrativeRealizationOwnerStage,
  NarrativeRealizationSurface,
  NarrativeRealizationTask,
} from '../../types/narrativeContract';
import {
  collectReaderFacingTerminalTextsForEncounterOutcomeTier,
  collectReaderFacingTextsForEncounterOutcomeTier,
  ENCOUNTER_OUTCOME_TIERS,
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
}

type SurfaceIndex = Record<NarrativeRealizationSurface, string[]>;

function emptySurfaceIndex(): SurfaceIndex {
  return {
    beat_text: [], dialogue: [], choice_text: [], encounter_setup: [],
    encounter_phase: [], encounter_outcome: [], terminal_storylet: [], text_variant: [],
  };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' ? value as Record<string, unknown> : undefined;
}

function objectValues(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  return asRecord(value) ? Object.values(asRecord(value)!) : [];
}

function pushString(output: string[], value: unknown): void {
  if (typeof value === 'string' && value.trim()) output.push(value);
}

function collectChoiceTexts(value: unknown, output: string[]): void {
  for (const rawChoice of objectValues(asRecord(value)?.choices ?? value)) {
    const choice = asRecord(rawChoice);
    if (!choice) continue;
    pushString(output, choice.text);
    pushString(output, choice.lockedText);
    pushString(output, choice.reactionText);
    for (const outcome of objectValues(choice.outcomeTexts)) pushString(output, outcome);
  }
}

function collectBeatSurfaces(value: unknown, index: SurfaceIndex, fallback: NarrativeRealizationSurface): void {
  for (const rawBeat of objectValues(value)) {
    const beat = asRecord(rawBeat);
    if (!beat) continue;
    pushString(index[beat.speaker ? 'dialogue' : fallback], beat.text);
    pushString(index[fallback], beat.setupText);
    pushString(index[fallback], beat.escalationText);
    for (const key of ['textVariants', 'setupTextVariants', 'escalationTextVariants']) {
      for (const rawVariant of objectValues(beat[key])) pushString(index.text_variant, asRecord(rawVariant)?.text);
    }
    collectChoiceTexts(beat.choices, index.choice_text);
  }
}

function collectOutcomeSurface(value: unknown, output: string[]): void {
  for (const rawOutcome of objectValues(value)) {
    const outcome = asRecord(rawOutcome);
    if (!outcome) continue;
    pushString(output, outcome.narrativeText);
    pushString(output, outcome.outcomeText);
    const nextSituation = asRecord(outcome.nextSituation);
    pushString(output, nextSituation?.setupText);
    collectChoiceTexts(nextSituation?.choices, output);
  }
}

function collectSurfaceIndex(input: { sceneContent?: unknown; choiceSet?: unknown; encounter?: unknown }): SurfaceIndex {
  const index = emptySurfaceIndex();
  const scene = asRecord(input.sceneContent);
  collectBeatSurfaces(scene?.beats, index, 'beat_text');
  collectChoiceTexts(input.choiceSet, index.choice_text);

  const encounter = asRecord(input.encounter);
  pushString(index.encounter_setup, encounter?.description);
  pushString(index.encounter_setup, encounter?.setupText);
  collectBeatSurfaces(encounter?.beats, index, 'encounter_setup');
  for (const rawPhase of objectValues(encounter?.phases)) {
    const phase = asRecord(rawPhase);
    if (!phase) continue;
    collectBeatSurfaces(phase.beats, index, 'encounter_phase');
    pushString(index.encounter_phase, asRecord(phase.onSuccess)?.outcomeText);
    pushString(index.encounter_phase, asRecord(phase.onFailure)?.outcomeText);
  }
  collectOutcomeSurface(encounter?.outcomes, index.encounter_outcome);
  for (const rawStorylet of objectValues(encounter?.storylets)) {
    collectBeatSurfaces(asRecord(rawStorylet)?.beats, index, 'terminal_storylet');
  }
  return index;
}

/** Normalize version-2 task fields into the version-3 executable target. */
export function realizationTargetForTask(task: NarrativeRealizationTask): NarrativeEvidenceTarget {
  if (task.target) return task.target;
  if (task.outcomeTier && task.routePolicy === 'terminal_required') {
    return { scope: 'route_terminal', outcomeTier: task.outcomeTier, surfaces: task.requiredSurface };
  }
  if (task.outcomeTier && task.routePolicy === 'path_required') {
    return { scope: 'route_path', outcomeTier: task.outcomeTier, surfaces: task.requiredSurface };
  }
  if (task.routePolicy === 'any_route') {
    return {
      scope: 'any_route',
      outcomeTiers: task.outcomeTier ? [task.outcomeTier] : [...ENCOUNTER_OUTCOME_TIERS],
      surfaces: task.requiredSurface,
    };
  }
  return { scope: 'owner', surfaces: task.requiredSurface };
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
function routeTexts(encounter: unknown, sceneBeats: unknown, outcomeTier: string): string[] {
  if (!encounter) return [];
  const scene = { beats: Array.isArray(sceneBeats) ? sceneBeats : [], encounter };
  const route = collectReaderFacingTextsForEncounterOutcomeTier(scene as never, [outcomeTier]).get(outcomeTier) ?? [];
  const terminal = collectReaderFacingTerminalTextsForEncounterOutcomeTier(scene as never, outcomeTier).filter(Boolean);
  return [...route, ...terminal];
}

function taskTexts(input: { sceneContent?: unknown; choiceSet?: unknown; encounter?: unknown; task: NarrativeRealizationTask }): string[] {
  const target = realizationTargetForTask(input.task);
  const sceneBeats = (input.sceneContent as { beats?: unknown[] } | undefined)?.beats;
  if (target.scope === 'route_path') return routeTexts(input.encounter, sceneBeats, target.outcomeTier);
  if (target.scope === 'route_terminal') {
    const scene = { beats: Array.isArray(sceneBeats) ? sceneBeats : [], encounter: input.encounter };
    return collectReaderFacingTerminalTextsForEncounterOutcomeTier(scene as never, target.outcomeTier);
  }
  if (target.scope === 'any_route') {
    return target.outcomeTiers.flatMap((tier) => routeTexts(input.encounter, sceneBeats, tier));
  }
  const index = collectSurfaceIndex(input);
  return target.surfaces.flatMap((surface) => index[surface]);
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
    const texts = taskTexts({ ...input, task }).map(normalize);
    const missing: string[] = [];
    const forbidden: string[] = [];
    const positiveAtoms = task.evidenceAtoms.filter((atom) => atom.polarity !== 'forbidden');
    const matchedPositiveAtoms = new Set<string>();
    for (const atom of task.evidenceAtoms) {
      const matched = atom.acceptedPatterns.some((pattern) => texts.some((text) => relationshipEvidenceMatches(task, pattern, text, atom.kind)));
      if (atom.polarity === 'forbidden') {
        if (matched) forbidden.push(atom.id);
      } else {
        if (matched) matchedPositiveAtoms.add(atom.id);
        if (task.minimumEvidenceHits == null && atom.required && !matched) missing.push(atom.id);
      }
    }
    if (task.minimumEvidenceHits != null && matchedPositiveAtoms.size < task.minimumEvidenceHits) {
      missing.push(...positiveAtoms
        .filter((atom) => !matchedPositiveAtoms.has(atom.id))
        .map((atom) => atom.id));
    }
    if (missing.length > 0) {
      findings.push({
        code: 'OWNER_REALIZATION_MISSING',
        taskId: task.id,
        contractId: task.contractId,
        sceneId: input.sceneId,
        outcomeTier: task.outcomeTier,
        ownerStage: task.ownerStage,
        blocking: task.blocking,
        field: task.artifactPath || 'scene',
        message: `Owner-stage realization task ${task.id} is missing required evidence: ${missing.join(', ')}.`,
        missingEvidenceAtoms: missing,
      });
    }
    if (forbidden.length > 0) {
      findings.push({
        code: 'OWNER_FORBIDDEN_EVIDENCE_PRESENT',
        taskId: task.id,
        contractId: task.contractId,
        sceneId: input.sceneId,
        outcomeTier: task.outcomeTier,
        ownerStage: task.ownerStage,
        blocking: task.blocking,
        field: task.artifactPath || 'scene',
        message: `Owner-stage realization task ${task.id} contains forbidden evidence: ${forbidden.join(', ')}.`,
        matchedForbiddenAtoms: forbidden,
      });
    }
  }
  return findings;
}
