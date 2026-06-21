import type { Choice, Consequence, Episode } from '../../../types';

export interface ContextObligation {
  id: string;
  kind:
    | 'character_arc'
    | 'npc_payoff'
    | 'callback'
    | 'information_reveal'
    | 'branch_residue'
    | 'treatment_required_beat'
    | 'encounter_consequence';
  description: string;
  dueEpisode?: number;
  sourceEpisode?: number;
  targetNpcId?: string;
  sourceArtifactId?: string;
}

export interface EpisodeContextIn {
  storyId: string;
  episodeNumber: number;
  canonFacts: string[];
  activeCharacterArcs: ContextObligation[];
  npcPayoffObligations: ContextObligation[];
  unresolvedCallbacks: ContextObligation[];
  informationObligations: ContextObligation[];
  branchAxes: string[];
  visibleConsequences: string[];
  encounterResidue: string[];
  flags: string[];
  scores: string[];
  tags: string[];
  visualContinuity: string[];
  sourceTreatmentObligations: ContextObligation[];
  previousEpisodeHandoff?: string;
}

export interface EpisodeContextOut {
  storyId: string;
  episodeNumber: number;
  canonFactsIntroduced: string[];
  characterArcMovement: ContextObligation[];
  npcStateChanges: ContextObligation[];
  relationshipDeltas: Array<{ npcId: string; dimension: string; change: number; sourceChoiceId?: string }>;
  identityDeltas: Array<{ axis: string; direction: string; sourceChoiceId?: string }>;
  callbackPlants: ContextObligation[];
  callbackPayoffs: ContextObligation[];
  informationReveals: ContextObligation[];
  branchOutcomes: ContextObligation[];
  flagsIntroduced: string[];
  flagsConsumed: string[];
  scoresChanged: string[];
  tagsIntroduced: string[];
  unresolvedObligations: ContextObligation[];
  visualContinuity: string[];
  episodeHandoff?: string;
}

export function emptyEpisodeContextIn(storyId: string, episodeNumber: number): EpisodeContextIn {
  return {
    storyId,
    episodeNumber,
    canonFacts: [],
    activeCharacterArcs: [],
    npcPayoffObligations: [],
    unresolvedCallbacks: [],
    informationObligations: [],
    branchAxes: [],
    visibleConsequences: [],
    encounterResidue: [],
    flags: [],
    scores: [],
    tags: [],
    visualContinuity: [],
    sourceTreatmentObligations: [],
  };
}

export function buildEpisodeContextIn(params: {
  storyId: string;
  episodeNumber: number;
  previousContextOut?: EpisodeContextOut | null;
  seed?: Partial<EpisodeContextIn>;
}): EpisodeContextIn {
  const base = emptyEpisodeContextIn(params.storyId, params.episodeNumber);
  const previous = params.previousContextOut;
  return {
    ...base,
    ...params.seed,
    canonFacts: unique([...(params.seed?.canonFacts ?? []), ...(previous?.canonFactsIntroduced ?? [])]),
    activeCharacterArcs: [
      ...(params.seed?.activeCharacterArcs ?? []),
      ...(previous?.unresolvedObligations.filter((o) => o.kind === 'character_arc') ?? []),
    ],
    npcPayoffObligations: [
      ...(params.seed?.npcPayoffObligations ?? []),
      ...(previous?.unresolvedObligations.filter((o) => o.kind === 'npc_payoff') ?? []),
    ],
    unresolvedCallbacks: [
      ...(params.seed?.unresolvedCallbacks ?? []),
      ...(previous?.unresolvedObligations.filter((o) => o.kind === 'callback') ?? []),
    ],
    informationObligations: [
      ...(params.seed?.informationObligations ?? []),
      ...(previous?.unresolvedObligations.filter((o) => o.kind === 'information_reveal') ?? []),
    ],
    branchAxes: unique([...(params.seed?.branchAxes ?? []), ...(previous?.branchOutcomes.map((o) => o.id) ?? [])]),
    visibleConsequences: unique([
      ...(params.seed?.visibleConsequences ?? []),
      ...(previous?.relationshipDeltas.map((d) => `${d.npcId}:${d.dimension}:${d.change}`) ?? []),
      ...(previous?.identityDeltas.map((d) => `${d.axis}:${d.direction}`) ?? []),
    ]),
    flags: unique([...(params.seed?.flags ?? []), ...(previous?.flagsIntroduced ?? [])]),
    scores: unique([...(params.seed?.scores ?? []), ...(previous?.scoresChanged ?? [])]),
    tags: unique([...(params.seed?.tags ?? []), ...(previous?.tagsIntroduced ?? [])]),
    visualContinuity: unique([...(params.seed?.visualContinuity ?? []), ...(previous?.visualContinuity ?? [])]),
    previousEpisodeHandoff: params.seed?.previousEpisodeHandoff ?? previous?.episodeHandoff,
  };
}

export function deriveEpisodeContextOut(params: {
  storyId: string;
  episode: Episode;
  contextIn?: EpisodeContextIn | null;
}): EpisodeContextOut {
  const episodeNumber = params.episode.number;
  const callbackPlants: ContextObligation[] = [];
  const callbackPayoffs: ContextObligation[] = [];
  const informationReveals: ContextObligation[] = [];
  const branchOutcomes: ContextObligation[] = [];
  const relationshipDeltas: EpisodeContextOut['relationshipDeltas'] = [];
  const identityDeltas: EpisodeContextOut['identityDeltas'] = [];
  const flagsIntroduced: string[] = [];
  const flagsConsumed: string[] = [];
  const scoresChanged: string[] = [];
  const tagsIntroduced: string[] = [];
  const visualContinuity: string[] = [];
  const canonFactsIntroduced: string[] = [];

  for (const scene of params.episode.scenes ?? []) {
    canonFactsIntroduced.push(`scene:${scene.id}:${scene.name}`);
    if (scene.branchType) branchOutcomes.push(obligation('branch_residue', `branch:${scene.id}`, `Scene ${scene.id} carries ${scene.branchType} branch tone.`, episodeNumber));
    if (scene.timeline?.location) visualContinuity.push(`location:${scene.timeline.location}`);
    if (scene.timeline?.timeOfDay) visualContinuity.push(`time:${scene.timeline.timeOfDay}`);

    for (const beat of scene.beats ?? []) {
      for (const hookId of beat.callbackHookIds ?? []) {
        callbackPlants.push(obligation('callback', hookId, `Callback hook planted at ${scene.id}/${beat.id}.`, episodeNumber));
      }
      for (const variant of beat.textVariants ?? []) {
        if (variant.callbackHookId) {
          callbackPayoffs.push(obligation('callback', variant.callbackHookId, `Callback hook paid off at ${scene.id}/${beat.id}.`, episodeNumber));
        }
      }
      for (const choice of beat.choices ?? []) {
        visitChoice(choice, {
          episodeNumber,
          flagsIntroduced,
          flagsConsumed,
          scoresChanged,
          tagsIntroduced,
          relationshipDeltas,
          identityDeltas,
          branchOutcomes,
        });
      }
    }
  }

  const paidCallbackIds = new Set(callbackPayoffs.map((o) => o.id));
  const unresolvedObligations = [
    ...(params.contextIn?.activeCharacterArcs ?? []),
    ...(params.contextIn?.npcPayoffObligations ?? []),
    ...(params.contextIn?.unresolvedCallbacks.filter((o) => !paidCallbackIds.has(o.id)) ?? []),
    ...(params.contextIn?.informationObligations ?? []),
    ...(params.contextIn?.sourceTreatmentObligations ?? []),
  ];

  return {
    storyId: params.storyId,
    episodeNumber,
    canonFactsIntroduced: unique(canonFactsIntroduced),
    characterArcMovement: identityDeltas.map((delta) =>
      obligation('character_arc', `${delta.axis}:${delta.direction}`, `Identity moved ${delta.axis} toward ${delta.direction}.`, episodeNumber)
    ),
    npcStateChanges: relationshipDeltas.map((delta) =>
      obligation('npc_payoff', `${delta.npcId}:${delta.dimension}`, `${delta.npcId} ${delta.dimension} changed by ${delta.change}.`, episodeNumber, delta.npcId)
    ),
    relationshipDeltas,
    identityDeltas,
    callbackPlants,
    callbackPayoffs,
    informationReveals,
    branchOutcomes,
    flagsIntroduced: unique(flagsIntroduced),
    flagsConsumed: unique(flagsConsumed),
    scoresChanged: unique(scoresChanged),
    tagsIntroduced: unique(tagsIntroduced),
    unresolvedObligations,
    visualContinuity: unique(visualContinuity),
    episodeHandoff: lastSceneHandoff(params.episode),
  };
}

function visitChoice(
  choice: Choice,
  state: {
    episodeNumber: number;
    flagsIntroduced: string[];
    flagsConsumed: string[];
    scoresChanged: string[];
    tagsIntroduced: string[];
    relationshipDeltas: EpisodeContextOut['relationshipDeltas'];
    identityDeltas: EpisodeContextOut['identityDeltas'];
    branchOutcomes: ContextObligation[];
  },
): void {
  if (choice.conditions) {
    collectConditionRefs(choice.conditions, state.flagsConsumed);
  }
  if (choice.nextSceneId) {
    state.branchOutcomes.push(obligation(
      'branch_residue',
      choice.id,
      `Choice ${choice.id} routes to ${choice.nextSceneId}.`,
      state.episodeNumber,
    ));
  }
  for (const consequence of choice.consequences ?? []) {
    visitConsequence(consequence, choice.id, state);
  }
}

function visitConsequence(
  consequence: Consequence,
  sourceChoiceId: string,
  state: {
    flagsIntroduced: string[];
    scoresChanged: string[];
    tagsIntroduced: string[];
    relationshipDeltas: EpisodeContextOut['relationshipDeltas'];
    identityDeltas: EpisodeContextOut['identityDeltas'];
  },
): void {
  switch (consequence.type) {
    case 'setFlag':
      if (typeof consequence.flag !== 'string' || consequence.flag.trim().length === 0) break;
      state.flagsIntroduced.push(consequence.flag);
      if (consequence.flag.startsWith('arc:')) {
        const [, axis, direction = 'changed'] = consequence.flag.split(':');
        state.identityDeltas.push({ axis: axis || consequence.flag, direction, sourceChoiceId });
      }
      break;
    case 'changeScore':
    case 'setScore':
      if (typeof consequence.score === 'string' && consequence.score.trim().length > 0) {
        state.scoresChanged.push(consequence.score);
      }
      break;
    case 'addTag':
      if (typeof consequence.tag === 'string' && consequence.tag.trim().length > 0) {
        state.tagsIntroduced.push(consequence.tag);
      }
      break;
    case 'relationship':
      if (typeof consequence.npcId !== 'string' || consequence.npcId.trim().length === 0) break;
      state.relationshipDeltas.push({
        npcId: consequence.npcId,
        dimension: consequence.dimension,
        change: consequence.change,
        sourceChoiceId,
      });
      break;
    default:
      break;
  }
}

function collectConditionRefs(condition: unknown, flags: string[]): void {
  if (!condition || typeof condition !== 'object') return;
  const obj = condition as Record<string, unknown>;
  if (typeof obj.flag === 'string') flags.push(obj.flag);
  if (Array.isArray(obj.conditions)) obj.conditions.forEach((child) => collectConditionRefs(child, flags));
  if (obj.condition) collectConditionRefs(obj.condition, flags);
}

function obligation(
  kind: ContextObligation['kind'],
  id: string,
  description: string,
  episodeNumber: number,
  targetNpcId?: string,
): ContextObligation {
  return {
    id,
    kind,
    description,
    sourceEpisode: episodeNumber,
    targetNpcId,
  };
}

function lastSceneHandoff(episode: Episode): string | undefined {
  const lastScene = episode.scenes?.[episode.scenes.length - 1];
  const lastBeat = lastScene?.beats?.[lastScene.beats.length - 1];
  if (!lastScene || !lastBeat) return undefined;
  return `${lastScene.id}/${lastBeat.id}`;
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter((value) => value && value.trim().length > 0)));
}
