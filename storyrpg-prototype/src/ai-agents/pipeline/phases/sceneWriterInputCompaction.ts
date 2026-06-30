import type { SceneWriterInput } from '../../agents/SceneWriter';

type RecordLike = Record<string, unknown>;

export interface SceneWriterCompactionDiagnostics {
  sceneId: string;
  originalSceneBytes: number;
  compactSceneBytes: number;
  originalCounts: Record<string, number>;
  compactCounts: Record<string, number>;
  droppedCounts: Record<string, number>;
}

const FAMILY_LIMITS: Record<string, number> = {
  requiredBeats: 8,
  mechanicPressure: 12,
  authoredTreatmentFields: 8,
  seasonPromiseContracts: 4,
  stakesArchitectureContracts: 6,
  storyCircleBeatContracts: 3,
  arcPressureContracts: 4,
  worldTreatmentContracts: 5,
  characterTreatmentContracts: 4,
  failureModeAuditContracts: 4,
  branchConsequenceContracts: 4,
  endingRealizationContracts: 4,
  relationshipPacing: 4,
  invariants: 6,
  keyBeats: 10,
};

const CONTRACT_FAMILIES = Object.keys(FAMILY_LIMITS);
const TREATMENT_SOURCES = new Set(['treatment', 'source', 'authored']);
const BLOCKING_LEVELS = new Set(['blocking', 'treatment', 'structural', 'error']);

function byteLength(value: unknown): number {
  try {
    return JSON.stringify(value)?.length ?? 0;
  } catch {
    return 0;
  }
}

function asRecord(value: unknown): RecordLike | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as RecordLike
    : undefined;
}

function truncateString(value: unknown, maxLength: number): unknown {
  if (typeof value !== 'string') return value;
  return value.length > maxLength ? `${value.slice(0, maxLength - 3)}...` : value;
}

function compactStringArray(value: unknown, maxItems: number, maxLength: number): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const items = value
    .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    .map((item) => truncateString(item.trim(), maxLength) as string);
  return dedupeBy(items, (item) => item.toLowerCase()).slice(0, maxItems);
}

function compactUnknownArray(value: unknown, maxItems: number): unknown[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.slice(0, maxItems);
}

function dedupeBy<T>(items: T[], keyFn: (item: T) => string): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    const key = keyFn(item);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function contractRank(value: unknown): number {
  const item = asRecord(value);
  if (!item) return 0;
  let rank = 0;
  if (typeof item.source === 'string' && TREATMENT_SOURCES.has(item.source)) rank += 20;
  if (typeof item.blockingLevel === 'string' && BLOCKING_LEVELS.has(item.blockingLevel)) rank += 18;
  if (Array.isArray(item.requiredRealization) && item.requiredRealization.includes('final_prose')) rank += 14;
  if (Array.isArray(item.requiredRealization) && item.requiredRealization.includes('scene_turn')) rank += 10;
  if (typeof item.sourceText === 'string' && item.sourceText.trim().length > 0) rank += 6;
  if (typeof item.storyPressure === 'string' && item.storyPressure.trim().length > 0) rank += 6;
  if (item.targetSceneIds != null) rank += 4;
  return rank;
}

function compactContract(contract: unknown): unknown {
  const item = asRecord(contract);
  if (!item) return contract;
  const out: RecordLike = {};
  const copy = (key: string, maxLength = 420) => {
    if (item[key] !== undefined) out[key] = truncateString(item[key], maxLength);
  };
  const copyArray = (key: string, maxItems = 4, maxLength = 180) => {
    const compacted = compactStringArray(item[key], maxItems, maxLength) ?? compactUnknownArray(item[key], maxItems);
    if (compacted && compacted.length > 0) out[key] = compacted;
  };

  copy('id', 180);
  copy('source', 80);
  copy('domain', 80);
  copy('function', 80);
  copy('fieldName', 120);
  copy('contractKind', 120);
  copy('blockingLevel', 80);
  copy('stakeLayer', 80);
  copy('beat', 80);
  copy('arcTitle', 160);
  copy('label', 160);
  copy('status', 80);
  copy('locationName', 160);
  copy('characterName', 160);
  copy('storyPressure', 320);
  copy('sourceText', 360);
  copy('trajectory', 220);
  copy('rationale', 240);
  copyArray('requiredRealization', 5, 80);
  copyArray('evidenceRequired', 2, 140);
  copyArray('visibleResidue', 2, 140);
  copyArray('allowedPayoffs', 2, 110);
  copyArray('blockedPayoffs', 2, 110);
  copyArray('eventAtoms', 3, 160);
  copyArray('targetEpisodeNumbers', 6);
  copyArray('targetSceneIds', 6);

  return out;
}

function compactRequiredBeat(beat: unknown): unknown {
  const item = asRecord(beat);
  if (!item) return beat;
  return {
    id: truncateString(item.id, 160),
    tier: truncateString(item.tier, 80),
    sourceTurn: truncateString(item.sourceTurn, 320),
    mustDepict: truncateString(item.mustDepict, 320),
  };
}

function compactMechanicPressure(contract: unknown): unknown {
  const base = asRecord(compactContract(contract));
  const item = asRecord(contract);
  if (!base || !item) return contract;
  if (item.mechanicRef !== undefined) base.mechanicRef = item.mechanicRef;
  if (item.payoffWindow !== undefined) base.payoffWindow = item.payoffWindow;
  if (item.maxMagnitudeThisScene !== undefined) base.maxMagnitudeThisScene = item.maxMagnitudeThisScene;
  return base;
}

function compactChoicePoint(choicePoint: unknown): unknown {
  const item = asRecord(choicePoint);
  if (!item) return choicePoint;
  return {
    type: item.type,
    branches: item.branches,
    description: truncateString(item.description, 420),
    stakes: asRecord(item.stakes)
      ? {
          want: truncateString((item.stakes as RecordLike).want, 260),
          cost: truncateString((item.stakes as RecordLike).cost, 260),
          identity: truncateString((item.stakes as RecordLike).identity, 260),
        }
      : item.stakes,
    stakesLayers: compactStakesLayers(item.stakesLayers),
    optionHints: compactStringArray(item.optionHints, 5, 180),
    consequenceDomain: item.consequenceDomain,
    reminderPlan: compactRecordStrings(item.reminderPlan, 180),
    expectedResidue: compactStringArray(item.expectedResidue, 4, 180),
    themeAnswer: truncateString(item.themeAnswer, 220),
    setsTreatmentSeeds: compactStringArray(item.setsTreatmentSeeds, 5, 160),
  };
}

function compactRecordStrings(value: unknown, maxLength: number): unknown {
  const item = asRecord(value);
  if (!item) return value;
  const out: RecordLike = {};
  for (const [key, child] of Object.entries(item)) {
    out[key] = typeof child === 'string' ? truncateString(child, maxLength) : child;
  }
  return out;
}

function compactStakesLayers(value: unknown): unknown {
  const item = asRecord(value);
  if (!item) return value;
  return {
    material: truncateString(item.material, 260),
    relational: truncateString(item.relational, 260),
    identity: truncateString(item.identity, 260),
    existential: truncateString(item.existential, 260),
  };
}

function compactTurnContract(value: unknown): unknown {
  const item = asRecord(value);
  if (!item) return value;
  return {
    turnId: truncateString(item.turnId, 120),
    source: truncateString(item.source, 160),
    beforeState: truncateString(item.beforeState, 260),
    turnEvent: truncateString(item.turnEvent ?? item.centralTurn, 320),
    centralTurn: truncateString(item.centralTurn, 320),
    afterState: truncateString(item.afterState, 260),
    handoff: truncateString(item.handoff, 260),
  };
}

function rankedCompactArray(
  value: unknown,
  limit: number,
  compact: (item: unknown) => unknown,
): unknown[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const ranked = value
    .map((item, index) => ({ item, index, rank: contractRank(item) }))
    .sort((a, b) => b.rank - a.rank || a.index - b.index)
    .map((entry) => compact(entry.item));
  const deduped = dedupeBy(ranked, (item) => {
    const record = asRecord(item);
    const id = record?.id;
    if (typeof id === 'string') return id;
    return JSON.stringify(item);
  });
  return deduped.slice(0, limit);
}

export function compactSceneWriterInput(input: SceneWriterInput): {
  input: SceneWriterInput;
  diagnostics: SceneWriterCompactionDiagnostics;
} {
  const scene = input.sceneBlueprint as unknown as RecordLike;
  const originalCounts: Record<string, number> = {};
  const compactCounts: Record<string, number> = {};
  const droppedCounts: Record<string, number> = {};
  for (const family of CONTRACT_FAMILIES) {
    originalCounts[family] = Array.isArray(scene[family]) ? (scene[family] as unknown[]).length : 0;
  }

  const compactScene: RecordLike = {
    ...scene,
    description: truncateString(scene.description, 520),
    dramaticQuestion: truncateString(scene.dramaticQuestion, 420),
    wantVsNeed: truncateString(scene.wantVsNeed, 420),
    conflictEngine: truncateString(scene.conflictEngine, 420),
    narrativeFunction: truncateString(scene.narrativeFunction, 420),
    dramaticPurpose: truncateString(scene.dramaticPurpose, 420),
    personalStake: truncateString(scene.personalStake, 420),
    themePressure: truncateString(scene.themePressure, 420),
    stakesLayers: compactStakesLayers(scene.stakesLayers),
    transitionOut: rankedCompactArray(scene.transitionOut, 2, (item) => compactRecordStrings(item, 260)),
    residue: rankedCompactArray(scene.residue, 3, (item) => compactRecordStrings(item, 220)),
    requiredBeats: rankedCompactArray(scene.requiredBeats, FAMILY_LIMITS.requiredBeats, compactRequiredBeat),
    relationshipPacing: rankedCompactArray(scene.relationshipPacing, FAMILY_LIMITS.relationshipPacing, compactContract),
    mechanicPressure: rankedCompactArray(scene.mechanicPressure, FAMILY_LIMITS.mechanicPressure, compactMechanicPressure),
    authoredTreatmentFields: rankedCompactArray(scene.authoredTreatmentFields, FAMILY_LIMITS.authoredTreatmentFields, compactContract),
    seasonPromiseContracts: rankedCompactArray(scene.seasonPromiseContracts, FAMILY_LIMITS.seasonPromiseContracts, compactContract),
    stakesArchitectureContracts: rankedCompactArray(scene.stakesArchitectureContracts, FAMILY_LIMITS.stakesArchitectureContracts, compactContract),
    storyCircleBeatContracts: rankedCompactArray(scene.storyCircleBeatContracts, FAMILY_LIMITS.storyCircleBeatContracts, compactContract),
    arcPressureContracts: rankedCompactArray(scene.arcPressureContracts, FAMILY_LIMITS.arcPressureContracts, compactContract),
    branchConsequenceContracts: rankedCompactArray(scene.branchConsequenceContracts, FAMILY_LIMITS.branchConsequenceContracts, compactContract),
    endingRealizationContracts: rankedCompactArray(scene.endingRealizationContracts, FAMILY_LIMITS.endingRealizationContracts, compactContract),
    failureModeAuditContracts: rankedCompactArray(scene.failureModeAuditContracts, FAMILY_LIMITS.failureModeAuditContracts, compactContract),
    characterTreatmentContracts: rankedCompactArray(scene.characterTreatmentContracts, FAMILY_LIMITS.characterTreatmentContracts, compactContract),
    worldTreatmentContracts: rankedCompactArray(scene.worldTreatmentContracts, FAMILY_LIMITS.worldTreatmentContracts, compactContract),
    invariants: compactStringArray(scene.invariants, FAMILY_LIMITS.invariants, 220),
    keyBeats: compactStringArray(scene.keyBeats, FAMILY_LIMITS.keyBeats, 260),
    choicePoint: compactChoicePoint(scene.choicePoint),
    turnContract: compactTurnContract(scene.turnContract),
  };

  for (const family of CONTRACT_FAMILIES) {
    compactCounts[family] = Array.isArray(compactScene[family]) ? (compactScene[family] as unknown[]).length : 0;
    droppedCounts[family] = Math.max(0, originalCounts[family] - compactCounts[family]);
  }

  const compactInput = {
    ...input,
    sceneBlueprint: compactScene as unknown as SceneWriterInput['sceneBlueprint'],
  };

  return {
    input: compactInput,
    diagnostics: {
      sceneId: String(scene.id || ''),
      originalSceneBytes: byteLength(scene),
      compactSceneBytes: byteLength(compactScene),
      originalCounts,
      compactCounts,
      droppedCounts,
    },
  };
}

export function isSceneWriterCompactRetryReason(reason: string | undefined): boolean {
  if (!reason) return false;
  return /raw processing budget|response exceeded|max_tokens|TruncatedLLMResponseError|stop_reason=max_tokens/i.test(reason);
}
