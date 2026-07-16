/** Generator-only canonical contracts for narrative planning and realization. */

export const NARRATIVE_CONTRACT_GRAPH_VERSION = 10;
export const EPISODE_EVENT_PLAN_VERSION = 10;
export const NARRATIVE_REALIZATION_LEDGER_VERSION = 1;

export type NarrativeVerificationAuthority =
  | 'structured'
  | 'literal'
  | 'semantic_judge';

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

export type NarrativeRealizationOwnerStage =
  | 'scene_writer'
  | 'choice_author'
  | 'encounter_architect';

export type NarrativeRealizationSurface =
  | 'transition_in'
  | 'beat_text'
  | 'dialogue'
  | 'choice_text'
  | 'choice_outcome'
  | 'encounter_entry'
  | 'encounter_setup'
  | 'encounter_phase'
  | 'encounter_outcome'
  | 'terminal_storylet'
  | 'text_variant';

export type NarrativeRouteEvidencePolicy =
  | 'owner_surface'
  | 'path_required'
  | 'terminal_required'
  | 'any_route';

/**
 * Canonical executable evidence target. Unlike the legacy combination of
 * `requiredSurface`, `routePolicy`, and `outcomeTier`, this union cannot express
 * a path/terminal policy without also naming the route it applies to.
 */
export type NarrativeEvidenceTarget =
  | { scope: 'owner'; surfaces: NarrativeRealizationSurface[] }
  | { scope: 'all_options'; surfaces: NarrativeRealizationSurface[] }
  | { scope: 'all_choice_outcomes'; surfaces: NarrativeRealizationSurface[] }
  | { scope: 'route_path'; outcomeTier: string; surfaces: NarrativeRealizationSurface[] }
  | { scope: 'route_terminal'; outcomeTier: string; surfaces: NarrativeRealizationSurface[] }
  | { scope: 'any_route'; outcomeTiers: string[]; surfaces: NarrativeRealizationSurface[] };

export interface NarrativeEvidenceAtom {
  id: string;
  description: string;
  acceptedPatterns: string[];
  sourceText?: string;
  kind: 'lexical' | 'semantic' | 'relationship_label' | 'route';
  /**
   * The only subsystem allowed to decide whether this atom is satisfied.
   * Version-8+ compilers always write this field. It remains optional at the
   * TypeScript boundary so older checkpoints can be normalized safely.
   */
  verificationAuthority?: NarrativeVerificationAuthority;
  /** Concrete semantic criteria supplied to the judge. These are meaning
   * requirements, never wording that deterministic code may demand. */
  semanticCriteria?: string[];
  /** Typed matcher selected by the contract compiler. Generic semantic token
   * overlap is intentionally not authoritative for structured continuity facts. */
  matchStrategy?:
    | 'default'
    | 'location_identity'
    | 'temporal_orientation'
    | 'transition_action'
    | 'state_transition';
  /** Typed semantic role used by executable-plan and owner-stage validators. */
  semanticRole?:
    | 'action'
    | 'introduction'
    | 'information_transfer'
    | 'state_change'
    | 'relationship_change'
    | 'location_entry'
    | 'location_reference'
    | 'transition_bridge'
    | 'temporal_transition'
    | 'decision'
    | 'aftermath';
  subjectIds?: string[];
  participantIds?: string[];
  prerequisiteAtomIds?: string[];
  /** Producer and temporal placement assigned by the episode task compiler. */
  producerStage?: NarrativeRealizationOwnerStage;
  temporalSlot?: 'pre_choice' | 'choice_resolution' | 'owner_event' | 'encounter_entry' | 'encounter_route' | 'terminal';
  stagedLocation?: string;
  referencedLocations?: string[];
  required: boolean;
  polarity?: 'required' | 'forbidden';
}

export type AuthoredEventSemanticRole = NonNullable<NarrativeEvidenceAtom['semanticRole']>;

/**
 * One exact authored source segment supplied to the semantic-contract compiler.
 * Segments preserve supporting treatment intents without asking deterministic
 * code to infer their meaning.
 */
export interface AuthoredEventSemanticSource {
  id: string;
  text: string;
}

/** An LLM-authored, source-grounded proposition used to judge realization. */
export interface AuthoredEventSemanticProposition {
  id: string;
  sourceId: string;
  sourceSpan: string;
  proposition: string;
  semanticRole: AuthoredEventSemanticRole;
  participantIds: string[];
  semanticCriteria: string[];
  prerequisitePropositionIds: string[];
  stagedLocation?: string;
  referencedLocations: string[];
  required: boolean;
  /** Exact reader-facing artifacts created by this proposition. The semantic
   * compiler identifies creation; deterministic code only schedules use. */
  createdLexicalArtifacts?: AuthoredLexicalArtifact[];
}

export interface AuthoredLexicalArtifact {
  id: string;
  kind: 'coined_term' | 'group_name' | 'title' | 'handle' | 'codeword';
  canonicalValue: string;
  creatorParticipantId?: string;
  /** Source-mandated values remain invariant. Player-selected artifacts may
   * vary, but every downstream use must resolve through the selected value. */
  routePolicy: 'source_invariant' | 'player_selected';
  allowedAlternatives: string[];
}

export interface AuthoredEventSemanticContract {
  eventId: string;
  sourceText: string;
  sources: AuthoredEventSemanticSource[];
  propositions: AuthoredEventSemanticProposition[];
}

export interface AuthoredPremiseSemanticProposition {
  id: string;
  sourceSpan: string;
  proposition: string;
  semanticCriteria: string[];
  verificationAuthority: Extract<NarrativeVerificationAuthority, 'literal' | 'semantic_judge'>;
  required: boolean;
}

export interface AuthoredPremiseSemanticContract {
  premiseId: string;
  sourceText: string;
  minimumEvidenceHits: number;
  propositions: AuthoredPremiseSemanticProposition[];
}

/**
 * Persisted interpretive IR. An LLM decomposes authored events into semantic
 * propositions; deterministic code only validates provenance and projects the
 * accepted propositions into executable evidence atoms.
 */
export interface AuthoredEventSemanticIR {
  version: 1;
  policyVersion: string;
  provider: string;
  model: string;
  sourceHash: string;
  events: AuthoredEventSemanticContract[];
  premiseSourceHash?: string;
  premises?: AuthoredPremiseSemanticContract[];
}

export interface NarrativeEvidenceGroup {
  id: string;
  description: string;
  requirement: 'all' | 'any' | 'minimum';
  atomIds: string[];
  minimumEvidenceHits?: number;
  blocking: boolean;
  sourceContractIds: string[];
}

export type NarrativeContractEnforcementMode =
  | 'artifact_assertion'
  | 'positive_realization'
  | 'contradiction_only';

/** Explicit Boolean satisfaction policy. Verification authority selects an
 * evaluator; it never changes this expression or independently fails a task. */
export interface NarrativeTaskSatisfactionExpression {
  allOfAtomIds: string[];
  anyOfGroups: Array<{
    id: string;
    atomIds: string[];
    minimumHits: number;
  }>;
}

/**
 * The smallest blocking unit that can be assigned, authored, validated, and
 * repaired by one pipeline stage. The LLM may report these ids, but validators
 * derive satisfaction from the committed artifact rather than trusting that
 * report.
 */
export interface NarrativeRealizationTask {
  id: string;
  contractId: string;
  /** Canonical depiction event represented by this task, when applicable. */
  canonicalEventId?: string;
  /** Projection contracts merged into the canonical task for provenance only. */
  projectionOf?: string[];
  sourceKinds?: Array<'event' | 'story_circle' | 'treatment' | 'presence' | 'transition' | 'relationship' | 'premise'>;
  episodeNumber: number;
  ownerStage: NarrativeRealizationOwnerStage;
  repairHandler: 'premise_realization' | 'relationship_pacing' | 'encounter_route' | 'scene_prose' | 'choice_reauthor';
  sceneId?: string;
  beatId?: string;
  eventId?: string;
  /** Tasks whose committed evidence must precede this task's evidence. */
  prerequisiteTaskIds?: string[];
  /** Relationship-label evidence is evaluated near this subject, not against
   * unrelated names or groups mentioned elsewhere in the same scene. */
  evidenceScope?: { npcId?: string; groupId?: string };
  artifactPath?: string;
  evidenceAtoms: NarrativeEvidenceAtom[];
  evidenceGroups?: NarrativeEvidenceGroup[];
  enforcementMode?: NarrativeContractEnforcementMode;
  /** Canonical satisfaction policy for version-10 tasks. Legacy thresholds are
   * normalized at evaluation and migration boundaries. */
  satisfaction?: NarrativeTaskSatisfactionExpression;
  /** Minimum number of positive evidence atoms required when the task models
   * a threshold contract such as a premise. Omitted means every required atom
   * must be present. */
  minimumEvidenceHits?: number;
  /** Canonical executable placement. */
  target: NarrativeEvidenceTarget;
  sourceContractIds: string[];
  blocking: boolean;
  /** 'final_regression' tasks are skipped by owner-stage validation (cost +
   * mid-generation churn) and enforced only by the final semantic contract.
   * Reveal-timing negative contracts use this phase. */
  enforcementPhase?: 'owner' | 'final_regression';
}

/** Addressable reader-facing evidence supplied to an interpretive judge. */
export interface NarrativeEvidenceExcerpt {
  id: string;
  taskId: string;
  sceneId: string;
  ownerStage: NarrativeRealizationOwnerStage;
  surface: NarrativeRealizationSurface;
  groupKey: string;
  routeKey?: string;
  beatId?: string;
  choiceId?: string;
  outcomeTier?: string;
  text: string;
  textHash: string;
}

/** Serialized version-2 task shape accepted only at artifact boundaries. */
export interface LegacyNarrativeRealizationTaskV2 extends Omit<NarrativeRealizationTask, 'target'> {
  outcomeTier?: string;
  requiredSurface: NarrativeRealizationSurface[];
  routePolicy: NarrativeRouteEvidencePolicy;
  target?: never;
}

export type PersistedNarrativeRealizationTask = NarrativeRealizationTask | LegacyNarrativeRealizationTaskV2;

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

export type NarrativePremiseEvidenceKind = 'fact' | 'behavior' | 'role' | 'wound' | 'origin';

export interface NarrativePremiseEvidenceAtom {
  id: string;
  kind: NarrativePremiseEvidenceKind;
  canonicalFact: string;
  acceptedPatterns: string[];
  required: boolean;
  sourceText: string;
  sourceSpan?: string;
  semanticCriteria?: string[];
  verificationAuthority?: Extract<NarrativeVerificationAuthority, 'literal' | 'semantic_judge'>;
}

export interface NarrativePremiseContract {
  id: string;
  episodeNumber: number;
  fieldName: string;
  fieldKind: NarrativePremiseFieldKind;
  sourceText: string;
  /** Strong source-derived phrases that prove the premise landed on-page. */
  evidencePatterns: string[];
  /** Typed evidence replaces brittle adjacent source n-grams while retaining
   * evidencePatterns for version-2 readers and migration diagnostics. */
  evidenceAtoms?: NarrativePremiseEvidenceAtom[];
  enforcementMode?: NarrativeContractEnforcementMode;
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
  /** What the receiving producer must put on-page. Ordinary cuts need opening
   * orientation; continuous movement needs an explicit bridge; state changes
   * need the changed disposition carried into the receiving scene. */
  bridgePolicy: 'orientation_only' | 'continuous_action' | 'state_handoff';
  locationRequirement?: NarrativeTransitionEvidenceRequirement;
  timeRequirement?: NarrativeTransitionEvidenceRequirement;
  requiredBridgeEvidence: string[];
  /** Explicit non-location continuity changes that the bridge must carry. */
  stateContracts?: NarrativeTransitionStateContract[];
  blocking: boolean;
  sourceContractIds: string[];
}

export interface NarrativeTransitionEvidenceRequirement {
  canonicalValue: string;
  acceptedAliases: string[];
  required: boolean;
}

export interface NarrativeTransitionStateContract {
  id: string;
  subject: string;
  fromDisposition?: string;
  toDisposition?: string;
  requiredEvidence: string[];
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

/**
 * Season-level secret that must stay unrevealed on reader-facing surfaces
 * until its reveal episode. The pipeline verifies required meanings and
 * forbidden labels; this is the missing third leg — forbidden MEANINGS with a
 * time bound. Live defect: bite-me_2026-07-15T18-38-14 shipped "The bait
 * worked perfectly" in Episode 1, detonating the staged-rescue secret the
 * treatment holds until Episode 5, through a passing final contract.
 */
export interface NarrativeRevealContract {
  id: string;
  /** What the secret IS — planning metadata, never reader-facing. */
  secretDescription: string;
  /** Meanings whose on-page presence before revealEpisode is a canon breach. */
  forbiddenMeanings: string[];
  /** First episode where this truth may surface on reader-facing surfaces. */
  revealEpisode: number;
  /** Treatment/NPC-brief grounding for audits. */
  sourceRef?: string;
}

/**
 * G5 (treatment-gap analysis 2026-07-15): a "live season anchor" from an
 * episode outline's likely-consequence line, compiled to the scene that owns
 * planting it and a reader-visible ACTION that plants it. Run 20-44-49:
 * "Stela's protection" was satisfied by character metadata (a pendant
 * description) with no consented object ever accepted on-page, and "Radu's
 * first sighting" was staged twice because nothing told the intro scheduler
 * the rooftop owned it — the treatment stages him anonymously, so this
 * linkage must be compiled semantically, never name-matched.
 */
export interface NarrativeAnchorContract {
  id: string;
  /** The anchor as the treatment names it (e.g. "Stela's protection"). */
  anchorName: string;
  episodeNumber: number;
  /** Scene that owns planting this anchor on-page. */
  owningSceneId: string;
  /** Concrete reader-visible action that plants the anchor — a judge-testable claim, never a vibe. */
  onPageAction: string;
  /** Canonical cast-member name when the anchor is about a character. */
  npcName?: string;
  /** True when the owning scene is that character's FIRST on-page appearance. */
  firstSighting?: boolean;
  /** Disclosure policy for a first sighting. Required by new semantic output
   * whenever firstSighting is true. */
  appearanceMode?: Extract<NarrativeCharacterPresenceMode, 'named_on_page' | 'anonymous_plant'> | 'not_applicable';
  sourceRef?: string;
}

/** A name, title, handle, or codeword that does not exist in reader-facing
 * continuity until one canonical proposition creates it. */
export interface NarrativeLexicalArtifactContract {
  id: string;
  episodeNumber: number;
  creatorEventId: string;
  creatorSceneId: string;
  creatorPropositionId: string;
  kind: AuthoredLexicalArtifact['kind'];
  canonicalValue: string;
  creatorParticipantId?: string;
  routePolicy: AuthoredLexicalArtifact['routePolicy'];
  allowedAlternatives: string[];
  forbiddenBeforeSceneIds: string[];
  sourceContractIds: string[];
  blocking: boolean;
}

/** Transactional scene-state projection. The strings remain authored planning
 * facts; deterministic validation checks ordering and identity, not meaning. */
export interface NarrativeSceneStateContract {
  id: string;
  episodeNumber: number;
  sceneId: string;
  sceneOrder: number;
  entryLocation?: string;
  exitLocation?: string;
  entryTimeOfDay?: string;
  exitTimeOfDay?: string;
  beforeState?: string;
  afterState?: string;
  ownedEventIds: string[];
  priorEventIdsWithinEpisode: string[];
  forbiddenRestageEventIds: string[];
  sourceContractIds: string[];
}

export interface NarrativeFirstAppearanceContract {
  id: string;
  characterId: string;
  characterName: string;
  episodeNumber: number;
  owningSceneId: string;
  mode: NarrativeCharacterPresenceMode;
  earlierSceneIds: string[];
  sourceContractIds: string[];
  blocking: boolean;
}

export interface NarrativeRouteRealizationContract {
  id: string;
  episodeNumber: number;
  sourceSceneId: string;
  choiceType?: 'expression' | 'relationship' | 'strategic' | 'dilemma';
  routeInvariantEventIds: string[];
  allowedTargetSceneIds: string[];
  requiresVisibleResidue: boolean;
  convergencePolicy: 'immediate' | 'branch_then_converge' | 'episode_terminal';
  sourceContractIds: string[];
  blocking: boolean;
}

export interface NarrativeEncounterParticipationContract {
  id: string;
  episodeNumber: number;
  sceneId: string;
  canonicalParticipantIds: string[];
  requiredNpcIds: string[];
  protagonistRequired: boolean;
  sourceContractIds: string[];
  blocking: boolean;
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
  /** Atomic executable evidence compiled from the authored event source. */
  realizationAtoms?: NarrativeEvidenceAtom[];
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
  /** Explicit route placement for newly compiled all-route evidence. */
  routeEvidencePosition?: 'path' | 'terminal';
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
  /** Player-facing story prose is authored in second person. Planning and
   * visual metadata may still name the protagonist in third person. */
  narrativeVoice?: 'second_person';
  /** Locked world-canon location names accepted by semantic event contracts. */
  knownLocationNames?: string[];
  /** Persisted interpretive source for depiction-event evidence atoms. */
  semanticEventIr?: AuthoredEventSemanticIR;
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
  /** Season secrets with reveal-episode bounds (forbidden meanings before). */
  revealContracts?: NarrativeRevealContract[];
  /** Live season anchors bound to their owning scene + on-page planting action. */
  anchorContracts?: NarrativeAnchorContract[];
  lexicalArtifactContracts?: NarrativeLexicalArtifactContract[];
  sceneStateContracts?: NarrativeSceneStateContract[];
  firstAppearanceContracts?: NarrativeFirstAppearanceContract[];
  routeRealizationContracts?: NarrativeRouteRealizationContract[];
  encounterParticipationContracts?: NarrativeEncounterParticipationContract[];
  realizationTasks?: NarrativeRealizationTask[];
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
  lexicalArtifactContracts?: NarrativeLexicalArtifactContract[];
  sceneStateContracts?: NarrativeSceneStateContract[];
  firstAppearanceContracts?: NarrativeFirstAppearanceContract[];
  routeRealizationContracts?: NarrativeRouteRealizationContract[];
  encounterParticipationContracts?: NarrativeEncounterParticipationContract[];
  realizationTasks?: NarrativeRealizationTask[];
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
