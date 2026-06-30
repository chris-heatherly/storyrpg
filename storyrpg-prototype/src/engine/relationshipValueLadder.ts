import type {
  McKeeValueRung,
  RelationshipDimensions,
  RelationshipEvidenceConsequence,
  RelationshipEvidenceTag,
  RelationshipSurface,
  RelationshipValueAxis,
  RelationshipValueState,
} from '../types/relationshipValue';
import type { PlayerState, Relationship } from '../types/player';

const SURFACES_BY_RUNG: Record<McKeeValueRung, RelationshipSurface[]> = {
  positive: [
    'confession',
    'mutual_aid',
    'sacrifice',
    'forgiveness',
    'agency_respecting_protection',
  ],
  contrary: [
    'absence',
    'cold_greeting',
    'withheld_help',
    'missed_callback',
  ],
  contradiction: [
    'confrontation',
    'sabotage',
    'route_block',
    'public_accusation',
  ],
  negationOfNegation: [
    'aid_with_cost',
    'protective_control',
    'agency_removal',
    'guilt_callback',
    'conditional_help',
  ],
};

const POSITIVE_EVIDENCE = new Set<RelationshipEvidenceTag>([
  'respected_agency',
  'sacrificed_without_control',
  'repaired_harm',
]);

const CONTRARY_EVIDENCE = new Set<RelationshipEvidenceTag>([
  'withheld_care',
  'ignored_need',
]);

const CONTRADICTION_EVIDENCE = new Set<RelationshipEvidenceTag>([
  'sabotaged_player',
  'publicly_attacked',
  'retaliated',
]);

const NEGATION_EVIDENCE = new Set<RelationshipEvidenceTag>([
  'overrode_player_choice',
  'aid_with_strings',
  'used_guilt_as_leverage',
  'protective_control',
]);

export interface RelationshipValueClassificationInput {
  npcId: string;
  axis: RelationshipValueAxis;
  relationship?: Partial<RelationshipDimensions>;
  previousState?: RelationshipValueState;
  evidenceTags?: RelationshipEvidenceTag[];
  lastUpdatedEpisode?: number;
  lastUpdatedSceneId?: string;
}

export interface RelationshipTransitionResult {
  state: RelationshipValueState;
  transitioned: boolean;
  blockedTransition?: {
    from: McKeeValueRung;
    to: McKeeValueRung;
    reason: string;
  };
}

export function classifyRelationshipValueState(
  input: RelationshipValueClassificationInput,
): RelationshipValueState {
  const evidenceTags = uniqueEvidence([
    ...(input.previousState?.evidenceTags ?? []),
    ...(input.evidenceTags ?? []),
  ]);
  const relationship = normalizeRelationship(input.relationship);

  if (input.axis !== 'love') {
    return classifyUnsupportedAxis({
      ...input,
      relationship,
      evidenceTags,
    });
  }

  const hasPositiveEvidence = hasAny(evidenceTags, POSITIVE_EVIDENCE);
  const hasContraryEvidence = hasAny(evidenceTags, CONTRARY_EVIDENCE);
  const hasContradictionEvidence = hasAny(evidenceTags, CONTRADICTION_EVIDENCE);
  const hasNegationEvidence = hasAny(evidenceTags, NEGATION_EVIDENCE);

  const candidate: McKeeValueRung =
    relationship.affection >= 55 &&
    relationship.fear >= 50 &&
    (relationship.trust <= 45 || relationship.respect <= 45) &&
    hasNegationEvidence
      ? 'negationOfNegation'
      : relationship.affection <= 30 &&
          relationship.trust <= 35 &&
          relationship.respect <= 35 &&
          relationship.fear >= 55 &&
          hasContradictionEvidence
        ? 'contradiction'
        : relationship.affection <= 30 &&
            relationship.trust <= 45 &&
            relationship.fear <= 40 &&
            hasContraryEvidence
          ? 'contrary'
          : relationship.affection >= 60 &&
              relationship.trust >= 60 &&
              relationship.respect >= 55 &&
              relationship.fear <= 35 &&
              hasPositiveEvidence
            ? 'positive'
            : input.previousState?.rung ?? 'contrary';

  return {
    npcId: input.npcId,
    axis: input.axis,
    rung: candidate,
    meaning: meaningFor(input.axis, candidate),
    confidence: confidenceFor(candidate, evidenceTags, relationship),
    evidenceTags,
    allowedSurfaces: SURFACES_BY_RUNG[candidate],
    lastUpdatedEpisode: input.lastUpdatedEpisode ?? input.previousState?.lastUpdatedEpisode,
    lastUpdatedSceneId: input.lastUpdatedSceneId ?? input.previousState?.lastUpdatedSceneId,
  };
}

export function applyRelationshipEvidence(
  player: PlayerState,
  consequence: RelationshipEvidenceConsequence,
): PlayerState {
  const key = relationshipValueKey(consequence.npcId, consequence.axis);
  const previousState = player.relationshipValueStates?.[key];
  const relationship = player.relationships[consequence.npcId];
  const proposed = classifyRelationshipValueState({
    npcId: consequence.npcId,
    axis: consequence.axis,
    relationship,
    previousState,
    evidenceTags: consequence.evidenceTags,
  });
  const { state } = enforceRelationshipTransition(previousState, proposed);

  return {
    ...player,
    relationshipValueStates: {
      ...(player.relationshipValueStates ?? {}),
      [key]: state,
    },
  };
}

export function deriveRelationshipValueState(
  player: PlayerState,
  npcId: string,
  axis: RelationshipValueAxis,
): RelationshipValueState {
  const key = relationshipValueKey(npcId, axis);
  const previousState = player.relationshipValueStates?.[key];
  return classifyRelationshipValueState({
    npcId,
    axis,
    relationship: player.relationships[npcId],
    previousState,
  });
}

export function enforceRelationshipTransition(
  previous: RelationshipValueState | undefined,
  next: RelationshipValueState,
): RelationshipTransitionResult {
  if (!previous || previous.rung === next.rung) {
    return { state: next, transitioned: Boolean(previous && previous.rung !== next.rung) };
  }

  const blockedReason = blockedTransitionReason(previous, next);
  if (!blockedReason) {
    return { state: next, transitioned: true };
  }

  return {
    state: {
      ...next,
      rung: previous.rung,
      meaning: meaningFor(next.axis, previous.rung),
      allowedSurfaces: SURFACES_BY_RUNG[previous.rung],
      confidence: 'low',
    },
    transitioned: false,
    blockedTransition: {
      from: previous.rung,
      to: next.rung,
      reason: blockedReason,
    },
  };
}

export function relationshipValueKey(npcId: string, axis: RelationshipValueAxis): string {
  return `${npcId}:${axis}`;
}

export function getSurfacesForRung(rung: McKeeValueRung): RelationshipSurface[] {
  return SURFACES_BY_RUNG[rung];
}

function classifyUnsupportedAxis(
  input: RelationshipValueClassificationInput & {
    relationship: RelationshipDimensions;
    evidenceTags: RelationshipEvidenceTag[];
  },
): RelationshipValueState {
  const relationship = input.relationship;
  const rung: McKeeValueRung =
    relationship.trust >= 55 && relationship.respect >= 45 && relationship.fear <= 40
      ? 'positive'
      : relationship.trust <= 25 && relationship.fear >= 55
        ? 'contradiction'
        : relationship.trust <= 35 && relationship.fear <= 45
          ? 'contrary'
          : input.previousState?.rung ?? 'contrary';

  return {
    npcId: input.npcId,
    axis: input.axis,
    rung,
    meaning: meaningFor(input.axis, rung),
    confidence: input.evidenceTags.length > 0 ? 'medium' : 'low',
    evidenceTags: input.evidenceTags,
    allowedSurfaces: SURFACES_BY_RUNG[rung],
    lastUpdatedEpisode: input.lastUpdatedEpisode ?? input.previousState?.lastUpdatedEpisode,
    lastUpdatedSceneId: input.lastUpdatedSceneId ?? input.previousState?.lastUpdatedSceneId,
  };
}

function normalizeRelationship(input?: Partial<RelationshipDimensions> | Relationship): RelationshipDimensions {
  return {
    trust: clamp(input?.trust ?? 0, -100, 100),
    affection: clamp(input?.affection ?? 0, -100, 100),
    respect: clamp(input?.respect ?? 0, -100, 100),
    fear: clamp(input?.fear ?? 0, 0, 100),
  };
}

function confidenceFor(
  rung: McKeeValueRung,
  evidenceTags: RelationshipEvidenceTag[],
  relationship: RelationshipDimensions,
): RelationshipValueState['confidence'] {
  const evidenceCount = evidenceTags.length;
  if (rung === 'negationOfNegation') {
    return evidenceCount >= 2 && relationship.affection >= 65 && relationship.fear >= 60 ? 'high' : 'medium';
  }
  if (evidenceCount >= 2) return 'high';
  if (evidenceCount === 1) return 'medium';
  return 'low';
}

function blockedTransitionReason(previous: RelationshipValueState, next: RelationshipValueState): string | undefined {
  if (
    previous.rung === 'positive' &&
    next.rung === 'contradiction' &&
    !hasAny(next.evidenceTags, CONTRADICTION_EVIDENCE)
  ) {
    return 'Healthy love cannot become open hostility without betrayal/retaliation evidence.';
  }

  if (
    previous.rung === 'contrary' &&
    next.rung === 'negationOfNegation' &&
    !hasAny(next.evidenceTags, NEGATION_EVIDENCE)
  ) {
    return 'Indifference cannot become corrupted care without control/coercion evidence.';
  }

  if (
    previous.rung === 'negationOfNegation' &&
    next.rung === 'positive' &&
    !next.evidenceTags.includes('repaired_harm')
  ) {
    return 'Corrupted care cannot repair into healthy love without explicit repair evidence.';
  }

  return undefined;
}

function meaningFor(axis: RelationshipValueAxis, rung: McKeeValueRung): string {
  if (axis === 'love') {
    switch (rung) {
      case 'positive': return 'care with agency';
      case 'contrary': return 'emotional absence';
      case 'contradiction': return 'active hostility';
      case 'negationOfNegation': return 'protective control';
    }
  }

  switch (rung) {
    case 'positive': return `${axis} upheld`;
    case 'contrary': return `${axis} withdrawn`;
    case 'contradiction': return `${axis} opposed`;
    case 'negationOfNegation': return `${axis} corrupted into its own mask`;
  }
}

function hasAny(tags: RelationshipEvidenceTag[], candidates: Set<RelationshipEvidenceTag>): boolean {
  return tags.some(tag => candidates.has(tag));
}

function uniqueEvidence(tags: RelationshipEvidenceTag[]): RelationshipEvidenceTag[] {
  return Array.from(new Set(tags));
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}
