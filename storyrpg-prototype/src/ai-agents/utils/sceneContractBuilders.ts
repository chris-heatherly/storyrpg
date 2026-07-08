import type { NarrativeSequenceIntent, StakesLayers } from '../../types';
import type {
  RequiredBeat,
  SceneNarrativeRole,
  SceneTurnContract,
} from '../../types/scenePlan';
import type {
  SceneBlueprint,
  SceneDramaticStructure,
  SceneResidue,
  SceneTransitionOut,
} from '../agents/StoryArchitect';
import { isQuestionShapedAnchor } from '../remediation/storyEventCues';
import {
  cleanBlueprintText as cleanText,
  isBlueprintHygieneUnsafeText,
  pickBlueprintSafeText,
  stripStructuralTreatmentLabels,
} from './blueprintTextHygiene';

type SceneContractSource = 'turnContract' | 'requiredBeat' | 'encounter' | 'choice' | 'purpose' | 'role';

export interface SceneContractContext {
  episodeNumber?: number;
  episodeTitle?: string;
  episodeSynopsis?: string;
  sceneIndex?: number;
  nextSceneId?: string;
  episodePressure?: string;
  episodeTheme?: string;
  role?: SceneNarrativeRole;
}

export interface SceneContractDerivation {
  source: SceneContractSource;
  concreteTurn: string;
  title: string;
  turnContract: SceneTurnContract;
  dramaticStructure: SceneDramaticStructure;
  personalStake: string;
  themePressure: string;
  stakesLayers: StakesLayers;
  transitionOut: SceneTransitionOut[];
  residue: SceneResidue[];
  sequenceIntent: NarrativeSequenceIntent;
}

const GENERIC_PLANNER_TEXT_RE =
  /^(?:setup|development|release|turn|payoff)\s+scene\s+\d+$/i;

// "shifts visible leverage around" is the deriveConcreteTurn role-fallback
// template's own signature: those turns embed episode-summary text (which can
// mention arrival/blog/etc. events) and must never confer event-cue ownership.
const GENERIC_TURN_RE =
  /\b(?:open the episode through its immediate question|escalate the episode pressure|let the fallout settle into the next pressure|reverse or reveal something the scene can no longer hide|pay off an earlier setup|rising pressure|falling pressure|shifts visible leverage around)\b/i;

// A question-shaped turn ("Can Kylie start over…?") gives SceneWriter nothing
// to depict and, worse, leaks interrogative text into cue detection where verb
// fragments read as staged events (bite-me 2026-07-07 s1-7: the episode
// question filled every field of the release scene and its "write … blog"
// wording aborted SceneConstructionGate).
export function isQuestionShapedTurnText(value: unknown): boolean {
  return isQuestionShapedAnchor(cleanText(value) || undefined);
}

const REQUIRED_BEAT_TIERS = new Set(['signature', 'authored', 'coldopen']);

function firstMeaningful(values: Array<unknown>): string {
  for (const value of values) {
    const text = stripStructuralTreatmentLabels(value);
    if (text && !isBlueprintHygieneUnsafeText(text)) return text;
  }
  return '';
}

/** First candidate that is meaningful AND a declarative statement (turn-safe). */
function firstConcreteStatement(values: Array<unknown>): string {
  for (const value of values) {
    const text = stripStructuralTreatmentLabels(value);
    if (text && !isBlueprintHygieneUnsafeText(text) && !isGenericPlannerTurnScaffold(text) && !isQuestionShapedTurnText(text)) {
      return text;
    }
  }
  return '';
}

function sentenceCase(value: string): string {
  const text = cleanText(value);
  if (!text) return text;
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function trimSentence(value: string, max = 140): string {
  const text = cleanText(value);
  if (text.length <= max) return text;
  const softBreak = text.slice(0, max).replace(/\s+\S*$/, '');
  return `${softBreak || text.slice(0, max)}...`;
}

function normalizeKeyBeat(value: string): string {
  return cleanText(stripStructuralTreatmentLabels(value)).replace(/\s+/g, ' ').trim();
}

function keyBeatFingerprint(value: string): string {
  return normalizeKeyBeat(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .slice(0, 120);
}

export function isGenericScenePlannerText(value: unknown): boolean {
  const text = cleanText(value);
  if (!text) return true;
  return isBlueprintHygieneUnsafeText(text) || isGenericPlannerTurnScaffold(text);
}

/**
 * Narrow scaffold-only check: matches the composeDramaticPurpose role templates
 * ("Let the fallout settle into the next pressure: …") without the blueprint
 * hygiene heuristics. Used by scene-event ownership, where hygiene-unsafe
 * phrasing can still describe a real staged event but a scaffold turn (whose
 * tail is a whole-episode summary) must never confer cue ownership.
 */
export function isGenericPlannerTurnScaffold(value: unknown): boolean {
  const text = cleanText(value);
  if (!text) return true;
  return GENERIC_PLANNER_TEXT_RE.test(text) || GENERIC_TURN_RE.test(text);
}

function isConcreteRequiredBeat(beat: RequiredBeat | undefined): boolean {
  if (!beat) return false;
  return REQUIRED_BEAT_TIERS.has(beat.tier) && Boolean(cleanText(beat.mustDepict || beat.sourceTurn));
}

function concreteRequiredBeatText(beats: RequiredBeat[] | undefined): string {
  return stripStructuralTreatmentLabels((beats || []).find(isConcreteRequiredBeat)?.mustDepict)
    || stripStructuralTreatmentLabels((beats || []).find(isConcreteRequiredBeat)?.sourceTurn)
    || '';
}

function roleLabel(role: SceneNarrativeRole | undefined): string {
  switch (role) {
    case 'setup':
      return 'opening pressure';
    case 'development':
      return 'development pressure';
    case 'turn':
      return 'central turn';
    case 'payoff':
      return 'payoff pressure';
    case 'release':
      return 'aftermath pressure';
    default:
      return 'scene pressure';
  }
}

function deriveConcreteTurn(scene: SceneBlueprint, context: SceneContractContext): { source: SceneContractSource; text: string } {
  const turn = scene.turnContract;
  if (
    turn
    && !isGenericScenePlannerText(turn.centralTurn)
    && !isGenericScenePlannerText(turn.turnEvent)
    && !isQuestionShapedTurnText(turn.centralTurn || turn.turnEvent)
  ) {
    return { source: 'turnContract', text: stripStructuralTreatmentLabels(turn.centralTurn || turn.turnEvent) };
  }

  const requiredBeat = concreteRequiredBeatText(scene.requiredBeats);
  if (requiredBeat) return { source: 'requiredBeat', text: requiredBeat };

  const encounterText = firstConcreteStatement([
    scene.encounterCentralConflict,
    scene.encounterDescription,
    scene.encounterStakes,
  ]);
  if (encounterText) {
    return { source: 'encounter', text: encounterText };
  }

  const choiceText = firstConcreteStatement([
    scene.choicePoint?.description,
    scene.choicePoint?.stakes?.identity,
    scene.choicePoint?.stakes?.cost,
    scene.choicePoint?.stakes?.want,
  ]);
  if (choiceText) {
    return { source: 'choice', text: choiceText };
  }

  const purpose = firstConcreteStatement([
    scene.dramaticPurpose,
    scene.narrativeFunction,
    scene.description,
  ]);
  if (purpose) {
    return { source: 'purpose', text: purpose };
  }

  const role = context.role || scene.narrativeRole;
  const pressure = firstMeaningful([
    context.episodePressure,
    context.episodeSynopsis,
    scene.description,
    scene.name,
    roleLabel(role),
  ]);
  return {
    source: 'role',
    text: `${sentenceCase(roleLabel(role))} shifts visible leverage around ${trimSentence(pressure || context.episodeTitle || 'the episode turn', 90)}.`,
  };
}

export function deriveConcreteSceneName(scene: SceneBlueprint, derivation: Pick<SceneContractDerivation, 'concreteTurn'>): string {
  if (!isGenericScenePlannerText(scene.name)) return cleanText(scene.name);
  const text = derivation.concreteTurn;
  const location = cleanText(scene.location);
  const noun = text
    .replace(/\b(the protagonist|protagonist|player)\b/ig, '')
    .split(/[.;:!?]/)[0]
    .trim();
  const clipped = trimSentence(noun || text, 54).replace(/\.$/, '');
  if (location && !new RegExp(location.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(clipped)) {
    return trimSentence(`${clipped} at ${location}`, 70);
  }
  return clipped || scene.name;
}

function deriveResidueType(text: string): SceneResidue['type'] {
  if (/\b(secret|clue|learn|know|reveal|information|proof|evidence|blog|post|message|warns?|warning)\b/i.test(text)) return 'information';
  if (/\b(key|door|access|permission|entry|threshold|route|option)\b/i.test(text)) return 'access';
  if (/\b(trust|friend|ally|lover|kiss|intimacy|relationship|distance|betray|bond)\b/i.test(text)) return 'relationship';
  if (/\b(identity|self|choose|become|belong|name|reputation)\b/i.test(text)) return 'identity';
  if (/\b(danger|threat|attack|wound|blood|fear|risk|cost)\b/i.test(text)) return 'danger';
  return 'promise';
}

function deriveStakesLayers(scene: SceneBlueprint, turn: string, personalStake: string): StakesLayers {
  const existing = scene.stakesLayers || {};
  const turnSummary = trimSentence(turn, 120);
  const personalSummary = trimSentence(personalStake, 120);
  return {
    material: existing.material || `The scene changes concrete access, safety, information, reputation, or options: ${turnSummary}`,
    relational: existing.relational || `Someone's trust, leverage, visibility, or distance shifts because ${turnSummary}`,
    identity: existing.identity || `A self-protective or self-authored posture is tested by ${personalSummary}`,
    existential: existing.existential,
  };
}

function buildSceneStakesLadder(
  scene: SceneBlueprint,
  derivation: SceneContractDerivation,
): string[] {
  const existing = (Array.isArray(scene.keyBeats) ? scene.keyBeats : [])
    .map(normalizeKeyBeat)
    .filter((beat) => beat && !isGenericScenePlannerText(beat));
  const result: string[] = [];
  const fingerprints = new Set<string>();
  const add = (beat: string, options: { trusted?: boolean } = {}): void => {
    const normalized = normalizeKeyBeat(beat);
    if (!normalized || (!options.trusted && isGenericScenePlannerText(normalized))) return;
    const fingerprint = keyBeatFingerprint(normalized);
    if (fingerprint && fingerprints.has(fingerprint)) return;
    fingerprints.add(fingerprint || normalized.toLowerCase());
    result.push(normalized);
  };

  for (const beat of existing) add(beat);

  const question = derivation.dramaticStructure.question || derivation.turnContract.beforeState;
  const personalStake = derivation.personalStake || derivation.stakesLayers.identity || derivation.stakesLayers.material || derivation.concreteTurn;
  const leverage = derivation.concreteTurn || derivation.dramaticStructure.turn;
  const peak = derivation.dramaticStructure.pressurePeak || derivation.turnContract.turnEvent || leverage;
  const consequence = derivation.dramaticStructure.changedState || derivation.turnContract.afterState;

  // Join the derived value and the register suffix so an empty derivation yields a
  // clean "REST: establishes…" line instead of a malformed "REST:  establishes…"
  // (double space, no stake content).
  const addLadderRung = (tag: string, value: string | undefined, suffix: string): void => {
    if (result.some((beat) => new RegExp(`^${tag}:`, 'i').test(beat))) return;
    const derived = trimSentence(value ?? '', 150);
    add(`${tag}: ${[derived, suffix].filter(Boolean).join(' ')}`, { trusted: true });
  };

  addLadderRung('REST', question, 'establishes what feels stable, desired, or controlled before pressure changes it.');
  addLadderRung('RISK', personalStake, 'names the concrete cost, trust, reputation, access, safety, or identity pressure now exposed.');
  addLadderRung('LEVERAGE', leverage, "narrows the protagonist's options and changes who holds information, access, or social power.");
  addLadderRung('PEAK', peak, 'forces a visible choice, reveal, refusal, commitment, or irreversible cost.');
  addLadderRung('CONSEQUENCE', consequence, 'leaves a harder, more public, more intimate, or more dangerous next pressure.');

  return result;
}

export function deriveSceneContract(scene: SceneBlueprint, context: SceneContractContext = {}): SceneContractDerivation {
  const { source, text } = deriveConcreteTurn(scene, context);
  const role = context.role || scene.narrativeRole;
  const sceneId = scene.id || `scene-${(context.sceneIndex ?? 0) + 1}`;
  const concreteTurn = sentenceCase(stripStructuralTreatmentLabels(text));
  const beforeState = pickBlueprintSafeText(scene.turnContract?.beforeState)
    && !isGenericScenePlannerText(scene.turnContract?.beforeState)
    ? pickBlueprintSafeText(scene.turnContract?.beforeState) || ''
    : `Before the turn, ${trimSentence(firstMeaningful([scene.dramaticQuestion, scene.wantVsNeed, scene.description, context.episodeSynopsis, concreteTurn]), 130)}`;
  const turnEvent = pickBlueprintSafeText(scene.turnContract?.turnEvent)
    && !isGenericScenePlannerText(scene.turnContract?.turnEvent)
    ? pickBlueprintSafeText(scene.turnContract?.turnEvent) || ''
    : concreteTurn;
  const afterState = pickBlueprintSafeText(scene.turnContract?.afterState)
    && !isGenericScenePlannerText(scene.turnContract?.afterState)
    ? pickBlueprintSafeText(scene.turnContract?.afterState) || ''
    : `After the turn, visible leverage, knowledge, relationship, danger, or identity pressure remains from: ${trimSentence(concreteTurn, 120)}`;
  const handoff = pickBlueprintSafeText(scene.turnContract?.handoff)
    && !isGenericScenePlannerText(scene.turnContract?.handoff)
    ? pickBlueprintSafeText(scene.turnContract?.handoff) || ''
    : context.nextSceneId
      ? `Hand forward to ${context.nextSceneId} through the immediate visible consequence.`
      : 'Close the episode scene with the visible consequence.';
  const turnSource: SceneTurnContract['source'] = source === 'turnContract'
    ? scene.turnContract?.source || 'planner'
    : source === 'requiredBeat'
      ? 'treatment'
      : source === 'encounter'
        ? 'encounter'
        : source === 'choice'
          ? 'choice'
          : 'planner';
  const turnContract: SceneTurnContract = {
    turnId: scene.turnContract?.turnId || `${sceneId}-turn`,
    source: turnSource,
    centralTurn: concreteTurn,
    beforeState,
    turnEvent,
    afterState,
    handoff,
  };
  const title = deriveConcreteSceneName(scene, { concreteTurn });
  const personalStake = cleanText(scene.personalStake)
    || cleanText(scene.choicePoint?.stakes?.identity)
    || `A relationship, access point, identity posture, or future option is at risk because ${trimSentence(concreteTurn, 120)}`;
  const themePressure = cleanText(scene.themePressure)
    || cleanText(context.episodeTheme)
    || `The scene tests what the protagonist will accept, refuse, reveal, or protect under pressure.`;
  const stakesLayers = deriveStakesLayers(scene, concreteTurn, personalStake);
  const residue: SceneResidue[] = (scene.residue && scene.residue.length > 0)
    ? scene.residue
    : [{
        type: deriveResidueType(concreteTurn),
    description: `This scene leaves visible consequence: ${trimSentence(afterState, 150)}`,
      }];
  const transitionOut: SceneTransitionOut[] = context.nextSceneId
    ? (scene.transitionOut && scene.transitionOut.length > 0
      ? scene.transitionOut
      : [{
          toSceneId: context.nextSceneId,
          connector: role === 'release' ? 'but' : 'therefore',
          causalLink: `Because ${trimSentence(concreteTurn, 120)}`,
          pressureChange: afterState,
        }])
    : (scene.transitionOut || []);
  const dramaticStructure: SceneDramaticStructure = {
    question: cleanText(scene.dramaticStructure?.question) || cleanText(scene.dramaticQuestion) || `What changes when ${trimSentence(concreteTurn, 90)}?`,
    turn: cleanText(scene.dramaticStructure?.turn) || concreteTurn,
    pressurePeak: cleanText(scene.dramaticStructure?.pressurePeak) || turnEvent,
    changedState: cleanText(scene.dramaticStructure?.changedState) || afterState,
  };
  const sequenceIntent: NarrativeSequenceIntent = {
    ...(scene.sequenceIntent || {}),
    sequenceId: scene.sequenceIntent?.sequenceId || `${sceneId}-sequence-1`,
    objective: pickBlueprintSafeText(scene.sequenceIntent?.objective, scene.dramaticQuestion) || `Move the scene from pressure into visible consequence around ${trimSentence(concreteTurn, 90)}.`,
    activity: pickBlueprintSafeText(scene.sequenceIntent?.activity) || `The room, the body, and the way people answer all register the turn.`,
    obstacle: pickBlueprintSafeText(scene.sequenceIntent?.obstacle, scene.conflictEngine) || `The current pressure resists an easy answer.`,
    startState: pickBlueprintSafeText(scene.sequenceIntent?.startState) || beforeState,
    turningPoint: pickBlueprintSafeText(scene.sequenceIntent?.turningPoint) || concreteTurn,
    endState: pickBlueprintSafeText(scene.sequenceIntent?.endState) || afterState,
    visualThread: pickBlueprintSafeText(scene.sequenceIntent?.visualThread) || `Track the visible consequence of ${trimSentence(title, 70)}.`,
    mechanicThread: scene.sequenceIntent?.mechanicThread || residue[0]?.type,
  };

  return {
    source,
    concreteTurn,
    title,
    turnContract,
    dramaticStructure,
    personalStake,
    themePressure,
    stakesLayers,
    transitionOut,
    residue,
    sequenceIntent,
  };
}

export function applySceneContract(scene: SceneBlueprint, context: SceneContractContext = {}): SceneContractDerivation {
  const derivation = deriveSceneContract(scene, context);
  scene.name = derivation.title;
  scene.turnContract = derivation.turnContract;
  scene.dramaticStructure = derivation.dramaticStructure;
  scene.personalStake = scene.personalStake || derivation.personalStake;
  scene.themePressure = scene.themePressure || derivation.themePressure;
  scene.stakesLayers = {
    ...derivation.stakesLayers,
    ...(scene.stakesLayers || {}),
  };
  scene.transitionOut = derivation.transitionOut;
  scene.residue = derivation.residue;
  scene.sequenceIntent = derivation.sequenceIntent;
  scene.dramaticQuestion = scene.dramaticQuestion || derivation.dramaticStructure.question;
  scene.wantVsNeed = scene.wantVsNeed || derivation.personalStake;
  scene.conflictEngine = scene.conflictEngine || derivation.sequenceIntent.obstacle || derivation.concreteTurn;
  scene.narrativeFunction = scene.narrativeFunction || derivation.concreteTurn;
  scene.dramaticPurpose = scene.dramaticPurpose || derivation.concreteTurn;
  scene.keyBeats = buildSceneStakesLadder(scene, derivation);
  return derivation;
}
