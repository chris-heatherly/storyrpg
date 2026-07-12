import type { Choice, Consequence, Episode } from '../../../types';
import type {
  NarrativeContractGraph,
  NarrativeEventContract,
  NarrativeRealizationLedger,
  NarrativeRealizationRecord,
} from '../../../types/narrativeContract';
import { collectReaderFacingTexts } from '../../validators/encounterTextSurfaces';
import { validateOwnerRealizationTasks } from '../realizationTaskGate';

export interface ContextObligation {
  id: string;
  kind:
    | 'character_arc'
    | 'npc_payoff'
    | 'callback'
    | 'information_reveal'
    | 'branch_residue'
    | 'treatment_required_beat'
    | 'encounter_consequence'
    | 'narrative_dependency';
  description: string;
  dueEpisode?: number;
  sourceEpisode?: number;
  targetNpcId?: string;
  sourceArtifactId?: string;
  sourceEventId?: string;
  targetEventId?: string;
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
  narrativeGraphSourceHash?: string;
  dueContractIds: string[];
  activeContractIds: string[];
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
  assignedEventIds: string[];
  materializedEventIds: string[];
  partiallyRealizedEventIds: string[];
  blockedEventIds: string[];
  plantedObligationIds: string[];
  resolvedObligationIds: string[];
  realizationEvidence: Array<{ contractId: string; sceneId: string; beatId?: string; description: string }>;
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
    dueContractIds: [],
    activeContractIds: [],
  };
}

export function buildEpisodeContextIn(params: {
  storyId: string;
  episodeNumber: number;
  previousContextOut?: EpisodeContextOut | null;
  seed?: Partial<EpisodeContextIn>;
  graph?: NarrativeContractGraph | null;
  realizationLedger?: NarrativeRealizationLedger | null;
}): EpisodeContextIn {
  const base = emptyEpisodeContextIn(params.storyId, params.episodeNumber);
  const previous = params.previousContextOut;
  const resolved = new Set((params.realizationLedger?.records ?? [])
    .filter((record) => record.status === 'resolved')
    .map((record) => record.contractId));
  const activeDependencies = (params.graph?.dependencies ?? []).filter((dependency) =>
    !resolved.has(dependency.id)
    && dependency.sourceEpisodeNumber <= params.episodeNumber
    && dependency.targetEpisodeNumbers.some((target) => target >= params.episodeNumber),
  );
  const dueDependencies = activeDependencies.filter((dependency) =>
    dependency.targetEpisodeNumbers.includes(params.episodeNumber)
    || (dependency.payoffWindow
      && params.episodeNumber >= dependency.payoffWindow.minEpisode
      && params.episodeNumber <= dependency.payoffWindow.maxEpisode),
  );
  const dependencyObligations: ContextObligation[] = dueDependencies.map((dependency) => ({
    id: dependency.id,
    kind: 'narrative_dependency',
    description: dependency.description || `${dependency.relation} from ${dependency.fromEventId}`,
    dueEpisode: params.episodeNumber,
    sourceEpisode: dependency.sourceEpisodeNumber,
    sourceEventId: dependency.fromEventId,
    targetEventId: dependency.toEventId,
  }));
  const carry = (values: ContextObligation[]): ContextObligation[] => uniqueObligations(values);
  return {
    ...base,
    ...params.seed,
    canonFacts: unique([...(params.seed?.canonFacts ?? []), ...(previous?.canonFactsIntroduced ?? [])]),
    activeCharacterArcs: carry([
      ...(params.seed?.activeCharacterArcs ?? []),
      ...(previous?.unresolvedObligations.filter((o) => o.kind === 'character_arc') ?? []),
    ]),
    npcPayoffObligations: carry([
      ...(params.seed?.npcPayoffObligations ?? []),
      ...(previous?.unresolvedObligations.filter((o) => o.kind === 'npc_payoff') ?? []),
    ]),
    unresolvedCallbacks: carry([
      ...(params.seed?.unresolvedCallbacks ?? []),
      ...(previous?.unresolvedObligations.filter((o) => o.kind === 'callback') ?? []),
    ]),
    informationObligations: carry([
      ...(params.seed?.informationObligations ?? []),
      ...(previous?.unresolvedObligations.filter((o) => o.kind === 'information_reveal') ?? []),
    ]),
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
    narrativeGraphSourceHash: params.graph?.sourceHash,
    dueContractIds: unique([...(params.seed?.dueContractIds ?? []), ...dueDependencies.map((dependency) => dependency.id)]),
    activeContractIds: unique([...(params.seed?.activeContractIds ?? []), ...activeDependencies.map((dependency) => dependency.id)]),
    sourceTreatmentObligations: carry([
      ...(params.seed?.sourceTreatmentObligations ?? []),
      ...dependencyObligations,
    ]),
  };
}

export function deriveEpisodeContextOut(params: {
  storyId: string;
  episode: Episode;
  contextIn?: EpisodeContextIn | null;
  graph?: NarrativeContractGraph | null;
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
  const materializedEventIds: string[] = [];
  const assignedEventIds: string[] = [];
  const partiallyRealizedEventIds: string[] = [];
  const blockedEventIds: string[] = [];
  const realizationEvidence: EpisodeContextOut['realizationEvidence'] = [];
  const graphEvents = new Map((params.graph?.events ?? []).map((event) => [event.id, event]));

  const eventEvidenceStatus = (event: NarrativeEventContract, prose: string): 'resolved' | 'partially_realized' | 'blocked' => {
    const requirements = event.evidenceRequirements ?? [];
    const ownerTasks = (params.graph?.realizationTasks ?? []).filter((task) =>
      task.eventId === event.id && task.target.scope === 'owner' && task.blocking,
    );
    if (requirements.length === 0 && ownerTasks.length > 0) {
      const ownerFindings = validateOwnerRealizationTasks({
        sceneId: event.ownerSceneId ?? 'unknown',
        tasks: ownerTasks,
        sceneContent: params.episode.scenes.find((scene) => scene.id === event.ownerSceneId),
        mode: 'final_regression',
      });
      const missing = ownerFindings.filter((finding) => finding.code === 'OWNER_REALIZATION_MISSING');
      if (missing.length === 0) return 'resolved';
      return missing.length < ownerTasks.length ? 'partially_realized' : 'blocked';
    }
    const failed = requirements.filter((requirement) =>
      requirement.blocking
      && !requirement.acceptedPatterns.some((pattern) => requirement.requiredExactText
        ? prose.includes(pattern)
        : new RegExp(`\\b${pattern.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}\\b`, 'i').test(prose)),
    );
    if (failed.length === 0) return 'resolved';
    return failed.length < requirements.filter((requirement) => requirement.blocking).length
      ? 'partially_realized'
      : 'blocked';
  };

  for (const scene of params.episode.scenes ?? []) {
    canonFactsIntroduced.push(`scene:${scene.id}:${scene.name}`);
    const ownership = (scene as unknown as {
      sceneEventOwnership?: { ownedEvents?: Array<{ eventContractId?: string; key?: string; text?: string }> };
    }).sceneEventOwnership;
    const prose = collectReaderFacingTexts(scene as never).join(' ');
    for (const event of ownership?.ownedEvents ?? []) {
      const eventId = event.eventContractId ?? event.key;
      if (!eventId) continue;
      assignedEventIds.push(eventId);
      const contract = graphEvents.get(eventId);
      const status = contract ? eventEvidenceStatus(contract, prose) : 'resolved';
      if (status === 'resolved') materializedEventIds.push(eventId);
      if (status === 'partially_realized') partiallyRealizedEventIds.push(eventId);
      if (status === 'blocked') blockedEventIds.push(eventId);
      realizationEvidence.push({
        contractId: eventId,
        sceneId: scene.id,
        description: `${status}: ${event.text || `Event ${eventId} assigned.`}`,
      });
    }
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
  const materializedSet = new Set(materializedEventIds);
  const plantedObligationIds = (params.graph?.dependencies ?? [])
    .filter((dependency) => materializedSet.has(dependency.fromEventId))
    .map((dependency) => dependency.id);
  const resolvedObligationIds = (params.graph?.dependencies ?? [])
    .filter((dependency) => dependency.toEventId && materializedSet.has(dependency.toEventId))
    .map((dependency) => dependency.id);
  const resolvedDependencyIds = new Set([
    ...resolvedObligationIds,
  ]);
  const dependencyObligations = (params.graph?.dependencies ?? [])
    .filter((dependency) =>
      (params.contextIn?.activeContractIds ?? []).includes(dependency.id)
      && !resolvedDependencyIds.has(dependency.id),
    )
    .map((dependency) => obligation(
      'narrative_dependency',
      dependency.id,
      dependency.description || `${dependency.relation} from ${dependency.fromEventId}`,
      episodeNumber,
    ));
  const unresolvedObligations = uniqueObligations([
    ...(params.contextIn?.activeCharacterArcs ?? []),
    ...(params.contextIn?.npcPayoffObligations ?? []),
    ...(params.contextIn?.unresolvedCallbacks.filter((o) => !paidCallbackIds.has(o.id)) ?? []),
    ...(params.contextIn?.informationObligations ?? []),
    ...(params.contextIn?.sourceTreatmentObligations ?? []),
    ...dependencyObligations,
  ].filter((obligation) => !resolvedDependencyIds.has(obligation.id)));

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
    assignedEventIds: unique(assignedEventIds),
    materializedEventIds: unique(materializedEventIds),
    partiallyRealizedEventIds: unique(partiallyRealizedEventIds),
    blockedEventIds: unique(blockedEventIds),
    plantedObligationIds: unique(plantedObligationIds),
    resolvedObligationIds: unique(resolvedObligationIds),
    realizationEvidence,
  };
}

export function advanceNarrativeRealizationLedger(params: {
  ledger: NarrativeRealizationLedger;
  contextOut: EpisodeContextOut;
  now?: string;
}): NarrativeRealizationLedger {
  const records = new Map(params.ledger.records.map((record) => [record.contractId, {
    ...record,
    evidence: [...record.evidence],
  }]));
  const upsert = (contractId: string, status: NarrativeRealizationRecord['status']) => {
    const current = records.get(contractId);
    const evidence = params.contextOut.realizationEvidence
      .filter((candidate) => candidate.contractId === contractId)
      .map((candidate) => ({
        episodeNumber: params.contextOut.episodeNumber,
        sceneId: candidate.sceneId,
        beatId: candidate.beatId,
        description: candidate.description,
        recordedAt: params.now ?? new Date().toISOString(),
      }));
    records.set(contractId, {
      contractId,
      status: current?.status === 'resolved' ? 'resolved' : status,
      evidence: [...(current?.evidence ?? []), ...evidence],
    });
  };
  for (const eventId of params.contextOut.materializedEventIds) upsert(eventId, 'resolved');
  for (const eventId of params.contextOut.partiallyRealizedEventIds) upsert(eventId, 'partially_realized');
  for (const eventId of params.contextOut.blockedEventIds) upsert(eventId, 'blocked');
  for (const dependencyId of params.contextOut.plantedObligationIds) upsert(dependencyId, 'planted');
  for (const dependencyId of params.contextOut.resolvedObligationIds) upsert(dependencyId, 'resolved');
  return { ...params.ledger, records: [...records.values()] };
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

function uniqueObligations(values: ContextObligation[]): ContextObligation[] {
  const byId = new Map<string, ContextObligation>();
  for (const value of values) {
    if (!value?.id || byId.has(value.id)) continue;
    byId.set(value.id, value);
  }
  return [...byId.values()];
}
