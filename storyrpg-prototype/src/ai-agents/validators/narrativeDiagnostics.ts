import type { IdentityProfile, ThreadLedger, NarrativeThread, Episode } from '../../types';
import type { SceneContent } from '../agents/SceneWriter';
import type { TwistPlan } from '../agents/TwistArchitect';
import type { CharacterArcTargets } from '../agents/CharacterArcTracker';
import type { SerializedCallbackLedger } from '../pipeline/callbackLedger';
import type { ValidationIssue as BaseValidationIssue, ValidationResult } from './BaseValidator';
import type { ValidationIssue as ReportValidationIssue } from '../../types/validation';
import { TwistQualityValidator } from './TwistQualityValidator';
import { ArcDeltaValidator } from './ArcDeltaValidator';
import { DivergenceValidator } from './DivergenceValidator';
import { NarrativeFailureModeValidator } from './NarrativeFailureModeValidator';
import { IntensityDistributionValidator } from './IntensityDistributionValidator';
import { PropIntroductionValidator } from './PropIntroductionValidator';
import { ChoiceCoverageValidator } from './ChoiceCoverageValidator';
import { validatorsForLifecycle } from './validatorRegistry';

export type NarrativeDiagnosticStatus = 'passed' | 'warning' | 'failed' | 'skipped';

export interface NarrativeDiagnosticIssue {
  severity: 'error' | 'warning' | 'info' | 'suggestion';
  message: string;
  location?: string | object;
  suggestion?: string;
  code?: string;
  source?: string;
}

export interface NarrativeDiagnosticCheck {
  name:
    | 'setup_payoff'
    | 'twist_quality'
    | 'arc_delta'
    | 'divergence'
    | 'callback_coverage'
    | 'failure_modes'
    | 'intensity_distribution'
    | 'prop_introduction'
    | 'choice_coverage';
  status: NarrativeDiagnosticStatus;
  score?: number;
  advisory: boolean;
  skippedReason?: string;
  issues: NarrativeDiagnosticIssue[];
  suggestions: string[];
  metrics?: unknown;
}

export interface NarrativeDiagnosticsReport {
  version: 1;
  episodeNumber?: number;
  generatedAt: string;
  overallStatus: Exclude<NarrativeDiagnosticStatus, 'skipped'>;
  checks: NarrativeDiagnosticCheck[];
}

export interface NarrativeDiagnosticsInput {
  episodeNumber?: number;
  totalEpisodes?: number;
  sceneContents?: SceneContent[];
  episode?: Episode;
  threadLedger?: ThreadLedger;
  twistPlan?: TwistPlan;
  arcTargets?: CharacterArcTargets;
  callbackLedger?: SerializedCallbackLedger;
  startIdentity?: Partial<IdentityProfile>;
  endIdentity?: Partial<IdentityProfile>;
  relationshipDeltas?: Record<string, { trust?: number; respect?: number; bond?: number }>;
  baseIssues?: Array<{
    severity: 'error' | 'warning' | 'info';
    message: string;
    location?: string;
    suggestion?: string;
    source?: string;
  }>;
  /** #26C: all declared entity ids (cast bible + props) for the prop-introduction check. */
  knownEntityIds?: string[];
  /** D4: scene ids the blueprint planned with a choice point. */
  choicePlannedSceneIds?: string[];
  /** D4: scene ids that authored at least one choice. */
  choiceAuthoredSceneIds?: string[];
}

export function runNarrativeDiagnostics(input: NarrativeDiagnosticsInput): NarrativeDiagnosticsReport {
  const checks: NarrativeDiagnosticCheck[] = [];
  const sceneContents = input.sceneContents ?? [];

  for (const entry of validatorsForLifecycle('narrative-diagnostics')) {
    switch (entry.validator) {
      // setup_payoff + callback_coverage arms RETIRED (2026-07-03): zero
      // findings across all 202 archived runs, and the plan gates they fed
      // (GATE_SETUP_PAYOFF / GATE_CALLBACK_COVERAGE) now read the unified
      // ObligationLedgerValidator's kind-filtered findings directly.

      case 'TwistQualityValidator':
        if (sceneContents.length > 0) {
          checks.push(fromBaseResult(
            'twist_quality',
            new TwistQualityValidator().validate({
              sceneContents,
              twistPlan: input.twistPlan,
            }),
          ));
        } else {
          checks.push(skipped('twist_quality', 'No generated scene contents were available.'));
        }
        break;

      case 'ArcDeltaValidator':
        if (input.arcTargets) {
          checks.push(fromBaseResult(
            'arc_delta',
            new ArcDeltaValidator().validate({
              targets: input.arcTargets,
              startIdentity: input.startIdentity,
              endIdentity: input.endIdentity,
              relationshipDeltas: input.relationshipDeltas,
            }),
          ));
        } else {
          checks.push(skipped('arc_delta', 'No CharacterArcTracker targets were available.'));
        }
        break;

      case 'DivergenceValidator':
        if (input.episode) {
          checks.push(fromBaseResult(
            'divergence',
            new DivergenceValidator().validate({ episode: input.episode }),
          ));
        } else {
          checks.push(skipped('divergence', 'Episode assembly had not completed yet.'));
        }
        break;

      case 'NarrativeFailureModeValidator': {
        const mappedIssues = collectMappableIssues(checks, input.baseIssues ?? []);
        if (sceneContents.length > 0 || mappedIssues.length > 0) {
          checks.push(fromBaseResult(
            'failure_modes',
            new NarrativeFailureModeValidator().validate({
              sceneContents,
              baseIssues: mappedIssues,
            }),
          ));
        } else {
          checks.push(skipped('failure_modes', 'No scene contents or prior validation issues were available.'));
        }
        break;
      }

      case 'IntensityDistributionValidator':
        if (sceneContents.length > 0) {
          checks.push(fromBaseResult(
            'intensity_distribution',
            new IntensityDistributionValidator().validate({ sceneContents }),
          ));
        } else {
          checks.push(skipped('intensity_distribution', 'No generated scene contents were available.'));
        }
        break;

      case 'PropIntroductionValidator':
        if (input.knownEntityIds && input.knownEntityIds.length > 0 && sceneContents.length > 0) {
          checks.push(fromBaseResult(
            'prop_introduction',
            new PropIntroductionValidator().validate({
              knownEntityIds: input.knownEntityIds,
              sceneContents: sceneContents.map((sc) => ({
                sceneId: sc.sceneId,
                sceneName: sc.sceneName,
                referencedEntityIds: sc.charactersInvolved ?? [],
              })),
            }),
          ));
        } else {
          checks.push(skipped('prop_introduction', 'No declared entity set (cast/prop bible) was available.'));
        }
        break;

      case 'ChoiceCoverageValidator':
        if (input.choicePlannedSceneIds && input.choicePlannedSceneIds.length > 0) {
          checks.push(fromBaseResult(
            'choice_coverage',
            new ChoiceCoverageValidator().validate({
              plannedChoiceSceneIds: input.choicePlannedSceneIds,
              authoredChoiceSceneIds: input.choiceAuthoredSceneIds ?? [],
            }),
          ));
        } else {
          checks.push(skipped('choice_coverage', 'No blueprint choice-point plan was available.'));
        }
        break;
    }
  }

  const active = checks.filter((check) => check.status !== 'skipped');
  const overallStatus = active.some((check) => check.status === 'failed')
    ? 'failed'
    : active.some((check) => check.status === 'warning')
      ? 'warning'
      : 'passed';

  return {
    version: 1,
    episodeNumber: input.episodeNumber,
    generatedAt: new Date().toISOString(),
    overallStatus,
    checks,
  };
}

function skipped(name: NarrativeDiagnosticCheck['name'], skippedReason: string): NarrativeDiagnosticCheck {
  return {
    name,
    status: 'skipped',
    advisory: true,
    skippedReason,
    issues: [],
    suggestions: [],
  };
}

function fromBaseResult(name: NarrativeDiagnosticCheck['name'], result: ValidationResult & { metrics?: unknown }): NarrativeDiagnosticCheck {
  const status = result.issues.some((issue) => issue.severity === 'error')
    ? 'failed'
    : result.issues.some((issue) => issue.severity === 'warning')
      ? 'warning'
      : 'passed';

  return {
    name,
    status,
    score: result.score,
    advisory: true,
    issues: result.issues.map(fromBaseIssue),
    suggestions: result.suggestions ?? [],
    metrics: result.metrics,
  };
}

function fromReportResult(
  name: NarrativeDiagnosticCheck['name'],
  result: { passed: boolean; score: number; issues: ReportValidationIssue[]; metrics?: unknown },
): NarrativeDiagnosticCheck {
  const status = result.issues.some((issue) => issue.level === 'error')
    ? 'failed'
    : result.issues.some((issue) => issue.level === 'warning')
      ? 'warning'
      : 'passed';

  return {
    name,
    status,
    score: result.score,
    advisory: true,
    issues: result.issues.map(fromReportIssue),
    suggestions: result.issues.map((issue) => issue.suggestion).filter((s): s is string => Boolean(s)),
    metrics: result.metrics,
  };
}

function fromBaseIssue(issue: BaseValidationIssue & { code?: string; source?: string }): NarrativeDiagnosticIssue {
  return {
    severity: issue.severity,
    message: issue.message,
    location: issue.location,
    suggestion: issue.suggestion,
    code: issue.code,
    source: issue.source,
  };
}

function fromReportIssue(issue: ReportValidationIssue): NarrativeDiagnosticIssue {
  return {
    severity: issue.level === 'suggestion' ? 'suggestion' : issue.level,
    message: issue.message,
    location: issue.location,
    suggestion: issue.suggestion,
  };
}

function collectMappableIssues(
  checks: NarrativeDiagnosticCheck[],
  explicitIssues: NonNullable<NarrativeDiagnosticsInput['baseIssues']>,
): NonNullable<NarrativeDiagnosticsInput['baseIssues']> {
  return [
    ...explicitIssues,
    ...checks.flatMap((check) => check.issues.map((issue) => ({
      severity: issue.severity === 'suggestion' ? 'info' as const : issue.severity,
      message: issue.message,
      location: typeof issue.location === 'string' ? issue.location : undefined,
      suggestion: issue.suggestion,
      source: check.name,
    }))),
  ];
}

function ensureObservedThread(byId: Map<string, NarrativeThread>, id: string): NarrativeThread {
  const existing = byId.get(id);
  if (existing) return existing;
  const thread: NarrativeThread = {
    id,
    kind: 'seed',
    priority: 'minor',
    label: id,
    description: 'Observed generated thread marker.',
    plants: [],
    payoffs: [],
    status: 'planned',
  };
  byId.set(id, thread);
  return thread;
}
