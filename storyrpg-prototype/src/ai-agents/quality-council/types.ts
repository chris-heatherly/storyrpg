import type { QualityCouncilMode } from '../config';

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
  mode: QualityCouncilMode;
  checkpoints: QualityCouncilCheckpointReport[];
  summary: {
    recommendedRepairRoutes: CouncilRepairRoute[];
    highConfidenceFindings: CouncilFinding[];
    advisoryFindings: CouncilFinding[];
    fusionUsed: boolean;
    callsUsed: number;
  };
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
  mode: QualityCouncilMode,
  checkpoints: QualityCouncilCheckpointReport[],
): QualityCouncilReport {
  const findings = checkpoints.flatMap((checkpoint) => checkpoint.findings);
  const highConfidenceFindings = findings.filter((finding) => finding.confidence === 'high' && finding.severity !== 'info');
  const advisoryFindings = findings.filter((finding) => finding.confidence !== 'high' || finding.severity === 'info');
  return {
    enabled: true,
    mode,
    checkpoints,
    summary: {
      recommendedRepairRoutes: Array.from(new Set(
        highConfidenceFindings
          .map((finding) => finding.repairRoute)
          .filter((route): route is CouncilRepairRoute => route !== 'none'),
      )),
      highConfidenceFindings,
      advisoryFindings,
      fusionUsed: checkpoints.some((checkpoint) => checkpoint.fusionUsed),
      callsUsed: checkpoints.reduce((sum, checkpoint) => sum + checkpoint.callsUsed, 0),
    },
  };
}
