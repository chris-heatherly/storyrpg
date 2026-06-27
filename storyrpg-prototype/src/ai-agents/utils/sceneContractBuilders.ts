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

const GENERIC_TURN_RE =
  /\b(?:open the episode through its immediate question|escalate the episode pressure|let the fallout settle into the next pressure|reverse or reveal something the scene can no longer hide|pay off an earlier setup|rising pressure|falling pressure)\b/i;

const REQUIRED_BEAT_TIERS = new Set(['signature', 'authored', 'coldopen']);

function cleanText(value: unknown): string {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
}

function stripStructuralTreatmentLabels(value: unknown): string {
  const text = cleanText(value);
  if (!text) return '';
  const matches = Array.from(text.matchAll(/\b(hook|promise|stakes)\s*(?:—|-|:)\s*/gi));
  if (matches.length === 0) return text;

  const segments: Partial<Record<'hook' | 'promise' | 'stakes', string>> = {};
  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index];
    const label = match[1].toLowerCase() as 'hook' | 'promise' | 'stakes';
    const start = (match.index || 0) + match[0].length;
    const end = index + 1 < matches.length ? matches[index + 1].index || text.length : text.length;
    const segment = text.slice(start, end).replace(/^[\s;,:-]+|[\s;,:-]+$/g, '').trim();
    if (segment) segments[label] = segment;
  }

  const concrete = [segments.hook, segments.stakes]
    .filter((segment): segment is string => Boolean(segment))
    .join('; ');
  return concrete || text.replace(/\b(?:hook|promise|stakes)\s*(?:—|-|:)\s*/gi, '').trim();
}

function firstMeaningful(values: Array<unknown>): string {
  for (const value of values) {
    const text = stripStructuralTreatmentLabels(value);
    if (text) return text;
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

export function isGenericScenePlannerText(value: unknown): boolean {
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
  ) {
    return { source: 'turnContract', text: stripStructuralTreatmentLabels(turn.centralTurn || turn.turnEvent) };
  }

  const requiredBeat = concreteRequiredBeatText(scene.requiredBeats);
  if (requiredBeat) return { source: 'requiredBeat', text: requiredBeat };

  const encounterText = firstMeaningful([
    scene.encounterCentralConflict,
    scene.encounterDescription,
    scene.encounterStakes,
  ]);
  if (encounterText && !isGenericScenePlannerText(encounterText)) {
    return { source: 'encounter', text: encounterText };
  }

  const choiceText = firstMeaningful([
    scene.choicePoint?.description,
    scene.choicePoint?.stakes?.identity,
    scene.choicePoint?.stakes?.cost,
    scene.choicePoint?.stakes?.want,
  ]);
  if (choiceText && !isGenericScenePlannerText(choiceText)) {
    return { source: 'choice', text: choiceText };
  }

  const purpose = firstMeaningful([
    scene.dramaticPurpose,
    scene.narrativeFunction,
    scene.description,
  ]);
  if (purpose && !isGenericScenePlannerText(purpose)) {
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
    text: `${sentenceCase(roleLabel(role))} changes the protagonist's footing around ${trimSentence(pressure, 90)}.`,
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
    identity: existing.identity || `The protagonist must decide what this pressure says about who they are: ${personalSummary}`,
    existential: existing.existential,
  };
}

export function deriveSceneContract(scene: SceneBlueprint, context: SceneContractContext = {}): SceneContractDerivation {
  const { source, text } = deriveConcreteTurn(scene, context);
  const role = context.role || scene.narrativeRole;
  const sceneId = scene.id || `scene-${(context.sceneIndex ?? 0) + 1}`;
  const concreteTurn = sentenceCase(stripStructuralTreatmentLabels(text));
  const beforeState = stripStructuralTreatmentLabels(scene.turnContract?.beforeState) && !isGenericScenePlannerText(scene.turnContract?.beforeState)
    ? stripStructuralTreatmentLabels(scene.turnContract?.beforeState)
    : `Before the turn, ${trimSentence(firstMeaningful([scene.dramaticQuestion, scene.wantVsNeed, scene.description, context.episodeSynopsis, concreteTurn]), 130)}`;
  const turnEvent = stripStructuralTreatmentLabels(scene.turnContract?.turnEvent) && !isGenericScenePlannerText(scene.turnContract?.turnEvent)
    ? stripStructuralTreatmentLabels(scene.turnContract?.turnEvent)
    : concreteTurn;
  const afterState = stripStructuralTreatmentLabels(scene.turnContract?.afterState) && !isGenericScenePlannerText(scene.turnContract?.afterState)
    ? stripStructuralTreatmentLabels(scene.turnContract?.afterState)
    : `After the turn, the scene leaves changed leverage, knowledge, relationship, danger, or identity pressure from: ${trimSentence(concreteTurn, 120)}`;
  const handoff = stripStructuralTreatmentLabels(scene.turnContract?.handoff) && !isGenericScenePlannerText(scene.turnContract?.handoff)
    ? stripStructuralTreatmentLabels(scene.turnContract?.handoff)
    : context.nextSceneId
      ? `Hand forward to ${context.nextSceneId} through the immediate consequence of this changed state.`
      : 'Close the episode scene with the visible consequence of the changed state.';
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
    || `The protagonist risks a changed identity, relationship, access, or future option because ${trimSentence(concreteTurn, 120)}`;
  const themePressure = cleanText(scene.themePressure)
    || cleanText(context.episodeTheme)
    || `The scene tests what the protagonist will accept, refuse, reveal, or protect under pressure.`;
  const stakesLayers = deriveStakesLayers(scene, concreteTurn, personalStake);
  const residue: SceneResidue[] = (scene.residue && scene.residue.length > 0)
    ? scene.residue
    : [{
        type: deriveResidueType(concreteTurn),
        description: `This scene leaves visible residue: ${trimSentence(afterState, 150)}`,
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
    objective: stripStructuralTreatmentLabels(scene.sequenceIntent?.objective) || stripStructuralTreatmentLabels(scene.dramaticQuestion) || `Move the scene from pressure into a changed state around ${trimSentence(concreteTurn, 90)}.`,
    activity: stripStructuralTreatmentLabels(scene.sequenceIntent?.activity) || `Kylie notices what changes in the room, in her body, and in the way people answer her.`,
    obstacle: stripStructuralTreatmentLabels(scene.sequenceIntent?.obstacle) || stripStructuralTreatmentLabels(scene.conflictEngine) || `The current pressure resists an easy answer.`,
    startState: stripStructuralTreatmentLabels(scene.sequenceIntent?.startState) || beforeState,
    turningPoint: stripStructuralTreatmentLabels(scene.sequenceIntent?.turningPoint) || concreteTurn,
    endState: stripStructuralTreatmentLabels(scene.sequenceIntent?.endState) || afterState,
    visualThread: stripStructuralTreatmentLabels(scene.sequenceIntent?.visualThread) || `Track the visible residue of ${trimSentence(title, 70)}.`,
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
  if (scene.keyBeats.length === 0) {
    scene.keyBeats.push(`PEAK: ${derivation.concreteTurn}`);
  }
  if (!scene.keyBeats.some((beat) => /\bPEAK:/i.test(beat))) {
    scene.keyBeats.push(`PEAK: ${derivation.concreteTurn}`);
  }
  return derivation;
}
