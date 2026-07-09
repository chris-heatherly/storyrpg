import type { RelationshipPacingContract, RelationshipPacingStage } from '../../types/scenePlan';
import type { ChoiceType } from './choiceTypePlanner';
import { hasGroupDefiningChoice } from '../utils/relationshipMilestoneSemantics';

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

interface SceneWithRelationshipPacing {
  choicePoint?: { type?: ChoiceType };
  choiceType?: ChoiceType;
  relationshipPacing?: RelationshipPacingContract[];
  beats?: Array<{ choices?: Array<{ choiceType?: ChoiceType }> }>;
  choices?: Array<{ choiceType?: ChoiceType }>;
}

function stageRank(stage: RelationshipPacingStage | undefined): number {
  return stage ? STAGE_ORDER.indexOf(stage) : -1;
}

function minStage(a: RelationshipPacingStage, b: RelationshipPacingStage): RelationshipPacingStage {
  return stageRank(a) <= stageRank(b) ? a : b;
}

function capWithoutRelationshipChoice(contract: RelationshipPacingContract): void {
  const cap: RelationshipPacingStage = stageRank(contract.startStage) <= stageRank('unmet')
    ? 'spark'
    : 'acquaintance';
  contract.startStage = minStage(contract.startStage, 'acquaintance');
  contract.targetStage = minStage(contract.targetStage, cap);
  if (contract.source === 'choice') contract.source = 'planner';
  contract.allowedLabels = (contract.allowedLabels || []).filter((label) =>
    !/\b(?:friend|trusted|inner circle|intimate|family|one of us|earned circle|tentative ally)\b/i.test(label)
  );
  if (contract.allowedLabels.length === 0) {
    contract.allowedLabels = cap === 'spark'
      ? ['spark', 'invitation', 'guarded warmth']
      : ['new acquaintance', 'guarded warmth', 'testing trust'];
  }
  contract.blockedLabels = Array.from(new Set([
    ...(contract.blockedLabels || []),
    'friend',
    'best friend',
    'trusted ally',
    'inner circle',
    'one of us',
    'family',
    'intimate',
  ]));
}

function capGroupWithoutGroupChoice(contract: RelationshipPacingContract): void {
  if (!contract.groupId) return;
  contract.startStage = minStage(contract.startStage, 'spark');
  contract.targetStage = minStage(contract.targetStage, 'spark');
  contract.allowedLabels = (contract.allowedLabels || []).filter((label) =>
    !/\b(?:acquaintance|ally|friend|trusted|inner circle|intimate|family|one of us|earned circle|tentative group|shared ritual)\b/i.test(label)
  );
  if (contract.allowedLabels.length === 0) {
    contract.allowedLabels = ['spark', 'invitation', 'inside joke', 'provisional name', 'fragile beginning'];
  }
  contract.blockedLabels = Array.from(new Set([
    ...(contract.blockedLabels || []),
    'friend',
    'best friend',
    'trusted ally',
    'inner circle',
    'one of us',
    'family',
    'intimate',
    'settled membership',
  ]));
}

export function reconcileRelationshipPacingWithChoiceTypes(scenes: SceneWithRelationshipPacing[]): number {
  let changed = 0;
  for (const scene of scenes || []) {
    const finalChoiceType = scene.choicePoint?.type ?? scene.choiceType ?? inferChoiceType(scene);
    for (const contract of scene.relationshipPacing || []) {
      const before = JSON.stringify(contract);
      if (!hasGroupDefiningChoice(scene, contract)) capGroupWithoutGroupChoice(contract);
      else if (contract.milestone?.kind === 'group_formation') contract.source = 'choice';
      if (finalChoiceType !== 'relationship') capWithoutRelationshipChoice(contract);
      if (JSON.stringify(contract) !== before) changed += 1;
    }
  }
  return changed;
}

function inferChoiceType(scene: SceneWithRelationshipPacing): ChoiceType | undefined {
  const types = [
    ...(scene.choices ?? []).map((choice) => choice.choiceType),
    ...(scene.beats ?? []).flatMap((beat) => (beat.choices ?? []).map((choice) => choice.choiceType)),
  ].filter((type): type is ChoiceType => Boolean(type));
  if (types.includes('relationship')) return 'relationship';
  return types[0];
}
