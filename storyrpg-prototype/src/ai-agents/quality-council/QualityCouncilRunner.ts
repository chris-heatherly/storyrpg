import type { AgentConfig, PipelineConfig, StoryCouncilConfig } from '../config';
import type { AgentResponse } from '../agents/BaseAgent';
import {
  CandidateComparisonAgent,
  ChoiceCouncilAgent,
  FinalCouncilAgent,
  PlanCouncilAgent,
  QualityCouncilAgentInput,
  RoutePlaytestCouncilAgent,
} from './QualityCouncilAgents';
import {
  QualityCouncilCheckpointReport,
  QualityCouncilReport,
  StoryCouncilCandidateDecision,
  StoryCouncilCandidateArtifactSet,
  StoryCouncilCandidateQualification,
  StoryCouncilCandidateScoreVector,
  summarizeCouncilReport,
} from './types';

type Emit = (event: any) => void;

export interface StoryCouncilRunnerDeps {
  config: PipelineConfig;
  emit?: Emit;
}

/** @deprecated Use StoryCouncilRunnerDeps. */
export type QualityCouncilRunnerDeps = StoryCouncilRunnerDeps;

export interface StoryCouncilCandidateProducerContext<T = unknown> {
  candidateId: string;
  authorSeat: string;
  directive: string;
  kind: 'candidate' | 'synthesis';
  synthesisOf?: string[];
  sourceArtifacts?: Array<{ candidateId: string; artifact: T | unknown }>;
}

export interface StoryCouncilCandidateTournamentInput<T> {
  stage: 'episode-blueprint';
  scope?: { episodeNumber?: number };
  lockedContext: unknown;
  produce: (context: StoryCouncilCandidateProducerContext<T>) => Promise<AgentResponse<T>>;
  qualify: (candidate: T) => StoryCouncilCandidateQualification | Promise<StoryCouncilCandidateQualification>;
  artifactForJudge?: (candidate: T) => unknown;
}

export interface StoryCouncilCandidateTournamentResult<T> {
  response: AgentResponse<T>;
  decision: StoryCouncilCandidateDecision;
}

export class StoryCouncilRunner {
  private readonly cfg: StoryCouncilConfig;
  private readonly emit?: Emit;
  private readonly reports: QualityCouncilCheckpointReport[] = [];
  private readonly candidateDecisions: StoryCouncilCandidateDecision[] = [];
  private readonly candidateArtifactSets: StoryCouncilCandidateArtifactSet[] = [];
  private callsUsed = 0;
  private estimatedTokensUsed = 0;
  private remediationsUsed = 0;
  private planAgent?: PlanCouncilAgent;
  private choiceAgent?: ChoiceCouncilAgent;
  private playtestAgent?: RoutePlaytestCouncilAgent;
  private finalAgent?: FinalCouncilAgent;
  private fusionAgent?: FinalCouncilAgent;
  private candidateJudge?: CandidateComparisonAgent;

  constructor(deps: StoryCouncilRunnerDeps) {
    const councilConfig = deps.config.storyCouncil ?? deps.config.qualityCouncil;
    if (!councilConfig?.enabled) {
      throw new Error('StoryCouncilRunner must only be constructed when storyCouncil.enabled is true.');
    }
    this.cfg = councilConfig;
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
    this.candidateJudge = maybe(agents.qualityCouncilFinal ?? agents.qualityCouncilPlan, (config) => new CandidateComparisonAgent(config));
  }

  getReport(): QualityCouncilReport | undefined {
    if (this.reports.length === 0 && this.candidateDecisions.length === 0) return undefined;
    return summarizeCouncilReport(this.cfg.mode, this.reports, this.candidateDecisions, {
      callsUsed: this.callsUsed,
      estimatedTokensUsed: this.estimatedTokensUsed,
      remediationsUsed: this.remediationsUsed,
    });
  }

  getStrictBlockingFindings(): QualityCouncilReport['summary']['highConfidenceFindings'] {
    // Story Council findings never acquire validator authority. Canonical
    // validators must independently reproduce a defect before it can block.
    return [];
  }

  getCandidateDecision(scope: { episodeNumber?: number }): StoryCouncilCandidateDecision | undefined {
    for (let index = this.candidateDecisions.length - 1; index >= 0; index -= 1) {
      if (this.candidateDecisions[index].scope?.episodeNumber === scope.episodeNumber) return this.candidateDecisions[index];
    }
    return undefined;
  }

  getCandidateArtifactSet(scope: { episodeNumber?: number }): StoryCouncilCandidateArtifactSet | undefined {
    for (let index = this.candidateArtifactSets.length - 1; index >= 0; index -= 1) {
      if (this.candidateArtifactSets[index].scope?.episodeNumber === scope.episodeNumber) return this.candidateArtifactSets[index];
    }
    return undefined;
  }

  async runEpisodeBlueprintTournament<T>(
    input: StoryCouncilCandidateTournamentInput<T>,
  ): Promise<StoryCouncilCandidateTournamentResult<T>> {
    const candidateCount = Math.max(2, Math.min(4, this.cfg.candidateCount));
    const directives = [
      'Create the strongest canon-safe baseline. Favor clear causal turns and executable scene ownership.',
      'Independently optimize dramatic causality, escalating pressure, and setup/payoff without changing locked topology.',
      'Independently optimize player agency, route-visible consequences, and meaningful decision pressure without changing locked topology.',
      'Independently optimize character pressure, relationship pacing, and scene economy without changing locked topology.',
    ];
    const scopePrefix = input.scope?.episodeNumber ? `episode-${input.scope.episodeNumber}-` : '';
    const contexts = Array.from({ length: candidateCount }, (_, index): StoryCouncilCandidateProducerContext<T> => ({
      candidateId: `${scopePrefix}candidate-${index + 1}`,
      authorSeat: `planning-seat-${index + 1}`,
      directive: directives[index],
      kind: 'candidate',
    }));
    this.emit?.({
      type: 'debug', phase: 'story_council',
      message: `Story Council ${input.stage} candidate swarm started (${candidateCount} candidates).`,
    });

    const produced = await this.mapWithConcurrency(
      contexts,
      Math.max(1, Math.min(this.cfg.maxConcurrentCandidates, candidateCount)),
      async (context) => {
        if (!this.reserveCall()) {
          return { context, response: { success: false, error: 'Story Council call or token budget exhausted.' } as AgentResponse<T> };
        }
        let response: AgentResponse<T>;
        try {
          response = await input.produce(context);
        } catch (error) {
          response = { success: false, error: error instanceof Error ? error.message : String(error) };
        }
        this.recordUsage(response);
        return { context, response };
      },
    );

    const decision: StoryCouncilCandidateDecision = {
      version: 1,
      stage: input.stage,
      scope: input.scope,
      mode: this.cfg.mode,
      baselineCandidateId: contexts[0].candidateId,
      synthesisUsed: false,
      candidates: [],
      infrastructureErrors: [],
    };
    const eligible: Array<{ context: StoryCouncilCandidateProducerContext<T>; response: AgentResponse<T> }> = [];
    for (const item of produced) {
      if (!item.response.success || !item.response.data) {
        decision.candidates.push({
          candidateId: item.context.candidateId,
          authorSeat: item.context.authorSeat,
          status: 'failed',
          error: item.response.error || 'Candidate author returned no artifact.',
          usage: item.response.usage,
        });
        continue;
      }
      let qualification: StoryCouncilCandidateQualification;
      try {
        qualification = await input.qualify(item.response.data);
      } catch (error) {
        qualification = {
          passed: false,
          issueCodes: ['story_council_qualification_error'],
          issues: [error instanceof Error ? error.message : String(error)],
        };
      }
      decision.candidates.push({
        candidateId: item.context.candidateId,
        authorSeat: item.context.authorSeat,
        status: qualification.passed ? 'qualified' : 'disqualified',
        qualification,
        usage: item.response.usage,
      });
      if (qualification.passed) eligible.push(item);
    }

    const baseline = produced[0]?.response ?? { success: false, error: 'Story Council produced no baseline candidate.' };
    if (eligible.length === 0) {
      decision.infrastructureErrors.push('No Story Council candidate passed canonical qualification.');
      decision.selectedCandidateId = contexts[0].candidateId;
      this.commitCandidateEvidence(input, produced, decision);
      return { response: baseline, decision };
    }

    let comparison = await this.compareCandidates(input, eligible, decision);
    let selected = eligible.find((item) => item.context.candidateId === comparison?.winnerId) ?? eligible[0];
    decision.shadowWinnerId = selected.context.candidateId;
    decision.comparison = comparison;

    const shouldSynthesize = this.cfg.mode === 'select-and-repair'
      && this.cfg.councilRemediationBudget > 0
      && eligible.length > 1
      && this.cfg.synthesisPolicy !== 'never'
      && (this.cfg.synthesisPolicy === 'always' || comparison?.complementaryMerits === true);
    const synthesized: Array<{ context: StoryCouncilCandidateProducerContext<T>; response: AgentResponse<T> }> = [];
    if (shouldSynthesize && this.reserveRemediationCall()) {
      const topIds = comparison?.evaluations
        .slice()
        .sort((left, right) => averageScore(right.scores) - averageScore(left.scores))
        .slice(0, 2)
        .map((entry) => entry.candidateId) ?? eligible.slice(0, 2).map((entry) => entry.context.candidateId);
      const synthesisContext: StoryCouncilCandidateProducerContext<T> = {
        candidateId: `${scopePrefix}candidate-synthesis`,
        authorSeat: 'canonical-owner-synthesis',
        kind: 'synthesis',
        synthesisOf: topIds,
        sourceArtifacts: eligible
          .filter((item) => topIds.includes(item.context.candidateId))
          .map((item) => ({
            candidateId: item.context.candidateId,
            artifact: input.artifactForJudge?.(item.response.data!) ?? item.response.data,
          })),
        directive: buildSynthesisDirective(comparison, topIds),
      };
      let synthesisResponse: AgentResponse<T>;
      try {
        synthesisResponse = await input.produce(synthesisContext);
      } catch (error) {
        synthesisResponse = { success: false, error: error instanceof Error ? error.message : String(error) };
      }
      this.recordUsage(synthesisResponse);
      if (synthesisResponse.success && synthesisResponse.data) synthesized.push({ context: synthesisContext, response: synthesisResponse });
      if (synthesisResponse.success && synthesisResponse.data) {
        let qualification: StoryCouncilCandidateQualification;
        try {
          qualification = await input.qualify(synthesisResponse.data);
        } catch (error) {
          qualification = {
            passed: false,
            issueCodes: ['story_council_qualification_error'],
            issues: [error instanceof Error ? error.message : String(error)],
          };
        }
        decision.candidates.push({
          candidateId: synthesisContext.candidateId,
          authorSeat: synthesisContext.authorSeat,
          status: qualification.passed ? 'qualified' : 'disqualified',
          qualification,
          usage: synthesisResponse.usage,
          synthesisOf: topIds,
        });
        if (qualification.passed) {
          decision.synthesisUsed = true;
          const finalists = [...eligible.filter((item) => topIds.includes(item.context.candidateId)), {
            context: synthesisContext,
            response: synthesisResponse,
          }];
          const finalComparison = await this.compareCandidates(input, finalists, decision);
          if (finalComparison) {
            comparison = finalComparison;
            decision.comparison = finalComparison;
            selected = finalists.find((item) => item.context.candidateId === finalComparison.winnerId) ?? selected;
            decision.shadowWinnerId = selected.context.candidateId;
          }
        }
      } else {
        decision.candidates.push({
          candidateId: synthesisContext.candidateId,
          authorSeat: synthesisContext.authorSeat,
          status: 'failed',
          error: synthesisResponse.error || 'Synthesis author returned no artifact.',
          usage: synthesisResponse.usage,
          synthesisOf: topIds,
        });
      }
    }

    const selectedForRun = this.cfg.mode === 'shadow'
      ? produced[0]
      : selected;
    decision.selectedCandidateId = selectedForRun?.context.candidateId ?? selected.context.candidateId;
    this.commitCandidateEvidence(input, produced, decision, synthesized);
    this.emit?.({
      type: 'debug', phase: 'story_council',
      message: `Story Council ${input.stage} ${this.cfg.mode === 'shadow' ? 'shadow winner' : 'selected'} ${decision.selectedCandidateId}.`,
    });
    return { response: selectedForRun?.response ?? selected.response, decision };
  }

  private commitCandidateEvidence<T>(
    input: StoryCouncilCandidateTournamentInput<T>,
    produced: Array<{ context: StoryCouncilCandidateProducerContext<T>; response: AgentResponse<T> }>,
    additional: StoryCouncilCandidateDecision,
    synthesized: Array<{ context: StoryCouncilCandidateProducerContext<T>; response: AgentResponse<T> }> = [],
  ): void {
    this.candidateDecisions.push(additional);
    this.candidateArtifactSets.push({
      version: 1,
      stage: input.stage,
      scope: input.scope,
      candidates: [...produced, ...synthesized]
        .filter((item): item is typeof item & { response: AgentResponse<T> & { data: T } } => Boolean(item.response.data))
        .map((item) => ({
          candidateId: item.context.candidateId,
          authorSeat: item.context.authorSeat,
          kind: item.context.kind,
          artifact: item.response.data,
        })),
    });
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
        notes: 'OpenRouter Fusion deep holdout audit. Normalize output to the same Story Council schema.',
      }, true);
    }
  }

  private async compareCandidates<T>(
    input: StoryCouncilCandidateTournamentInput<T>,
    candidates: Array<{ context: StoryCouncilCandidateProducerContext<T>; response: AgentResponse<T> }>,
    decision: StoryCouncilCandidateDecision,
  ) {
    if (candidates.length === 1) return undefined;
    if (!this.candidateJudge || !this.reserveCall()) {
      decision.infrastructureErrors.push('Candidate judge unavailable or Story Council budget exhausted.');
      return undefined;
    }
    const result = await this.candidateJudge.compare({
      stage: input.stage,
      lockedContext: input.lockedContext,
      candidates: candidates.map((candidate) => ({
        candidateId: candidate.context.candidateId,
        artifact: input.artifactForJudge?.(candidate.response.data!) ?? candidate.response.data,
      })),
    });
    this.recordUsage(result);
    if (!result.success || !result.data) {
      decision.infrastructureErrors.push(result.error || 'Candidate judge returned no comparison.');
      return undefined;
    }
    return result.data;
  }

  private reserveCall(): boolean {
    if (this.callsUsed >= this.cfg.maxCouncilCallsPerRun) return false;
    if (this.estimatedTokensUsed >= this.cfg.councilTokenBudget) return false;
    this.callsUsed += 1;
    return true;
  }

  private reserveRemediationCall(): boolean {
    if (this.remediationsUsed >= this.cfg.councilRemediationBudget) return false;
    if (!this.reserveCall()) return false;
    this.remediationsUsed += 1;
    return true;
  }

  private recordUsage(response: AgentResponse<unknown>): void {
    if (response.usage) {
      this.estimatedTokensUsed += response.usage.inputTokens + response.usage.outputTokens + (response.usage.thoughtsTokens ?? 0);
      return;
    }
    if (response.rawResponse) this.estimatedTokensUsed += Math.ceil(response.rawResponse.length / 4);
  }

  private async mapWithConcurrency<T, R>(
    values: T[],
    concurrency: number,
    fn: (value: T) => Promise<R>,
  ): Promise<R[]> {
    const results = new Array<R>(values.length);
    let cursor = 0;
    const workers = Array.from({ length: Math.min(concurrency, values.length) }, async () => {
      while (cursor < values.length) {
        const index = cursor;
        cursor += 1;
        results[index] = await fn(values[index]);
      }
    });
    await Promise.all(workers);
    return results;
  }

  private async runAgent(
    checkpoint: QualityCouncilCheckpointReport['checkpoint'],
    agent: { review(input: QualityCouncilAgentInput): Promise<{ success: boolean; data?: { summary: string; findings: any[] }; rawResponse?: string; error?: string; metadata?: Record<string, unknown> }> } | undefined,
    input: QualityCouncilAgentInput,
    fusionUsed = false,
  ): Promise<void> {
    if (!agent) return this.recordSkipped(checkpoint, `No ${checkpoint} council agent configured.`);
    if (!this.reserveCall()) {
      return this.recordSkipped(checkpoint, `Story Council call budget exhausted (${this.cfg.maxCouncilCallsPerRun}).`);
    }
    this.emit?.({ type: 'debug', phase: 'story_council', message: `Story Council ${checkpoint}${fusionUsed ? ' Fusion' : ''} holdout started.` });
    const result = await agent.review(input);
    this.recordUsage(result);
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
      summary: result.data?.summary || result.error || 'Story Council holdout completed.',
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
      phase: 'story_council',
      message: `Story Council ${checkpoint}${fusionUsed ? ' Fusion' : ''} holdout ${result.success ? 'completed' : 'failed'} with ${findings.length} finding(s).`,
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

/** @deprecated Import StoryCouncilRunner. */
export { StoryCouncilRunner as QualityCouncilRunner };

function maybe<T>(config: AgentConfig | undefined, factory: (config: AgentConfig) => T): T | undefined {
  return config ? factory(config) : undefined;
}

function limitArray(value: unknown, limit: number): unknown {
  if (!Array.isArray(value)) return value;
  return value.slice(0, Math.max(1, limit));
}

function averageScore(scores: StoryCouncilCandidateScoreVector): number {
  const values = Object.values(scores).filter((value) => Number.isFinite(value));
  return values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function buildSynthesisDirective(
  comparison: StoryCouncilCandidateDecision['comparison'],
  candidateIds: string[],
): string {
  const merits = comparison?.evaluations
    .filter((evaluation) => candidateIds.includes(evaluation.candidateId))
    .map((evaluation) => `${evaluation.candidateId}: strengths=${evaluation.strengths.join('; ')}; risks=${evaluation.risks.join('; ')}`)
    .join('\n');
  return [
    'Write one fresh, coherent blueprint that preserves the locked topology and canonical obligations.',
    `Use only portable merits from finalists ${candidateIds.join(', ')}; do not mechanically merge fields or add scenes.`,
    'Preserve all already-satisfied contracts. Resolve conflicts through causal re-authoring inside the existing scene shells.',
    merits ? `Blinded judge notes:\n${merits}` : '',
  ].filter(Boolean).join('\n');
}
