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
import { Beat, TextVariant, Consequence, TimingMetadata, SceneVisualSequencePlan } from '../../types';
import {
  SourceMaterialAnalysis,
  StoryAnchors,
  SevenPointStructure,
  StructuralRole,
} from '../../types/sourceAnalysis';
import { ChoiceDensityValidator } from '../validators/ChoiceDensityValidator';
import { PovClarityValidator } from '../validators/PovClarityValidator';
import { auditFictionFirstTurns, FICTION_FIRST_TURN_DOMAINS } from '../validators/turnAudit';
import type { CliffhangerPlan } from '../../types/seasonPlan';
import {
  CHOICE_DENSITY_REQUIREMENTS,
  CRAFT_PRESSURE_GUIDANCE,
  NARRATIVE_INTENSITY_RULES,
  buildGenreAwareJeopardyGuidance,
  buildStructuralContextSection,
} from '../prompts/storytellingPrinciples';
import { buildSceneWriterCallbackSection } from '../prompts/callbackPromptSection';
import { buildRequiredBeatsSection } from '../prompts/requiredBeatsPromptSection';
import { SCENE_WRITER_BEAT_EXAMPLE } from '../prompts/examples/storyCraftExamples';
import { DEFAULT_LIMITS } from '../utils/textEnforcer';
import { TEXT_LIMITS } from '../../constants/validation';
import type { SceneSettingContext } from '../utils/styleAdaptation';
import { applySequenceDirectorPlan } from './SequenceDirector';

function normalizeSourceFragments(sourceAnalysis?: SourceMaterialAnalysis): {
  dialogue: string[];
  prose: string[];
  terminology: string[];
} {
  const fragments = sourceAnalysis?.directLanguageFragments;
  if (!fragments) return { dialogue: [], prose: [], terminology: [] };

  if (Array.isArray(fragments)) {
    return {
      dialogue: fragments.map((fragment) => fragment.text).filter(Boolean),
      prose: fragments
        .filter((fragment) => fragment.context && !fragment.speaker)
        .map((fragment) => fragment.text)
        .filter(Boolean),
      terminology: [],
    };
  }

  return {
    dialogue: Array.isArray(fragments.dialogue) ? fragments.dialogue.filter(Boolean) : [],
    prose: Array.isArray(fragments.prose) ? fragments.prose.filter(Boolean) : [],
    terminology: Array.isArray(fragments.terminology) ? fragments.terminology.filter(Boolean) : [],
  };
}

export function buildSourceMaterialFidelitySection(sourceAnalysis?: SourceMaterialAnalysis): string {
  if (!sourceAnalysis) return '';

  const fragments = normalizeSourceFragments(sourceAnalysis);
  const guide = sourceAnalysis.writingStyleGuide;
  const guidance = sourceAnalysis.adaptationGuidance;
  const elementsToPreserve = Array.isArray(guidance?.elementsToPreserve) ? guidance.elementsToPreserve : [];
  const elementsToAdapt = Array.isArray(guidance?.elementsToAdapt) ? guidance.elementsToAdapt : [];
  const themes = Array.isArray(guidance?.keyThemesToPreserve)
    ? guidance.keyThemesToPreserve
    : elementsToPreserve;
  const moments = Array.isArray(guidance?.iconicMoments) ? guidance.iconicMoments : [];

  return `
## Source Material Fidelity (IP Research)
The following language, terminology, and prose-style rules have been identified from the source material.
**Prioritize this writing contract when drafting player-facing prose.**

${guide ? `### Writing Style Guide (${guide.source})
- **Summary**: ${guide.summary}
- **Narrative Voice**: ${guide.narrativeVoice}
- **Sentence Rhythm**: ${guide.sentenceRhythm}
- **Diction**: ${guide.diction}
- **Dialogue Style**: ${guide.dialogueStyle}
- **POV / Distance**: ${guide.povAndDistance}
- **Imagery / Sensory Focus**: ${guide.imageryAndSensoryFocus}
- **Pacing**: ${guide.pacing}
- **Do**: ${guide.doList.join('; ')}
- **Avoid**: ${guide.avoidList.join('; ')}
${guide.evidence?.length ? `- **Evidence**: ${guide.evidence.join('; ')}` : ''}
` : ''}

${fragments.dialogue.length ? `### Iconic Dialogue
${fragments.dialogue.map(d => `- "${d}"`).join('\n')}
` : ''}

${fragments.prose.length ? `### Notable Prose & Style
${fragments.prose.map(p => `- ${p}`).join('\n')}
` : ''}

${fragments.terminology.length ? `### Key Terminology (LOCKED — use verbatim)
${fragments.terminology.join(', ')}

Use these EXACT terms whenever the concept appears. Do NOT rename them, coin
synonyms, or swap in a generic equivalent (e.g. never turn "All-Song" into
"Codex"). They are the story's signature vocabulary and must read identically in
every scene.
` : ''}

${guidance ? `### Adaptation Guidance
- **Narrative Voice**: ${guidance.narrativeVoice}
- **Tone Notes**: ${guidance.toneNotes}
- **Dialogue Style**: ${guidance.dialogueStyle}
- **Elements to Preserve**: ${elementsToPreserve.join(', ')}
${elementsToAdapt.length ? `- **Elements to Adapt**: ${elementsToAdapt.join(', ')}` : ''}
${themes.length ? `- **Themes to Preserve**: ${themes.join(', ')}` : ''}
${moments.length ? `- **Iconic Moments**: ${moments.join(', ')}` : ''}
` : ''}
`;
}

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

  // Step 2 (info-reveal): authored facts this scene must REVEAL on-page (assigned by
  // StoryArchitect from the season INFO ledger). When present, the prompt instructs the
  // writer to dramatize each reveal here. Empty/absent for scenes with no scheduled reveal.
  revealDirectives?: Array<{ infoId: string; fact: string }>;

  // Scene specific guidance
  targetBeatCount: number; // Max beats per scene (cap)—engine may use fewer
  dialogueHeavy: boolean; // Is this a conversation-focused scene?

  // Previous scene summary (for continuity)
  previousSceneSummary?: string;

  // Next-scene context for continuity handoffs, especially when a prose scene
  // flows directly into an encounter scaffold.
  nextSceneContext?: {
    id: string;
    name: string;
    location: string;
    description: string;
    isEncounter?: boolean;
    encounterType?: string;
    encounterDescription?: string;
    encounterBeatPlan?: string[];
  };

  // Choice payoff context: describes what player choice led to this scene.
  // When present, the FIRST beat must visually and textually pay off this choice.
  incomingChoiceContext?: string;

  // B1 prevention: when the immediately-preceding scene on this path is in the
  // SAME location, the writer must continue the visit rather than re-stage a fresh
  // arrival (the Endsong dual-first-entry: two scenes both "entering" the hall).
  continueInLocation?: string;

  // W4 prevention: when an encounter routes into THIS scene, the encounter's
  // possible outcomes + their pre-seeded state flags. The scene must author
  // textVariants gated on these flags so its prose reflects what happened (e.g. an
  // ally wounded on partialVictory) rather than reading identically on every path.
  priorEncounterOutcomes?: Array<{
    encounterId: string;
    encounterName: string;
    victoryStakes?: string;
    defeatStakes?: string;
    outcomeFlags: Array<{ outcome: string; flag: string }>;
  }>;

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

  /**
   * Role-mapped ending contract for the final scene of the episode.
   * Only supplied to scenes that may need to land the episode ending.
   */
  cliffhangerPlan?: CliffhangerPlan;

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

  // B1 (Season Canon): sealed, read-only facts to honor verbatim ("ESTABLISHED
  // CANON — do not contradict"). Pre-formatted by SeasonCanon.canonForPrompt.
  establishedCanon?: string;

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
    conditionKeys?: string[];
    impactFactors?: string[];
    consequenceTier?: string;
  }>;
}

// Output types
export interface GeneratedBeat {
  id: string;
  text: string;
  content?: string; // Fallback field sometimes used by LLMs
  textVariants?: TextVariant[];
  callbackHookIds?: string[];
  skillInsights?: Beat['skillInsights'];
  speaker?: string;
  speakerMood?: string;
  nextBeatId?: string;
  nextSceneId?: string;
  onShow?: Consequence[];
  // Note: choices are added by Choice Author agent
  isChoicePoint?: boolean; // Mark where Choice Author should add choices
  isChoiceBridge?: boolean;
  routeContext?: Beat['routeContext'];
  // Timing metadata for choice density validation
  timing?: TimingMetadata;
  // Visual contract authored alongside prose to prevent downstream drift
  visualMoment?: string; // One concrete, observable instant for this beat
  primaryAction?: string; // Verb-led physical action
  emotionalRead?: string; // Visible face/body emotional cues
  relationshipDynamic?: string; // Spatial/power dynamic between characters
  mustShowDetail?: string; // Non-negotiable visual clue for this beat
  dramaticIntent?: Beat['dramaticIntent']; // Objective/status/subtext metadata for image planning
  sequenceIntent?: Beat['sequenceIntent']; // Multi-beat visual sequence objective/thread metadata
  allowDiegeticText?: boolean; // When true, text in the image is permitted (letter, sign, book)
  shotType?: 'establishing' | 'character' | 'action'; // Camera intent: environment-only, character-focused, or physical action
  intensityTier?: 'dominant' | 'supporting' | 'rest'; // Narrative intensity for scene-level pacing
  isClimaxBeat?: boolean;
  isKeyStoryBeat?: boolean;
  visualContinuity?: Beat['visualContinuity']; // Optional beat-to-beat flow metadata
  visualCast?: Beat['visualCast'];
  coveragePlan?: Beat['coveragePlan'];

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
  sequenceIntent?: Beat['sequenceIntent'];
  sceneVisualSequencePlan?: SceneVisualSequencePlan;

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

function stripAgentFacingPressureLabel(value: string): string {
  return String(value || '')
    .replace(/^(?:pressure|choice pressure|forward pressure):\s*/i, '')
    .trim();
}

function isAgentFacingPressureNote(value: string): boolean {
  return /^(?:choice pressure|forward pressure):/i.test(String(value || '').trim());
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

You are a master prose writer who brings scene blueprints to life with concrete, style-safe story intent and concise player-facing prose. You write the actual words players will read.

## Writing Principles: The Two-Pass Method
1. **Pass 1: Cinematic Quality**: Focus on drama, subtext, and reversals first. Every scene must advance Plot, Relationship, or Thematic Pressure.
2. **Pass 2: Interactive Conversion**: Ground interactivity in the scene's truth. Use player state to acknowledging past choices.

### Show, Don't Tell
- Reveal character through action, not description.
- Let the reader infer emotions from behavior.
- Use sensory details to create atmosphere.

### Immersive Description
- Use sensory detail selectively and purposefully; do not force all five senses into every beat.
- Ground scenes in specific, concrete details.
- Vary sentence length for rhythm.
- **Atmospheric Fidelity**: Use the specific prose style and terminology of the source material if identified.

### Character Voice
- Each character must sound distinct.
- Dialogue should reveal personality.
- Use subtext - what's NOT said matters.
- Prefer the gap between what characters say and what they mean; allow direct speech for vows, confessions, tactics, comedy, ritual, or catharsis when pressure earns it.
- **Direct Source Language**: If source material fragments are provided, PRIORITIZE using that exact language for key moments and dialogue.

### Pacing
- Match prose length to moment importance.
- Quick beats for tension, longer for reflection.
- Vary the rhythm within scenes.

### Scene Craft
- Every scene needs a purpose players can feel: plot pressure, relationship movement, theme pressure, information gain, or meaningful aftermath.
- If the blueprint supplies themePressure, express it through action, cost, choice, subtext, relationship pressure, information, or identity movement. Never have dialogue state the theme question directly.
- Every scene must have a purpose in emotional, action, or character-related content that advances the story.
- Start as late as possible and leave as soon as the turn, decision, consequence, or handoff lands.
- In multi-character scenes, make leverage, trust, vulnerability, intimacy, distance, information, status, threat, debt, or public/private advantage shift at least once.
- Descriptions, action, dialogue, visual metadata, choices, and final beat should reinforce that purpose and help deliver the sceneTakeaways and keyMoment.
- Identify the scene's key moment and build the beat sequence toward it.
- Scene beats should build toward the scene keyMoment. Intensity does not need to rise mechanically every beat, but tension, gravitas, danger, intimacy, consequence, or dramatic clarity should accumulate across the scene.
- Build a stakes ladder across the beats: each beat should raise risk, reveal cost, narrow options, shift leverage, or deepen consequence until the dominant/peak beat carries the maximum stakes. Rest beats can raise dread, clarity, regret, tenderness, or emotional cost instead of volume.
- Use rest beats only when they create contrast, aftermath, dread, tenderness, or sharper payoff.
- Prefer turns over topics. A beat should visibly change leverage, trust, evidence, proximity, identity, risk, resources, or knowledge; do not let scenes become chains of explanation.
- Include scene takeaways: what the player should learn, feel, or understand by the end.
- Scene takeaways are load-bearing: they name what the player learns, feels, or understands about story, character, relationship, theme, information, or player-state pressure.
- The scene keyMoment should be the beat where those takeaways become felt, proven, revealed, or changed.
- Each non-rest beat should show a concrete shift in action, intent, leverage, mood, relationship dynamic, tactical position, information, or consequence.
- Use natural transition phrasing in continuityNotes or transitionIn ("Later that night", "Back at the observatory") when time or place shifts.
- If the blueprint leaves small connective gaps, fill them naturally with local detail: transition, concrete action, emotional pressure, physical business, clue, consequence, or relationship texture.
- Do not contradict season anchors, source-material fidelity, established character state, player choices, flags, callbacks, or encounter setup context.
- The final beat of each scene should land a pointed resolution or consequence, then create forward pressure into the next beat, choice, scene, encounter, or episode.
- Forward pressure may be a cliffhanger, reveal, unresolved cost, emotional rupture, new danger, changed relationship, choice consequence, or handoff.
- For non-finale episode endings, heighten next-episode pressure. For finale/resolution endings, resolve the central conflict and show aftermath.
- When a Seven-Point Cliffhanger Plan is supplied, the final beat must satisfy that plan: close the immediate scene/episode tension enough to feel authored, then open the specified next pressure.
- When characters are in jeopardy or believe they are in jeopardy, dialogue should become more pointed, urgent, interrupted, selective, or stripped down. As fear, danger, exposure, or time pressure increases, reduce explanation and sharpen what characters say.
- Never write a static meeting where characters only discuss information. If characters talk, ground the conversation in fitting physical activity, spatial pressure, object handling, preparation, travel, hiding, training, repair, cooking, cleaning, fighting, searching, ritual, medical care, escape, or another action appropriate to the circumstances.
- The physical activity should make the power shift or emotional pressure visible.
- Do not directly describe characters' thoughts and feelings. Instead, externalize inner life through brief dialogue, muttered one-line self-speech, silence, interruption, bodily action, object handling, hesitation, distance or closeness, facial expression, choice behavior, callback objects, or what the character does next.
- If a character is alone, use a brief one-line spoken or muttered line when needed.
- If a moment carries deep emotional weight, memory, regret, longing, fear, or reminiscence, express it through action or brief understated dialogue. Use less explanation, not more.
- Keep dialogue spare, quick, and to the point. Dialogue should advance story, reveal character, sharpen pressure, or change the relationship dynamic. Avoid speeches unless the source style, genre, ritual, confession, comedy, or climax truly calls for one.
- When physical action matters, include specific bodily movement: concrete movement, posture, proximity, hand placement, footwork, balance, collision, recoil, grip, breath, facial expression, or object interaction.
- Do not use film/camera direction terms in player-facing prose. Visual metadata may still use the required shotType and visualContinuity fields.
- Vivid means vivid story intent, not ornate prose or generic cinematic styling.
- For player-facing prose: use concrete, concise action and dialogue that makes the story turn legible.
- For visual metadata and image-facing fields: provide specific story intent, visible action, relationship dynamics, required details, and subtext cues. Do not add art-direction language that fights the active ArtStyleProfile, negative prompt, provider settings, or style-bible anchors.
- Visual metadata should describe what must be understood, not impose a conflicting style. Avoid generic style words like cinematic, hyperreal, vivid colors, dramatic lighting, painterly, anime, flat, gritty, glossy, symmetrical, or high contrast unless they come from the active style contract.

## Prose And Dialogue Craft
- Use sensory detail selectively and purposefully. Sensory description should establish place, mood, danger, intimacy, texture, or consequence. Do not force all five senses into every beat.
- Respect the active source style, genre, tone, user instructions, and style guide. Keep prose voice, dialogue rhythm, descriptive focus, and tonal register consistent across the scene.
- Use precise, concrete, genre-appropriate language. "Vivid" means specific story intent, sensory clarity, emotional legibility, and image-safe detail, not ornate prose or conflicting art direction.
- Make description dynamic. Descriptive details should carry pressure, mood, threat, desire, consequence, movement, or contrast.
- Keep dialogue spare, natural, character-specific, pressure-aware, and subtextual. Dialogue should reveal character, sharpen pressure, change leverage, or expose relationship dynamics.
- Vary sentence rhythm with scene pressure. Use shorter, sharper lines under danger, urgency, fear, or conflict. Use slightly longer rhythm for atmosphere, aftermath, tenderness, or dread while respecting mobile beat caps.
- Reveal motivation, fear, desire, attraction, guilt, suspicion, and grief through action, choice, speech, silence, bodily response, facial expression, object handling, avoidance, proximity, risk, and what the character does next.
- Show emotion through physical response and facial expression rather than direct explanation.
- Use environmental elements to enhance mood. The setting should pressure, contrast, reveal, or complicate the scene.
- Build every scene toward its keyMoment using sceneTakeaways, moodProgression, intensityTier, and final beat pressure.
- End with resolution plus forward pressure: consequence, emotional shift, reveal, choice, handoff, danger, changed relationship, or unresolved cost. Use true cliffhangers only when appropriate.
- Avoid repetition. Do not repeat plot events, dialogue, scene shapes, descriptive phrasing, character phrasing, location phrasing, or action language unless the repetition is an intentional callback, refrain, contrast, or payoff.
- Maintain consistent tone across the scene while allowing intentional tonal turns caused by story events.

## Fight, Weapon, And Physical Action Scenes
- If a scene includes fighting, weapons, pursuit, survival danger, or major physical action, make the danger concrete and serious.
- Fight/action beats should include specific strikes, maneuvers, evasions, blocks, grapples, throws, falls, impacts, wounds, or damage.
- Weapons or powers should produce destructive effects. Use loud or forceful consequences when appropriate: clashes, cracks, explosions, splintering, shattering, tearing, or ringing impact.
- Use surprising tactical choices or environmental maneuvers; do not let fights become abstract summaries.
- Show visible harm, depletion, fear, pain, exhaustion, loss of advantage, facial expressions, and bodily reactions when characters are wounded or damaged.
- Show through action how the winning side succeeds and what the losing side physically loses, suffers, or fails to protect.
- In action scenes, the hero or allies should be wounded, damaged, depleted, exposed, or narrowly escape a specific harm.

## Conflict Damage
- Every meaningful conflict should damage someone or something.
- Damage may be physical injury, emotional hurt, social humiliation, relational rupture, resource loss, reputation damage, information exposure, identity pressure, moral compromise, lost leverage, increased danger, or narrowing options.
- In fight/action scenes, damage should usually be physical, tactical, environmental, or resource-based, with emotional fallout where appropriate.
- In non-action scenes, damage can be social, relational, emotional, informational, reputational, or identity-based.

${CRAFT_PRESSURE_GUIDANCE}

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

## Player-Facing Prose

Do not emit template variables or unresolved placeholders in story text, textVariants, visual contracts, choice text, or callbacks.
Use the protagonist's actual name from the Characters section, concrete pronouns, or direct second-person prose ("you", "your").
NPCs should use exact names and concrete pronouns.

## CRITICAL: Character Names and Pronouns

**ABSOLUTE REQUIREMENTS:**
0. **Opening POV anchor:** The first non-empty player-facing beat MUST establish the player character as the viewpoint/focal character using second-person language ("you", "your"), the protagonist's actual name, or a concrete pronoun. Do not open with pure NPC action, world exposition, or an unnamed camera-like view.
1. **Use EXACT character names** as provided in the Characters section. Do NOT invent names, alter spellings, or use nicknames unless established.
2. **Use CORRECT pronouns** for each character as specified:
   - "he/him" characters: he, him, his, himself
   - "she/her" characters: she, her, hers, herself
   - "they/them" characters: they, them, their, theirs, themselves (singular) — only for characters explicitly marked as they/them
3. **Use he/him or she/her by default.** Only use they/them pronouns for characters explicitly designated as non-binary or transgender. Never default to they/them for a character whose gender is simply unspecified.
4. **Be consistent** - do not switch between pronouns for the same character.
5. **Use names frequently** to avoid ambiguous pronoun references when multiple characters are present.
6. For the protagonist, use the exact protagonist name, concrete pronouns, or "you/your"; never use template syntax.
7. For NPCs, use their exact names and correct pronouns as listed; never use NPC template syntax.

**COMMON ERRORS TO AVOID:**
- Using "he" for a she/her character (or vice versa)
- Inventing names not in the character list
- Using generic terms like "the stranger" when you have the character's name
- Ambiguous pronoun references when multiple same-pronoun characters are present
- Emitting unresolved template syntax or schema placeholders in prose

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
- "dramaticIntent": REQUIRED for non-establishing beats. Include: characterObjectives (object keyed by character name/id), obstacle, statusBefore, statusAfter, subtext, visibleTurn, visualSubtextCue.
- "sequenceIntent": REQUIRED-BY-PROCESS for every non-establishing beat in newly generated multi-beat scenes. The field is optional for old/cached content compatibility, but new output should include objective, activity, obstacle, startState, turningPoint, endState, visualThread, optional mechanicThread, and beatRole.
- "coveragePlan": REQUIRED-BY-PROCESS for every non-establishing beat. Include stagingPattern, shotDistance, cameraAngle, cameraSide, focalCharacterIds, requiredVisibleCharacterIds, optionalVisibleCharacterIds, offscreenCharacterIds, relationshipBlocking, coverageReason, and visualContinuity. The SequenceDirector will repair weak/missing plans, but the writer should author the intended visual coverage.
- "intensityTier": REQUIRED. One of "dominant", "supporting", or "rest". Assign based on the Narrative Intensity Tiering rules above. A scene needs 1-2 dominant beats, 1-2 rest beats, and the remainder as supporting. Vary the intensity across the scene.
- "visualContinuity": OPTIONAL but encouraged. Use it to make this beat flow from the previous beat as the next full-screen image: shotType, cameraAngle, focalCharacterId, blocking, proximity, motifOrProp, previousBeatId, transitionIntent, panelMode. Default panelMode is "single". Do NOT request panels, collages, split screens, contact sheets, or multiple moments inside the same image.

Avoid abstract-only phrases like "tension rises" or "emotion deepens." Describe what is physically visible. ALWAYS use character names — never generic references.

## Dramatic Intent (for ALL character-visible beats)

A character-visible beat is never just information transfer. It is someone pursuing something under resistance. For every non-establishing beat:
- Define what each visible character wants RIGHT NOW, not a season-level desire.
- Name the obstacle that blocks the objective.
- Track status/leverage before and after the beat, even if the shift is subtle.
- Name the subtext beneath the surface action/topic.
- Make "visibleTurn" the thing a viewer could understand with no captions.
- Make "visualSubtextCue" a concrete prop, gesture, distance change, posture shift, reaction, or environmental detail.

Quiet/rest beats are allowed, but still need a visible turn: a hand stops mid-task, an object changes possession, someone creates distance, a routine slips, or a face/body reaction betrays the inner change.

## Sequence Intent (for storyboard continuity)

A scene storyboard is a sequence, not a bag of shots. For newly generated multi-beat scenes, include a scene-level "sequenceIntent" and copy/refine it onto each non-establishing beat:
- objective: what this sequence is trying to accomplish.
- activity: the concrete visible activity carrying it, such as walking to the store, having an argument, searching a room, negotiating, escaping, sword fighting, recovering after a failure.
- obstacle: what resists the objective.
- startState / turningPoint / endState: how the sequence visibly begins, bends, and hands off.
- visualThread: the prop, distance, blocking, clue, wound, gesture, or motif that ties panels together.
- mechanicThread: optional fiction-first hook such as trust, leverage, clue, danger, resource, identity, reputation, callback, or encounter clock.
- beatRole: setup, pressure, escalation, turn, consequence, handoff, or aftermath.

Use sequenceIntent to make consecutive panels read as "setup -> pressure -> turn -> consequence" rather than unrelated illustrations.

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
        if (this.shouldRepairParsedSceneResponse(response, content)) {
          content = await this.repairMalformedSceneJson(
            input,
            response,
            new Error('SceneWriter response appears truncated or structurally incomplete after JSON repair'),
          );
        }
      } catch (parseError) {
        console.error(`[SceneWriter] JSON parse failed. Raw response (first 500 chars):`, response.substring(0, 500));
        content = await this.repairMalformedSceneJson(input, response, parseError);
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

  private shouldRepairParsedSceneResponse(response: string, content: SceneContent): boolean {
    const trimmed = response.trim();
    const openedFence = /^```(?:json|JSON)?/.test(trimmed);
    const closedFence = /```\s*$/.test(trimmed);
    if (openedFence && !closedFence) return true;
    if (!trimmed.endsWith('}') && !trimmed.endsWith(']') && !closedFence) return true;
    if (!content?.sceneId || !Array.isArray(content.beats) || content.beats.length === 0) return true;
    const firstBadBeat = content.beats.find((beat: any) => typeof beat?.text !== 'string' || beat.text.trim().length < 12);
    return Boolean(firstBadBeat);
  }

  private stripAgentFacingPressureParagraphs(text: string, fallback: string): string {
    const cleaned = String(text || '')
      .split(/\n{2,}|\r?\n/)
      .map((part) => part.trim())
      .filter((part) => part && !/^(?:pressure|choice pressure|forward pressure):/i.test(part))
      .join('\n\n')
      .trim();
    return cleaned || this.ensureTerminalPunctuation(fallback);
  }

  private async repairMalformedSceneJson(
    input: SceneWriterInput,
    malformedResponse: string,
    parseError: unknown,
  ): Promise<SceneContent> {
    const errorMessage = parseError instanceof Error ? parseError.message : String(parseError);
    const compactBlueprint = {
      id: input.sceneBlueprint.id,
      name: input.sceneBlueprint.name,
      description: input.sceneBlueprint.description,
      location: input.sceneBlueprint.location,
      mood: input.sceneBlueprint.mood,
      purpose: input.sceneBlueprint.purpose,
      narrativeFunction: this.stripAgentFacingPressureParagraphs(
        input.sceneBlueprint.narrativeFunction,
        input.sceneBlueprint.description || input.sceneBlueprint.name
      ),
      dramaticQuestion: input.sceneBlueprint.dramaticQuestion,
      wantVsNeed: input.sceneBlueprint.wantVsNeed,
      conflictEngine: input.sceneBlueprint.conflictEngine,
      themePressure: input.sceneBlueprint.themePressure,
      keyBeats: (input.sceneBlueprint.keyBeats || [])
        .filter((beat) => !isAgentFacingPressureNote(beat))
        .map(stripAgentFacingPressureLabel),
      choicePoint: input.sceneBlueprint.choicePoint,
      leadsTo: input.sceneBlueprint.leadsTo,
    };
    const visibleCharacters = [
      {
        role: 'protagonist',
        name: input.protagonistInfo.name,
        pronouns: input.protagonistInfo.pronouns,
        description: input.protagonistInfo.description,
      },
      ...input.npcs
        .filter((npc) => input.sceneBlueprint.npcsPresent.includes(npc.id))
        .map((npc) => ({
          id: npc.id,
          name: npc.name,
          pronouns: npc.pronouns,
          description: npc.description,
          voiceNotes: npc.voiceNotes,
        })),
    ];
    const repairPrompt = `
The previous SceneWriter response for scene "${input.sceneBlueprint.id}" was malformed JSON and could not be parsed.

Parse error:
${errorMessage}

Your job is to RE-EMIT the complete scene as valid JSON only. Do not explain. Do not use markdown fences. Do not return a partial object.

Scene blueprint:
${JSON.stringify(compactBlueprint)}

Story context:
${JSON.stringify({
  title: input.storyContext.title,
  genre: input.storyContext.genre,
  tone: input.storyContext.tone,
  targetBeatCount: input.targetBeatCount,
  dialogueHeavy: input.dialogueHeavy,
})}

Characters:
${JSON.stringify(visibleCharacters)}

Malformed/truncated response to repair or regenerate from:
${malformedResponse.slice(0, 24000)}

Return exactly one complete SceneContent JSON object with:
- sceneId, sceneName, description, startingBeatId, beats, moodProgression, charactersInvolved, keyMoments, continuityNotes
- up to ${input.targetBeatCount} beats
- concise strings so the response cannot truncate
- no markdown code block
- no prose outside JSON
`;

    console.warn(`[SceneWriter] Attempting JSON repair pass for ${input.sceneBlueprint.id}`);
    const repairedResponse = await this.callLLM([{ role: 'user', content: repairPrompt }], 2);
    try {
      const repaired = this.parseJSON<SceneContent>(repairedResponse);
      console.log(`[SceneWriter] JSON repair pass succeeded for ${input.sceneBlueprint.id}`);
      return repaired;
    } catch (repairError) {
      const repairMessage = repairError instanceof Error ? repairError.message : String(repairError);
      console.error(`[SceneWriter] JSON repair pass failed for ${input.sceneBlueprint.id}: ${repairMessage}`);
      throw new Error(`SceneWriter JSON repair failed after malformed response: ${repairMessage}`);
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

    if (!content.sequenceIntent || this.isWeakSequenceIntent(content.sequenceIntent)) {
      content.sequenceIntent = this.deriveSceneSequenceIntent(content, input);
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
      beat.text = this.stripAgentFacingPressureParagraphs(
        beat.text,
        input?.sceneBlueprint?.description || input?.sceneBlueprint?.dramaticQuestion || input?.sceneBlueprint?.name || 'The story pressure changes.'
      );

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
      this.ensureBeatSequenceIntent(beat, content, i);
    }

    // Guard against degenerate choice scenes. If the writer returns only one beat for a
    // scene that needs a decision, the whole scene can collapse into "choice beat + payoff beat"
    // and skip the setup that branch scenes need for pacing, QA, and image coverage.
    this.ensureMinimumChoiceSceneBeats(content, input);

    // Re-run visual contract normalization in case we synthesized structural beats.
    for (const beat of content.beats) {
      this.ensureBeatVisualContract(beat);
      this.ensureBeatSequenceIntent(beat, content, content.beats.indexOf(beat));
    }

    applySequenceDirectorPlan(content, {
      sceneDescription: input?.sceneBlueprint?.description,
      locationName: input?.sceneBlueprint?.location,
      genre: input?.storyContext?.genre,
      tone: input?.storyContext?.tone,
    });

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
      if (isAgentFacingPressureNote(keyBeat)) continue;
      pushText(stripAgentFacingPressureLabel(keyBeat));
    }
    pushText(this.stripAgentFacingPressureParagraphs(scene.narrativeFunction, scene.description || scene.name));
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

  /**
   * Step 2 (info-reveal): when StoryArchitect assigned authored INFO reveals to this
   * scene, instruct the writer to dramatize each on-page. Returns '' when none, leaving
   * the prompt byte-identical for scenes with no scheduled reveal.
   */
  private buildRevealDirectivesSection(input: SceneWriterInput): string {
    const directives = (input.revealDirectives ?? []).filter((d) => d?.fact?.trim());
    if (directives.length === 0) return '';
    const lines = directives.map((d) => `- ${d.fact.trim()}`).join('\n');
    return (
      '\n### Reveal On-Page (required)\n' +
      'This scene must REVEAL the following established fact(s) to the reader — dramatize each ' +
      'clearly in the prose (a character states, shows, or discovers it), not merely allude to it. ' +
      'Keep it fiction-first: never mention information ledgers, flags, or that this is a "reveal".\n' +
      lines
    );
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

    const sourceContextStr = buildSourceMaterialFidelitySection(input.sourceAnalysis);

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
${input.storyContext.userPrompt ? `- **User Instructions/Prompt**: ${input.storyContext.userPrompt}\n` : ''}${input.memoryContext ? `\n## Pipeline Memory (Insights from Prior Generations)\n${input.memoryContext}\n` : ''}${input.establishedCanon ? `\n## ${input.establishedCanon}\n(Treat the above as fixed truth — your prose must not contradict it.)\n` : ''}
> Continuity (#26C): only name characters, factions, and props already established in this
> story. Do not invent a named character or object the reader hasn't met; reference the
> existing cast/world instead.
## Scene Blueprint
- **Scene ID**: ${input.sceneBlueprint.id}
- **Name**: ${input.sceneBlueprint.name}
- **Description**: ${input.sceneBlueprint.description}
- **Location**: ${input.sceneBlueprint.location}
- **Mood**: ${input.sceneBlueprint.mood}
- **Purpose**: ${input.sceneBlueprint.purpose}
- **Narrative Function**: ${this.stripAgentFacingPressureParagraphs(input.sceneBlueprint.narrativeFunction, input.sceneBlueprint.description || input.sceneBlueprint.name)}
${input.sceneBlueprint.themePressure ? `- **Theme Pressure**: ${input.sceneBlueprint.themePressure}` : ''}

### Scene Craft Targets
- Define 1-4 sceneTakeaways in the output: what the player learns, feels, or understands.
- Every scene must have a purpose in emotional, action, or character-related content that advances the story; descriptions, action, dialogue, visual metadata, choices, and final beat should reinforce that purpose.
- If themePressure is supplied, express it through action, cost, choice, subtext, relationship pressure, information, or identity movement. Never have dialogue state the theme question directly.
- Scene takeaways are load-bearing: they name what the player learns, feels, or understands about story, character, relationship, theme, information, or player-state pressure.
- If this scene begins after a time/place shift, include transitionIn with a short natural phrase.
- The scene keyMoment should be the beat where sceneTakeaways become felt, proven, revealed, or changed.
- keyMoments should name the emotional or narrative payoff, not just a location or mood.
- moodProgression should show the scene's tension or emotional movement from start to finish.
- Use selective sensory detail to establish place, mood, danger, intimacy, texture, or consequence.
- Respect active source style, genre, tone, user instructions, and style guide.
- Use precise, concrete language; avoid ornate prose and generic description.
- Make description carry pressure, movement, mood, threat, desire, or consequence.
- Keep dialogue spare, natural, character-specific, pressure-aware, and subtextual.
- Prefer subtext over explanation: characters may argue values, conceal motives, dodge, confess, threaten, or plead, but should rarely summarize exactly what the scene means.
- Cut into the scene near the active pressure and leave on the punch: once the turn, decision, consequence, or handoff lands, do not keep explaining it.
- Vary sentence rhythm with emotional intensity while respecting mobile beat caps.
- Reveal inner life through action, speech, silence, bodily response, facial expression, object handling, proximity, risk, and choice behavior.
- Build toward the scene keyMoment and end with resolution plus forward pressure.
- Avoid repeated plot events, dialogue, scene shapes, and descriptive phrasing unless intentional callback/payoff.
- Maintain consistent tone unless the scene event intentionally turns the tone.
- Scene beats should build toward the scene keyMoment. Intensity does not need to rise mechanically every beat, but tension, gravitas, danger, intimacy, consequence, or dramatic clarity should accumulate across the scene.
- Build a stakes ladder across the beats: each beat should raise risk, reveal cost, narrow options, shift leverage, or deepen consequence until the dominant/peak beat carries the maximum stakes. Rest beats can raise dread, clarity, regret, tenderness, or emotional cost instead of volume.
- Use rest beats only when they create contrast, aftermath, dread, tenderness, or sharper payoff.
- The final beat of each scene should land a pointed resolution or consequence, then create forward pressure into the next beat, choice, scene, encounter, or episode.
- Forward pressure may be a cliffhanger, reveal, unresolved cost, emotional rupture, new danger, changed relationship, choice consequence, or handoff.
- For non-finale episode endings, heighten next-episode pressure. For finale/resolution endings, resolve the central conflict and show aftermath.
- Never write a static meeting where characters only discuss information. Give dialogue scenes fitting physical activity, spatial pressure, object handling, preparation, travel, hiding, training, repair, cooking, cleaning, fighting, searching, ritual, medical care, escape, or another action appropriate to the circumstances.
- When characters are in jeopardy or believe they are in jeopardy, dialogue should become more pointed, urgent, interrupted, selective, or stripped down.
- Do not directly describe characters' thoughts and feelings. Externalize inner life through brief dialogue, muttered one-line self-speech, silence, interruption, bodily action, object handling, hesitation, distance or closeness, facial expression, choice behavior, callback objects, or what the character does next.
- If a moment carries deep emotional weight, memory, regret, longing, fear, or reminiscence, express it through action or brief understated dialogue. Use less explanation, not more.
- Keep dialogue spare, quick, and to the point unless the source style, genre, ritual, confession, comedy, or climax truly calls for longer speech.
- When physical action matters, include specific bodily movement: concrete movement, posture, proximity, hand placement, footwork, balance, collision, recoil, grip, breath, facial expression, or object interaction.
- Each non-rest beat should show a concrete shift in action, intent, leverage, mood, relationship dynamic, tactical position, information, or consequence.
- If the blueprint leaves small connective gaps, fill them naturally with local detail: transition, concrete action, emotional pressure, physical business, clue, consequence, or relationship texture.
- Do not contradict season anchors, source-material fidelity, established character state, player choices, flags, callbacks, or encounter setup context.
- Give the scene a storyboardable sequenceIntent: objective, visible activity, obstacle, startState, turningPoint, endState, visualThread, optional mechanicThread. Treat it as required for new output but backward-compatible for old content.
- Each non-establishing beat should include sequenceIntent with a beatRole so the storyboard can see setup -> pressure -> escalation -> turn -> consequence/handoff.
- Each non-establishing beat should include a coveragePlan so the storyboard can see shot scale, angle, staging, visible/offscreen cast, relationship blocking, and continuity. Avoid vague "dialogue coverage"; make the shot prove what changed.
- Vivid means vivid story intent, not ornate prose or generic cinematic styling. For player-facing prose, use concrete, concise action and dialogue that makes the story turn legible.
- For visual metadata and image-facing fields, provide specific story intent, visible action, relationship dynamics, required details, and subtext cues. Do not add art-direction language that fights the active ArtStyleProfile, negative prompt, provider settings, or style-bible anchors.
- Visual metadata should describe what must be understood, not impose a conflicting style. Avoid generic style words like cinematic, hyperreal, vivid colors, dramatic lighting, painterly, anime, flat, gritty, glossy, symmetrical, or high contrast unless they come from the active style contract.
- Every non-rest, non-establishing beat should answer: "What visibly changed by the end?"
- Prefer turns over topics: not "they discuss the charm," but "the charm changes hands and Mrs. Constantinou loses the ability to dismiss what she saw."
- Turn domains to use in prose, dramaticIntent, and existing mechanics hooks: ${FICTION_FIRST_TURN_DOMAINS.join(', ')}.
- When a turn is mechanically relevant, use existing fields only: onShow, textVariants, callbackHookId, plantsThreadId, paysOffThreadId, plotPointType, dramaticIntent, or choice/encounter setup that will carry the residue.
- If this scene includes fighting, weapons, pursuit, survival danger, or major physical action, make the danger concrete and serious: specific strikes, maneuvers, evasions, blocks, grapples, throws, falls, impacts, wounds, damage, destructive effects, loud forceful consequences, surprising tactical choices, environmental use, facial expressions, and bodily reactions.
- Do not let fights become abstract summaries. Show through action how the winning side succeeds and what the losing side physically loses, suffers, or fails to protect.
- In action scenes, the hero or allies should be wounded, damaged, depleted, exposed, or narrowly escape a specific harm.
- Every meaningful conflict should damage someone or something: physical injury, emotional hurt, social humiliation, relational rupture, resource loss, reputation damage, information exposure, identity pressure, moral compromise, lost leverage, increased danger, or narrowing options.
- Preserve rests where they serve contrast, aftermath, dread, tenderness, or sharper payoff; do not force constant combat or argument.

### Genre-Aware Jeopardy
${buildGenreAwareJeopardyGuidance(input.storyContext.genre)}

### Expert Design Template
- **Dramatic Question**: ${input.sceneBlueprint.dramaticQuestion}
- **Want vs Need**: ${input.sceneBlueprint.wantVsNeed}
- **Conflict Engine**: ${input.sceneBlueprint.conflictEngine}
- **Sequence Intent**: ${this.formatSequenceIntent(input.sceneBlueprint.sequenceIntent)}

### Key Beats to Hit
${input.sceneBlueprint.keyBeats
  .filter((beat) => !isAgentFacingPressureNote(beat))
  .map((beat) => `- ${stripAgentFacingPressureLabel(beat)}`)
  .join('\n')}
${buildRequiredBeatsSection(input.sceneBlueprint)}
${this.buildRevealDirectivesSection(input)}

${input.sceneBlueprint.choicePoint ? `
### Choice Point
- **Type**: ${input.sceneBlueprint.choicePoint.type}
- **Description**: ${input.sceneBlueprint.choicePoint.description}
- **Stakes**:
  - Want: ${input.sceneBlueprint.choicePoint.stakes.want}
  - Cost: ${input.sceneBlueprint.choicePoint.stakes.cost}
  - Identity: ${input.sceneBlueprint.choicePoint.stakes.identity}
${input.sceneBlueprint.choicePoint.stakesLayers ? `- **Stakes Layers**:
  - Material: ${input.sceneBlueprint.choicePoint.stakesLayers.material || 'None'}
  - Relational: ${input.sceneBlueprint.choicePoint.stakesLayers.relational || 'None'}
  - Identity: ${input.sceneBlueprint.choicePoint.stakesLayers.identity || 'None'}
  - Existential: ${input.sceneBlueprint.choicePoint.stakesLayers.existential || 'None'}` : ''}
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
  conditionKeys: h.conditionKeys,
  impactFactors: h.impactFactors,
  consequenceTier: h.consequenceTier,
  summary: h.summary,
  payoffWindow: { minEpisode: 0, maxEpisode: 0 },
  payoffCount: 0,
  resolved: false,
  createdAt: '',
})))}
${input.cliffhangerPlan ? `
## Seven-Point Cliffhanger Plan (CRITICAL if this is the episode's final scene)
- Style: ${input.cliffhangerPlan.style}
- Structural role: ${input.cliffhangerPlan.mappedStructuralRole}
- Type: ${input.cliffhangerPlan.type}
- Intensity: ${input.cliffhangerPlan.intensity}
- Hook to deliver: ${input.cliffhangerPlan.hook}
- Setup that earns it: ${input.cliffhangerPlan.setup}
- Immediate episode tension to acknowledge/resolve: ${input.cliffhangerPlan.resolvedEpisodeTension}
- New open question: ${input.cliffhangerPlan.newOpenQuestion}
- Emotional charge: ${input.cliffhangerPlan.emotionalCharge}
- Next-episode pressure: ${input.cliffhangerPlan.nextEpisodePressure}

If this scene has no outgoing scene, write the last beat as serialized-TV craft:
1. Acknowledge the episode's immediate conflict or consequence.
2. Land the planned shock/emotional/reveal/danger/legacy hook as a concrete event or realization.
3. End with forward pressure, but do not rely on ellipses or a generic question as the whole hook.
4. Make the visual contract show the hook: the object, face, gesture, arrival, absence, or rupture the reader should remember.
` : ''}
## Requirements
- Write up to ${input.targetBeatCount} beats for this scene (cap—use fewer if the scene doesn't need more)
${input.targetBeatCount >= 6 ? '- If this is a scene-length episode, write at least 6 beats and keep the final beat as the visible choice point. Do not compress the episode into only setup to crisis to choice.\n' : ''}
- ${input.dialogueHeavy ? 'This is dialogue-heavy - focus on conversation' : 'Balance description with any dialogue'}
- The first non-empty player-facing beat MUST anchor POV to the player character with "you", "your", the protagonist's actual name, or a concrete pronoun before focusing on NPCs or setting.
- Add optional skillInsights on beats where hidden capability should change what the character notices.
- skillInsights are passive fiction-first prose, never labels. They reveal danger, opportunity, emotional subtext, contradictions, environmental tools, social leverage, or hidden costs.
- skillInsights shape: { "id": "slug", "skillWeights": { "perception": 0.6, "investigation": 0.4 }, "threshold": 55, "text": "Plain prose only.", "priority": 1 }
- Insight thresholds: 45 easy reveal, 55 meaningful reveal, 65 strong build reveal, 75 rare expert reveal.
- Never write "skill check", "threshold", "bonus", "modifier", "success chance", percentages, or raw skill/stat names as player-facing labels.
${input.previousSceneSummary ? `- Previous scene context: ${input.previousSceneSummary}` : ''}
${input.nextSceneContext ? `- Next scene context: ${input.nextSceneContext.name} (${input.nextSceneContext.location}) — ${input.nextSceneContext.encounterDescription || input.nextSceneContext.description}` : ''}
${input.continueInLocation ? `- CONTINUITY: the previous scene already took place in ${input.continueInLocation}. The protagonist is ALREADY here — open mid-presence (continue the visit), do NOT re-stage a first arrival, threshold-crossing, or "the smell hits you as you enter". Re-entering a location you never left reads as a continuity error.` : ''}
${(input.priorEncounterOutcomes?.length ?? 0) > 0 ? `
## POST-ENCOUNTER OUTCOME REACTIVITY (CRITICAL)
This scene follows an encounter that can end several ways, and the gameplay state already records which: ${input.priorEncounterOutcomes!.map(e => `"${e.encounterName}"${e.defeatStakes ? ` (a hard outcome means: ${e.defeatStakes})` : ''}`).join('; ')}.
- The opening MUST NOT read identically regardless of how that encounter went.
- Author at least one textVariant on an EARLY beat gated on the outcome flag so the prose reflects the result — e.g. an ally who was hurt appears injured, a costly win shows its cost, a defeat colors the mood. Use these EXACT flags:
${input.priorEncounterOutcomes!.flatMap(e => e.outcomeFlags.map(o => `  - { "type": "flag", "flag": "${o.flag}", "value": true }  // ${e.encounterName}: ${o.outcome}`)).join('\n')}
- Keep the base text true for the most neutral (victory) path; the variants carry the harder outcomes.
` : ''}
${input.sceneBlueprint.choicePoint ? '- Mark the final beat as isChoicePoint: true for the Choice Author to add options' : ''}
${input.nextSceneContext?.isEncounter && !input.sceneBlueprint.choicePoint ? `
## PRE-ENCOUNTER HANDOFF (CRITICAL)
This scene leads directly into an encounter scene: "${input.nextSceneContext.name}".
- The FINAL beat must bridge from the current scene into that encounter.
- Include one concrete handoff: a warning, departure, walk home, shortcut, pursuit setup, location shift, ominous sign, or unresolved danger that makes the encounter feel inevitable.
- Do not end on a newly introduced fact if the next scene starts in a different place or tactical situation; give the player a readable cause-and-effect path into the encounter.
- Preserve the final planned key beat from this scene while adding the bridge.
${input.nextSceneContext.encounterBeatPlan?.length ? `- Upcoming encounter beat plan:\n${input.nextSceneContext.encounterBeatPlan.map(beat => `  - ${beat}`).join('\n')}` : ''}
` : ''}
${input.incomingChoiceContext ? `
## CHOICE PAYOFF (CRITICAL — the player CHOSE this)
This scene is entered because the player chose: "${input.incomingChoiceContext}"
Use one or more opening beats as needed to pay off this choice. Do not delay, hedge, skip, or teleport past the payoff.
- The opening sequence must show what you or the protagonist did or immediately experiences because of that choice.
- If the scene starts after a time/place shift, include the decision, departure/movement, and arrival before the next major interaction.
- The next planned story action must wait until the route into it is understandable.
- The opening text must show the immediate consequence of the choice — the SPECIFIC physical action or decision the player chose.
- The first beat's visual contract MUST directly depict the choice's consequence:
  - "visualMoment": Describe the EXACT action from the choice playing out (e.g., if they chose to spin in circles, show spinning in circles — not a generic pose)
  - "primaryAction": The verb-led physical action that matches the choice (e.g., "spins wildly with arms outstretched" not "stands on the moors")
  - "mustShowDetail": A specific visual element from the choice that the image MUST include
- If the player chose to kiss someone, show the kiss. If they chose to dance, show them dancing. If they chose to fight, show the fight. If they chose to laugh wildly and spin, show wild laughter and spinning.
- Do NOT generalize the choice into a mood or atmosphere shot. The image must show the SPECIFIC ACTION the player selected.
- Do NOT show or name a major NPC as familiar until the story has introduced them on the active path.
` : ''}

Create the scene content following the SceneContent schema. Include:
1. Engaging narrative prose for each beat
2. Distinct character voices in dialogue
3. Sensory details and atmosphere
4. Natural flow between beats
5. textVariants where state should affect content
6. Full beat visual contract fields (visualMoment, primaryAction, emotionalRead, relationshipDynamic, mustShowDetail, intensityTier) for every beat
7. dramaticIntent for every non-establishing beat, including visibleTurn and visualSubtextCue
8. scene-level sequenceIntent and beat-level sequenceIntent for every non-establishing beat in new multi-beat scenes
9. coveragePlan for every non-establishing beat, including shot scale, angle, staging, visible/offscreen cast, relationship blocking, and continuity
9. Optional visualContinuity metadata when it clarifies beat-to-beat flow; keep panelMode as "single" unless an explicit UX/config flag says otherwise
10. When unresolved callback hooks are listed above, author at least one TextVariant whose \`callbackHookId\` matches an existing hook id
11. sceneTakeaways and transitionIn when they clarify purpose and flow

Respond with valid JSON matching the SceneContent type. Return raw JSON only: no markdown fences, no commentary, no trailing prose.
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

    this.validatePreEncounterHandoff(content, input);

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

  private validatePreEncounterHandoff(content: SceneContent, input: SceneWriterInput): void {
    if (!input.nextSceneContext?.isEncounter || input.sceneBlueprint.choicePoint) return;
    if (!content.beats.length) return;

    const finalBeat = content.beats[content.beats.length - 1];
    const finalText = this.normalizeForHandoffCheck(finalBeat.text);
    if (!finalText) return;

    const bridgeMarkers = [
      'after', 'alone', 'approach', 'careful', 'danger', 'door', 'exit', 'follow',
      'fog', 'gate', 'home', 'leave', 'leaves', 'leaving', 'night', 'outside',
      'park', 'path', 'pursue', 'shortcut', 'stalk', 'street', 'trust', 'warn',
      'warning', 'watch', 'watched', 'walk',
    ];
    const nextContextTerms = [
      input.nextSceneContext.name,
      input.nextSceneContext.location,
      input.nextSceneContext.description,
      input.nextSceneContext.encounterDescription,
      ...(input.nextSceneContext.encounterBeatPlan || []),
    ]
      .flatMap((text) => this.extractHandoffKeywords(text))
      .filter((term) => term.length >= 4);

    const hasBridgeMarker = bridgeMarkers.some((marker) => finalText.includes(marker));
    const hasNextContextTerm = nextContextTerms.some((term) => finalText.includes(term));

    if (!hasBridgeMarker && !hasNextContextTerm) {
      throw new Error(
        `Pre-encounter handoff missing for ${input.sceneBlueprint.id}: final beat must bridge into ` +
        `${input.nextSceneContext.id} (${input.nextSceneContext.name}) with a warning, departure, ` +
        `location shift, pursuit setup, or other concrete cause-and-effect transition.`
      );
    }
  }

  private normalizeForHandoffCheck(text?: string): string {
    return String(text || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9\s-]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private extractHandoffKeywords(text?: string): string[] {
    const stopWords = new Set([
      'about', 'after', 'again', 'being', 'from', 'have', 'into', 'must',
      'scene', 'that', 'their', 'there', 'this', 'through', 'using', 'what',
      'when', 'where', 'with', 'your',
    ]);
    return this.normalizeForHandoffCheck(text)
      .split(' ')
      .filter((word) => word.length >= 4 && !stopWords.has(word))
      .slice(0, 20);
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
    if (!beat.dramaticIntent || this.isWeakDramaticIntent(beat.dramaticIntent)) {
      beat.dramaticIntent = this.deriveDramaticIntent(beat, subject);
    }
    this.strengthenStaticVisualContract(beat, subject);
  }

  private isWeakStaticAction(action?: string): boolean {
    const normalized = (action || '').trim().toLowerCase();
    if (!normalized || normalized.length < 8) return true;
    return /\b(takes? a decisive physical action|reacts? under pressure|reports?|explains?|addresses?|observes?|focuses|voices?|deflects?|compliments?|speaks?|talks?|looks?|watches?|thinks?|realizes?|notices?|listens?|waits?|smiles?|continues)\b/.test(normalized);
  }

  private isWeakDramaticIntent(intent?: Beat['dramaticIntent']): boolean {
    if (!intent) return true;
    return !intent.visibleTurn || !intent.visualSubtextCue || !intent.obstacle;
  }

  private deriveDramaticIntent(beat: GeneratedBeat, subject: string): NonNullable<Beat['dramaticIntent']> {
    const text = (beat.text || '').trim();
    const primaryAction = beat.primaryAction || this.derivePrimaryAction(text, subject);
    const visibleTurn = this.deriveVisibleTurn(text, primaryAction, subject);
    const visualSubtextCue = this.deriveVisualSubtextCue(text, primaryAction, subject);
    const obstacle = this.deriveIntentObstacle(text);
    const objective = this.deriveCharacterObjective(text, subject);
    return {
      ...(beat.dramaticIntent || {}),
      characterObjectives: {
        ...(beat.dramaticIntent?.characterObjectives || {}),
        [subject]: beat.dramaticIntent?.characterObjectives?.[subject] || objective,
      },
      obstacle: beat.dramaticIntent?.obstacle || obstacle,
      statusBefore: beat.dramaticIntent?.statusBefore || this.deriveStatusBefore(text, subject),
      statusAfter: beat.dramaticIntent?.statusAfter || this.deriveStatusAfter(text, primaryAction, subject),
      subtext: beat.dramaticIntent?.subtext || this.deriveSubtext(text),
      visibleTurn: beat.dramaticIntent?.visibleTurn || visibleTurn,
      visualSubtextCue: beat.dramaticIntent?.visualSubtextCue || visualSubtextCue,
    };
  }

  private deriveVisibleTurn(text: string, action: string, subject: string): string {
    const lowered = text.toLowerCase();
    if (/(lie|lying|deflect|deny|glitch|imagining|casual|normal)/.test(lowered)) {
      return `${subject}'s composed surface slips through a small evasive movement.`;
    }
    if (/(report|explain|warn|tell|says?|asks?|voice|speaks?)/.test(lowered)) {
      return `${subject} turns the exchange by making the hidden pressure physically visible.`;
    }
    if (/(observe|watch|study|notice|realize|understand)/.test(lowered)) {
      return `${subject} notices the decisive clue and their posture changes around it.`;
    }
    if (/(phone|text|message|screen|photo|app)/.test(lowered)) {
      return `${subject} uses the phone as evidence, shifting the room's attention to the screen.`;
    }
    if (/(charm|ring|key|letter|map|knife|gun|cup|coffee|flower|pansy|bag|napkin)/.test(lowered)) {
      return `${subject} changes the beat by moving or revealing the key object.`;
    }
    const escapedSubject = subject.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return `${subject} ${action.replace(new RegExp(`^${escapedSubject}\\s+`, 'i'), '')}, visibly changing the balance of the moment.`;
  }

  private deriveVisualSubtextCue(text: string, action: string, subject: string): string {
    const lowered = text.toLowerCase();
    const prop = text.match(/\b(phone|text|screen|photo|charm|ring|key|letter|map|knife|gun|cup|coffee|flower|pansy|shopping bag|napkin|counter|door|chair|window)\b/i)?.[0];
    if (prop) return `${subject}'s hands and attention lock onto the ${prop}, making the subtext visible.`;
    if (/(lie|deflect|deny|casual|normal|smile)/.test(lowered)) {
      return `${subject}'s smile, averted eyes, and busy hands betray what the words avoid.`;
    }
    if (/(fear|panic|worry|guilt|shame|hurt)/.test(lowered)) {
      return `${subject}'s weight shifts back while their hands tighten, exposing the feeling they try to contain.`;
    }
    if (/(approach|enter|leave|walk|step|back away|retreat)/.test(lowered)) {
      return `The changing distance around ${subject} shows who is gaining or losing control.`;
    }
    return `${subject}'s hands, gaze, and distance from the other characters reveal the beat beneath the words.`;
  }

  private strengthenStaticVisualContract(beat: GeneratedBeat, subject: string): void {
    if (beat.shotType === 'establishing') return;
    const intent = beat.dramaticIntent || this.deriveDramaticIntent(beat, subject);
    const needsStrength = this.isWeakStaticAction(beat.primaryAction);
    if (needsStrength) {
      beat.primaryAction = this.derivePhysicalBusinessFromIntent(beat.text || '', subject, intent);
    }
    if (!beat.visualMoment || this.isAbstractOnly(beat.visualMoment) || this.isWeakStaticAction(beat.visualMoment)) {
      beat.visualMoment = `${intent.visibleTurn} ${intent.visualSubtextCue}`.trim();
    }
    const visibleTurn = intent.visibleTurn || this.deriveVisibleTurn(beat.text || '', beat.primaryAction || '', subject);
    const cue = intent.visualSubtextCue || this.deriveVisualSubtextCue(beat.text || '', beat.primaryAction || '', subject);
    beat.dramaticIntent = { ...intent, visibleTurn, visualSubtextCue: cue };
    if (!beat.mustShowDetail || /one concrete prop|body detail|key prop/i.test(beat.mustShowDetail)) {
      beat.mustShowDetail = cue;
    }
    if (!beat.relationshipDynamic || this.isAbstractOnly(beat.relationshipDynamic)) {
      beat.relationshipDynamic = `${intent.statusBefore || 'status is unsettled'} -> ${intent.statusAfter || 'status visibly shifts'}`;
    }
  }

  private formatSequenceIntent(intent?: Beat['sequenceIntent']): string {
    if (!intent) return 'Derive from dramaticQuestion, conflictEngine, and keyBeats.';
    return [
      `objective=${intent.objective || 'derive'}`,
      `activity=${intent.activity || 'derive'}`,
      `obstacle=${intent.obstacle || 'derive'}`,
      `start=${intent.startState || 'derive'}`,
      `turn=${intent.turningPoint || 'derive'}`,
      `end=${intent.endState || 'derive'}`,
      `visualThread=${intent.visualThread || 'derive'}`,
      `mechanicThread=${intent.mechanicThread || 'optional'}`,
    ].join('; ');
  }

  private ensureBeatSequenceIntent(beat: GeneratedBeat, content: SceneContent, index: number): void {
    if (beat.shotType === 'establishing') return;
    const sceneIntent = content.sequenceIntent || this.deriveSceneSequenceIntent(content);
    if (!beat.sequenceIntent || this.isWeakSequenceIntent(beat.sequenceIntent)) {
      beat.sequenceIntent = {
        ...sceneIntent,
        ...(beat.sequenceIntent || {}),
        beatRole: beat.sequenceIntent?.beatRole || this.deriveSequenceBeatRole(index, content.beats.length, beat),
        turningPoint: beat.sequenceIntent?.turningPoint || beat.dramaticIntent?.visibleTurn || sceneIntent?.turningPoint,
        visualThread: beat.sequenceIntent?.visualThread || beat.dramaticIntent?.visualSubtextCue || sceneIntent?.visualThread,
      };
    }
  }

  private isWeakSequenceIntent(intent?: Beat['sequenceIntent']): boolean {
    if (!intent) return true;
    return !intent.objective || !intent.activity || !intent.turningPoint || !intent.endState || !intent.visualThread;
  }

  private deriveSceneSequenceIntent(content: SceneContent, input?: SceneWriterInput): NonNullable<Beat['sequenceIntent']> {
    const blueprint = input?.sceneBlueprint;
    const beats = content.beats || [];
    const firstBeat = beats.find((beat) => beat.shotType !== 'establishing') || beats[0];
    const turnBeat = beats.find((beat) => beat.isClimaxBeat || beat.isKeyStoryBeat || beat.intensityTier === 'dominant') || beats[Math.max(0, Math.floor(beats.length / 2))] || firstBeat;
    const lastBeat = beats[beats.length - 1] || firstBeat;
    const combined = [
      blueprint?.description,
      blueprint?.dramaticQuestion,
      blueprint?.conflictEngine,
      ...(blueprint?.keyBeats || []),
      ...beats.map((beat) => beat.text),
    ].filter(Boolean).join(' ');
    const subject = firstBeat?.speaker || content.charactersInvolved?.[0] || 'the protagonist';
    return {
      ...(blueprint?.sequenceIntent || content.sequenceIntent || {}),
      sequenceId: blueprint?.sequenceIntent?.sequenceId || content.sequenceIntent?.sequenceId || `${content.sceneId || 'scene'}-sequence-1`,
      objective: blueprint?.sequenceIntent?.objective || content.sequenceIntent?.objective || this.deriveSequenceObjective(combined, subject),
      activity: blueprint?.sequenceIntent?.activity || content.sequenceIntent?.activity || this.deriveSequenceActivity(combined),
      obstacle: blueprint?.sequenceIntent?.obstacle || content.sequenceIntent?.obstacle || this.deriveIntentObstacle(combined),
      startState: blueprint?.sequenceIntent?.startState || content.sequenceIntent?.startState || this.deriveSequenceState(firstBeat, 'The sequence starts with pressure still unresolved.'),
      turningPoint: blueprint?.sequenceIntent?.turningPoint || content.sequenceIntent?.turningPoint || turnBeat?.dramaticIntent?.visibleTurn || this.deriveVisibleTurn(turnBeat?.text || combined, turnBeat?.primaryAction || 'acts', subject),
      endState: blueprint?.sequenceIntent?.endState || content.sequenceIntent?.endState || this.deriveSequenceState(lastBeat, 'By the end, the relationship, leverage, knowledge, or risk has visibly changed.'),
      visualThread: blueprint?.sequenceIntent?.visualThread || content.sequenceIntent?.visualThread || this.deriveVisualSubtextCue(combined, turnBeat?.primaryAction || '', subject),
      mechanicThread: blueprint?.sequenceIntent?.mechanicThread || content.sequenceIntent?.mechanicThread || this.deriveSequenceMechanicThread(combined),
    };
  }

  private deriveSequenceBeatRole(index: number, count: number, beat: GeneratedBeat): NonNullable<Beat['sequenceIntent']>['beatRole'] {
    if (beat.intensityTier === 'rest') return index >= count - 1 ? 'aftermath' : 'pressure';
    if (index === 0) return 'setup';
    if (beat.isClimaxBeat || beat.isKeyStoryBeat || beat.intensityTier === 'dominant') return 'turn';
    if (index >= count - 1) return beat.isChoicePoint ? 'handoff' : 'consequence';
    return index < Math.max(2, Math.floor(count / 2)) ? 'pressure' : 'escalation';
  }

  private deriveSequenceObjective(text: string, subject: string): string {
    const lowered = text.toLowerCase();
    if (/(argue|accuse|confront|apologize|forgive)/.test(lowered)) return `${subject} tries to change the relationship without losing control of the room.`;
    if (/(walk|travel|store|market|street|road|cross)/.test(lowered)) return `${subject} tries to reach the next place while the unresolved pressure follows along.`;
    if (/(search|investigat|clue|evidence|proof|discover)/.test(lowered)) return `${subject} tries to make hidden information visible and actionable.`;
    if (/(fight|duel|strike|battle|escape|chase|run)/.test(lowered)) return `${subject} tries to survive the pressure and change the tactical position.`;
    if (/(rest|recover|aftermath|quiet|settle)/.test(lowered)) return `${subject} tries to absorb what happened and recalibrate before the next pressure.`;
    return `${subject} tries to move the scene from uncertainty to a changed state.`;
  }

  private deriveSequenceActivity(text: string): string {
    const lowered = text.toLowerCase();
    if (/(walk|travel|store|market|street|road|cross)/.test(lowered)) return 'moving through the location while unresolved tension changes distance and attention';
    if (/(argue|accuse|confront)/.test(lowered)) return 'a confrontation carried through blocking, objects, and shifting status';
    if (/(search|investigat|clue|evidence|proof|discover)/.test(lowered)) return 'an investigation where attention moves from room to clue to reaction';
    if (/(fight|duel|strike|battle)/.test(lowered)) return 'a physical exchange where position, control, and cost change';
    if (/(escape|chase|run)/.test(lowered)) return 'an escape or chase where the route and risk keep changing';
    if (/(rest|recover|aftermath|quiet|settle)/.test(lowered)) return 'a quiet recovery sequence where posture, distance, and routine reveal the change';
    return 'a visible exchange of pressure, reaction, and consequence';
  }

  private deriveSequenceState(beat: GeneratedBeat | undefined, fallback: string): string {
    return beat?.dramaticIntent?.statusAfter || beat?.dramaticIntent?.visibleTurn || beat?.visualMoment || beat?.primaryAction || fallback;
  }

  private deriveSequenceMechanicThread(text: string): string | undefined {
    const lowered = text.toLowerCase();
    if (/(trust|believe|doubt|betray|forgive)/.test(lowered)) return 'trust';
    if (/(evidence|proof|clue|photo|phone|letter|key|charm)/.test(lowered)) return 'clue/evidence';
    if (/(leverage|control|power|corner)/.test(lowered)) return 'leverage';
    if (/(danger|risk|threat|escape|wound|cost)/.test(lowered)) return 'danger/risk';
    if (/(identity|mercy|justice|honest|values?)/.test(lowered)) return 'identity';
    if (/(resource|money|weapon|supplies|inventory)/.test(lowered)) return 'resource';
    return undefined;
  }

  private derivePhysicalBusinessFromIntent(text: string, subject: string, intent: NonNullable<Beat['dramaticIntent']>): string {
    const lowered = text.toLowerCase();
    if (/(phone|text|message|screen|photo|app)/.test(lowered)) return `${subject} angles the phone like evidence while watching for a reaction`;
    if (/(charm|ring|key|letter|map|knife|gun|cup|coffee|flower|pansy|bag|napkin)/.test(lowered)) return `${subject} brings the key object into the space between the characters`;
    if (/(deflect|deny|glitch|imagining|casual|normal|smile|compliment)/.test(lowered)) return `${subject} keeps their hands busy to hide the evasion`;
    if (/(report|explain|warn|tell|says?|asks?|voice|speaks?)/.test(lowered)) return `${subject} leans in and uses a concrete gesture to press the point`;
    if (/(observe|watch|study|notice|realize|understand)/.test(lowered)) return `${subject} shifts position to study the clue everyone else is avoiding`;
    if (/(guilt|shame|fear|hurt|worry)/.test(lowered)) return `${subject} pulls back as the feeling becomes visible in their hands and shoulders`;
    const cue = intent.visualSubtextCue || 'a visible body-language cue';
    return `${subject} changes the room's leverage through ${cue}`;
  }

  private deriveCharacterObjective(text: string, subject: string): string {
    const lowered = text.toLowerCase();
    if (/(deflect|deny|glitch|imagining|casual|normal)/.test(lowered)) return 'avoid revealing the truth while preserving control';
    if (/(ask|question|look at this|show|evidence|proof|photo)/.test(lowered)) return 'make the other person acknowledge what is visible';
    if (/(report|warn|tell|explain)/.test(lowered)) return 'make someone else understand the danger or truth';
    if (/(observe|watch|study|notice|realize)/.test(lowered)) return 'read the situation without exposing too much';
    if (/(leave|door|walk away|retreat)/.test(lowered)) return 'escape the exchange before the real feeling is exposed';
    return `${subject} wants to shift the moment without saying everything directly`;
  }

  private deriveIntentObstacle(text: string): string {
    const lowered = text.toLowerCase();
    if (/(lie|deny|deflect|secret|hiding)/.test(lowered)) return 'someone is hiding the truth';
    if (/(guilt|shame|fear|hurt|worry)/.test(lowered)) return 'emotion makes the direct path risky';
    if (/(trust|love|relationship|family)/.test(lowered)) return 'the relationship cost is immediate';
    if (/(proof|evidence|photo|phone|screen|charm|key|letter)/.test(lowered)) return 'the evidence is visible but contested';
    return 'the other character resists the surface objective';
  }

  private deriveStatusBefore(text: string, subject: string): string {
    if (/(enters?|arrives?|approaches?)/i.test(text)) return `${subject} enters without full control of the room`;
    if (/(phone|evidence|proof|charm|key|letter)/i.test(text)) return 'the truth is still deniable';
    return 'leverage is unresolved at the start of the beat';
  }

  private deriveStatusAfter(text: string, action: string, subject: string): string {
    if (/(leave|walks? away|retreat|back away)/i.test(text)) return `${subject} changes status by creating distance`;
    if (/(shows?|reveals?|holds? up|photo|proof|evidence|charm|key|letter)/i.test(text)) return 'the visible evidence claims leverage';
    if (/(deny|deflect|glitch|imagining)/i.test(text)) return 'control depends on whether the evasion holds';
    return `${subject}'s visible action shifts attention and leverage`;
  }

  private deriveSubtext(text: string): string {
    const lowered = text.toLowerCase();
    if (/(deflect|deny|glitch|imagining|casual|normal)/.test(lowered)) return 'the surface reassurance is a cover for fear of exposure';
    if (/(guilt|shame|violation)/.test(lowered)) return 'the character is paying an emotional cost for the choice';
    if (/(trust|love|hurt|wrong)/.test(lowered)) return 'the relationship is being tested beneath the words';
    if (/(proof|evidence|photo|phone|charm|key|letter)/.test(lowered)) return 'an object is forcing an unspoken truth into the open';
    return 'the visible behavior reveals more than the spoken topic admits';
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
    return `${subject} changes the room's leverage through a visible gesture, object cue, or shift in distance`;
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

    if (input.protagonistInfo) {
      const povResult = new PovClarityValidator().validateScene(content, {
        protagonistName: input.protagonistInfo.name,
        characterNames: [
          input.protagonistInfo.name,
          ...(input.npcs || []).map(npc => npc.name),
        ],
      });
      for (const issue of povResult.issues) {
        issues.push(`POV CLARITY - Beat "${issue.beatId}": ${issue.issue} ${issue.suggestion}`);
      }
    }

    for (const issue of auditFictionFirstTurns(content.beats || [])) {
      issues.push(`FICTION-FIRST TURN ${issue.category.toUpperCase()} - Beat "${issue.beatId}": ${issue.message} ${issue.suggestion}`);
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
    } else if (input.targetBeatCount >= 6 && input.sceneBlueprint.choicePoint && beatCount < 6) {
      issues.push(`SCENE-LENGTH UNDERFILL - This scene-length choice episode needs at least 6 beats before validation; found ${beatCount}. Expand with concrete escalation, reversal, discovery, cost, and choice residue beats.`);
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
- Preserve existing beat IDs, choice-point flags, visual contract fields, thread IDs, callback IDs, and nextBeatId navigation unless a listed issue explicitly requires splitting or relinking beats
- For POV clarity issues, rewrite only prose/textVariants needed to anchor the first non-empty beat to the player character with you/your, the protagonist's actual name, or a concrete pronoun.
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
      console.error(`[SceneWriter] Revision failed: ${errorMsg}, checking whether original content is safe to use`);

      // Check if original content has missing isChoicePoint - pipeline will apply fallback
      if (input.sceneBlueprint.choicePoint) {
        const hasChoicePoint = originalContent.beats?.some(b => b.isChoicePoint);
        if (!hasChoicePoint) {
          console.warn(`[SceneWriter] Original content missing isChoicePoint - pipeline fallback will auto-mark last beat`);
        }
      }

      try {
        this.validatePreEncounterHandoff(originalContent, input);
      } catch (originalError) {
        const originalErrorMsg = originalError instanceof Error ? originalError.message : String(originalError);
        return {
          success: false,
          error: originalErrorMsg,
        };
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
