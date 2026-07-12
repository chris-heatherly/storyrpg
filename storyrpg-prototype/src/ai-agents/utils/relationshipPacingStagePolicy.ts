import type {
  RelationshipPacingContract,
  RelationshipPacingStage,
} from '../../types/scenePlan';
import { hasGroupDefiningChoice } from './relationshipMilestoneSemantics';

export interface RelationshipPacingSceneLike {
  id?: string;
  hasChoice?: boolean;
  plannedHasChoice?: boolean;
  choicePoint?: { type?: string };
  relationshipPacing?: RelationshipPacingContract[];
  /** Plan-text surfaces scanned for un-contracted group formation. */
  title?: string;
  name?: string;
  dramaticPurpose?: string;
  description?: string;
  turnContract?: { centralTurn?: string; turnEvent?: string; afterState?: string };
  storyCircleBeatContracts?: Array<{ sourceText?: string }>;
  requiredBeats?: Array<{ mustDepict?: string }>;
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

// Group-FORMATION language in plan text ("forms the Dusk Club with Mika and
// Stela"). Formation verbs only — arrival/venue mentions ("meets them at the
// Vâlcescu Club") must not match, since named clubs are often locations.
const GROUP_FORMATION_RE =
  /\b(?:forms?|found(?:s|ed)?|start(?:s|ed)?|creat(?:es?|ed)|names?|christen(?:s|ed)?)\b[^.!?\n]{0,80}?\b(?:the\s+)?([A-Z][A-Za-z0-9'’-]*(?:\s+[A-Z][A-Za-z0-9'’-]*){0,3}\s+(?:Club|Circle|Crew|Society))\b/;

function groupSlug(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function plannedGroupFormation(scene: RelationshipPacingSceneLike): string | undefined {
  const stagedSurfaces = [
    scene.turnContract?.centralTurn,
    scene.turnContract?.turnEvent,
    scene.turnContract?.afterState,
    ...(scene.storyCircleBeatContracts ?? []).map((c) => c.sourceText),
    ...(scene.requiredBeats ?? []).map((b) => b.mustDepict),
  ];
  // Once a scene has compiled staging surfaces, they are authoritative. Titles
  // and descriptions can intentionally retain the source-unit label after the
  // canonical event projection moves that unit to its actual owner; scanning
  // both made the following scene falsely inherit group-formation obligations.
  const surfaces = stagedSurfaces.some((surface) => String(surface || '').trim())
    ? stagedSurfaces
    : [scene.title, scene.name, scene.dramaticPurpose, scene.description];
  for (const surface of surfaces) {
    const match = GROUP_FORMATION_RE.exec(String(surface || ''));
    if (match) return match[1];
  }
  return undefined;
}

/**
 * A scene that STAGES a named-group formation must carry a group pacing
 * contract — otherwise every group check downstream (ledger, settled-language
 * validator, SceneWriter guidance) is vacuous and the group ships as settled
 * membership on first hangout (bite-me 2026-07-03: the planner emitted
 * relationshipPacing: [] for the Dusk Club founding scene and nothing could
 * fire). Synthesizes a conservative spark-capped contract.
 */
export function ensureGroupFormationPacingContracts<T extends RelationshipPacingSceneLike>(scenes: T[]): number {
  let added = 0;
  for (const scene of scenes) {
    const groupName = plannedGroupFormation(scene);
    if (!groupName) continue;
    const groupId = groupSlug(groupName);
    const contracts = scene.relationshipPacing ?? [];
    if (contracts.some((contract) => contract.groupId && groupSlug(contract.groupId) === groupId)) continue;
    contracts.push({
      id: `${scene.id ?? 'scene'}-group-pacing-${groupId}`,
      source: 'planner',
      groupId,
      startStage: 'noticed',
      targetStage: 'spark',
      allowedLabels: [...SPARK_ALLOWED],
      blockedLabels: [...GROUP_BLOCKED],
      requiredEvidence: [
        'keep the group name as a joke, dare, invitation, or fragile beginning',
        'membership must be earned by later relationship choices and evidence, not declared at founding',
      ],
      minScenesSinceIntroduction: 1,
      maxDeltaThisScene: 6,
      mechanicDimensions: ['trust', 'affection'],
    });
    scene.relationshipPacing = contracts;
    added += 1;
  }
  return added;
}

export function normalizeRelationshipPacingStages<T extends RelationshipPacingSceneLike>(scenes: T[]): number {
  let changed = ensureGroupFormationPacingContracts(scenes);
  for (const scene of scenes) {
    for (const contract of scene.relationshipPacing ?? []) {
      if (contract.groupId) {
        if (!hasGroupDefiningChoice(scene, contract)) {
          if (capContract(contract, 'spark')) changed += 1;
        } else if (
          !contract.milestone
          && stageRank(contract.startStage) <= stageRank('spark')
          && stageRank(contract.targetStage) > stageRank('acquaintance')
        ) {
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
