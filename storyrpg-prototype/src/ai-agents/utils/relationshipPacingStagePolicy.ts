import type {
  RelationshipPacingContract,
  RelationshipPacingStage,
} from '../../types/scenePlan';

export interface RelationshipPacingSceneLike {
  id?: string;
  hasChoice?: boolean;
  plannedHasChoice?: boolean;
  choicePoint?: { type?: string };
  relationshipPacing?: RelationshipPacingContract[];
}

const STAGE_ORDER: RelationshipPacingStage[] = [
  'unmet',
  'noticed',
  'spark',
  'acquaintance',
  'tentative_ally',
  'friend',
  'trusted_ally',
  'intimate',
];

const SPARK_ALLOWED = [
  'spark',
  'invitation',
  'joke',
  'dare',
  'fragile beginning',
  'provisional circle',
  'guarded warmth',
];

const ACQUAINTANCE_ALLOWED = [
  'new acquaintance',
  'guarded warmth',
  'testing trust',
  'tentative invitation',
];

const GROUP_BLOCKED = [
  'official',
  'real club',
  'friend group',
  'friends',
  'one of us',
  'inside the circle',
  'inner circle',
  'trusted ally',
  'family',
  'intimate',
  'settled membership',
];

function stageRank(stage: RelationshipPacingStage | undefined): number {
  return stage ? STAGE_ORDER.indexOf(stage) : -1;
}

function unique(items: string[]): string[] {
  return Array.from(new Set(items.map((item) => item.trim()).filter(Boolean)));
}

function hasGroupDefiningChoice(scene: RelationshipPacingSceneLike): boolean {
  return scene.hasChoice === true
    || scene.plannedHasChoice === true
    || scene.choicePoint?.type === 'relationship'
    || scene.choicePoint?.type === 'dilemma'
    || scene.choicePoint?.type === 'strategic';
}

function capContract(contract: RelationshipPacingContract, cap: RelationshipPacingStage): boolean {
  if (stageRank(contract.targetStage) <= stageRank(cap)) return false;
  contract.targetStage = cap;
  contract.allowedLabels = cap === 'spark' ? SPARK_ALLOWED : ACQUAINTANCE_ALLOWED;
  contract.blockedLabels = unique([...(contract.blockedLabels ?? []), ...GROUP_BLOCKED]);
  contract.requiredEvidence = unique([
    ...(contract.requiredEvidence ?? []),
    cap === 'spark'
      ? 'keep the group name as a joke, dare, invitation, or fragile beginning'
      : 'show an on-page interaction before claiming familiarity',
  ]);
  return true;
}

function sharpenEarlyLabels(contract: RelationshipPacingContract): boolean {
  if (stageRank(contract.targetStage) > stageRank('spark')) return false;
  const nextAllowed = unique([...(contract.allowedLabels ?? []), ...SPARK_ALLOWED]);
  const nextBlocked = unique([...(contract.blockedLabels ?? []), ...GROUP_BLOCKED]);
  const changed = nextAllowed.join('|') !== (contract.allowedLabels ?? []).join('|')
    || nextBlocked.join('|') !== (contract.blockedLabels ?? []).join('|');
  contract.allowedLabels = nextAllowed;
  contract.blockedLabels = nextBlocked;
  return changed;
}

export function normalizeRelationshipPacingStages<T extends RelationshipPacingSceneLike>(scenes: T[]): number {
  let changed = 0;
  for (const scene of scenes) {
    for (const contract of scene.relationshipPacing ?? []) {
      if (contract.groupId) {
        if (!hasGroupDefiningChoice(scene)) {
          if (capContract(contract, 'spark')) changed += 1;
        } else if (stageRank(contract.startStage) <= stageRank('spark') && stageRank(contract.targetStage) > stageRank('acquaintance')) {
          if (capContract(contract, 'acquaintance')) changed += 1;
        }
        if (sharpenEarlyLabels(contract)) changed += 1;
      } else if (stageRank(contract.startStage) <= stageRank('unmet') && stageRank(contract.targetStage) > stageRank('spark')) {
        if (capContract(contract, 'spark')) changed += 1;
      }
    }
  }
  return changed;
}
