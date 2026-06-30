/**
 * Source Material Analyzer Agent
 *
 * Analyzes novels and long-form source material to:
 * - Identify story structure, acts, and key plot points
 * - Estimate how many episodes the story requires
 * - Create episode-by-episode breakdown
 * - Map characters, locations, and narrative arcs
 *
 * This agent runs BEFORE the main generation pipeline to scope the work.
 */

import { AgentConfig } from '../config';
import { BaseAgent, AgentResponse } from './BaseAgent';
import { slugify } from '../utils/idUtils';
import {
  SourceMaterialAnalysis,
  EpisodeOutline,
  StoryArc,
  PlotPoint,
  EndingMode,
  StoryAnchors,
  StoryCircleRoleAssignment,
  StoryCircleStructure,
  StorySchemaAbstraction,
  ThemeArgumentContract,
  WritingStyleGuide,
  DirectLanguageFragmentGroups,
  CharacterFashionStyle,
  CharacterArchitecture,
  CharacterArcMode,
  TreatmentSeasonGuidance,
  STORY_CIRCLE_BEATS,
} from '../../types/sourceAnalysis';
import {
  STORY_CIRCLE_BEAT_DEFINITION_LINES,
  STORY_CIRCLE_GEOMETRY_PRINCIPLES,
  checkStoryCircleCoverage,
  describeStoryCircleDistribution,
  distributeStoryCircle,
} from '../utils/storyCircleDistribution';
import { clampSceneCount } from '../../constants/pipeline';
import {
  buildAnalysisFromEndingSeeds,
  normalizeEndingTargets,
} from '../utils/endingResolver';
import { buildCharacterTreatmentContracts } from '../utils/characterTreatmentContracts';
import { buildStakesArchitectureContracts } from '../utils/stakesArchitectureContracts';
import { buildStoryCircleBeatContracts } from '../utils/storyCircleBeatContracts';
import {
  arcGuidanceId,
  buildArcPressureContracts,
} from '../utils/arcPressureContracts';
import { buildWorldTreatmentContracts } from '../utils/worldTreatmentContracts';
import { buildBranchConsequenceContracts } from '../utils/branchConsequenceContracts';
import { buildEndingRealizationContracts } from '../utils/endingRealizationContracts';
import { buildFailureModeAuditContracts } from '../utils/failureModeAuditContracts';
import { extractTreatmentFromMarkdown, looksLikeTreatmentMarkdown } from '../utils/treatmentExtraction';
import { buildLockedStoryCanon } from '../utils/sourceCanonBuilder';
import {
  BRANCH_AND_BOTTLENECK,
  STAKES_TRIANGLE,
  CHOICE_DENSITY_REQUIREMENTS,
} from '../prompts/storytellingPrinciples';
import { SOURCE_ANALYSIS_ABSTRACTION_EXAMPLE } from '../prompts/examples/storyCraftExamples';
import { mapOrderedWithConcurrency } from '../utils/concurrency';

/**
 * Minimum season length at which {@link SourceMaterialAnalyzer.createEpisodeBreakdown}
 * fans the breakdown out into one focused call per episode. Below this, the
 * single all-at-once call comfortably fits the maxTokens ceiling (~350 output
 * tokens/episode against 4096), so we keep total LLM calls minimal ("avoid more
 * calls where possible"). At/above it (the 10-episode-treatment case that was
 * crowding the ceiling and truncating), the per-episode path buys each episode
 * its own token headroom and parallelism. 6 ≈ where output starts pressuring the
 * budget; tune if maxTokens changes.
 */
const PER_EPISODE_BREAKDOWN_MIN_EPISODES = 6;
/** Bounded concurrency for the per-episode breakdown fan-out. */
const PER_EPISODE_BREAKDOWN_CONCURRENCY = 3;

function describeSuggestedStoryCircleDistribution(totalEpisodes: number): string {
  const entries = distributeStoryCircle(totalEpisodes);
  return describeStoryCircleDistribution(entries);
}

function normalizeStoryCircleRoleAssignments(value: unknown): StoryCircleRoleAssignment[] {
  if (!Array.isArray(value)) return [];
  const roles: StoryCircleRoleAssignment[] = [];
  for (const item of value) {
    const beat = typeof item === 'string'
      ? item
      : typeof item?.beat === 'string'
        ? item.beat
        : undefined;
    if (!beat || !(STORY_CIRCLE_BEATS as readonly string[]).includes(beat)) continue;
    const roleKind = item?.roleKind === 'expansion' ? 'expansion' : 'primary';
    roles.push({
      beat: beat as StoryCircleRoleAssignment['beat'],
      roleKind,
      expansionOfUnit: typeof item?.expansionOfUnit === 'number' ? item.expansionOfUnit : undefined,
      source: item?.source === 'treatment' || item?.source === 'migration' || item?.source === 'distribution'
        ? item.source
        : 'llm',
    });
  }
  return roles;
}

function treatmentStoryCircleRoles(raw: string | undefined): StoryCircleRoleAssignment[] {
  if (!raw) return [];
  const lower = raw.toLowerCase();
  const roleKind: StoryCircleRoleAssignment['roleKind'] = /\bexpansion\b/.test(lower) ? 'expansion' : 'primary';
  return STORY_CIRCLE_BEATS
    .filter((beat) => new RegExp(`\\b${beat}\\b`, 'i').test(raw))
    .map((beat) => ({
      beat,
      roleKind,
      source: 'treatment',
    }));
}

function buildTreatmentInputNotice(sourceText: string): string {
  const treatment = extractTreatmentFromMarkdown(sourceText || '');
  if (!treatment.isTreatment) return '';
  const episodeCount = Object.keys(treatment.episodes).length;
  const endingCount = treatment.endings.length;
  const parsedSections = treatment.seasonGuidance?.rawSectionSummary?.join(', ') || 'episode guidance';
  const isLite = treatment.metadata.formatVersion === 'story-treatment-lite'
    || treatment.seasonGuidance?.treatmentMode === 'lite';
  return `
## StoryRPG Treatment Input Detected

The supplied document is a user-authored StoryRPG treatment, not generic prose source material. Treat its episode outline, structural roles, and endings as authored planning constraints.

- Preserve the treatment's episode count/order/titles unless an explicit user instruction overrides them.
- Preserve lite treatment facts as canonical seed material when the format is story-treatment-lite.
- For lite treatments, derive missing episode turns, encounter anchors, choice pressures, branches, consequence seeds, ending drivers, and detailed arc pressure from the authored premise, Story Circle spine, story arcs, protagonist/NPC/world facts, episode descriptions, and alternate endings.
- Derived lite details must not contradict authored lite facts; keep the derived material aligned to the original Story Circle anchors, polarity tensions, and story arcs.
- Preserve detailed episode turns as planning intent when present; do not require them from lite treatments and do not create a new runtime episode-turn schema.
- Preserve season-level treatment sections when present: season promise, character architecture, stakes architecture, information ledger, story arcs/arc plan, branch/consequence chains, fail-forward, endings, and failure-mode audit.
- Preserve encounter anchors, aftermath/consequence, ending pressure, branch guidance, and finale resolution/aftermath guidance when present; derive them from lite fields when omitted.
- Preserve exactly authored endings when present.
- Infer missing characters, locations, anchors, and style only where the treatment leaves gaps.
- Use the canonical StoryRPG scene range: 3-6 scenes per episode.

Detected treatment metadata: ${treatment.metadata.formatVersion}${isLite ? ' canonical seed' : ''}, ${treatment.metadata.confidence} confidence, ${episodeCount} parsed unit(s), ${endingCount} ending(s), parsed sections: ${parsedSections}.
`;
}

// Input for the analyzer
export interface SourceMaterialInput {
  // The source text to analyze
  sourceText?: string;

  // Manual prompt or additional instructions
  userPrompt?: string;

  // Advisory generator-side retrieval context. Typed artifacts remain authoritative.
  memoryContext?: string;

  // Optional metadata
  title?: string;
  author?: string;

  // User preferences
  preferences?: {
    // Target episode length (scenes per episode)
    targetScenesPerEpisode?: number; // Default: 6
    // Target choices per episode
    targetChoicesPerEpisode?: number; // Default: 3
    // Pacing preference
    pacing?: 'tight' | 'moderate' | 'expansive';
    // Optional override for how the pipeline should target endings downstream
    endingMode?: EndingMode;
    // When true, structural treatment-integrity warnings (non-contiguous episode
    // numbering; heading-count > parsed-count) become a thrown error instead of a
    // warning. Default OFF (opt-in per run). Phase 0 / Step 0.2.
    strictTreatmentValidation?: boolean;
  };
}

// Intermediate analysis structure
interface StoryStructureAnalysis {
  genre: string;
  tone: string;
  themes: string[];
  setting: {
    timePeriod: string;
    location: string;
    worldDetails: string;
  };
  protagonist: {
    name: string;
    description: string;
    arc: string;
    fashionStyle?: Partial<CharacterFashionStyle>;
  };
  majorCharacters: Array<{
    name: string;
    role: string;
    description: string;
    importance: string;
    fashionStyle?: Partial<CharacterFashionStyle>;
  }>;
  characterArchitecture?: {
    protagonist?: Partial<CharacterArchitecture['protagonist']>;
    supportingCharacters?: Array<Partial<CharacterArchitecture['supportingCharacters'][number]>>;
  };
  keyLocations: Array<{
    name: string;
    description: string;
    importance: string;
  }>;
  directLanguageFragments: {
    dialogue: string[];
    prose: string[];
    terminology: string[];
  };
  adaptationGuidance?: {
    narrativeVoice: string;
    dialogueStyle?: string;
    toneNotes?: string;
    keyThemesToPreserve: string[];
    iconicMoments: string[];
    elementsToPreserve?: string[];
    elementsToAdapt?: string[];
  };
  writingStyleGuide?: Partial<WritingStyleGuide>;
  storyArcs: Array<{
    name: string;
    description: string;
    chapters: string;
  }>;
  majorPlotPoints: Array<{
    description: string;
    type: string;
    importance: string;
    approximatePosition: string; // "early", "middle", "late", or percentage
  }>;
  estimatedScope: {
    complexity: 'simple' | 'moderate' | 'complex' | 'epic';
    estimatedEpisodes: number;
    reasoning: string;
  };
  /**
   * Four narrative anchors inferred from the source material. Optional on
   * the LLM response shape because older saved responses predate this
   * field; {@link assembleAnalysis} backfills a best-effort anchor block
   * from the plot-point list when the LLM omits it.
   */
  anchors?: StoryAnchors;
  /**
   * Eight-beat Story Circle map inferred from the source material. This is the
   * primary macro structure for new pipeline output.
   */
  storyCircle?: StoryCircleStructure;
  schemaAbstraction?: StorySchemaAbstraction;
  themeArgument?: Partial<ThemeArgumentContract>;
  endingAnalysis?: {
    detectedMode: EndingMode;
    reasoning: string;
    explicitEndings: Array<{
      id?: string;
      name: string;
      summary: string;
      emotionalRegister?: string;
      themePayoff?: string;
      stateDrivers?: Array<{
        type?: string;
        label?: string;
        details?: string;
      }>;
      targetConditions?: string[];
    }>;
  };
}

function summarizeTreatmentSeasonGuidance(guidance?: TreatmentSeasonGuidance): string {
  if (!guidance) return '';
  const sections = guidance.rawSectionSummary?.join(', ') || 'season treatment sections';
  const mode = guidance.treatmentMode === 'lite' ? 'lite treatment seed' : 'treatment';
  return `Treatment season guidance detected (${mode}): ${sections}`;
}

/**
 * A single episode's outline as returned by either the all-at-once breakdown
 * call (inside {@link EpisodeBreakdownResponse.episodes}) or a focused
 * per-episode call (see {@link SingleEpisodeBreakdownResponse}).
 */
interface EpisodeBreakdownEntry {
  episodeNumber: number;
  title: string;
  synopsis: string;
  sourceChapters: string;
  plotPoints: string[];
  mainCharacters: string[];
  locations: string[];
  narrativeArc: {
    setup: string;
    conflict: string;
    resolution: string;
  };
  storyCircleRole?: StoryCircleRoleAssignment[];
}

interface EpisodeBreakdownResponse {
  episodes: EpisodeBreakdownEntry[];
  totalEpisodes: number;
  breakdownNotes: string;
}

/**
 * Shape returned by a single per-episode breakdown call. The model is asked
 * for exactly one episode's outline (no surrounding `episodes` array), which
 * gives each call the full maxTokens ceiling and avoids the truncation risk
 * of asking for all N at once. {@link createEpisodeBreakdown} normalizes the
 * `episode`-wrapped and bare-object forms into a single {@link EpisodeBreakdownEntry}.
 */
interface SingleEpisodeBreakdownResponse {
  episode?: Partial<EpisodeBreakdownEntry>;
  episodeNumber?: number;
  title?: string;
  synopsis?: string;
  sourceChapters?: string;
  plotPoints?: string[];
  mainCharacters?: string[];
  locations?: string[];
  narrativeArc?: {
    setup?: string;
    conflict?: string;
    resolution?: string;
  };
  storyCircleRole?: StoryCircleRoleAssignment[];
}

export class SourceMaterialAnalyzer extends BaseAgent {
  private defaultScenesPerEpisode = 6;
  private defaultChoicesPerEpisode = 4; // Increased to ensure choices in at least half of scenes

  constructor(config: AgentConfig) {
    super('Source Material Analyzer', config);
    this.includeSystemPrompt = true;
  }

  protected getAgentSpecificPrompt(): string {
    return `
## Your Role: Source Material Analyzer

You are an expert story analyst who breaks down novels and long-form narratives into interactive fiction episodes. Your job is to understand the source material's structure and create a detailed episode-by-episode breakdown.

## IP Research & Direct Language
If the user provides the name of a book, movie, or other story IP (e.g., "The Great Gatsby", "The Matrix"):
1. **Identify the IP**: Recognize if the title or prompt refers to a known story.
2. **Pull Direct Language**: Recall and include specific, iconic dialogue fragments, prose descriptions, and key terminology from the source.
3. **Analyze Adaptation**: Explain how the original story's linear beats should be converted into interactive moments while maintaining the original's unique "voice".

## Interactive Fiction Constraints

Each episode should:
- Have 3-6 scenes (bottleneck + branch zones)
- Include 2-4 meaningful player choices
- Cover a complete narrative arc (setup → conflict → resolution)
- Take approximately 15-30 minutes to play

${BRANCH_AND_BOTTLENECK}

${STAKES_TRIANGLE}

## Episode Sizing Guidelines

When breaking down source material:
- One chapter ≠ one episode (chapters vary too much)
- Focus on NARRATIVE BEATS, not page count
- Each episode needs a clear "mini-arc" with stakes
- Major plot points should land at episode climaxes
- Character introductions need breathing room
- Don't rush - players need time to inhabit the story

## Complexity Estimation

- **Simple** (3-5 episodes): Single plotline, few characters, linear progression
- **Moderate** (6-10 episodes): Multiple subplots, ensemble cast, some branching
- **Complex** (11-20 episodes): Multiple interwoven arcs, large cast, significant player agency
- **Epic** (20+ episodes): Saga-level scope, multiple volumes/books worth

## Analysis Process

1. First Pass: Identify overall structure (acts, major arcs)
2. Second Pass: Map plot points and character beats
3. Third Pass: Chunk into episode-sized narrative units
4. Final Pass: Verify each episode has proper stakes and structure

## Reusable Story Abstraction

When analyzing a known story, infer transferable story patterns without
creating a second runtime schema. Capture archetype, reusable variables, and
generalization guidance as optional analysis metadata that feeds StoryRPG's
existing SourceMaterialAnalysis, SeasonPlan, Episode, Scene, Beat, Choice, and
Encounter contracts.

- Preserve StoryRPG's anchors and storyCircle fields as the authoritative macro structure.
- Use PascalCase names for reusable variables.
- Include variables such as ProtagonistRole, Stakes, Goal, IncitingIncident,
  AntagonizingForce, CoreValue, EmotionalAnchor, Temptation, FalseVictory,
  Cost, Climax, and Legacy when they apply.
- Generalize time/place/IP-specific elements into flexible roles.
- Never let {Variable} placeholders appear in final player-facing prose.

## Theme Argument / Resonance Contract

Infer one consolidated theme argument, not separate competing concepts:
- themeQuestion asks what the story tests through pressure and choice.
- controllingIdea is the value + cause answer earned at the climax.
- counterIdea is the strongest opposing answer and must be genuinely persuasive.
- valueLadder names positive, contrary, contradiction, and negation-of-negation.
- resonance is the climax/payoff/image-system result, not a standalone plot lane.
- Do not put these labels in player-facing prose; they guide downstream agents.

${SOURCE_ANALYSIS_ABSTRACTION_EXAMPLE}
`;
  }

  async execute(
    input: SourceMaterialInput,
    options?: { signal?: AbortSignal }
  ): Promise<AgentResponse<SourceMaterialAnalysis>> {
    console.log(`[SourceMaterialAnalyzer] Starting analysis of source material...`);
    // Scope the timeout/abort signal to this whole multi-call analysis. Every
    // callLLM below falls back to this (see BaseAgent.activeAbortSignal), so a
    // withTimeoutAbort timeout cancels the in-flight call and halts retries
    // instead of leaving the work to run on in the background. Cleared in finally.
    this.activeAbortSignal = options?.signal;

    const targetScenes = clampSceneCount(input.preferences?.targetScenesPerEpisode || this.defaultScenesPerEpisode);
    const targetChoices = input.preferences?.targetChoicesPerEpisode || this.defaultChoicesPerEpisode;
    const pacing = input.preferences?.pacing || 'moderate';
    const userPromptWithMemory = input.memoryContext
      ? [input.userPrompt || '', input.memoryContext].filter(Boolean).join('\n\n')
      : input.userPrompt;
    const extractedTreatment = extractTreatmentFromMarkdown(input.sourceText || '');
    if (extractedTreatment.isTreatment) {
      console.log(
        `[SourceMaterialAnalyzer] Detected StoryRPG treatment (${extractedTreatment.metadata.formatVersion}, ` +
        `${extractedTreatment.metadata.confidence} confidence, ${Object.keys(extractedTreatment.episodes).length} episodes, ` +
        `${extractedTreatment.endings.length} endings)`
      );
      for (const warning of extractedTreatment.metadata.warnings) {
        console.warn(`[SourceMaterialAnalyzer] Treatment warning: ${warning}`);
      }
    }

    try {
      // Step 1: Analyze overall story structure
      console.log(`[SourceMaterialAnalyzer] Step 1: Analyzing story structure...`);
      const explicitWritingStyleInstruction = detectExplicitWritingStyleInstruction(input.userPrompt);
      const structureAnalysis = await this.analyzeStoryStructure(
        input.sourceText || '',
        input.title,
        userPromptWithMemory,
        explicitWritingStyleInstruction
      );

      console.log(`[SourceMaterialAnalyzer] Found ${structureAnalysis.majorPlotPoints.length} major plot points`);
      console.log(`[SourceMaterialAnalyzer] Estimated complexity: ${structureAnalysis.estimatedScope.complexity}`);
      console.log(`[SourceMaterialAnalyzer] Initial estimate: ${structureAnalysis.estimatedScope.estimatedEpisodes} episodes`);

      // Step 2: Create detailed episode breakdown
      console.log(`[SourceMaterialAnalyzer] Step 2: Creating episode breakdown...`);
      const episodeBreakdown = await this.createEpisodeBreakdown(
        input.sourceText || '',
        structureAnalysis,
        { targetScenes, targetChoices, pacing },
        userPromptWithMemory
      );

      console.log(`[SourceMaterialAnalyzer] Created ${episodeBreakdown.episodes.length} episode outlines`);

      // Step 3: Assemble final analysis
      const analysis = this.assembleAnalysis(
        input,
        structureAnalysis,
        episodeBreakdown
      );

      return {
        success: true,
        data: analysis,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`[SourceMaterialAnalyzer] Error:`, errorMsg);
      return {
        success: false,
        error: errorMsg,
      };
    } finally {
      this.activeAbortSignal = undefined;
    }
  }

  /**
   * Parse an analysis JSON response, with ONE focused compact retry. The structure
   * analysis and the single-call episode breakdown are heavy LAST-RESORT outputs (no
   * further fallback): a malformed (an unescaped quote → "Expected ',' or '}'") or
   * truncated parse propagates to execute() → success:false → the whole run aborts
   * before generation even starts. A retry asking for the SAME content COMPACTLY and
   * strictly-escaped is far more likely to parse. Only fires on failure/truncation, so
   * a clean first response — including every golden/_transportOverride run — keeps the
   * single-call path; a still-failing retry rethrows, preserving the existing abort.
   */
  private async parseAnalysisWithCompactRetry<T>(basePrompt: string, firstResponse: string, label: string): Promise<T> {
    try {
      const parsed = this.parseJSON<T>(firstResponse);
      if (!this.wasLastResponseTruncated()) return parsed;
      console.warn(`[SourceMaterialAnalyzer] ${label}: response parsed but truncation dropped content — retrying with a compact-output directive.`);
    } catch (parseError) {
      const msg = parseError instanceof Error ? parseError.message : String(parseError);
      console.warn(`[SourceMaterialAnalyzer] ${label}: JSON parse failed (${msg.slice(0, 120)}) — retrying with a compact, strictly-valid JSON directive.`);
    }
    const compactPrompt =
      `${basePrompt}\n\n` +
      `IMPORTANT: your previous response was not valid JSON (a malformed or over-long object — likely an unescaped ` +
      `quote inside a string, or it was cut off). Re-emit the COMPLETE result as ONE strictly-valid JSON object: ` +
      `escape every double-quote inside a string value as \\", no raw line breaks inside strings, no trailing commas, ` +
      `and keep every field tight so the whole object fits. Return only the JSON.`;
    const response = await this.callLLM([{ role: 'user', content: compactPrompt }]);
    return this.parseJSON<T>(response); // rethrows on failure → caller's catch → execute() returns success:false
  }

  /**
   * First pass: Analyze overall story structure
   */
  private async analyzeStoryStructure(
    sourceText: string,
    title?: string,
    userPrompt?: string,
    explicitWritingStyleInstruction?: string
  ): Promise<StoryStructureAnalysis> {
    // Truncate source text if too long for single analysis
    const maxChars = 100000; // ~25k tokens
    const truncatedText = sourceText.length > maxChars
      ? sourceText.substring(0, maxChars) + '\n\n[... text truncated for analysis ...]'
      : sourceText;

    const prompt = `
Analyze the following source material and extract its story structure.

${title ? `**Title**: ${title}` : ''}

${userPrompt ? `**User Instructions/Prompt**:
${userPrompt}

` : ''}
**Writing Style Detection**:
${explicitWritingStyleInstruction
  ? `The user explicitly described the prose/writing style. Treat this as AUTHORITATIVE and preserve it in writingStyleGuide.source = "explicit_prompt".
Explicit prose instruction: "${explicitWritingStyleInstruction}"`
  : `No explicit prose/writing-style instruction was detected in the user prompt. Infer a writing style guide from the supplied material, direct language, genre, tone, and narrative voice; set writingStyleGuide.source = "inferred_from_material".`}

${truncatedText ? `**Source Material**:
${truncatedText}` : '*(No source material provided, use the User Instructions/Prompt as the only source)*'}

${buildTreatmentInputNotice(sourceText)}

Analyze this text and respond with JSON:

Theme guidance: if the source only provides nouns like "family", "power", or
"grief", convert the lead theme into a playable question in the themes array
(for example, "What do you owe family when loyalty costs your selfhood?").
Keep any additional supporting themes concise.

Story Circle canonical beat definitions. Use these exact meanings when filling
the storyCircle object. Do not replace them with one-line labels:
${STORY_CIRCLE_BEAT_DEFINITION_LINES.join('\n')}

Story Circle shape principles. Enforce these concepts when filling storyCircle,
episodeBreakdown.storyCircleRole, character arc notes, and cliffhanger setup:
${STORY_CIRCLE_GEOMETRY_PRINCIPLES.join('\n')}

{
  "genre": "<primary genre>",
  "tone": "<overall tone: dark, light, dramatic, comedic, etc.>",
  "themes": ["<theme1>", "<theme2>", ...],
  "setting": {
    "timePeriod": "<when the story takes place>",
    "location": "<where the story takes place>",
    "worldDetails": "<key world-building elements>"
  },
  "protagonist": {
    "name": "<protagonist name>",
    "description": "<brief description>",
    "arc": "<what they learn/how they change>",
    "fashionStyle": {
      "styleSummary": "<1 sentence describing this character's clothing silhouette and fashion identity; omit only if the source gives no cue>",
      "styleTags": ["<fashion/wardrobe keywords, not art-style keywords>"],
      "signatureGarments": ["<recurring garments or outfit pieces>"],
      "materials": ["<fabric/material cues>"],
      "colorPalette": ["<character-specific clothing colors>"],
      "accessories": ["<worn or carried accessories>"],
      "sourceEvidence": ["<short source/prompt evidence for this fashion read>"]
    }
  },
  "characterArchitecture": {
    "protagonist": {
      "lie": "<false/protective belief about self or world; agent-facing only>",
      "originPressure": "<formative event, pressure, loss, humiliation, betrayal, deprivation, success, vow, social condition, or survival adaptation that made the Lie useful>",
      "truth": "<what the protagonist must recognize to grow, or refuse in a tragic arc>",
      "want": "<conscious goal the protagonist pursues>",
      "need": "<deeper dramatic necessity that differs from the Want>",
      "arcMode": "<positive/tragic/ambiguous>",
      "climaxChoice": {
        "choiceQuestion": "<active climax choice phrased as a question>",
        "integrateTruthOption": "<what choosing the Truth looks like in action>",
        "recommitLieOption": "<what recommitting to the Lie looks like in action>",
        "activeChoiceMechanism": "<how the protagonist/player actively makes this choice through sacrifice, refusal, revelation, relationship leverage, risk, or commitment>"
      }
    },
    "supportingCharacters": [
      {
        "characterName": "<major/core supporting character name, not every NPC>",
        "microLie": "<scaled false/protective belief>",
        "originPressure": "<optional origin pressure>",
        "truthOrCounterPressure": "<truth, counter-belief, or pressure this character embodies>",
        "screenTimeTier": "<major/supporting/minor>",
        "pressureRole": "<mirror/foil/temptation/warning/ally/antagonist>",
        "protagonistVisibleSignals": ["<behavior, choice, secret, contradiction, or relationship signal visible to protagonist>"],
        "plannedResolution": "<optional resolution or open pressure>"
      }
    ]
  },
  "majorCharacters": [
    DO NOT include the protagonist here — they are already listed above.
    Only list OTHER characters (NPCs) in this array.
    {
      "name": "<name>",
      "role": "<antagonist/ally/mentor/love_interest/rival/neutral>",
      "description": "<brief description>",
      "importance": "<core/supporting/background>",
      "fashionStyle": {
        "styleSummary": "<1 sentence describing this character's clothing silhouette and fashion identity; omit only if the source gives no cue>",
        "styleTags": ["<fashion/wardrobe keywords, not art-style keywords>"],
        "signatureGarments": ["<recurring garments or outfit pieces>"],
        "materials": ["<fabric/material cues>"],
        "colorPalette": ["<character-specific clothing colors>"],
        "accessories": ["<worn or carried accessories>"],
        "sourceEvidence": ["<short source/prompt evidence for this fashion read>"]
      }
    }
  ],
  "keyLocations": [
    {
      "name": "<location name>",
      "description": "<brief description>",
      "importance": "<major/minor/backdrop>"
    }
  ],
  "directLanguageFragments": {
    "dialogue": ["<iconic dialogue line 1>", "<iconic dialogue line 2>", ...],
    "prose": ["<notable descriptive sentence 1>", "<notable descriptive sentence 2>", ...],
    "terminology": ["<unique IP terms>", "<slang/jargon from world>", ...]
  },
  "adaptationGuidance": {
    "narrativeVoice": "<describe the unique authorial voice/style to replicate>",
    "toneNotes": "<how the tone should feel in prose>",
    "dialogueStyle": "<how characters should speak>",
    "keyThemesToPreserve": ["<theme 1>", "<theme 2>", ...],
    "iconicMoments": ["<list must-have moments from source>", ...],
    "elementsToPreserve": ["<voice/story elements to preserve>", ...],
    "elementsToAdapt": ["<elements that should be adapted for interactive fiction>", ...]
  },
  "writingStyleGuide": {
    "source": "${explicitWritingStyleInstruction ? 'explicit_prompt' : 'inferred_from_material'}",
    "summary": "<one-sentence prose style contract>",
    "narrativeVoice": "<authorial stance, texture, emotional register>",
    "sentenceRhythm": "<typical sentence length, cadence, variation>",
    "diction": "<word choice: plain/literary/period/slang/technical/etc.>",
    "dialogueStyle": "<dialogue texture and subtext rules>",
    "povAndDistance": "<point of view and how emotion is externalized through action, dialogue, silence, body language, facial expression, object handling, proximity, avoidance, and choice behavior>",
    "imageryAndSensoryFocus": "<dominant sensory palette and image logic>",
    "pacing": "<how prose should move during action, quiet moments, reveals>",
    "doList": ["<specific prose move to use>", "<specific prose move to use>"],
    "avoidList": ["<specific prose habit to avoid>", "<specific prose habit to avoid>"],
    "evidence": ["<short source/prompt evidence for the style decision>"]
  },
  "storyArcs": [
    {
      "name": "<arc name>",
      "description": "<what happens in this arc>",
      "chapters": "<which chapters/sections this covers>"
    }
  ],
  "majorPlotPoints": [
    {
      "description": "<what happens>",
      "type": "<inciting_incident/rising_action/midpoint/climax/resolution/twist/revelation>",
      "importance": "<critical/major/minor>",
      "approximatePosition": "<early/middle/late or percentage>"
    }
  ],
  "estimatedScope": {
    "complexity": "<simple/moderate/complex/epic>",
    "estimatedEpisodes": <number>,
    "reasoning": "<why this estimate>"
  },
  "anchors": {
    "stakes": "<what the protagonist cares about most — person, people, place, thing, or concept — in 1-2 sentences>",
    "goal": "<what the protagonist feels compelled to achieve, in 1-2 sentences>",
    "incitingIncident": "<the event that sets the story in motion, in 1-2 sentences>",
    "climax": "<the turning-point confrontation where the protagonist faces their greatest challenge, in 1-2 sentences>"
  },
  "storyCircle": {
    "you": "<source-specific realization of \`you\`; must satisfy the full \`you\` definition above>",
    "need": "<source-specific realization of \`need\`; must satisfy the full \`need\` definition above>",
    "go": "<source-specific realization of \`go\`; must satisfy the full \`go\` definition above>",
    "search": "<source-specific realization of \`search\`; must satisfy the full \`search\` definition above>",
    "find": "<source-specific realization of \`find\`; must satisfy the full \`find\` definition above>",
    "take": "<source-specific realization of \`take\`; must satisfy the full \`take\` definition above>",
    "return": "<source-specific realization of \`return\`; must satisfy the full \`return\` definition above>",
    "change": "<source-specific realization of \`change\`; must satisfy the full \`change\` definition above>"
  },
  "schemaAbstraction": {
    "archetype": "<core reusable archetype, e.g. Temptation and Moral Cost, Forbidden Love, Coming of Age>",
    "adaptationMode": "<source_faithful/inspired_by/original>",
    "schemaVariables": [
      {
        "name": "<PascalCase variable name, no braces>",
        "description": "<what this replaceable story function means>",
        "examples": ["<optional source-specific examples>"]
      }
    ],
    "generalizationGuidance": [
      "<how to preserve the story pattern without copying time/place/IP-specific details>"
    ],
    "reusablePatternSummary": "<1-2 sentence summary of the transferable story engine>"
  },
  "themeArgument": {
    "themeQuestion": "<playable theme question, not a noun; answerable by protagonist/player action>",
    "controllingIdea": {
      "value": "<positive value the story ultimately argues for>",
      "cause": "<why/how that value prevails by the climax>",
      "sentence": "<value + cause sentence that the climax earns>"
    },
    "counterIdea": {
      "value": "<opposing or tempting value argument>",
      "cause": "<why/how the counter-idea appears persuasive>",
      "sentence": "<counter-argument sentence the story genuinely tests>"
    },
    "valueLadder": {
      "positive": "<healthy expression of the central value>",
      "contrary": "<milder negative / absence of the value>",
      "contradiction": "<direct opposite of the value>",
      "negationOfNegation": "<the value corrupted into its own poisonous mask>"
    },
    "archetypalCore": "<universal human pressure underneath the story>",
    "uniqueSurface": "<fresh specific surface that prevents stereotype>",
    "climaxResonantEvent": "<specific climactic action/choice where meaning and emotion fuse>",
    "retroactiveReframe": "<what earlier scenes mean differently after the climax>",
    "aestheticEmotionTarget": "<what the reader should understand and feel at once>",
    "imageSystem": [
      {
        "motifId": "<slug>",
        "motif": "<recurring image, object, color, blocking, wound, gesture, or place>",
        "thematicMeaning": "<meaning the story trains into the motif>",
        "positiveTreatment": "<how it appears when the value is healthy>",
        "contraryTreatment": "<how it appears when the value is absent>",
        "contradictionTreatment": "<how it appears when the value is opposed>",
        "negationTreatment": "<how it appears when the value is corrupted>",
        "climaxTreatment": "<how the climax transforms or pays off the motif>"
      }
    ]
  },
  "endingAnalysis": {
    "detectedMode": "<single/multiple based on the source material itself>",
    "reasoning": "<why the source implies one ending or several materially distinct endings>",
    "explicitEndings": [
      {
        "name": "<ending name>",
        "summary": "<what this finale looks like>",
        "emotionalRegister": "<bittersweet/tragic/triumphant/etc>",
        "themePayoff": "<what theme this ending lands>",
        "stateDrivers": [
          {
            "type": "<relationship/identity/flag/encounter_outcome/faction/theme/choice_pattern/resource>",
            "label": "<route driver label>",
            "details": "<why it matters>"
          }
        ],
        "targetConditions": ["<what choices or state unlock this ending>"]
      }
    ]
  }
}

Be thorough but concise. Focus on elements that matter for interactive fiction adaptation.
Fashion style is character wardrobe/silhouette/material/color information only. Do NOT put prose style, visual art style, cinematography, or image-rendering style in fashionStyle.
Return ONLY valid JSON.
`;

    const response = await this.callLLM([{ role: 'user', content: prompt }]);
    return this.parseAnalysisWithCompactRetry<StoryStructureAnalysis>(prompt, response, 'structure analysis');
  }

  /**
   * Second pass: Create detailed episode breakdown.
   *
   * For seasons of {@link PER_EPISODE_BREAKDOWN_MIN_EPISODES} or more episodes
   * we fan the breakdown out into one focused call per episode, run at bounded
   * concurrency ({@link PER_EPISODE_BREAKDOWN_CONCURRENCY}). Each per-episode
   * call carries the SAME shared structure summary + season-level legacy-structure
   * context (computed once and reused) so cross-episode consistency holds, but
   * asks for only ONE episode's outline — giving each episode the full
   * maxTokens ceiling and removing the truncation risk of cramming all N
   * outlines into a single response.
   *
   * For 1-2 episodes (and as a safe fallback whenever the per-episode path
   * yields nothing usable) we keep the original single all-at-once call.
   */
  private async createEpisodeBreakdown(
    sourceText: string,
    structure: StoryStructureAnalysis,
    preferences: { targetScenes: number; targetChoices: number; pacing: string },
    userPrompt?: string
  ): Promise<EpisodeBreakdownResponse> {
    const estimatedEpisodes = structure.estimatedScope.estimatedEpisodes;

    // Only fan out when the episode count is large enough to matter. For tiny
    // seasons the single call is both cheaper (one call vs N) and lower-risk.
    if (
      !Number.isFinite(estimatedEpisodes) ||
      estimatedEpisodes < PER_EPISODE_BREAKDOWN_MIN_EPISODES
    ) {
      return this.createEpisodeBreakdownSingleCall(sourceText, structure, preferences, userPrompt);
    }

    // Shared context is identical across every per-episode call, so compute it
    // ONCE and reuse it. This also keeps each prompt small + cacheable.
    const sharedContext = this.buildSharedBreakdownContext(
      sourceText,
      structure,
      preferences,
      estimatedEpisodes,
      userPrompt,
    );

    const episodeNumbers = Array.from({ length: estimatedEpisodes }, (_, i) => i + 1);

    try {
      const entries = await mapOrderedWithConcurrency(
        episodeNumbers,
        PER_EPISODE_BREAKDOWN_CONCURRENCY,
        async (episodeNumber) => {
          const prompt = this.buildSingleEpisodePrompt(
            sharedContext,
            episodeNumber,
            estimatedEpisodes,
          );
          // callLLM falls back to this.activeAbortSignal (set in execute()), so
          // a whole-analysis timeout/abort cancels in-flight per-episode calls.
          const response = await this.callLLM([{ role: 'user', content: prompt }]);
          const parsed = this.parseJSON<SingleEpisodeBreakdownResponse>(response);
          return this.normalizeSingleEpisode(parsed, episodeNumber);
        },
      );

      const assembled = entries.filter((entry): entry is EpisodeBreakdownEntry => entry !== null);
      if (assembled.length === estimatedEpisodes) {
        return {
          episodes: assembled,
          totalEpisodes: estimatedEpisodes,
          breakdownNotes: `Per-episode breakdown: ${assembled.length} episodes generated in focused calls.`,
        };
      }

      console.warn(
        `[SourceMaterialAnalyzer] Per-episode breakdown produced ${assembled.length}/${estimatedEpisodes} ` +
        `usable outlines; falling back to single-call breakdown.`,
      );
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      // Re-throw aborts so the whole analysis halts instead of silently
      // burning an extra single call after a timeout/cancellation.
      if (this.activeAbortSignal?.aborted || /abort/i.test(msg)) {
        throw error;
      }
      console.warn(
        `[SourceMaterialAnalyzer] Per-episode breakdown failed (${msg}); falling back to single-call breakdown.`,
      );
    }

    return this.createEpisodeBreakdownSingleCall(sourceText, structure, preferences, userPrompt);
  }

  /**
   * Shared, episode-agnostic context block reused by every per-episode call.
   * Computed once per analysis. Includes the structure summary, season-level
   * legacy-structure distribution, the truncated source reference, and the treatment
   * notice so each focused call still reasons about cross-episode consistency.
   */
  private buildSharedBreakdownContext(
    sourceText: string,
    structure: StoryStructureAnalysis,
    preferences: { targetScenes: number; targetChoices: number; pacing: string },
    estimatedEpisodes: number,
    userPrompt?: string,
  ): string {
    const maxChars = 80000;
    const truncatedText = sourceText.length > maxChars
      ? sourceText.substring(0, maxChars) + '\n\n[... text truncated ...]'
      : sourceText;

    return `${userPrompt ? `**User Instructions/Prompt**:
${userPrompt}

` : ''}**Story Structure Summary**:
- Genre: ${structure.genre}
- Tone: ${structure.tone}
- Protagonist: ${structure.protagonist.name} - ${structure.protagonist.arc}
- Estimated Episodes: ${estimatedEpisodes}
- Complexity: ${structure.estimatedScope.complexity}
${structure.schemaAbstraction ? `- Archetype: ${structure.schemaAbstraction.archetype}
- Reusable Pattern: ${structure.schemaAbstraction.reusablePatternSummary}
- Generalization Guidance: ${structure.schemaAbstraction.generalizationGuidance.join('; ')}` : ''}

**Story Arcs**:
${structure.storyArcs.map(arc => `- ${arc.name}: ${arc.description}`).join('\n')}

**Major Plot Points**:
${structure.majorPlotPoints.map(pp => `- [${pp.type}] ${pp.description} (${pp.approximatePosition})`).join('\n')}

**Episode Guidelines**:
- Target ${preferences.targetScenes} scenes per episode
- Target ${preferences.targetChoices} meaningful choices per episode
- Pacing: ${preferences.pacing}
- Each episode needs: setup, conflict, resolution
- Major plot points should be episode climaxes
- Leave room for player agency
- Show escalating pressure from Inciting Incident through Climax, but use genre-appropriate pressure rather than defaulting to combat.
- Plans should often go partly wrong, forcing character improvisation and meaningful player choices.
- After the Climax, move quickly: first show what was saved or changed, then show future cost, identity change, or legacy.

**Canonical Story Circle Beat Definitions (authoritative — do not summarize or replace):**
${STORY_CIRCLE_BEAT_DEFINITION_LINES.join('\n')}

**Story Circle Shape Principles (authoritative — enforce the concepts, not just the labels):**
${STORY_CIRCLE_GEOMETRY_PRINCIPLES.join('\n')}

**Season-Level Story Circle Distribution (AUTHORITATIVE DEFAULT, override only when the source demands it):**
${describeSuggestedStoryCircleDistribution(estimatedEpisodes)}
Across the whole ${estimatedEpisodes}-episode season every canonical Story Circle
beat (you, need, go, search, find, take, return, change) MUST land on at least
one episode and must appear in canonical order. If there are fewer than 8
episodes, adjacent beats fuse and none are omitted. If there are more than 8,
extras are contiguous expansions of real beats, preferably search, take, return.

${truncatedText ? `**Source Material Reference**:
${truncatedText}` : ''}

${buildTreatmentInputNotice(sourceText)}`;
  }

  /**
   * Per-episode prompt: shared season context + this episode's slot/role, asking
   * for exactly ONE episode's outline JSON (no surrounding array).
   */
  private buildSingleEpisodePrompt(
    sharedContext: string,
    episodeNumber: number,
    totalEpisodes: number,
  ): string {
    const suggestedStoryCircleRoles = distributeStoryCircle(totalEpisodes)
      .find((entry) => entry.episodeNumber === episodeNumber)
      ?.storyCircleRole.map((role) => role.roleKind === 'expansion' ? `${role.beat} expansion` : role.beat)
      .join(', ') || '(none)';
    const positionNote = episodeNumber === 1
      ? 'This is the FIRST episode: establish the world and protagonist; do not rush to action.'
      : episodeNumber === totalEpisodes
        ? 'This is the FINAL episode: it should feel like a satisfying conclusion (for now).'
        : `This is the middle of the season; keep breathing room for character development.`;

    return `
Based on the story structure analysis below, write the detailed outline for a SINGLE episode of this ${totalEpisodes}-episode season.

${sharedContext}

**Episode To Outline Now**:
- Episode number: ${episodeNumber} of ${totalEpisodes}
- Suggested Story Circle beat(s) for this slot (AUTHORITATIVE DEFAULT, override only when the source demands it): ${suggestedStoryCircleRoles}
- ${positionNote}
- Keep this episode consistent with the season-level beat distribution and the surrounding episodes implied by it.

Respond with JSON for ONLY this one episode (no surrounding array):

{
  "episodeNumber": ${episodeNumber},
  "title": "<compelling episode title>",
  "synopsis": "<2-3 sentence synopsis>",
  "sourceChapters": "<which chapters/sections this covers>",
  "plotPoints": ["<plot point 1>", "<plot point 2>", ...],
  "mainCharacters": ["<character names appearing>"],
  "locations": ["<locations used>"],
  "narrativeArc": {
    "setup": "<how episode begins>",
    "conflict": "<central tension>",
    "resolution": "<how episode ends - can be cliffhanger>"
  },
  "storyCircleRole": [
    { "beat": "<you|need|go|search|find|take|return|change>", "roleKind": "<primary|expansion>", "source": "llm" }
  ]
}

Return ONLY valid JSON for this single episode.
`;
  }

  /**
   * Normalize a single per-episode LLM response into an {@link EpisodeBreakdownEntry}.
   * Accepts both the bare-object form and the `{ episode: {...} }` wrapped form,
   * and forces the episodeNumber to the slot we asked for so ordering/assembly
   * stays correct even if the model echoes the wrong number. Returns null when
   * the response has no usable title/synopsis to outline.
   */
  private normalizeSingleEpisode(
    parsed: SingleEpisodeBreakdownResponse | null | undefined,
    episodeNumber: number,
  ): EpisodeBreakdownEntry | null {
    if (!parsed) return null;
    const src = parsed.episode ?? parsed;
    const title = typeof src.title === 'string' ? src.title.trim() : '';
    const synopsis = typeof src.synopsis === 'string' ? src.synopsis.trim() : '';
    if (!title && !synopsis) return null;

    const arc = src.narrativeArc || {};
    const asStringArray = (value: unknown): string[] =>
      Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];

    return {
      episodeNumber,
      title: title || `Episode ${episodeNumber}`,
      synopsis: synopsis || title,
      sourceChapters: typeof src.sourceChapters === 'string' ? src.sourceChapters : '',
      plotPoints: asStringArray(src.plotPoints),
      mainCharacters: asStringArray(src.mainCharacters),
      locations: asStringArray(src.locations),
      narrativeArc: {
        setup: typeof arc.setup === 'string' ? arc.setup : '',
        conflict: typeof arc.conflict === 'string' ? arc.conflict : '',
        resolution: typeof arc.resolution === 'string' ? arc.resolution : '',
      },
      storyCircleRole: normalizeStoryCircleRoleAssignments(src.storyCircleRole),
    };
  }

  /**
   * Original single all-at-once breakdown call. Retained as the path for short
   * seasons and as the fallback when the per-episode fan-out is not viable.
   */
  private async createEpisodeBreakdownSingleCall(
    sourceText: string,
    structure: StoryStructureAnalysis,
    preferences: { targetScenes: number; targetChoices: number; pacing: string },
    userPrompt?: string
  ): Promise<EpisodeBreakdownResponse> {
    const estimatedEpisodes = structure.estimatedScope.estimatedEpisodes;

    // For long sources, we may need to chunk the analysis
    const maxChars = 80000;
    const truncatedText = sourceText.length > maxChars
      ? sourceText.substring(0, maxChars) + '\n\n[... text truncated ...]'
      : sourceText;

    const prompt = `
Based on the story structure analysis, create a detailed episode-by-episode breakdown.

${userPrompt ? `**User Instructions/Prompt**:
${userPrompt}

` : ''}
**Story Structure Summary**:
- Genre: ${structure.genre}
- Tone: ${structure.tone}
- Protagonist: ${structure.protagonist.name} - ${structure.protagonist.arc}
- Estimated Episodes: ${estimatedEpisodes}
- Complexity: ${structure.estimatedScope.complexity}
${structure.schemaAbstraction ? `- Archetype: ${structure.schemaAbstraction.archetype}
- Reusable Pattern: ${structure.schemaAbstraction.reusablePatternSummary}
- Generalization Guidance: ${structure.schemaAbstraction.generalizationGuidance.join('; ')}` : ''}

**Story Arcs**:
${structure.storyArcs.map(arc => `- ${arc.name}: ${arc.description}`).join('\n')}

**Major Plot Points**:
${structure.majorPlotPoints.map(pp => `- [${pp.type}] ${pp.description} (${pp.approximatePosition})`).join('\n')}

**Episode Guidelines**:
- Target ${preferences.targetScenes} scenes per episode
- Target ${preferences.targetChoices} meaningful choices per episode
- Pacing: ${preferences.pacing}
- Each episode needs: setup → conflict → resolution
- Major plot points should be episode climaxes
- Leave room for player agency
- Show escalating pressure from Inciting Incident through Climax, but use genre-appropriate pressure rather than defaulting to combat.
- Plans should often go partly wrong, forcing character improvisation and meaningful player choices.
- After the Climax, move quickly: first show what was saved or changed, then show future cost, identity change, or legacy.

**Canonical Story Circle Beat Definitions (authoritative — do not summarize or replace):**
${STORY_CIRCLE_BEAT_DEFINITION_LINES.join('\n')}

**Story Circle Shape Principles (authoritative — enforce the concepts, not just the labels):**
${STORY_CIRCLE_GEOMETRY_PRINCIPLES.join('\n')}

**Default Story Circle Distribution (AUTHORITATIVE DEFAULT — override only when the source demands it):**
${describeSuggestedStoryCircleDistribution(estimatedEpisodes)}
Every canonical Story Circle beat (you, need, go, search, find, take, return, change)
MUST land on at least one episode across the season and must appear in canonical order.
If there are fewer than 8 episodes, adjacent beats fuse and none are omitted.
If there are more than 8, extras are contiguous expansions of real beats,
preferably search, take, return.

${truncatedText ? `**Source Material Reference**:
${truncatedText}` : ''}

${buildTreatmentInputNotice(sourceText)}

Create ${estimatedEpisodes} episode outlines. Respond with JSON:

{
  "episodes": [
    {
      "episodeNumber": 1,
      "title": "<compelling episode title>",
      "synopsis": "<2-3 sentence synopsis>",
      "sourceChapters": "<which chapters/sections this covers>",
      "plotPoints": ["<plot point 1>", "<plot point 2>", ...],
      "mainCharacters": ["<character names appearing>"],
      "locations": ["<locations used>"],
      "narrativeArc": {
        "setup": "<how episode begins>",
        "conflict": "<central tension>",
        "resolution": "<how episode ends - can be cliffhanger>"
      },
      "storyCircleRole": [
        { "beat": "<you|need|go|search|find|take|return|change>", "roleKind": "<primary|expansion>", "source": "llm" }
      ]
    }
  ],
  "totalEpisodes": ${estimatedEpisodes},
  "breakdownNotes": "<any important notes about the breakdown>"
}

IMPORTANT:
- Don't squeeze the whole story into fewer episodes than it needs
- Episode 1 should establish the world and protagonist, not rush to action
- Leave breathing room for character development
- Final episode should feel like a satisfying conclusion (for now)

Return ONLY valid JSON.
`;

    const response = await this.callLLM([{ role: 'user', content: prompt }]);
    return this.parseAnalysisWithCompactRetry<EpisodeBreakdownResponse>(prompt, response, 'single-call episode breakdown');
  }

  /**
   * Assemble the final analysis from all passes
   */
  private assembleAnalysis(
    input: SourceMaterialInput,
    structure: StoryStructureAnalysis,
    breakdown: EpisodeBreakdownResponse
  ): SourceMaterialAnalysis {
    const sourceText = input.sourceText || '';
    const promptText = input.userPrompt || '';
    const treatmentSourceText = sourceText.trim()
      ? sourceText
      : looksLikeTreatmentMarkdown(promptText)
        ? promptText
        : sourceText;
    const treatment = extractTreatmentFromMarkdown(treatmentSourceText, {
      strictValidation: input.preferences?.strictTreatmentValidation ?? false,
    });
    const treatmentSeasonGuidance = treatment.seasonGuidance;
    if (looksLikeTreatmentMarkdown(treatmentSourceText) && Object.keys(treatment.episodes).length === 0) {
      throw new Error(
        'Treatment extraction failed: source looks like a StoryRPG treatment, but no episode guidance could be parsed. ' +
        'Check the treatment template headings before generating a generic adaptation.'
      );
    }
    const treatmentEpisodeNumbers = Object.keys(treatment.episodes)
      .map(Number)
      .filter(Number.isFinite)
      .sort((a, b) => a - b);
    const totalEpisodes = treatment.isTreatment && treatmentEpisodeNumbers.length > 0
      ? treatmentEpisodeNumbers.length
      : breakdown.totalEpisodes;
    const breakdownByEpisode = new Map(breakdown.episodes.map((ep) => [ep.episodeNumber, ep]));
    const effectiveBreakdownEpisodes = treatment.isTreatment && treatmentEpisodeNumbers.length > 0
      ? treatmentEpisodeNumbers.map((episodeNumber) => {
          const existing = breakdownByEpisode.get(episodeNumber);
          const guidance = treatment.episodes[episodeNumber];
          const treatmentSynopsis = guidance.synopsis
            || guidance.episodePromise
            || guidance.dramaticQuestion
            || guidance.encounterCentralConflict;
          const treatmentPlotPoints = [
            ...(guidance.episodeTurns || []),
            ...(guidance.encounterAnchors || []),
            ...(guidance.consequenceSeeds || []),
            guidance.endingPressure,
            guidance.endStateChange,
          ].filter(Boolean) as string[];
          if (existing) {
            const treatmentStoryCircleRole = treatmentStoryCircleRoles(guidance.rawStoryCircleRole);
            return {
              ...existing,
              title: guidance.authoredTitle || existing.title,
              synopsis: treatmentSynopsis || existing.synopsis,
              plotPoints: Array.from(new Set([
                ...(existing.plotPoints || []),
                ...treatmentPlotPoints,
              ])),
              narrativeArc: {
                ...existing.narrativeArc,
                setup: existing.narrativeArc?.setup || treatmentSynopsis || guidance.episodePromise || 'Treatment setup',
                conflict: existing.narrativeArc?.conflict || guidance.encounterCentralConflict || guidance.episodePromise || guidance.dramaticQuestion || 'Treatment conflict',
                resolution: existing.narrativeArc?.resolution || guidance.resolutionAftermath || guidance.endingPressure || guidance.endStateChange || guidance.authoredCliffhanger || 'Treatment resolution',
              },
              storyCircleRole: treatmentStoryCircleRole.length > 0
                ? treatmentStoryCircleRole
                : normalizeStoryCircleRoleAssignments(existing.storyCircleRole),
            };
          }
          return {
            episodeNumber,
            title: guidance.authoredTitle || `Episode ${episodeNumber}`,
            synopsis: treatmentSynopsis || `Treatment episode ${episodeNumber}`,
            sourceChapters: `Treatment episode ${episodeNumber}`,
            plotPoints: treatmentPlotPoints,
            mainCharacters: [structure.protagonist.name],
            locations: [],
            narrativeArc: {
              setup: guidance.encounterBuildup || treatmentSynopsis || guidance.episodePromise || 'Treatment setup',
              conflict: guidance.encounterCentralConflict || guidance.encounterAnchors?.[0] || guidance.episodePromise || guidance.dramaticQuestion || 'Treatment conflict',
              resolution: guidance.resolutionAftermath || guidance.endingPressure || guidance.endStateChange || guidance.authoredCliffhanger || 'Treatment resolution',
            },
            storyCircleRole: treatmentStoryCircleRoles(guidance.rawStoryCircleRole),
          };
        })
      : breakdown.episodes;

    const defaultStoryCircleDistribution = distributeStoryCircle(totalEpisodes);
    const defaultStoryCircleRoleFor = (episodeNumber: number): StoryCircleRoleAssignment[] => {
      const entry = defaultStoryCircleDistribution.find((e) => e.episodeNumber === episodeNumber);
      return entry ? entry.storyCircleRole.map((role) => ({ ...role })) : [];
    };

    // Convert episode breakdown to full outlines
    const episodeOutlines: EpisodeOutline[] = effectiveBreakdownEpisodes.map((ep, idx) => {
      // Find plot points for this episode
      const episodePlotPoints: PlotPoint[] = ep.plotPoints.map((pp, ppIdx) => ({
        id: `ep${ep.episodeNumber}-pp${ppIdx + 1}`,
        description: pp,
        type: this.inferPlotPointType(pp, ep.episodeNumber, totalEpisodes),
        importance: 'major' as const,
        targetEpisode: ep.episodeNumber,
        charactersInvolved: ep.mainCharacters,
      }));

      const llmStoryCircleRoles = normalizeStoryCircleRoleAssignments(ep.storyCircleRole);
      const storyCircleRole = llmStoryCircleRoles.length > 0
        ? llmStoryCircleRoles
        : defaultStoryCircleRoleFor(ep.episodeNumber);

      return {
        episodeNumber: ep.episodeNumber,
        title: treatment.episodes[ep.episodeNumber]?.authoredTitle || ep.title,
        synopsis: ep.synopsis,
        sourceChapters: [ep.sourceChapters],
        sourceSummary: ep.synopsis,
        plotPoints: episodePlotPoints,
        mainCharacters: ep.mainCharacters,
        supportingCharacters: [],
        locations: ep.locations,
        estimatedSceneCount: clampSceneCount(input.preferences?.targetScenesPerEpisode || this.defaultScenesPerEpisode),
        estimatedChoiceCount: input.preferences?.targetChoicesPerEpisode || this.defaultChoicesPerEpisode,
        storyCircleRole,
        narrativeFunction: ep.narrativeArc,
        treatmentGuidance: treatment.episodes[ep.episodeNumber],
      };
    });

    const storyCircleCoverageIssues = checkStoryCircleCoverage(episodeOutlines);
    if (storyCircleCoverageIssues.length > 0) {
      for (const outline of episodeOutlines) {
        const fallbackRoles = defaultStoryCircleRoleFor(outline.episodeNumber);
        const treatmentRoles = (outline.storyCircleRole || []).filter((role) => role.source === 'treatment');
        const repairedRoles = [
          ...treatmentRoles,
          ...fallbackRoles.filter((fallback) =>
            !treatmentRoles.some((existing) =>
              existing.beat === fallback.beat && existing.roleKind === fallback.roleKind
            )
          ),
        ];
        outline.storyCircleRole = repairedRoles.length > 0 ? repairedRoles : fallbackRoles;
      }
    }

    // Anchors + Story Circle: prefer the LLM's, fall back to plot-point
    // inference using approximatePosition labels from the structure pass.
    const anchors: StoryAnchors = structure.anchors && hasAllAnchorFields(structure.anchors)
      ? structure.anchors
      : inferAnchorsFromStructure(structure);

    const storyCircle: StoryCircleStructure = structure.storyCircle && hasAllStoryCircleFields(structure.storyCircle)
      ? structure.storyCircle
      : inferStoryCircleFromSource(structure, anchors);

    // Convert story arcs with episode ranges
    const storyArcs: StoryArc[] = structure.storyArcs.map((arc, idx) => ({
      id: `arc-${idx + 1}`,
      name: arc.name,
      description: arc.description,
      startChapter: arc.chapters,
        estimatedEpisodeRange: this.estimateArcEpisodeRange(arc, totalEpisodes, idx, structure.storyArcs.length),
    }));
    for (const authoredArc of treatmentSeasonGuidance?.arcGuidance?.arcs ?? []) {
      const range = authoredArc.episodeRange ?? { start: 1, end: Math.min(totalEpisodes, 3) };
      const existingIndex = storyArcs.findIndex((arc) =>
        arc.name.toLowerCase() === authoredArc.title.toLowerCase()
        || (arc.estimatedEpisodeRange.start === range.start && arc.estimatedEpisodeRange.end === range.end)
      );
      const authoredStoryArc: StoryArc = {
        id: arcGuidanceId(authoredArc),
        name: authoredArc.title,
        description: authoredArc.arcDramaticQuestion
          || authoredArc.relationToSeasonQuestion
          || authoredArc.sourceText,
        startChapter: `Episodes ${range.start}-${range.end}`,
        estimatedEpisodeRange: {
          start: Math.max(1, Math.min(totalEpisodes, range.start)),
          end: Math.max(range.start, Math.min(totalEpisodes, range.end)),
        },
      };
      if (existingIndex >= 0) {
        storyArcs[existingIndex] = {
          ...storyArcs[existingIndex],
          ...authoredStoryArc,
        };
      } else {
        storyArcs.push(authoredStoryArc);
      }
    }

    // Build major characters list with first appearances
    const majorCharacters = structure.majorCharacters.map((char, idx) => ({
      id: `char-${slugify(char.name)}`,
      name: char.name,
      role: this.normalizeRole(char.role),
      description: char.description,
      importance: this.normalizeImportance(char.importance),
      firstAppearance: this.findFirstAppearance(char.name, effectiveBreakdownEpisodes),
      fashionStyle: normalizeCharacterFashionStyle(char.fashionStyle),
    }));
    const protagonistId = `char-${slugify(structure.protagonist.name)}`;

    // Named-character sweep: the structure pass' `majorCharacters` is the only
    // place the cast list is born, and a thin LLM response (e.g. only the love
    // interest + antagonist) starves the character bible even when the treatment
    // names a fuller ensemble. Reconcile against the other named-character
    // signals already present in the analysis — per-episode `mainCharacters`
    // lists and the `characterArchitecture.supportingCharacters[].characterName`
    // entries — and synthesize a `majorCharacters` row for any named character
    // not already represented (case-insensitive name + slugified-id match).
    // Existing entries are preserved untouched; we only ADD the missing ones,
    // capped so the cast can grow to a reasonable ensemble without runaway.
    this.sweepNamedCharacters(majorCharacters, {
      protagonistName: structure.protagonist.name,
      breakdownEpisodes: effectiveBreakdownEpisodes,
      supportingCharacters: structure.characterArchitecture?.supportingCharacters,
      sourceText: input.sourceText,
    });

    const characterArchitecture = this.normalizeCharacterArchitecture(
      structure.characterArchitecture,
      {
        protagonistId,
        protagonistName: structure.protagonist.name,
        protagonistDescription: structure.protagonist.description,
        protagonistArc: structure.protagonist.arc,
        anchors,
        themes: structure.themes,
        majorCharacters,
      },
    );

    // Build locations list
    const keyLocations = structure.keyLocations.map((loc, idx) => ({
      id: `loc-${loc.name.toLowerCase().replace(/\s+/g, '-')}`,
      name: loc.name,
      description: loc.description,
      importance: this.normalizeLocationImportance(loc.importance),
      firstAppearance: this.findLocationFirstAppearance(loc.name, effectiveBreakdownEpisodes),
    }));

    // Calculate confidence score based on analysis quality
    const confidenceScore = this.calculateConfidence(structure, breakdown);

    // Gather any warnings
    const warnings = this.generateWarnings(structure, breakdown, input);
    const extractedEndings = normalizeEndingTargets(
      structure.endingAnalysis?.explicitEndings || [],
      'explicit',
      {
        title: input.title,
        tone: structure.tone,
        themes: structure.themes,
        protagonistName: structure.protagonist.name,
        protagonistArc: structure.protagonist.arc,
        storyArcs: structure.storyArcs.map((arc) => ({ name: arc.name, description: arc.description })),
      },
    );
    const detectedEndingMode = structure.endingAnalysis?.detectedMode
      || (extractedEndings.length > 1 ? 'multiple' : 'single');
    const endingFields = buildAnalysisFromEndingSeeds(
      {
        title: input.title,
        tone: structure.tone,
        themes: structure.themes,
        protagonistName: structure.protagonist.name,
        protagonistArc: structure.protagonist.arc,
        storyArcs: structure.storyArcs.map((arc) => ({ name: arc.name, description: arc.description })),
      },
      extractedEndings,
      detectedEndingMode,
      input.preferences?.endingMode,
    );
    const treatmentEndings = treatment.endings.length === 3
      ? treatment.endings
      : [];
    if (treatmentEndings.length === 3) {
      const noEndingWarningIndex = warnings.findIndex((warning) => warning.includes('No explicit ending set found'));
      if (noEndingWarningIndex >= 0) warnings.splice(noEndingWarningIndex, 1);
    }
    const resolvedEndingMode = treatmentEndings.length === 3
      ? 'multiple'
      : endingFields.resolvedEndingMode;
    const characterTreatmentContracts = buildCharacterTreatmentContracts({
      guidance: treatmentSeasonGuidance?.protagonistGuidance,
      characterArchitecture,
      protagonist: {
        id: protagonistId,
        name: structure.protagonist.name,
        description: structure.protagonist.description,
        fashionStyle: normalizeCharacterFashionStyle(structure.protagonist.fashionStyle),
      },
      endings: treatmentEndings.length === 3 ? treatmentEndings : endingFields.resolvedEndings,
      totalEpisodes,
      treatmentSourced: treatment.isTreatment,
    });
    const worldTreatmentContracts = buildWorldTreatmentContracts({
      guidance: treatmentSeasonGuidance?.worldLocationGuidance,
      keyLocations,
      setting: structure.setting,
      totalEpisodes,
      treatmentSourced: treatment.isTreatment,
    });
    const stakesArchitectureContracts = buildStakesArchitectureContracts({
      guidance: treatmentSeasonGuidance,
      totalEpisodes,
      treatmentSourced: treatment.isTreatment,
    });
    const storyCircleBeatContracts = buildStoryCircleBeatContracts({
      guidance: treatmentSeasonGuidance,
      storyCircle,
      totalEpisodes,
      treatmentSourced: treatment.isTreatment,
    });
    const arcPressureContracts = buildArcPressureContracts({
      guidance: treatmentSeasonGuidance,
      arcs: [],
      totalEpisodes,
      treatmentSourced: treatment.isTreatment,
    });
    const branchConsequenceContracts = buildBranchConsequenceContracts({
      branches: treatment.branches,
      endings: treatmentEndings.length === 3 ? treatmentEndings : endingFields.resolvedEndings,
      totalEpisodes,
      treatmentSourced: treatment.isTreatment,
    });
    const endingRealizationContracts = buildEndingRealizationContracts({
      endings: treatmentEndings.length === 3 ? treatmentEndings : endingFields.resolvedEndings,
      totalEpisodes,
      treatmentSourced: treatment.isTreatment,
      branchContracts: branchConsequenceContracts,
    });
    const failureModeAuditContracts = buildFailureModeAuditContracts({
      guidance: treatmentSeasonGuidance,
      totalEpisodes,
      treatmentSourced: treatment.isTreatment,
      linkedContracts: [
        characterTreatmentContracts,
        worldTreatmentContracts,
        stakesArchitectureContracts,
        storyCircleBeatContracts,
        arcPressureContracts,
        branchConsequenceContracts,
        endingRealizationContracts,
      ],
    });

    const analysis: SourceMaterialAnalysis = {
      sourceTitle: input.title || 'Untitled',
      sourceAuthor: input.author,
      sourceFormat: treatment.isTreatment ? 'story_treatment' : ((input.sourceText || '').trim() ? 'source_material' : 'prompt'),
      treatmentMetadata: treatment.isTreatment ? treatment.metadata : undefined,
      totalWordCount: treatmentSourceText.trim().length > 0 ? treatmentSourceText.split(/\s+/).length : 0,

      genre: structure.genre,
      tone: structure.tone,
      themes: structure.themes,
      setting: structure.setting,

      anchors,
      storyCircle,
      schemaAbstraction: normalizeSchemaAbstraction(structure.schemaAbstraction, anchors),
      themeArgument: normalizeThemeArgument(structure.themeArgument, {
        themes: structure.themes,
        anchors,
        schemaAbstraction: structure.schemaAbstraction,
      }),
      writingStyleGuide: normalizeWritingStyleGuide(
        structure.writingStyleGuide,
        detectExplicitWritingStyleInstruction(input.userPrompt),
        {
          genre: structure.genre,
          tone: structure.tone,
          narrativeVoice: structure.adaptationGuidance?.narrativeVoice,
          dialogueStyle: structure.adaptationGuidance?.dialogueStyle,
        },
      ),

      storyArcs,
      detectedEndingMode: treatmentEndings.length === 3 ? 'multiple' : endingFields.detectedEndingMode,
      resolvedEndingMode,
      endingModeReasoning: treatmentEndings.length === 3
        ? 'Exactly three alternate endings were extracted from the treatment document.'
        : structure.endingAnalysis?.reasoning,
      extractedEndings: treatmentEndings.length === 3 ? treatmentEndings : endingFields.extractedEndings,
      generatedEndings: endingFields.generatedEndings,
      resolvedEndings: treatmentEndings.length === 3 ? treatmentEndings : endingFields.resolvedEndings,
      episodeBreakdown: episodeOutlines,
      totalEstimatedEpisodes: totalEpisodes,
      treatmentBranches: treatment.branches.length > 0 ? treatment.branches : undefined,
      treatmentSeasonGuidance,

      protagonist: {
        id: protagonistId,
        name: structure.protagonist.name,
        description: structure.protagonist.description,
        arc: structure.protagonist.arc,
        fashionStyle: normalizeCharacterFashionStyle(structure.protagonist.fashionStyle),
      },
      majorCharacters,
      characterArchitecture,
      characterTreatmentContracts,
      stakesArchitectureContracts,
      branchConsequenceContracts,
      endingRealizationContracts,
      failureModeAuditContracts,
      storyCircleBeatContracts,
      arcPressureContracts,
      worldTreatmentContracts,
      keyLocations,

      analysisTimestamp: new Date(),
      confidenceScore,
      warnings: [
        ...warnings,
        ...treatment.metadata.warnings,
        ...(treatmentSeasonGuidance ? [summarizeTreatmentSeasonGuidance(treatmentSeasonGuidance)] : []),
      ],
      directLanguageFragments: normalizeDirectLanguageFragments(structure.directLanguageFragments),
      adaptationGuidance: normalizeAdaptationGuidance(structure.adaptationGuidance),
    };

    const sourceCanon = buildLockedStoryCanon({
      analysis,
      sourceText: treatmentSourceText || input.sourceText,
      userPrompt: input.userPrompt,
      treatment,
    });

    analysis.sourceCanon = sourceCanon;
    analysis.canonLockManifest = sourceCanon.lockManifest;

    return analysis;
  }

  // Helper methods
  private normalizeCharacterArchitecture(
    raw: StoryStructureAnalysis['characterArchitecture'],
    context: {
      protagonistId: string;
      protagonistName: string;
      protagonistDescription: string;
      protagonistArc: string;
      anchors: StoryAnchors;
      themes: string[];
      majorCharacters: Array<{
        id: string;
        name: string;
        role: 'antagonist' | 'ally' | 'mentor' | 'love_interest' | 'rival' | 'neutral';
        description: string;
        importance: 'core' | 'supporting' | 'background';
        firstAppearance: number;
        fashionStyle?: CharacterFashionStyle;
      }>;
    },
  ): CharacterArchitecture {
    const protagonist = raw?.protagonist || {};
    const arcMode = this.normalizeCharacterArcMode(protagonist.arcMode);
    const themeQuestion = context.themes.find((theme) => theme.includes('?')) || context.themes[0] || 'the season question';
    const lie = this.cleanArchitectureText(
      protagonist.lie,
      `${context.protagonistName} believes survival depends on the identity that the story must challenge.`,
    );
    const truth = this.cleanArchitectureText(
      protagonist.truth,
      context.protagonistArc || `${context.protagonistName} must choose a truer way to protect what matters.`,
    );
    const want = this.cleanArchitectureText(
      protagonist.want,
      context.anchors.goal || `Pursue the visible season goal.`,
    );
    const need = this.cleanArchitectureText(
      protagonist.need,
      truth,
    );

    const rawSupporting = Array.isArray(raw?.supportingCharacters) ? raw!.supportingCharacters! : [];
    const supportingCharacters = context.majorCharacters
      .filter((char) => char.importance !== 'background')
      .slice(0, 6)
      .map((char) => {
        const match = rawSupporting.find((candidate) =>
          candidate.characterId === char.id ||
          candidate.characterName?.toLowerCase() === char.name.toLowerCase()
        );
        return {
          characterId: char.id,
          characterName: char.name,
          microLie: this.cleanArchitectureText(
            match?.microLie,
            `${char.name} protects themselves through a belief that complicates ${context.protagonistName}'s choices.`,
          ),
          originPressure: this.cleanArchitectureText(match?.originPressure, ''),
          truthOrCounterPressure: this.cleanArchitectureText(
            match?.truthOrCounterPressure,
            `${char.name} mirrors, tempts, warns, or pressures the protagonist around ${themeQuestion}.`,
          ),
          screenTimeTier: this.normalizeScreenTimeTier(match?.screenTimeTier, char.importance),
          pressureRole: this.normalizePressureRole(match?.pressureRole, char.role),
          protagonistVisibleSignals: Array.isArray(match?.protagonistVisibleSignals) && match!.protagonistVisibleSignals!.length > 0
            ? match!.protagonistVisibleSignals!.filter((signal): signal is string => typeof signal === 'string' && signal.trim().length > 0)
            : [`${char.name}'s choices visibly challenge ${context.protagonistName}'s assumptions.`],
          plannedResolution: this.cleanArchitectureText(match?.plannedResolution, ''),
        };
      });

    return {
      protagonist: {
        lie,
        originPressure: this.cleanArchitectureText(
          protagonist.originPressure,
          `${context.protagonistName}'s past experience made the Lie feel like protection rather than a flaw.`,
        ),
        truth,
        want,
        need: need === want
          ? `${truth} in a way that costs or complicates ${want}`
          : need,
        arcMode,
        climaxChoice: {
          choiceQuestion: this.cleanArchitectureText(
            protagonist.climaxChoice?.choiceQuestion,
            `Will ${context.protagonistName} act from the Truth or retreat into the Lie when ${context.anchors.climax || 'the climax'} arrives?`,
          ),
          integrateTruthOption: this.cleanArchitectureText(
            protagonist.climaxChoice?.integrateTruthOption,
            `Act on the Truth: ${truth}`,
          ),
          recommitLieOption: this.cleanArchitectureText(
            protagonist.climaxChoice?.recommitLieOption,
            `Recommit to the Lie: ${lie}`,
          ),
          activeChoiceMechanism: this.cleanArchitectureText(
            protagonist.climaxChoice?.activeChoiceMechanism,
            'The player/protagonist chooses through sacrifice, refusal, revelation, relationship leverage, risk, or identity commitment.',
          ),
        },
      },
      supportingCharacters,
    };
  }

  private cleanArchitectureText(value: unknown, fallback: string): string {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : fallback;
  }

  private normalizeCharacterArcMode(value: unknown): CharacterArcMode {
    return value === 'tragic' || value === 'ambiguous' || value === 'positive'
      ? value
      : 'ambiguous';
  }

  private normalizeScreenTimeTier(
    value: unknown,
    importance: 'core' | 'supporting' | 'background',
  ): 'major' | 'supporting' | 'minor' {
    if (value === 'major' || value === 'supporting' || value === 'minor') return value;
    if (importance === 'core') return 'major';
    if (importance === 'supporting') return 'supporting';
    return 'minor';
  }

  private normalizePressureRole(
    value: unknown,
    role: 'antagonist' | 'ally' | 'mentor' | 'love_interest' | 'rival' | 'neutral',
  ): CharacterArchitecture['supportingCharacters'][number]['pressureRole'] {
    if (
      value === 'mirror' ||
      value === 'foil' ||
      value === 'temptation' ||
      value === 'warning' ||
      value === 'ally' ||
      value === 'antagonist'
    ) {
      return value;
    }
    if (role === 'antagonist' || role === 'rival') return 'antagonist';
    if (role === 'mentor') return 'warning';
    if (role === 'love_interest') return 'mirror';
    if (role === 'ally') return 'ally';
    return 'foil';
  }

  private inferPlotPointType(
    description: string,
    episodeNum: number,
    totalEpisodes: number
  ): PlotPoint['type'] {
    const lowerDesc = description.toLowerCase();
    const position = episodeNum / totalEpisodes;

    if (lowerDesc.includes('discover') || lowerDesc.includes('reveal') || lowerDesc.includes('learn')) {
      return 'revelation';
    }
    if (lowerDesc.includes('twist') || lowerDesc.includes('betray') || lowerDesc.includes('surprise')) {
      return 'twist';
    }
    if (position < 0.15 && (lowerDesc.includes('begin') || lowerDesc.includes('start') || lowerDesc.includes('call'))) {
      return 'inciting_incident';
    }
    if (position > 0.4 && position < 0.6) {
      return 'midpoint';
    }
    if (position > 0.85) {
      return 'resolution';
    }
    if (position > 0.75) {
      return 'climax';
    }
    return 'rising_action';
  }

  private estimateArcEpisodeRange(
    arc: { name: string; description: string; chapters: string },
    totalEpisodes: number,
    arcIndex: number,
    totalArcs: number
  ): { start: number; end: number } {
    // Distribute arcs roughly evenly across episodes
    const episodesPerArc = totalEpisodes / totalArcs;
    const start = Math.max(1, Math.floor(arcIndex * episodesPerArc) + 1);
    const end = Math.min(totalEpisodes, Math.floor((arcIndex + 1) * episodesPerArc));
    return { start, end };
  }

  /**
   * Maximum size the cast may reach after the named-character sweep. The sweep
   * only adds characters that already appear by name elsewhere in the analysis,
   * but we cap the total so a noisy episode breakdown (every walk-on listed) can
   * not balloon the bible.
   */
  private static readonly MAX_SWEPT_MAJOR_CHARACTERS = 8;

  /**
   * Reconcile the LLM's `majorCharacters` list against the other named-character
   * signals already present in the analysis, synthesizing rows for any named
   * character the structure pass omitted. Mutates `majorCharacters` in place,
   * preserving existing entries and only appending missing ones (up to the
   * {@link MAX_SWEPT_MAJOR_CHARACTERS} cap).
   */
  // Off-page relation markers — a swept name described this way in the treatment is
  // referenced (FaceTime/photo), never physically present. MUST stay in sync with the
  // present-cast filter in ContentGenerationPhase.isStageablePresent (same markers).
  private static readonly OFF_PAGE_RELATION =
    /\b(niece|nephew|grandchild|in Boston|back home|overseas|abroad|long[- ]distance|via (?:face\s?time|phone|video)|on the phone|photo (?:on|sits on) (?:her|the) desk)\b/i;

  /**
   * If the treatment text describes `name` near an off-page marker (within a small
   * window of its first mention), return a description carrying that marker so the
   * present-cast filter excludes them from physical staging. Else '' (present).
   */
  private classifyOffPageDescription(name: string, sourceText?: string): string {
    if (!sourceText) return '';
    const at = sourceText.toLowerCase().indexOf(name.toLowerCase());
    if (at < 0) return '';
    const window = sourceText.slice(Math.max(0, at - 60), at + 200);
    const marker = SourceMaterialAnalyzer.OFF_PAGE_RELATION.exec(window);
    return marker ? `Off-page relation — referenced only (${marker[0]}), not physically present in scenes.` : '';
  }

  private sweepNamedCharacters(
    majorCharacters: Array<{
      id: string;
      name: string;
      role: 'antagonist' | 'ally' | 'mentor' | 'love_interest' | 'rival' | 'neutral';
      description: string;
      importance: 'core' | 'supporting' | 'background';
      firstAppearance: number;
      fashionStyle?: CharacterFashionStyle;
    }>,
    context: {
      protagonistName: string;
      breakdownEpisodes: Array<{ mainCharacters: string[]; episodeNumber: number }>;
      supportingCharacters?: Array<Partial<CharacterArchitecture['supportingCharacters'][number]>>;
      sourceText?: string;
    },
  ): void {
    // Index the existing cast (plus the protagonist) by both case-insensitive
    // name and slugified id so a sweep candidate that only differs in casing or
    // surrounding whitespace is treated as already-present, never duplicated.
    const seenNames = new Set<string>();
    const seenIds = new Set<string>();
    const remember = (name: string) => {
      seenNames.add(name.trim().toLowerCase());
      seenIds.add(`char-${slugify(name)}`);
    };
    remember(context.protagonistName);
    for (const char of majorCharacters) {
      seenNames.add(char.name.trim().toLowerCase());
      seenIds.add(char.id);
    }

    // Collect candidate names in a stable order: supportingCharacters first
    // (they carry an intended pressure role), then per-episode mainCharacters.
    const candidateNames: string[] = [];
    for (const supporting of context.supportingCharacters || []) {
      const name = supporting?.characterName;
      if (typeof name === 'string' && name.trim()) candidateNames.push(name.trim());
    }
    for (const ep of context.breakdownEpisodes) {
      for (const name of ep.mainCharacters || []) {
        if (typeof name === 'string' && name.trim()) candidateNames.push(name.trim());
      }
    }

    for (const name of candidateNames) {
      if (majorCharacters.length >= SourceMaterialAnalyzer.MAX_SWEPT_MAJOR_CHARACTERS) break;
      const key = name.toLowerCase();
      const id = `char-${slugify(name)}`;
      if (seenNames.has(key) || seenIds.has(id)) continue;
      // A bare name carries no role/importance signal, so default to the
      // gentlest tier ('supporting') via the shared normalizers; downstream
      // architecture/bible passes can still promote it.
      // If the treatment describes this name as a REMOTE/off-page relation (a niece
      // in Boston, a FaceTime/photo contact), stamp that into the description so the
      // encounter present-cast filter (ContentGenerationPhase.isStageablePresent)
      // never stages them as physically present — they can still be referenced.
      majorCharacters.push({
        id,
        name,
        role: this.normalizeRole('supporting'),
        description: this.classifyOffPageDescription(name, context.sourceText),
        importance: this.normalizeImportance('supporting'),
        firstAppearance: this.findFirstAppearance(name, context.breakdownEpisodes),
        fashionStyle: normalizeCharacterFashionStyle(undefined),
      });
      remember(name);
    }
  }

  private normalizeRole(role: string): 'antagonist' | 'ally' | 'mentor' | 'love_interest' | 'rival' | 'neutral' {
    const lower = role.toLowerCase();
    if (lower.includes('antag') || lower.includes('villain')) return 'antagonist';
    if (lower.includes('ally') || lower.includes('friend')) return 'ally';
    if (lower.includes('mentor') || lower.includes('teacher')) return 'mentor';
    if (lower.includes('love') || lower.includes('romantic')) return 'love_interest';
    if (lower.includes('rival')) return 'rival';
    return 'neutral';
  }

  private normalizeImportance(importance: string): 'core' | 'supporting' | 'background' {
    const lower = importance.toLowerCase();
    if (lower.includes('core') || lower.includes('major') || lower.includes('main')) return 'core';
    if (lower.includes('support')) return 'supporting';
    return 'background';
  }

  private normalizeLocationImportance(importance: string): 'major' | 'minor' | 'backdrop' {
    const lower = importance.toLowerCase();
    if (lower.includes('major') || lower.includes('main') || lower.includes('key')) return 'major';
    if (lower.includes('minor')) return 'minor';
    return 'backdrop';
  }

  private findFirstAppearance(
    characterName: string,
    episodes: Array<{ mainCharacters: string[]; episodeNumber: number }>
  ): number {
    for (const ep of episodes) {
      if (ep.mainCharacters.some(c => c.toLowerCase().includes(characterName.toLowerCase()))) {
        return ep.episodeNumber;
      }
    }
    return 1; // Default to first episode
  }

  private findLocationFirstAppearance(
    locationName: string,
    episodes: Array<{ locations: string[]; episodeNumber: number }>
  ): number {
    for (const ep of episodes) {
      if (ep.locations.some(l => l.toLowerCase().includes(locationName.toLowerCase()))) {
        return ep.episodeNumber;
      }
    }
    return 1;
  }

  private calculateConfidence(
    structure: StoryStructureAnalysis,
    breakdown: EpisodeBreakdownResponse
  ): number {
    let score = 70; // Base confidence

    // Boost for complete analysis
    if (structure.protagonist.name && structure.protagonist.arc) score += 5;
    if (structure.majorCharacters.length >= 3) score += 5;
    if (structure.storyArcs.length >= 2) score += 5;
    if (structure.majorPlotPoints.length >= 5) score += 5;

    // Boost for good episode breakdown
    if (breakdown.episodes.length === breakdown.totalEpisodes) score += 5;
    if (breakdown.episodes.every(ep => ep.plotPoints.length >= 2)) score += 5;

    return Math.min(100, score);
  }

  private generateWarnings(
    structure: StoryStructureAnalysis,
    breakdown: EpisodeBreakdownResponse,
    input: SourceMaterialInput
  ): string[] {
    const warnings: string[] = [];

    // Check for potential issues
    if (breakdown.totalEpisodes > 20) {
      warnings.push('Epic-length story may require significant generation time');
    }

    if (structure.majorCharacters.length > 10) {
      warnings.push('Large cast may be difficult to develop fully in interactive format');
    }

    if ((input.sourceText || '').length > 200000) {
      warnings.push('Very long source text - analysis may have missed details in later sections');
    }

    if (structure.estimatedScope.complexity === 'epic') {
      warnings.push('Complex source material - consider generating in batches');
    }

    if ((structure.endingAnalysis?.explicitEndings || []).length === 0) {
      warnings.push('No explicit ending set found in source analysis; the pipeline may infer or generate finale targets.');
    }

    return warnings;
  }

  /**
   * Quick estimate of episode count without full analysis
   * Useful for giving user immediate feedback
   */
  async quickEstimate(sourceText: string): Promise<{
    estimatedEpisodes: number;
    complexity: string;
    confidence: number;
  }> {
    const wordCount = sourceText.split(/\s+/).length;

    // Very rough heuristics based on word count
    // Average novel: 80,000 words
    // Target: ~10,000 words of story per episode after compression
    const baseEstimate = Math.ceil(wordCount / 15000);

    const prompt = `
Quick analysis: How many interactive fiction episodes would this story require?

Word count: ${wordCount}
First 5000 characters:
${sourceText.substring(0, 5000)}

Respond with JSON only:
{
  "estimatedEpisodes": <number>,
  "complexity": "<simple/moderate/complex/epic>",
  "reasoning": "<one sentence>"
}
`;

    try {
      const response = await this.callLLM([{ role: 'user', content: prompt }]);
      const result = this.parseJSON<{ estimatedEpisodes: number; complexity: string; reasoning: string }>(response);

      return {
        estimatedEpisodes: result.estimatedEpisodes,
        complexity: result.complexity,
        confidence: 60, // Lower confidence for quick estimate
      };
    } catch {
      // Fallback to heuristic
      return {
        estimatedEpisodes: baseEstimate,
        complexity: baseEstimate > 15 ? 'epic' : baseEstimate > 8 ? 'complex' : 'moderate',
        confidence: 40,
      };
    }
  }
}

// ---------------------------------------------------------------------------
// Anchor + Story Circle inference helpers
//
// When the LLM drops the anchors / Story Circle blocks, we fall back to
// deriving them from the existing `protagonist.arc`, `storyArcs`, and
// `majorPlotPoints` fields without requiring a second LLM call.
// ---------------------------------------------------------------------------

function hasAllAnchorFields(anchors: Partial<StoryAnchors> | undefined): anchors is StoryAnchors {
  if (!anchors) return false;
  return !!(anchors.stakes && anchors.goal && anchors.incitingIncident && anchors.climax);
}

function hasAllStoryCircleFields(sc: Partial<StoryCircleStructure> | undefined): sc is StoryCircleStructure {
  if (!sc) return false;
  return STORY_CIRCLE_BEATS.every((b) => typeof sc[b] === 'string' && (sc[b] as string).trim().length > 0);
}

function inferAnchorsFromStructure(structure: StoryStructureAnalysis): StoryAnchors {
  const plotPoints = structure.majorPlotPoints || [];
  const byType = (type: string) => plotPoints.find((p) => (p.type || '').toLowerCase().includes(type));
  const incitingPoint = byType('inciting') || byType('rising') || plotPoints[0];
  const climaxPoint = byType('climax') || byType('twist') || plotPoints[plotPoints.length - 1];

  const protagonistName = structure.protagonist?.name || 'the protagonist';
  return {
    stakes: structure.themes?.[0]
      ? `What ${protagonistName} values most in this story, especially as it relates to ${structure.themes[0]}.`
      : `What ${protagonistName} values most and stands to lose.`,
    goal: structure.protagonist?.arc
      ? `${protagonistName}'s drive throughout the story: ${structure.protagonist.arc}`
      : `${protagonistName}'s core objective.`,
    incitingIncident: incitingPoint?.description || 'The event that disrupts the ordinary world and sets the story in motion.',
    climax: climaxPoint?.description || 'The decisive confrontation where the protagonist faces the final test.',
  };
}

function inferStoryCircleFromSource(
  structure: StoryStructureAnalysis,
  anchors: StoryAnchors,
): StoryCircleStructure {
  const plotPoints = structure.majorPlotPoints || [];
  const byTypeOrPosition = (typeHint: string, positionHint?: number): string | undefined => {
    const typed = plotPoints.find((p) => (p.type || '').toLowerCase().includes(typeHint));
    if (typed) return typed.description;
    if (positionHint !== undefined && plotPoints.length > 0) {
      const idx = Math.min(plotPoints.length - 1, Math.floor(positionHint * plotPoints.length));
      return plotPoints[idx]?.description;
    }
    return undefined;
  };

  const protagonistName = structure.protagonist?.name || 'the protagonist';
  const primaryArcDesc = structure.storyArcs?.[0]?.description || '';

  return {
    you: byTypeOrPosition('opening', 0) || `${protagonistName} in the ordinary world before the story begins. ${primaryArcDesc}`.trim(),
    need: anchors.goal,
    go: anchors.incitingIncident,
    search: byTypeOrPosition('rising', 0.35) || `${protagonistName} tests approaches and learns the new pressure system.`,
    find: byTypeOrPosition('midpoint', 0.5) || `${protagonistName} commits fully to the goal after a revelation or reversal.`,
    take: byTypeOrPosition('twist', 0.7) || `Crisis that appears to undo everything ${protagonistName} has gained; the final transformation begins here.`,
    return: anchors.climax,
    change: byTypeOrPosition('resolution', 1) || `The aftermath and legacy of the climax; the ordinary world is visibly changed.`,
  };
}

const WRITING_STYLE_PATTERN =
  /\b(?:write|written|prose|narrative voice|narration|narrator|style|voice|tone|dialogue|dialog)\b/i;

const EXPLICIT_STYLE_TRIGGERS = [
  /\bwrite\s+(?:it|this|the story|the prose|the narration)?\s*(?:in|with|like|as)\b/i,
  /\b(?:writing|prose|narrative|narration|dialogue|dialog)\s+style\s*(?:should|must|is|:|-)\b/i,
  /\bnarrative\s+voice\s*(?:should|must|is|:|-)\b/i,
  /\b(?:use|give\s+it|make\s+it)\s+(?:a\s+)?(?:terse|spare|literary|lyrical|noir|hardboiled|pulp|storybook|epistolary|first-person|second-person|third-person|omniscient|close|minimalist|maximalist|wry|satirical|gothic|poetic)\b/i,
  /\b(?:dialogue|dialog)\s+should\b/i,
  /\bin\s+the\s+style\s+of\b/i,
];

/**
 * Deterministically detect explicit prose-style instructions in the user
 * prompt. This intentionally avoids generic story-tone requests unless they
 * are phrased as writing/prose/narration/dialogue instructions.
 */
export function detectExplicitWritingStyleInstruction(userPrompt?: string): string | undefined {
  const prompt = String(userPrompt || '').trim();
  if (!prompt || !WRITING_STYLE_PATTERN.test(prompt)) return undefined;

  const sentences = prompt
    .split(/(?<=[.!?])\s+|\n+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);

  const matches = sentences.filter((sentence) => {
    const lower = sentence.toLowerCase();
    if (/\b(?:art|visual|image|illustration|illustrated|drawing|painting)\s+style\b/.test(lower)) {
      return false;
    }
    return EXPLICIT_STYLE_TRIGGERS.some((pattern) => pattern.test(sentence));
  });

  if (matches.length === 0) return undefined;
  return matches.join(' ').replace(/\s+/g, ' ').trim();
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((item) => String(item || '').trim()).filter(Boolean)
    : [];
}

export function normalizeCharacterFashionStyle(
  fashionStyle: Partial<CharacterFashionStyle> | undefined,
): CharacterFashionStyle | undefined {
  if (!fashionStyle) return undefined;

  const styleSummary = String(fashionStyle.styleSummary || '').trim();
  const styleTags = asStringArray(fashionStyle.styleTags);
  const signatureGarments = asStringArray(fashionStyle.signatureGarments);
  const materials = asStringArray(fashionStyle.materials);
  const colorPalette = asStringArray(fashionStyle.colorPalette);
  const accessories = asStringArray(fashionStyle.accessories);
  const sourceEvidence = asStringArray(fashionStyle.sourceEvidence);

  if (
    !styleSummary &&
    styleTags.length === 0 &&
    signatureGarments.length === 0 &&
    materials.length === 0 &&
    colorPalette.length === 0 &&
    accessories.length === 0
  ) {
    return undefined;
  }

  return {
    styleSummary,
    styleTags,
    signatureGarments,
    materials,
    colorPalette,
    accessories,
    ...(sourceEvidence.length > 0 ? { sourceEvidence } : {}),
  };
}

export function normalizeDirectLanguageFragments(
  fragments: StoryStructureAnalysis['directLanguageFragments'] | undefined,
): DirectLanguageFragmentGroups {
  return {
    dialogue: asStringArray(fragments?.dialogue),
    prose: asStringArray(fragments?.prose),
    terminology: asStringArray(fragments?.terminology),
  };
}

export function normalizeAdaptationGuidance(
  guidance: StoryStructureAnalysis['adaptationGuidance'] | undefined,
): SourceMaterialAnalysis['adaptationGuidance'] | undefined {
  if (!guidance) return undefined;

  return {
    toneNotes: String(guidance.toneNotes || '').trim() || String(guidance.narrativeVoice || '').trim(),
    dialogueStyle: String(guidance.dialogueStyle || '').trim() || 'Match each character voice to the analyzed source style.',
    narrativeVoice: String(guidance.narrativeVoice || '').trim() || 'Use the analyzed source voice while keeping player-facing prose clear.',
    elementsToPreserve: asStringArray(guidance.elementsToPreserve).length > 0
      ? asStringArray(guidance.elementsToPreserve)
      : [...asStringArray(guidance.keyThemesToPreserve), ...asStringArray(guidance.iconicMoments)],
    elementsToAdapt: asStringArray(guidance.elementsToAdapt),
    keyThemesToPreserve: asStringArray(guidance.keyThemesToPreserve),
    iconicMoments: asStringArray(guidance.iconicMoments),
  };
}

export function normalizeWritingStyleGuide(
  guide: Partial<WritingStyleGuide> | undefined,
  explicitInstruction: string | undefined,
  fallback: {
    genre?: string;
    tone?: string;
    narrativeVoice?: string;
    dialogueStyle?: string;
  } = {},
): WritingStyleGuide {
  const source: WritingStyleGuide['source'] = explicitInstruction
    ? 'explicit_prompt'
    : 'inferred_from_material';

  const summary = String(guide?.summary || '').trim()
    || (explicitInstruction
      ? `Follow the user's explicit prose instruction: ${explicitInstruction}`
      : `Use an inferred ${fallback.tone || 'story-appropriate'} ${fallback.genre || 'interactive fiction'} prose style.`);

  return {
    source,
    summary,
    narrativeVoice: String(guide?.narrativeVoice || fallback.narrativeVoice || '').trim()
      || 'Clear, immersive narration focused on concrete action and emotional consequence.',
    sentenceRhythm: String(guide?.sentenceRhythm || '').trim()
      || 'Vary short, playable beats with occasional longer reflective lines for emphasis.',
    diction: String(guide?.diction || '').trim()
      || 'Use genre-appropriate vocabulary without exposing mechanics or numbers.',
    dialogueStyle: String(guide?.dialogueStyle || fallback.dialogueStyle || '').trim()
      || 'Keep dialogue concise, character-specific, and rich with subtext.',
    povAndDistance: String(guide?.povAndDistance || '').trim()
      || 'Keep player-facing emotion externalized through action, dialogue, silence, body language, facial expression, object handling, proximity, avoidance, and choice behavior.',
    imageryAndSensoryFocus: String(guide?.imageryAndSensoryFocus || '').trim()
      || 'Favor specific sensory details that reveal mood, stakes, and setting.',
    pacing: String(guide?.pacing || '').trim()
      || 'Move quickly through action and linger briefly on choices, revelations, and consequences.',
    doList: asStringArray(guide?.doList).length > 0
      ? asStringArray(guide?.doList)
      : ['Express mechanics through fiction-first prose.', 'Preserve the established tone and narrative voice.'],
    avoidList: asStringArray(guide?.avoidList).length > 0
      ? asStringArray(guide?.avoidList)
      : ['Do not expose stats, dice rolls, or numeric mechanics.', 'Do not drift into generic cinematic summary.'],
    evidence: asStringArray(guide?.evidence).length > 0
      ? asStringArray(guide?.evidence)
      : explicitInstruction
        ? [explicitInstruction]
        : undefined,
  };
}

export function normalizeSchemaVariableName(name: string): string {
  const cleaned = String(name || '')
    .replace(/[{}]/g, ' ')
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .trim();

  if (!cleaned) return 'StoryVariable';

  return cleaned
    .split(/\s+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
}

export function containsSchemaPlaceholder(text: string): boolean {
  return /\{[A-Z][A-Za-z0-9]*\}/.test(text);
}

export function normalizeSchemaAbstraction(
  abstraction: StorySchemaAbstraction | undefined,
  anchors: StoryAnchors,
): StorySchemaAbstraction | undefined {
  if (!abstraction) return undefined;

  const seen = new Set<string>();
  const requiredVariables: StorySchemaAbstraction['schemaVariables'] = [
    { name: 'Stakes', description: anchors.stakes },
    { name: 'Goal', description: anchors.goal },
    { name: 'IncitingIncident', description: anchors.incitingIncident },
    { name: 'Climax', description: anchors.climax },
  ];

  const sourceVariables = Array.isArray(abstraction.schemaVariables)
    ? abstraction.schemaVariables
    : [];

  const schemaVariables = [...sourceVariables, ...requiredVariables]
    .map((variable) => ({
      ...variable,
      name: normalizeSchemaVariableName(variable.name),
      description: String(variable.description || '').replace(/\{([A-Z][A-Za-z0-9]*)\}/g, '$1'),
      examples: Array.isArray(variable.examples)
        ? variable.examples.map((example) => String(example).replace(/\{([A-Z][A-Za-z0-9]*)\}/g, '$1'))
        : undefined,
    }))
    .filter((variable) => {
      if (seen.has(variable.name)) return false;
      seen.add(variable.name);
      return true;
    });

  const mode = abstraction.adaptationMode;
  const adaptationMode: StorySchemaAbstraction['adaptationMode'] =
    mode === 'source_faithful' || mode === 'inspired_by' || mode === 'original'
      ? mode
      : 'inspired_by';

  return {
    archetype: abstraction.archetype || 'General Story Pattern',
    adaptationMode,
    schemaVariables,
    generalizationGuidance: Array.isArray(abstraction.generalizationGuidance)
      ? abstraction.generalizationGuidance.map((guidance) =>
          String(guidance).replace(/\{([A-Z][A-Za-z0-9]*)\}/g, '$1'))
      : [],
    reusablePatternSummary: String(abstraction.reusablePatternSummary || ''),
  };
}

export function normalizeThemeArgument(
  raw: Partial<ThemeArgumentContract> | undefined,
  context: {
    themes: string[];
    anchors: StoryAnchors;
    schemaAbstraction?: StorySchemaAbstraction;
  },
): ThemeArgumentContract {
  const themeQuestion = cleanText(
    raw?.themeQuestion
      || context.themes.find(theme => theme.includes('?'))
      || `What must the protagonist become to protect ${context.anchors.stakes}?`,
  );
  const controllingSentence = cleanText(
    raw?.controllingIdea?.sentence
      || `${context.anchors.stakes} can be preserved because the protagonist changes under pressure.`,
  );
  const counterSentence = cleanText(
    raw?.counterIdea?.sentence
      || `${context.anchors.stakes} can only be preserved by refusing that change.`,
  );
  const centralValue = cleanText(raw?.controllingIdea?.value || context.themes[0] || 'change');
  const counterValue = cleanText(raw?.counterIdea?.value || `fear of ${centralValue}`);

  return {
    themeQuestion,
    controllingIdea: {
      value: centralValue,
      cause: cleanText(raw?.controllingIdea?.cause || context.anchors.climax),
      sentence: controllingSentence,
    },
    counterIdea: {
      value: counterValue,
      cause: cleanText(raw?.counterIdea?.cause || 'the old pattern appears safer than transformation'),
      sentence: counterSentence,
    },
    valueLadder: {
      positive: cleanText(raw?.valueLadder?.positive || centralValue),
      contrary: cleanText(raw?.valueLadder?.contrary || `absence of ${centralValue}`),
      contradiction: cleanText(raw?.valueLadder?.contradiction || `opposition to ${centralValue}`),
      negationOfNegation: cleanText(raw?.valueLadder?.negationOfNegation || `${centralValue} used as its own mask`),
    },
    archetypalCore: cleanText(
      raw?.archetypalCore
        || context.schemaAbstraction?.archetype
        || `A person is forced to choose what ${context.anchors.stakes} is worth.`,
    ),
    uniqueSurface: cleanText(
      raw?.uniqueSurface
        || context.schemaAbstraction?.reusablePatternSummary
        || context.anchors.incitingIncident,
    ),
    climaxResonantEvent: cleanText(raw?.climaxResonantEvent || context.anchors.climax),
    retroactiveReframe: cleanText(
      raw?.retroactiveReframe
        || `Earlier choices are re-read as preparation for ${context.anchors.climax}.`,
    ),
    aestheticEmotionTarget: cleanText(
      raw?.aestheticEmotionTarget
        || `The reader understands and feels why ${controllingSentence}`,
    ),
    imageSystem: Array.isArray(raw?.imageSystem)
      ? raw.imageSystem
          .filter(motif => motif?.motifId && motif?.motif)
          .map(motif => ({
            motifId: cleanSlug(motif.motifId),
            motif: cleanText(motif.motif),
            thematicMeaning: cleanText(motif.thematicMeaning),
            positiveTreatment: cleanText(motif.positiveTreatment),
            contraryTreatment: cleanText(motif.contraryTreatment),
            contradictionTreatment: cleanText(motif.contradictionTreatment),
            negationTreatment: cleanText(motif.negationTreatment),
            climaxTreatment: cleanText(motif.climaxTreatment),
          }))
      : undefined,
  };
}

function cleanText(value: unknown): string {
  return String(value || '').trim();
}

function cleanSlug(value: unknown): string {
  return slugify(cleanText(value) || 'motif');
}
