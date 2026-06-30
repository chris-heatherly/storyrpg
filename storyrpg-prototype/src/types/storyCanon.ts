/**
 * Source-locked story canon.
 *
 * These types define the mandatory source-stage story facts used by the
 * generator before season planning can begin. They are generator-facing only:
 * reader playback should treat this as diagnostics / provenance metadata.
 */

export type CanonInputKind =
  | 'story-treatment-lite'
  | 'story-treatment-full'
  | 'source-material'
  | 'freeform-prompt'
  | 'mixed';

export type CanonFactDomain =
  | 'story'
  | 'story_circle'
  | 'arc'
  | 'episode'
  | 'character'
  | 'npc'
  | 'world'
  | 'location'
  | 'ending';

export type CanonFactSource =
  | 'explicit_input'
  | 'source_canon_derivation'
  | 'validator_repair'
  | 'season_planner'
  | 'episode_architect'
  | 'scene_writer'
  | 'beat_realization';

export type CanonFactConfidence = 'explicit' | 'high' | 'medium' | 'low';

export type CanonFactStatus = 'canonical' | 'derived' | 'disputed' | 'rejected';

export type CanonStage = 'source' | 'season' | 'episode' | 'scene' | 'beat' | 'repair';

export interface CanonFact {
  id: string;
  domain: CanonFactDomain;
  kind: string;
  subjectId: string;
  value: unknown;
  source: CanonFactSource;
  sourceText?: string;
  evidenceText?: string[];
  confidence: CanonFactConfidence;
  derivedFromFactIds: string[];
  supersedesFactIds?: string[];
  status: CanonFactStatus;
  createdAtStage: CanonStage;
  episodeNumber?: number;
  sceneId?: string;
  beatId?: string;
}

export type CanonObligationDomain =
  | 'story_identity'
  | 'story_promise'
  | 'story_circle'
  | 'arc'
  | 'protagonist'
  | 'npc'
  | 'world'
  | 'episode'
  | 'ending';

export type CanonObligationSurface =
  | 'season_plan'
  | 'episode_plan'
  | 'scene_turn'
  | 'beat_text'
  | 'final_prose'
  | 'ending_target';

export interface CanonObligation {
  id: string;
  canonSourceId: string;
  domain: CanonObligationDomain;
  kind: string;
  sourceText: string;
  requiredRealization: CanonObligationSurface[];
  targetEpisodeNumbers: number[];
  targetSceneIds: string[];
  targetBeatIds?: string[];
  blockingLevel: 'blocking' | 'advisory';
}

export interface CanonConflict {
  id: string;
  factIds: string[];
  domain: CanonFactDomain;
  kind: string;
  subjectId: string;
  message: string;
}

export interface CanonDerivationReport {
  explicitFactCount: number;
  derivedFactCount: number;
  repairedFactCount: number;
  missingBeforeDerivation: string[];
  conflictsResolved: string[];
  unresolvedConflicts: string[];
  confidenceWarnings: string[];
}

export interface CanonValidatorRecord {
  validator: string;
  passed: boolean;
  issues: string[];
}

export interface CanonLockManifest {
  canonId: string;
  canonVersion: number;
  sourceFingerprint: string;
  requiredConceptsSatisfied: boolean;
  lockedFactIds: string[];
  validatorResults: CanonValidatorRecord[];
}

export interface LockedStoryCanon {
  canonId: string;
  canonVersion: number;
  sourceFingerprint: string;
  inputKind: CanonInputKind;
  lockStatus: 'draft' | 'locked';
  lockedAtStage: 'source';
  lockedAt?: string;
  facts: CanonFact[];
  obligations: CanonObligation[];
  derivationReport: CanonDerivationReport;
  lockManifest: CanonLockManifest;
}

export type CanonWizardStep = 'story' | 'peopleWorld' | 'episodesEndings';

export type CanonWizardStepStatus = 'draft' | 'approved' | 'invalidated';

export interface CanonEditProposal {
  factId: string;
  fieldPath: string;
  previousValue: unknown;
  nextValue: unknown;
  editedBy: 'user';
  editedAt: string;
  invalidatesSteps: CanonWizardStep[];
}

export interface CanonEditConflict {
  id: string;
  factId: string;
  fieldPath: string;
  message: string;
  previousValue?: unknown;
  nextValue?: unknown;
  priorFactIds: string[];
}

export interface CanonEditRepairSuggestion {
  summary: string;
  proposedPatches: Array<{
    factId: string;
    fieldPath: string;
    nextValue: unknown;
    reason: string;
  }>;
  source: 'deterministic' | 'llm';
}

export interface CanonEditValidationResult {
  passed: boolean;
  blockingConflicts: CanonEditConflict[];
  warnings: string[];
  suggestion?: CanonEditRepairSuggestion;
}

export interface CanonWizardState {
  canonId: string;
  canonVersion: number;
  activeStep: CanonWizardStep;
  stepStatus: Record<CanonWizardStep, CanonWizardStepStatus>;
  selectedEpisodes: number[];
  validationIssues: CanonEditConflict[];
  repairSuggestions: CanonEditRepairSuggestion[];
  lastValidatedAt?: string;
  lastEditedAt?: string;
}
