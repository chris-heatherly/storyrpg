import { SCENE_DEFAULTS } from '../../constants/pipeline';
import { isActionHeavyGenre } from '../prompts/storytellingPrinciples';
import type { SceneContent } from '../agents/SceneWriter';
import { BaseValidator, ValidationIssue } from './BaseValidator';

export interface SceneCraftOptions {
  genre?: string;
  dialogueHeavy?: boolean;
  isFinalScene?: boolean;
  isFinale?: boolean;
  minBeatsPerScene?: number;
  maxBeatsPerScene?: number;
  allowedStyleTerms?: string[];
  styleContextText?: string;
}

export interface SceneCraftResult {
  passed: boolean;
  issues: ValidationIssue[];
}

const ACTION_OR_CONSEQUENCE_TERMS = /\b(grab\w*|pull\w*|push\w*|run\w*|race\w*|step\w*|turn\w*|reach\w*|strike\w*|block\w*|hid\w*|hide\w*|open\w*|clos\w*|lift\w*|drop\w*|break\w*|save\w*|reveal\w*|learn\w*|discover\w*|accus\w*|refus\w*|choos\w*|chose\w*|decid\w*|promis\w*|betray\w*|escap\w*|los\w*|lost|cost\w*|risk\w*|threat\w*|danger\w*|pressure|evidence|secret\w*|trust|leverage|wound\w*|blood|fall\w*|fell|burn\w*|crack\w*|shatter\w*)\b/i;
const CONCRETE_TURN_TERMS = /\b(action|acts?|intent|wants?|refus\w*|decid\w*|choos\w*|chose|leverage|mood|trust|power|intimacy|suspicion|alliance|dynamic|position|tactical|near|closer|away|distance|information|learn\w*|discover\w*|reveal\w*|evidence|clue|secret|consequence|cost|risk|danger|pressure|resource\w*|identity|gains?|loses?|lost|changes?|turns?|breaks?|promis\w*|betray\w*|accus\w*|prepare\w*|recover\w*|train\w*|ally|investigat\w*)\b/i;
const PHYSICAL_DANGER_TERMS = /\b(fight\w*|attack\w*|strike\w*|weapon\w*|blade\w*|gun\w*|fire|explosion\w*|wound\w*|blood|chas\w*|fall\w*|fell|trap\w*|collapse\w*|danger\w*|surviv\w*|escap\w*|pursu\w*|ambush\w*|impact\w*|bruis\w*|shov\w*|punch\w*|kick\w*|slash\w*|stab\w*)\b/i;
const PHYSICAL_BUSINESS_TERMS = /\b(walk\w*|pac\w*|pack\w*|cook\w*|train\w*|repair\w*|writ\w*|sort\w*|clean\w*|climb\w*|search\w*|carr\w*|draw\w*|paint\w*|sharpen\w*|stitch\w*|prepar\w*|driv\w*|row\w*|dig\w*|unlock\w*|hid\w*|hide\w*|run\w*|reach\w*|lift\w*|set|fold\w*|pour\w*|open\w*|clos\w*)\b/i;
const DIALOGUE_MARKERS = /["“”']|^\s*[A-Z][^.!?]{1,40}:/m;
const FORWARD_PRESSURE_TERMS = /\b(question|choice|decide|must|before|until|but|however|reveals?|arrives?|vanishes|missing|returns?|promise|threat|danger|betray|secret|cost|next|legacy|future|changed|saved|redeemed|improved)\b|[?]/i;
const LEGACY_TERMS = /\b(saved|redeemed|restored|healed|changed|improved|future|legacy|tomorrow|afterward|cost|identity|remember|new life|new world)\b/i;
const POINTED_ENDING_TERMS = /\b(resolve\w*|consequence|cost|choice|reveal\w*|discover\w*|learn\w*|threat|danger|betray\w*|rupture|changed|shift\w*|handoff|arrive\w*|vanish\w*|missing|promise|secret|legacy|future|saved|lost|wound\w*|damage\w*|exposed?|narrow\w*|next|must|until|but|however)\b|[?]/i;
const JEOPARDY_TERMS = /\b(attack\w*|weapon\w*|blood|wound\w*|chas\w*|trap\w*|explosion\w*|hid\w*|hide\w*|escap\w*|kill\w*|danger|panic|fear|running|cornered|surviv\w*|ambush\w*|pursu\w*|blade\w*|gun\w*|fire)\b/i;
const EXPLANATORY_DIALOGUE_TERMS = /\b(let me explain|we need to discuss|as you know|the point is|what this means|we should have a meeting|we need a plan|because the reason)\b/i;
const DIRECT_THOUGHT_FEELING_TERMS = /\b(you feel|you felt|she feels?|he feels?|they feel|i feel|felt afraid|felt guilty|felt sad|felt angry|was afraid|were afraid|is afraid|was angry|were angry|is angry|was sad|were sad|is sad|wondered|thought to herself|thought to himself|thought that|realized|remembered|knew that|understood that)\b/i;
const FIGHT_ACTION_TERMS = /\b(fight\w*|attack\w*|strike\w*|struck|punch\w*|kick\w*|blade\w*|knife|gun|weapon\w*|shot|shoot\w*|slash\w*|stab\w*|explosion\w*|tackle\w*|grapple\w*|ambush\w*|duel\w*|combat|battle)\b/i;
const SPECIFIC_BODY_IMPACT_TERMS = /\b(hand|wrist|shoulder|knee|foot|feet|jaw|ribs?|breath|grip|stumble\w*|slam\w*|duck\w*|lunge\w*|twist\w*|fall\w*|fell|recoil\w*|drag\w*|shove\w*|block\w*|strike\w*|blood|wound\w*|bruise\w*|crack\w*|impact|face|eyes|mouth|teeth|arm|leg|chest|back|throat|collid\w*|throw\w*|thrown)\b/i;
const DAMAGE_IMPACT_TERMS = /\b(wound\w*|blood|bleed\w*|bruise\w*|broken|break\w*|crack\w*|splinter\w*|shatter\w*|burn\w*|tear\w*|torn|scream\w*|gasp\w*|recoil\w*|collapse\w*|limp\w*|stagger\w*|impact|pain|scar|damage\w*|explosion\w*|clash\w*|slam\w*|crush\w*)\b/i;
const VAGUE_ACTION_TERMS = /\b(they fight|they fought|fight for a while|fought for a while|struggle for a while|chaos erupts|battle begins|battle continues|trading blows)\b/i;
const CONFLICT_TERMS = /\b(argu\w*|accus\w*|refus\w*|betray\w*|threat\w*|confront\w*|attack\w*|expos\w*|challeng\w*|blackmail\w*|humiliat\w*|reject\w*|abandon\w*)\b/i;
const CONFLICT_DAMAGE_TERMS = /\b(wound\w*|blood|bruise\w*|damage\w*|pain|trust|reputation|shame|debt|loses?|lost|cost\w*|exposed?|reject\w*|abandon\w*|betray\w*|resource\w*|leverage|secret|identity|relationship|fear|doubt|humiliat\w*|rupture|moral|compromise|danger|narrow\w*|option\w*)\b/i;
const SENSORY_PLACE_TEXTURE_TERMS = /\b(rain|wind|smell|scent|taste|salt|smoke|ash|dust|heat|cold|warm|wet|dry|rough|smooth|sticky|metal|stone|wood|glass|cloth|floor|wall|door|window|street|room|hall|corridor|kitchen|forest|river|harbor|market|lamp|shadow|light|sound|noise|silence|echo|thunder|breath|voice|footstep|texture|air|fog|mud|snow|blood|oil|perfume|rot|sweet|bitter)\b/i;
const GENERIC_DESCRIPTION_TERMS = /\b(beautiful|nice|scary|strange|interesting|very|really|somehow|something about|kind of|sort of|pretty|quite|amazing|weird|bad|good|big|small)\b/i;
const CONCRETE_DETAIL_TERMS = /\b(grip|hand|wrist|jaw|door|letter|ledger|seal|lamp|knife|blade|glass|stone|blood|rain|smoke|shadow|floor|wall|street|breath|voice|step|fold|open|crack|shatter|splinter|reveal|cost|trust|leverage|secret|choice|risk|danger)\b/i;
const PLAYER_FACING_CAMERA_TERMS = /\b(cinematic|camera|close-up|closeup|wide shot|medium shot|tracking shot|dolly|pan|zoom|lens|framing|shot composition|cut to|slow motion|rack focus|bokeh)\b/i;
const DIALOGUE_PRESSURE_TERMS = /\b(trust|leverage|secret|danger|risk|cost|choice|refus\w*|accus\w*|betray\w*|threat\w*|promise|fear|want|need|debt|wound|damage|leave|stay|run|hide|attack|expose\w*|relationship|reputation|identity|truth|lie)\b/i;
const STYLE_FIGHTING_TERMS = [
  'cinematic',
  'hyperreal',
  'photoreal',
  'painterly',
  'anime',
  'dramatic lighting',
  'high contrast',
  'vivid colors',
  'gritty',
  'glossy',
  'flat lighting',
  'symmetrical composition',
  'bokeh',
  'ultra detailed',
  'realistic',
];

const TOKEN_STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'to', 'of', 'in', 'on', 'for', 'with', 'by',
  'from', 'into', 'that', 'this', 'is', 'are', 'was', 'were', 'be', 'become', 'becomes',
  'player', 'learns', 'feels', 'understands', 'scene', 'moment',
]);

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.toLowerCase() : '';
}

function extractTokens(values: Array<string | undefined>): Set<string> {
  const tokens = values
    .join(' ')
    .toLowerCase()
    .match(/[a-z][a-z'-]{2,}/g) || [];

  return new Set(tokens.filter((token) => !TOKEN_STOPWORDS.has(token)));
}

function hasSharedTakeawayKeyMomentTerms(scene: SceneContent): boolean {
  const takeaways = scene.sceneTakeaways || [];
  const keyMoments = scene.keyMoments || [];
  if (takeaways.length === 0 || keyMoments.length === 0) {
    return true;
  }

  const takeawayTokens = extractTokens(takeaways);
  const keyMomentTokens = extractTokens(keyMoments);

  return [...keyMomentTokens].some((token) => takeawayTokens.has(token));
}

function getNestedString(source: unknown, path: string[]): string {
  let current: any = source;
  for (const segment of path) {
    current = current?.[segment];
  }
  return typeof current === 'string' ? current : '';
}

function collectImageFacingText(scene: SceneContent): string {
  return (scene.beats || []).map((beat: any) => [
    beat.visualMoment,
    beat.primaryAction,
    beat.emotionalRead,
    beat.relationshipDynamic,
    beat.mustShowDetail,
    getNestedString(beat, ['dramaticIntent', 'visibleTurn']),
    getNestedString(beat, ['dramaticIntent', 'visualSubtextCue']),
    getNestedString(beat, ['sequenceIntent', 'visualThread']),
  ].filter(Boolean).join(' ')).join('\n');
}

function collectBeatPayload(beat: any): string {
  return [
    beat?.text,
    beat?.primaryAction,
    beat?.visualMoment,
    beat?.mustShowDetail,
    beat?.relationshipDynamic,
    beat?.emotionalRead,
    getNestedString(beat, ['dramaticIntent', 'visibleTurn']),
    getNestedString(beat, ['dramaticIntent', 'visualSubtextCue']),
    getNestedString(beat, ['sequenceIntent', 'visualThread']),
  ].filter(Boolean).join(' ');
}

function extractDialogueChunks(text: string): string[] {
  const chunks: string[] = [];
  const straightQuotePattern = /"([^"]+)"/g;
  const curlyQuotePattern = /“([^”]+)”/g;

  for (const pattern of [straightQuotePattern, curlyQuotePattern]) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      chunks.push(match[1]);
    }
  }

  return chunks;
}

function wordCount(text: string): number {
  return (text.trim().match(/\S+/g) || []).length;
}

function isPureDialogueScene(sceneText: string): boolean {
  const dialogueText = extractDialogueChunks(sceneText).join(' ');
  if (!dialogueText) {
    return false;
  }

  const proseText = sceneText
    .replace(/"[^"]+"/g, '')
    .replace(/“[^”]+”/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  return proseText.length < 40 && wordCount(dialogueText) > wordCount(proseText);
}

function firstWords(text: string, count = 3): string {
  return (text.toLowerCase().match(/[a-z][a-z'-]*/g) || [])
    .slice(0, count)
    .join(' ');
}

function firstActionVerb(text: string): string {
  const match = text.toLowerCase().match(/\b(grabs?|opens?|turns?|steps?|walks?|runs?|looks?|stares?|holds?|reaches?|pulls?|pushes?|strikes?|asks?|says?|whispers?|shouts?|accuses?|reveals?|folds?|studies?|waits?|watches?)\b/);
  return match?.[1] || '';
}

function hasAdjacentRepetition(beats: SceneContent['beats']): boolean {
  for (let index = 1; index < beats.length; index += 1) {
    const previous = beats[index - 1];
    const current = beats[index];
    const previousOpening = firstWords(previous.text || '');
    const currentOpening = firstWords(current.text || '');
    const previousVerb = firstActionVerb([previous.primaryAction, previous.text].filter(Boolean).join(' '));
    const currentVerb = firstActionVerb([current.primaryAction, current.text].filter(Boolean).join(' '));

    if (previousOpening && previousOpening === currentOpening) {
      return true;
    }

    if (previousVerb && previousVerb === currentVerb) {
      return true;
    }
  }

  return false;
}

function hasWeakKeyMomentBuildup(scene: SceneContent, finalPayload: string, hasPointedFinalBeat: boolean): boolean {
  if (hasPointedFinalBeat) {
    return false;
  }

  const anchorTokens = extractTokens([
    ...(scene.keyMoments || []),
    ...(scene.sceneTakeaways || []),
  ]);
  if (anchorTokens.size === 0) {
    return false;
  }

  const dominantText = (scene.beats || [])
    .filter((beat) => beat.intensityTier === 'dominant')
    .map((beat) => collectBeatPayload(beat))
    .join(' ');
  const payoffTokens = extractTokens([finalPayload, dominantText]);

  return ![...payoffTokens].some((token) => anchorTokens.has(token));
}

function findStyleFightingTerms(text: string, options: SceneCraftOptions): string[] {
  const haystack = normalizeText(text);
  if (!haystack) {
    return [];
  }

  const allowedContext = [
    ...(options.allowedStyleTerms || []),
    options.styleContextText,
  ].filter(Boolean).join(' ').toLowerCase();

  return STYLE_FIGHTING_TERMS.filter((term) => {
    if (!haystack.includes(term)) {
      return false;
    }
    return !allowedContext.includes(term);
  });
}

export class SceneCraftValidator extends BaseValidator {
  constructor() {
    super('SceneCraftValidator');
  }

  validateScene(scene: SceneContent, options: SceneCraftOptions = {}): SceneCraftResult {
    const issues: ValidationIssue[] = [];
    const beats = scene.beats || [];
    const minBeats = options.minBeatsPerScene ?? SCENE_DEFAULTS.minBeatsPerScene;
    const maxBeats = options.maxBeatsPerScene ?? SCENE_DEFAULTS.maxBeatsPerScene;

    if (beats.length > 0 && beats.length < minBeats) {
      issues.push(this.warning(
        'Scene has fewer beats than the configured default range',
        scene.sceneId,
        `Generated ${beats.length} beats; the configured lower bound is ${minBeats}. Keep if this sparse scene is intentional, otherwise add playable turns.`
      ));
    }

    if (beats.length > maxBeats) {
      issues.push(this.warning(
        'Scene has more beats than the configured default range',
        scene.sceneId,
        `Generated ${beats.length} beats; the configured upper bound is ${maxBeats}. Keep only for unusually dense scenes.`
      ));
    }

    if (!scene.sceneTakeaways || scene.sceneTakeaways.length === 0) {
      issues.push(this.warning(
        'Scene is missing sceneTakeaways',
        scene.sceneId,
        'Add 1-4 takeaways naming what the player learns, feels, or understands.'
      ));
    }

    if (!scene.keyMoments || scene.keyMoments.length === 0) {
      issues.push(this.warning(
        'Scene is missing keyMoments',
        scene.sceneId,
        'Name the emotional or narrative payoff the beat sequence builds toward.'
      ));
    }

    if (!hasSharedTakeawayKeyMomentTerms(scene)) {
      issues.push(this.warning(
        'Scene keyMoments appear disconnected from sceneTakeaways',
        scene.sceneId,
        'Make the key moment clearly culminate what the player learns, feels, or understands.'
      ));
    }

    const nonRestBeats = beats.filter((beat) => beat.intensityTier !== 'rest');
    const hasConcreteAction = nonRestBeats.some((beat) => {
      const text = collectBeatPayload(beat);
      return ACTION_OR_CONSEQUENCE_TERMS.test(text) || CONCRETE_TURN_TERMS.test(text);
    });

    if (nonRestBeats.length > 0 && !hasConcreteAction) {
      issues.push(this.warning(
        'Non-rest scene lacks evidence of a concrete story turn',
        scene.sceneId,
        'Give at least one supporting/dominant beat a concrete shift in action, intent, leverage, mood, relationship dynamic, tactical position, information, or consequence.'
      ));
    }

    const styleFightingTerms = findStyleFightingTerms(collectImageFacingText(scene), options);
    if (styleFightingTerms.length > 0) {
      issues.push(this.warning(
        'Visual metadata contains style-direction terms that may fight the active art style',
        scene.sceneId,
        `Move image-facing language toward story intent unless these terms come from the active style contract: ${styleFightingTerms.join(', ')}.`
      ));
    }

    const sceneText = beats.map((beat) => beat.text || '').join('\n');
    const scenePayload = beats.map((beat) => collectBeatPayload(beat)).join('\n');
    const finalBeat = beats[beats.length - 1];
    const finalPayload = collectBeatPayload(finalBeat);
    const hasPointedFinalBeat = POINTED_ENDING_TERMS.test(finalPayload);
    const dialogueChunks = extractDialogueChunks(sceneText);

    if (beats.length > 0 && !options.isFinalScene && !hasPointedFinalBeat) {
      issues.push(this.warning(
        'Final beat lacks pointed resolution, consequence, or forward pressure',
        finalBeat.id,
        'Land a consequence, reveal, emotional shift, relationship change, choice pressure, handoff, or cliffhanger.'
      ));
    }

    if (!isPureDialogueScene(sceneText) && sceneText.trim().length > 0 && !SENSORY_PLACE_TEXTURE_TERMS.test(scenePayload) && !ACTION_OR_CONSEQUENCE_TERMS.test(scenePayload)) {
      issues.push(this.warning(
        'Scene has weak sensory, place, or action grounding',
        scene.sceneId,
        'Use selective sensory detail, environment, texture, visible action, or place pressure to ground the scene.'
      ));
    }

    if (GENERIC_DESCRIPTION_TERMS.test(sceneText) && !CONCRETE_DETAIL_TERMS.test(scenePayload)) {
      issues.push(this.warning(
        'Scene uses generic description without enough concrete detail',
        scene.sceneId,
        'Replace vague description with precise sensory detail, object behavior, visible action, or consequence.'
      ));
    }

    if (PLAYER_FACING_CAMERA_TERMS.test(sceneText)) {
      issues.push(this.warning(
        'Player-facing prose uses cinematic or camera vocabulary',
        scene.sceneId,
        'Keep camera/style terms out of player-facing prose; reserve visual framing for metadata fields.'
      ));
    }

    if (hasAdjacentRepetition(beats)) {
      issues.push(this.warning(
        'Adjacent beats repeat phrasing or action language',
        scene.sceneId,
        'Use fresh phrasing and varied action language unless repetition is an intentional callback, refrain, contrast, or payoff.'
      ));
    }

    if (hasWeakKeyMomentBuildup(scene, finalPayload, hasPointedFinalBeat)) {
      issues.push(this.warning(
        'Scene payoff weakly connects to keyMoment or sceneTakeaways',
        scene.sceneId,
        'Make the dominant or final beat clearly build toward the scene keyMoment, takeaway, consequence, or forward pressure.'
      ));
    }

    const hasDominantBeat = beats.some((beat) => beat.intensityTier === 'dominant');
    if (beats.length >= 3 && !hasDominantBeat && !hasPointedFinalBeat) {
      issues.push(this.warning(
        'Scene arc feels flat; beats should build toward a keyMoment or pointed consequence',
        scene.sceneId,
        'Shape the scene toward a peak, reversal, revelation, cost, or other felt keyMoment.'
      ));
    }

    if ((options.dialogueHeavy || DIALOGUE_MARKERS.test(sceneText)) && !PHYSICAL_BUSINESS_TERMS.test(scenePayload)) {
      issues.push(this.warning(
        'Dialogue scene lacks physical business or situational pressure',
        scene.sceneId,
        'Give the conversation fitting physical business or situational pressure.'
      ));
    }

    if (dialogueChunks.length > 0 && EXPLANATORY_DIALOGUE_TERMS.test(sceneText) && !DIALOGUE_PRESSURE_TERMS.test(scenePayload)) {
      issues.push(this.warning(
        'Dialogue lacks subtext or scene pressure',
        scene.sceneId,
        'Dialogue should reveal character, sharpen pressure, change leverage, or expose a relationship dynamic rather than only explain plans or information.'
      ));
    }

    if (JEOPARDY_TERMS.test(scenePayload) && (
      dialogueChunks.some((chunk) => wordCount(chunk) > 14) ||
      EXPLANATORY_DIALOGUE_TERMS.test(sceneText)
    )) {
      issues.push(this.warning(
        'Jeopardy dialogue reads too casual or explanatory for the danger level',
        scene.sceneId,
        'As danger rises, shorten dialogue and make it more urgent, interrupted, selective, or pointed.'
      ));
    }

    const directThoughtBeat = beats.find((beat) => DIRECT_THOUGHT_FEELING_TERMS.test(beat.text || ''));
    if (directThoughtBeat) {
      issues.push(this.warning(
        'Beat directly explains thought or feeling',
        directThoughtBeat.id,
        'Externalize inner life through action, brief dialogue, silence, object behavior, or what the character does next.'
      ));
    }

    const longDialogue = dialogueChunks.find((chunk) => wordCount(chunk) > 22);
    if (longDialogue) {
      issues.push(this.warning(
        'Dialogue is too long for spare, pressure-aware scene prose',
        scene.sceneId,
        'Break long speech into shorter exchanges or move meaning into action, interruption, or subtext.'
      ));
    }

    if ((PHYSICAL_DANGER_TERMS.test(scenePayload) || VAGUE_ACTION_TERMS.test(scenePayload)) && !SPECIFIC_BODY_IMPACT_TERMS.test(scenePayload)) {
      issues.push(this.warning(
        'Physical action lacks specific bodily movement or visible impact',
        scene.sceneId,
        'Describe concrete movement, posture, grip, footwork, collision, recoil, facial expression, wound, or object impact.'
      ));
    }

    if (FIGHT_ACTION_TERMS.test(scenePayload) && !DAMAGE_IMPACT_TERMS.test(scenePayload)) {
      issues.push(this.warning(
        'Fight or weapon scene lacks visible damage, destructive impact, or serious jeopardy',
        scene.sceneId,
        'Fight/action beats should include serious danger, wounds or damage, forceful impact, depletion, or a specific narrowly avoided harm.'
      ));
    }

    if (CONFLICT_TERMS.test(scenePayload) && !CONFLICT_DAMAGE_TERMS.test(scenePayload)) {
      issues.push(this.warning(
        'Conflict lacks a visible cost or damage state',
        scene.sceneId,
        'Conflict should damage someone or something physically, emotionally, socially, relationally, materially, reputationally, informationally, or in identity/leverage.'
      ));
    }

    if (options.isFinalScene && beats.length > 0) {
      const finalText = finalBeat.text || '';
      const isResolution = options.isFinale;
      const hasForwardPressure = FORWARD_PRESSURE_TERMS.test(finalText);
      const hasLegacy = LEGACY_TERMS.test(finalText);

      if (isResolution && !hasLegacy) {
        issues.push(this.warning(
          'Finale/resolution ending lacks aftermath or legacy',
          finalBeat.id,
          'After the climax, show what was saved, redeemed, or improved, then the protagonist future, cost, identity change, or legacy.'
        ));
      } else if (!isResolution && !hasForwardPressure) {
        issues.push(this.warning(
          'Final scene beat lacks forward pressure',
          finalBeat.id,
          'Acknowledge the immediate consequence, then open a specific next pressure, reveal, choice, or question.'
        ));
      }
    }

    return { passed: !issues.some((issue) => issue.severity === 'error'), issues };
  }

  validateEpisodeScenes(
    scenes: SceneContent[],
    options: { genre?: string; betweenIncitingAndClimax?: boolean } = {}
  ): SceneCraftResult {
    const issues: ValidationIssue[] = [];
    if (!isActionHeavyGenre(options.genre) || !options.betweenIncitingAndClimax) {
      return { passed: true, issues };
    }

    const text = scenes
      .flatMap((scene) => scene.beats || [])
      .map((beat) => [
        beat.text,
        beat.primaryAction,
        beat.visualMoment,
        beat.mustShowDetail,
      ].filter(Boolean).join(' '))
      .join('\n');

    if (!PHYSICAL_DANGER_TERMS.test(text)) {
      issues.push(this.warning(
        'Action-heavy episode lacks serious physical danger or direct conflict',
        undefined,
        'Between the inciting incident and climax, include a genre-appropriate action sequence or direct physical threat with concrete jeopardy and consequence.'
      ));
    }

    return { passed: !issues.some((issue) => issue.severity === 'error'), issues };
  }
}
