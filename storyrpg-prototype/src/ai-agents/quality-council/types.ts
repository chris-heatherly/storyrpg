import type { StoryCouncilMode } from '../config';

export type CouncilCheckpoint = 'plan' | 'choice' | 'route-playtest' | 'final';
export type CouncilCategory =
  | 'story-circle-spine'
  | 'dramatic-structure'
  | 'scene-coherence'
  | 'choice-agency'
  | 'branch-residue'
  | 'character-relationship'
  | 'fiction-first-mechanics'
  | 'encounter-quality'
  | 'treatment-fidelity';
export type CouncilSeverity = 'info' | 'warning' | 'error';
export type CouncilConfidence = 'low' | 'medium' | 'high';
export type CouncilRepairRoute = 'plan-time' | 'regen-scene' | 'regen-choices' | 'regen-episode' | 'none';

export interface CouncilFinding {
  id: string;
  checkpoint: CouncilCheckpoint;
  category: CouncilCategory;
  severity: CouncilSeverity;
  confidence: CouncilConfidence;
  evidence: string[];
  target?: { episodeId?: string; sceneId?: string; beatId?: string; choiceId?: string };
  repairRoute: CouncilRepairRoute;
  validatorMapping?: string;
}

export interface QualityCouncilCheckpointReport {
  checkpoint: CouncilCheckpoint;
  status: 'passed' | 'findings' | 'skipped' | 'error';
  summary: string;
  findings: CouncilFinding[];
  parseStatus?: 'ok' | 'recovered' | 'raw_findings_dropped' | 'error';
  parseError?: string;
  rawFindingCountEstimate?: number;
  droppedFindingCount?: number;
  rawResponse?: string;
  error?: string;
  fusionUsed?: boolean;
  callsUsed: number;
}

export interface QualityCouncilReport {
  enabled: true;
  mode: StoryCouncilMode;
  checkpoints: QualityCouncilCheckpointReport[];
  candidateDecisions: StoryCouncilCandidateDecision[];
  summary: {
    recommendedRepairRoutes: CouncilRepairRoute[];
    highConfidenceFindings: CouncilFinding[];
    advisoryFindings: CouncilFinding[];
    fusionUsed: boolean;
    callsUsed: number;
    estimatedTokensUsed: number;
    remediationsUsed: number;
    candidatesGenerated: number;
    candidatesQualified: number;
    synthesisUsed: boolean;
    infrastructureFailures: number;
  };
}

export type StoryCouncilCandidateStage = 'episode-blueprint';

export interface StoryCouncilCandidateQualification {
  passed: boolean;
  issueCodes: string[];
  issues: string[];
  protectedFingerprints?: string[];
}

export interface StoryCouncilCandidateScoreVector {
  dramaticCausality: number;
  characterPressure: number;
  playerAgency: number;
  routeDifferentiation: number;
  setupPayoff: number;
  relationshipPacing: number;
  sceneEconomy: number;
  sourceFidelity: number;
}

export interface StoryCouncilCandidateEvaluation {
  candidateId: string;
  scores: StoryCouncilCandidateScoreVector;
  strengths: string[];
  risks: string[];
}

export interface StoryCouncilCandidateComparison {
  summary: string;
  winnerId: string;
  complementaryMerits: boolean;
  evaluations: StoryCouncilCandidateEvaluation[];
}

export interface StoryCouncilCandidateRecord {
  candidateId: string;
  authorSeat: string;
  status: 'generated' | 'failed' | 'disqualified' | 'qualified';
  qualification?: StoryCouncilCandidateQualification;
  usage?: { inputTokens: number; outputTokens: number; thoughtsTokens?: number };
  error?: string;
  synthesisOf?: string[];
}

export interface StoryCouncilCandidateDecision {
  version: 1;
  stage: StoryCouncilCandidateStage;
  scope?: { episodeNumber?: number };
  mode: StoryCouncilMode;
  selectedCandidateId?: string;
  baselineCandidateId?: string;
  shadowWinnerId?: string;
  synthesisUsed: boolean;
  candidates: StoryCouncilCandidateRecord[];
  comparison?: StoryCouncilCandidateComparison;
  infrastructureErrors: string[];
}

export interface StoryCouncilCandidateArtifactSet {
  version: 1;
  stage: StoryCouncilCandidateStage;
  scope?: { episodeNumber?: number };
  candidates: Array<{
    candidateId: string;
    authorSeat: string;
    kind: 'candidate' | 'synthesis';
    artifact: unknown;
  }>;
}

export interface CouncilAgentOutput {
  summary: string;
  findings: CouncilFinding[];
}

export const COUNCIL_CATEGORIES: readonly CouncilCategory[] = [
  'story-circle-spine',
  'dramatic-structure',
  'scene-coherence',
  'choice-agency',
  'branch-residue',
  'character-relationship',
  'fiction-first-mechanics',
  'encounter-quality',
  'treatment-fidelity',
] as const;

export const COUNCIL_REPAIR_ROUTES: readonly CouncilRepairRoute[] = [
  'plan-time',
  'regen-scene',
  'regen-choices',
  'regen-episode',
  'none',
] as const;

export function summarizeCouncilReport(
  mode: StoryCouncilMode,
  checkpoints: QualityCouncilCheckpointReport[],
  candidateDecisions: StoryCouncilCandidateDecision[] = [],
  usage?: { callsUsed?: number; estimatedTokensUsed?: number; remediationsUsed?: number },
): QualityCouncilReport {
  const findings = checkpoints.flatMap((checkpoint) => checkpoint.findings);
  const highConfidenceFindings = findings.filter((finding) => finding.confidence === 'high' && finding.severity !== 'info');
  const advisoryFindings = findings.filter((finding) => finding.confidence !== 'high' || finding.severity === 'info');
  return {
    enabled: true,
    mode,
    checkpoints,
    candidateDecisions,
    summary: {
      recommendedRepairRoutes: Array.from(new Set(
        highConfidenceFindings
          .map((finding) => finding.repairRoute)
          .filter((route): route is CouncilRepairRoute => route !== 'none'),
      )),
      highConfidenceFindings,
      advisoryFindings,
      fusionUsed: checkpoints.some((checkpoint) => checkpoint.fusionUsed),
      callsUsed: usage?.callsUsed ?? checkpoints.reduce((sum, checkpoint) => sum + checkpoint.callsUsed, 0),
      estimatedTokensUsed: usage?.estimatedTokensUsed ?? 0,
      remediationsUsed: usage?.remediationsUsed ?? 0,
      candidatesGenerated: candidateDecisions.reduce((sum, decision) => sum + decision.candidates.length, 0),
      candidatesQualified: candidateDecisions.reduce(
        (sum, decision) => sum + decision.candidates.filter((candidate) => candidate.status === 'qualified').length,
        0,
      ),
      synthesisUsed: candidateDecisions.some((decision) => decision.synthesisUsed),
      infrastructureFailures: candidateDecisions.reduce(
        (sum, decision) => sum
          + decision.infrastructureErrors.length
          + decision.candidates.filter((candidate) => candidate.status === 'failed').length,
        checkpoints.filter((checkpoint) => checkpoint.status === 'error').length,
      ),
    },
  };
}
