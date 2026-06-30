import type { AgentConfig, PipelineConfig, QualityCouncilConfig } from '../config';
import {
  ChoiceCouncilAgent,
  FinalCouncilAgent,
  PlanCouncilAgent,
  QualityCouncilAgentInput,
  RoutePlaytestCouncilAgent,
} from './QualityCouncilAgents';
import {
  QualityCouncilCheckpointReport,
  QualityCouncilReport,
  summarizeCouncilReport,
} from './types';

type Emit = (event: any) => void;

export interface QualityCouncilRunnerDeps {
  config: PipelineConfig;
  emit?: Emit;
}

export class QualityCouncilRunner {
  private readonly cfg: QualityCouncilConfig;
  private readonly emit?: Emit;
  private readonly reports: QualityCouncilCheckpointReport[] = [];
  private callsUsed = 0;
  private planAgent?: PlanCouncilAgent;
  private choiceAgent?: ChoiceCouncilAgent;
  private playtestAgent?: RoutePlaytestCouncilAgent;
  private finalAgent?: FinalCouncilAgent;
  private fusionAgent?: FinalCouncilAgent;

  constructor(deps: QualityCouncilRunnerDeps) {
    if (!deps.config.qualityCouncil?.enabled) {
      throw new Error('QualityCouncilRunner must only be constructed when qualityCouncil.enabled is true.');
    }
    this.cfg = deps.config.qualityCouncil;
    this.emit = deps.emit;
    const agents = deps.config.agents;
    this.planAgent = maybe(agents.qualityCouncilPlan, (config) => new PlanCouncilAgent(config));
    this.choiceAgent = maybe(agents.qualityCouncilChoice, (config) => new ChoiceCouncilAgent(config));
    this.playtestAgent = maybe(agents.qualityCouncilPlaytest, (config) => new RoutePlaytestCouncilAgent(config));
    this.finalAgent = maybe(agents.qualityCouncilFinal, (config) => new FinalCouncilAgent(config));
    this.fusionAgent = maybe(agents.qualityCouncilFusion, (config) => new FinalCouncilAgent({
      ...config,
      provider: 'openrouter',
      model: this.cfg.fusion?.model || config.model || 'openrouter/fusion',
      openRouter: {
        ...(config.openRouter || {}),
        route: 'fusion',
      },
    }));
  }

  getReport(): QualityCouncilReport | undefined {
    if (this.reports.length === 0) return undefined;
    return summarizeCouncilReport(this.cfg.mode, this.reports);
  }

  getStrictBlockingFindings(): QualityCouncilReport['summary']['highConfidenceFindings'] {
    if (this.cfg.mode !== 'strict') return [];
    return (this.getReport()?.summary.highConfidenceFindings || []).filter((finding) =>
      finding.severity === 'error' && !!finding.validatorMapping
    );
  }

  async runPlan(input: QualityCouncilAgentInput): Promise<void> {
    if (!this.cfg.runPlanCouncil) return this.recordSkipped('plan', 'Plan council disabled by config.');
    await this.runAgent('plan', this.planAgent, input);
  }

  async runChoice(input: QualityCouncilAgentInput): Promise<void> {
    if (!this.cfg.runChoiceCouncil) return this.recordSkipped('choice', 'Choice council disabled by config.');
    await this.runAgent('choice', this.choiceAgent, {
      ...input,
      choiceSets: limitArray(input.choiceSets, this.cfg.maxCandidateChoiceSets),
    });
  }

  async runRoutePlaytest(input: QualityCouncilAgentInput): Promise<void> {
    if (!this.cfg.runRoutePlaytestCouncil) return this.recordSkipped('route-playtest', 'Route playtest council disabled by config.');
    await this.runAgent('route-playtest', this.playtestAgent, input);
  }

  async runFinal(input: QualityCouncilAgentInput): Promise<void> {
    if (!this.cfg.runFinalCouncil) return this.recordSkipped('final', 'Final council disabled by config.');
    await this.runAgent('final', this.finalAgent, input);
    if (this.shouldRunFusion(input)) {
      await this.runAgent('final', this.fusionAgent, {
        ...input,
        notes: 'OpenRouter Fusion deep audit. Normalize output to the same Quality Council schema.',
      }, true);
    }
  }

  private async runAgent(
    checkpoint: QualityCouncilCheckpointReport['checkpoint'],
    agent: { review(input: QualityCouncilAgentInput): Promise<{ success: boolean; data?: { summary: string; findings: any[] }; rawResponse?: string; error?: string; metadata?: Record<string, unknown> }> } | undefined,
    input: QualityCouncilAgentInput,
    fusionUsed = false,
  ): Promise<void> {
    if (!agent) return this.recordSkipped(checkpoint, `No ${checkpoint} council agent configured.`);
    if (this.callsUsed >= this.cfg.maxCouncilCallsPerRun) {
      return this.recordSkipped(checkpoint, `Quality Council call budget exhausted (${this.cfg.maxCouncilCallsPerRun}).`);
    }
    this.callsUsed += 1;
    this.emit?.({ type: 'debug', phase: 'quality_council', message: `Quality Council ${checkpoint}${fusionUsed ? ' Fusion' : ''} review started.` });
    const result = await agent.review(input);
    const findings = result.data?.findings || [];
    const diagnostics = result.metadata?.councilParseDiagnostics as {
      parseStatus?: 'ok' | 'recovered' | 'raw_findings_dropped' | 'error';
      parseError?: string;
      rawFindingCountEstimate?: number;
      droppedFindingCount?: number;
    } | undefined;
    const parserFailedClosed = result.success
      && findings.length === 0
      && (diagnostics?.parseStatus === 'raw_findings_dropped' || diagnostics?.parseStatus === 'error');
    this.reports.push({
      checkpoint,
      status: parserFailedClosed ? 'error' : result.success ? (findings.length > 0 ? 'findings' : 'passed') : 'error',
      summary: result.data?.summary || result.error || 'Quality Council review completed.',
      findings,
      parseStatus: diagnostics?.parseStatus,
      parseError: diagnostics?.parseError,
      rawFindingCountEstimate: diagnostics?.rawFindingCountEstimate,
      droppedFindingCount: diagnostics?.droppedFindingCount,
      rawResponse: result.rawResponse,
      error: parserFailedClosed ? diagnostics?.parseError : result.error,
      fusionUsed,
      callsUsed: 1,
    });
    this.emit?.({
      type: result.success ? 'debug' : 'warning',
      phase: 'quality_council',
      message: `Quality Council ${checkpoint}${fusionUsed ? ' Fusion' : ''} review ${result.success ? 'completed' : 'failed'} with ${findings.length} finding(s).`,
    });
  }

  private recordSkipped(checkpoint: QualityCouncilCheckpointReport['checkpoint'], summary: string): void {
    this.reports.push({
      checkpoint,
      status: 'skipped',
      summary,
      findings: [],
      callsUsed: 0,
    });
  }

  private shouldRunFusion(input: QualityCouncilAgentInput): boolean {
    if (!this.cfg.fusion?.enabled || !this.fusionAgent) return false;
    const onlyWhen = this.cfg.fusion.onlyWhen;
    if (onlyWhen === 'manual') return false;
    if (onlyWhen === 'always-final') return true;
    if (onlyWhen === 'borderline-quality') {
      const score = input.qualityScore;
      return typeof score !== 'number' || score < (this.cfg.minQualityScoreForFinalSkip ?? 85);
    }
    if (onlyWhen === 'validator-disagreement') {
      const contract = input.finalStoryContractReport as { passed?: boolean } | undefined;
      const bestPractices = input.bestPracticesReport as { overallPassed?: boolean } | undefined;
      return typeof contract?.passed === 'boolean' && typeof bestPractices?.overallPassed === 'boolean'
        ? contract.passed !== bestPractices.overallPassed
        : false;
    }
    return false;
  }
}

function maybe<T>(config: AgentConfig | undefined, factory: (config: AgentConfig) => T): T | undefined {
  return config ? factory(config) : undefined;
}

function limitArray(value: unknown, limit: number): unknown {
  if (!Array.isArray(value)) return value;
  return value.slice(0, Math.max(1, limit));
}
