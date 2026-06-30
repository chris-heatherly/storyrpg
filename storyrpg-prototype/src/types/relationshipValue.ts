// ========================================
// RELATIONSHIP VALUE LADDER TYPES
// ========================================

export type RelationshipValueDimension = 'trust' | 'affection' | 'respect' | 'fear';

export type RelationshipDimensions = Record<RelationshipValueDimension, number>;

export type RelationshipValueAxis =
  | 'love'
  | 'trust'
  | 'loyalty'
  | 'respect'
  | 'belonging'
  | 'freedom'
  | 'safety'
  | 'ambition';

export type McKeeValueRung =
  | 'positive'
  | 'contrary'
  | 'contradiction'
  | 'negationOfNegation';

export type RelationshipEvidenceTag =
  | 'respected_agency'
  | 'sacrificed_without_control'
  | 'repaired_harm'
  | 'protected_player'
  | 'withheld_care'
  | 'ignored_need'
  | 'sabotaged_player'
  | 'publicly_attacked'
  | 'retaliated'
  | 'overrode_player_choice'
  | 'aid_with_strings'
  | 'used_guilt_as_leverage'
  | 'protective_control';

export type RelationshipSurface =
  | 'confession'
  | 'mutual_aid'
  | 'sacrifice'
  | 'forgiveness'
  | 'agency_respecting_protection'
  | 'absence'
  | 'cold_greeting'
  | 'withheld_help'
  | 'missed_callback'
  | 'confrontation'
  | 'sabotage'
  | 'route_block'
  | 'public_accusation'
  | 'aid_with_cost'
  | 'protective_control'
  | 'agency_removal'
  | 'guilt_callback'
  | 'conditional_help';

export interface RelationshipValueState {
  npcId: string;
  axis: RelationshipValueAxis;
  rung: McKeeValueRung;
  meaning: string;
  confidence: 'low' | 'medium' | 'high';
  evidenceTags: RelationshipEvidenceTag[];
  allowedSurfaces: RelationshipSurface[];
  lastUpdatedEpisode?: number;
  lastUpdatedSceneId?: string;
}

export interface RelationshipValueEvidence {
  npcId: string;
  axis: RelationshipValueAxis;
  evidenceTags: RelationshipEvidenceTag[];
  intendedSurface?: RelationshipSurface;
  reason: string;
}

export interface RelationshipRungCondition {
  type: 'relationshipRung';
  npcId: string;
  axis: RelationshipValueAxis;
  rung: McKeeValueRung;
}

export interface RelationshipEvidenceConsequence {
  type: 'relationshipEvidence';
  npcId: string;
  axis: RelationshipValueAxis;
  evidenceTags: RelationshipEvidenceTag[];
  reason: string;
  intendedSurface?: RelationshipSurface;
}

export interface ThemeImageSystemMotif {
  motifId: string;
  motif: string;
  thematicMeaning: string;
  positiveTreatment: string;
  contraryTreatment: string;
  contradictionTreatment: string;
  negationTreatment: string;
  climaxTreatment: string;
}
