import type {
  NarrativeCharacterPresenceContract,
  NarrativeEncounterParticipationContract,
  NarrativeEventContract,
  NarrativeFirstAppearanceContract,
  NarrativeLexicalArtifactContract,
  NarrativeRouteRealizationContract,
  NarrativeSceneStateContract,
  NarrativeTransitionContract,
  AuthoredEventSemanticIR,
} from '../../types/narrativeContract';
import type { PlannedScene } from '../../types/scenePlan';

function unique(values: Array<string | undefined>): string[] {
  return [...new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value)))];
}

function normalizedCharacterId(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

export function compileLexicalArtifactContracts(input: {
  semanticIr?: AuthoredEventSemanticIR;
  events: NarrativeEventContract[];
  scenes: PlannedScene[];
}): NarrativeLexicalArtifactContract[] {
  if (!input.semanticIr) return [];
  const eventById = new Map(input.events.map((event) => [event.id, event]));
  const scenesByEpisode = new Map<number, PlannedScene[]>();
  for (const scene of input.scenes) {
    const list = scenesByEpisode.get(scene.episodeNumber) ?? [];
    list.push(scene);
    scenesByEpisode.set(scene.episodeNumber, list);
  }
  for (const list of scenesByEpisode.values()) list.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));

  return input.semanticIr.events.flatMap((semanticEvent) => {
    const event = eventById.get(semanticEvent.eventId);
    if (!event?.ownerSceneId) return [];
    const orderedScenes = scenesByEpisode.get(event.episodeNumber) ?? [];
    const ownerIndex = orderedScenes.findIndex((scene) => scene.id === event.ownerSceneId);
    return semanticEvent.propositions.flatMap((proposition) =>
      (proposition.createdLexicalArtifacts ?? []).map((artifact): NarrativeLexicalArtifactContract => ({
        id: `lexical:${artifact.id}`,
        episodeNumber: event.episodeNumber,
        creatorEventId: event.id,
        creatorSceneId: event.ownerSceneId!,
        creatorPropositionId: proposition.id,
        kind: artifact.kind,
        canonicalValue: artifact.canonicalValue,
        creatorParticipantId: artifact.creatorParticipantId,
        routePolicy: artifact.routePolicy,
        allowedAlternatives: [...artifact.allowedAlternatives],
        forbiddenBeforeSceneIds: ownerIndex > 0 ? orderedScenes.slice(0, ownerIndex).map((scene) => scene.id) : [],
        sourceContractIds: [event.id, proposition.id, artifact.id],
        blocking: true,
      })),
    );
  });
}

export function compileSceneStateContracts(input: {
  scenes: PlannedScene[];
  events: NarrativeEventContract[];
}): NarrativeSceneStateContract[] {
  const eventByScene = new Map<string, NarrativeEventContract[]>();
  for (const event of input.events.filter((candidate) => candidate.realizationMode === 'depiction' && candidate.ownerSceneId)) {
    const list = eventByScene.get(event.ownerSceneId!) ?? [];
    list.push(event);
    eventByScene.set(event.ownerSceneId!, list);
  }
  const output: NarrativeSceneStateContract[] = [];
  for (const episodeNumber of [...new Set(input.scenes.map((scene) => scene.episodeNumber))].sort((a, b) => a - b)) {
    const scenes = input.scenes.filter((scene) => scene.episodeNumber === episodeNumber)
      .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
    const orderedEvents = input.events.filter((event) => event.episodeNumber === episodeNumber && event.realizationMode === 'depiction')
      .sort((a, b) => a.sourceOrder - b.sourceOrder || a.id.localeCompare(b.id));
    for (const [sceneOrder, scene] of scenes.entries()) {
      const owned = (eventByScene.get(scene.id) ?? []).sort((a, b) => a.sourceOrder - b.sourceOrder);
      const firstOrder = owned.length > 0 ? Math.min(...owned.map((event) => orderedEvents.findIndex((candidate) => candidate.id === event.id))) : orderedEvents.length;
      const prior = orderedEvents.slice(0, Math.max(0, firstOrder));
      output.push({
        id: `scene-state:${scene.id}`,
        episodeNumber,
        sceneId: scene.id,
        sceneOrder,
        entryLocation: scene.locations[0],
        // A scene owns action at its own location. The following scene owns
        // arrival/orientation at its location through the transition contract;
        // projecting the next location here would invite premature staging.
        exitLocation: scene.locations[0],
        entryTimeOfDay: scene.timeOfDay,
        exitTimeOfDay: scene.timeOfDay,
        beforeState: scene.turnContract?.beforeState,
        afterState: scene.turnContract?.afterState,
        ownedEventIds: owned.map((event) => event.id),
        priorEventIdsWithinEpisode: prior.map((event) => event.id),
        forbiddenRestageEventIds: prior.map((event) => event.id),
        sourceContractIds: unique([scene.spineUnitId, scene.turnContract?.turnId, ...owned.map((event) => event.id)]),
      });
    }
  }
  return output;
}

export function compileFirstAppearanceContracts(input: {
  scenes: PlannedScene[];
  presenceContracts: NarrativeCharacterPresenceContract[];
  firstSightingAnchors?: Array<{
    id: string;
    episodeNumber: number;
    owningSceneId: string;
    npcName?: string;
    firstSighting?: boolean;
    appearanceMode?: 'named_on_page' | 'anonymous_plant' | 'not_applicable';
  }>;
}): NarrativeFirstAppearanceContract[] {
  const candidates = new Map<string, NarrativeFirstAppearanceContract>();
  const sortedScenes = [...input.scenes].sort((a, b) => a.episodeNumber - b.episodeNumber || a.order - b.order || a.id.localeCompare(b.id));
  const sceneIndex = new Map(sortedScenes.map((scene, index) => [scene.id, index]));
  const presenceByCharacter = new Map<string, NarrativeCharacterPresenceContract[]>();
  for (const contract of input.presenceContracts) {
    if (contract.mode === 'offscreen_reference') continue;
    const key = normalizedCharacterId(contract.characterId || contract.characterName);
    const list = presenceByCharacter.get(key) ?? [];
    list.push(contract);
    presenceByCharacter.set(key, list);
  }
  for (const [key, contracts] of presenceByCharacter) {
    const owner = [...contracts].sort((left, right) => (sceneIndex.get(left.sceneId) ?? Number.MAX_SAFE_INTEGER) - (sceneIndex.get(right.sceneId) ?? Number.MAX_SAFE_INTEGER))[0];
    if (!owner) continue;
    const ownerIndex = sceneIndex.get(owner.sceneId) ?? 0;
    candidates.set(key, {
      id: `first-appearance:${key}`,
      characterId: owner.characterId,
      characterName: owner.characterName,
      episodeNumber: owner.episodeNumber,
      owningSceneId: owner.sceneId,
      mode: owner.mode,
      earlierSceneIds: sortedScenes.slice(0, ownerIndex).filter((scene) => scene.episodeNumber === owner.episodeNumber).map((scene) => scene.id),
      sourceContractIds: contracts.map((contract) => contract.id),
      blocking: true,
    });
  }
  for (const anchor of input.firstSightingAnchors ?? []) {
    if (!anchor.firstSighting || !anchor.npcName) continue;
    const key = normalizedCharacterId(anchor.npcName);
    const scene = sortedScenes.find((candidate) => candidate.id === anchor.owningSceneId);
    if (!scene) continue;
    const existingEntry = [...candidates.entries()].find(([candidateKey, candidate]) => {
      const nameKey = normalizedCharacterId(candidate.characterName);
      return candidateKey === key || nameKey === key || candidateKey.endsWith(`-${key}`) || key.endsWith(`-${nameKey}`);
    });
    const existing = existingEntry?.[1];
    if (existingEntry && existingEntry[0] !== key) candidates.delete(existingEntry[0]);
    const ownerIndex = sceneIndex.get(scene.id) ?? 0;
    candidates.set(key, {
      id: `first-appearance:${key}`,
      characterId: existing?.characterId ?? key,
      characterName: existing?.characterName ?? anchor.npcName,
      episodeNumber: anchor.episodeNumber,
      owningSceneId: anchor.owningSceneId,
      mode: anchor.appearanceMode === 'named_on_page' || anchor.appearanceMode === 'anonymous_plant'
        ? anchor.appearanceMode
        : existing?.mode === 'named_on_page' ? 'named_on_page' : 'anonymous_plant',
      earlierSceneIds: sortedScenes.slice(0, ownerIndex).filter((candidate) => candidate.episodeNumber === anchor.episodeNumber).map((candidate) => candidate.id),
      sourceContractIds: unique([...(existing?.sourceContractIds ?? []), anchor.id]),
      blocking: true,
    });
  }
  return [...candidates.values()].sort((a, b) => a.episodeNumber - b.episodeNumber || a.owningSceneId.localeCompare(b.owningSceneId));
}

export function compileRouteRealizationContracts(input: {
  scenes: PlannedScene[];
  events: NarrativeEventContract[];
  transitions: NarrativeTransitionContract[];
}): NarrativeRouteRealizationContract[] {
  return input.scenes.filter((scene) => scene.hasChoice).map((scene) => {
    const targets = input.transitions.filter((transition) => transition.fromSceneId === scene.id).map((transition) => transition.toSceneId);
    const ownedEvents = input.events.filter((event) => event.ownerSceneId === scene.id);
    return {
      id: `route-realization:${scene.id}`,
      episodeNumber: scene.episodeNumber,
      sourceSceneId: scene.id,
      choiceType: scene.choiceType,
      routeInvariantEventIds: ownedEvents.filter((event) => event.routeRealizationPolicy === 'all_routes').map((event) => event.id),
      allowedTargetSceneIds: targets,
      requiresVisibleResidue: scene.choiceType !== 'expression',
      convergencePolicy: targets.length === 0 ? 'episode_terminal' : targets.length === 1 ? 'immediate' : 'branch_then_converge',
      sourceContractIds: unique([scene.spineUnitId, scene.turnContract?.turnId, ...ownedEvents.map((event) => event.id)]),
      blocking: scene.choiceType !== 'expression',
    };
  });
}

export function compileEncounterParticipationContracts(scenes: PlannedScene[]): NarrativeEncounterParticipationContract[] {
  return scenes.filter((scene) => scene.kind === 'encounter' || Boolean(scene.encounter)).map((scene) => ({
    id: `encounter-participation:${scene.id}`,
    episodeNumber: scene.episodeNumber,
    sceneId: scene.id,
    canonicalParticipantIds: unique(scene.npcsInvolved),
    requiredNpcIds: unique(scene.npcsInvolved),
    protagonistRequired: true,
    sourceContractIds: unique([scene.spineUnitId, scene.turnContract?.turnId, ...(scene.encounter?.requiredBeats ?? []).map((beat) => beat.id)]),
    blocking: true,
  }));
}
