/**
 * LLM judge confirmation for HEURISTIC fidelity findings (2026-06-11
 * failure-cycle audit, WS3).
 *
 * RequiredBeatRealizationValidator and SignatureDevicePresenceValidator detect
 * "the authored moment is missing from the prose" by keyword overlap — a
 * heuristic that misses paraphrase (the beat IS dramatized, in different
 * words) and then hard-aborts an entire generated season on the false
 * positive. Before such a finding counts as blocking, this module spends one
 * bounded LLM call asking the only question that matters: "here is the
 * authored moment; here is the scene's actual prose — is the moment
 * dramatized on-page?".
 *
 *   - Judge says DRAMATIZED → the finding was a false positive → downgraded
 *     to a warning (annotated, kept visible for audit).
 *   - Judge says missing, judge unavailable, or the call fails → the finding
 *     STAYS BLOCKING (conservative default) and flows to the scene-prose
 *     repair handler.
 *
 * This can only ever downgrade heuristic findings the judge affirmatively
 * refutes — it cannot create new blocks and it never touches deterministic
 * findings (navigation, template collapse, etc.).
 */

import { AgentConfig } from '../config';
import { AgentResponse, BaseAgent } from '../agents/BaseAgent';
import type { Story } from '../../types/story';
import { collectEncounterProseStrings } from './EncounterQualityValidator';
import { momentDepicted, requiredMomentFromMessage } from '../remediation/realizationScoring';

/** Heuristic validators whose blocking findings need judge confirmation. */
const JUDGE_CONFIRMABLE_VALIDATORS = new Set([
  'RequiredBeatRealizationValidator',
  'SignatureDevicePresenceValidator',
]);

/** Max findings judged per contract evaluation (one batched LLM call). */
const MAX_CLAIMS_PER_CALL = 10;
/** Per-scene prose cap fed to the judge (chars). */
const MAX_PROSE_CHARS = 6000;

export interface RealizationClaim {
  id: string;
  /** The authored moment the validator says is missing. */
  authoredMoment: string;
  /** The scene's actual player-facing prose. */
  prose: string;
  /** Validator that produced this claim. */
  validator?: string;
}

export interface RealizationVerdict {
  id: string;
  /** True when the judge finds the moment dramatized on-page. */
  dramatized: boolean;
  /** Short quote/evidence from the prose (when dramatized). */
  evidence?: string;
}

export class FidelityRealizationJudge extends BaseAgent {
  constructor(config: AgentConfig) {
    super('Fidelity Realization Judge', config);
    this.includeSystemPrompt = false;
  }

  protected getAgentSpecificPrompt(): string {
    return '';
  }

  async execute(claims: RealizationClaim[]): Promise<AgentResponse<{ verdicts: RealizationVerdict[] }>> {
    const prompt = this.buildPrompt(claims);
    try {
      const response = await this.callLLM([{ role: 'user', content: prompt }]);
      const parsed = this.parseJSON<{ verdicts: RealizationVerdict[] }>(response);
      const valid = new Set(claims.map((c) => c.id));
      const verdicts = (Array.isArray(parsed.verdicts) ? parsed.verdicts : []).filter(
        (v) => v && typeof v.id === 'string' && valid.has(v.id) && typeof v.dramatized === 'boolean',
      );
      return { success: true, data: { verdicts }, rawResponse: response };
    } catch (error) {
      // Conservative: no verdicts → nothing downgraded → findings stay blocking.
      const msg = error instanceof Error ? error.message : String(error);
      console.warn(`[FidelityRealizationJudge] judge call failed (findings stay blocking): ${msg}`);
      return { success: false, error: msg };
    }
  }

  private buildPrompt(claims: RealizationClaim[]): string {
    const blocks = claims
      .map(
        (c) => `### Claim ${c.id}
AUTHORED MOMENT (the treatment requires this to happen on-page):
${c.authoredMoment}

SCENE PROSE (what the player actually reads):
${c.prose}`,
      )
      .join('\n\n');
    return `You are auditing a generated story against its authored treatment. For EACH claim below, decide whether the AUTHORED MOMENT is genuinely DRAMATIZED in the SCENE PROSE — shown on-page as action, dialogue, or concrete event. Paraphrase counts: the prose does NOT need the same words, it needs the same dramatized event. A passing mention, summary, or allusion does NOT count as dramatized.

${blocks}

Return ONLY JSON:
{
  "verdicts": [
    { "id": "<claim id>", "dramatized": true|false, "evidence": "<short quote from the prose when dramatized>" }
  ]
}`;
  }
}

interface JudgeableIssue {
  message?: string;
  severity?: string;
  type?: string;
  validator?: string;
  suggestion?: string;
  sceneId?: string;
  episodeNumber?: number;
}

interface JudgeableReport {
  passed: boolean;
  blockingIssues: JudgeableIssue[];
  warnings?: JudgeableIssue[];
}

interface JudgeableScene {
  id?: string;
  beats?: Array<{ text?: string; textVariants?: Array<{ text?: string }> }>;
  encounter?: unknown;
}
interface JudgeableStory {
  episodes?: Array<{ number?: number; scenes?: JudgeableScene[] }>;
}

/** Player-facing prose of a scene: beat text + variants, plus encounter prose. */
function collectScenePlayerProse(story: Story, sceneId: string, episodeNumber?: number): string {
  for (const episode of (story as unknown as JudgeableStory).episodes ?? []) {
    if (episodeNumber !== undefined && episode.number !== undefined && episode.number !== episodeNumber) continue;
    for (const scene of episode.scenes ?? []) {
      if (scene.id !== sceneId) continue;
      const parts: string[] = [];
      for (const beat of scene.beats ?? []) {
        if (beat.text) parts.push(beat.text);
        for (const v of beat.textVariants ?? []) if (v?.text) parts.push(v.text);
      }
      if (scene.encounter) parts.push(...collectEncounterProseStrings(scene.encounter));
      return parts.join('\n').slice(0, MAX_PROSE_CHARS);
    }
  }
  return '';
}

export interface JudgeConfirmationOutcome {
  /** Findings sent to the judge. */
  judged: number;
  /** Findings the judge refuted (downgraded to warnings). */
  downgraded: number;
}

/**
 * Judge-confirm the heuristic blocking findings in a contract report, in
 * place: findings the judge refutes move to `warnings` (annotated); everything
 * else stays blocking. `passed` is recomputed only when ALL blocking issues
 * cleared. Returns counts for telemetry.
 */
export async function confirmHeuristicFidelityFindings(opts: {
  report: JudgeableReport;
  story: Story;
  /** Returns the judge, or null to skip (everything stays blocking). */
  judge: () => FidelityRealizationJudge | null;
  emit?: (message: string) => void;
}): Promise<JudgeConfirmationOutcome> {
  const candidates = opts.report.blockingIssues
    .map((issue, index) => ({ issue, index }))
    .filter(
      ({ issue }) =>
        issue.validator && JUDGE_CONFIRMABLE_VALIDATORS.has(issue.validator) && issue.sceneId,
    )
    .slice(0, MAX_CLAIMS_PER_CALL);
  if (candidates.length === 0) return { judged: 0, downgraded: 0 };

  const judge = opts.judge();
  if (!judge) return { judged: 0, downgraded: 0 };

  const claims: RealizationClaim[] = [];
  for (const { issue, index } of candidates) {
    const prose = collectScenePlayerProse(opts.story, issue.sceneId as string, issue.episodeNumber);
    if (!prose) continue; // no prose to judge against — stays blocking
    claims.push({
      id: `claim-${index}`,
      authoredMoment: requiredMomentFromMessage(issue.message) ?? issue.message ?? '',
      prose,
      validator: issue.validator,
    });
  }
  if (claims.length === 0) return { judged: 0, downgraded: 0 };

  const result = await judge.execute(claims);
  if (!result.success || !result.data) return { judged: claims.length, downgraded: 0 };

  const refutedIndices = new Set(
    result.data.verdicts
      .filter((v) => {
        if (!v.dramatized) return false;
        const claim = claims.find((c) => c.id === v.id);
        if (!claim) return false;
        if (claim.validator !== 'RequiredBeatRealizationValidator') return true;
        return momentDepicted(claim.validator, claim.authoredMoment, claim.prose);
      })
      .map((v) => Number(v.id.replace('claim-', '')))
      .filter((n) => Number.isInteger(n)),
  );
  if (refutedIndices.size === 0) return { judged: claims.length, downgraded: 0 };

  const remaining: JudgeableIssue[] = [];
  opts.report.blockingIssues.forEach((issue, index) => {
    if (refutedIndices.has(index)) {
      const downgraded = {
        ...issue,
        severity: 'warning',
        message: `[judge-confirmed dramatized — heuristic false positive] ${issue.message ?? ''}`,
      };
      (opts.report.warnings ??= []).push(downgraded);
      opts.emit?.(`Fidelity judge refuted heuristic finding for scene ${issue.sceneId}: dramatized on-page; downgraded to warning.`);
    } else {
      remaining.push(issue);
    }
  });
  opts.report.blockingIssues = remaining;
  if (remaining.length === 0) opts.report.passed = true;

  return { judged: claims.length, downgraded: refutedIndices.size };
}
