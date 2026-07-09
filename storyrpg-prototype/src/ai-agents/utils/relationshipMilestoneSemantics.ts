import type { Choice } from '../../types/choice';
import type { RelationshipPacingContract } from '../../types/scenePlan';

interface GroupChoiceSceneLike {
  id?: string;
  choicePoint?: { type?: string };
  choiceType?: string;
  relationshipPacing?: RelationshipPacingContract[];
  beats?: Array<{ choices?: Array<Partial<Choice>> }>;
  choices?: Array<Partial<Choice>>;
}

function slug(value: string | undefined): string {
  return (value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function groupMilestoneForScene(
  scene: GroupChoiceSceneLike,
  contract?: RelationshipPacingContract,
): RelationshipPacingContract['milestone'] | undefined {
  const contracts = contract ? [contract] : (scene.relationshipPacing ?? []);
  return contracts
    .map((candidate) => candidate.milestone)
    .find((milestone) =>
      milestone?.kind === 'group_formation'
      && Boolean(scene.id)
      && milestone.choiceSceneId === scene.id
    );
}

export function choiceEarnsGroupMilestone(
  choice: Partial<Choice>,
  contract: RelationshipPacingContract,
): boolean {
  const milestone = contract.milestone;
  if (!milestone || milestone.kind !== 'group_formation') return false;
  if (choice.choiceType !== 'relationship') return false;
  if (choice.relationshipMilestoneId !== milestone.id) return false;
  if (slug(choice.relationshipGroupId) !== slug(contract.groupId)) return false;

  return milestone.memberNpcIds.every((npcId) => {
    const key = slug(npcId);
    const hasMovement = (choice.consequences ?? []).some((consequence) =>
      consequence.type === 'relationship' && slug(consequence.npcId) === key
    );
    const hasEvidence = (choice.relationshipValueEvidence ?? []).some((evidence) =>
      slug(evidence.npcId) === key
      && evidence.evidenceTags.some((tag) => milestone.requiredEvidenceTags.includes(tag as never))
    );
    return hasMovement && hasEvidence;
  });
}

/**
 * One canonical definition shared by plan policy, reconciliation, and ledger
 * construction. A generic choice or a relationship taxonomy label is not
 * enough: the scene must own a compiled milestone, and assembled choices must
 * carry canonical movement/evidence for every named member.
 */
export function hasGroupDefiningChoice(
  scene: GroupChoiceSceneLike,
  contract: RelationshipPacingContract,
): boolean {
  const milestone = groupMilestoneForScene(scene, contract);
  if (!milestone) return false;
  const assembledChoices = [
    ...(scene.choices ?? []),
    ...(scene.beats ?? []).flatMap((beat) => beat.choices ?? []),
  ];
  if (assembledChoices.length > 0) {
    return assembledChoices.some((choice) => choiceEarnsGroupMilestone(choice, contract));
  }
  return scene.choicePoint?.type === 'relationship' || scene.choiceType === 'relationship';
}
