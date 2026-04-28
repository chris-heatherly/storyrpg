/**
 * Deterministic Beat Image Prompt Builder
 *
 * Replaces the StoryboardAgent + VisualIllustratorAgent LLM chain with a purely
 * deterministic prompt construction path, matching the encounter pipeline's
 * cinematicDescriptionToPrompt pattern.
 *
 * The creative visual direction comes from:
 * 1. CinematicBeatAnalyzer — beat classification, camera, body language templates
 * 2. Visual contract fields authored during narrative generation
 * 3. Scene setting context and color script mood
 * 4. Character descriptions and reference images
 */

import type { ImagePrompt } from '../agents/ImageGenerator';
import type { SceneSettingContext } from '../utils/styleAdaptation';
import { selectStyleAdaptation } from '../utils/styleAdaptation';
import {
  analyzeBeatCinematically,
  type CinematicAnalysis,
  type BeatType,
} from '../agents/image-team/CinematicBeatAnalyzer';
import {
  UNIVERSAL_NEGATIVE_PROMPT,
  SINGLE_FRAME_IMAGE_DIRECTIVE,
  CHARACTER_NEGATIVE_OVERLAY,
  ESTABLISHING_NEGATIVE_OVERLAY,
  composeNegativePrompt as composeNegativePromptShared,
} from './cinematicPromptCore';

export interface BeatPromptInput {
  beatId: string;
  beatText: string;
  beatIndex: number;
  totalBeats: number;

  visualMoment?: string;
  primaryAction?: string;
  emotionalRead?: string;
  relationshipDynamic?: string;
  mustShowDetail?: string;
  shotType?: 'establishing' | 'character' | 'action';

  isClimaxBeat?: boolean;
  isKeyStoryBeat?: boolean;
  isChoicePayoff?: boolean;
  choiceContext?: string;
  incomingChoiceContext?: string;
  isBranchPayoff?: boolean;

  foregroundCharacterNames?: string[];
  backgroundCharacterNames?: string[];
  /**
   * D9: Optional explicit staging for group scenes with 3+ foreground characters.
   * Maps character name -> positional descriptor (e.g. "left", "center",
   * "right", "background-left"). When omitted, we fall back to deriving
   * positions from `foregroundCharacterNames` order.
   */
  characterStaging?: Record<string, string>;
  /**
   * D4: Per-character visual state (wardrobe changes, visible injuries, held
   * props, emotional-physical tags) that should be honored in this beat. Keys
   * are character display names (matching `foregroundCharacterNames`) so the
   * prompt builder can append state clauses without re-resolving IDs.
   */
  characterVisualStates?: Record<string, CharacterVisualState>;
  /**
   * B6: Beat-specific color mood sourced from the episode color script. When
   * present, these override the scene-level palette for this beat only,
   * giving each beat its own color follow-through even when all beats share a
   * scene. Producers typically hydrate this from `ColorScriptAgent.getMoodSpecForBeat`.
   */
  colorMoodOverride?: {
    palette?: string;
    lighting?: string;
    temperature?: string;
    /** Short color-tension note, e.g. "cool-to-warm transition", "rising red". */
    transitionNote?: string;
  };
}

/**
 * D4: Mutable visual state that follows a character across beats. Writers
 * (or pipeline heuristics derived from beat text) populate this as the story
 * progresses so downstream images keep wardrobe/injuries/props continuous.
 */
export interface CharacterVisualState {
  /** Current worn outfit, e.g. "torn grey cloak over chainmail". */
  wardrobe?: string;
  /** Visible wounds or marks, e.g. ["bandaged left hand", "bruised cheek"]. */
  injuries?: string[];
  /** Items being held or carried, e.g. ["broken sword", "lantern"]. */
  heldProps?: string[];
  /** Short descriptors (e.g. "rain-soaked", "ash on face"). */
  tags?: string[];
}

export interface ScenePromptContext {
  sceneId: string;
  sceneName: string;
  genre: string;
  tone: string;
  mood?: string;
  settingContext?: SceneSettingContext;
  artStyle?: string;
  colorMood?: {
    palette?: string;
    lighting?: string;
    temperature?: string;
  };
  /**
   * C6: Style anchor strength. Controls how many times and how emphatically
   * the art style is woven into the prompt.
   *   0 — mention once, no reinforcement (use for styles where over-mention
   *       destabilizes the reference image signal);
   *   1 — standard front + end bookends (default, today's behavior);
   *   2 — front + middle reinforcement + end, with "strictly maintain" phrasing
   *       (use for highly stylized families like risograph, manga, pixel).
   * Omit to fall back to 1.
   */
  styleAnchorStrength?: 0 | 1 | 2;
  /**
   * C2: Structured art-style profile. When provided, the builder uses
   * `acceptableDeviations` to drop staging/composition negatives that
   * contradict the style (e.g. "centered composition" is not a negative for
   * minimalist/storybook), and merges `genreNegatives` into the final
   * negative prompt. Profile name is NOT emitted as the art-style string —
   * `artStyle` still wins that slot so existing consumers are unaffected.
   */
  styleProfile?: import('./artStyleProfile').ArtStyleProfile;
}

// B8: negative-prompt constants moved to `cinematicPromptCore` so the
// deterministic and LLM-agent paths share the same floor. Aliased here for
// readability in the builder body and to preserve the old local names.
const BASE_NEGATIVE_PROMPT = UNIVERSAL_NEGATIVE_PROMPT;
const CHARACTER_NEGATIVE = CHARACTER_NEGATIVE_OVERLAY;
const ESTABLISHING_NEGATIVE = ESTABLISHING_NEGATIVE_OVERLAY;

function buildChoicePayoffPrefix(
  isBranchPayoff: boolean,
  isPerChoicePayoff: boolean,
  incomingChoiceContext?: string,
  choiceContext?: string,
): string {
  if (isBranchPayoff && incomingChoiceContext) {
    return `The player chose: "${incomingChoiceContext}". Show this choice playing out: `;
  }
  if (isPerChoicePayoff && choiceContext) {
    return `The player chose: "${choiceContext}". Show this action playing out physically: `;
  }
  if (isPerChoicePayoff) {
    return 'The player chose this action. Show it playing out physically: ';
  }
  return '';
}

/**
 * B5: Choice-payoff visual language table.
 *
 * Maps choice-text intent keywords to a compact visual-grammar hint that we
 * append to the prompt. The goal is to make the *kind* of choice readable at
 * a glance — a "fight" payoff should read differently from a "persuade"
 * payoff, even if both land on the same beat template. When no category
 * matches we return empty string and the prompt stays untouched.
 */
interface ChoicePayoffVisualRule {
  keywords: RegExp;
  label: string;
  visualLanguage: string;
}

const CHOICE_PAYOFF_VISUAL_RULES: ChoicePayoffVisualRule[] = [
  {
    keywords: /\b(attack|strike|fight|swing|slash|stab|punch|charge|kill)\b/i,
    label: 'violent',
    visualLanguage:
      'Aggressive forward motion, weapon or fist at apex of strike, impact tension in shoulders and jaw.',
  },
  {
    keywords: /\b(defend|parry|block|brace|shield|guard)\b/i,
    label: 'defensive',
    visualLanguage:
      'Braced stance, weight back, arms raised protectively, eyes locked on threat.',
  },
  {
    keywords: /\b(sneak|slip|hide|creep|vanish|conceal|steal)\b/i,
    label: 'stealthy',
    visualLanguage:
      'Low crouched profile, shoulders hunched, partial silhouette against the environment, weight on the ball of the foot.',
  },
  {
    keywords: /\b(flee|run|escape|bolt|retreat|fall back)\b/i,
    label: 'flight',
    visualLanguage:
      'Mid-stride motion blur, body leaning forward, over-the-shoulder glance back, coat or hair trailing from velocity.',
  },
  {
    keywords: /\b(persuade|convince|charm|flatter|sweet[- ]talk|bargain|negotiate)\b/i,
    label: 'diplomatic',
    visualLanguage:
      'Open palm gesture, warm eye contact, body angled toward the other, relaxed but intent shoulders.',
  },
  {
    keywords: /\b(threaten|intimidate|menace|loom|warn)\b/i,
    label: 'intimidation',
    visualLanguage:
      'Full-height forward lean, weight shifted into the other\'s space, jaw set, hands visible and deliberate.',
  },
  {
    keywords: /\b(lie|deceive|bluff|mislead|pretend|fake)\b/i,
    label: 'deception',
    visualLanguage:
      'Micro-tell in the eyes or hands while face performs calm, slight asymmetry between what the mouth and the eyes say.',
  },
  {
    keywords: /\b(investigate|examine|study|search|inspect|read)\b/i,
    label: 'investigation',
    visualLanguage:
      'Close focus on the object or clue, low-light specular highlight, the character mid-thought with tightened brow.',
  },
  {
    keywords: /\b(comfort|console|reassure|embrace|support|hold)\b/i,
    label: 'tender',
    visualLanguage:
      'Gentle contact — hand on arm or shoulder, soft eye contact, weight leaning in, shoulders lowered.',
  },
  {
    keywords: /\b(refuse|reject|turn away|walk out|abandon|quit)\b/i,
    label: 'refusal',
    visualLanguage:
      'Body turned partially away, hand raised in a soft cut-off gesture, eyes cast off-frame from the other character.',
  },
  {
    keywords: /\b(help|rescue|save|protect|shield)\b/i,
    label: 'protective',
    visualLanguage:
      'Character inserting themselves between threat and ally, arm extended outward, legs braced.',
  },
  {
    keywords: /\b(betray|double[- ]cross|backstab|turn on)\b/i,
    label: 'betrayal',
    visualLanguage:
      'Friendly gesture in the foreground while the hidden hand holds a weapon or concealed item behind the back.',
  },
];

export function inferChoicePayoffVisualLanguage(choiceText: string | undefined): {
  label: string;
  visualLanguage: string;
} | null {
  if (!choiceText) return null;
  for (const rule of CHOICE_PAYOFF_VISUAL_RULES) {
    if (rule.keywords.test(choiceText)) {
      return { label: rule.label, visualLanguage: rule.visualLanguage };
    }
  }
  return null;
}

function synthesizeExpressionFromEmotion(emotionalRead: string): string {
  const text = emotionalRead.toLowerCase();
  if (/anger|fury|rage|hostile/.test(text)) {
    return 'Clenched jaw, narrowed eyes, nostrils flared, brow heavily furrowed';
  }
  if (/fear|terror|dread|panic/.test(text)) {
    return 'Wide eyes, raised eyebrows, parted lips, face drawn back';
  }
  if (/sadness|grief|sorrow|loss/.test(text)) {
    return 'Downcast eyes, trembling lower lip, brow knitted upward';
  }
  if (/joy|delight|relief|triumph/.test(text)) {
    return 'Bright eyes, upturned mouth, lifted cheeks, relaxed brow';
  }
  if (/shock|surprise|disbelief/.test(text)) {
    return 'Wide eyes, mouth agape, raised eyebrows, frozen posture';
  }
  if (/disgust|revulsion|contempt/.test(text)) {
    return 'Curled upper lip, narrowed eyes, nose wrinkled, head tilted back slightly';
  }
  if (/suspicion|distrust|wariness/.test(text)) {
    return 'Narrowed eyes, one eyebrow slightly raised, lips pressed thin, chin lowered';
  }
  if (/love|tenderness|affection|warmth/.test(text)) {
    return 'Soft eyes, gentle smile, relaxed face, slight head tilt toward the other';
  }
  if (/determination|resolve|defiance/.test(text)) {
    return 'Set jaw, steely gaze, lips pressed firmly, chin raised';
  }
  return `Facial expression showing: ${emotionalRead}. Clear emotion through facial anatomy — never neutral or blank.`;
}

function buildBodyLanguageFromAnalysis(
  analysis: CinematicAnalysis,
  primaryAction?: string,
  relationshipDynamic?: string,
): string {
  const parts: string[] = [];
  const directives = analysis.bodyLanguageDirectives;

  if (primaryAction) {
    parts.push(primaryAction);
  }
  if (directives.momentOfChange) {
    parts.push(directives.momentOfChange);
  }
  if (directives.asymmetry && directives.asymmetry !== 'N/A for single character') {
    parts.push(directives.asymmetry);
  }
  if (directives.environmentInteraction) {
    parts.push(directives.environmentInteraction);
  }
  if (relationshipDynamic) {
    parts.push(relationshipDynamic);
  }
  if (directives.spatialRelationship) {
    parts.push(directives.spatialRelationship);
  }

  return parts.filter(Boolean).join('. ');
}

/**
 * Build a deterministic ImagePrompt for a story beat.
 *
 * Uses CinematicBeatAnalyzer for film-grammar direction and combines it
 * with visual contract fields from narrative generation and scene context.
 */
export function buildBeatImagePrompt(
  beat: BeatPromptInput,
  scene: ScenePromptContext,
): ImagePrompt {
  const isEstablishing = beat.shotType === 'establishing';
  const analysis = analyzeBeatCinematically(
    beat.beatText,
    beat.emotionalRead,
    beat.relationshipDynamic,
  );
  const settingSelection = selectStyleAdaptation(scene.artStyle, scene.settingContext);
  const userStyleProvided = typeof scene.artStyle === 'string' && scene.artStyle.trim().length > 0;
  const artStyle = userStyleProvided ? (scene.artStyle as string) : 'dramatic cinematic story art';
  const styleSource = userStyleProvided ? 'user' : 'default';

  console.log(
    `[beatPromptBuilder] artStyle for beat "${beat.beatId}" (shotType=${beat.shotType || 'character'}): "${artStyle}" (source: ${styleSource})`,
  );

  if (isEstablishing) {
    return buildEstablishingPrompt(beat, scene, analysis, settingSelection, artStyle);
  }

  return buildCharacterPrompt(beat, scene, analysis, settingSelection, artStyle);
}

function buildEstablishingPrompt(
  beat: BeatPromptInput,
  scene: ScenePromptContext,
  analysis: CinematicAnalysis,
  settingSelection: { notes: string[]; branchLabel: string },
  artStyle: string,
): ImagePrompt {
  const coreVisual = beat.visualMoment || beat.beatText;
  const styleStrength: 0 | 1 | 2 = scene.styleAnchorStrength ?? 1;

  const promptParts: string[] = [
    styleStrength === 2 ? `Art style (strict): ${artStyle}` : `Art style: ${artStyle}`,
    SINGLE_FRAME_IMAGE_DIRECTIVE,
    'wide establishing shot',
    coreVisual,
    `Scene: ${scene.sceneName}`,
    analysis.lightingSuggestion,
    analysis.compositionNote,
    ...settingSelection.notes,
    scene.colorMood?.palette ? `Color palette: ${scene.colorMood.palette}` : '',
    scene.colorMood?.lighting ? `Lighting: ${scene.colorMood.lighting}` : '',
    beat.mustShowDetail ? `Must include: ${beat.mustShowDetail}` : '',
    'No characters in foreground. Show the environment, atmosphere, and sense of place.',
    styleStrength === 2
      ? `Strictly maintain art style: ${artStyle}. Do not introduce other aesthetics.`
      : styleStrength === 1
        ? `Maintain art style: ${artStyle}`
        : '',
  ];

  return {
    prompt: joinPromptParts(promptParts),
    negativePrompt: composeNegativePrompt(
      BASE_NEGATIVE_PROMPT + ESTABLISHING_NEGATIVE,
      scene.styleProfile,
      'establishing',
    ),
    style: artStyle,
    aspectRatio: '9:19.5',
    composition: `Establishing wide shot. Scene: ${scene.sceneName}. Genre: ${scene.genre}, Tone: ${scene.tone}`,
    visualNarrative: coreVisual,
    beatType: analysis.beatType,
    settingAdaptationNotes: settingSelection.notes,
    settingBranchLabel: settingSelection.branchLabel,
    settingContext: scene.settingContext,
  };
}

function buildCharacterPrompt(
  beat: BeatPromptInput,
  scene: ScenePromptContext,
  analysis: CinematicAnalysis,
  settingSelection: { notes: string[]; branchLabel: string },
  artStyle: string,
): ImagePrompt {
  const choicePrefix = buildChoicePayoffPrefix(
    beat.isBranchPayoff === true,
    beat.isChoicePayoff === true,
    beat.incomingChoiceContext,
    beat.choiceContext,
  );
  // B5: derive a compact visual-language hint from the incoming choice text
  // so the rendered payoff reads like the KIND of action the player took
  // (violent / stealthy / diplomatic / etc.), not just a generic payoff.
  const choiceVisualRule = beat.isBranchPayoff || beat.isChoicePayoff
    ? inferChoicePayoffVisualLanguage(beat.incomingChoiceContext || beat.choiceContext)
    : null;

  const coreVisual = beat.visualMoment || beat.beatText;
  const camera = analysis.suggestedCamera;
  const effectiveAction = beat.primaryAction || analysis.bodyLanguageDirectives.momentOfChange;
  const bodyLanguage = buildBodyLanguageFromAnalysis(analysis, beat.primaryAction, beat.relationshipDynamic);

  // Build a flowing narrative prompt: [STYLE] + [CAMERA] + [SCENE] woven together,
  // following the PROMPT_ASSEMBLY_PATTERN style from visualPrinciples.ts
  // instead of dot-separated keyword fragments.
  const narrativeParts: string[] = [];

  // Art style anchors the FRONT of the prompt for strongest positional weight
  // (mirrors the establishing-prompt path and the direct Gemini prompt in
  // imageGenerationService.buildGeminiDirectPrompt). Tokens early in the
  // prompt carry more weight for Gemini; placing style at the end made it
  // easy for the model's own aesthetic bias to override the user's choice.
  // C6: For heavy anchor strength, promote to "strictly" language.
  const styleStrength: 0 | 1 | 2 = scene.styleAnchorStrength ?? 1;
  narrativeParts.push(
    styleStrength === 2 ? `Art style (strict): ${artStyle}` : `Art style: ${artStyle}`
  );
  narrativeParts.push(SINGLE_FRAME_IMAGE_DIRECTIVE);

  // Camera + angle opens the frame
  const cameraOpener = camera.movement !== 'Static'
    ? `${camera.shotType}, ${camera.angle}, ${camera.movement}`
    : `${camera.shotType}, ${camera.angle}`;
  narrativeParts.push(cameraOpener);

  // Choice context leads into the visual moment
  if (choicePrefix) {
    narrativeParts.push(choicePrefix + coreVisual);
  } else {
    narrativeParts.push(coreVisual);
  }
  // B5: append the choice-kind visual language as its own clause so the
  // model renders the right physical vocabulary (combat vs. diplomacy etc.).
  if (choiceVisualRule) {
    narrativeParts.push(
      `Choice kind (${choiceVisualRule.label}): ${choiceVisualRule.visualLanguage}`
    );
  }

  // Characters woven with their emotional/physical state
  if (beat.foregroundCharacterNames?.length) {
    const charPhrase = beat.foregroundCharacterNames.length === 1
      ? beat.foregroundCharacterNames[0]
      : beat.foregroundCharacterNames.join(' and ');
    const visibleNames = [
      ...beat.foregroundCharacterNames,
      ...(beat.backgroundCharacterNames || []),
    ];
    narrativeParts.push(`Visible shot cast: ${visibleNames.join(', ')} only. Do not add other scene-present characters.`);
    if (effectiveAction) {
      narrativeParts.push(`${charPhrase} ${effectiveAction}`);
    } else {
      narrativeParts.push(charPhrase);
    }

    // D9: For 3+ foreground characters, append an explicit staging clause so
    // the model doesn't swap/duplicate characters in group compositions.
    const staging = buildGroupStagingClause(beat.foregroundCharacterNames, beat.characterStaging);
    if (staging) {
      narrativeParts.push(staging);
    }

    // D4: Append per-character visual state so wardrobe/injuries/props carry
    // across beats. Silently skipped when no state is registered.
    const stateClause = buildCharacterStateClause(
      beat.foregroundCharacterNames,
      beat.characterVisualStates,
    );
    if (stateClause) {
      narrativeParts.push(stateClause);
    }
  } else if (effectiveAction) {
    narrativeParts.push(effectiveAction);
  }

  if (beat.backgroundCharacterNames?.length) {
    narrativeParts.push(`${beat.backgroundCharacterNames.join(', ')} visible in the background`);
  }

  // Body language and spatial relationship
  if (bodyLanguage) {
    narrativeParts.push(bodyLanguage);
  }

  // Lighting serves the mood — merged with color script.
  // B6: prefer beat-level color override when available, falling back to the
  // scene's overall color mood for continuity.
  const effectiveColorMood = {
    palette: beat.colorMoodOverride?.palette ?? scene.colorMood?.palette,
    lighting: beat.colorMoodOverride?.lighting ?? scene.colorMood?.lighting,
    temperature: beat.colorMoodOverride?.temperature ?? scene.colorMood?.temperature,
  };
  const lightingParts: string[] = [analysis.lightingSuggestion];
  if (effectiveColorMood.lighting) lightingParts.push(effectiveColorMood.lighting);
  if (effectiveColorMood.temperature) lightingParts.push(`${effectiveColorMood.temperature} temperature`);
  narrativeParts.push(lightingParts.filter(Boolean).join(', '));

  // Composition
  narrativeParts.push(analysis.compositionNote);
  if (effectiveColorMood.palette) {
    narrativeParts.push(`color palette: ${effectiveColorMood.palette}`);
  }
  // B6: color transition note calls out the shift between beats so the model
  // renders a palette that visually tracks the emotional arc.
  if (beat.colorMoodOverride?.transitionNote) {
    narrativeParts.push(`color progression: ${beat.colorMoodOverride.transitionNote}`);
  }

  // Setting adaptation notes
  if (settingSelection.notes.length > 0) {
    narrativeParts.push(settingSelection.notes.join(', '));
  }

  if (beat.mustShowDetail) {
    narrativeParts.push(`must show: ${beat.mustShowDetail}`);
  }

  // Repeat the art style as a closing anchor to reinforce it after all the
  // narrative/camera/lighting text. Leading + trailing style = bracketed
  // emphasis, the same pattern used by the direct Gemini prompt builder.
  // C6: anchor strength 0 omits the closing reinforcement; 2 adds a
  // mid-prompt "Style reminder" before the closing anchor for extra weight.
  if (styleStrength === 2) {
    narrativeParts.push(`Style reminder: ${artStyle}`);
  }
  if (styleStrength >= 1) {
    narrativeParts.push(
      styleStrength === 2
        ? `Strictly maintain art style: ${artStyle}. Do not introduce other aesthetics.`
        : `Maintain art style: ${artStyle}`
    );
  }

  const keyExpression = beat.emotionalRead
    ? synthesizeExpressionFromEmotion(beat.emotionalRead)
    : analysis.beatType !== 'transition'
      ? `Expression matching ${analysis.beatType} — clear emotion through facial anatomy, never neutral or blank.`
      : undefined;

  const visualNarrative = beat.isBranchPayoff && beat.incomingChoiceContext
    ? `${beat.incomingChoiceContext} — ${coreVisual}`
    : coreVisual;

  // Composition field now carries beat-aware intent instead of just metadata
  const compositionIntent = buildCompositionIntent(analysis, scene, beat);

  return {
    prompt: joinPromptParts(narrativeParts),
    negativePrompt: composeNegativePrompt(
      BASE_NEGATIVE_PROMPT + CHARACTER_NEGATIVE,
      scene.styleProfile,
      'character',
    ),
    style: artStyle,
    aspectRatio: '9:19.5',
    composition: compositionIntent,
    cameraAngle: `${camera.shotType}, ${camera.angle}`,
    shotDescription: `${camera.shotType}, ${camera.angle}${camera.movement !== 'Static' ? `, ${camera.movement}` : ''}`,
    keyExpression,
    keyGesture: effectiveAction
      ? `Hands actively engaged: ${effectiveAction}.`
      : undefined,
    keyBodyLanguage: bodyLanguage || undefined,
    poseSpec: effectiveAction
      ? `Mid-action pose showing: ${effectiveAction}. Clear weight distribution, asymmetric stance.`
      : undefined,
    emotionalCore: beat.emotionalRead || undefined,
    visualNarrative,
    beatType: analysis.beatType,
    settingAdaptationNotes: settingSelection.notes,
    settingBranchLabel: settingSelection.branchLabel,
    settingContext: scene.settingContext,
  };
}

/**
 * Build a composition-intent string that carries actual visual direction
 * instead of just scene metadata.
 */
function buildCompositionIntent(
  analysis: CinematicAnalysis,
  scene: ScenePromptContext,
  beat: BeatPromptInput,
): string {
  const parts: string[] = [];

  // Start with the analyzer's composition note (e.g., "Aggressor larger in frame through position")
  if (analysis.compositionNote) {
    parts.push(analysis.compositionNote);
  }

  // Add focal-point guidance based on beat type
  const focalGuide = getFocalPointForBeat(analysis.beatType, beat);
  if (focalGuide) {
    parts.push(focalGuide);
  }

  // Scene context for genre/tone awareness
  parts.push(`${scene.genre}, ${scene.tone}`);

  if (beat.mustShowDetail) {
    parts.push(`Must show: ${beat.mustShowDetail}`);
  }

  return parts.filter(Boolean).join('. ');
}

function getFocalPointForBeat(beatType: BeatType, beat: BeatPromptInput): string {
  const hasTwoChars = (beat.foregroundCharacterNames?.length || 0) >= 2;
  switch (beatType) {
    case 'confrontation':
      return hasTwoChars
        ? 'Focal point on the charged space between the two characters'
        : 'Focal point on the confronting character\'s hands and expression';
    case 'revelation':
    case 'realization':
      return 'Focal point on the face of the one reacting — highest detail on eyes and expression';
    case 'intimacy':
      return hasTwoChars
        ? 'Focal point on the point of connection — touching hands, close faces, shared space'
        : 'Focal point on the tender gesture or expression';
    case 'action':
      return 'Focal point on the peak of action — point of impact, apex of leap, moment of contact';
    case 'decision':
      return 'Focal point on the character\'s face and hands, caught between options';
    case 'betrayal':
      return 'Focal point on both faces — the mask slipping and the trust shattering';
    case 'triumph':
      return 'Focal point on the rising figure — body expanding, light catching the moment';
    case 'defeat':
      return 'Focal point on the collapsing figure — weight surrendering, emptiness surrounding';
    case 'departure':
      return 'Focal point on the growing negative space between the two figures';
    case 'reunion':
      return 'Focal point on the moment of contact — arms reaching, bodies converging';
    default:
      return '';
  }
}

/**
 * D9: Build an explicit left/center/right staging clause for group scenes.
 * Returns empty string for 1-2 character beats (staging is implicit there).
 * Honors `characterStaging` overrides when provided; otherwise derives
 * positions deterministically from `foregroundCharacterNames` order.
 */
function buildGroupStagingClause(
  names: string[],
  staging?: Record<string, string>,
): string {
  if (names.length < 3) return '';

  const positionFor = (index: number, total: number): string => {
    if (total <= 3) return ['left', 'center', 'right'][index] || 'background';
    if (index === 0) return 'far left';
    if (index === total - 1) return 'far right';
    if (index === Math.floor((total - 1) / 2)) return 'center';
    return index < total / 2 ? 'left of center' : 'right of center';
  };

  const assignments: string[] = [];
  for (let i = 0; i < names.length; i++) {
    const name = names[i];
    const override = staging?.[name];
    const pos = override || positionFor(i, names.length);
    assignments.push(`${name} ${pos}`);
  }

  return `Staging: ${assignments.join(', ')}. Each character clearly distinguishable, no duplication or swapped identities.`;
}

/**
 * D4: Flatten a per-character visual-state map into a compact clause like
 * "Alice in torn grey cloak, bandaged left hand; Bob holding broken sword".
 * Returns empty string when no foreground character has any state recorded.
 */
function buildCharacterStateClause(
  names: string[],
  states?: Record<string, CharacterVisualState>,
): string {
  if (!states) return '';
  const clauses: string[] = [];
  for (const name of names) {
    const state = states[name];
    if (!state) continue;
    const parts: string[] = [];
    if (state.wardrobe) parts.push(`in ${state.wardrobe}`);
    if (state.injuries && state.injuries.length > 0) parts.push(state.injuries.join(', '));
    if (state.heldProps && state.heldProps.length > 0) {
      parts.push(`holding ${state.heldProps.join(' and ')}`);
    }
    if (state.tags && state.tags.length > 0) parts.push(state.tags.join(', '));
    if (parts.length > 0) {
      clauses.push(`${name} ${parts.join(', ')}`);
    }
  }
  return clauses.length > 0
    ? `Current visual state: ${clauses.join('; ')}.`
    : '';
}

function joinPromptParts(parts: string[]): string {
  return parts
    .filter(p => p && p.trim().length > 0)
    .join('. ')
    .replace(/\.\./g, '.')
    .replace(/\s+/g, ' ')
    .trim();
}

// ============================================
// SHOT PLAN OVERRIDE (used by pipeline)
// ============================================

const SHOT_TYPE_LABELS: Record<string, string> = {
  ELS: 'extreme long shot',
  LS: 'long shot',
  MLS: 'medium long shot',
  MS: 'medium shot',
  MCU: 'medium close-up',
  CU: 'close-up',
  ECU: 'extreme close-up',
};

export function overrideShotFromPlan(
  prompt: ImagePrompt,
  plannedShotType: string,
  plannedAngle: string,
  panelIndex?: number,
  totalPanels?: number,
): ImagePrompt {
  const shotLabel = SHOT_TYPE_LABELS[plannedShotType] || plannedShotType;
  const newCamera = `${shotLabel}, ${plannedAngle}`;

  const overridden: ImagePrompt = {
    ...prompt,
    shotDescription: newCamera,
    cameraAngle: newCamera,
  };

  // Replace shot type reference in the composition field
  if (overridden.composition) {
    overridden.composition = overridden.composition
      .replace(/\b(extreme long|long|medium long|medium|close-up|extreme close-up) shot\b/i, `${shotLabel}`)
      + `. Camera: ${newCamera}`;
  }

  // Panel-specific additions: preserve the narrative illustration style while
  // noting this is part of a sequential series from the same story moment.
  if (panelIndex !== undefined && totalPanels !== undefined) {
    const panelDirective = `Image ${panelIndex + 1} of ${totalPanels} in a sequential story illustration series. ` +
      'Maintain the SAME art style, color palette, and character rendering as the other images in this series. ' +
      'Single continuous image, no sub-panels or text overlays.';
    overridden.prompt = `${panelDirective} ${overridden.prompt}`;
    overridden.negativePrompt = (overridden.negativePrompt || '') +
      ', dialog text, narrative text, sound effects, onomatopoeia, speech bubbles';
  }

  return overridden;
}

// B8: `composeNegativePrompt` now lives in `cinematicPromptCore` so the
// deterministic path and the LLM-based illustrator path share one source
// of truth for style-aware negative-prompt assembly. Re-exported locally
// as an alias so existing call sites in this file don't need to change.
const composeNegativePrompt = composeNegativePromptShared;
