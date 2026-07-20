/**
 * Story Quality Judges
 *
 * Two LLM judges that GRADE quality instead of only subtracting penalties —
 * the QualityScore v4 counterpart to the deficit-only validator stack:
 *
 * - ProseCraftJudge: reads sampled scene prose and grades sentence craft,
 *   specificity, filler density, rhythm, dialogue, and narrative voice
 *   (pillar 1: "well written"). Nothing else in the pipeline reads the prose
 *   as prose.
 * - ResponsivenessJudge: replays choice points ("probes") and judges whether
 *   the downstream prose actually differs by choice and whether NPCs react
 *   to what the player did (pillar 4: "responsive story world").
 *
 * Both run inside QARunner.runFullQA (non-blocking: a judge failure leaves its
 * report absent, never fails QA) and their reports ride on the QAReport into
 * deriveStoryCircleQualityScore, where conceptScores become graded concept
 * bases and issues become findings. Kill switches: STORYRPG_PROSE_JUDGE=0 /
 * STORYRPG_RESPONSIVENESS_JUDGE=0.
 */

import { AgentConfig } from '../config';
import { BaseAgent, AgentResponse } from './BaseAgent';
import { SceneContent } from './SceneWriter';
import { ChoiceSet } from './ChoiceAuthor';
import {
  buildProseCraftReportJsonSchema,
  buildResponsivenessReportJsonSchema,
} from '../schemas/qaReportSchemas';
import { DEFAULT_IDENTITY_PROFILE, type PlayerState } from '../../types';
import { selectTextVariant } from '../../engine/templateProcessor';

// ============================================
// SHARED
// ============================================

export type JudgeSeverity = 'error' | 'warning' | 'suggestion';

export interface JudgeIssue {
  severity: JudgeSeverity;
  conceptId: string;
  location?: { sceneId?: string; beatId?: string };
  description: string;
  suggestion?: string;
}

/** Env kill-switch: judges default ON; set the var to '0' or 'false' to disable. */
export function judgeFlagEnabled(name: string): boolean {
  try {
    const value = typeof process !== 'undefined' ? process.env?.[name] : undefined;
    return value !== '0' && value !== 'false';
  } catch {
    return true;
  }
}

function clamp0to100(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function normalizeIssues(raw: unknown, knownConcepts: Set<string>, fallbackConcept: string): JudgeIssue[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((issue): issue is Record<string, any> => Boolean(issue) && typeof issue === 'object')
    .map((issue) => ({
      severity: (issue.severity === 'error' || issue.severity === 'suggestion' ? issue.severity : 'warning') as JudgeSeverity,
      conceptId: knownConcepts.has(String(issue.conceptId)) ? String(issue.conceptId) : fallbackConcept,
      location: issue.location && typeof issue.location === 'object'
        ? { sceneId: issue.location.sceneId, beatId: issue.location.beatId }
        : undefined,
      description: String(issue.description ?? issue.issue ?? '').trim(),
      suggestion: typeof issue.suggestion === 'string' ? issue.suggestion : undefined,
    }))
    .filter((issue) => issue.description.length > 0);
}

// ============================================
// MULTI-EPISODE AGGREGATION
// ============================================

/**
 * Merge per-episode judge reports into one season-level report. Concept grades
 * keep the LOWEST score seen (a season reads as weak as its weakest graded
 * stretch — same policy the scorer applies to duplicate grades); issues and
 * probe verdicts accumulate. Used by the multi-episode QA aggregation so judge
 * evidence survives into final scoring instead of being dropped with the
 * last-episode-only field rebuild.
 */
function mergeConceptScores<T extends { conceptId: string; score: number; evidence: string }>(
  reports: Array<{ conceptScores: T[] }>,
): T[] {
  const byConcept = new Map<string, T>();
  for (const report of reports) {
    for (const conceptScore of report.conceptScores ?? []) {
      const existing = byConcept.get(conceptScore.conceptId);
      if (!existing || conceptScore.score < existing.score) {
        byConcept.set(conceptScore.conceptId, conceptScore);
      }
    }
  }
  return [...byConcept.values()];
}

export function aggregateProseCraftReports(
  reports: Array<ProseCraftReport | undefined>,
): ProseCraftReport | undefined {
  const present = reports.filter((report): report is ProseCraftReport => Boolean(report));
  if (present.length === 0) return undefined;
  return {
    overallScore: Math.min(...present.map((report) => report.overallScore)),
    conceptScores: mergeConceptScores(present),
    issues: present.flatMap((report) => report.issues ?? []),
    sampledSceneIds: Array.from(new Set(present.flatMap((report) => report.sampledSceneIds ?? []))),
    recommendations: Array.from(new Set(present.flatMap((report) => report.recommendations ?? []))).slice(0, 5),
  };
}

export function aggregateResponsivenessReports(
  reports: Array<ResponsivenessReport | undefined>,
): ResponsivenessReport | undefined {
  const present = reports.filter((report): report is ResponsivenessReport => Boolean(report));
  if (present.length === 0) return undefined;
  return {
    overallScore: Math.min(...present.map((report) => report.overallScore)),
    conceptScores: mergeConceptScores(present),
    probeVerdicts: present.flatMap((report) => report.probeVerdicts ?? []),
    issues: present.flatMap((report) => report.issues ?? []),
    recommendations: Array.from(new Set(present.flatMap((report) => report.recommendations ?? []))).slice(0, 5),
  };
}

// ============================================
// PROSE CRAFT JUDGE
// ============================================

export type ProseCraftConceptId =
  | 'sentence_craft'
  | 'specificity_show_dont_tell'
  | 'filler_density'
  | 'rhythm_pacing'
  | 'dialogue_naturalness'
  | 'voice_style_consistency'
  | 'tone_lens_fidelity';

export const PROSE_CRAFT_CONCEPTS: ProseCraftConceptId[] = [
  'sentence_craft',
  'specificity_show_dont_tell',
  'filler_density',
  'rhythm_pacing',
  'dialogue_naturalness',
  'voice_style_consistency',
  'tone_lens_fidelity',
];

export interface ProseCraftConceptScore {
  conceptId: ProseCraftConceptId;
  score: number; // 0-100
  evidence: string;
}

export interface ProseCraftReport {
  overallScore: number;
  conceptScores: ProseCraftConceptScore[];
  issues: JudgeIssue[];
  sampledSceneIds: string[];
  recommendations: string[];
}

export interface ProseCraftJudgeInput {
  sceneContents: SceneContent[];
  storyThemes?: string[];
  targetTone?: string;
  /** B2/G7: the protagonist's identity lens (role/starting identity) the narration should perceive through. */
  protagonistLens?: string;
  /** Prompt-size budget for sampled prose; default keeps the prompt bounded. */
  maxSampleChars?: number;
}

export interface ProseSample {
  sceneId: string;
  excerpts: Array<{ beatId: string; text: string }>;
}

/**
 * Evenly sample scene prose under a character budget. Every sampled scene gets
 * an equal slice; beats are taken in order until the slice is spent, so the
 * judge sees openings AND is anchored to real beat ids for issue locations.
 * Pure; exported for tests.
 */
export function sampleSceneProse(sceneContents: SceneContent[], budgetChars: number = 14000): ProseSample[] {
  const scenes = (sceneContents ?? []).filter((scene) => Array.isArray(scene?.beats) && scene.beats.length > 0);
  if (scenes.length === 0 || budgetChars <= 0) return [];

  // Even spread: when the budget can't fit all scenes meaningfully, sample
  // every k-th scene rather than only the front of the episode.
  const minSlice = 900;
  const maxScenes = Math.max(1, Math.min(scenes.length, Math.floor(budgetChars / minSlice)));
  const step = scenes.length / maxScenes;
  const picked: SceneContent[] = [];
  for (let i = 0; i < maxScenes; i += 1) {
    picked.push(scenes[Math.min(scenes.length - 1, Math.floor(i * step))]);
  }

  const perScene = Math.floor(budgetChars / picked.length);
  return picked.map((scene) => {
    const excerpts: Array<{ beatId: string; text: string }> = [];
    let used = 0;
    for (const beat of scene.beats) {
      const text = typeof beat?.text === 'string' ? beat.text.trim() : '';
      if (!text) continue;
      if (used >= perScene) break;
      const remaining = perScene - used;
      const slice = text.length > remaining ? `${text.slice(0, Math.max(200, remaining))}…` : text;
      excerpts.push({ beatId: beat.id, text: slice });
      used += slice.length;
    }
    return { sceneId: scene.sceneId, excerpts };
  }).filter((sample) => sample.excerpts.length > 0);
}

export class ProseCraftJudge extends BaseAgent {
  constructor(config: AgentConfig) {
    super('Prose Craft Judge', config);
    this.includeSystemPrompt = true;
  }

  protected getAgentSpecificPrompt(): string {
    return `
## Your Role: Prose Craft Judge

You are a demanding fiction editor grading the WRITING itself — not plot, not
structure, not game mechanics. The text is second-person interactive fiction;
judge it as published prose.

## What You Grade (0-100 each)

- **sentence_craft**: precision, economy, active verbs, no clumsy or tangled sentences.
- **specificity_show_dont_tell**: concrete sensory detail and dramatized action over abstract summary and named emotions.
- **filler_density**: how free the prose is of padding, throat-clearing, repeated information, and generic connective tissue. 100 = no filler.
- **rhythm_pacing**: sentence-length variety, paragraph rhythm, openers that don't drone ("You… You… You…").
- **dialogue_naturalness**: speech that sounds like people, carries subtext, avoids on-the-nose exposition.
- **voice_style_consistency**: one controlled narrative voice; no register lurches or style drift between scenes.
- **tone_lens_fidelity**: the prose sustains the story's stated tonal register (all its layers, not just the easiest one) AND filters perception through the protagonist's identity lens — what they notice first and the vocabulary they reach for. When no register/lens is supplied, grade internal tonal coherence.

## Grading Bar

- 90-100: professional, publishable; a reader would not flinch anywhere.
- 75-89: solid craft with visible rough spots.
- 60-74: serviceable but noticeably flawed (filler, monotony, generic detail).
- 40-59: weak — a reader would start skimming.
- Below 40: broken prose.

Grade what is on the page. Do not award missing evidence; do not punish
subject matter. Quote a short phrase as evidence for every grade.
`;
  }

  async execute(input: ProseCraftJudgeInput): Promise<AgentResponse<ProseCraftReport>> {
    const samples = sampleSceneProse(input.sceneContents, input.maxSampleChars ?? 14000);
    if (samples.length === 0) {
      return { success: false, error: 'No scene prose available to judge.' };
    }

    console.info(`[ProseCraftJudge] Grading prose across ${samples.length} sampled scene(s)...`);

    try {
      const response = await this.callLLM(
        [{ role: 'user', content: this.buildPrompt(samples, input) }],
        4,
        { jsonSchema: buildProseCraftReportJsonSchema() },
      );
      const parsed = this.parseJSON<ProseCraftReport>(response);
      const report = this.normalizeReport(parsed, samples);
      return { success: true, data: report, rawResponse: response };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`[ProseCraftJudge] Error:`, errorMsg);
      return { success: false, error: errorMsg };
    }
  }

  private normalizeReport(report: ProseCraftReport, samples: ProseSample[]): ProseCraftReport {
    const known = new Set<string>(PROSE_CRAFT_CONCEPTS);
    const conceptScores = (Array.isArray(report.conceptScores) ? report.conceptScores : [])
      .map((entry: any) => ({
        conceptId: String(entry?.conceptId) as ProseCraftConceptId,
        score: clamp0to100(entry?.score),
        evidence: String(entry?.evidence ?? '').trim(),
      }))
      .filter((entry): entry is ProseCraftConceptScore =>
        known.has(entry.conceptId) && entry.score !== undefined);

    const issues = normalizeIssues(report.issues, known, 'sentence_craft');
    const overall = clamp0to100(report.overallScore)
      ?? (conceptScores.length > 0
        ? Math.round(conceptScores.reduce((sum, c) => sum + c.score, 0) / conceptScores.length)
        : 0);

    return {
      overallScore: overall,
      conceptScores,
      issues,
      sampledSceneIds: samples.map((sample) => sample.sceneId),
      recommendations: Array.isArray(report.recommendations)
        ? report.recommendations.map(String).slice(0, 5)
        : [],
    };
  }

  private buildPrompt(samples: ProseSample[], input: ProseCraftJudgeInput): string {
    const proseBlock = samples
      .map((sample) => {
        const beats = sample.excerpts.map((excerpt) => `[${excerpt.beatId}] ${excerpt.text}`).join('\n\n');
        return `### Scene ${sample.sceneId}\n${beats}`;
      })
      .join('\n\n');

    return `
Grade the prose craft of the following interactive-fiction excerpts.

## Story Register
- Tone: ${input.targetTone || 'unspecified'}
- Protagonist lens: ${input.protagonistLens || 'unspecified'}
- Themes: ${(input.storyThemes ?? []).join(', ') || 'unspecified'}

## Sampled Prose
${proseBlock}

## Your Task

Grade all seven concepts (sentence_craft, specificity_show_dont_tell,
filler_density, rhythm_pacing, dialogue_naturalness, voice_style_consistency,
tone_lens_fidelity) against the grading bar. Report concrete issues with
scene/beat locations for anything that pulled a grade below 75.

Respond with ONLY a valid JSON object (no prose, no markdown fences) in EXACTLY this shape:
{
  "overallScore": 74,
  "conceptScores": [
    { "conceptId": "sentence_craft", "score": 78, "evidence": "short quoted phrase or observation" }
  ],
  "issues": [
    { "severity": "error" | "warning" | "suggestion", "conceptId": "filler_density", "location": { "sceneId": "s1-2", "beatId": "s1-2-b3" }, "description": "what is weak, with a short quote", "suggestion": "how to fix it" }
  ],
  "recommendations": ["at most 3 short recommendations"]
}

Rules:
- Grade ALL seven conceptIds; scores are numbers 0-100.
- "evidence" is REQUIRED per concept: one short quote or concrete observation.
- Use "error" only for prose a reader would call broken or filler-dominated.
- At most 10 issues; one short sentence per string field.
`;
  }
}

// ============================================
// RESPONSIVENESS JUDGE (route-pair divergence)
// ============================================

export type ResponsivenessConceptId = 'choice_reflected_in_prose' | 'npc_reacts_to_player_choice';

export const RESPONSIVENESS_CONCEPTS: ResponsivenessConceptId[] = [
  'choice_reflected_in_prose',
  'npc_reacts_to_player_choice',
];

export interface ResponsivenessConceptScore {
  conceptId: ResponsivenessConceptId;
  score: number;
  evidence: string;
}

export interface ResponsivenessProbeOption {
  choiceText: string;
  reactionText?: string;
  outcomeSuccess?: string;
  outcomeFailure?: string;
  nextSceneId?: string;
  downstreamExcerpt?: string;
}

export interface ResponsivenessProbe {
  probeId: string;
  sceneId: string;
  beatId: string;
  options: ResponsivenessProbeOption[];
}

export interface ResponsivenessProbeVerdict {
  probeId: string;
  verdict: 'divergent' | 'cosmetic' | 'unclear';
  npcReaction: 'reactive' | 'static' | 'no_npcs';
  notes: string;
}

export interface ResponsivenessReport {
  overallScore: number;
  conceptScores: ResponsivenessConceptScore[];
  probeVerdicts: ResponsivenessProbeVerdict[];
  issues: JudgeIssue[];
  recommendations: string[];
}

export interface ResponsivenessJudgeInput {
  sceneContents: SceneContent[];
  choiceSets: ChoiceSet[];
  maxProbes?: number;
}

const DOWNSTREAM_EXCERPT_BEATS = 2;
const DOWNSTREAM_EXCERPT_CHARS = 450;

/**
 * Build route-pair probes: for each sampled choice point, pair every option's
 * text with what the player actually reads after picking it (reaction/outcome
 * text plus the opening prose of the routed-to scene). Branching choice sets
 * are preferred; outcome-text-only sets fill the remainder. Pure; exported for
 * tests.
 */
export function buildResponsivenessProbes(
  sceneContents: SceneContent[],
  choiceSets: ChoiceSet[],
  maxProbes: number = 6,
): ResponsivenessProbe[] {
  const sceneById = new Map<string, SceneContent>();
  (sceneContents ?? []).forEach((scene) => {
    if (scene?.sceneId) sceneById.set(scene.sceneId, scene);
  });

  const routeStateFor = (choice: ChoiceSet['choices'][number]): PlayerState => {
    const flags: Record<string, boolean> = {};
    for (const consequence of choice.consequences ?? []) {
      const raw = consequence as unknown as { type?: string; flag?: string; value?: unknown };
      if ((raw.type === 'setFlag' || raw.type === 'flag') && raw.flag) {
        flags[raw.flag] = raw.value !== false;
      }
    }
    if (choice.tintFlag) flags[choice.tintFlag] = true;
    return {
      characterName: 'Player',
      characterPronouns: 'they/them',
      attributes: { charm: 0, wit: 0, courage: 0, empathy: 0, resolve: 0, resourcefulness: 0 },
      skills: {}, relationships: {}, flags, scores: {}, tags: new Set(),
      identityProfile: { ...DEFAULT_IDENTITY_PROFILE }, pendingConsequences: [], inventory: [],
      currentStoryId: null, currentEpisodeId: null, currentSceneId: null, completedEpisodes: [],
    };
  };

  const downstreamFor = (
    nextSceneId: string | undefined,
    choice: ChoiceSet['choices'][number],
  ): string | undefined => {
    if (!nextSceneId) return undefined;
    const scene = sceneById.get(nextSceneId);
    if (!scene) return undefined;
    const routeState = routeStateFor(choice);
    const text = (scene.beats ?? [])
      .slice(0, DOWNSTREAM_EXCERPT_BEATS)
      .map((beat) => selectTextVariant(
        typeof beat?.text === 'string' ? beat.text : '',
        beat.textVariants,
        routeState,
      ))
      .join(' ')
      .trim();
    return text ? `${text.slice(0, DOWNSTREAM_EXCERPT_CHARS)}${text.length > DOWNSTREAM_EXCERPT_CHARS ? '…' : ''}` : undefined;
  };

  const toProbe = (choiceSet: ChoiceSet): ResponsivenessProbe | undefined => {
    const options = (choiceSet.choices ?? [])
      .map((choice: any): ResponsivenessProbeOption => ({
        choiceText: String(choice?.text ?? '').trim(),
        reactionText: typeof choice?.reactionText === 'string' ? choice.reactionText : undefined,
        outcomeSuccess: typeof choice?.outcomeTexts?.success === 'string' ? choice.outcomeTexts.success : undefined,
        outcomeFailure: typeof choice?.outcomeTexts?.failure === 'string' ? choice.outcomeTexts.failure : undefined,
        nextSceneId: typeof choice?.nextSceneId === 'string' ? choice.nextSceneId : undefined,
        downstreamExcerpt: downstreamFor(
          typeof choice?.nextSceneId === 'string' ? choice.nextSceneId : undefined,
          choice,
        ),
      }))
      .filter((option) => option.choiceText.length > 0);
    if (options.length < 2) return undefined;
    // A probe is only judgeable when at least two options carry downstream signal.
    const withSignal = options.filter((option) =>
      option.reactionText || option.outcomeSuccess || option.downstreamExcerpt);
    if (withSignal.length < 2) return undefined;
    return {
      probeId: `${choiceSet.sceneId ?? 'scene'}:${choiceSet.beatId}`,
      sceneId: choiceSet.sceneId ?? '',
      beatId: choiceSet.beatId,
      options,
    };
  };

  const branching: ResponsivenessProbe[] = [];
  const tinted: ResponsivenessProbe[] = [];
  (choiceSets ?? []).forEach((choiceSet) => {
    const probe = toProbe(choiceSet);
    if (!probe) return;
    const distinctRoutes = new Set(probe.options.map((option) => option.nextSceneId).filter(Boolean));
    if (distinctRoutes.size >= 2) branching.push(probe);
    else tinted.push(probe);
  });

  // Prefer true branch points, spread across distinct scenes first.
  const ordered = [...branching, ...tinted];
  const seenScenes = new Set<string>();
  const spread: ResponsivenessProbe[] = [];
  const rest: ResponsivenessProbe[] = [];
  ordered.forEach((probe) => {
    if (probe.sceneId && !seenScenes.has(probe.sceneId)) {
      seenScenes.add(probe.sceneId);
      spread.push(probe);
    } else {
      rest.push(probe);
    }
  });
  return [...spread, ...rest].slice(0, Math.max(1, maxProbes));
}

export class ResponsivenessJudge extends BaseAgent {
  constructor(config: AgentConfig) {
    super('Responsiveness Judge', config);
    this.includeSystemPrompt = true;
  }

  protected getAgentSpecificPrompt(): string {
    return `
## Your Role: Responsiveness Judge

You audit whether the story WORLD actually responds to the player. For each
probe you get one choice point and, per option, everything the player reads
after picking it (reaction, outcome text, the opening of the routed-to scene).

## What You Judge

### Per probe
- **divergent**: the options lead to materially different reading experiences —
  different events, information, relationship beats, or consequences the
  prose acknowledges.
- **cosmetic**: the options' aftermath reads interchangeably; swap the texts
  and nothing breaks. Same events, same NPC behavior, tone-only differences.
- **unclear**: not enough text to tell.

### NPC reaction
- **reactive**: an NPC's behavior, dialogue, or attitude visibly changes based
  on what the player chose.
- **static**: NPCs behave identically regardless of the choice.
- **no_npcs**: no NPCs in the aftermath text.

## Grades (0-100)

- **choice_reflected_in_prose**: fraction-weighted judgment of how much the
  downstream PROSE (not flags, not metadata) carries the choice. 90+ only when
  nearly every probe is divergent with specific, remembered consequences.
- **npc_reacts_to_player_choice**: how alive NPC behavior is to player action.
  90+ only when NPCs visibly register the player's choices across probes.

Judge only the text given. Metadata, flags, and stat changes DO NOT COUNT —
if the reader can't feel the difference on the page, it isn't responsive.
`;
  }

  async execute(input: ResponsivenessJudgeInput): Promise<AgentResponse<ResponsivenessReport>> {
    const probes = buildResponsivenessProbes(input.sceneContents, input.choiceSets, input.maxProbes ?? 6);
    if (probes.length === 0) {
      return { success: false, error: 'No judgeable choice probes (need 2+ options with downstream text).' };
    }

    console.info(`[ResponsivenessJudge] Judging ${probes.length} choice probe(s)...`);

    try {
      const response = await this.callLLM(
        [{ role: 'user', content: this.buildPrompt(probes) }],
        4,
        { jsonSchema: buildResponsivenessReportJsonSchema() },
      );
      const parsed = this.parseJSON<ResponsivenessReport>(response);
      const report = this.normalizeReport(parsed, probes);
      return { success: true, data: report, rawResponse: response };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`[ResponsivenessJudge] Error:`, errorMsg);
      return { success: false, error: errorMsg };
    }
  }

  private normalizeReport(report: ResponsivenessReport, probes: ResponsivenessProbe[]): ResponsivenessReport {
    const known = new Set<string>(RESPONSIVENESS_CONCEPTS);
    const conceptScores = (Array.isArray(report.conceptScores) ? report.conceptScores : [])
      .map((entry: any) => ({
        conceptId: String(entry?.conceptId) as ResponsivenessConceptId,
        score: clamp0to100(entry?.score),
        evidence: String(entry?.evidence ?? '').trim(),
      }))
      .filter((entry): entry is ResponsivenessConceptScore =>
        known.has(entry.conceptId) && entry.score !== undefined);

    const probeIds = new Set(probes.map((probe) => probe.probeId));
    const probeVerdicts = (Array.isArray(report.probeVerdicts) ? report.probeVerdicts : [])
      .map((entry: any): ResponsivenessProbeVerdict => ({
        probeId: String(entry?.probeId ?? ''),
        verdict: entry?.verdict === 'divergent' || entry?.verdict === 'cosmetic' ? entry.verdict : 'unclear',
        npcReaction: entry?.npcReaction === 'reactive' || entry?.npcReaction === 'static' ? entry.npcReaction : 'no_npcs',
        notes: String(entry?.notes ?? '').trim(),
      }))
      .filter((entry) => probeIds.has(entry.probeId));

    const issues = normalizeIssues(report.issues, known, 'choice_reflected_in_prose');
    const overall = clamp0to100(report.overallScore)
      ?? (conceptScores.length > 0
        ? Math.round(conceptScores.reduce((sum, c) => sum + c.score, 0) / conceptScores.length)
        : 0);

    return {
      overallScore: overall,
      conceptScores,
      probeVerdicts,
      issues,
      recommendations: Array.isArray(report.recommendations)
        ? report.recommendations.map(String).slice(0, 5)
        : [],
    };
  }

  private buildPrompt(probes: ResponsivenessProbe[]): string {
    const probeBlock = probes
      .map((probe) => {
        const options = probe.options
          .map((option, index) => {
            const parts = [
              `  Option ${index + 1}: "${option.choiceText}"`,
              option.reactionText ? `    Reaction: ${option.reactionText}` : '',
              option.outcomeSuccess ? `    Outcome (success): ${option.outcomeSuccess}` : '',
              option.outcomeFailure ? `    Outcome (failure): ${option.outcomeFailure}` : '',
              option.nextSceneId ? `    Routes to: ${option.nextSceneId}` : '',
              option.downstreamExcerpt ? `    Next-scene opening: ${option.downstreamExcerpt}` : '',
            ];
            return parts.filter(Boolean).join('\n');
          })
          .join('\n');
        return `### Probe ${probe.probeId} (scene ${probe.sceneId}, beat ${probe.beatId})\n${options}`;
      })
      .join('\n\n');

    return `
Judge how responsively this story reacts to player choices.

## Choice Probes
${probeBlock}

## Your Task

Give a verdict per probe, then grade the two concepts across all probes.

Respond with ONLY a valid JSON object (no prose, no markdown fences) in EXACTLY this shape:
{
  "overallScore": 62,
  "conceptScores": [
    { "conceptId": "choice_reflected_in_prose", "score": 60, "evidence": "short observation citing a probe" },
    { "conceptId": "npc_reacts_to_player_choice", "score": 45, "evidence": "short observation citing a probe" }
  ],
  "probeVerdicts": [
    { "probeId": "s1-2:b3", "verdict": "divergent" | "cosmetic" | "unclear", "npcReaction": "reactive" | "static" | "no_npcs", "notes": "one sentence" }
  ],
  "issues": [
    { "severity": "error" | "warning" | "suggestion", "conceptId": "choice_reflected_in_prose", "location": { "sceneId": "s1-2", "beatId": "b3" }, "description": "which options read interchangeably and why", "suggestion": "how to differentiate them" }
  ],
  "recommendations": ["at most 3 short recommendations"]
}

Rules:
- Grade BOTH conceptIds; include a verdict for EVERY probe (use the exact probeId given).
- Use "error" severity when a choice framed as consequential reads cosmetically.
- One short sentence per string field; at most 8 issues.
`;
  }
}
