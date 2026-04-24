// @ts-nocheck — TODO(tech-debt): type drift with GeneratedBeat / sourceAnalysis
// fragments; address in Phase 3 pipeline refactor and Phase 7 type consolidation.
/**
 * Scene Writer Agent
 *
 * The prose and description specialist responsible for:
 * - Writing immersive scene descriptions
 * - Creating atmospheric narrative text
 * - Generating dialogue with distinct character voices
 * - Crafting the actual content beats for each scene
 */

import { AgentConfig, GenerationSettingsConfig } from '../config';
import { BaseAgent, AgentResponse } from './BaseAgent';
import { SceneBlueprint } from './StoryArchitect';
import { Beat, TextVariant, Consequence, TimingMetadata } from '../../types';
import {
  SourceMaterialAnalysis,
  StoryAnchors,
  SevenPointStructure,
  StructuralRole,
} from '../../types/sourceAnalysis';
import { ChoiceDensityValidator } from '../validators/ChoiceDensityValidator';
import {
  CHOICE_DENSITY_REQUIREMENTS,
  NARRATIVE_INTENSITY_RULES,
  buildStructuralContextSection,
} from '../prompts/storytellingPrinciples';
import { buildSceneWriterCallbackSection } from '../prompts/callbackPromptSection';
import { SCENE_WRITER_BEAT_EXAMPLE } from '../prompts/examples/storyCraftExamples';
import { DEFAULT_LIMITS } from '../utils/textEnforcer';
import { TEXT_LIMITS } from '../../constants/validation';
import type { SceneSettingContext } from '../utils/styleAdaptation';

// Input types
export interface SceneWriterInput {
  // Scene blueprint from Story Architect
  sceneBlueprint: SceneBlueprint;

  // Story context
  storyContext: {
    title: string;
    genre: string;
    tone: string;
    worldContext: string;
    userPrompt?: string;
  };

  // Character information
  protagonistInfo: {
    name: string;
    pronouns: 'he/him' | 'she/her' | 'they/them';
    description: string;
    physicalDescription?: string;
  };

  npcs: Array<{
    id: string;
    name: string;
    pronouns: 'he/him' | 'she/her' | 'they/them';
    description: string;
    physicalDescription?: string;
    voiceNotes: string; // How they speak
    currentMood?: string;
  }>;

  // State context (for conditional content)
  relevantFlags?: Array<{ name: string; description: string }>;
  relevantScores?: Array<{ name: string; description: string }>;

  // Scene specific guidance
  targetBeatCount: number; // Max beats per scene (cap)—engine may use fewer
  dialogueHeavy: boolean; // Is this a conversation-focused scene?

  // Previous scene summary (for continuity)
  previousSceneSummary?: string;

  // Choice payoff context: describes what player choice led to this scene.
  // When present, the FIRST beat must visually and textually pay off this choice.
  incomingChoiceContext?: string;

  // Source material analysis for IP fidelity (optional)
  sourceAnalysis?: SourceMaterialAnalysis;

  /**
   * Season-level narrative anchors (from SeasonPlan.anchors).
   * When present, SceneWriter keeps every prose beat grounded in the
   * shared Stakes / Goal / Inciting Incident / Climax anchors.
   */
  seasonAnchors?: StoryAnchors;

  /**
   * Season-level 7-point beat map (from SeasonPlan.sevenPoint). Used to
   * tell SceneWriter where this scene sits on the season's dramatic curve.
   */
  seasonSevenPoint?: SevenPointStructure;

  /**
   * Which beat(s) of the season this episode is carrying (from
   * SeasonEpisode.structuralRole). Drives scene mood / intensity defaults.
   */
  episodeStructuralRole?: StructuralRole[];

  // Context about the episode's climactic encounter that this scene is building toward.
  // Provided for all non-encounter scenes so the writer can plant seeds, establish stakes,
  // and frame choices in ways that make the encounter feel earned when players reach it.
  episodeEncounterContext?: {
    encounterType: string;
    encounterDescription: string;
    encounterDifficulty: string;
    encounterBuildup: string; // What THIS scene specifically should establish
  };

  // Pipeline memory / optimization hints from prior runs (optional)
  memoryContext?: string;

  // Branch topology context from BranchManager (Phase 1.1).
  // When provided, SceneWriter knows whether this scene is a bottleneck,
  // a branch-only scene, or a reconvergence point, and what state differences
  // must be acknowledged.
  branchContext?: {
    role: 'bottleneck' | 'branch' | 'reconvergence' | 'linear';
    branchPathIds?: string[];
    incomingBranchIds?: string[];
    stateReconciliationNotes?: string[];
    reconvergenceNarrativeAcknowledgment?: string;
  };

  // Narrative threads active for this scene (Phase 5.3).
  // SceneWriter must plant or pay off these threads in the beat text
  // and set `plantsThreadId` / `paysOffThreadId` on the corresponding beat.
  activeThreads?: Array<{
    id: string;
    kind: 'seed' | 'clue' | 'promise' | 'secret' | 'foreshadow';
    label: string;
    action: 'plant' | 'payoff' | 'reference';
    hint?: string;
  }>;

  // Twist scheduling from TwistArchitect (Phase 6).
  // When provided, SceneWriter marks the designated beat as a twist or revelation
  // and drops subtle setup cues in the named setup beats.
  twistDirectives?: Array<{
    twistKind: 'reversal' | 'revelation' | 'betrayal' | 'reframe';
    beatRole: 'setup' | 'twist' | 'satisfaction';
    hint: string;
  }>;

  // Character arc milestone targets (Phase 7.1).
  // When provided, SceneWriter frames beats so protagonist choices can move
  // identity and relationship dimensions in the direction of these targets.
  arcTargets?: {
    identityDeltaHints?: Array<{ dimension: string; direction: 'positive' | 'negative'; magnitude: 'minor' | 'moderate' | 'major' }>;
    relationshipTrajectory?: Array<{ npcId: string; dimension: string; direction: 'positive' | 'negative'; hint: string }>;
  };

  // Unresolved callback hooks from prior episodes (Plan 1: Delayed Consequences).
  // When present, SceneWriter SHOULD author TextVariants that reference one of
  // these hooks via `callbackHookId`, gated on the hook's flags.
  unresolvedCallbacks?: Array<{
    id: string;
    sourceEpisode: number;
    summary: string;
    flags: string[];
  }>;
}

// Output types
export interface GeneratedBeat {
  id: string;
  text: string;
  content?: string; // Fallback field sometimes used by LLMs
  textVariants?: TextVariant[];
  speaker?: string;
  speakerMood?: string;
  nextBeatId?: string;
  onShow?: Consequence[];
  // Note: choices are added by Choice Author agent
  isChoicePoint?: boolean; // Mark where Choice Author should add choices
  // Timing metadata for choice density validation
  timing?: TimingMetadata;
  // Visual contract authored alongside prose to prevent downstream drift
  visualMoment?: string; // One concrete, observable instant for this beat
  primaryAction?: string; // Verb-led physical action
  emotionalRead?: string; // Visible face/body emotional cues
  relationshipDynamic?: string; // Spatial/power dynamic between characters
  mustShowDetail?: string; // Non-negotiable visual clue for this beat
  allowDiegeticText?: boolean; // When true, text in the image is permitted (letter, sign, book)
  shotType?: 'establishing' | 'character' | 'action'; // Camera intent: environment-only, character-focused, or physical action
  intensityTier?: 'dominant' | 'supporting' | 'rest'; // Narrative intensity for scene-level pacing
  visualContinuity?: Beat['visualContinuity']; // Optional beat-to-beat flow metadata

  // Setup-payoff + plot-point metadata (Phases 5, 6)
  plantsThreadId?: string;
  paysOffThreadId?: string;
  plotPointType?: 'setup' | 'payoff' | 'twist' | 'revelation';
  twistKind?: 'reversal' | 'revelation' | 'betrayal' | 'reframe';
}

export interface SceneContent {
  sceneId: string;
  sceneName: string;
  locationId?: string;
  beats: GeneratedBeat[];
  startingBeatId: string;

  // Metadata for other agents
  moodProgression: string[];
  charactersInvolved: string[];
  keyMoments: string[];
  sceneTakeaways?: string[];
  transitionIn?: string;

  // Continuity notes
  continuityNotes: string[];

  // Branch metadata for visual differentiation
  branchType?: 'dark' | 'hopeful' | 'neutral' | 'tragic' | 'redemption';
  isBottleneck?: boolean;
  isConvergencePoint?: boolean;

  // Threads planted/paid off in this scene (Phase 5.3).
  plantedThreadIds?: string[];
  paidOffThreadIds?: string[];

  // Choice payoff context — the player choice that led to this scene.
  // Threaded to the image pipeline so the first beat's image reflects the choice.
  incomingChoiceContext?: string;

  // Timing analysis (added post-generation)
  timingAnalysis?: {
    totalReadingTimeSeconds: number;
    hasChoicePoint: boolean;
    estimatedTimeToFirstChoice?: number;
  };

  // Canonical scene-setting profile for downstream image generation.
  settingContext?: SceneSettingContext;
}

export class SceneWriter extends BaseAgent {
  private choiceDensityValidator: ChoiceDensityValidator;
  private textLimits: {
    maxSentences: number;
    maxWords: number;
    maxDialogueWords: number;
    maxDialogueLines: number;
  };

  constructor(config: AgentConfig, generationConfig?: GenerationSettingsConfig) {
    super('Scene Writer', config);
    this.includeSystemPrompt = true;
    this.choiceDensityValidator = new ChoiceDensityValidator();
    // Use generation config text limits or fall back to defaults
    this.textLimits = {
      maxSentences: generationConfig?.maxSentencesPerBeat ?? DEFAULT_LIMITS.maxSentences,
      maxWords: generationConfig?.maxWordsPerBeat ?? DEFAULT_LIMITS.maxWords,
      maxDialogueWords: generationConfig?.maxDialogueWords ?? DEFAULT_LIMITS.maxDialogueWords,
      maxDialogueLines: generationConfig?.maxDialogueLines ?? DEFAULT_LIMITS.maxDialogueLines,
    };
  }

  protected getAgentSpecificPrompt(): string {
    return `
## Your Role: Scene Writer

You are a master prose writer who brings scene blueprints to life with vivid, immersive narrative text. You write the actual words players will read.

## Writing Principles: The Two-Pass Method
1. **Pass 1: Cinematic Quality**: Focus on drama, subtext, and reversals first. Every scene must advance Plot, Relationship, or Thematic Pressure.
2. **Pass 2: Interactive Conversion**: Ground interactivity in the scene's truth. Use player state to acknowledging past choices.

### Show, Don't Tell
- Reveal character through action, not description.
- Let the reader infer emotions from behavior.
- Use sensory details to create atmosphere.

### Immersive Description
- Engage all five senses.
- Ground scenes in specific, concrete details.
- Vary sentence length for rhythm.
- **Atmospheric Fidelity**: Use the specific prose style and terminology of the source material if identified.

### Character Voice
- Each character must sound distinct.
- Dialogue should reveal personality.
- Use subtext - what's NOT said matters.
- **Direct Source Language**: If source material fragments are provided, PRIORITIZE using that exact language for key moments and dialogue.

### Pacing
- Match prose length to moment importance.
- Quick beats for tension, longer for reflection.
- Vary the rhythm within scenes.

### Scene Craft
- Every scene needs a purpose players can feel: plot pressure, relationship movement, theme pressure, information gain, or meaningful aftermath.
- Identify the scene's key moment and build the beat sequence toward it.
- Include scene takeaways: what the player should learn, feel, or understand by the end.
- Use natural transition phrasing in continuityNotes or transitionIn ("Later that night", "Back at the observatory") when time or place shifts.
- End the final beat with forward pressure into the next beat, choice, scene, or episode.
- Keep dialogue concise, pointed, and subtextual; characters may disagree, tease, avoid, or reveal, but not every conversation needs to become an argument.
- Use selective interiority when it deepens player connection, but avoid over-defining the player character's identity.
- Do not use film/camera direction terms in player-facing prose. Visual metadata may still use the required shotType and visualContinuity fields.

${NARRATIVE_INTENSITY_RULES}

## Beat Structure (Caps—Engine Has Latitude)

**Caps**: Stay under these limits; use fewer words when the moment doesn't need more.

### Standard Beats
- **Cap**: ${this.textLimits?.maxSentences ?? DEFAULT_LIMITS.maxSentences} sentences, ${this.textLimits?.maxWords ?? DEFAULT_LIMITS.maxWords} words per beat
- Target 2-3 sentences when appropriate
- Focused on ONE moment, ONE action, or ONE short dialogue exchange
- Connected to the next beat naturally

### Climax Beats (SPARING—true narrative peaks only)
- Set \`isClimaxBeat: true\` for the single most intense moment in a scene
- **Cap**: Up to ${TEXT_LIMITS.maxClimaxBeatWordCount} words
- **Max 1-2 per scene**—only for genuine climaxes, not every dramatic moment

### Key Story Beats (turning points)
- Set \`isKeyStoryBeat: true\` for crucial narrative turning points
- **Cap**: Up to ${TEXT_LIMITS.maxKeyStoryBeatWordCount} words
- **Max ${TEXT_LIMITS.maxKeyStoryBeatsPerScene} per scene**

**Why short beats?**
- Mobile screens have limited space
- Players tap to advance - frequent taps feel interactive
- Long text walls cause readers to disengage. DO NOT WRITE PARAGRAPHS.

Example of TOO LONG (DON'T DO THIS):
"The tavern was dim and smoky, filled with the murmur of conversations and the clink of glasses. You pushed through the crowd, scanning faces until you spotted your contact in a shadowy corner booth. She was a tall woman with sharp features and cold eyes that seemed to assess you in an instant. As you approached, she gestured for you to sit, her expression giving nothing away."

Example of CORRECT (multiple short beats):
Beat 1: "The tavern was dim and smoky. You pushed through the crowd, scanning for your contact."
Beat 2: "There—a shadowy corner booth. A tall woman with sharp features watched you approach."
Beat 3: "Her cold eyes assessed you instantly. She gestured for you to sit, expression unreadable."

## Text Variants (STRICT FORMAT)

Use textVariants when player state should change the scene.
**CRITICAL: You MUST use the explicit condition object format.**

Correct Example:
"textVariants": [
  {
    "condition": { "type": "flag", "flag": "is_damaged", "value": true },
    "text": "Your metallic arm sparks with blue electricity."
  }
]

**FORBIDDEN Example (DO NOT DO THIS):**
"textVariants": [
  { "is_damaged": "Your arm sparks." }
]

**Rules:**
- ALWAYS include both "condition" and "text" fields.
- "condition" must have a "type" (flag, score, relationship, attribute).
- "text" must be a non-empty string.
- If a condition is met, this text REPLACES the base text for that beat.

## Consequences

Use onShow consequences when entering a beat should:
- Set a flag (first time entering a location)
- Modify a relationship
- Update a score

## Template Variables

You can use these in text (will be replaced at runtime):

**Player Templates:**
- {{player.name}} - Player's character name
- {{player.they}} - Subject pronoun (he/she/they)
- {{player.them}} - Object pronoun (him/her/them)
- {{player.their}} - Possessive pronoun (his/her/their)
- {{player.theirs}} - Possessive pronoun (his/hers/theirs)
- {{player.themselves}} - Reflexive pronoun (himself/herself/themselves)
- {{player.are}} - Verb form (is/are)
- {{player.were}} - Past tense verb (was/were)
- {{player.have}} - Verb form (has/have)

**NPC Templates:**
- {{npc.CHARACTER_ID.name}} - NPC's name (replace CHARACTER_ID with actual ID)
- {{npc.CHARACTER_ID.they}} - NPC's subject pronoun
- {{npc.CHARACTER_ID.them}} - NPC's object pronoun
- {{npc.CHARACTER_ID.their}} - NPC's possessive pronoun

## CRITICAL: Character Names and Pronouns

**ABSOLUTE REQUIREMENTS:**
1. **Use EXACT character names** as provided in the Characters section. Do NOT invent names, alter spellings, or use nicknames unless established.
2. **Use CORRECT pronouns** for each character as specified:
   - "he/him" characters: he, him, his, himself
   - "she/her" characters: she, her, hers, herself
   - "they/them" characters: they, them, their, theirs, themselves (singular) — only for characters explicitly marked as they/them
3. **Use he/him or she/her by default.** Only use they/them pronouns for characters explicitly designated as non-binary or transgender. Never default to they/them for a character whose gender is simply unspecified.
4. **Be consistent** - do not switch between pronouns for the same character.
5. **Use names frequently** to avoid ambiguous pronoun references when multiple characters are present.
6. For the protagonist, use {{player.name}} and the appropriate pronoun templates ({{player.they}}, {{player.them}}, etc.).
7. For NPCs, use their exact names and correct pronouns as listed, or use NPC templates like {{npc.CHARACTER_ID.name}}.

**VERB CONJUGATION WITH TEMPLATES (IMPORTANT):**
The player's pronouns may change at runtime, so verb forms must be written carefully:
- **Prefer {{player.name}} as the sentence subject** when an action verb follows. This avoids conjugation issues entirely. Example: "{{player.name}} catches her wrist" — correct for all pronoun sets.
- When you DO use {{player.they}} as the subject, **write the verb for "they" (plural form)**. The runtime engine auto-conjugates for singular pronouns. Example: "{{player.they}} catch her wrist" will render correctly as "He catches" / "She catches" / "They catch".
- Use {{player.are}}, {{player.were}}, {{player.have}} for those specific verbs.
- **Capitalize the template at sentence starts**: Use {{Player.they}} (capital P) when the template begins a sentence, so the pronoun is capitalized ("He"/"She"/"They" instead of "he"/"she"/"they").

**COMMON ERRORS TO AVOID:**
- Using "he" for a she/her character (or vice versa)
- Inventing names not in the character list
- Using generic terms like "the stranger" when you have the character's name
- Ambiguous pronoun references when multiple same-pronoun characters are present
- Using {{player.they}} with a singular verb like "catches" — always use the plural form ("catch") with pronoun templates

## Choice Points (STRICT ENFORCEMENT)

When the scene blueprint indicates a choice point:
1. **Identify the Choice Beat**: The very last beat of the scene MUST be the choice point.
2. **Mark the Beat**: Set "isChoicePoint": true on that last beat.
3. **Set Up the Choice**: The text of this beat should end on a cliffhanger, a question, or a moment of high tension where a decision is required.
4. **NO PROSE CHOICES**: Do NOT write the actual choice options in the text. The Choice Author agent will do that.
5. **No nextBeatId**: The choice beat should NOT have a nextBeatId, as the choices will handle navigation.

## Beat Visual Contract (REQUIRED for EVERY beat)

For each beat object, include these fields so image agents do not have to guess:
- "shotType": REQUIRED. The camera intent for this beat. Use "establishing" for beats that are purely atmospheric — describing place, time of day, weather, or environment — with NO character performing a specific action. Use "action" for beats with physical movement or confrontation. Use "character" for all other beats (dialogue, reaction, emotion). When shotType is "establishing", the image should be a wide environment shot with no characters foregrounded.
- "visualMoment": One concrete, observable instant using CHARACTER NAMES. For "establishing" shots, describe the environment/atmosphere: "Neon reflections smear across rain-slicked streets below." For character beats, YES: "Catherine races ahead of Heathcliff across the moor." NO: "Two young people running." NEVER use generic terms like "a woman", "a man", "two people".
- "primaryAction": Verb-led physical action naming the character(s). Leave empty ("") for "establishing" shots. YES: "Catherine sprints barefoot" NO: "running across the moor".
- "emotionalRead": What is visibly readable in face/body language, naming each character. Leave empty ("") for "establishing" shots.
- "relationshipDynamic": Power/proximity/tension between named characters. Leave empty ("") for "establishing" shots.
- "mustShowDetail": One specific visual clue that must appear.
- "intensityTier": REQUIRED. One of "dominant", "supporting", or "rest". Assign based on the Narrative Intensity Tiering rules above. A scene needs 1-2 dominant beats, 1-2 rest beats, and the remainder as supporting. Vary the intensity across the scene.
- "visualContinuity": OPTIONAL but encouraged. Use it to make this beat flow from the previous beat as the next full-screen image: shotType, cameraAngle, focalCharacterId, blocking, proximity, motifOrProp, previousBeatId, transitionIntent, panelMode. Default panelMode is "single". Do NOT request panels, collages, split screens, contact sheets, or multiple moments inside the same image.

Avoid abstract-only phrases like "tension rises" or "emotion deepens." Describe what is physically visible. ALWAYS use character names — never generic references.

**CHARACTER APPEARANCE CONSISTENCY (CRITICAL)**: When describing characters in beat text, visual contract fields, or any visual/descriptive context, you MUST use their canonical Physical Appearance as listed in the Characters section. NEVER invent or change hair color, eye color, body type, or other physical attributes. If a character has "blonde hair" in their physical description, ALWAYS write "blonde hair", NEVER "dark hair" or any other variant. The Physical Appearance entries are the source of truth.

${SCENE_WRITER_BEAT_EXAMPLE}

## Quality Standards

Before finalizing:
- Is the prose engaging and varied?
- Are character voices consistent and distinct?
- Does the scene flow naturally?
- Are sensory details present?
- Does it match the intended mood?
- **Are ALL character names spelled correctly?**
- **Are ALL pronouns correct for each character?**
- **Are pronoun references clear and unambiguous?**

${CHOICE_DENSITY_REQUIREMENTS}
`;
  }

  async execute(input: SceneWriterInput, retryCount: number = 0): Promise<AgentResponse<SceneContent>> {
    const maxRetries = 1; // Allow one revision pass
    const prompt = this.buildPrompt(input);

    console.log(`[SceneWriter] Writing scene: ${input.sceneBlueprint.id} - "${input.sceneBlueprint.name}"${retryCount > 0 ? ` (revision ${retryCount})` : ''}`);

    try {
      const response = await this.callLLM([
        { role: 'user', content: prompt }
      ]);

      console.log(`[SceneWriter] Received response (${response.length} chars)`);

      let content: SceneContent;
      try {
        content = this.parseJSON<SceneContent>(response);
      } catch (parseError) {
        console.error(`[SceneWriter] JSON parse failed. Raw response (first 500 chars):`, response.substring(0, 500));
        throw parseError;
      }

      // Normalize arrays that the LLM might return as strings or undefined
      content = this.normalizeContent(content, input);

      // Check for issues that need revision
      const issues = this.collectIssues(content, input);

      if (issues.length > 0 && retryCount < maxRetries) {
        console.log(`[SceneWriter] Found ${issues.length} issues, requesting revision...`);
        return this.executeRevision(input, content, issues);
      }

      console.log(`[SceneWriter] Scene has ${content.beats?.length || 0} beats`);

      // DEBUG: Log choice point status
      const choicePointBeats = content.beats?.filter(b => b.isChoicePoint) || [];
      console.log(`[SceneWriter] Choice point beats: ${choicePointBeats.length}`);
      if (choicePointBeats.length > 0) {
        choicePointBeats.forEach(beat => {
          console.log(`[SceneWriter]   - Beat "${beat.id}" is marked as choicePoint`);
        });
      } else if (input.sceneBlueprint.choicePoint) {
        console.warn(`[SceneWriter] WARNING: Blueprint has choicePoint but no beat is marked as isChoicePoint!`);
        console.log(`[SceneWriter]   Blueprint choicePoint: ${JSON.stringify(input.sceneBlueprint.choicePoint)}`);
      }

      // Validate the content (with error handling to prevent crashes)
      try {
        this.validateContent(content, input);
      } catch (validationError) {
        // If validation throws, log it but try to continue with auto-fixed content
        const errorMsg = validationError instanceof Error ? validationError.message : String(validationError);
        console.error(`[SceneWriter] Validation error (attempting to continue): ${errorMsg}`);
        
        // If it's a beat reference error, we've already fixed it in normalization, so this shouldn't happen
        // But if it does, log and continue
        if (errorMsg.includes('references non-existent beat')) {
          console.warn(`[SceneWriter] Beat reference error caught - content should have been auto-fixed`);
          // Content should be fine, continue
        } else {
          // For other validation errors, re-throw
          throw validationError;
        }
      }

      return {
        success: true,
        data: content,
        rawResponse: response,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`[SceneWriter] Error:`, errorMsg);
      return {
        success: false,
        error: errorMsg,
      };
    }
  }

  private normalizeContent(content: SceneContent, input?: SceneWriterInput): SceneContent {
    // Ensure scalar fields have defaults - use scene blueprint values if available
    if (!content.sceneId) {
      content.sceneId = input?.sceneBlueprint?.id || 'scene-1';
    }
    if (!content.sceneName) {
      content.sceneName = input?.sceneBlueprint?.name || 'Untitled Scene';
    }

    // Ensure top-level arrays are arrays
    if (!content.moodProgression) {
      content.moodProgression = [];
    } else if (!Array.isArray(content.moodProgression)) {
      content.moodProgression = [content.moodProgression as unknown as string];
    }

    if (!content.charactersInvolved) {
      content.charactersInvolved = [];
    } else if (!Array.isArray(content.charactersInvolved)) {
      content.charactersInvolved = [content.charactersInvolved as unknown as string];
    }

    if (!content.keyMoments) {
      content.keyMoments = [];
    } else if (!Array.isArray(content.keyMoments)) {
      content.keyMoments = [content.keyMoments as unknown as string];
    }

    if (!content.continuityNotes) {
      content.continuityNotes = [];
    } else if (!Array.isArray(content.continuityNotes)) {
      content.continuityNotes = [content.continuityNotes as unknown as string];
    }

    if (!content.sceneTakeaways) {
      content.sceneTakeaways = [];
    } else if (!Array.isArray(content.sceneTakeaways)) {
      content.sceneTakeaways = [content.sceneTakeaways as unknown as string];
    }

    if (content.transitionIn && typeof content.transitionIn !== 'string') {
      content.transitionIn = String(content.transitionIn);
    }

    if (!content.beats) {
      content.beats = [];
    } else if (!Array.isArray(content.beats)) {
      content.beats = [content.beats as unknown as GeneratedBeat];
    }

    // Normalize each beat
    for (let i = 0; i < content.beats.length; i++) {
      const beat = content.beats[i];

      // Ensure beat has an id
      if (!beat.id) {
        beat.id = `beat-${i + 1}`;
      }

      // Ensure beat has text as a string
      // LLM sometimes uses 'content' instead of 'text' or nests it in an object
      const anyBeat = beat as any;
      if (!beat.text) {
        if (anyBeat.content) {
          if (typeof anyBeat.content === 'string') {
            beat.text = anyBeat.content;
          } else if (typeof anyBeat.content === 'object') {
            beat.text = anyBeat.content.narrative || anyBeat.content.text || anyBeat.content.dialogue?.[0]?.text || '';
          }
        } else if (anyBeat.narrative) {
          beat.text = anyBeat.narrative;
        }
      }

      if (!beat.text) {
        beat.text = '';
      } else if (typeof beat.text !== 'string') {
        // LLM sometimes returns text as an object or array - handle it gracefully
        if (Array.isArray(beat.text)) {
          beat.text = beat.text.map(item => {
            if (typeof item === 'string') return item;
            if (typeof item === 'object' && item !== null) {
              return (item as any).text || (item as any).content || JSON.stringify(item);
            }
            return String(item);
          }).join(' ');
        } else if (typeof beat.text === 'object' && beat.text !== null) {
          beat.text = (beat.text as any).text || (beat.text as any).content || JSON.stringify(beat.text);
        } else {
          beat.text = String(beat.text);
        }
        console.warn(`[SceneWriter] Beat ${beat.id || i} had non-string text, converted to string: ${beat.text.substring(0, 50)}...`);
      }

      if (beat.textVariants && !Array.isArray(beat.textVariants)) {
        beat.textVariants = [beat.textVariants as unknown as TextVariant];
      }
      
      // AUTO-FIX: Malformed text variants
      if (beat.textVariants) {
        beat.textVariants = beat.textVariants.map(variant => {
          const v = variant as any;
          // Check for "lazy" variant: { "flag_name": "text" }
          if (typeof variant === 'object' && !variant.text && !variant.condition) {
            const keys = Object.keys(variant);
            if (keys.length === 1 && typeof v[keys[0]] === 'string') {
              console.warn(`[SceneWriter] Auto-fixing lazy text variant: ${keys[0]}`);
              return {
                condition: { type: 'flag' as const, flag: keys[0], value: true },
                text: v[keys[0]]
              } as TextVariant;
            }
          }
          return variant;
        }).filter(v => v && v.text); // Remove empty/null variants
      }

      if (beat.onShow && !Array.isArray(beat.onShow)) {
        beat.onShow = [beat.onShow as unknown as Consequence];
      }

      // Ensure visual contract fields exist and are concrete enough for downstream image agents.
      this.ensureBeatVisualContract(beat);
    }

    // Guard against degenerate choice scenes. If the writer returns only one beat for a
    // scene that needs a decision, the whole scene can collapse into "choice beat + payoff beat"
    // and skip the setup that branch scenes need for pacing, QA, and image coverage.
    this.ensureMinimumChoiceSceneBeats(content, input);

    // Re-run visual contract normalization in case we synthesized structural beats.
    for (const beat of content.beats) {
      this.ensureBeatVisualContract(beat);
    }

    // Normalize beat IDs and fix nextBeatId references
    const beatIds = new Set(content.beats.map(b => b.id));
    const beatIndexMap = new Map<string, number>();
    content.beats.forEach((b, idx) => {
      beatIndexMap.set(b.id, idx);
    });

    // Fix invalid nextBeatId references
    for (let i = 0; i < content.beats.length; i++) {
      const beat = content.beats[i];
      
      if (beat.nextBeatId && !beatIds.has(beat.nextBeatId)) {
        let fixed = false;
        
        // Try multiple strategies to fix the reference
        // Strategy 1: Extract all numbers and try each (e.g., "beat-3-2" -> try "beat-3", "beat-2")
        const allNumbers = beat.nextBeatId.match(/\d+/g);
        if (allNumbers) {
          for (const num of allNumbers) {
            const candidateId = `beat-${num}`;
            if (beatIds.has(candidateId)) {
              console.log(`[SceneWriter] Auto-fixing nextBeatId: "${beat.nextBeatId}" -> "${candidateId}"`);
              beat.nextBeatId = candidateId;
              fixed = true;
              break;
            }
          }
        }
        
        // Strategy 2: Try the last number (often the correct one in patterns like "beat-3-2")
        if (!fixed && allNumbers && allNumbers.length > 1) {
          const lastNumber = allNumbers[allNumbers.length - 1];
          const candidateId = `beat-${lastNumber}`;
          if (beatIds.has(candidateId)) {
            console.log(`[SceneWriter] Auto-fixing nextBeatId: "${beat.nextBeatId}" -> "${candidateId}" (using last number)`);
            beat.nextBeatId = candidateId;
            fixed = true;
          }
        }
        
        // Strategy 3: Use next beat in sequence
        if (!fixed && i < content.beats.length - 1) {
          const nextBeat = content.beats[i + 1];
          console.log(`[SceneWriter] Auto-fixing nextBeatId: "${beat.nextBeatId}" -> "${nextBeat.id}" (next in sequence)`);
          beat.nextBeatId = nextBeat.id;
          fixed = true;
        }
        
        // Strategy 4: Last beat - clear the reference (choices will handle navigation)
        if (!fixed) {
          console.log(`[SceneWriter] Clearing invalid nextBeatId "${beat.nextBeatId}" from beat ${beat.id} (last beat or no match found)`);
          beat.nextBeatId = undefined;
        }
      } else if (!beat.nextBeatId && i < content.beats.length - 1) {
        // No nextBeatId specified - auto-add it to maintain chain
        const nextBeat = content.beats[i + 1];
        beat.nextBeatId = nextBeat.id;
      }
    }

    // NEW: Detect and fix "all beats pointing to same target" issue (LLM hallucination)
    const nextBeatIdCounts = new Map<string, number>();
    for (const beat of content.beats) {
      if (beat.nextBeatId) {
        nextBeatIdCounts.set(beat.nextBeatId, (nextBeatIdCounts.get(beat.nextBeatId) || 0) + 1);
      }
    }
    
    // If more than 3 beats point to the same target, it's likely an LLM error - fix to sequential
    for (const [targetId, count] of nextBeatIdCounts) {
      if (count >= 3) {
        console.warn(`[SceneWriter] DETECTED LLM ERROR: ${count} beats all point to "${targetId}" - fixing to sequential navigation`);
        for (let i = 0; i < content.beats.length; i++) {
          const beat = content.beats[i];
          const nextBeat = content.beats[i + 1];
          
          // Skip beats with choices (they handle their own navigation)
          if (beat.isChoicePoint) continue;
          
          if (nextBeat) {
            if (beat.nextBeatId !== nextBeat.id) {
              console.log(`[SceneWriter]   Fixed: ${beat.id} now -> ${nextBeat.id}`);
              beat.nextBeatId = nextBeat.id;
            }
          } else {
            // Last beat - clear nextBeatId
            beat.nextBeatId = undefined;
          }
        }
        break; // Only need to fix once
      }
    }

    // Ensure startingBeatId is set - default to first beat if not provided
    if (!content.startingBeatId && content.beats.length > 0) {
      content.startingBeatId = content.beats[0].id;
      console.log(`[SceneWriter] Set default startingBeatId to: ${content.startingBeatId}`);
    }

    // Add timing annotations to beats
    this.annotateBeatsWithTiming(content);

    return content;
  }

  private ensureMinimumChoiceSceneBeats(content: SceneContent, input?: SceneWriterInput): void {
    if (!input?.sceneBlueprint.choicePoint) return;

    const minimumBeats = input.targetBeatCount >= 3 ? 3 : 2;
    if (content.beats.length >= minimumBeats) return;

    const leadInCount = minimumBeats - 1;
    const existingLeadIns = content.beats.slice(0, -1);
    const choiceSeed = content.beats[content.beats.length - 1];
    const leadInTexts = this.buildSyntheticLeadInTexts(input, leadInCount, existingLeadIns.map(beat => beat.text));
    const rebuiltBeats: GeneratedBeat[] = [];

    for (let i = 0; i < leadInCount; i++) {
      const existingBeat = existingLeadIns[i];
      const id = `beat-${i + 1}`;
      const nextBeatId = `beat-${i + 2}`;

      if (existingBeat) {
        rebuiltBeats.push({
          ...existingBeat,
          id,
          isChoicePoint: false,
          nextBeatId,
        });
        continue;
      }

      rebuiltBeats.push(this.createSyntheticLeadInBeat(leadInTexts[i], id, nextBeatId, i === 0));
    }

    const finalBeatId = `beat-${minimumBeats}`;
    const fallbackChoiceText = this.ensureTerminalPunctuation(
      choiceSeed?.text?.trim()
      || input.sceneBlueprint.choicePoint.description
      || `The moment turns on a decision ${input.protagonistInfo.name} cannot avoid`
    );

    rebuiltBeats.push({
      ...(choiceSeed || {}),
      id: finalBeatId,
      text: fallbackChoiceText,
      isChoicePoint: true,
      nextBeatId: undefined,
    });

    content.beats = rebuiltBeats;
    content.startingBeatId = 'beat-1';
    content.continuityNotes.push(
      `Auto-expanded underspecified choice scene from ${existingLeadIns.length + (choiceSeed ? 1 : 0)} to ${minimumBeats} beats.`
    );
  }

  private buildSyntheticLeadInTexts(
    input: SceneWriterInput,
    count: number,
    existingTexts: string[]
  ): string[] {
    const scene = input.sceneBlueprint;
    const uniqueTexts = new Set<string>();
    const leadIns: string[] = [];

    const pushText = (value?: string) => {
      const normalized = this.ensureTerminalPunctuation((value || '').trim());
      if (!normalized || uniqueTexts.has(normalized)) return;
      uniqueTexts.add(normalized);
      leadIns.push(normalized);
    };

    for (const text of existingTexts) {
      pushText(text);
    }

    pushText(scene.description);
    for (const keyBeat of scene.keyBeats || []) {
      pushText(keyBeat);
    }
    pushText(scene.narrativeFunction);
    pushText(scene.encounterBuildup);

    while (leadIns.length < count) {
      const fallback =
        leadIns.length === 0
          ? `${scene.name} opens with pressure already mounting around ${input.protagonistInfo.name}`
          : `The pressure tightens as the scene drives toward ${scene.choicePoint?.description || 'a hard decision'}`
      pushText(fallback);
    }

    return leadIns.slice(0, count);
  }

  private createSyntheticLeadInBeat(
    text: string,
    id: string,
    nextBeatId: string,
    isEstablishing: boolean
  ): GeneratedBeat {
    return {
      id,
      text,
      nextBeatId,
      isChoicePoint: false,
      shotType: isEstablishing ? 'establishing' : 'character',
      visualMoment: text,
      primaryAction: isEstablishing ? '' : 'the scene pressure sharpens into a visible turning point',
      emotionalRead: isEstablishing ? '' : 'faces and posture show the moment tightening around the coming decision',
      relationshipDynamic: isEstablishing ? '' : 'the characters are drawn into a tense, decision-shaped triangle of attention',
      mustShowDetail: 'a concrete environmental or body-language clue that makes this setup beat visually distinct',
    };
  }

  private ensureTerminalPunctuation(text: string): string {
    if (!text) return text;
    return /[.!?]$/.test(text) ? text : `${text}.`;
  }

  /**
   * Annotate beats with timing metadata and analyze choice density
   */
  private annotateBeatsWithTiming(content: SceneContent): void {
    if (content.beats.length === 0) return;

    let cumulativeSeconds = 0;
    let firstChoiceSeconds: number | undefined;
    let hasChoicePoint = false;

    for (const beat of content.beats) {
      const timing = this.choiceDensityValidator.getTimingForBeat(
        beat.text,
        cumulativeSeconds
      );

      // Update timing with choice point info
      timing.isChoicePoint = beat.isChoicePoint || false;
      cumulativeSeconds = timing.cumulativeSeconds;

      beat.timing = timing;

      // Track first choice point
      if (beat.isChoicePoint && firstChoiceSeconds === undefined) {
        firstChoiceSeconds = cumulativeSeconds;
        hasChoicePoint = true;
      }
    }

    // Add timing analysis summary
    content.timingAnalysis = {
      totalReadingTimeSeconds: cumulativeSeconds,
      hasChoicePoint,
      estimatedTimeToFirstChoice: firstChoiceSeconds,
    };

    // Warn about choice density issues (logging only, not blocking)
    if (content.timingAnalysis.totalReadingTimeSeconds > 60 && !hasChoicePoint) {
      console.warn(
        `[SceneWriter] Scene "${content.sceneName}" has ${Math.round(cumulativeSeconds)}s of content but no choice point`
      );
    }
  }

  /**
   * Get timing metadata for beats (public method for external use)
   */
  getBeatsWithTiming(beats: Array<{ id: string; text: string; isChoicePoint?: boolean }>) {
    return this.choiceDensityValidator.annotateBeatsWithTiming(beats);
  }

  private buildPrompt(input: SceneWriterInput): string {
    const npcDetails = input.npcs
      .filter(npc => input.sceneBlueprint.npcsPresent.includes(npc.id))
      .map(npc => `
- **${npc.name}** (${npc.id})
  - Pronouns: ${npc.pronouns}
  - Description: ${npc.description}${npc.physicalDescription ? `\n  - Physical Appearance (CANONICAL — use these exact details): ${npc.physicalDescription}` : ''}
  - Voice: ${npc.voiceNotes}
  ${npc.currentMood ? `- Current Mood: ${npc.currentMood}` : ''}`)
      .join('\n');

    const flagContext = input.relevantFlags
      ? input.relevantFlags.map(f => `- ${f.name}: ${f.description}`).join('\n')
      : 'None specified';

    let sourceContextStr = '';
    if (input.sourceAnalysis) {
      sourceContextStr = `
## Source Material Fidelity (IP Research)
The following iconic language and style fragments have been identified from the source IP. 
**PRIORITIZE using this exact language, terminology, and tone where appropriate.**

### Iconic Dialogue
${input.sourceAnalysis.directLanguageFragments.dialogue.map(d => `- "${d}"`).join('\n')}

### Notable Prose & Style
${input.sourceAnalysis.directLanguageFragments.prose.map(p => `- ${p}`).join('\n')}

### Key Terminology
${input.sourceAnalysis.directLanguageFragments.terminology.join(', ')}

${input.sourceAnalysis.adaptationGuidance ? `
### Adaptation Guidance
- **Narrative Voice**: ${input.sourceAnalysis.adaptationGuidance.narrativeVoice}
- **Themes to Preserve**: ${input.sourceAnalysis.adaptationGuidance.keyThemesToPreserve.join(', ')}
- **Iconic Moments**: ${input.sourceAnalysis.adaptationGuidance.iconicMoments.join(', ')}
` : ''}
`;
    }

    const structuralContext = buildStructuralContextSection({
      anchors: input.seasonAnchors,
      sevenPoint: input.seasonSevenPoint,
      episodeStructuralRole: input.episodeStructuralRole,
    });

    return `
Write the scene content for the following scene blueprint:

${sourceContextStr}
${structuralContext}
## Story Context
- **Title**: ${input.storyContext.title}
- **Genre**: ${input.storyContext.genre}
- **Tone**: ${input.storyContext.tone}
- **World**: ${input.storyContext.worldContext}
${input.storyContext.userPrompt ? `- **User Instructions/Prompt**: ${input.storyContext.userPrompt}\n` : ''}${input.memoryContext ? `\n## Pipeline Memory (Insights from Prior Generations)\n${input.memoryContext}\n` : ''}
## Scene Blueprint
- **Scene ID**: ${input.sceneBlueprint.id}
- **Name**: ${input.sceneBlueprint.name}
- **Description**: ${input.sceneBlueprint.description}
- **Location**: ${input.sceneBlueprint.location}
- **Mood**: ${input.sceneBlueprint.mood}
- **Purpose**: ${input.sceneBlueprint.purpose}
- **Narrative Function**: ${input.sceneBlueprint.narrativeFunction}

### Scene Craft Targets
- Define 1-4 sceneTakeaways in the output: what the player learns, feels, or understands.
- If this scene begins after a time/place shift, include transitionIn with a short natural phrase.
- keyMoments should name the emotional or narrative payoff, not just a location or mood.
- moodProgression should show the scene's tension or emotional movement from start to finish.

### Expert Design Template
- **Dramatic Question**: ${input.sceneBlueprint.dramaticQuestion}
- **Want vs Need**: ${input.sceneBlueprint.wantVsNeed}
- **Conflict Engine**: ${input.sceneBlueprint.conflictEngine}

### Key Beats to Hit
${input.sceneBlueprint.keyBeats.map(b => `- ${b}`).join('\n')}

${input.sceneBlueprint.choicePoint ? `
### Choice Point
- **Type**: ${input.sceneBlueprint.choicePoint.type}
- **Description**: ${input.sceneBlueprint.choicePoint.description}
- **Stakes**:
  - Want: ${input.sceneBlueprint.choicePoint.stakes.want}
  - Cost: ${input.sceneBlueprint.choicePoint.stakes.cost}
  - Identity: ${input.sceneBlueprint.choicePoint.stakes.identity}
` : ''}

## Characters

### Protagonist
- Name: ${input.protagonistInfo.name}
- Pronouns: ${input.protagonistInfo.pronouns}
- Description: ${input.protagonistInfo.description}${input.protagonistInfo.physicalDescription ? `\n- Physical Appearance (CANONICAL — use these exact details): ${input.protagonistInfo.physicalDescription}` : ''}

### NPCs in Scene
${npcDetails || 'No NPCs in this scene'}

## Relevant State Context
${flagContext}

${input.episodeEncounterContext ? `
## ENCOUNTER BUILDUP (CRITICAL — This scene is building toward the episode's climax)

This episode's climactic moment is a **${input.episodeEncounterContext.encounterType}** encounter (${input.episodeEncounterContext.encounterDifficulty}):
> "${input.episodeEncounterContext.encounterDescription}"

**What this scene must establish:**
> "${input.episodeEncounterContext.encounterBuildup}"

Write this scene with the encounter in mind. Every beat should move players emotionally and informationally toward that encounter:
- Plant the seeds of conflict that will explode in the encounter
- Establish or deepen the relationships that will be tested
- Surface the information, stakes, or personal history that makes the encounter's choices feel loaded
- DO NOT resolve the tension — build it, complicate it, and leave it unresolved for the encounter to detonate

The player should finish this scene feeling that something significant is coming. The encounter should feel INEVITABLE by the time they reach it.
` : ''}
${input.branchContext ? `
## Branch Topology Context
- **Scene role**: ${input.branchContext.role}
${input.branchContext.role === 'bottleneck' ? '- This scene is a **bottleneck**: every player path converges here. Acknowledge different prior paths when possible via textVariants.' : ''}
${input.branchContext.role === 'branch' ? '- This scene is **branch-only**: not every player reaches it. Earn its distinct tone and avoid redundant setup.' : ''}
${input.branchContext.role === 'reconvergence' ? `- This scene is a **reconvergence point**. Incoming branches: ${(input.branchContext.incomingBranchIds || []).join(', ') || 'multiple'}. Acknowledge different paths via conditional textVariants.` : ''}
${input.branchContext.stateReconciliationNotes && input.branchContext.stateReconciliationNotes.length > 0 ? `- State reconciliation notes:\n${input.branchContext.stateReconciliationNotes.map(n => `  - ${n}`).join('\n')}` : ''}
${input.branchContext.reconvergenceNarrativeAcknowledgment ? `- Suggested acknowledgment: "${input.branchContext.reconvergenceNarrativeAcknowledgment}"` : ''}
` : ''}
${input.activeThreads && input.activeThreads.length > 0 ? `
## Active Narrative Threads (setup/payoff)
You MUST plant or pay off the following threads in this scene. Set \`plantsThreadId\` or \`paysOffThreadId\` on the beat where each action happens.
${input.activeThreads.map(t => `- [${t.action.toUpperCase()}] thread \`${t.id}\` (${t.kind}): ${t.label}${t.hint ? ` — hint: ${t.hint}` : ''}`).join('\n')}
- Payoff must feel surprising-but-inevitable — the plant should read as incidental on first encounter.
- If planting, be subtle: a sensory detail, an off-hand remark, a named object. Never lampshade.
` : ''}
${input.twistDirectives && input.twistDirectives.length > 0 ? `
## Twist / Revelation Directives
This scene participates in an episode-level twist. Honor the role for each beat and set \`plotPointType\` accordingly.
${input.twistDirectives.map(d => `- Beat role: **${d.beatRole}** for a \`${d.twistKind}\` — ${d.hint}`).join('\n')}
- Twist beats MUST be preceded by at least one earlier setup beat in this or an earlier scene.
` : ''}
${input.arcTargets && (input.arcTargets.identityDeltaHints?.length || input.arcTargets.relationshipTrajectory?.length) ? `
## Character Arc Milestone Targets
Frame beats so the player's available choices can nudge the protagonist toward these milestones.
${(input.arcTargets.identityDeltaHints || []).map(h => `- Identity dimension \`${h.dimension}\`: target ${h.direction} (${h.magnitude})`).join('\n')}
${(input.arcTargets.relationshipTrajectory || []).map(r => `- Relationship with ${r.npcId} (${r.dimension}): ${r.direction} — ${r.hint}`).join('\n')}
` : ''}${buildSceneWriterCallbackSection((input.unresolvedCallbacks || []).map(h => ({
  id: h.id,
  sourceEpisode: h.sourceEpisode,
  sourceSceneId: '',
  sourceChoiceId: '',
  flags: h.flags,
  summary: h.summary,
  payoffWindow: { minEpisode: 0, maxEpisode: 0 },
  payoffCount: 0,
  resolved: false,
  createdAt: '',
})))}
## Requirements
- Write up to ${input.targetBeatCount} beats for this scene (cap—use fewer if the scene doesn't need more)
- ${input.dialogueHeavy ? 'This is dialogue-heavy - focus on conversation' : 'Balance description with any dialogue'}
${input.previousSceneSummary ? `- Previous scene context: ${input.previousSceneSummary}` : ''}
${input.sceneBlueprint.choicePoint ? '- Mark the final beat as isChoicePoint: true for the Choice Author to add options' : ''}
${input.incomingChoiceContext ? `
## CHOICE PAYOFF (CRITICAL — the player CHOSE this)
This scene is entered because the player chose: "${input.incomingChoiceContext}"
The FIRST beat MUST visually and textually pay off this choice. Do not delay, hedge, or skip the payoff.
- The first beat's text must show the immediate consequence of the choice — the SPECIFIC physical action the player chose.
- The first beat's visual contract MUST directly depict the choice's consequence:
  - "visualMoment": Describe the EXACT action from the choice playing out (e.g., if they chose to spin in circles, show spinning in circles — not a generic pose)
  - "primaryAction": The verb-led physical action that matches the choice (e.g., "spins wildly with arms outstretched" not "stands on the moors")
  - "mustShowDetail": A specific visual element from the choice that the image MUST include
- If the player chose to kiss someone, show the kiss. If they chose to dance, show them dancing. If they chose to fight, show the fight. If they chose to laugh wildly and spin, show wild laughter and spinning.
- Do NOT generalize the choice into a mood or atmosphere shot. The image must show the SPECIFIC ACTION the player selected.
` : ''}

Create the scene content following the SceneContent schema. Include:
1. Engaging narrative prose for each beat
2. Distinct character voices in dialogue
3. Sensory details and atmosphere
4. Natural flow between beats
5. textVariants where state should affect content
6. Full beat visual contract fields (visualMoment, primaryAction, emotionalRead, relationshipDynamic, mustShowDetail, intensityTier) for every beat
7. Optional visualContinuity metadata when it clarifies beat-to-beat flow; keep panelMode as "single" unless an explicit UX/config flag says otherwise
8. When unresolved callback hooks are listed above, author at least one TextVariant whose \`callbackHookId\` matches an existing hook id
9. sceneTakeaways and transitionIn when they clarify purpose and flow

Respond with valid JSON matching the SceneContent type.
`;
  }

  private validateContent(content: SceneContent, input: SceneWriterInput): void {
    // Check beat count
    if (content.beats.length === 0) {
      throw new Error('Scene must have at least 1 beat');
    } else if (content.beats.length === 1) {
      console.warn('[SceneWriter] Scene has only 1 beat - considering splitting for better pacing, but accepting.');
    }

    // Check starting beat exists
    const startingBeat = content.beats.find(b => b.id === content.startingBeatId);
    if (!startingBeat) {
      throw new Error(`Starting beat ${content.startingBeatId} not found`);
    }

    // Check beat chain is valid and auto-fix invalid references (should already be fixed in normalizeContent, but double-check)
    const beatIds = new Set(content.beats.map(b => b.id));
    const beatIndexMap = new Map<string, number>();
    content.beats.forEach((b, idx) => {
      beatIndexMap.set(b.id, idx);
    });

    for (const beat of content.beats) {
      if (beat.nextBeatId && !beatIds.has(beat.nextBeatId)) {
        // This should have been fixed in normalizeContent, but fix it again just in case
        let fixed = false;
        
        // Try extracting all numbers and matching
        const allNumbers = beat.nextBeatId.match(/\d+/g);
        if (allNumbers) {
          // Try each number
          for (const num of allNumbers) {
            const candidateId = `beat-${num}`;
            if (beatIds.has(candidateId)) {
              console.warn(`[SceneWriter] VALIDATION: Beat ${beat.id} references non-existent beat ${beat.nextBeatId}, auto-fixing to ${candidateId}`);
              beat.nextBeatId = candidateId;
              fixed = true;
              break;
            }
          }
          
          // Try last number if still not fixed
          if (!fixed && allNumbers.length > 1) {
            const lastNumber = allNumbers[allNumbers.length - 1];
            const candidateId = `beat-${lastNumber}`;
            if (beatIds.has(candidateId)) {
              console.warn(`[SceneWriter] VALIDATION: Beat ${beat.id} references non-existent beat ${beat.nextBeatId}, auto-fixing to ${candidateId} (last number)`);
              beat.nextBeatId = candidateId;
              fixed = true;
            }
          }
        }
        
        // Use next beat in sequence if still not fixed
        if (!fixed) {
          const currentIndex = beatIndexMap.get(beat.id);
          if (currentIndex !== undefined && currentIndex < content.beats.length - 1) {
            const nextBeat = content.beats[currentIndex + 1];
            console.warn(`[SceneWriter] VALIDATION: Beat ${beat.id} references non-existent beat ${beat.nextBeatId}, auto-fixing to ${nextBeat.id} (next in sequence)`);
            beat.nextBeatId = nextBeat.id;
            fixed = true;
          } else {
            // Last beat - clear the reference
            console.warn(`[SceneWriter] VALIDATION: Beat ${beat.id} references non-existent beat ${beat.nextBeatId}, clearing reference (last beat)`);
            beat.nextBeatId = undefined;
          }
        }
      }
    }

    // Check choice point is marked if blueprint has one
    if (input.sceneBlueprint.choicePoint) {
      const hasChoicePoint = content.beats.some(b => b.isChoicePoint);
      if (!hasChoicePoint) {
        console.warn('[SceneWriter] VALIDATION: Scene blueprint has choice point but no beat is marked. Auto-fixing: marking last beat.');
        if (content.beats.length > 0) {
          content.beats[content.beats.length - 1].isChoicePoint = true;
        } else {
           throw new Error('Scene blueprint has choice point but no beats generated');
        }
      }
    }

    // Check text length - warn on too short OR too long
    const MAX_SENTENCES = 4;
    const MAX_WORDS = TEXT_LIMITS.maxBeatWordCount;

    for (const beat of content.beats) {
      const text = typeof beat.text === 'string' ? beat.text : String(beat.text || '');
      if (!text || text.trim().length === 0) {
        // Empty beat is a real problem - provide placeholder
        console.warn(`[SceneWriter] Beat ${beat.id} has no text, adding placeholder`);
        beat.text = '[Scene continues...]';
      } else if (text.trim().length < 10) {
        // Very short beat - log warning but allow it
        console.warn(`[SceneWriter] Beat ${beat.id} has very short text (${text.trim().length} chars): "${text.trim()}"`);
      } else {
        // Check if beat exceeds its cap (varies by beat type)
        const wordCount = text.trim().split(/\s+/).length;
        const sentenceCount = (text.match(/[.!?]+/g) || []).length;
        const maxWords = beat.isClimaxBeat
          ? TEXT_LIMITS.maxClimaxBeatWordCount
          : beat.isKeyStoryBeat
            ? TEXT_LIMITS.maxKeyStoryBeatWordCount
            : MAX_WORDS;

        if (wordCount > maxWords || sentenceCount > MAX_SENTENCES) {
          console.warn(`[SceneWriter] Beat ${beat.id} exceeds cap: ${wordCount} words, ~${sentenceCount} sentences (cap: ${maxWords} words).`);
          console.warn(`[SceneWriter] Text: "${text.substring(0, 100)}..."`);
        }
      }

      if (!beat.shotType) {
        console.warn(`[SceneWriter] Beat ${beat.id} is missing shotType; image agent will need to guess shot intent`);
      }
      const contractChecks: Array<[string, string | undefined]> = [
        ['visualMoment', beat.visualMoment],
        ['mustShowDetail', beat.mustShowDetail],
      ];
      if (beat.shotType !== 'establishing') {
        contractChecks.push(
          ['primaryAction', beat.primaryAction],
          ['emotionalRead', beat.emotionalRead],
          ['relationshipDynamic', beat.relationshipDynamic],
        );
      }
      for (const [field, value] of contractChecks) {
        if (!value || value.trim().length < 8) {
          console.warn(`[SceneWriter] Beat ${beat.id} has weak ${field}; downstream visual fidelity may degrade`);
        }
      }
    }
  }

  private ensureBeatVisualContract(beat: GeneratedBeat): void {
    const text = (beat.text || '').trim();
    const subject = beat.speaker || 'the protagonist';

    // Derive shotType from text signals when LLM didn't set it
    if (!beat.shotType) {
      beat.shotType = this.deriveShotType(beat, text);
    }

    if (beat.shotType === 'establishing') {
      // Establishing shots need only a visual moment describing the environment
      if (!beat.visualMoment || this.isAbstractOnly(beat.visualMoment)) {
        beat.visualMoment = this.deriveEstablishingVisualMoment(text);
      }
      // Clear character-centric fields so they don't bleed into image prompts
      beat.primaryAction = '';
      beat.emotionalRead = '';
      beat.relationshipDynamic = '';
      if (!beat.mustShowDetail || this.isAbstractOnly(beat.mustShowDetail)) {
        beat.mustShowDetail = this.deriveMustShowDetail(text);
      }
      return;
    }

    if (!beat.primaryAction || this.isAbstractOnly(beat.primaryAction)) {
      beat.primaryAction = this.derivePrimaryAction(text, subject);
    }
    if (!beat.visualMoment || this.isAbstractOnly(beat.visualMoment)) {
      beat.visualMoment = this.deriveVisualMoment(text, beat.primaryAction || 'acts', subject);
    }
    if (!beat.emotionalRead || this.isAbstractOnly(beat.emotionalRead)) {
      beat.emotionalRead = this.deriveEmotionalRead(text, beat.speakerMood);
    }
    if (!beat.relationshipDynamic || this.isAbstractOnly(beat.relationshipDynamic)) {
      beat.relationshipDynamic = this.deriveRelationshipDynamic(text);
    }
    if (!beat.mustShowDetail || this.isAbstractOnly(beat.mustShowDetail)) {
      beat.mustShowDetail = this.deriveMustShowDetail(text);
    }
  }

  private deriveShotType(beat: GeneratedBeat, text: string): 'establishing' | 'character' | 'action' {
    // If there's a speaker it's inherently a character beat
    if (beat.speaker) return 'character';

    const lowered = text.toLowerCase();

    // Strong action verbs → action shot
    const hasActionVerb = /\b(grabs?|reaches?|recoils?|steps?\s+forward|stumbles?|lunges?|pushes?|pulls?|raises?|strikes?|dodges?|fires?|shoots?|charges?|slams?|throws?|catches?)\b/.test(lowered);
    if (hasActionVerb) return 'action';

    // Second-person text WITHOUT any character dialogue or action anchors
    // e.g. "Rain streaks down your apartment windows" → establishing
    // vs "You turn to face her" → character
    const hasCharacterPronounAction = /\byou\s+(turn|step|move|walk|run|reach|grab|look\s+at|face|stand\s+up|sit\s+down|rise|approach|back\s+away)\b/.test(lowered);
    if (hasCharacterPronounAction) return 'character';

    // Atmospheric keywords with second-person address describing the environment
    const hasAtmosphericEnv = /\b(rain|neon|window|street|city|sky|horizon|corridor|room|space|building|apartment|hall|fog|darkness|shadow|landscape|crowd|distance)\b/.test(lowered);
    const isPassiveDescription = !/(shout|cry|yell|sneer|smile|grin|frown|laugh|growl|whisper|mutter|hiss|says?|said|asks?|replies?|replies?)\b/.test(lowered);

    if (hasAtmosphericEnv && isPassiveDescription) return 'establishing';

    return 'character';
  }

  private deriveEstablishingVisualMoment(text: string): string {
    // Use the first sentence of the beat text as-is — it's the environment description
    const firstSentence = text.split(/[.!?]\s+/)[0]?.trim();
    if (firstSentence && firstSentence.length >= 15) {
      return firstSentence;
    }
    return text.substring(0, 120).trim();
  }

  private deriveVisualMoment(text: string, action: string, subject: string): string {
    const firstSentence = text.split(/[.!?]\s+/)[0]?.trim();
    if (firstSentence && firstSentence.length >= 12) {
      return firstSentence;
    }
    return `${subject} ${action} in a single, visually readable instant.`;
  }

  private derivePrimaryAction(text: string, subject: string): string {
    const match = text.toLowerCase().match(/\b(grabs?|reaches?|recoils?|steps?|stumbles?|lunges?|turns?|pushes?|pulls?|raises?|lowers?|clenches?|releases?|strikes?|dodges?|embraces?|confronts?|retreats?|advances?|kneels?|draws|aims|backs away|locks eyes)\b/);
    if (match) {
      return `${subject} ${match[0]}`;
    }
    return `${subject} takes a decisive physical action`;
  }

  private deriveEmotionalRead(text: string, speakerMood?: string): string {
    const lowered = text.toLowerCase();
    if (/(rage|angry|furious|snarl|clench|grit)/.test(lowered)) {
      return 'brow tightened, jaw clenched, shoulders pitched forward with aggressive tension';
    }
    if (/(fear|panic|recoil|flinch|stagger|alarm)/.test(lowered)) {
      return 'eyes widened, mouth tense, weight shifted backward in defensive recoil';
    }
    if (/(grief|sad|sorrow|tears?|mourn)/.test(lowered)) {
      return 'eyes glossed, mouth softened, shoulders dropping under emotional weight';
    }
    if (speakerMood) {
      return `face and posture visibly communicate ${speakerMood}`;
    }
    return 'emotion reads clearly through eyes, mouth tension, and posture';
  }

  private deriveRelationshipDynamic(text: string): string {
    const lowered = text.toLowerCase();
    if (/(confront|accuse|challenge|threat|argue)/.test(lowered)) {
      return 'confrontational spacing: one party presses in while the other resists or holds ground';
    }
    if (/(comfort|support|embrace|help|steady)/.test(lowered)) {
      return 'supportive proximity: bodies angled toward each other with reduced emotional distance';
    }
    if (/(betray|deceive|distrust|suspicion)/.test(lowered)) {
      return 'fractured trust: visible hesitation, guarded posture, and increased interpersonal distance';
    }
    return 'clear spatial and power dynamic between visible characters';
  }

  private deriveMustShowDetail(text: string): string {
    const quoted = text.match(/"([^"]{3,80})"/)?.[1];
    if (quoted) {
      return `a key prop or gesture tied to the spoken line "${quoted}"`;
    }
    const detail = text.match(/\b(letter|blade|blood|ring|key|door|map|gun|knife|pendant|wound|tear|fist|hands?|eyes)\b/i)?.[1];
    if (detail) {
      return `the ${detail} that anchors this beat's dramatic meaning`;
    }
    return 'one concrete prop or body detail that makes the beat unmistakable';
  }

  private isAbstractOnly(value?: string): boolean {
    if (!value) return true;
    const v = value.toLowerCase();
    return (
      /\btension rises\b/.test(v) ||
      /\bemotion deepens\b/.test(v) ||
      /\bconflict escalates\b/.test(v) ||
      /\bdramatic moment\b/.test(v) ||
      /\bthe mood\b/.test(v) ||
      /\bthe atmosphere\b/.test(v)
    );
  }

  /**
   * Collect issues that need revision feedback
   */
  private collectIssues(content: SceneContent, input: SceneWriterInput): string[] {
    const issues: string[] = [];
    const MAX_WORDS = TEXT_LIMITS.maxBeatWordCount;
    const MAX_SENTENCES = 4;

    // Check for beats that exceed their cap (varies by beat type)
    const longBeats: string[] = [];
    let climaxCount = 0;
    let keyStoryBeatCount = 0;
    for (const beat of content.beats || []) {
      const text = typeof beat.text === 'string' ? beat.text : String(beat.text || '');
      const wordCount = text.trim().split(/\s+/).length;
      const sentenceCount = (text.match(/[.!?]+/g) || []).length;

      const maxWords = beat.isClimaxBeat
        ? TEXT_LIMITS.maxClimaxBeatWordCount
        : beat.isKeyStoryBeat
          ? TEXT_LIMITS.maxKeyStoryBeatWordCount
          : MAX_WORDS;
      if (beat.isClimaxBeat) climaxCount++;
      if (beat.isKeyStoryBeat) keyStoryBeatCount++;

      if (wordCount > maxWords || sentenceCount > MAX_SENTENCES) {
        longBeats.push(`Beat "${beat.id}" (${beat.isClimaxBeat ? 'climax' : beat.isKeyStoryBeat ? 'key' : 'standard'}): ${wordCount} words, ${sentenceCount} sentences (cap: ${maxWords} words)`);
      }
      if (/\{[A-Z][A-Za-z0-9]*\}/.test(text)) {
        issues.push(`SCHEMA PLACEHOLDER LEAK - Beat "${beat.id}" contains an unresolved {Variable} placeholder. Rewrite it as concrete player-facing prose.`);
      }
    }
    if (climaxCount > 2) {
      issues.push(`TOO MANY CLIMAX BEATS - ${climaxCount} marked isClimaxBeat. Use max 1-2 per scene for true climaxes only.`);
    }
    if (keyStoryBeatCount > TEXT_LIMITS.maxKeyStoryBeatsPerScene) {
      issues.push(`TOO MANY KEY STORY BEATS - ${keyStoryBeatCount} marked isKeyStoryBeat. Cap is ${TEXT_LIMITS.maxKeyStoryBeatsPerScene} per scene.`);
    }
    if (longBeats.length > 0) {
      issues.push(`BEATS EXCEED CAP - Split or shorten:\n${longBeats.join('\n')}`);
    }

    // Check for missing choice point
    if (input.sceneBlueprint.choicePoint) {
      const hasChoicePoint = content.beats?.some(b => b.isChoicePoint);
      if (!hasChoicePoint) {
        issues.push(`MISSING CHOICE POINT - The scene blueprint requires a choice, but no beat is marked as isChoicePoint: true. Mark the final beat where the player should make a decision.`);
      }
    }

    // Check for degenerative cases (0-1 beats when scene clearly needs more)
    const beatCount = content.beats?.length || 0;
    if (beatCount === 0) {
      issues.push(`NO BEATS - Scene must have at least 1 beat.`);
    } else if (beatCount === 1 && input.targetBeatCount >= 3) {
      issues.push(`SINGLE BEAT - Consider splitting into 2-3 beats for pacing.`);
    }

    return issues;
  }

  /**
   * Request a revision from the LLM with specific feedback
   */
  private async executeRevision(
    input: SceneWriterInput,
    originalContent: SceneContent,
    issues: string[]
  ): Promise<AgentResponse<SceneContent>> {
    console.log(`[SceneWriter] Requesting revision for ${issues.length} issues`);

    const revisionPrompt = `
You previously generated scene content that has some issues that need fixing.

## Original Content
${JSON.stringify(originalContent, null, 2)}

## Issues to Fix
${issues.map((issue, i) => `${i + 1}. ${issue}`).join('\n\n')}

## Instructions
Please revise the content to fix these issues. Return the COMPLETE revised scene content as valid JSON.

Key requirements:
- Each beat must stay under cap: 4 sentences, ${TEXT_LIMITS.maxBeatWordCount} words (climax: ${TEXT_LIMITS.maxClimaxBeatWordCount}, key: ${TEXT_LIMITS.maxKeyStoryBeatWordCount})
- If a beat is too long, split it into multiple beats
- Maintain the narrative flow when splitting
- Keep beat IDs logical (beat-1, beat-2, etc.)
- Update nextBeatId references to maintain the chain
- If splitting the last beat, ensure the final beat has no nextBeatId (it ends the scene or leads to choices)

Return ONLY valid JSON matching the SceneContent schema.
`;

    try {
      const response = await this.callLLM([
        { role: 'user', content: revisionPrompt }
      ]);

      console.log(`[SceneWriter] Received revision (${response.length} chars)`);

      let revisedContent: SceneContent;
      try {
        revisedContent = this.parseJSON<SceneContent>(response);
      } catch (parseError) {
        console.error(`[SceneWriter] Revision JSON parse failed, using original content`);

        // Check if original content has missing isChoicePoint - pipeline will apply fallback
        if (input.sceneBlueprint.choicePoint) {
          const hasChoicePoint = originalContent.beats?.some(b => b.isChoicePoint);
          if (!hasChoicePoint) {
            console.warn(`[SceneWriter] Original content missing isChoicePoint - pipeline fallback will auto-mark last beat`);
          }
        }

        return {
          success: true,
          data: originalContent,
          rawResponse: response,
        };
      }

      // Normalize and validate
      revisedContent = this.normalizeContent(revisedContent, input);

      // Preserve original IDs if revision changed them incorrectly
      revisedContent.sceneId = originalContent.sceneId;
      revisedContent.sceneName = originalContent.sceneName;

      console.log(`[SceneWriter] Revision complete: ${revisedContent.beats?.length || 0} beats (was ${originalContent.beats?.length || 0})`);

      // Validate (but don't retry again)
      this.validateContent(revisedContent, input);

      return {
        success: true,
        data: revisedContent,
        rawResponse: response,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`[SceneWriter] Revision failed: ${errorMsg}, using original content`);

      // Check if original content has missing isChoicePoint - pipeline will apply fallback
      if (input.sceneBlueprint.choicePoint) {
        const hasChoicePoint = originalContent.beats?.some(b => b.isChoicePoint);
        if (!hasChoicePoint) {
          console.warn(`[SceneWriter] Original content missing isChoicePoint - pipeline fallback will auto-mark last beat`);
        }
      }

      // Return original content if revision fails
      // Note: Pipeline has fallback to auto-mark isChoicePoint if missing
      return {
        success: true,
        data: originalContent,
        rawResponse: '',
      };
    }
  }
}
