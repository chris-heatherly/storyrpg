import type { Story } from '../../types/story';
import type { RelationshipPacingContract } from '../../types/scenePlan';
import { buildNpcAliases, canonicalNpcId, normalizeRelationshipKey } from './relationshipArcLedger';

/** Normalized subject key for alias matching (strips char- prefix). */
export function pacingSubjectKey(value: string | undefined): string | undefined {
  const normalized = normalizeRelationshipKey(value);
  if (!normalized) return undefined;
  return normalized.replace(/^char-/, '') || undefined;
}

export function pacingKeysMatch(a: string | undefined, b: string | undefined): boolean {
  const left = pacingSubjectKey(a);
  const right = pacingSubjectKey(b);
  if (!left || !right) return false;
  return left === right || left.includes(right) || right.includes(left);
}

export function isNpcPacingContract(contract: RelationshipPacingContract): boolean {
  return Boolean(contract.npcId?.trim()) && !contract.groupId;
}

export function isGroupPacingContract(contract: RelationshipPacingContract): boolean {
  return Boolean(contract.groupId?.trim()) && !contract.npcId;
}

export function normalizePacingContractNpcIds(
  contracts: RelationshipPacingContract[] | undefined,
): RelationshipPacingContract[] {
  return (contracts ?? []).map((contract) => {
    if (!contract.npcId) return contract;
    const key = pacingSubjectKey(contract.npcId);
    if (!key) return contract;
    const canonical = contract.npcId.startsWith('char-') ? contract.npcId : `char-${key}`;
    return canonical === contract.npcId ? contract : { ...contract, npcId: canonical };
  });
}

/** Prefer scene copy over plan copy when ids collide; keep stricter NPC cap when duped. */
export function dedupeRelationshipPacingContracts(
  contracts: RelationshipPacingContract[],
): RelationshipPacingContract[] {
  const byId = new Map<string, RelationshipPacingContract>();
  for (const contract of contracts) {
    const existing = byId.get(contract.id);
    if (!existing) {
      byId.set(contract.id, contract);
      continue;
    }
    const existingCap = Math.abs(existing.maxDeltaThisScene || 0);
    const nextCap = Math.abs(contract.maxDeltaThisScene || 0);
    const preferExisting = isNpcPacingContract(existing) && isNpcPacingContract(contract)
      ? (existingCap <= nextCap ? existing : contract)
      : contract;
    byId.set(contract.id, preferExisting);
  }
  return Array.from(byId.values());
}

/** Scene contracts win ordering; dedupe by contract id. */
export function mergeSceneRelationshipPacing(
  planned: RelationshipPacingContract[] | undefined,
  scene: RelationshipPacingContract[] | undefined,
): RelationshipPacingContract[] {
  const combined = [...(scene ?? []), ...(planned ?? [])];
  return dedupeRelationshipPacingContracts(combined);
}

export function relationshipConsequenceMatchesNpcContract(
  contract: RelationshipPacingContract,
  consequenceNpcId: string | undefined,
  aliases: Map<string, Set<string>>,
): boolean {
  if (!isNpcPacingContract(contract) || !consequenceNpcId || !contract.npcId) return false;
  const canonicalConsequence = canonicalNpcId(consequenceNpcId, aliases);
  const canonicalContract = canonicalNpcId(contract.npcId, aliases);
  if (canonicalConsequence && canonicalContract && canonicalConsequence === canonicalContract) return true;
  return pacingKeysMatch(contract.npcId, consequenceNpcId);
}

export function effectiveNpcDeltaCap(
  contracts: RelationshipPacingContract[],
  npcId: string | undefined,
  aliases: Map<string, Set<string>>,
): number | undefined {
  let cap: number | undefined;
  for (const contract of contracts) {
    if (!relationshipConsequenceMatchesNpcContract(contract, npcId, aliases)) continue;
    const next = Math.abs(contract.maxDeltaThisScene || 0);
    if (next <= 0) continue;
    cap = cap === undefined ? next : Math.min(cap, next);
  }
  return cap;
}

export function findNpcPacingContract(
  contracts: RelationshipPacingContract[],
  npcId: string | undefined,
  story?: Story,
): RelationshipPacingContract | undefined {
  const aliases = story ? buildNpcAliases(story) : new Map<string, Set<string>>();
  if (!npcId) return contracts.find(isNpcPacingContract);
  return contracts.find((contract) =>
    relationshipConsequenceMatchesNpcContract(contract, npcId, aliases),
  );
}
