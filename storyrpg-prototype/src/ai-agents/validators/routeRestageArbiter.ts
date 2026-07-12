/**
 * LLM arbitration for cue-heuristic route-continuity findings (bite-me
 * 2026-07-05T20-47-31 abort analysis).
 *
 * RouteContinuityValidator detects "a later scene restages an event that an
 * earlier scene already owns" with keyword cue regexes over creative prose.
 * That detector is structurally unable to tell "a stranger grabs her in the
 * park" from "Grab Mika's phone and start drafting a new post" — the word
 * match alone classified a blog-drafting choice label as a restaged street
 * attack and aborted an otherwise-shippable run.
 *
 * Policy (approved 2026-07-05): a cue-regex match ALONE never aborts a run.
 * Before a cue-heuristic route finding may block, one bounded LLM call asks
 * the only question that matters: "does this scene restage the event as new
 * live on-page action, or merely reference it (memory, recap, retelling,
 * writing about it, aftermath, or an incidental word match)?"
 *
 *   - Arbiter says RESTAGED → the finding is corroborated → stays blocking
 *     and flows to the scene-cluster repair route.
 *   - Arbiter says reference-only → downgraded to a warning (annotated,
 *     kept visible for audit).
 *   - Arbiter unavailable or the call fails → the finding is UNCORROBORATED
 *     → downgraded to a warning. This is the inverse of the fidelity judge's
 *     conservative default, deliberately: blocking severity is reserved for
 *     corroborated defects, because an unarbitrated heuristic abort discards
 *     hours of otherwise-valid work over a possible regex artifact.
 */

import { AgentConfig } from '../config';
import { AgentResponse, BaseAgent } from '../agents/BaseAgent';
import type { Story } from '../../types/story';
import { collectEncounterProseStrings } from './EncounterQualityValidator';

/** Cue-heuristic RouteContinuityValidator finding types eligible for arbitration. */
const ARBITRABLE_ROUTE_TYPES = new Set([
  'route_duplicate_event',
  'route_chronology_violation',
]);

/** Max findings arbitrated per contract evaluation (one batched LLM call). */
const MAX_CLAIMS_PER_CALL = 6;
/** Per-scene prose cap fed to the arbiter (chars). */
const MAX_PROSE_CHARS = 6000;

export interface RestageClaim {
  id: string;
  /** The owned event the heuristic says is restaged/misordered. */
  eventText: string;
  /** The validator's full finding message (route + framing). */
  findingMessage: string;
  /** The flagged scene's reader-facing prose, including choice labels. */
  prose: string;
}

export interface RestageVerdict {
  id: string;
  /** True when the arbiter confirms the event happens AGAIN as live on-page action. */
  restaged: boolean;
  /** Short quote/evidence from the prose. */
  evidence?: string;
}

export class RouteRestageArbiter extends BaseAgent {
  constructor(config: AgentConfig) {
    super('Route Restage Arbiter', config);
    this.includeSystemPrompt = false;
  }

  protected getAgentSpecificPrompt(): string {
    return '';
  }

  async execute(claims: RestageClaim[]): Promise<AgentResponse<{ verdicts: RestageVerdict[] }>> {
    const prompt = this.buildPrompt(claims);
    try {
      const response = await this.callLLM([{ role: 'user', content: prompt }]);
      const parsed = this.parseJSON<{ verdicts: RestageVerdict[] }>(response);
      const valid = new Set(claims.map((c) => c.id));
      const verdicts = (Array.isArray(parsed.verdicts) ? parsed.verdicts : []).filter(
        (v) => v && typeof v.id === 'string' && valid.has(v.id) && typeof v.restaged === 'boolean',
      );
      return { success: true, data: { verdicts }, rawResponse: response };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.warn(`[RouteRestageArbiter] arbiter call failed (uncorroborated findings demote to warnings): ${msg}`);
      return { success: false, error: msg };
    }
  }

  private buildPrompt(claims: RestageClaim[]): string {
    const blocks = claims
      .map(
        (c) => `### Claim ${c.id}
EVENT (already happened earlier in the story):
${c.eventText}

HEURISTIC FINDING:
${c.findingMessage}

FLAGGED SCENE (reader-facing prose and choice labels):
${c.prose}`,
      )
      .join('\n\n');
    return `You are auditing route continuity in a generated interactive story. A keyword heuristic flagged each scene below as possibly RE-STAGING an event that already happened earlier on the reader's route. For EACH claim, decide whether the scene genuinely re-stages the event — the event happens AGAIN as new, live, on-page action in scene time — or merely REFERENCES it.

References are allowed and are NOT restaging. References include: memory, recap, retelling, discussing it, writing or blogging about it, showing its aftermath or consequences, public reaction to it, and incidental word matches (an unrelated action that happens to share a verb with the event, e.g. "grab a phone" vs an earlier physical attack).

${blocks}

Return ONLY JSON:
{
  "verdicts": [
    { "id": "<claim id>", "restaged": true|false, "evidence": "<short quote from the prose supporting the verdict>" }
  ]
}`;
  }
}

interface ArbitrableIssue {
  message?: string;
  severity?: string;
  disposition?: 'blocking' | 'confirmed' | 'refuted' | 'uncorroborated';
  type?: string;
  validator?: string;
  suggestion?: string;
  sceneId?: string;
  episodeNumber?: number;
}

interface ArbitrableReport {
  passed: boolean;
  blockingIssues: ArbitrableIssue[];
  warnings?: ArbitrableIssue[];
}

interface ProseScene {
  id?: string;
  beats?: Array<{
    text?: string;
    textVariants?: Array<{ text?: string }>;
    choices?: Array<{ text?: string; lockedText?: string }>;
  }>;
  choices?: Array<{ text?: string; lockedText?: string }>;
  encounter?: unknown;
}
interface ProseStory {
  episodes?: Array<{ number?: number; scenes?: ProseScene[] }>;
}

/**
 * Reader-facing text of the flagged scene INCLUDING choice labels — the cue
 * detector scans choice labels too, so the arbiter must see the full surface
 * that produced the hit.
 */
function collectSceneSurface(story: Story, sceneId: string, episodeNumber?: number): string {
  for (const episode of (story as unknown as ProseStory).episodes ?? []) {
    if (episodeNumber !== undefined && episode.number !== undefined && episode.number !== episodeNumber) continue;
    for (const scene of episode.scenes ?? []) {
      if (scene.id !== sceneId) continue;
      const parts: string[] = [];
      for (const beat of scene.beats ?? []) {
        if (beat.text) parts.push(beat.text);
        for (const v of beat.textVariants ?? []) if (v?.text) parts.push(v.text);
        for (const choice of beat.choices ?? []) {
          if (choice?.text) parts.push(`[choice] ${choice.text}`);
          if (choice?.lockedText) parts.push(`[choice] ${choice.lockedText}`);
        }
      }
      for (const choice of scene.choices ?? []) {
        if (choice?.text) parts.push(`[choice] ${choice.text}`);
        if (choice?.lockedText) parts.push(`[choice] ${choice.lockedText}`);
      }
      if (scene.encounter) parts.push(...collectEncounterProseStrings(scene.encounter));
      return parts.join('\n').slice(0, MAX_PROSE_CHARS);
    }
  }
  return '';
}

/** Pull the quoted owned-event text out of the validator's message when present. */
function eventTextFromMessage(message: string | undefined): string {
  const quoted = /: "([^"]+)"\.?\s*$/.exec(message ?? '');
  return quoted?.[1] ?? message ?? '';
}

export interface RestageArbitrationOutcome {
  /** Cue-heuristic findings considered for arbitration. */
  considered: number;
  /** Findings the arbiter affirmatively refuted (reference-only). */
  refuted: number;
  /** Findings demoted because no corroborating verdict was available. */
  demotedUncorroborated: number;
  /** Findings the arbiter confirmed as genuine restages (stay blocking). */
  confirmed: number;
}

/**
 * Arbitrate the cue-heuristic route findings in a contract report, in place:
 * findings the arbiter refutes — or cannot corroborate — move to `warnings`
 * (annotated); confirmed restages stay blocking. `passed` is recomputed when
 * all blocking issues cleared.
 */
export async function arbitrateRouteRestageFindings(opts: {
  report: ArbitrableReport;
  story: Story;
  /** Returns the arbiter, or null when unavailable (findings demote as uncorroborated). */
  arbiter: () => RouteRestageArbiter | null;
  emit?: (message: string) => void;
}): Promise<RestageArbitrationOutcome> {
  const outcome: RestageArbitrationOutcome = { considered: 0, refuted: 0, demotedUncorroborated: 0, confirmed: 0 };
  const candidates = opts.report.blockingIssues
    .map((issue, index) => ({ issue, index }))
    .filter(({ issue }) =>
      issue.validator === 'RouteContinuityValidator'
      && issue.type !== undefined
      && ARBITRABLE_ROUTE_TYPES.has(issue.type)
      && Boolean(issue.sceneId),
    )
    .slice(0, MAX_CLAIMS_PER_CALL);
  if (candidates.length === 0) return outcome;
  outcome.considered = candidates.length;

  const claims = new Map<number, RestageClaim>();
  for (const { issue, index } of candidates) {
    claims.set(index, {
      id: `claim-${index}`,
      eventText: eventTextFromMessage(issue.message),
      findingMessage: issue.message ?? '',
      prose: collectSceneSurface(opts.story, issue.sceneId as string, issue.episodeNumber),
    });
  }

  const arbiter = opts.arbiter();
  const result = arbiter ? await arbiter.execute([...claims.values()]) : null;
  const verdictById = new Map<string, RestageVerdict>();
  for (const verdict of result?.success ? result.data?.verdicts ?? [] : []) {
    verdictById.set(verdict.id, verdict);
  }

  const remaining: ArbitrableIssue[] = [];
  opts.report.blockingIssues.forEach((issue, index) => {
    const claim = claims.get(index);
    if (!claim) {
      remaining.push(issue);
      return;
    }
    const verdict = verdictById.get(claim.id);
    if (verdict?.restaged === true) {
      outcome.confirmed += 1;
      issue.disposition = 'confirmed';
      remaining.push(issue);
      return;
    }
    const annotation = verdict
      ? '[arbiter-confirmed reference, not restage — cue-heuristic false positive]'
      : '[unarbitrated cue heuristic — demoted to warning; a keyword match alone never blocks]';
    if (verdict) outcome.refuted += 1;
    else outcome.demotedUncorroborated += 1;
    (opts.report.warnings ??= []).push({
      ...issue,
      severity: 'warning',
      disposition: verdict ? 'refuted' : 'uncorroborated',
      message: `${annotation} ${issue.message ?? ''}`,
    });
    opts.emit?.(
      verdict
        ? `Route restage arbiter refuted cue finding for scene ${issue.sceneId}: reference/aftermath only; downgraded to warning.`
        : `Route restage cue finding for scene ${issue.sceneId} demoted to warning: no corroborating arbiter verdict.`,
    );
  });
  opts.report.blockingIssues = remaining;
  if (remaining.length === 0) opts.report.passed = true;

  return outcome;
}
