import type { SceneWriterInput } from '../../agents/SceneWriter';
import { requiredMomentsFor } from '../../remediation/sceneRealizationGuard';

type RecordLike = Record<string, unknown>;

/**
 * A contract compaction removed from the SceneWriter prompt. `blocking` means
 * a season-final validator still enforces the obligation (RequiredBeat /
 * TreatmentEvent / treatment-blocking contract families) — dropping it
 * silently guarantees a late failure, so the caller must surface it as a
 * plan-overload error BEFORE SceneWriter runs (R3 contract-budget honesty).
 */
export interface DroppedContractDetail {
  family: string;
  id: string;
  label: string;
  blocking: boolean;
  blockingLevel?: string;
  tier?: string;
  source?: string;
}

export interface SceneWriterCompactionDiagnostics {
  sceneId: string;
  originalSceneBytes: number;
  compactSceneBytes: number;
  originalCounts: Record<string, number>;
  compactCounts: Record<string, number>;
  droppedCounts: Record<string, number>;
  /** Per-contract detail for every dropped contract-family item. */
  droppedContracts: DroppedContractDetail[];
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

function compactionKey(item: unknown): string {
  const record = asRecord(item);
  const id = record?.id;
  if (typeof id === 'string') return id;
  return JSON.stringify(item);
}

function rankedCompactArrayWithDrops(
  value: unknown,
  limit: number,
  compact: (item: unknown) => unknown,
  isBlocking: (item: unknown) => boolean = () => false,
): { items: unknown[] | undefined; dropped: unknown[] } {
  if (!Array.isArray(value)) return { items: undefined, dropped: [] };
  // R3 (contract-budget honesty): a contract a season-final validator still
  // enforces must never be SILENTLY dropped by the soft cap — blocking items
  // get overflow slots up to a hard cap (2× the family limit). Only genuine
  // overload past the hard cap drops a blocking contract, and that drop is
  // reported so the caller can fail the scene pre-prose.
  const hardLimit = limit * 2;
  const ranked = value
    .map((item, index) => ({ item, index, rank: contractRank(item) }))
    .sort((a, b) => b.rank - a.rank || a.index - b.index)
    .map((entry) => ({ original: entry.item, compacted: compact(entry.item) }));
  const seen = new Set<string>();
  const kept: unknown[] = [];
  const dropped: unknown[] = [];
  for (const entry of ranked) {
    const key = compactionKey(entry.compacted);
    // Dedupe casualties are not "dropped" obligations — the surviving twin
    // still carries the contract; only limit overflow loses an obligation.
    if (seen.has(key)) continue;
    seen.add(key);
    if (kept.length < limit || (isBlocking(entry.original) && kept.length < hardLimit)) {
      kept.push(entry.compacted);
    } else {
      dropped.push(entry.original);
    }
  }
  return { items: kept, dropped };
}

function rankedCompactArray(
  value: unknown,
  limit: number,
  compact: (item: unknown) => unknown,
): unknown[] | undefined {
  return rankedCompactArrayWithDrops(value, limit, compact).items;
}

/**
 * Would a season-final validator still enforce this contract after the prompt
 * drops it? requiredBeats / storyCircleBeatContracts reuse the guard's own
 * enforcement predicate (requiredMomentsFor — detector parity with the
 * realization validators); the treatment contract families block on their
 * declared blockingLevel.
 */
function isBlockingDroppedContract(family: string, item: unknown): boolean {
  const record = asRecord(item);
  if (!record) return false;
  if (family === 'requiredBeats') {
    return requiredMomentsFor({ requiredBeats: [record as { tier?: string; mustDepict?: string }] }).length > 0;
  }
  if (family === 'storyCircleBeatContracts') {
    return requiredMomentsFor({
      storyCircleBeatContracts: [record as { sourceText?: string; requiredRealization?: string[] }],
    }).length > 0;
  }
  return typeof record.blockingLevel === 'string' && BLOCKING_LEVELS.has(record.blockingLevel);
}

function describeDroppedContract(family: string, item: unknown): DroppedContractDetail {
  const record = asRecord(item) ?? {};
  const label = [record.mustDepict, record.sourceText, record.label, record.storyPressure, record.fieldName, record.id]
    .find((value): value is string => typeof value === 'string' && value.trim().length > 0) ?? '';
  return {
    family,
    id: typeof record.id === 'string' ? record.id : '',
    label: label.replace(/\s+/g, ' ').slice(0, 160),
    blocking: isBlockingDroppedContract(family, item),
    blockingLevel: typeof record.blockingLevel === 'string' ? record.blockingLevel : undefined,
    tier: typeof record.tier === 'string' ? record.tier : undefined,
    source: typeof record.source === 'string' ? record.source : undefined,
  };
}

export function compactSceneWriterInput(input: SceneWriterInput): {
  input: SceneWriterInput;
  diagnostics: SceneWriterCompactionDiagnostics;
} {
  const scene = input.sceneBlueprint as unknown as RecordLike;
  const originalCounts: Record<string, number> = {};
  const compactCounts: Record<string, number> = {};
  const droppedCounts: Record<string, number> = {};
  const droppedContracts: DroppedContractDetail[] = [];
  for (const family of CONTRACT_FAMILIES) {
    originalCounts[family] = Array.isArray(scene[family]) ? (scene[family] as unknown[]).length : 0;
  }
  const compactFamily = (family: string, compact: (item: unknown) => unknown): unknown[] | undefined => {
    const { items, dropped } = rankedCompactArrayWithDrops(
      scene[family],
      FAMILY_LIMITS[family],
      compact,
      (item) => isBlockingDroppedContract(family, item),
    );
    for (const item of dropped) droppedContracts.push(describeDroppedContract(family, item));
    return items;
  };

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
    requiredBeats: compactFamily('requiredBeats', compactRequiredBeat),
    relationshipPacing: compactFamily('relationshipPacing', compactContract),
    mechanicPressure: compactFamily('mechanicPressure', compactMechanicPressure),
    authoredTreatmentFields: compactFamily('authoredTreatmentFields', compactContract),
    seasonPromiseContracts: compactFamily('seasonPromiseContracts', compactContract),
    stakesArchitectureContracts: compactFamily('stakesArchitectureContracts', compactContract),
    storyCircleBeatContracts: compactFamily('storyCircleBeatContracts', compactContract),
    arcPressureContracts: compactFamily('arcPressureContracts', compactContract),
    branchConsequenceContracts: compactFamily('branchConsequenceContracts', compactContract),
    endingRealizationContracts: compactFamily('endingRealizationContracts', compactContract),
    failureModeAuditContracts: compactFamily('failureModeAuditContracts', compactContract),
    characterTreatmentContracts: compactFamily('characterTreatmentContracts', compactContract),
    worldTreatmentContracts: compactFamily('worldTreatmentContracts', compactContract),
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
      droppedContracts,
    },
  };
}

/** The dropped contracts a season-final validator still enforces (R3). */
export function droppedBlockingContracts(
  diagnostics: SceneWriterCompactionDiagnostics,
): DroppedContractDetail[] {
  return diagnostics.droppedContracts.filter((contract) => contract.blocking);
}

/**
 * Total contract-family entries on the ORIGINAL (pre-compaction) blueprint —
 * the scene's contract load. Consumed by the R8 heavy-contract temperature
 * tuning (a scene that is mostly obligations authors at a lower temperature).
 */
export function totalContractBlocks(diagnostics: SceneWriterCompactionDiagnostics): number {
  return Object.values(diagnostics.originalCounts).reduce((sum, value) => sum + value, 0);
}

export function isSceneWriterCompactRetryReason(reason: string | undefined): boolean {
  if (!reason) return false;
  return /raw processing budget|response exceeded|max_tokens|TruncatedLLMResponseError|stop_reason=max_tokens/i.test(reason);
}

export function shouldRunCompactSceneProtocolRecovery(
  initialFailureReason: string | undefined,
  retryFailureReason: string | undefined,
): boolean {
  return !isSceneWriterCompactRetryReason(initialFailureReason)
    && isSceneWriterCompactRetryReason(retryFailureReason);
}

export function isSceneWriterStructuredOutputFailure(
  failure: { code?: string; retryClass?: string } | undefined,
): boolean {
  return failure?.code === 'structured_output_invalid'
    && failure.retryClass === 'correct_structured_output';
}

export function sceneWriterTerminalFailureCode(
  failure: { code?: string } | undefined,
): 'structured_output_invalid' | 'structured_output_truncated' | 'visible_output_starved' | 'prose_realization_failed' {
  return failure?.code === 'structured_output_invalid'
    || failure?.code === 'structured_output_truncated'
    || failure?.code === 'visible_output_starved'
    ? failure.code
    : 'prose_realization_failed';
}
