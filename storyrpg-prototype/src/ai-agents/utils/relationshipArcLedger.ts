import type { Beat, Choice, Consequence, Relationship, Story } from '../../types';
import type {
  McKeeValueRung,
  RelationshipEvidenceTag,
  RelationshipSurface,
  RelationshipValueAxis,
} from '../../types/relationshipValue';
import type { RelationshipPacingStage, SeasonScenePlan } from '../../types/scenePlan';
import {
  classifyRelationshipValueState,
  getSurfacesForRung,
} from '../../engine/relationshipValueLadder';

export type RelationshipSubject =
  | { subjectType: 'npc'; subjectId: string }
  | { subjectType: 'group'; subjectId: string };

export type RelationshipAccessBlock =
  | 'private_texting'
  | 'private_calling'
  | 'already_has_number'
  | 'comes_when_called'
  | 'settled_group_membership';

export type RelationshipDimension = 'trust' | 'affection' | 'respect' | 'fear';

export interface RelationshipDimensionDeltas {
  positive: number;
  negative: number;
}

export interface RelationshipArcLedgerEntry {
  subject: RelationshipSubject;
  currentStage: RelationshipPacingStage;
  introducedSceneId?: string;
  introducedBeatId?: string;
  scenesSinceIntro: number;
  relationshipChoiceSceneIds: string[];
  deltasByDimension: Record<RelationshipDimension, RelationshipDimensionDeltas>;
  evidenceTags: RelationshipEvidenceTag[];
  valueAxis: RelationshipValueAxis;
  valueRung: McKeeValueRung;
  allowedSurfaces: RelationshipSurface[];
  allowedLabels: string[];
  blockedLabels: string[];
  blockedAccess: RelationshipAccessBlock[];
  privateContactEarned: boolean;
}

export interface RelationshipArcLedger {
  entries: RelationshipArcLedgerEntry[];
  byKey: Map<string, RelationshipArcLedgerEntry>;
}

export interface RelationshipSceneRef {
  episodeNumber: number;
  sceneIndex: number;
  scene: Story['episodes'][number]['scenes'][number];
  planned?: NonNullable<SeasonScenePlan['scenes']>[number];
}

const STAGE_RANK: Record<RelationshipPacingStage, number> = {
  unmet: 0,
  noticed: 1,
  spark: 2,
  acquaintance: 3,
  tentative_ally: 4,
  friend: 5,
  trusted_ally: 6,
  intimate: 7,
};

const POSITIVE_EVIDENCE = new Set<RelationshipEvidenceTag>([
  'respected_agency',
  'sacrificed_without_control',
  'repaired_harm',
  'protected_player',
]);

const MAJOR_EVIDENCE = new Set<RelationshipEvidenceTag>([
  'sacrificed_without_control',
  'repaired_harm',
  'protected_player',
]);

const CONTACT_EXCHANGE_RE = /\b(?:gives?|hands?|offers?|slides?|shares?|exchanges?|adds?|types?|saves?)\b[^.!?]{0,100}\b(?:number|phone|contact|handle|dm|text|message)\b|\b(?:number|phone|contact|handle)\b[^.!?]{0,100}\b(?:gives?|hands?|offers?|slides?|shares?|exchanges?|adds?|types?|saves?)\b/i;

export function relationshipSubjectKey(subject: RelationshipSubject): string {
  return `${subject.subjectType}:${subject.subjectId}`;
}

export function normalizeRelationshipKey(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  return trimmed
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function collectRelationshipScenes(story: Story, scenePlan?: SeasonScenePlan): RelationshipSceneRef[] {
  const plannedById = new Map((scenePlan?.scenes ?? []).map((scene) => [scene.id, scene]));
  const refs: RelationshipSceneRef[] = [];
  const episodes = [...(story.episodes ?? [])].sort((a, b) => a.number - b.number);
  for (const episode of episodes) {
    for (let i = 0; i < (episode.scenes ?? []).length; i += 1) {
      const scene = episode.scenes[i];
      refs.push({
        episodeNumber: episode.number,
        sceneIndex: refs.length,
        scene,
        planned: plannedById.get(scene.id),
      });
    }
  }
  return refs;
}

export function beatVisibleText(beat: Beat): string {
  return [
    beat.text,
    ...(beat.textVariants ?? []).map((variant) => variant.text),
    ...(beat.choices ?? []).map(choiceVisibleText),
  ].filter(Boolean).join(' ');
}

export function sceneVisibleText(scene: RelationshipSceneRef['scene']): string {
  return [
    scene.name,
    ...(scene.beats ?? []).map(beatVisibleText),
    encounterVisibleText(scene.encounter),
  ].filter(Boolean).join(' ');
}

export function relationshipConsequencesForScene(scene: RelationshipSceneRef['scene']): Array<{ consequence: Consequence; choice?: Choice; beat?: Beat }> {
  const out: Array<{ consequence: Consequence; choice?: Choice; beat?: Beat }> = [];
  for (const beat of scene.beats ?? []) {
    for (const consequence of beat.onShow ?? []) out.push({ consequence, beat });
    for (const choice of beat.choices ?? []) {
      for (const consequence of choice.consequences ?? []) out.push({ consequence, choice, beat });
      for (const evidence of choice.relationshipValueEvidence ?? []) {
        out.push({
          consequence: {
            type: 'relationshipEvidence',
            npcId: evidence.npcId,
            axis: evidence.axis,
            evidenceTags: evidence.evidenceTags,
            reason: evidence.reason,
            intendedSurface: evidence.intendedSurface,
          },
          choice,
          beat,
        });
      }
    }
  }
  return out;
}

export function buildRelationshipArcLedger(story: Story, scenePlan?: SeasonScenePlan): RelationshipArcLedger {
  const npcAliases = buildNpcAliases(story);
  const entries = new Map<string, RelationshipArcLedgerEntry>();
  const relationshipValues = new Map<string, Relationship>();
  const introducedAtIndex = new Map<string, number>();
  const seenAfterIntro = new Map<string, Set<string>>();

  const ensure = (subject: RelationshipSubject): RelationshipArcLedgerEntry => {
    const key = relationshipSubjectKey(subject);
    const existing = entries.get(key);
    if (existing) return existing;
    const initial = emptyEntry(subject);
    entries.set(key, initial);
    return initial;
  };

  for (const npc of story.npcs ?? []) {
    const subjectId = canonicalNpcId(npc.id, npcAliases) ?? normalizeRelationshipKey(npc.id) ?? npc.id;
    const entry = ensure({ subjectType: 'npc', subjectId });
    const initial = normalizeInitialRelationship(npc.initialRelationship);
    relationshipValues.set(subjectId, initial);
    for (const dim of relationshipDimensions()) {
      const value = initial[dim];
      if (value > 0) entry.deltasByDimension[dim].positive += value;
      if (value < 0) entry.deltasByDimension[dim].negative += Math.abs(value);
    }
  }

  const refs = collectRelationshipScenes(story, scenePlan);
  for (const ref of refs) {
    const text = sceneVisibleText(ref.scene);
    const sceneSubjects = new Set<string>();

    for (const contract of [...(ref.planned?.relationshipPacing ?? []), ...(ref.scene.relationshipPacing ?? [])]) {
      const subject = contract.npcId
        ? { subjectType: 'npc' as const, subjectId: canonicalNpcId(contract.npcId, npcAliases) ?? normalizeRelationshipKey(contract.npcId) ?? contract.npcId }
        : contract.groupId
          ? { subjectType: 'group' as const, subjectId: normalizeRelationshipKey(contract.groupId) ?? contract.groupId }
          : undefined;
      if (!subject) continue;
      const entry = ensure(subject);
      if (subject.subjectType === 'group' && !entry.introducedSceneId) {
        entry.introducedSceneId = ref.scene.id;
        entry.introducedBeatId = ref.scene.beats?.[0]?.id;
        introducedAtIndex.set(relationshipSubjectKey(subject), ref.sceneIndex);
      }
      if (
        subject.subjectType === 'group'
        && contract.source === 'choice'
        && !entry.relationshipChoiceSceneIds.includes(ref.scene.id)
      ) {
        entry.relationshipChoiceSceneIds.push(ref.scene.id);
      }
      entry.blockedLabels = unique([...entry.blockedLabels, ...(contract.blockedLabels ?? [])]);
      sceneSubjects.add(relationshipSubjectKey(subject));
    }

    for (const npc of story.npcs ?? []) {
      const subjectId = canonicalNpcId(npc.id, npcAliases) ?? normalizeRelationshipKey(npc.id) ?? npc.id;
      const aliases = aliasesForNpc(subjectId, npcAliases);
      if (aliases.length > 0 && aliases.some((alias) => nameInText(text, alias))) {
        const entry = ensure({ subjectType: 'npc', subjectId });
        const key = relationshipSubjectKey(entry.subject);
        sceneSubjects.add(key);
        if (!entry.introducedSceneId) {
          entry.introducedSceneId = ref.scene.id;
          entry.introducedBeatId = firstBeatNaming(ref.scene.beats ?? [], aliases);
          introducedAtIndex.set(key, ref.sceneIndex);
        }
      }
    }

    for (const { consequence, choice } of relationshipConsequencesForScene(ref.scene)) {
      if (consequence.type === 'relationship') {
        const subjectId = canonicalNpcId(consequence.npcId, npcAliases) ?? normalizeRelationshipKey(consequence.npcId) ?? consequence.npcId;
        const entry = ensure({ subjectType: 'npc', subjectId });
        const key = relationshipSubjectKey(entry.subject);
        sceneSubjects.add(key);
        const dim = normalizeDimension(consequence.dimension);
        if (dim) {
          const delta = Number(consequence.change ?? 0);
          if (delta > 0) entry.deltasByDimension[dim].positive += delta;
          if (delta < 0) entry.deltasByDimension[dim].negative += Math.abs(delta);
          relationshipValues.set(subjectId, applyDelta(relationshipValues.get(subjectId), subjectId, dim, delta));
        }
        if (choice && !entry.relationshipChoiceSceneIds.includes(ref.scene.id)) {
          entry.relationshipChoiceSceneIds.push(ref.scene.id);
        }
      } else if (consequence.type === 'relationshipEvidence') {
        const subjectId = canonicalNpcId(consequence.npcId, npcAliases) ?? normalizeRelationshipKey(consequence.npcId) ?? consequence.npcId;
        const entry = ensure({ subjectType: 'npc', subjectId });
        sceneSubjects.add(relationshipSubjectKey(entry.subject));
        entry.evidenceTags = unique([...entry.evidenceTags, ...(consequence.evidenceTags ?? [])]);
        if (choice && !entry.relationshipChoiceSceneIds.includes(ref.scene.id)) {
          entry.relationshipChoiceSceneIds.push(ref.scene.id);
        }
      }
    }

    for (const key of sceneSubjects) {
      const introIndex = introducedAtIndex.get(key);
      if (typeof introIndex === 'number' && ref.sceneIndex > introIndex) {
        const set = seenAfterIntro.get(key) ?? new Set<string>();
        set.add(ref.scene.id);
        seenAfterIntro.set(key, set);
      }
    }

    for (const entry of entries.values()) {
      if (entry.subject.subjectType !== 'npc') continue;
      const aliases = aliasesForNpc(entry.subject.subjectId, npcAliases);
      if (!entry.privateContactEarned && aliases.some((alias) => contactExchangeInText(text, alias))) {
        entry.privateContactEarned = true;
      }
    }
  }

  for (const entry of entries.values()) {
    const key = relationshipSubjectKey(entry.subject);
    entry.scenesSinceIntro = seenAfterIntro.get(key)?.size ?? 0;
    entry.currentStage = computeStage(entry);
    if (entry.subject.subjectType === 'npc') {
      const relationship = relationshipValues.get(entry.subject.subjectId) ?? relationshipFromDeltas(entry.subject.subjectId, entry.deltasByDimension);
      const state = classifyRelationshipValueState({
        npcId: entry.subject.subjectId,
        axis: entry.valueAxis,
        relationship,
        evidenceTags: entry.evidenceTags,
      });
      entry.valueRung = state.rung;
      entry.allowedSurfaces = state.allowedSurfaces;
    } else {
      entry.valueRung = 'contrary';
      entry.allowedSurfaces = getSurfacesForRung(entry.valueRung);
    }
    const policy = policyFor(entry);
    entry.allowedLabels = policy.allowedLabels;
    entry.blockedLabels = unique([...entry.blockedLabels, ...policy.blockedLabels]);
    entry.blockedAccess = policy.blockedAccess;
  }

  return { entries: Array.from(entries.values()), byKey: entries };
}

export function computeStage(entry: RelationshipArcLedgerEntry): RelationshipPacingStage {
  if (!entry.introducedSceneId) return 'unmet';
  if (entry.subject.subjectType === 'group') {
    if (entry.relationshipChoiceSceneIds.length >= 2) return 'tentative_ally';
    if (entry.relationshipChoiceSceneIds.length >= 1) return 'acquaintance';
    return 'spark';
  }
  const positiveTrust = entry.deltasByDimension.trust.positive;
  const positiveAffection = entry.deltasByDimension.affection.positive;
  const positiveRespect = entry.deltasByDimension.respect.positive;
  const positiveCore = positiveTrust + positiveAffection + positiveRespect;
  const choices = entry.relationshipChoiceSceneIds.length;
  const majorEvidence = entry.evidenceTags.some((tag) => MAJOR_EVIDENCE.has(tag));
  const positiveEvidence = entry.evidenceTags.some((tag) => POSITIVE_EVIDENCE.has(tag));

  if (entry.scenesSinceIntro >= 4 && choices >= 3 && positiveTrust >= 14 && positiveRespect >= 8 && positiveEvidence) {
    return 'trusted_ally';
  }
  if (entry.scenesSinceIntro >= 2 && (choices >= 2 || majorEvidence) && (positiveTrust + positiveAffection >= 12 || positiveTrust + positiveRespect >= 12) && positiveEvidence) {
    return 'friend';
  }
  if (entry.scenesSinceIntro >= 1 && choices >= 1 && positiveCore >= 4) {
    return 'tentative_ally';
  }
  if (entry.scenesSinceIntro >= 1 || positiveCore > 0 || choices > 0) {
    return 'acquaintance';
  }
  return 'spark';
}

export function stageRank(stage: RelationshipPacingStage): number {
  return STAGE_RANK[stage];
}

function emptyEntry(subject: RelationshipSubject): RelationshipArcLedgerEntry {
  return {
    subject,
    currentStage: 'unmet',
    scenesSinceIntro: 0,
    relationshipChoiceSceneIds: [],
    deltasByDimension: {
      trust: { positive: 0, negative: 0 },
      affection: { positive: 0, negative: 0 },
      respect: { positive: 0, negative: 0 },
      fear: { positive: 0, negative: 0 },
    },
    evidenceTags: [],
    valueAxis: 'love',
    valueRung: 'contrary',
    allowedSurfaces: getSurfacesForRung('contrary'),
    allowedLabels: [],
    blockedLabels: [],
    blockedAccess: [],
    privateContactEarned: false,
  };
}

function policyFor(entry: RelationshipArcLedgerEntry): Pick<RelationshipArcLedgerEntry, 'allowedLabels' | 'blockedLabels' | 'blockedAccess'> {
  switch (entry.currentStage) {
    case 'unmet':
      return {
        allowedLabels: ['stranger', 'unmet'],
        blockedLabels: ['spark', 'acquaintance', 'ally', 'friend', 'trusted ally', 'intimate', 'best friend', 'inner circle', 'one of us'],
        blockedAccess: ['private_texting', 'private_calling', 'already_has_number', 'comes_when_called', 'settled_group_membership'],
      };
    case 'spark':
      return {
        allowedLabels: ['spark', 'first impression', 'invitation', 'new acquaintance'],
        blockedLabels: ['ally', 'friend', 'trusted ally', 'intimate', 'best friend', 'inner circle', 'one of us'],
        blockedAccess: entry.privateContactEarned ? ['settled_group_membership'] : ['private_texting', 'private_calling', 'already_has_number', 'comes_when_called', 'settled_group_membership'],
      };
    case 'acquaintance':
      return {
        allowedLabels: ['acquaintance', 'new ally', 'guarded warmth', 'testing trust'],
        blockedLabels: ['friend', 'trusted ally', 'intimate', 'best friend', 'inner circle', 'one of us'],
        blockedAccess: entry.privateContactEarned ? ['settled_group_membership'] : ['private_texting', 'private_calling', 'already_has_number', 'comes_when_called', 'settled_group_membership'],
      };
    case 'tentative_ally':
      return {
        allowedLabels: ['tentative ally', 'new ally', 'guarded trust'],
        blockedLabels: ['trusted ally', 'intimate', 'best friend', 'inner circle', 'one of us'],
        blockedAccess: ['settled_group_membership'],
      };
    case 'friend':
      return {
        allowedLabels: ['friend', 'ally'],
        blockedLabels: ['trusted ally', 'intimate', 'best friend'],
        blockedAccess: [],
      };
    case 'trusted_ally':
      return {
        allowedLabels: ['trusted ally', 'friend'],
        blockedLabels: ['intimate', 'best friend'],
        blockedAccess: [],
      };
    case 'intimate':
      return {
        allowedLabels: ['intimate', 'trusted ally', 'friend'],
        blockedLabels: [],
        blockedAccess: [],
      };
    case 'noticed':
      return {
        allowedLabels: ['noticed', 'first impression'],
        blockedLabels: ['friend', 'trusted ally', 'intimate', 'best friend'],
        blockedAccess: ['private_texting', 'private_calling', 'already_has_number', 'comes_when_called', 'settled_group_membership'],
      };
  }
}

function choiceVisibleText(choice: Choice): string {
  const raw = choice as Choice & {
    outcomeTexts?: Record<string, unknown>;
    reactionText?: string;
  };
  return [
    choice.text,
    choice.lockedText,
    choice.feedbackCue?.echoSummary,
    ...(choice.residueHints ?? []).map((hint) => hint.description),
    ...(choice.witnessReactions ?? []).map((reaction) => `${reaction.reactionText} ${reaction.residueHint ?? ''}`),
    raw.reactionText,
    ...Object.values(raw.outcomeTexts ?? {}).map((value) => typeof value === 'string' ? value : ''),
  ].filter(Boolean).join(' ');
}

function encounterVisibleText(encounter: unknown): string {
  const enc = encounter as
    | {
      setupText?: string;
      phases?: Array<{ beats?: Array<{ text?: string; setupText?: string; escalationText?: string }> }>;
      storylets?: Array<{ beats?: Array<{ text?: string; setupText?: string; escalationText?: string }> }>
        | Record<string, { beats?: Array<{ text?: string; setupText?: string; escalationText?: string }> }>;
    }
    | undefined;
  if (!enc) return '';
  const out: string[] = [enc.setupText ?? ''];
  const collect = (beats?: Array<{ text?: string; setupText?: string; escalationText?: string }>): void => {
    for (const beat of beats ?? []) out.push(beat.text ?? '', beat.setupText ?? '', beat.escalationText ?? '');
  };
  for (const phase of enc.phases ?? []) collect(phase.beats);
  const storylets = Array.isArray(enc.storylets) ? enc.storylets : Object.values(enc.storylets ?? {});
  for (const storylet of storylets) collect(storylet?.beats);
  return out.filter(Boolean).join(' ');
}

function buildNpcAliases(story: Story): Map<string, Set<string>> {
  const byCanonical = new Map<string, Set<string>>();
  const add = (canonical: string, value: unknown): void => {
    if (typeof value !== 'string') return;
    const normalized = normalizeRelationshipKey(value);
    if (!normalized) return;
    const set = byCanonical.get(canonical) ?? new Set<string>();
    set.add(normalized);
    byCanonical.set(canonical, set);
  };
  for (const npc of story.npcs ?? []) {
    const canonical = normalizeRelationshipKey(npc.id) ?? normalizeRelationshipKey(npc.name) ?? npc.id;
    add(canonical, npc.id);
    add(canonical, npc.name);
    const first = npc.name?.match(/[A-Za-zÀ-ž'’-]{3,}/)?.[0];
    add(canonical, first);
  }
  return byCanonical;
}

function canonicalNpcId(value: string | undefined, aliases: Map<string, Set<string>>): string | undefined {
  const normalized = normalizeRelationshipKey(value);
  if (!normalized) return undefined;
  for (const [canonical, values] of aliases.entries()) {
    if (canonical === normalized || values.has(normalized)) return canonical;
  }
  return normalized;
}

function aliasesForNpc(subjectId: string, aliases: Map<string, Set<string>>): string[] {
  const normalized = normalizeRelationshipKey(subjectId) ?? subjectId;
  return Array.from(aliases.get(normalized) ?? [normalized]).filter((value) => value.length >= 3);
}

function nameInText(text: string, alias: string): boolean {
  const normalizedText = ` ${normalizeProse(text)} `;
  const normalizedAlias = normalizeProse(alias);
  return normalizedAlias.length >= 3 && normalizedText.includes(` ${normalizedAlias} `);
}

function firstBeatNaming(beats: Beat[], aliases: string[]): string | undefined {
  return beats.find((beat) => aliases.some((alias) => nameInText(beatVisibleText(beat), alias)))?.id;
}

function contactExchangeInText(text: string, alias: string): boolean {
  const aliasPattern = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\b${aliasPattern}\\b[^.!?]{0,140}${CONTACT_EXCHANGE_RE.source}|${CONTACT_EXCHANGE_RE.source}[^.!?]{0,140}\\b${aliasPattern}\\b`, 'i').test(text);
}

function normalizeProse(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeInitialRelationship(input?: Partial<Relationship>): Relationship {
  return {
    npcId: input?.npcId ?? '',
    trust: Number(input?.trust ?? 0),
    affection: Number(input?.affection ?? 0),
    respect: Number(input?.respect ?? 0),
    fear: Number(input?.fear ?? 0),
  };
}

function relationshipFromDeltas(npcId: string, deltas: RelationshipArcLedgerEntry['deltasByDimension']): Relationship {
  return {
    npcId,
    trust: deltas.trust.positive - deltas.trust.negative,
    affection: deltas.affection.positive - deltas.affection.negative,
    respect: deltas.respect.positive - deltas.respect.negative,
    fear: Math.max(0, deltas.fear.positive - deltas.fear.negative),
  };
}

function applyDelta(input: Relationship | undefined, npcId: string, dim: RelationshipDimension, delta: number): Relationship {
  const relationship = input ?? { npcId, trust: 0, affection: 0, respect: 0, fear: 0 };
  return { ...relationship, [dim]: Number(relationship[dim] ?? 0) + delta };
}

function normalizeDimension(value: unknown): RelationshipDimension | undefined {
  return relationshipDimensions().find((dim) => dim === value);
}

function relationshipDimensions(): RelationshipDimension[] {
  return ['trust', 'affection', 'respect', 'fear'];
}

function unique<T>(values: T[]): T[] {
  return Array.from(new Set(values));
}
