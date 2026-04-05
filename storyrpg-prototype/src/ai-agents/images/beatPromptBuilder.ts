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
}

const BASE_NEGATIVE_PROMPT =
  'triptych, diptych, collage, montage, picture-in-picture, inset panel, overlaid cutout, ' +
  'split-screen, comic panels, image within image, composite image, floating portrait, ' +
  'text overlay, caption text, title text, speech bubbles, watermarks, signatures, ' +
  'dialog text, narrative text, sound effects, onomatopoeia, ' +
  'blurry, low quality';

const CHARACTER_NEGATIVE =
  ', stiff pose, symmetrical stance, characters frozen in place, arms at sides, ' +
  'neutral expression, mannequin pose, standing straight, centered composition';

const ESTABLISHING_NEGATIVE =
  ', character portrait, close-up face, people in foreground';

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
  const artStyle = scene.artStyle || 'dramatic cinematic story art';

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

  const promptParts: string[] = [
    artStyle,
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
    'Maintain the specified art style consistently.',
  ];

  return {
    prompt: joinPromptParts(promptParts),
    negativePrompt: BASE_NEGATIVE_PROMPT + ESTABLISHING_NEGATIVE,
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

  const coreVisual = beat.visualMoment || beat.beatText;
  const camera = analysis.suggestedCamera;
  const effectiveAction = beat.primaryAction || analysis.bodyLanguageDirectives.momentOfChange;
  const bodyLanguage = buildBodyLanguageFromAnalysis(analysis, beat.primaryAction, beat.relationshipDynamic);

  // Build a flowing narrative prompt: [CAMERA] + [SCENE] woven together,
  // following the PROMPT_ASSEMBLY_PATTERN style from visualPrinciples.ts
  // instead of dot-separated keyword fragments.
  const narrativeParts: string[] = [];

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

  // Characters woven with their emotional/physical state
  if (beat.foregroundCharacterNames?.length) {
    const charPhrase = beat.foregroundCharacterNames.length === 1
      ? beat.foregroundCharacterNames[0]
      : beat.foregroundCharacterNames.join(' and ');
    if (effectiveAction) {
      narrativeParts.push(`${charPhrase} ${effectiveAction}`);
    } else {
      narrativeParts.push(charPhrase);
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

  // Lighting serves the mood — merged with color script
  const lightingParts: string[] = [analysis.lightingSuggestion];
  if (scene.colorMood?.lighting) lightingParts.push(scene.colorMood.lighting);
  if (scene.colorMood?.temperature) lightingParts.push(`${scene.colorMood.temperature} temperature`);
  narrativeParts.push(lightingParts.filter(Boolean).join(', '));

  // Composition
  narrativeParts.push(analysis.compositionNote);
  if (scene.colorMood?.palette) {
    narrativeParts.push(`color palette: ${scene.colorMood.palette}`);
  }

  // Setting adaptation notes
  if (settingSelection.notes.length > 0) {
    narrativeParts.push(settingSelection.notes.join(', '));
  }

  if (beat.mustShowDetail) {
    narrativeParts.push(`must show: ${beat.mustShowDetail}`);
  }

  // Art style anchors the end
  narrativeParts.push(artStyle);

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
    negativePrompt: BASE_NEGATIVE_PROMPT + CHARACTER_NEGATIVE,
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

  // Panel-specific additions
  if (panelIndex !== undefined && totalPanels !== undefined) {
    const panelDirective = `Panel ${panelIndex + 1} of ${totalPanels}. ` +
      'Purely visual panel — absolutely no text of any kind except on in-world clothing or signage. ' +
      'Single continuous image, no sub-panels.';
    overridden.prompt = `${panelDirective} ${overridden.prompt}`;
    overridden.negativePrompt = (overridden.negativePrompt || '') +
      ', dialog text, narrative text, sound effects, onomatopoeia, speech bubbles';
  }

  return overridden;
}
