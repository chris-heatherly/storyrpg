/**
 * Quality Assurance Agents
 *
 * A cluster of agents responsible for validating generated content:
 * - ContinuityChecker: Validates state consistency and timeline logic
 * - VoiceValidator: Ensures character dialogue matches voice profiles
 * - StakesAnalyzer: Verifies choices have proper stakes and meaning
 */

import { AgentConfig } from '../config';
import { BaseAgent, AgentResponse } from './BaseAgent';
import { SceneContent, GeneratedBeat } from './SceneWriter';
import { ChoiceSet } from './ChoiceAuthor';
import { CharacterProfile, VoiceProfile } from './CharacterDesigner';
import { Beat, Choice } from '../../types';
import { buildContinuityReportJsonSchema } from '../schemas/continuityReportSchema';
import { buildStakesReportJsonSchema, buildVoiceReportJsonSchema } from '../schemas/qaReportSchemas';
import {
  ProseCraftJudge,
  ProseCraftReport,
  ResponsivenessJudge,
  ResponsivenessReport,
  judgeFlagEnabled,
} from './QualityJudges';

// ============================================
// CONTINUITY CHECKER
// ============================================

export interface ContinuityCheckerInput {
  // Content to check
  sceneContents: SceneContent[];

  // State context
  knownFlags: Array<{ name: string; description: string; currentValue?: boolean }>;
  knownScores: Array<{ name: string; description: string; currentValue?: number }>;
  knownTags: Array<{ name: string; description: string }>;

  // World facts
  establishedFacts: string[];
  characterKnowledge: Array<{
    characterId: string;
    knows: string[];
    doesNotKnow: string[];
  }>;

  // Timeline
  timelineEvents?: Array<{
    event: string;
    when: string;
  }>;

  // When true, the prompt instructs the checker to focus on cross-scene
  // inconsistencies (because local/intra-scene checks have already been
  // performed incrementally during generation).
  focusCrossScene?: boolean;
}

export interface ContinuityIssue {
  severity: 'error' | 'warning' | 'suggestion';
  type: 'contradiction' | 'impossible_knowledge' | 'timeline_error' | 'state_conflict' | 'missing_setup';
  location: {
    sceneId: string;
    beatId?: string;
    choiceId?: string;
  };
  description: string;
  conflictsWith?: string;
  suggestedFix: string;
}

export interface ContinuityReport {
  overallScore: number; // 0-100
  issueCount: {
    errors: number;
    warnings: number;
    suggestions: number;
  };
  issues: ContinuityIssue[];
  passedChecks: string[];
  recommendations: string[];
}

export function normalizeContinuitySeverity(severity: unknown): ContinuityIssue['severity'] {
  const normalized = typeof severity === 'string' ? severity.toLowerCase() : '';
  if (normalized === 'error' || normalized === 'warning' || normalized === 'suggestion') {
    return normalized;
  }
  return 'warning';
}

export function recomputeContinuityIssueCount(issues: ContinuityIssue[]): ContinuityReport['issueCount'] {
  return issues.reduce(
    (counts, issue) => {
      const severity = normalizeContinuitySeverity((issue as unknown as { severity?: unknown }).severity);
      if (severity === 'error') counts.errors += 1;
      else if (severity === 'warning') counts.warnings += 1;
      else counts.suggestions += 1;
      return counts;
    },
    { errors: 0, warnings: 0, suggestions: 0 },
  );
}

const PROSE_QUOTE_RE = /['"‘“]([^'"‘’“”]{12,240})['"’”]/g;

function looksLikeProseQuote(quote: string): boolean {
  if (!quote.includes(' ')) return false; // flag/score ids, single tokens
  if (/^[a-z0-9]+(?:_[a-z0-9]+)+$/i.test(quote)) return false; // snake_case ids
  return quote.trim().split(/\s+/).length >= 3;
}

function normalizeForEvidenceGrounding(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * LLM continuity judges sometimes fabricate their quoted evidence — a blocking
 * error citing prose that does not exist anywhere in the story (bite-me
 * 2026-07-02T19-39-25: missing_setup error quoted "You met her on the flight
 * over"; the word "flight" appears nowhere in the episode). An error whose
 * prose-shaped quotes are ALL absent from the story text cannot be trusted to
 * block a run: downgrade it to a warning and annotate it, keeping it visible
 * for human review. Issues that quote nothing (or quote only ids) are left
 * untouched — this filter only fires on checkable, failed evidence.
 */
export function groundContinuityEvidence(
  issues: ContinuityIssue[],
  storyProse: string,
): { issues: ContinuityIssue[]; downgraded: number } {
  const corpus = normalizeForEvidenceGrounding(storyProse);
  let downgraded = 0;
  const grounded = issues.map((issue) => {
    if (normalizeContinuitySeverity(issue.severity) !== 'error') return issue;
    const text = `${issue.description ?? ''} ${issue.conflictsWith ?? ''}`;
    const quotes: string[] = [];
    for (const match of text.matchAll(PROSE_QUOTE_RE)) {
      const quote = match[1].trim();
      if (looksLikeProseQuote(quote)) quotes.push(quote);
    }
    if (quotes.length === 0) return issue;
    if (quotes.some((quote) => corpus.includes(normalizeForEvidenceGrounding(quote)))) return issue;
    downgraded += 1;
    return {
      ...issue,
      severity: 'warning' as const,
      description: `${issue.description} [evidence-ungrounded: quoted text not found in story prose; downgraded from error]`,
    };
  });
  return { issues: grounded, downgraded };
}

/** Scene slice the location anchor mines ids from (SceneContent-compatible). */
export interface ContinuityAnchorScene {
  sceneId?: string;
  beats?: Array<{ id?: string }>;
}

/** location.sceneId values that mean "the judge gave us nothing" (seen: '', 'unknown', 'None'). */
const LOCATION_SENTINELS = new Set(['', 'unknown', 'none', 'null', 'n/a', 'undefined']);

/** Scene-id-shaped token for the no-known-ids fallback, e.g. `s1-2`, `s1-2-b2`, `s1-blog-aftermath`. */
const SCENE_TOKEN_RE = /\bs\d+(?:-[a-z0-9]+)+\b/gi;
/** Beat suffix on such a token: `s1-2-b2` / `s3-3-beat-3b` → owning scene is the prefix. */
const BEAT_SUFFIX_RE = /-b(?:eat-)?\d+[a-z]?$/i;

function hasAnchoredSceneId(location: { sceneId?: string } | undefined): boolean {
  const sceneId = typeof location?.sceneId === 'string' ? location.sceneId.trim().toLowerCase() : '';
  return !LOCATION_SENTINELS.has(sceneId);
}

/** Index of `id` in `text` as a standalone id token (hyphen-aware boundaries), or -1. */
function idMentionIndex(text: string, id: string): number {
  const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`(?<![A-Za-z0-9_-])${escaped}(?![A-Za-z0-9_-])`, 'i').exec(text);
  return match ? match.index : -1;
}

/**
 * LLM continuity judges sometimes name the defect's scene/beat only in PROSE
 * ("Mika … speaks in s1-2-b2, but the reader has not been introduced …") while
 * leaving the structured `location` empty or sentinel ("None") — bite-me
 * 2026-07-02T23-54-38 shipped its one blocking finding unrepaired because the
 * continuity repair pass had no sceneId to target. Mine the issue text
 * (description / conflictsWith / suggestedFix) for ids and fill ONLY
 * missing/sentinel location fields; judge-supplied fields are never overridden.
 * Ids that actually exist in the checked scenes win (earliest mention first —
 * the first-named id is the defect's locus); a scene-id-shaped token is the
 * fallback when no known id matches. Pure.
 */
export function anchorContinuityIssueLocations(
  issues: ContinuityIssue[],
  scenes: ContinuityAnchorScene[] | undefined,
): ContinuityIssue[] {
  const knownScenes = (scenes ?? [])
    .map((scene) => scene.sceneId)
    .filter((id): id is string => typeof id === 'string' && id.length > 0);
  const knownBeats: Array<{ beatId: string; sceneId: string }> = [];
  for (const scene of scenes ?? []) {
    if (!scene.sceneId) continue;
    for (const beat of scene.beats ?? []) {
      if (beat?.id) knownBeats.push({ beatId: beat.id, sceneId: scene.sceneId });
    }
  }

  const earliestMention = <T>(items: T[], text: string, idOf: (item: T) => string): T | undefined => {
    let best: T | undefined;
    let bestIdx = Infinity;
    for (const item of items) {
      const idx = idMentionIndex(text, idOf(item));
      if (idx >= 0 && idx < bestIdx) {
        bestIdx = idx;
        best = item;
      }
    }
    return best;
  };

  return issues.map((issue) => {
    const text = [issue.description, issue.conflictsWith, issue.suggestedFix].filter(Boolean).join(' ');
    if (!text) return issue;
    const location = { ...(issue.location ?? {}) } as ContinuityIssue['location'];

    if (!hasAnchoredSceneId(location)) {
      const beatHit = earliestMention(knownBeats, text, (b) => b.beatId);
      const sceneHit = earliestMention(knownScenes, text, (id) => id);
      if (beatHit && (!sceneHit || idMentionIndex(text, beatHit.beatId) <= idMentionIndex(text, sceneHit))) {
        location.sceneId = beatHit.sceneId;
        if (!location.beatId) location.beatId = beatHit.beatId;
      } else if (sceneHit) {
        location.sceneId = sceneHit;
      } else {
        const token = (text.match(SCENE_TOKEN_RE) ?? [])[0];
        if (token && BEAT_SUFFIX_RE.test(token)) {
          location.sceneId = token.replace(BEAT_SUFFIX_RE, '');
          if (!location.beatId) location.beatId = token;
        } else if (token) {
          location.sceneId = token;
        }
      }
    }
    // Fill a missing beatId too, but only with a beat that belongs to the anchored scene.
    if (hasAnchoredSceneId(location) && !location.beatId) {
      const sceneBeats = knownBeats.filter((b) => b.sceneId === location.sceneId);
      const beatHit = earliestMention(sceneBeats, text, (b) => b.beatId);
      if (beatHit) location.beatId = beatHit.beatId;
    }
    if (location.sceneId === issue.location?.sceneId && location.beatId === issue.location?.beatId) {
      return issue;
    }
    return { ...issue, location };
  });
}

/**
 * Derive a continuity overallScore from the report's own signal when the model
 * omitted the numeric field. Returns null when the report carries no signal at
 * all (issues, passed checks, recommendations) — a true non-response that should
 * fail closed (C3) rather than be scored. Otherwise scores from issue severity.
 */
export function deriveContinuityScore(
  report: Pick<ContinuityReport, 'issues' | 'passedChecks' | 'recommendations' | 'issueCount'>,
): number | null {
  const issues = Array.isArray(report.issues) ? report.issues : [];
  const hasSignal =
    issues.length > 0
    || (Array.isArray(report.passedChecks) && report.passedChecks.length > 0)
    || (Array.isArray(report.recommendations) && report.recommendations.length > 0);
  if (!hasSignal) return null;
  const counts = report.issueCount && typeof report.issueCount.errors === 'number'
    ? report.issueCount
    : recomputeContinuityIssueCount(issues);
  return Math.max(0, Math.min(100, 100 - counts.errors * 25 - counts.warnings * 8 - counts.suggestions * 2));
}

/**
 * SECOND-OPINION LLM audit, NOT the primary continuity gate (WS6,
 * AGENT_ARCHITECTURE_PLAN_2026-06-12). The deterministic validators
 * (FlagContract, ReferencedEventPresence, SceneTransitionContinuity,
 * ChoiceCoverage, the scene-graph checks, …) run automatically and
 * incrementally and are the enforcement surface for continuity defects.
 * This agent re-judges the same territory via LLM as a confirmation pass —
 * use it when debugging validator findings or hunting defect classes the
 * deterministic checks don't model (cross-scene knowledge, cause-effect
 * plausibility). Its findings feed QA reports; it should never be the only
 * thing standing between a continuity defect and a shipped story.
 */
export class ContinuityChecker extends BaseAgent {
  constructor(config: AgentConfig) {
    super('Continuity Checker', config);
    // Phase 3.4: QA agents should judge against the shared storytelling principles
    this.includeSystemPrompt = true;
  }

  protected getAgentSpecificPrompt(): string {
    return `
## Your Role: Continuity Checker

You are the guardian of narrative consistency. Your job is to find contradictions, impossible knowledge, timeline errors, and state conflicts before they reach players.

## What You Check

### State Consistency
- Flags referenced must be set somewhere
- Scores must be initialized before being compared
- Tags added must not already exist; tags removed must exist

### Timeline Logic
- Events must happen in possible order
- Characters can't reference future events
- Travel time must be plausible

### Character Knowledge
- Characters can only know what they've learned
- Information can't appear before it's revealed
- Secrets must stay secret until revealed

### Cause and Effect
- Every consequence must have a cause
- Referenced events must actually happen
- Conditions must be satisfiable

## Severity Levels

- **ERROR**: Game-breaking contradiction that MUST be fixed
- **WARNING**: Noticeable issue that SHOULD be fixed
- **SUGGESTION**: Minor improvement that COULD be made

## Output Format

For each issue:
1. Clearly identify the location (scene, beat, choice)
2. Explain what's wrong
3. Reference what it conflicts with
4. Suggest a specific fix

Be thorough but not pedantic. Focus on issues players would actually notice.
`;
  }

  async execute(input: ContinuityCheckerInput): Promise<AgentResponse<ContinuityReport>> {
    const prompt = this.buildPrompt(input);

    console.log(`[ContinuityChecker] Running continuity check...`);

    try {
      const response = await this.callLLM([
        { role: 'user', content: prompt }
      ], 4, { jsonSchema: buildContinuityReportJsonSchema() });

      console.log(`[ContinuityChecker] Received response (${response.length} chars)`);

      let report: ContinuityReport;
      try {
        report = this.parseJSON<ContinuityReport>(response);
      } catch (parseError) {
        console.error(`[ContinuityChecker] JSON parse failed. Raw response (first 500 chars):`, response.substring(0, 500));
        throw parseError;
      }

      // Normalize the report
      report = this.normalizeReport(report);

      // Anchor structured locations: the repair pass can only target
      // location.sceneId/beatId, but judges often name the scene/beat solely
      // in the issue prose (or emit sentinel "None" locations).
      report.issues = anchorContinuityIssueLocations(report.issues, input.sceneContents);

      // Evidence grounding: a blocking error whose quoted prose evidence does
      // not exist anywhere in the story is a judge hallucination, not a defect.
      const grounding = groundContinuityEvidence(report.issues, JSON.stringify(input.sceneContents ?? []));
      if (grounding.downgraded > 0) {
        report.issues = grounding.issues;
        report.issueCount = recomputeContinuityIssueCount(report.issues);
        const rescored = deriveContinuityScore(report);
        if (rescored !== null && rescored > report.overallScore) report.overallScore = rescored;
        console.warn(`[ContinuityChecker] Downgraded ${grounding.downgraded} error(s) with ungrounded quoted evidence.`);
      }

      return {
        success: true,
        data: report,
        rawResponse: response,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`[ContinuityChecker] Error:`, errorMsg);
      return {
        success: false,
        error: errorMsg,
      };
    }
  }

  private normalizeReport(report: ContinuityReport): ContinuityReport {
    // Ensure arrays are arrays
    if (!report.issues) {
      report.issues = [];
    } else if (!Array.isArray(report.issues)) {
      report.issues = [report.issues as unknown as ContinuityIssue];
    }
    report.issues = report.issues.map(issue => ({
      ...issue,
      severity: normalizeContinuitySeverity((issue as unknown as { severity?: unknown }).severity),
    }));
    report.issueCount = recomputeContinuityIssueCount(report.issues);

    if (!report.passedChecks) {
      report.passedChecks = [];
    } else if (!Array.isArray(report.passedChecks)) {
      report.passedChecks = [report.passedChecks as unknown as string];
    }

    if (!report.recommendations) {
      report.recommendations = [];
    } else if (!Array.isArray(report.recommendations)) {
      report.recommendations = [report.recommendations as unknown as string];
    }

    // Derive overallScore when the model omitted the numeric field instead of
    // blindly failing closed (C3). A parsed report that lists issues, passed
    // checks, or recommendations is a real assessment that merely dropped the
    // top-level number — score it from issue severity so a clean check isn't
    // treated as a 0 "fail". Only fail closed (0) when the report carries no
    // signal at all (a non-response). See docs/PROJECT_AUDIT_2026-05-28.md.
    if (typeof report.overallScore !== 'number') {
      const derived = deriveContinuityScore(report);
      if (derived !== null) {
        report.overallScore = derived;
        console.warn(`[${this.name}] QA report missing overallScore — derived ${derived} from issue severity.`);
      } else {
        console.warn(`[${this.name}] QA report had no overallScore and no usable signal — failing closed (0).`);
        report.overallScore = 0;
      }
    }

    return report;
  }

  private buildPrompt(input: ContinuityCheckerInput): string {
    const scenesSummary = input.sceneContents.map(sc => {
      const beatSummary = sc.beats.map(b =>
        `    - ${b.id}: "${b.text.slice(0, 100)}..."`
      ).join('\n');
      return `  Scene: ${sc.sceneId} (${sc.sceneName})\n${beatSummary}`;
    }).join('\n\n');

    const flagsList = input.knownFlags
      .map(f => `- ${f.name}: ${f.description}${f.currentValue !== undefined ? ` (currently: ${f.currentValue})` : ''}`)
      .join('\n');

    const factsList = input.establishedFacts
      .map(f => `- ${f}`)
      .join('\n');

    const focusCrossScene = input.focusCrossScene === true;
    const taskHeader = focusCrossScene
      ? `## Your Task (Cross-Scene Focus)

Per-scene / local continuity has already been checked incrementally during
generation. Focus your review on CROSS-SCENE issues that only become visible
when looking at multiple scenes together:

1. Contradictions between scenes (facts, character behavior, world state)
2. Characters knowing things they could not have learned yet given scene order
3. Timeline impossibilities across the episode
4. State references that rely on setup in a later scene
5. Cause-effect chains that break across scene boundaries
6. Unacknowledged time/place jumps: a scene that opens at a clearly different
   time of day or location than the previous scene ended, with no transition
   prose telling the reader time passed or how the protagonist got there
   (report as "timeline_error")
7. Characters appearing or being named before the reader has met them on-page.
   Ask literally: "would a reader at this point know who this is?" — being
   listed in metadata or known to the writers does NOT count; only an earlier
   on-page introduction does (report as "missing_setup")

Do NOT spend effort re-auditing issues that live inside a single scene; the
incremental validators have already surfaced those.`
      : `## Your Task

Analyze this content for:
1. Contradictions between scenes or within scenes
2. Characters knowing things they shouldn't
3. Timeline impossibilities
4. State references without proper setup
5. Missing cause-effect relationships
6. Unacknowledged time/place jumps: a scene opening at a different time of day
   or location than the previous scene ended, with no transition prose
   (report as "timeline_error")
7. Characters named or appearing before any on-page introduction — would a
   reader at this point know who this is? (report as "missing_setup")`;

    return `
Check the following content for continuity issues:

## Scene Content
${scenesSummary}

## Known State
### Flags
${flagsList || 'None defined'}

### Established Facts
${factsList || 'None established'}

### Character Knowledge
${input.characterKnowledge.map(ck =>
  `${ck.characterId}:\n  Knows: ${ck.knows.join(', ')}\n  Doesn't Know: ${ck.doesNotKnow.join(', ')}`
).join('\n') || 'No character knowledge tracked'}

## Timeline
${input.timelineEvents?.map(e => `- ${e.when}: ${e.event}`).join('\n') || 'No timeline established'}

${taskHeader}

Respond with ONLY a valid JSON object (no prose, no markdown fences) in EXACTLY this shape:
{
  "overallScore": 87,
  "issueCount": { "errors": 0, "warnings": 0, "suggestions": 0 },
  "issues": [
    {
      "severity": "error" | "warning" | "suggestion",
      "type": "contradiction" | "impossible_knowledge" | "timeline_error" | "state_conflict" | "missing_setup",
      "location": { "sceneId": "scene-id", "beatId": "optional-beat-id", "choiceId": "optional-choice-id" },
      "description": "what is inconsistent",
      "conflictsWith": "optional: what it conflicts with",
      "suggestedFix": "a specific fix"
    }
  ],
  "passedChecks": ["consistency checks you verified pass"],
  "recommendations": ["how to improve consistency"]
}

Rules:
- "overallScore" is REQUIRED and must be a number 0-100 (higher = more consistent).
- "issues" must be an array; use [] when the story is consistent.
- Always include "issueCount", "passedChecks", and "recommendations" (use [] / zeros when empty).
`;
  }
}

// ============================================
// VOICE VALIDATOR
// ============================================

export interface VoiceValidatorInput {
  // Content to validate
  sceneContents: SceneContent[];

  // Character voice profiles
  characterProfiles: Array<{
    id: string;
    name: string;
    voiceProfile: VoiceProfile;
  }>;
}

export interface VoiceIssue {
  severity: 'error' | 'warning' | 'suggestion';
  characterId: string;
  characterName: string;
  location: {
    sceneId: string;
    beatId: string;
  };
  dialogueLine: string;
  issue: string;
  suggestion: string;
  exampleCorrection?: string;
}

export interface VoiceReport {
  overallScore: number; // 0-100
  characterScores: Array<{
    characterId: string;
    characterName: string;
    score: number;
    strengths: string[];
    weaknesses: string[];
  }>;
  issues: VoiceIssue[];
  distinctionScore: number; // How well can you tell characters apart?
  recommendations: string[];
}

/**
 * Derive a voice overallScore from per-character scores (lightly blended with
 * distinction) when the model omitted the numeric field; fall back to issue
 * count. Returns null on a true non-response (no scores, issues, or recs) so it
 * fails closed (C3) rather than being scored.
 */
export function deriveVoiceScore(
  report: Pick<VoiceReport, 'characterScores' | 'issues' | 'recommendations' | 'distinctionScore'>,
): number | null {
  const scored = (Array.isArray(report.characterScores) ? report.characterScores : []).filter(
    (c) => typeof c?.score === 'number',
  );
  if (scored.length > 0) {
    const avg = scored.reduce((sum, c) => sum + c.score, 0) / scored.length;
    const dist = typeof report.distinctionScore === 'number' ? report.distinctionScore : 50;
    return Math.max(0, Math.min(100, Math.round(avg * 0.75 + dist * 0.25)));
  }
  const issues = Array.isArray(report.issues) ? report.issues : [];
  const recs = Array.isArray(report.recommendations) ? report.recommendations : [];
  if (issues.length > 0 || recs.length > 0) {
    return Math.max(0, Math.min(100, 100 - issues.length * 8));
  }
  return null;
}

export function extractQuotedDialogueLines(text: string): string[] {
  const source = String(text || '');
  const lines: string[] = [];
  const quotePattern = /["“]([^"”]{2,})["”]/g;
  let match: RegExpExecArray | null;
  while ((match = quotePattern.exec(source)) !== null) {
    const line = match[1].replace(/\s+/g, ' ').trim();
    if (line) lines.push(line);
  }
  return lines;
}

export class VoiceValidator extends BaseAgent {
  constructor(config: AgentConfig) {
    super('Voice Validator', config);
    this.includeSystemPrompt = true;
  }

  protected getAgentSpecificPrompt(): string {
    return `
## Your Role: Voice Validator

You ensure every character sounds like themselves and nobody else. Distinct voices are essential for immersive storytelling.

## What You Check

### Voice Consistency
- Does dialogue match the character's vocabulary level?
- Are their verbal tics and expressions present?
- Does sentence structure match their profile?
- Is formality level consistent?

### Emotional Authenticity
- Do emotional reactions match the character?
- Are their tells and mannerisms present?
- Does stress change their voice appropriately?

### Distinction
- Could you identify the speaker without tags?
- Do any two characters sound too similar?
- Are unique expressions actually unique?

## Scoring Criteria

- **90-100**: Perfect voice, immediately recognizable
- **70-89**: Good voice with minor inconsistencies
- **50-69**: Voice is present but not strong
- **Below 50**: Character sounds generic or wrong

## Common Issues

- Using vocabulary too advanced/simple for character
- Missing verbal tics in extended dialogue
- Formal character speaking casually (or vice versa)
- Two characters with identical speech patterns
- Emotional moments that don't reflect voice profile
`;
  }

  async execute(input: VoiceValidatorInput): Promise<AgentResponse<VoiceReport>> {
    const prompt = this.buildPrompt(input);

    console.log(`[VoiceValidator] Running voice validation...`);

    try {
      const response = await this.callLLM([
        { role: 'user', content: prompt }
      ], 4, { jsonSchema: buildVoiceReportJsonSchema() });

      console.log(`[VoiceValidator] Received response (${response.length} chars)`);

      let report: VoiceReport;
      try {
        report = this.parseJSON<VoiceReport>(response);
      } catch (parseError) {
        console.error(`[VoiceValidator] JSON parse failed. Raw response (first 500 chars):`, response.substring(0, 500));
        throw parseError;
      }

      // Normalize the report
      report = this.normalizeReport(report);

      return {
        success: true,
        data: report,
        rawResponse: response,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`[VoiceValidator] Error:`, errorMsg);
      return {
        success: false,
        error: errorMsg,
      };
    }
  }

  private normalizeReport(report: VoiceReport): VoiceReport {
    // Ensure distinctionScore is a number
    if (typeof report.distinctionScore !== 'number') {
      report.distinctionScore = 50;
    }

    // Ensure arrays are arrays
    if (!report.characterScores) {
      report.characterScores = [];
    } else if (!Array.isArray(report.characterScores)) {
      report.characterScores = [report.characterScores as unknown as VoiceReport['characterScores'][0]];
    }

    if (!report.issues) {
      report.issues = [];
    } else if (!Array.isArray(report.issues)) {
      report.issues = [report.issues as unknown as VoiceIssue];
    }

    if (!report.recommendations) {
      report.recommendations = [];
    } else if (!Array.isArray(report.recommendations)) {
      report.recommendations = [report.recommendations as unknown as string];
    }

    // Derive overallScore when the model omitted it (see ContinuityChecker). A
    // voice report with per-character scores is a real assessment that dropped
    // the top-level number — average them (lightly blended with distinction).
    // Fall back to issue count, then fail closed (0) only on a true non-response.
    if (typeof report.overallScore !== 'number') {
      const derived = deriveVoiceScore(report);
      if (derived !== null) {
        report.overallScore = derived;
        console.warn(`[${this.name}] QA report missing overallScore — derived ${derived} from character/issue signal.`);
      } else {
        console.warn(`[${this.name}] QA report had no overallScore and no usable signal — failing closed (0).`);
        report.overallScore = 0;
      }
    }

    return report;
  }

  private buildPrompt(input: VoiceValidatorInput): string {
    // Extract actual quoted dialogue only. Generated beats often carry a
    // speaker/focal-character field even when the text is narration or a
    // treatment instruction; validating those as "dialogue" creates false
    // critical voice failures.
    const dialogueByCharacter: Record<string, Array<{ sceneId: string; beatId: string; line: string }>> = {};

    for (const scene of input.sceneContents) {
      for (const beat of scene.beats) {
        if (beat.speaker) {
          const dialogueLines = extractQuotedDialogueLines(beat.text);
          if (dialogueLines.length === 0) continue;
          if (!dialogueByCharacter[beat.speaker]) {
            dialogueByCharacter[beat.speaker] = [];
          }
          for (const line of dialogueLines) {
            dialogueByCharacter[beat.speaker].push({
              sceneId: scene.sceneId,
              beatId: beat.id,
              line,
            });
          }
        }
      }
    }

    const dialogueSummary = Object.entries(dialogueByCharacter)
      .map(([speaker, lines]) => {
        const lineList = lines.map(l => `    "${l.line.slice(0, 150)}..." (${l.sceneId}/${l.beatId})`).join('\n');
        return `  ${speaker}:\n${lineList}`;
      })
      .join('\n\n') || 'No quoted character dialogue found in the provided scenes.';

    const profileSummary = input.characterProfiles
      .map(cp => `
### ${cp.name} (${cp.id})
- Vocabulary: ${cp.voiceProfile.vocabulary}
- Sentence Length: ${cp.voiceProfile.sentenceLength}
- Formality: ${cp.voiceProfile.formality}
- Verbal Tics: ${cp.voiceProfile.verbalTics.join(', ')}
- Favorite Expressions: ${cp.voiceProfile.favoriteExpressions.join(', ')}
- When Happy: ${cp.voiceProfile.whenHappy}
- When Angry: ${cp.voiceProfile.whenAngry}
- Sample Lines: ${cp.voiceProfile.greetingExamples.slice(0, 2).join(' | ')}
`)
      .join('\n');

    return `
Validate character voices in the following content:

## Character Voice Profiles
${profileSummary}

## Dialogue to Validate
${dialogueSummary}

## Your Task

For each character with dialogue:
1. Compare their lines to their voice profile
2. Check for vocabulary, tic, and formality consistency
3. Identify any lines that sound "off"
4. Score overall voice consistency

Also evaluate:
- How distinct are the characters from each other?
- Could you identify speakers without tags?
- Are there any voice "collisions"?

Respond with ONLY a valid JSON object (no prose, no markdown fences) in EXACTLY this shape:
{
  "overallScore": 84,
  "characterScores": [
    { "characterId": "npc-id", "characterName": "Name", "score": 80, "strengths": ["..."], "weaknesses": ["..."] }
  ],
  "issues": [
    { "location": { "sceneId": "scene-id", "beatId": "beat-id" }, "dialogueLine": "the line", "issue": "what's off", "suggestion": "fix", "exampleCorrection": "optional rewrite" }
  ],
  "distinctionScore": 75,
  "recommendations": ["how to improve voice"]
}

Rules:
- "overallScore" and "distinctionScore" are REQUIRED numbers 0-100.
- "characterScores", "issues", and "recommendations" must be arrays (use [] when empty).
- Keep the report compact: at most 2 strengths and 2 weaknesses per character, at most 8 total issues, at most 3 recommendations, one short sentence per string.
`;
  }
}

// ============================================
// STAKES ANALYZER
// ============================================

export interface StakesAnalyzerInput {
  // Choices to analyze
  choiceSets: ChoiceSet[];

  // Scene context
  sceneContexts: Array<{
    sceneId: string;
    sceneName: string;
    mood: string;
    narrativeFunction: string;
  }>;

  // Story context
  storyThemes: string[];
  targetTone: string;
}

export interface StakesIssue {
  severity: 'error' | 'warning' | 'suggestion';
  choiceSetId: string;
  issue: string;
  affectedChoices?: string[];
  suggestion: string;
}

export interface StakesReport {
  overallScore: number; // 0-100

  // Per choice set analysis
  choiceSetAnalysis: Array<{
    beatId: string;
    type: string;
    stakesScore: number;
    wantClarity: number;
    costWeight: number;
    identityResonance: number;
    analysis: string;
    improvements: string[];
  }>;

  // Aggregate metrics
  metrics: {
    averageStakesScore: number;
    falseChoiceCount: number; // Choices with same outcome
    dilemmaQuality: number; // How hard are the hard choices?
    varietyScore: number; // Mix of choice types
  };

  issues: StakesIssue[];
  strengths: string[];
  recommendations: string[];
}

export class StakesAnalyzer extends BaseAgent {
  constructor(config: AgentConfig) {
    super('Stakes Analyzer', config);
    this.includeSystemPrompt = true;
  }

  protected getAgentSpecificPrompt(): string {
    return `
## Your Role: Stakes Analyzer

You ensure every choice feels meaningful and every decision matters. Weak stakes make for forgettable stories.

## The Stakes Triangle

Every significant choice needs:
- **WANT**: What is the player pursuing? Is it clear and compelling?
- **COST**: What must be sacrificed or risked? Is it proportional?
- **IDENTITY**: What does choosing reveal about the player? Is it meaningful?

## What You Analyze

### Choice Quality
- Do all options feel valid?
- Is there a "right answer" that makes other options pointless?
- Are consequences proportional to the choice weight?

### False Choice Detection
- Do different options lead to the same outcome?
- Are some options clearly superior?
- Is one option obviously "the developer's choice"?

### Dilemma Quality (for moral dilemmas)
- Is the dilemma genuinely hard?
- Are both sides sympathetic?
- Do players have enough information to choose meaningfully?

### Stakes Progression
- Do stakes escalate through the episode?
- Is there variety in choice types?
- Do climactic moments have climactic stakes?

## Scoring Criteria

### Stakes Score (per choice)
- **90-100**: Perfect stakes, memorable decision
- **70-89**: Good stakes, engaging choice
- **50-69**: Adequate stakes, serviceable
- **Below 50**: Weak stakes, forgettable

### Dilemma Quality
- **High**: "I genuinely don't know what to do"
- **Medium**: "This is tough but I can decide"
- **Low**: "One option is clearly better"
`;
  }

  async execute(input: StakesAnalyzerInput): Promise<AgentResponse<StakesReport>> {
    const prompt = this.buildPrompt(input);

    console.log(`[StakesAnalyzer] Running stakes analysis...`);

    try {
      const response = await this.callLLM([
        { role: 'user', content: prompt }
      ], 4, { jsonSchema: buildStakesReportJsonSchema() });

      console.log(`[StakesAnalyzer] Received response (${response.length} chars)`);

      let report: StakesReport;
      try {
        report = this.parseJSON<StakesReport>(response);
      } catch (parseError) {
        console.error(`[StakesAnalyzer] JSON parse failed. Raw response (first 500 chars):`, response.substring(0, 500));
        throw parseError;
      }

      // Normalize the report
      report = this.normalizeReport(report);

      return {
        success: true,
        data: report,
        rawResponse: response,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`[StakesAnalyzer] Error:`, errorMsg);
      return {
        success: false,
        error: errorMsg,
      };
    }
  }

  private normalizeReport(report: StakesReport): StakesReport {
    // Ensure overallScore is a number. Fail CLOSED (C3): an unparseable QA
    // response must not masquerade as a neutral 50 "pass". Score it 0 so it
    // fails the QA threshold and triggers a (bounded) repair pass instead of
    // silently shipping unverified content. See docs/PROJECT_AUDIT_2026-05-28.md.
    if (typeof report.overallScore !== 'number') {
      console.warn(`[${this.name}] QA report had no numeric overallScore — failing closed (0), not defaulting to 50.`);
      report.overallScore = 0;
    }

    // Ensure metrics exists with all fields
    if (!report.metrics) {
      report.metrics = { averageStakesScore: 50, falseChoiceCount: 0, dilemmaQuality: 50, varietyScore: 50 };
    } else {
      if (typeof report.metrics.averageStakesScore !== 'number') {
        report.metrics.averageStakesScore = 50;
      }
      if (typeof report.metrics.falseChoiceCount !== 'number') {
        report.metrics.falseChoiceCount = 0;
      }
      if (typeof report.metrics.dilemmaQuality !== 'number') {
        report.metrics.dilemmaQuality = 50;
      }
      if (typeof report.metrics.varietyScore !== 'number') {
        report.metrics.varietyScore = 50;
      }
    }

    // Ensure arrays are arrays
    if (!report.choiceSetAnalysis) {
      report.choiceSetAnalysis = [];
    } else if (!Array.isArray(report.choiceSetAnalysis)) {
      report.choiceSetAnalysis = [report.choiceSetAnalysis as unknown as StakesReport['choiceSetAnalysis'][0]];
    }

    if (!report.issues) {
      report.issues = [];
    } else if (!Array.isArray(report.issues)) {
      report.issues = [report.issues as unknown as StakesIssue];
    }

    if (!report.strengths) {
      report.strengths = [];
    } else if (!Array.isArray(report.strengths)) {
      report.strengths = [report.strengths as unknown as string];
    }

    if (!report.recommendations) {
      report.recommendations = [];
    } else if (!Array.isArray(report.recommendations)) {
      report.recommendations = [report.recommendations as unknown as string];
    }

    return report;
  }

  private buildPrompt(input: StakesAnalyzerInput): string {
    const choicesSummary = input.choiceSets.map(cs => {
      const optionList = cs.choices.map(c =>
        `    - "${c.text}" → ${c.nextSceneId || 'same scene'}${c.consequences?.length ? ` (${c.consequences.length} consequences)` : ''}`
      ).join('\n');

      return `
### Choice Set: ${cs.beatId}
Type: ${cs.choiceType}
Stakes: Want: ${cs.overallStakes.want} | Cost: ${cs.overallStakes.cost} | Identity: ${cs.overallStakes.identity}
Options:
${optionList}`;
    }).join('\n');

    const sceneContext = input.sceneContexts
      .map(sc => `- ${sc.sceneName}: ${sc.mood}, ${sc.narrativeFunction}`)
      .join('\n');

    return `
Analyze the stakes and quality of the following choices:

## Story Context
- **Themes**: ${input.storyThemes.join(', ')}
- **Target Tone**: ${input.targetTone}

## Scene Context
${sceneContext}

## Choices to Analyze
${choicesSummary}

## Your Task

For each choice set:
1. Evaluate the Stakes Triangle (Want, Cost, Identity)
2. Check for false choices or obvious "right answers"
3. Assess whether stakes match the choice type
4. Score overall choice quality

Also evaluate:
- Stakes progression through the episode
- Variety of choice types
- Quality of any moral dilemmas
- Overall engagement potential

Provide a StakesReport with:
- Overall stakes score
- Per-choice-set detailed analysis
- Aggregate metrics (false choices, dilemma quality, variety)
- Specific issues with suggestions
- Strengths to maintain
- Recommendations for improvement

Respond with valid JSON matching the StakesReport type.
`;
  }
}

// ============================================
// COMBINED QA RUNNER
// ============================================

export interface QAInput {
  sceneContents: SceneContent[];
  choiceSets: ChoiceSet[];
  characterProfiles: Array<{
    id: string;
    name: string;
    voiceProfile: VoiceProfile;
  }>;
  knownFlags: Array<{ name: string; description: string }>;
  knownScores: Array<{ name: string; description: string }>;
  knownTags?: Array<{ name: string; description: string }>;
  establishedFacts: string[];
  storyThemes: string[];
  targetTone: string;
  sceneContexts: Array<{
    sceneId: string;
    sceneName: string;
    mood: string;
    narrativeFunction: string;
  }>;
  // Optional knowledge / timeline feeds for ContinuityChecker.
  // When omitted, ContinuityChecker falls back to "no character knowledge
  // tracked" / "no timeline established" prompt stanzas, which is the
  // previous behaviour.
  characterKnowledge?: Array<{
    characterId: string;
    knows: string[];
    doesNotKnow: string[];
  }>;
  timelineEvents?: Array<{
    event: string;
    when: string;
  }>;
}

export interface QAReport {
  continuity: ContinuityReport;
  voice: VoiceReport;
  stakes: StakesReport;
  overallScore: number;
  passesQA: boolean;
  criticalIssues: string[];
  summary: string;
  skippedChecks?: string[]; // Which checks were skipped due to incremental validation
  /**
   * Graded prose-craft judgment (QualityScore v4). Informational: feeds the
   * quality score's prose_craft domain but does NOT enter overallScore /
   * passesQA — the QA gate and repair loop are unchanged. Absent when the
   * judge is disabled (STORYRPG_PROSE_JUDGE=0) or failed.
   */
  proseCraft?: ProseCraftReport;
  /**
   * Route-pair responsiveness judgment (QualityScore v4). Same contract as
   * proseCraft: score-only, never gates QA. Absent when disabled
   * (STORYRPG_RESPONSIVENESS_JUDGE=0) or failed.
   */
  responsiveness?: ResponsivenessReport;
  /**
   * G9 evidence sync: which content this report actually graded, and whether
   * that content was mutated after grading (stale). Reporting-only.
   */
  qaEvidence?: import('../utils/qaEvidenceStamp').QaEvidenceStamp;
}

/**
 * Ceiling for a skipped check whose incremental evidence carries no numeric
 * scores: "issues were watched for and none surfaced" is good evidence, but it
 * is not a measured 100 — a perfect score must be earned by a check that ran.
 */
export const UNQUANTIFIED_EVIDENCE_BASE_SCORE = 85;

export function deriveEvidenceLimitedScore(input: {
  scores?: number[];
  evidenceCount: number;
  errorCount?: number;
  warningCount?: number;
}): number {
  if (input.evidenceCount <= 0) return 0;
  const scores = (input.scores ?? []).filter((score) => typeof score === 'number' && Number.isFinite(score));
  const baseScore = scores.length > 0
    ? scores.reduce((sum, score) => sum + score, 0) / scores.length
    : UNQUANTIFIED_EVIDENCE_BASE_SCORE;
  const penalty = (input.errorCount ?? 0) * 20 + (input.warningCount ?? 0) * 8;
  return Math.max(0, Math.min(100, Math.round(baseScore - penalty)));
}

/**
 * Derive the QA-level outcome (overall score, critical-issue list, pass/fail) purely
 * from the three sub-reports. The single source of truth for QA aggregation: used both
 * when the report is first assembled (QARunner.runFullQA) and when it is RECOMPUTED
 * after a repair refreshes a sub-report (e.g. continuity re-validation), so the
 * GATE_QA_CRITICAL_BLOCK gate reflects post-repair residue, not stale findings. Pure.
 */
export function deriveQAOutcome(
  continuity: Pick<ContinuityReport, 'overallScore' | 'issueCount'>,
  voice: Pick<VoiceReport, 'overallScore' | 'issues'>,
  stakes: Pick<StakesReport, 'overallScore' | 'metrics'> & Partial<Pick<StakesReport, 'issues'>>,
): { overallScore: number; criticalIssues: string[]; passesQA: boolean } {
  const overallScore = Math.round(
    (continuity.overallScore * 0.35) +
    (voice.overallScore * 0.30) +
    (stakes.overallScore * 0.35)
  );
  const criticalIssues: string[] = [];
  if (continuity.issueCount.errors > 0) {
    criticalIssues.push(`${continuity.issueCount.errors} continuity error(s)`);
  }
  if (voice.issues.filter((i) => i.severity === 'error').length > 0) {
    criticalIssues.push('Voice consistency errors');
  }
  if ((stakes.issues ?? []).filter((i) => i.severity === 'error').length > 0) {
    criticalIssues.push('Stakes analysis errors');
  }
  if (stakes.metrics.falseChoiceCount > 0) {
    criticalIssues.push(`${stakes.metrics.falseChoiceCount} false choice(s)`);
  }
  return { overallScore, criticalIssues, passesQA: overallScore >= 70 && criticalIssues.length === 0 };
}

/**
 * Recompute a QAReport's derived fields (overallScore / criticalIssues / passesQA) in
 * place from its current sub-reports. Call after a repair mutates a sub-report so the
 * QA-critical gate and the aggregated season report see the residue. Pure (mutates the
 * passed report only).
 */
export function recomputeQAReportDerived(report: QAReport): void {
  const { overallScore, criticalIssues, passesQA } = deriveQAOutcome(report.continuity, report.voice, report.stakes);
  report.overallScore = overallScore;
  report.criticalIssues = criticalIssues;
  report.passesQA = passesQA;
  report.summary = buildQAReportSummary(report.continuity, report.voice, report.stakes, overallScore);
}

export function buildQAReportSummary(
  continuity: ContinuityReport,
  voice: VoiceReport,
  stakes: StakesReport,
  overall: number
): string {
  const parts: string[] = [];

  parts.push(`Overall QA Score: ${overall}/100`);
  parts.push(`- Continuity: ${continuity.overallScore}/100 (${continuity.issueCount.errors} errors, ${continuity.issueCount.warnings} warnings)`);
  parts.push(`- Voice: ${voice.overallScore}/100 (${voice.distinctionScore}/100 distinction)`);
  parts.push(`- Stakes: ${stakes.overallScore}/100 (${stakes.metrics.falseChoiceCount} false choices)`);

  if (overall >= 80) {
    parts.push('\nContent quality is good. Minor polish recommended.');
  } else if (overall >= 70) {
    parts.push('\nContent passes QA. Revision notes should be treated as polish unless a critical issue is present.');
  } else if (overall >= 60) {
    parts.push('\nContent needs revision before publishing.');
  } else {
    parts.push('\nSignificant issues found. Major revision required.');
  }

  return parts.join('\n');
}

/**
 * Options for QA execution - allows skipping checks done incrementally
 */
export interface QARunnerOptions {
  /** Skip voice validation (already done per-scene incrementally) */
  skipVoiceValidation?: boolean;
  /** Skip stakes analysis (already done per-choice incrementally) */
  skipStakesAnalysis?: boolean;
  /** Focus continuity on cross-scene issues (local issues caught incrementally) */
  continuityFocusCrossScene?: boolean;
  /** Skip the prose-craft judge (also disabled by STORYRPG_PROSE_JUDGE=0). */
  skipProseCraft?: boolean;
  /** Skip the responsiveness judge (also disabled by STORYRPG_RESPONSIVENESS_JUDGE=0). */
  skipResponsiveness?: boolean;
  /** Pre-computed incremental validation results to include in report */
  incrementalResults?: {
    voiceIssueCount?: number;
    stakesIssueCount?: number;
    continuityIssueCount?: number;
    /**
     * Actual aggregated voice issues from incremental validators, each
     * tagged with the scene they came from. Consumed by the skip stub so
     * `skippedVoiceReport.issues` reflects real findings rather than an
     * empty array.
     */
    voiceIssues?: Array<{
      sceneId: string;
      beatId: string;
      characterId: string;
      characterName: string;
      severity: 'error' | 'warning';
      issue: string;
      suggestion?: string;
    }>;
    /**
     * Actual aggregated stakes issues from incremental validators.
     * Consumed by the skip stub so `skippedStakesReport.issues` reflects
     * real findings rather than an empty array.
     */
    stakesIssues?: Array<{
      sceneId: string;
      choiceSetId: string;
      severity: 'error' | 'warning';
      issue: string;
      suggestion?: string;
    }>;
    voiceScores?: number[];
    stakesScores?: number[];
    voiceEvidenceCount?: number;
    stakesEvidenceCount?: number;
    voiceErrorCount?: number;
    voiceWarningCount?: number;
    stakesErrorCount?: number;
    stakesWarningCount?: number;
    falseChoiceCount?: number;
  };
}

export class QARunner {
  private continuityChecker: ContinuityChecker;
  private voiceValidator: VoiceValidator;
  private stakesAnalyzer: StakesAnalyzer;
  private proseCraftJudge: ProseCraftJudge;
  private responsivenessJudge: ResponsivenessJudge;

  constructor(config: AgentConfig) {
    this.continuityChecker = new ContinuityChecker(config);
    this.voiceValidator = new VoiceValidator(config);
    this.stakesAnalyzer = new StakesAnalyzer(config);
    this.proseCraftJudge = new ProseCraftJudge(config);
    this.responsivenessJudge = new ResponsivenessJudge(config);
  }

  async runFullQA(input: QAInput, options: QARunnerOptions = {}): Promise<QAReport> {
    const skippedChecks: string[] = [];
    const checks: Promise<unknown>[] = [];
    
    // Track which indices correspond to which checks
    let continuityIdx = -1;
    let voiceIdx = -1;
    let stakesIdx = -1;

    // Continuity check - always run (but may focus on cross-scene if local was done)
    continuityIdx = checks.length;
    checks.push(
      this.continuityChecker.execute({
        sceneContents: input.sceneContents,
        knownFlags: input.knownFlags,
        knownScores: input.knownScores,
        knownTags: input.knownTags ?? [],
        establishedFacts: input.establishedFacts,
        characterKnowledge: input.characterKnowledge ?? [],
        timelineEvents: input.timelineEvents,
        focusCrossScene: options.continuityFocusCrossScene === true,
      })
    );
    if (options.continuityFocusCrossScene) {
      console.log('[QARunner] Focusing continuity check on cross-scene issues (local checked incrementally)');
    }

    // Voice validation - skip if already done incrementally
    if (options.skipVoiceValidation) {
      skippedChecks.push('voice');
      console.log('[QARunner] Skipping voice validation (done incrementally)');
    } else {
      voiceIdx = checks.length;
      checks.push(
        this.voiceValidator.execute({
          sceneContents: input.sceneContents,
          characterProfiles: input.characterProfiles,
        })
      );
    }

    // Stakes analysis - skip if already done incrementally
    if (options.skipStakesAnalysis) {
      skippedChecks.push('stakes');
      console.log('[QARunner] Skipping stakes analysis (done incrementally)');
    } else {
      stakesIdx = checks.length;
      checks.push(
        this.stakesAnalyzer.execute({
          choiceSets: input.choiceSets,
          sceneContexts: input.sceneContexts,
          storyThemes: input.storyThemes,
          targetTone: input.targetTone,
        })
      );
    }

    // Prose-craft judge (QualityScore v4). Never skipped for incremental
    // coverage — nothing incremental reads the prose as prose. Non-blocking:
    // a failure leaves report.proseCraft absent.
    let proseCraftIdx = -1;
    if (options.skipProseCraft || !judgeFlagEnabled('STORYRPG_PROSE_JUDGE')) {
      skippedChecks.push('proseCraft');
      console.info('[QARunner] Skipping prose-craft judge (disabled)');
    } else {
      proseCraftIdx = checks.length;
      checks.push(
        this.proseCraftJudge.execute({
          sceneContents: input.sceneContents,
          storyThemes: input.storyThemes,
          targetTone: input.targetTone,
        })
      );
    }

    // Responsiveness judge (QualityScore v4): route-pair divergence + NPC
    // reaction. Same non-blocking contract as the prose judge.
    let responsivenessIdx = -1;
    if (options.skipResponsiveness || !judgeFlagEnabled('STORYRPG_RESPONSIVENESS_JUDGE')) {
      skippedChecks.push('responsiveness');
      console.info('[QARunner] Skipping responsiveness judge (disabled)');
    } else {
      responsivenessIdx = checks.length;
      checks.push(
        this.responsivenessJudge.execute({
          sceneContents: input.sceneContents,
          choiceSets: input.choiceSets,
        })
      );
    }

    // Run all enabled checks in parallel
    const results = await Promise.all(checks);

    // Extract reports (use defaults if skipped or failed)
    const continuityResult = results[continuityIdx] as Awaited<ReturnType<ContinuityChecker['execute']>>;
    const continuity = continuityResult?.data || this.getDefaultContinuityReport();
    
    let voice: VoiceReport;
    if (options.skipVoiceValidation) {
      // Use a passing default if skipped (incremental caught issues)
      voice = this.getSkippedVoiceReport(
        options.incrementalResults?.voiceIssueCount || 0,
        options.incrementalResults?.voiceIssues,
        options.incrementalResults,
      );
    } else {
      const voiceResult = results[voiceIdx] as Awaited<ReturnType<VoiceValidator['execute']>>;
      voice = voiceResult?.data || this.getDefaultVoiceReport(voiceResult?.error);
    }
    
    let stakes: StakesReport;
    if (options.skipStakesAnalysis) {
      // Use a passing default if skipped (incremental caught issues)
      stakes = this.getSkippedStakesReport(
        options.incrementalResults?.stakesIssueCount || 0,
        options.incrementalResults?.stakesIssues,
        options.incrementalResults,
      );
    } else {
      const stakesResult = results[stakesIdx] as Awaited<ReturnType<StakesAnalyzer['execute']>>;
      stakes = stakesResult?.data || this.getDefaultStakesReport();
    }

    // Judge reports are informational (score-only): absent on failure, never
    // part of deriveQAOutcome, so the QA gate and repair loop are unchanged.
    let proseCraft: ProseCraftReport | undefined;
    if (proseCraftIdx >= 0) {
      const proseCraftResult = results[proseCraftIdx] as Awaited<ReturnType<ProseCraftJudge['execute']>>;
      proseCraft = proseCraftResult?.success ? proseCraftResult.data : undefined;
      if (!proseCraft) {
        console.warn(`[QARunner] Prose-craft judge produced no report${proseCraftResult?.error ? `: ${proseCraftResult.error}` : ''}`);
      }
    }
    let responsiveness: ResponsivenessReport | undefined;
    if (responsivenessIdx >= 0) {
      const responsivenessResult = results[responsivenessIdx] as Awaited<ReturnType<ResponsivenessJudge['execute']>>;
      responsiveness = responsivenessResult?.success ? responsivenessResult.data : undefined;
      if (!responsiveness) {
        console.warn(`[QARunner] Responsiveness judge produced no report${responsivenessResult?.error ? `: ${responsivenessResult.error}` : ''}`);
      }
    }

    // Score + critical-issue derivation lives in the pure deriveQAOutcome (so the
    // post-repair recompute uses the EXACT same formula — no drift).
    const { overallScore, criticalIssues, passesQA } = deriveQAOutcome(continuity, voice, stakes);

    // Generate summary
    const summary = this.generateSummary(continuity, voice, stakes, overallScore);

    return {
      continuity,
      voice,
      stakes,
      overallScore,
      passesQA,
      criticalIssues,
      summary,
      skippedChecks: skippedChecks.length > 0 ? skippedChecks : undefined,
      proseCraft,
      responsiveness,
    };
  }

  /**
   * Generate a voice report for when validation was skipped (done incrementally)
   */
  private getSkippedVoiceReport(
    incrementalIssueCount: number,
    incrementalIssues?: NonNullable<QARunnerOptions['incrementalResults']>['voiceIssues'],
    incrementalResults?: NonNullable<QARunnerOptions['incrementalResults']>,
  ): VoiceReport {
    const issues: VoiceIssue[] = (incrementalIssues ?? []).map(iss => ({
      severity: iss.severity,
      characterId: iss.characterId,
      characterName: iss.characterName,
      location: {
        sceneId: iss.sceneId,
        beatId: iss.beatId,
      },
      dialogueLine: '',
      issue: iss.issue,
      suggestion: iss.suggestion ?? '',
    }));
    const evidenceCount = incrementalResults?.voiceEvidenceCount ?? 0;
    if (evidenceCount <= 0) {
      issues.push({
        severity: 'error',
        characterId: 'unknown',
        characterName: 'Unknown',
        location: { sceneId: 'qa', beatId: 'skipped-voice-validation' },
        dialogueLine: '',
        issue: 'Voice validation was skipped but no incremental voice evidence was available',
        suggestion: 'Run voice validation or provide incremental voice results before assigning a QA score',
      });
    }
    const errorCount = incrementalResults?.voiceErrorCount ?? issues.filter(issue => issue.severity === 'error').length;
    const warningCount = incrementalResults?.voiceWarningCount ?? issues.filter(issue => issue.severity === 'warning').length;

    return {
      overallScore: deriveEvidenceLimitedScore({
        scores: incrementalResults?.voiceScores,
        evidenceCount,
        errorCount,
        warningCount,
      }),
      characterScores: [],
      issues,
      distinctionScore: 85,
      recommendations: incrementalIssueCount > 0 
        ? [`${incrementalIssueCount} voice issue(s) were caught and addressed during incremental validation`]
        : [
          evidenceCount > 0
            ? 'Voice validation was performed incrementally during content generation; score reflects collected incremental evidence because full voice QA was skipped'
            : 'Voice validation has no evidence and is scored as failed',
        ],
    };
  }

  /**
   * Generate a stakes report for when analysis was skipped (done incrementally)
   */
  private getSkippedStakesReport(
    incrementalIssueCount: number,
    incrementalIssues?: NonNullable<QARunnerOptions['incrementalResults']>['stakesIssues'],
    incrementalResults?: NonNullable<QARunnerOptions['incrementalResults']>,
  ): StakesReport {
    const issues: StakesIssue[] = (incrementalIssues ?? []).map(iss => ({
      severity: iss.severity,
      choiceSetId: iss.choiceSetId,
      issue: iss.issue,
      suggestion: iss.suggestion ?? '',
    }));
    const evidenceCount = incrementalResults?.stakesEvidenceCount ?? 0;
    if (evidenceCount <= 0) {
      issues.push({
        severity: 'error',
        choiceSetId: 'skipped-stakes-validation',
        issue: 'Stakes validation was skipped but no incremental stakes evidence was available',
        suggestion: 'Run stakes validation or provide incremental stakes results before assigning a QA score',
      });
    }
    const errorCount = incrementalResults?.stakesErrorCount ?? issues.filter(issue => issue.severity === 'error').length;
    const warningCount = incrementalResults?.stakesWarningCount ?? issues.filter(issue => issue.severity === 'warning').length;
    const falseChoiceCount = incrementalResults?.falseChoiceCount ?? 0;

    return {
      overallScore: deriveEvidenceLimitedScore({
        scores: incrementalResults?.stakesScores,
        evidenceCount,
        errorCount,
        warningCount,
      }),
      choiceSetAnalysis: [],
      metrics: {
        averageStakesScore: 85,
        falseChoiceCount,
        dilemmaQuality: 75,
        varietyScore: 80,
      },
      issues,
      strengths: ['Stakes were validated incrementally during content generation'],
      recommendations: incrementalIssueCount > 0
        ? [`${incrementalIssueCount} stakes issue(s) were caught and addressed during incremental validation`]
        : [
          evidenceCount > 0
            ? 'Stakes validation was performed incrementally during content generation; score reflects collected incremental evidence because full stakes QA was skipped'
            : 'Stakes validation has no evidence and is scored as failed',
        ],
    };
  }

  private generateSummary(
    continuity: ContinuityReport,
    voice: VoiceReport,
    stakes: StakesReport,
    overall: number
  ): string {
    return buildQAReportSummary(continuity, voice, stakes, overall);
  }

  private getDefaultContinuityReport(): ContinuityReport {
    return {
      overallScore: 0,
      issueCount: { errors: 1, warnings: 0, suggestions: 0 },
      issues: [{ severity: 'error', type: 'contradiction', location: { sceneId: 'unknown' }, description: 'Continuity check failed', suggestedFix: 'Review manually' }],
      passedChecks: [],
      recommendations: ['Manual review required'],
    };
  }

  private getDefaultVoiceReport(errorMessage?: string): VoiceReport {
    const failureIssue = errorMessage
      ? {
          severity: 'error' as const,
          characterId: 'unknown',
          characterName: 'Unknown',
          location: { sceneId: 'qa', beatId: 'voice-validator-failure' },
          dialogueLine: '',
          issue: `Voice validator failed: ${errorMessage}`,
          suggestion: 'Retry voice validation after simplifying the voice QA prompt or regenerating the episode prose.',
        }
      : undefined;
    return {
      overallScore: 0,
      characterScores: [],
      issues: failureIssue ? [failureIssue] : [],
      distinctionScore: 0,
      recommendations: [
        errorMessage
          ? `Voice check failed - manual review required: ${errorMessage}`
          : 'Voice check failed - manual review required',
      ],
    };
  }

  private getDefaultStakesReport(): StakesReport {
    return {
      overallScore: 0,
      choiceSetAnalysis: [],
      metrics: { averageStakesScore: 0, falseChoiceCount: 0, dilemmaQuality: 0, varietyScore: 0 },
      issues: [],
      strengths: [],
      recommendations: ['Stakes analysis failed - manual review required'],
    };
  }
}
