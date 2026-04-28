/**
 * VisualQualityJudge
 *
 * Single dispatch point for the image-team's LLM-based validators. Every
 * existing validator (composition, consistency, pose diversity, transitions,
 * expressions, body language, lighting/color, visual storytelling) becomes
 * a `VisualCheck` that this judge runs. The judge merges the results into a
 * unified `VisualQualityReport` with explicit precedence so callers stop
 * having to stitch nine independent validator outputs together.
 *
 * Status: scaffolded (this file + `visualChecks/` wrappers). The underlying
 * validators are unchanged and still callable directly; migration wraps them
 * as `VisualCheck`s first, then simplifies once every caller uses the judge.
 */

export type VisualCheckSeverity = 'error' | 'warning' | 'info';

export interface VisualCheckIssue {
  checkId: string;
  severity: VisualCheckSeverity;
  message: string;
  code?: string;
  details?: Record<string, unknown>;
}

export interface VisualCheckResult<TOutput = unknown> {
  checkId: string;
  severity: VisualCheckSeverity;
  passed: boolean;
  /** 0–100 quality score. Not every check emits one. */
  score?: number;
  issues: VisualCheckIssue[];
  /** Raw payload from the underlying validator, keyed by check id. */
  output?: TOutput;
  error?: Error;
}

/**
 * A single image-quality check. Implementations wrap one existing validator.
 */
export interface VisualCheck<TInput = unknown, TOutput = unknown> {
  readonly id: string;
  readonly severity: VisualCheckSeverity;
  readonly description: string;
  run(input: TInput, ctx: VisualCheckContext): Promise<VisualCheckResult<TOutput>>;
}

export interface VisualCheckContext {
  /** Story id for telemetry. */
  storyId?: string;
  /** Scene id for telemetry. */
  sceneId?: string;
  /** Soft budget in ms. Checks should back off if they exceed it. */
  timeBudgetMs?: number;
  /** Logger hook. */
  log?: (message: string, meta?: Record<string, unknown>) => void;
}

export interface VisualQualityReport {
  passed: boolean;
  /** Overall severity — worst severity across all failing checks. */
  severity: VisualCheckSeverity;
  /** Average score across checks that returned one (0–100). */
  averageScore?: number;
  results: VisualCheckResult[];
  issues: VisualCheckIssue[];
  /** Subset of issues considered blocking. */
  blockingIssues: VisualCheckIssue[];
}

export interface VisualQualityJudgeOptions {
  /**
   * Severity floor below which issues are reported but not considered
   * blocking. Defaults to `'error'` — i.e. only errors block.
   */
  blockingSeverity?: VisualCheckSeverity;
  /** If true, a single failure short-circuits the remaining checks. */
  failFast?: boolean;
}

const SEVERITY_RANK: Record<VisualCheckSeverity, number> = {
  info: 0,
  warning: 1,
  error: 2,
};

function worstSeverity(
  severities: VisualCheckSeverity[]
): VisualCheckSeverity {
  return severities.reduce<VisualCheckSeverity>(
    (worst, next) => (SEVERITY_RANK[next] > SEVERITY_RANK[worst] ? next : worst),
    'info'
  );
}

/**
 * Runs a list of `VisualCheck`s and merges their outputs into a single
 * `VisualQualityReport`. Checks that throw are captured as an `error`
 * result rather than propagating — the judge is intended to be best-effort.
 */
export class VisualQualityJudge {
  constructor(private readonly options: VisualQualityJudgeOptions = {}) {}

  async run<TInput>(
    checks: Array<VisualCheck<TInput>>,
    input: TInput,
    ctx: VisualCheckContext = {}
  ): Promise<VisualQualityReport> {
    const blockingSeverity = this.options.blockingSeverity ?? 'error';
    const results: VisualCheckResult[] = [];
    const issues: VisualCheckIssue[] = [];

    if (this.options.failFast) {
      for (const check of checks) {
        const result = await this.runOne(check, input, ctx);
        results.push(result);
        issues.push(...result.issues);
        if (!result.passed && SEVERITY_RANK[result.severity] >= SEVERITY_RANK[blockingSeverity]) {
          break;
        }
      }
    } else {
      const settled = await Promise.all(checks.map((c) => this.runOne(c, input, ctx)));
      for (const r of settled) {
        results.push(r);
        issues.push(...r.issues);
      }
    }

    const blockingIssues = issues.filter(
      (i) => SEVERITY_RANK[i.severity] >= SEVERITY_RANK[blockingSeverity]
    );
    const passed = blockingIssues.length === 0;
    const severity = worstSeverity(issues.map((i) => i.severity));
    const scored = results.map((r) => r.score).filter((s): s is number => typeof s === 'number');
    const averageScore = scored.length
      ? Math.round(scored.reduce((a, b) => a + b, 0) / scored.length)
      : undefined;

    return { passed, severity, averageScore, results, issues, blockingIssues };
  }

  private async runOne<TInput>(
    check: VisualCheck<TInput>,
    input: TInput,
    ctx: VisualCheckContext
  ): Promise<VisualCheckResult> {
    try {
      return await check.run(input, ctx);
    } catch (raw) {
      const err = raw instanceof Error ? raw : new Error(String(raw));
      return {
        checkId: check.id,
        severity: check.severity,
        passed: false,
        issues: [
          {
            checkId: check.id,
            severity: check.severity,
            message: `Check "${check.id}" threw: ${err.message}`,
            code: 'check_threw',
          },
        ],
        error: err,
      };
    }
  }
}

export const visualCheckSeverityRank = SEVERITY_RANK;
