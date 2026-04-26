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
  SevenPointStructure,
  StorySchemaAbstraction,
  WritingStyleGuide,
  DirectLanguageFragmentGroups,
  StructuralRole,
  SEVEN_POINT_BEATS,
} from '../../types/sourceAnalysis';
import {
  distributeSevenPoints,
  describeDistribution,
  checkSevenPointCoverage,
} from '../utils/sevenPointDistribution';

/**
 * Render the default beat-to-episode distribution as a bulleted summary
 * for inlining into LLM prompts. We deliberately expose this as a
 * module-local helper so the prompt template can stay a plain tagged
 * template literal.
 */
function describeSuggestedDistribution(totalEpisodes: number): string {
  const entries = distributeSevenPoints(totalEpisodes);
  return describeDistribution(entries);
}
import {
  buildAnalysisFromEndingSeeds,
  normalizeEndingTargets,
} from '../utils/endingResolver';
import {
  BRANCH_AND_BOTTLENECK,
  STAKES_TRIANGLE,
  CHOICE_DENSITY_REQUIREMENTS,
} from '../prompts/storytellingPrinciples';
import { SOURCE_ANALYSIS_ABSTRACTION_EXAMPLE } from '../prompts/examples/storyCraftExamples';

// Input for the analyzer
export interface SourceMaterialInput {
  // The source text to analyze
  sourceText?: string;

  // Manual prompt or additional instructions
  userPrompt?: string;

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
  };
  majorCharacters: Array<{
    name: string;
    role: string;
    description: string;
    importance: string;
  }>;
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
   * 3-act / 7-point beat map inferred from the source material. Same
   * optional-with-backfill contract as {@link anchors}.
   */
  sevenPoint?: SevenPointStructure;
  schemaAbstraction?: StorySchemaAbstraction;
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

interface EpisodeBreakdownResponse {
  episodes: Array<{
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
    /**
     * LLM-assigned 7-point beat(s) this episode carries. Optional because
     * older LLM responses predate the field; backfilled by
     * {@link SourceMaterialAnalyzer.assembleAnalysis} from the default
     * distribution table when absent.
     */
    structuralRole?: StructuralRole[];
  }>;
  totalEpisodes: number;
  breakdownNotes: string;
}

export class SourceMaterialAnalyzer extends BaseAgent {
  private defaultScenesPerEpisode = 8; // Increased for more substantial episodes with shorter beats
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
- Have 5-8 scenes (bottleneck + branch zones)
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

- Preserve StoryRPG's anchors and sevenPoint fields as the authoritative macro structure.
- Use PascalCase names for reusable variables.
- Include variables such as ProtagonistRole, Stakes, Goal, IncitingIncident,
  AntagonizingForce, CoreValue, EmotionalAnchor, Temptation, FalseVictory,
  Cost, Climax, and Legacy when they apply.
- Generalize time/place/IP-specific elements into flexible roles.
- Never let {Variable} placeholders appear in final player-facing prose.

${SOURCE_ANALYSIS_ABSTRACTION_EXAMPLE}
`;
  }

  async execute(input: SourceMaterialInput): Promise<AgentResponse<SourceMaterialAnalysis>> {
    console.log(`[SourceMaterialAnalyzer] Starting analysis of source material...`);

    const targetScenes = input.preferences?.targetScenesPerEpisode || this.defaultScenesPerEpisode;
    const targetChoices = input.preferences?.targetChoicesPerEpisode || this.defaultChoicesPerEpisode;
    const pacing = input.preferences?.pacing || 'moderate';

    try {
      // Step 1: Analyze overall story structure
      console.log(`[SourceMaterialAnalyzer] Step 1: Analyzing story structure...`);
      const explicitWritingStyleInstruction = detectExplicitWritingStyleInstruction(input.userPrompt);
      const structureAnalysis = await this.analyzeStoryStructure(
        input.sourceText || '',
        input.title,
        input.userPrompt,
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
        input.userPrompt
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
    }
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

Analyze this text and respond with JSON:

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
    "arc": "<what they learn/how they change>"
  },
  "majorCharacters": [
    DO NOT include the protagonist here — they are already listed above.
    Only list OTHER characters (NPCs) in this array.
    {
      "name": "<name>",
      "role": "<antagonist/ally/mentor/love_interest/rival/neutral>",
      "description": "<brief description>",
      "importance": "<core/supporting/background>"
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
    "povAndDistance": "<point of view and closeness to protagonist interiority>",
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
  "sevenPoint": {
    "hook": "<ordinary world that introduces the protagonist and the core value at stake>",
    "plotTurn1": "<the inciting incident / world-disruption — must match the incitingIncident anchor above>",
    "pinch1": "<first major setback against the antagonizing force; protagonist on the defensive>",
    "midpoint": "<commitment / reversal / path-to-victory discovered; protagonist moves from reactive to proactive>",
    "pinch2": "<crisis and transformation culmination; everything seems lost>",
    "climax": "<decisive confrontation — must match the climax anchor above>",
    "resolution": "<aftermath + legacy; ordinary world changed>"
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
Return ONLY valid JSON.
`;

    const response = await this.callLLM([{ role: 'user', content: prompt }]);
    return this.parseJSON<StoryStructureAnalysis>(response);
  }

  /**
   * Second pass: Create detailed episode breakdown
   */
  private async createEpisodeBreakdown(
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

**Default 7-Point Beat Distribution (HINT — override only when the source demands it):**
${describeSuggestedDistribution(estimatedEpisodes)}
Every canonical beat (hook, plotTurn1, pinch1, midpoint, pinch2, climax, resolution)
MUST land on at least one episode across the season and must appear in canonical order.

${truncatedText ? `**Source Material Reference**:
${truncatedText}` : ''}

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
      "structuralRole": ["<which 7-point beat(s) this episode carries — choose from: hook, plotTurn1, pinch1, midpoint, pinch2, climax, resolution, rising, falling. Most episodes carry exactly one beat; very short seasons may fuse beats on one episode.>"]
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
    return this.parseJSON<EpisodeBreakdownResponse>(response);
  }

  /**
   * Assemble the final analysis from all passes
   */
  private assembleAnalysis(
    input: SourceMaterialInput,
    structure: StoryStructureAnalysis,
    breakdown: EpisodeBreakdownResponse
  ): SourceMaterialAnalysis {
    const totalEpisodes = breakdown.totalEpisodes;

    // Default structuralRole distribution — used as a fallback when the LLM
    // did not tag an episode with its own structuralRole array, and as the
    // seed when the LLM's coverage is incomplete.
    const defaultDistribution = distributeSevenPoints(totalEpisodes);
    const defaultRoleFor = (episodeNumber: number): StructuralRole[] => {
      const entry = defaultDistribution.find((e) => e.episodeNumber === episodeNumber);
      return entry ? [...entry.structuralRole] : ['rising'];
    };

    // Convert episode breakdown to full outlines
    const episodeOutlines: EpisodeOutline[] = breakdown.episodes.map((ep, idx) => {
      // Find plot points for this episode
      const episodePlotPoints: PlotPoint[] = ep.plotPoints.map((pp, ppIdx) => ({
        id: `ep${ep.episodeNumber}-pp${ppIdx + 1}`,
        description: pp,
        type: this.inferPlotPointType(pp, ep.episodeNumber, breakdown.totalEpisodes),
        importance: 'major' as const,
        targetEpisode: ep.episodeNumber,
        charactersInvolved: ep.mainCharacters,
      }));

      // Pull an LLM-assigned structuralRole if present, otherwise backfill
      // from the default distribution. Invalid values are filtered out so
      // downstream validators see a clean StructuralRole[] only.
      const llmRoles = Array.isArray(ep.structuralRole)
        ? ep.structuralRole.filter((r): r is StructuralRole =>
            typeof r === 'string' && (SEVEN_POINT_BEATS as readonly string[]).concat(['rising', 'falling']).includes(r))
        : [];
      const structuralRole = llmRoles.length > 0 ? llmRoles : defaultRoleFor(ep.episodeNumber);

      return {
        episodeNumber: ep.episodeNumber,
        title: ep.title,
        synopsis: ep.synopsis,
        sourceChapters: [ep.sourceChapters],
        sourceSummary: ep.synopsis,
        plotPoints: episodePlotPoints,
        mainCharacters: ep.mainCharacters,
        supportingCharacters: [],
        locations: ep.locations,
        estimatedSceneCount: input.preferences?.targetScenesPerEpisode || this.defaultScenesPerEpisode,
        estimatedChoiceCount: input.preferences?.targetChoicesPerEpisode || this.defaultChoicesPerEpisode,
        structuralRole,
        narrativeFunction: ep.narrativeArc,
      };
    });

    // If coverage is incomplete, rewrite the distribution to the default so
    // every beat is guaranteed to land somewhere. This is a safety net for
    // LLMs that drop beats when the episode count is tight.
    const coverageIssues = checkSevenPointCoverage(episodeOutlines);
    if (coverageIssues.length > 0) {
      for (const outline of episodeOutlines) {
        outline.structuralRole = defaultRoleFor(outline.episodeNumber);
      }
    }

    // Anchors + sevenPoint: prefer the LLM's, fall back to plot-point
    // inference using approximatePosition labels from the structure pass.
    const anchors: StoryAnchors = structure.anchors && hasAllAnchorFields(structure.anchors)
      ? structure.anchors
      : inferAnchorsFromStructure(structure);

    const sevenPoint: SevenPointStructure = structure.sevenPoint && hasAllBeatFields(structure.sevenPoint)
      ? structure.sevenPoint
      : inferSevenPointFromStructure(structure, anchors);

    // Convert story arcs with episode ranges
    const storyArcs: StoryArc[] = structure.storyArcs.map((arc, idx) => ({
      id: `arc-${idx + 1}`,
      name: arc.name,
      description: arc.description,
      startChapter: arc.chapters,
      estimatedEpisodeRange: this.estimateArcEpisodeRange(arc, breakdown.totalEpisodes, idx, structure.storyArcs.length),
    }));

    // Build major characters list with first appearances
    const majorCharacters = structure.majorCharacters.map((char, idx) => ({
      id: `char-${slugify(char.name)}`,
      name: char.name,
      role: this.normalizeRole(char.role),
      description: char.description,
      importance: this.normalizeImportance(char.importance),
      firstAppearance: this.findFirstAppearance(char.name, breakdown.episodes),
    }));

    // Build locations list
    const keyLocations = structure.keyLocations.map((loc, idx) => ({
      id: `loc-${loc.name.toLowerCase().replace(/\s+/g, '-')}`,
      name: loc.name,
      description: loc.description,
      importance: this.normalizeLocationImportance(loc.importance),
      firstAppearance: this.findLocationFirstAppearance(loc.name, breakdown.episodes),
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

    return {
      sourceTitle: input.title || 'Untitled',
      sourceAuthor: input.author,
      totalWordCount: (input.sourceText || '').trim().length > 0 ? input.sourceText!.split(/\s+/).length : 0,

      genre: structure.genre,
      tone: structure.tone,
      themes: structure.themes,
      setting: structure.setting,

      anchors,
      sevenPoint,
      schemaAbstraction: normalizeSchemaAbstraction(structure.schemaAbstraction, anchors),
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
      detectedEndingMode: endingFields.detectedEndingMode,
      resolvedEndingMode: endingFields.resolvedEndingMode,
      endingModeReasoning: structure.endingAnalysis?.reasoning,
      extractedEndings: endingFields.extractedEndings,
      generatedEndings: endingFields.generatedEndings,
      resolvedEndings: endingFields.resolvedEndings,
      episodeBreakdown: episodeOutlines,
      totalEstimatedEpisodes: breakdown.totalEpisodes,

      protagonist: {
        id: `char-${slugify(structure.protagonist.name)}`,
        name: structure.protagonist.name,
        description: structure.protagonist.description,
        arc: structure.protagonist.arc,
      },
      majorCharacters,
      keyLocations,

      analysisTimestamp: new Date(),
      confidenceScore,
      warnings,
      directLanguageFragments: normalizeDirectLanguageFragments(structure.directLanguageFragments),
      adaptationGuidance: normalizeAdaptationGuidance(structure.adaptationGuidance),
    };
  }

  // Helper methods
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
// Anchor + sevenPoint inference helpers
//
// When the LLM drops the anchors / sevenPoint blocks (older models,
// truncated responses, aggressive compression), we fall back to deriving
// them from the existing `protagonist.arc`, `storyArcs`, and
// `majorPlotPoints` fields. This keeps Path A's "7-points are always
// first-class" guarantee intact without requiring a second LLM call.
// ---------------------------------------------------------------------------

function hasAllAnchorFields(anchors: Partial<StoryAnchors> | undefined): anchors is StoryAnchors {
  if (!anchors) return false;
  return !!(anchors.stakes && anchors.goal && anchors.incitingIncident && anchors.climax);
}

function hasAllBeatFields(sp: Partial<SevenPointStructure> | undefined): sp is SevenPointStructure {
  if (!sp) return false;
  return SEVEN_POINT_BEATS.every((b) => typeof sp[b] === 'string' && (sp[b] as string).trim().length > 0);
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

function inferSevenPointFromStructure(
  structure: StoryStructureAnalysis,
  anchors: StoryAnchors,
): SevenPointStructure {
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
    hook: byTypeOrPosition('opening', 0) || `${protagonistName} in the ordinary world before the story begins. ${primaryArcDesc}`.trim(),
    plotTurn1: anchors.incitingIncident,
    pinch1: byTypeOrPosition('rising', 0.35) || `First major setback against the antagonizing force; ${protagonistName} is forced on the defensive.`,
    midpoint: byTypeOrPosition('midpoint', 0.5) || `${protagonistName} commits fully to the goal after a revelation or reversal.`,
    pinch2: byTypeOrPosition('twist', 0.7) || `Crisis that appears to undo everything ${protagonistName} has gained; the final transformation begins here.`,
    climax: anchors.climax,
    resolution: byTypeOrPosition('resolution', 1) || `The aftermath and legacy of the climax; the ordinary world is visibly changed.`,
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
      || 'Stay close enough to the protagonist for immediacy without over-defining the player character.',
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
