/** Generator-only canonical contracts for narrative planning and realization. */

export const NARRATIVE_CONTRACT_GRAPH_VERSION = 2;
export const EPISODE_EVENT_PLAN_VERSION = 2;
export const NARRATIVE_REALIZATION_LEDGER_VERSION = 1;

export type NarrativeEventCue =
  | 'storyTurn'
  | 'arrival'
  | 'venueDoor'
  | 'objectHandoff'
  | 'socialMeet'
  | 'threatEncounter'
  | 'roadBreakdown'
  | 'friendDebrief'
  | 'lateNightWriting'
  | 'antagonistContact'
  | 'blogAftermath'
  | 'endingAftermath'
  | 'walkHome';

export type NarrativeRealizationMode =
  | 'depiction'
  | 'identity_constraint'
  | 'context_only'
  | 'future_obligation';

export type NarrativeOwnershipPolicy = 'exactly_one_scene' | 'no_scene_owner';

export type NarrativeCharacterPresenceMode =
  | 'named_on_page'
  | 'anonymous_plant'
  | 'offscreen_reference';

export interface NarrativeCharacterPresenceContract {
  id: string;
  characterId: string;
  characterName: string;
  episodeNumber: number;
  sceneId: string;
  mode: NarrativeCharacterPresenceMode;
  readerNameAllowed: boolean;
  requiredEvidence: string[];
  forbiddenEvidence: string[];
  sourceContractIds: string[];
  provenance: {
    source: 'treatment' | 'episode_spine' | 'character_bible' | 'season_plan' | 'legacy_migration';
    confidence: 'authoritative' | 'deterministic' | 'heuristic';
  };
}

export interface NarrativeIdentityScheduleContract {
  id: string;
  characterId: string;
  canonicalName: string;
  allowedAliases: string[];
  forbiddenBeforeNamedEpisode: string[];
  firstVisualEpisode: number;
  firstNamedEpisode: number;
  firstNamedSceneId?: string;
  sourceContractIds: string[];
}

export interface NarrativeCharacterRoleConstraint {
  id: string;
  characterId: string;
  characterName: string;
  episodeNumber: number;
  allowedFunctions: string[];
  forbiddenFunctions: string[];
  sourceContractIds: string[];
}

export interface NarrativeEpisodeTopologyContract {
  episodeNumber: number;
  expectedSceneCount?: number;
  authoredUnitIds: string[];
  authoredUnitTexts: string[];
  tolerance: number;
}

export type NarrativePremiseFieldKind =
  | 'canonical_identity'
  | 'role_fact'
  | 'origin_pressure'
  | 'wound_pressure'
  | 'starting_identity';

export interface NarrativePremiseContract {
  id: string;
  episodeNumber: number;
  fieldName: string;
  fieldKind: NarrativePremiseFieldKind;
  sourceText: string;
  /** Strong source-derived phrases that prove the premise landed on-page. */
  evidencePatterns: string[];
  minimumEvidenceHits: number;
  targetSceneIds: string[];
  requiredSurface: Array<'beat_text' | 'dialogue' | 'choice_text' | 'encounter_outcome'>;
  sourceContractIds: string[];
  blocking: boolean;
  provenance: {
    source: 'treatment' | 'season_plan' | 'legacy_migration';
    confidence: 'authoritative' | 'deterministic' | 'heuristic';
  };
}

export interface NarrativeStateContract {
  id: string;
  canonicalStateId: string;
  aliases: string[];
  domain?: 'relationship' | 'reputation' | 'danger' | 'information' | 'identity' | 'leverage' | 'resource';
  sourceEpisodeNumber: number;
  targetEpisodeNumbers: number[];
  sourceContractIds: string[];
  requiredSetterSurface: 'choice_consequence' | 'encounter_outcome' | 'scene_on_show';
  blocking: boolean;
  provenance: {
    source: 'season_flag' | 'residue_plan' | 'choice_moment' | 'episode_outline' | 'legacy_migration';
    confidence: 'authoritative' | 'deterministic' | 'heuristic';
  };
}

export interface NarrativeSeedContract {
  id: string;
  sourceEpisodeNumber: number;
  targetEpisodeNumbers: number[];
  targetSceneIds: string[];
  sourceText: string;
  requiredEvidence: string[];
  stateContractIds: string[];
  realizationMode: 'identity_constraint' | 'context_only' | 'future_obligation';
  payoffWindow?: { minEpisode: number; maxEpisode: number };
  requiredSurface: string[];
  sourceContractIds: string[];
  blocking: boolean;
  provenance: {
    source: 'residue_plan' | 'choice_moment' | 'information_ledger' | 'legacy_migration';
    confidence: 'authoritative' | 'deterministic' | 'heuristic';
  };
}

export interface NarrativeTransitionContract {
  id: string;
  episodeNumber: number;
  fromSceneId: string;
  toSceneId: string;
  fromLocation?: string;
  toLocation?: string;
  fromTimeOfDay?: string;
  toTimeOfDay?: string;
  requiredBridgeEvidence: string[];
  blocking: boolean;
  sourceContractIds: string[];
}

export interface NarrativeChoiceResidueContract {
  id: string;
  sourceEpisodeNumber: number;
  sourceSceneId?: string;
  sourceChoiceMomentId?: string;
  canonicalStateIds: string[];
  targetEpisodeNumbers: number[];
  targetSceneIds: string[];
  requiredSurface: string[];
  sourceText: string;
  blocking: boolean;
  provenance: {
    source: 'residue_plan' | 'branch_contract' | 'legacy_migration';
    confidence: 'authoritative' | 'deterministic' | 'heuristic';
  };
}

export interface NarrativeTwistContract {
  id: string;
  episodeNumber: number;
  targetSceneIds: string[];
  sourceText: string;
  beatRole: 'setup' | 'twist' | 'revelation' | 'payoff';
  requiredEvidence: string[];
  blocking: boolean;
  provenance: 'treatment_required' | 'season_architecture' | 'quality_recommendation';
}

export interface NarrativeEventContract {
  id: string;
  episodeNumber: number;
  sourceOrder: number;
  sourceText: string;
  sourceContractIds: string[];
  realizationMode: NarrativeRealizationMode;
  ownershipPolicy: NarrativeOwnershipPolicy;
  prerequisiteEventIds: string[];
  targetSceneIds: string[];
  targetSpineUnitIds: string[];
  ownerSceneId?: string;
  cue?: NarrativeEventCue;
  /** Whether required evidence must survive every authored terminal route. */
  routeRealizationPolicy?: 'all_routes' | 'branch_conditioned' | 'any_route';
  /** Terminal outcome keys to inspect when routeRealizationPolicy is all_routes. */
  requiredOutcomeTiers?: string[];
  /** Deterministic reader-facing evidence required before this event resolves. */
  evidenceRequirements?: NarrativeEvidenceRequirement[];
  provenance: {
    source: 'episode_spine' | 'treatment_contract' | 'season_plan' | 'legacy_migration';
    confidence: 'authoritative' | 'deterministic' | 'heuristic';
  };
}

export type NarrativeEvidenceKind =
  | 'exact_alias'
  | 'audience_consequence'
  | 'location'
  | 'action'
  | 'identity_constraint';

export interface NarrativeEvidenceRequirement {
  id: string;
  eventId: string;
  kind: NarrativeEvidenceKind;
  acceptedPatterns: string[];
  requiredExactText?: boolean;
  /** Scope of the reader-facing surface on which this evidence must appear. */
  requiredSurface?: 'owner_scene' | 'all_routes' | 'any_route';
  blocking: boolean;
}

export type NarrativeDependencyRelation =
  | 'causes'
  | 'sets_up'
  | 'pays_off'
  | 'recalls'
  | 'constrains'
  | 'branches_from';

export interface NarrativeDependencyContract {
  id: string;
  fromEventId: string;
  toEventId?: string;
  relation: NarrativeDependencyRelation;
  sourceEpisodeNumber: number;
  targetEpisodeNumbers: number[];
  targetSceneIds: string[];
  branchConditionKeys: string[];
  payoffWindow?: { minEpisode: number; maxEpisode: number };
  requiredSurfaces: string[];
  priority: 'minor' | 'moderate' | 'major';
  sourceContractIds: string[];
  description?: string;
}

export interface NarrativeContractIssue {
  code: string;
  severity: 'error' | 'warning';
  message: string;
  eventId?: string;
  dependencyId?: string;
  episodeNumber?: number;
  sceneId?: string;
}

export interface NarrativeContractGraph {
  version: number;
  compilerVersion: string;
  storyId: string;
  sourceHash: string;
  events: NarrativeEventContract[];
  characterPresenceContracts: NarrativeCharacterPresenceContract[];
  identityScheduleContracts?: NarrativeIdentityScheduleContract[];
  characterRoleConstraints?: NarrativeCharacterRoleConstraint[];
  episodeTopologyContracts?: NarrativeEpisodeTopologyContract[];
  premiseContracts?: NarrativePremiseContract[];
  stateContracts?: NarrativeStateContract[];
  seedContracts?: NarrativeSeedContract[];
  transitionContracts?: NarrativeTransitionContract[];
  choiceResidueContracts?: NarrativeChoiceResidueContract[];
  twistContracts?: NarrativeTwistContract[];
  dependencies: NarrativeDependencyContract[];
  validation: { passed: boolean; issues: NarrativeContractIssue[] };
}

export interface EpisodeEventAssignment {
  eventId: string;
  sceneId: string;
  order: number;
}

export interface EpisodeSceneEventContext {
  sceneId: string;
  ownedEventIds: string[];
  priorEventIdsWithinEpisode: string[];
  forbiddenRestageEventIds: string[];
}

export interface EpisodeEventPlan {
  version: number;
  compilerVersion: string;
  episodeNumber: number;
  sourceGraphHash: string;
  orderedEventIds: string[];
  assignments: EpisodeEventAssignment[];
  sceneOrder: string[];
  sceneContexts: EpisodeSceneEventContext[];
  dueDependencyIds: string[];
  activeDependencyIds: string[];
  characterPresenceContracts: NarrativeCharacterPresenceContract[];
  identityScheduleContracts?: NarrativeIdentityScheduleContract[];
  characterRoleConstraints?: NarrativeCharacterRoleConstraint[];
  premiseContracts?: NarrativePremiseContract[];
  stateContracts?: NarrativeStateContract[];
  seedContracts?: NarrativeSeedContract[];
  transitionContracts?: NarrativeTransitionContract[];
  choiceResidueContracts?: NarrativeChoiceResidueContract[];
  twistContracts?: NarrativeTwistContract[];
  validation: { passed: boolean; issues: NarrativeContractIssue[] };
}

export interface NarrativeRealizationEvidence {
  episodeNumber: number;
  sceneId: string;
  beatId?: string;
  artifactId?: string;
  description: string;
  recordedAt: string;
}

export interface NarrativeRealizationRecord {
  contractId: string;
  routeKey?: string;
  outcomeTier?: string;
  status: 'assigned' | 'planted' | 'partially_realized' | 'evidenced' | 'resolved' | 'blocked';
  evidence: NarrativeRealizationEvidence[];
}

export interface NarrativeRealizationLedger {
  version: number;
  storyId: string;
  graphSourceHash: string;
  records: NarrativeRealizationRecord[];
}
