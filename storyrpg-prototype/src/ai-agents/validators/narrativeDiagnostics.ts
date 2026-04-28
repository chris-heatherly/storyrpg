import type { IdentityProfile, ThreadLedger, NarrativeThread, Episode } from '../../types';
import type { SceneContent } from '../agents/SceneWriter';
import type { TwistPlan } from '../agents/TwistArchitect';
import type { CharacterArcTargets } from '../agents/CharacterArcTracker';
import type { SerializedCallbackLedger } from '../pipeline/callbackLedger';
import type { ValidationIssue as BaseValidationIssue, ValidationResult } from './BaseValidator';
import type { ValidationIssue as ReportValidationIssue } from '../../types/validation';
import { SetupPayoffValidator } from './SetupPayoffValidator';
import { TwistQualityValidator } from './TwistQualityValidator';
import { ArcDeltaValidator } from './ArcDeltaValidator';
import { DivergenceValidator } from './DivergenceValidator';
import { CallbackCoverageValidator } from './CallbackCoverageValidator';

export type NarrativeDiagnosticStatus = 'passed' | 'warning' | 'failed' | 'skipped';

export interface NarrativeDiagnosticIssue {
  severity: 'error' | 'warning' | 'info' | 'suggestion';
  message: string;
  location?: string | object;
  suggestion?: string;
}

export interface NarrativeDiagnosticCheck {
  name: 'setup_payoff' | 'twist_quality' | 'arc_delta' | 'divergence' | 'callback_coverage';
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
}

export function runNarrativeDiagnostics(input: NarrativeDiagnosticsInput): NarrativeDiagnosticsReport {
  const checks: NarrativeDiagnosticCheck[] = [];
  const sceneContents = input.sceneContents ?? [];

  const threadLedger = input.threadLedger ?? deriveObservedThreadLedger(sceneContents);
  if (threadLedger && sceneContents.length > 0) {
    checks.push(fromBaseResult(
      'setup_payoff',
      new SetupPayoffValidator().validate({
        ledger: threadLedger,
        sceneContents,
        currentEpisode: input.episodeNumber,
      }),
    ));
  } else {
    checks.push(skipped('setup_payoff', 'No ThreadPlanner ledger or beat-level thread markers were available.'));
  }

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

  if (input.episode) {
    checks.push(fromBaseResult(
      'divergence',
      new DivergenceValidator().validate({ episode: input.episode }),
    ));
  } else {
    checks.push(skipped('divergence', 'Episode assembly had not completed yet.'));
  }

  if (input.callbackLedger && input.episodeNumber !== undefined) {
    checks.push(fromReportResult(
      'callback_coverage',
      new CallbackCoverageValidator().validate({
        ledger: input.callbackLedger,
        currentEpisode: input.episodeNumber,
        totalEpisodes: input.totalEpisodes ?? input.episodeNumber,
      }),
    ));
  } else {
    checks.push(skipped('callback_coverage', 'No serialized CallbackLedger was available.'));
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

function fromBaseIssue(issue: BaseValidationIssue): NarrativeDiagnosticIssue {
  return {
    severity: issue.severity,
    message: issue.message,
    location: issue.location,
    suggestion: issue.suggestion,
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

function deriveObservedThreadLedger(sceneContents: SceneContent[]): ThreadLedger | undefined {
  const byId = new Map<string, NarrativeThread>();

  for (const scene of sceneContents) {
    for (const beat of scene.beats ?? []) {
      const anyBeat = beat as unknown as {
        id?: string;
        plantsThreadId?: string;
        paysOffThreadId?: string;
      };
      if (anyBeat.plantsThreadId) {
        const thread = ensureObservedThread(byId, anyBeat.plantsThreadId);
        thread.plants.push({ sceneId: scene.sceneId, beatId: anyBeat.id ?? `${scene.sceneId}:unknown` });
      }
      if (anyBeat.paysOffThreadId) {
        const thread = ensureObservedThread(byId, anyBeat.paysOffThreadId);
        thread.payoffs.push({ sceneId: scene.sceneId, beatId: anyBeat.id ?? `${scene.sceneId}:unknown` });
      }
    }
  }

  if (byId.size === 0) return undefined;
  return {
    threads: Array.from(byId.values()),
    designNotes: 'Derived from generated beat thread markers because no ThreadPlanner ledger was supplied.',
  };
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
