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

function canonicalCharacterKey(value: string): string {
  return normalizedCharacterId(
    value
      .replace(/\([^)]*\)/g, ' ')
      .replace(/^char(?:acter)?[\s:_-]+/i, ''),
  );
}

function sameCharacterIdentity(left: { characterId: string; characterName: string }, right: string): boolean {
  const target = canonicalCharacterKey(right);
  const id = canonicalCharacterKey(left.characterId);
  const name = canonicalCharacterKey(left.characterName);
  return target === id
    || target === name
    || id.endsWith(`-${target}`)
    || target.endsWith(`-${id}`)
    || name.endsWith(`-${target}`)
    || target.endsWith(`-${name}`);
}

function normalizedLexicalValue(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

export function compileLexicalArtifactContracts(input: {
  semanticIr?: AuthoredEventSemanticIR;
  events: NarrativeEventContract[];
  scenes: PlannedScene[];
}): NarrativeLexicalArtifactContract[] {
  if (!input.semanticIr) return [];
  const eventById = new Map(input.events.map((event) => [event.id, event]));
  const orderedScenes = [...input.scenes].sort((left, right) =>
    left.episodeNumber - right.episodeNumber
    || left.order - right.order
    || left.id.localeCompare(right.id));
  const sceneIndex = new Map(orderedScenes.map((scene, index) => [scene.id, index]));

  const compiled = input.semanticIr.events.flatMap((semanticEvent) => {
    const event = eventById.get(semanticEvent.eventId);
    if (!event?.ownerSceneId) return [];
    const ownerIndex = sceneIndex.get(event.ownerSceneId) ?? -1;
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

  // r115 (transactional lexical chronology): the semantic-contract LLM
  // compiled TWO creation claims for "Dating After Dusk" — Episode 1
  // correctly naming the blog, and Episode 5 wrongly re-claiming creation
  // when the source only has Victor asking Kylie to wind it down. Episode 5's
  // forbiddenBeforeSceneIds (computed purely from ITS OWN position) then
  // forbade the term in the Episode 1 scene the first contract required it
  // in — a contradiction that shipped uncaught because the one existing
  // duplicate-creator check is scoped per-episode
  // (narrativeContractCompiler.ts's validateGraph groups by
  // `${episodeNumber}:${slug(canonicalValue)}`), which structurally cannot
  // see a cross-episode collision. Reconcile globally here instead: only the
  // EARLIEST creator survives as a creation contract; every later claim on
  // the same canonical value was never a creation and is dropped outright
  // (no forbidden-atom task is compiled for it) — fail-open by construction,
  // never worse than shipping the contradiction.
  const earliestByValue = new Map<string, NarrativeLexicalArtifactContract>();
  for (const contract of compiled) {
    const key = normalizedLexicalValue(contract.canonicalValue);
    const existing = earliestByValue.get(key);
    if (!existing) {
      earliestByValue.set(key, contract);
      continue;
    }
    const existingIndex = sceneIndex.get(existing.creatorSceneId) ?? Number.MAX_SAFE_INTEGER;
    const candidateIndex = sceneIndex.get(contract.creatorSceneId) ?? Number.MAX_SAFE_INTEGER;
    if (candidateIndex < existingIndex) earliestByValue.set(key, contract);
  }
  const survivorIds = new Set([...earliestByValue.values()].map((contract) => contract.id));
  return compiled.filter((contract) => survivorIds.has(contract.id));
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
  /** B1: immutable treatment signature tokens, matched to contracts by NPC name. */
  npcVisualIdentities?: Array<{ name: string; visualIdentity: string }>;
}): NarrativeFirstAppearanceContract[] {
  const candidates = new Map<string, NarrativeFirstAppearanceContract>();
  const anchorOwnedCharacters = new Set<string>();
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
    const existingEntry = [...candidates.entries()].find(([, candidate]) =>
      sameCharacterIdentity(candidate, anchor.npcName!));
    const existing = existingEntry?.[1];
    const ownerIndex = sceneIndex.get(scene.id) ?? 0;
    const existingOwnerIndex = existing ? (sceneIndex.get(existing.owningSceneId) ?? Number.MAX_SAFE_INTEGER) : Number.MAX_SAFE_INTEGER;
    const candidateKey = existingEntry?.[0] ?? key;
    if (existing && anchorOwnedCharacters.has(candidateKey) && existingOwnerIndex <= ownerIndex) {
      existing.sourceContractIds = unique([...existing.sourceContractIds, anchor.id]);
      continue;
    }
    candidates.set(candidateKey, {
      id: existing?.id ?? `first-appearance:${candidateKey}`,
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
    anchorOwnedCharacters.add(candidateKey);
  }
  // B1: attach immutable signature tokens by normalized-name match so the
  // realization compiler can emit advisory signature atoms on the owning scene.
  for (const identity of input.npcVisualIdentities ?? []) {
    const identityKey = normalizedCharacterId(identity.name);
    for (const contract of candidates.values()) {
      const nameKey = normalizedCharacterId(contract.characterName);
      const idKey = normalizedCharacterId(contract.characterId);
      if (nameKey === identityKey || idKey === identityKey || idKey.endsWith(`-${identityKey}`) || identityKey.endsWith(`-${nameKey}`)) {
        contract.visualIdentity = identity.visualIdentity;
      }
    }
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
