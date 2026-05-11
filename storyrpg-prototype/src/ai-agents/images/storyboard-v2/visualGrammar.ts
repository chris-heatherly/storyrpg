import type { StoryboardPanelSlot } from './storyboardCompiler';

export type VisualShotDistance = 'ELS' | 'LS' | 'MLS' | 'MS' | 'MCU' | 'CU' | 'ECU';
export type VisualCameraAngle = 'eye-level' | 'low' | 'high' | 'overhead' | 'dutch' | 'worm-eye';
export type VisualHorizontalAngle = 'front' | 'three-quarter' | 'profile' | 'over-shoulder';
export type VisualStaging = 'environment' | 'single' | 'two-shot' | 'ots-speaker' | 'ots-listener' | 'triangle' | 'ensemble' | 'insert' | 'reaction' | 'aftermath';
export type VisualTransition = 'establishing' | 'action-to-action' | 'subject-to-subject' | 'moment-to-moment' | 'aspect-to-aspect' | 'punctuation' | 'release';

export interface VisualGrammarDirective {
  shotDistance: VisualShotDistance;
  cameraAngle: VisualCameraAngle;
  horizontalAngle: VisualHorizontalAngle;
  staging: VisualStaging;
  composition: string;
  importanceScale: string;
  lighting: string;
  colorRole: {
    rule: '60:30:10';
    base: string;
    support: string;
    accent: string;
    constraint: string;
  };
  transition: VisualTransition;
}

export interface VisualGrammarContext {
  panel: StoryboardPanelSlot;
  previousPanel?: StoryboardPanelSlot;
  previousDirective?: VisualGrammarDirective;
  nextPanel?: StoryboardPanelSlot;
  rawArtStyle: string;
  sceneMood?: string;
  index: number;
  panelCount: number;
}

const REVELATION_RE = /\b(reveal|reveals|truth|realiz|recogniz|confess|betray|discover|understand|impossible|secret|shock|stunned|frozen|eyes?|divine|choice|decides?|decision)\b/i;
const DEFEAT_RE = /\b(defeat|collapse|ashamed|guilt|failure|overwhelm|cornered|trapped|lost|wound|cry|despair|vulnerable|judged|broken)\b/i;
const POWER_RE = /\b(triumph|victory|dominant|command|defy|power|divine|god|hero|stands over|blaze|awe|intimidat|throne|crown)\b/i;
const ACTION_RE = /\b(run|fight|strike|catch|fall|plummet|rush|grab|push|pull|chase|escape|leap|break|shatter|impact|motion|attack|block|throw)\b/i;
const OBJECT_RE = /\b(hand|hands|eye|eyes|key|letter|note|phone|ring|glass|photo|watch|weapon|knife|gun|object|clue|evidence|detail|air conditioner|door|lock|blood|mark)\b/i;
const SCALE_RE = /\b(city|crowd|sky|building|mountain|temple|palace|world|landscape|horizon|street|sidewalk|environment|empty|alone|distance|scale|isolation|geography)\b/i;
const DREAD_RE = /\b(dread|wrong|unease|unstable|uncanny|terror|fear|threat|danger|ominous|panic|horror)\b/i;
const DIALOGUE_RE = /\b(says?|asks?|answers?|whispers?|shouts?|argues?|speaks?|tells?|confesses?|admits?|replies?)\b/i;
const AFTERMATH_RE = /\b(aftermath|release|relief|quiet|breath|after|cost|consequence|taking stock|settles?|remains?|silence)\b/i;
const TACTICAL_RE = /\b(tactical|layout|map|pattern|above|fate|trap|formation|route|maze)\b/i;
const PEAK_SCALE_RE = /\b(monument|tower|god|divine|massive|colossal|titan|olymp|giant)\b/i;
const CONFLICT_RE = /\b(opposition|confront|challenge|accuse|argue|between|versus|against|conflict|distance)\b/i;
const INTIMATE_RE = /\b(intimate|private|tender|soft|close|confess|whisper|grief|love|mercy)\b/i;

const BLOCKED_STYLE_TERMS = [
  /\bphotoreal(?:istic)?\b/gi,
  /\bcinematic\b/gi,
  /\bDSLR\b/gi,
  /\blens(?:es)?\b/gi,
  /\bfilm still\b/gi,
  /\bnoir\b/gi,
  /\borange and teal\b/gi,
  /\b(?:Kubrick|Spielberg|Hitchcock|Nolan|Fincher|Ghibli|Pixar|Disney|Marvel|DC)\b/gi,
  /\b(?:oil painting|watercolor|3D render|Unreal|Octane|raytraced|photography|anime|manga)\b/gi,
];

function panelText(panel: StoryboardPanelSlot, sceneMood?: string): string {
  return [
    panel.label,
    panel.narrativeText,
    panel.speaker,
    panel.mood,
    sceneMood,
    panel.visualMoment,
    panel.primaryAction,
    panel.emotionalRead,
    panel.mustShowDetail,
    panel.relationshipDynamic,
    panel.visibleCost,
    panel.storyboardRole,
    panel.visualNarrative,
    panel.outcomeName,
    panel.outcomeTier,
  ].filter(Boolean).join(' ');
}

function contains(text: string, pattern: RegExp): boolean {
  return pattern.test(text);
}

function hasStylePermission(rawArtStyle: string, pattern: RegExp): boolean {
  const probe = new RegExp(pattern.source, pattern.flags.replace('g', ''));
  return probe.test(rawArtStyle);
}

function clampNoConsecutiveDutch(angle: VisualCameraAngle, previous?: VisualGrammarDirective): VisualCameraAngle {
  return angle === 'dutch' && previous?.cameraAngle === 'dutch' ? 'eye-level' : angle;
}

function distanceStep(distance: VisualShotDistance, direction: -1 | 1): VisualShotDistance {
  const order: VisualShotDistance[] = ['ELS', 'LS', 'MLS', 'MS', 'MCU', 'CU', 'ECU'];
  const index = order.indexOf(distance);
  return order[Math.max(0, Math.min(order.length - 1, index + direction))];
}

function avoidAdjacentRepeat(
  directive: VisualGrammarDirective,
  previous?: VisualGrammarDirective,
): VisualGrammarDirective {
  if (!previous) return directive;
  const repeats = previous.shotDistance === directive.shotDistance
    && previous.cameraAngle === directive.cameraAngle
    && previous.staging === directive.staging;
  if (!repeats) return directive;
  const shouldWiden = directive.shotDistance === 'CU' || directive.shotDistance === 'ECU' || directive.staging === 'aftermath';
  return {
    ...directive,
    shotDistance: distanceStep(directive.shotDistance, shouldWiden ? -1 : 1),
  };
}

function stagingFor(text: string, visibleCount: number, panel: StoryboardPanelSlot, index: number): VisualStaging {
  if (contains(text, AFTERMATH_RE) || panel.family === 'storylet-aftermath') return 'aftermath';
  if (contains(text, OBJECT_RE) && (panel.mustShowDetail || (visibleCount <= 1 && !contains(text, REVELATION_RE)))) return 'insert';
  if (visibleCount >= 4) return 'ensemble';
  if (visibleCount === 3) return 'triangle';
  if (visibleCount === 2 && (panel.speaker || contains(text, DIALOGUE_RE))) return index % 2 === 0 ? 'ots-speaker' : 'ots-listener';
  if (visibleCount === 2) return 'two-shot';
  if (visibleCount === 1 && (contains(text, REVELATION_RE) || contains(text, DEFEAT_RE) || panel.emotionalRead)) return 'reaction';
  if (visibleCount === 1) return 'single';
  return 'environment';
}

function shotDistanceFor(text: string, staging: VisualStaging, previous?: VisualGrammarDirective): VisualShotDistance {
  if (staging === 'environment') return contains(text, SCALE_RE) ? 'ELS' : 'LS';
  if (staging === 'insert') return contains(text, /\b(eyes?|hands?|finger|ring|key|clue|evidence|blood|mark)\b/i) && previous?.shotDistance !== 'ECU' ? 'ECU' : 'CU';
  if (contains(text, REVELATION_RE) || staging === 'reaction') return contains(text, /\b(eyes?|hands?|ring|key|clue|evidence)\b/i) && previous?.shotDistance !== 'ECU' ? 'ECU' : 'CU';
  if (contains(text, ACTION_RE)) return contains(text, /\b(impact|hit|blood|mark|detail)\b/i) ? 'CU' : 'MS';
  if (contains(text, DIALOGUE_RE)) return previous?.shotDistance === 'MS' ? 'MCU' : 'MS';
  if (staging === 'aftermath') return previous?.shotDistance === 'CU' || previous?.shotDistance === 'ECU' ? 'MS' : 'MLS';
  if (staging === 'two-shot' || staging === 'ots-speaker' || staging === 'ots-listener' || staging === 'triangle') return 'MS';
  return 'MLS';
}

function cameraAngleFor(text: string, previous?: VisualGrammarDirective): VisualCameraAngle {
  if (contains(text, DEFEAT_RE)) return 'high';
  if (contains(text, POWER_RE)) return contains(text, PEAK_SCALE_RE) ? 'worm-eye' : 'low';
  if (contains(text, TACTICAL_RE)) return 'overhead';
  if (contains(text, DREAD_RE)) return clampNoConsecutiveDutch('dutch', previous);
  return 'eye-level';
}

function horizontalAngleFor(text: string, staging: VisualStaging): VisualHorizontalAngle {
  if (staging === 'ots-speaker' || staging === 'ots-listener') return 'over-shoulder';
  if (contains(text, /\b(confess|challenge|accuse|declare|admits?|fronts?)\b/i)) return 'front';
  if (contains(text, CONFLICT_RE) || contains(text, /\b(contemplat|opposes?|profile)\b/i)) return 'profile';
  return 'three-quarter';
}

function transitionFor(text: string, staging: VisualStaging, context: VisualGrammarContext): VisualTransition {
  if (context.index === 0) return 'establishing';
  if (staging === 'environment') return 'aspect-to-aspect';
  if (staging === 'aftermath') return 'release';
  if (contains(text, REVELATION_RE) || contains(text, DREAD_RE)) return 'punctuation';
  if (contains(text, ACTION_RE)) return 'action-to-action';
  if (contains(text, DIALOGUE_RE) && context.previousPanel?.visibleCharacterIds.join('|') !== context.panel.visibleCharacterIds.join('|')) return 'subject-to-subject';
  return 'moment-to-moment';
}

function compositionFor(text: string, staging: VisualStaging): string {
  if (staging === 'environment') return 'environment carries scale or isolation; keep the story subject readable in the upper two-thirds';
  if (staging === 'insert') return 'key object or gesture dominates, with enough character context to preserve emotional meaning';
  if (staging === 'two-shot' || staging === 'ots-speaker' || staging === 'ots-listener' || staging === 'triangle') return 'shared frame uses eyelines, distance, and height to show power balance with rule-of-thirds placement';
  if (staging === 'reaction') return 'face and body expression dominate, with hands and focal action kept in the upper two-thirds';
  if (contains(text, CONFLICT_RE)) return 'negative space and opposing eyelines clarify pressure, desire, or threat';
  return 'primary subject sits on rule-of-thirds with foreground, midground, background depth and one clear eye path';
}

function importanceScaleFor(text: string, staging: VisualStaging): string {
  if (staging === 'insert') return 'story-critical object or gesture has the largest visual weight; decoration stays secondary';
  if (staging === 'environment') return 'environment dominates because scale, isolation, geography, or world threat is the story point';
  if (staging === 'two-shot' || staging === 'ots-speaker' || staging === 'ots-listener' || staging === 'triangle') return 'relationship geometry dominates; character size and position reflect current power balance';
  if (staging === 'reaction' || contains(text, REVELATION_RE) || contains(text, DEFEAT_RE)) return 'face and body expression carry the largest visual weight';
  if (contains(text, ACTION_RE)) return 'the action contact point has the largest visual weight';
  return 'primary story subject is largest; decorative props, extras, and scenery remain secondary';
}

function lightingFor(text: string): string {
  if (contains(text, /\b(divine|god|magic|glow|miracle|ritual)\b/i)) return 'motivated in-style glow from the story source; lighting remains a variation inside master art style';
  if (contains(text, /\b(window|lamp|room|inside|kitchen|hall|bedroom|office|shop|cafe)\b/i)) return 'motivated in-style window or practical-lamp emphasis; lighting remains a variation inside master art style';
  if (contains(text, /\b(night|moon|neon|screen|street|alley)\b/i)) return 'motivated in-style night or practical-source emphasis; lighting remains a variation inside master art style';
  if (contains(text, DREAD_RE)) return 'motivated in-style side or back emphasis with compatible contrast; lighting remains a variation inside master art style';
  if (contains(text, INTIMATE_RE)) return 'motivated in-style soft practical or window emphasis; lighting remains a variation inside master art style';
  return 'motivated scene-source emphasis compatible with the established style-lock; lighting remains a variation inside master art style';
}

function accentFor(text: string, staging: VisualStaging): string {
  if (staging === 'insert') return '10% accent on the key object, clue, hand, or gesture inside the established palette';
  if (contains(text, /\b(divine|magic|glow|danger|blood|warning|fire|spark|eye|eyes)\b/i)) return '10% accent on the focal story signal inside recurring motif colors';
  if (contains(text, REVELATION_RE)) return '10% accent on the realization point, eye path, or revealed detail inside the established palette';
  return '10% accent on the focal action or emotional beat inside recurring motif colors';
}

export function sanitizeVisualGrammarDirectiveText(value: string, rawArtStyle: string): string {
  let text = value;
  for (const pattern of BLOCKED_STYLE_TERMS) {
    if (hasStylePermission(rawArtStyle, pattern)) continue;
    text = text.replace(pattern, 'style-lock compatible');
  }
  return text.replace(/\s+/g, ' ').trim();
}

export function buildVisualGrammarDirective(context: VisualGrammarContext): VisualGrammarDirective {
  const text = panelText(context.panel, context.sceneMood);
  const staging = stagingFor(text, context.panel.visibleCharacterIds.length, context.panel, context.index);
  const baseDirective: VisualGrammarDirective = {
    shotDistance: shotDistanceFor(text, staging, context.previousDirective),
    cameraAngle: cameraAngleFor(text, context.previousDirective),
    horizontalAngle: horizontalAngleFor(text, staging),
    staging,
    composition: compositionFor(text, staging),
    importanceScale: importanceScaleFor(text, staging),
    lighting: lightingFor(text),
    colorRole: {
      rule: '60:30:10',
      base: '60% base from established environment and episode style-lock palette',
      support: '30% support from stable character, wardrobe, prop, or mid-ground palette',
      accent: accentFor(text, staging),
      constraint: '60:30:10 stays inside the master art style and episode style-lock; no new per-panel color scheme',
    },
    transition: transitionFor(text, staging, context),
  };
  const variedDirective = avoidAdjacentRepeat(baseDirective, context.previousDirective);
  return {
    ...variedDirective,
    composition: sanitizeVisualGrammarDirectiveText(variedDirective.composition, context.rawArtStyle),
    importanceScale: sanitizeVisualGrammarDirectiveText(variedDirective.importanceScale, context.rawArtStyle),
    lighting: sanitizeVisualGrammarDirectiveText(variedDirective.lighting, context.rawArtStyle),
    colorRole: {
      ...variedDirective.colorRole,
      base: sanitizeVisualGrammarDirectiveText(variedDirective.colorRole.base, context.rawArtStyle),
      support: sanitizeVisualGrammarDirectiveText(variedDirective.colorRole.support, context.rawArtStyle),
      accent: sanitizeVisualGrammarDirectiveText(variedDirective.colorRole.accent, context.rawArtStyle),
      constraint: sanitizeVisualGrammarDirectiveText(variedDirective.colorRole.constraint, context.rawArtStyle),
    },
  };
}

export function formatVisualGrammarDirective(directive: VisualGrammarDirective): string {
  return [
    `VISUAL STORYTELLING DIRECTIVE: shot=${directive.shotDistance}`,
    `angle=${directive.cameraAngle}/${directive.horizontalAngle}`,
    `staging=${directive.staging}`,
    `importance=${directive.importanceScale}`,
    `composition=${directive.composition}`,
    `lighting=${directive.lighting}`,
    `color=${directive.colorRole.base}; ${directive.colorRole.support}; ${directive.colorRole.accent}; ${directive.colorRole.constraint}`,
    `transition=${directive.transition}.`,
    'Lighting and color are variations inside the master art style, not new style instructions.',
  ].join('; ');
}
