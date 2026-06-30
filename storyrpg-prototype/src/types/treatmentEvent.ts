export type TreatmentEventType =
  | 'arrival'
  | 'departure'
  | 'meeting'
  | 'conversation'
  | 'discovery'
  | 'conflict'
  | 'choice'
  | 'aftermath'
  | 'reveal'
  | 'relationship_shift'
  | 'state_change'
  | 'context';

export type TreatmentEventRealizationMode =
  | 'dramatize'
  | 'imply'
  | 'context_only';

export interface TreatmentEventAtom {
  id: string;
  episodeNumber: number;
  order: number;
  sourceText: string;
  eventText: string;
  eventType: TreatmentEventType;
  chronologyKey: string;
  requiredEntities: string[];
  requiredLocations: string[];
  timeCue?: string;
  realizationMode: TreatmentEventRealizationMode;
  sourceSection?: string;
  isPlayableEvent: boolean;
}

export interface TreatmentEventOwnership {
  atomId: string;
  sceneId: string;
  ownershipKind: 'primary' | 'supporting' | 'context';
  realizationStatus: 'planned' | 'realized' | 'missing' | 'duplicate' | 'out_of_order' | 'context_only';
  evidenceBeatIds: string[];
  duplicateSceneIds: string[];
  chronologyStatus: 'ok' | 'missing' | 'duplicate' | 'out_of_order' | 'not_playable';
}

export interface GeneratedEpisodeAuditIssue {
  id: string;
  severity: 'blocking' | 'warning';
  category:
    | 'eventCoverage'
    | 'sceneShape'
    | 'leakage'
    | 'choiceAgency'
    | 'chronology'
    | 'councilIntegrity'
    | 'qualityEligibility';
  message: string;
  location?: string;
  atomId?: string;
  sceneId?: string;
  beatId?: string;
}

export interface QualityEligibilityAudit {
  eligibleFor90: boolean;
  blockingReasons: string[];
  capsApplied: Array<{ id: string; maxScore: number; reason: string }>;
}

export interface GeneratedEpisodeAuditReport {
  passed: boolean;
  blockingIssues: GeneratedEpisodeAuditIssue[];
  warnings: GeneratedEpisodeAuditIssue[];
  eventCoverage: {
    atoms: TreatmentEventAtom[];
    ownership: TreatmentEventOwnership[];
    missingAtomIds: string[];
  };
  sceneShape: {
    emptySceneIds: string[];
    emptyEncounterSceneIds: string[];
  };
  leakage: {
    findings: Array<{ pattern: string; path: string; excerpt: string; sceneId?: string; beatId?: string }>;
  };
  choiceAgency: {
    falseMeaningfulChoiceIds: string[];
  };
  chronology: {
    duplicateAtomIds: string[];
    outOfOrderAtomIds: string[];
  };
  councilIntegrity: {
    parserErrorCheckpoints: string[];
    providerErrorCheckpoints?: Array<{ checkpoint: string; error: string; fusionUsed?: boolean }>;
    unresolvedConcreteFindingCount: number;
  };
  qualityEligibility: QualityEligibilityAudit;
}
