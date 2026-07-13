import type { PlannedScene } from '../../types/scenePlan';
import type {
  NarrativeContractGraph,
  NarrativeEventContract,
  NarrativeEvidenceAtom,
  NarrativeEvidenceRequirement,
  NarrativeEvidenceGroup,
  NarrativeRealizationOwnerStage,
  NarrativeRealizationSurface,
  NarrativeRealizationTask,
} from '../../types/narrativeContract';
import { withNarrativeVerificationAuthority } from './realizationVerificationAuthority';

type SceneOwnedTaskKind = 'event' | 'premise' | 'presence' | 'transition' | 'story_circle' | 'relationship';

interface TaskExecutionTarget {
  ownerStage: Exclude<NarrativeRealizationOwnerStage, 'choice_author'>;
  repairHandler: NarrativeRealizationTask['repairHandler'];
  artifactPath?: string;
  surfaces: NarrativeRealizationSurface[];
  temporalSlot: NonNullable<NarrativeEvidenceAtom['temporalSlot']>;
}

function isEncounterScene(scene: PlannedScene | undefined): boolean {
  return Boolean(scene?.kind === 'encounter' || scene?.encounter);
}

function sceneStage(scene: PlannedScene | undefined): NarrativeRealizationOwnerStage {
  if (isEncounterScene(scene)) return 'encounter_architect';
  return 'scene_writer';
}

/** One authoritative mapping from a planned scene to the producer, repair
 * route, artifact, and evidence surfaces that can actually realize a task. */
export function resolveTaskExecutionTarget(input: {
  scene: PlannedScene | undefined;
  episodeNumber: number;
  kind: SceneOwnedTaskKind;
  preferredSurfaces?: NarrativeRealizationSurface[];
}): TaskExecutionTarget {
  const { scene, episodeNumber, kind } = input;
  const encounter = isEncounterScene(scene);
  const scenePath = scene ? `episodes[${episodeNumber}].scenes[${scene.id}]` : undefined;
  if (encounter) {
    const surfaces: NarrativeRealizationSurface[] = kind === 'transition'
      ? ['encounter_entry']
      : kind === 'premise'
        ? ['encounter_entry', 'encounter_setup']
        : kind === 'presence'
          ? ['encounter_entry', 'encounter_setup', 'encounter_phase']
          : ['encounter_entry', 'encounter_setup', 'encounter_phase', 'encounter_outcome', 'terminal_storylet'];
    if (kind === 'relationship') surfaces.push('choice_text', 'choice_outcome');
    return {
      ownerStage: 'encounter_architect',
      repairHandler: 'encounter_route',
      artifactPath: scenePath ? `${scenePath}.encounter` : undefined,
      surfaces,
      temporalSlot: kind === 'transition' ? 'encounter_entry' : 'encounter_route',
    };
  }
  const reachablePreferredSurfaces = input.preferredSurfaces?.filter((surface) =>
    surface === 'beat_text' || surface === 'dialogue' || surface === 'text_variant');
  const surfaces: NarrativeRealizationSurface[] = reachablePreferredSurfaces?.length
    ? reachablePreferredSurfaces
    : kind === 'transition' || kind === 'presence'
      ? ['beat_text', 'dialogue']
      : ['beat_text', 'dialogue', 'text_variant'];
  return {
    ownerStage: 'scene_writer',
    repairHandler: kind === 'premise'
      ? 'premise_realization'
      : kind === 'relationship'
        ? 'relationship_pacing'
        : 'scene_prose',
    artifactPath: scenePath,
    surfaces,
    temporalSlot: kind === 'transition' ? 'pre_choice' : 'owner_event',
  };
}

function premiseAtoms(contract: NonNullable<NarrativeContractGraph['premiseContracts']>[number]): NarrativeEvidenceAtom[] {
  if (contract.evidenceAtoms?.length) {
    return contract.evidenceAtoms.map((atom) => ({
      id: atom.id,
      description: `${contract.fieldName}: ${atom.canonicalFact}`,
      acceptedPatterns: [...atom.acceptedPatterns],
      sourceText: atom.sourceText,
      kind: 'semantic',
      required: atom.required,
    }));
  }
  return contract.evidencePatterns.map((pattern, patternIndex) => ({
    id: `${contract.id}:evidence:${patternIndex + 1}`,
    description: `Opening evidence for ${contract.fieldName}: ${pattern}`,
    acceptedPatterns: [pattern],
    sourceText: contract.sourceText,
    kind: 'semantic',
    // Expose every candidate atom. The task-level threshold below preserves
    // premise semantics: any minimumEvidenceHits candidates may satisfy the
    // contract; the first N source patterns are not privileged.
    required: true,
  }));
}

function surfaceForEventRequirement(
  requirement: NarrativeEvidenceRequirement,
): NarrativeRealizationSurface[] {
  if (requirement.requiredSurface === 'owner_scene') {
    return [
      'beat_text',
      'dialogue',
      'text_variant',
      'encounter_setup',
      'encounter_phase',
      'encounter_outcome',
      'terminal_storylet',
    ];
  }
  return ['encounter_phase', 'encounter_outcome', 'terminal_storylet'];
}

function routePolicyForEventRequirement(
  requirement: NarrativeEvidenceRequirement,
): 'owner_surface' | 'path_required' | 'terminal_required' | 'any_route' {
  if (requirement.requiredSurface !== 'all_routes') return 'owner_surface';
  if (requirement.routeEvidencePosition === 'terminal') return 'terminal_required';
  if (requirement.routeEvidencePosition === 'path') return 'path_required';
  // Rescue is a path event. The threshold/disappearance is the terminal
  // aftermath and must survive on the terminal surface. The id fallback is
  // retained only for version-2 requirements compiled before explicit route
  // placement existed.
  return /threshold|disappear|vanish|gone/i.test(requirement.id) ? 'terminal_required' : 'path_required';
}

function ownerSurfacesForEvent(scene: PlannedScene | undefined): NarrativeRealizationSurface[] {
  return isEncounterScene(scene)
    ? ['encounter_entry', 'encounter_setup', 'encounter_phase', 'encounter_outcome', 'terminal_storylet']
    : ['beat_text', 'dialogue', 'text_variant'];
}

/**
 * Every depiction event needs a minimum owner-stage proof, even when the
 * source did not provide a specialized evidence requirement. Without this
 * fallback, the immutable owner map can be correct while SceneWriter drifts
 * into a neighboring event, which is exactly the failure the Bite Me replay
 * exposed. The source text remains a semantic atom rather than a literal
 * phrase requirement; the realization gate applies its existing normalized
 * paraphrase matching.
 */
function genericEventAtoms(event: NarrativeEventContract): NarrativeEvidenceAtom[] {
  if (event.realizationAtoms?.length) {
    return event.realizationAtoms.map((atom) => ({
      ...atom,
      acceptedPatterns: [...atom.acceptedPatterns],
      subjectIds: atom.subjectIds ? [...atom.subjectIds] : undefined,
      participantIds: atom.participantIds ? [...atom.participantIds] : undefined,
      prerequisiteAtomIds: atom.prerequisiteAtomIds ? [...atom.prerequisiteAtomIds] : undefined,
      referencedLocations: atom.referencedLocations ? [...atom.referencedLocations] : undefined,
    }));
  }
  const sourceText = event.sourceText.trim();
  if (!sourceText) return [];
  return [{
    id: `${event.id}:source-event`,
    description: `Depict the canonical event on its owner surface: ${sourceText}`,
    acceptedPatterns: [sourceText],
    sourceText,
    kind: 'semantic',
    required: true,
  }];
}

function evidenceTokens(value: string): Set<string> {
  return new Set(value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .split(/\s+/)
    .map((word) => word.replace(/(?:ing|ed|es|s)$/i, ''))
    .filter((word) => word.length >= 4 && !['about', 'after', 'from', 'into', 'that', 'their', 'there', 'this', 'with'].includes(word)));
}

function sourceOverlap(left: string, right: string): number {
  const leftTokens = evidenceTokens(left);
  const rightTokens = evidenceTokens(right);
  if (leftTokens.size === 0 || rightTokens.size === 0) return 0;
  let intersection = 0;
  for (const token of leftTokens) if (rightTokens.has(token)) intersection += 1;
  return intersection / Math.min(leftTokens.size, rightTokens.size);
}

function storyCircleProjectionText(contract: { sourceText: string; eventAtoms: string[] }): string {
  return [contract.sourceText, ...contract.eventAtoms].filter(Boolean).join(' ');
}

function ownerTasksForEvent(
  tasks: NarrativeRealizationTask[],
  event: NarrativeEventContract,
): NarrativeRealizationTask[] {
  return tasks.filter((task) =>
    task.canonicalEventId === event.id
    && task.sceneId === event.ownerSceneId
    && (task.id.endsWith(':owner-event') || task.id.endsWith(':choice-resolution'))
  );
}

function eventUsesAllRouteChoiceResolution(event: NarrativeEventContract, scene: PlannedScene | undefined): boolean {
  if (!scene) return false;
  return (scene.relationshipPacing ?? []).some((contract) => {
    const milestone = contract.milestone;
    return milestone?.routeRealizationPolicy === 'all_routes'
      && milestone.choiceSceneId === scene.id
      && sourceOverlap(event.sourceText, milestone.sourceText) >= 0.55;
  });
}

function partitionEventAtoms(
  event: NarrativeEventContract,
  scene: PlannedScene | undefined,
): { owner: NarrativeEvidenceAtom[]; choiceResolution: NarrativeEvidenceAtom[] } {
  const atoms = genericEventAtoms(event);
  if (isEncounterScene(scene) || !eventUsesAllRouteChoiceResolution(event, scene)) {
    return {
      owner: atoms.map((atom) => ({
        ...atom,
        producerStage: sceneStage(scene),
        temporalSlot: isEncounterScene(scene) ? 'encounter_route' : 'owner_event',
      })),
      choiceResolution: [],
    };
  }
  const choiceResolutionIds = new Set(atoms
    .filter((atom) => atom.semanticRole === 'relationship_change' || atom.semanticRole === 'state_change' || atom.semanticRole === 'aftermath')
    .map((atom) => atom.id));
  return {
    owner: atoms
      .filter((atom) => !choiceResolutionIds.has(atom.id))
      .map((atom) => ({ ...atom, producerStage: 'scene_writer', temporalSlot: 'pre_choice' })),
    choiceResolution: atoms
      .filter((atom) => choiceResolutionIds.has(atom.id))
      .map((atom) => ({ ...atom, producerStage: 'choice_author', temporalSlot: 'choice_resolution' })),
  };
}

function eventEvidenceGroup(event: NarrativeEventContract, atoms: NarrativeEvidenceAtom[], suffix: string): NarrativeEvidenceGroup {
  return {
    id: `${event.id}:${suffix}`,
    description: `All blocking ${suffix.replace(/-/g, ' ')} evidence for ${event.id} resolves on its assigned producer surface.`,
    requirement: 'all',
    atomIds: atoms.filter((atom) => atom.required !== false).map((atom) => atom.id),
    blocking: true,
    sourceContractIds: [...event.sourceContractIds],
  };
}

function ensureOwnerTasks(
  tasks: NarrativeRealizationTask[],
  event: NarrativeEventContract,
  scene: PlannedScene | undefined,
): NarrativeRealizationTask[] {
  if (!event.ownerSceneId || event.realizationMode !== 'depiction') return [];
  const existing = ownerTasksForEvent(tasks, event);
  if (existing.length > 0) return existing;
  const partition = partitionEventAtoms(event, scene);
  const created: NarrativeRealizationTask[] = [];
  if (partition.owner.length > 0) {
    const execution = resolveTaskExecutionTarget({
      scene,
      episodeNumber: event.episodeNumber,
      kind: 'event',
    });
    created.push({
      id: `task:${event.id}:owner-event`,
      contractId: event.id,
      canonicalEventId: event.id,
      projectionOf: [],
      sourceKinds: ['event'],
      episodeNumber: event.episodeNumber,
      ownerStage: execution.ownerStage,
      repairHandler: execution.repairHandler,
      sceneId: event.ownerSceneId,
      eventId: event.id,
      artifactPath: execution.artifactPath,
      evidenceAtoms: partition.owner,
      evidenceGroups: [eventEvidenceGroup(event, partition.owner, 'owner')],
      target: { scope: 'owner', surfaces: execution.surfaces },
      sourceContractIds: [...event.sourceContractIds],
      blocking: true,
    });
  }
  if (partition.choiceResolution.length > 0) {
    const ownerTaskId = partition.owner.length > 0 ? `task:${event.id}:owner-event` : undefined;
    created.push({
      id: `task:${event.id}:choice-resolution`,
      contractId: event.id,
      canonicalEventId: event.id,
      projectionOf: [],
      sourceKinds: ['event'],
      episodeNumber: event.episodeNumber,
      ownerStage: 'choice_author',
      repairHandler: 'choice_reauthor',
      sceneId: event.ownerSceneId,
      eventId: event.id,
      prerequisiteTaskIds: ownerTaskId ? [ownerTaskId] : [],
      artifactPath: `episodes[${event.episodeNumber}].scenes[${event.ownerSceneId}].choices`,
      evidenceAtoms: partition.choiceResolution,
      evidenceGroups: [eventEvidenceGroup(event, partition.choiceResolution, 'choice-resolution')],
      target: { scope: 'all_choice_outcomes', surfaces: ['choice_outcome'] },
      sourceContractIds: [...event.sourceContractIds],
      blocking: true,
    });
  }
  tasks.push(...created);
  return created;
}

function mergeProjectionIntoOwnerTask(
  task: NarrativeRealizationTask,
  projectionId: string,
  sourceKind: NonNullable<NarrativeRealizationTask['sourceKinds']>[number],
  sourceContractIds: string[],
  _projectionAtoms: string[],
): void {
  task.projectionOf = Array.from(new Set([...(task.projectionOf ?? []), projectionId]));
  task.sourceKinds = Array.from(new Set([...(task.sourceKinds ?? []), sourceKind]));
  task.sourceContractIds = Array.from(new Set([...task.sourceContractIds, ...sourceContractIds]));
  // Projection prose contributes provenance, not alternative proof. Folding a
  // Story Circle summary into the first event atom lets one broad phrase waive
  // independently required actions and recreates the mega-atom ambiguity this
  // compiler exists to remove.
  const projectionTarget = task.target.scope === 'all_choice_outcomes' ? 'choice-resolution' : 'owner';
  const group: NarrativeEvidenceGroup = {
    id: `${task.canonicalEventId ?? task.contractId}:${projectionTarget}`,
    description: `All blocking projections for ${task.canonicalEventId ?? task.contractId} resolve on the ${projectionTarget.replace('-', ' ')} surface.`,
    requirement: 'all',
    atomIds: task.evidenceAtoms
      .filter((atom) => atom.polarity !== 'forbidden' && atom.required !== false)
      .map((atom) => atom.id),
    blocking: task.blocking,
    sourceContractIds: [...task.sourceContractIds],
  };
  task.evidenceGroups = [group];
}

export class NarrativeTaskCompilerError extends Error {
  readonly code: 'owner_stage_unreachable';

  constructor(message: string) {
    super(`[NarrativeTaskCompiler][owner_stage_unreachable] ${message}`);
    this.name = 'NarrativeTaskCompilerError';
    this.code = 'owner_stage_unreachable';
  }
}

function assertTaskFeasibility(
  tasks: NarrativeRealizationTask[],
  sceneById: Map<string, PlannedScene>,
): void {
  const duplicateTaskIds = tasks
    .map((task) => task.id)
    .filter((taskId, index, ids) => ids.indexOf(taskId) !== index);
  if (duplicateTaskIds.length > 0) {
    throw new Error(`[NarrativeTaskCompiler] Duplicate task ids: ${[...new Set(duplicateTaskIds)].join(', ')}.`);
  }
  const taskById = new Map(tasks.map((task) => [task.id, task]));
  const atomEntries = tasks.flatMap((task) => task.evidenceAtoms.map((atom) => [atom.id, task] as const));
  const duplicateAtomIds = atomEntries
    .map(([atomId]) => atomId)
    .filter((atomId, index, ids) => ids.indexOf(atomId) !== index);
  if (duplicateAtomIds.length > 0) {
    throw new Error(`[NarrativeTaskCompiler] Duplicate evidence atom ids: ${[...new Set(duplicateAtomIds)].join(', ')}.`);
  }
  const taskByAtomId = new Map(atomEntries);
  const stageOrder: Record<NarrativeRealizationOwnerStage, number> = {
    scene_writer: 0,
    choice_author: 1,
    encounter_architect: 1,
  };
  const allowedSurfaces: Record<NarrativeRealizationOwnerStage, Set<NarrativeRealizationSurface>> = {
    scene_writer: new Set(['beat_text', 'dialogue', 'text_variant']),
    choice_author: new Set(['choice_text', 'choice_outcome']),
    encounter_architect: new Set([
      'encounter_entry', 'encounter_setup', 'encounter_phase', 'encounter_outcome', 'terminal_storylet',
      'choice_text', 'choice_outcome', 'text_variant',
    ]),
  };
  for (const task of tasks) {
    if (!task.sceneId) {
      if (task.blocking) throw new NarrativeTaskCompilerError(`Blocking task ${task.id} has no target scene.`);
    } else {
      const scene = sceneById.get(task.sceneId);
      if (!scene) throw new NarrativeTaskCompilerError(`Task ${task.id} targets missing scene ${task.sceneId}.`);
      if (scene.episodeNumber !== task.episodeNumber) {
        throw new NarrativeTaskCompilerError(`Task ${task.id} episode ${task.episodeNumber} targets episode ${scene.episodeNumber} scene ${scene.id}.`);
      }
      if (task.ownerStage === 'encounter_architect' && !isEncounterScene(scene)) {
        throw new NarrativeTaskCompilerError(`Task ${task.id} assigns EncounterArchitect to standard scene ${scene.id}.`);
      }
      if (task.ownerStage === 'scene_writer' && isEncounterScene(scene)) {
        throw new NarrativeTaskCompilerError(`Task ${task.id} assigns SceneWriter to encounter scene ${scene.id}.`);
      }
      if (task.ownerStage === 'choice_author' && isEncounterScene(scene)) {
        throw new NarrativeTaskCompilerError(`Task ${task.id} assigns ChoiceAuthor to EncounterArchitect-owned choices in ${scene.id}.`);
      }
    }
    const unreachableSurfaces = task.target.surfaces.filter((surface) => !allowedSurfaces[task.ownerStage].has(surface));
    if (unreachableSurfaces.length > 0) {
      throw new NarrativeTaskCompilerError(`Task ${task.id} assigns ${task.ownerStage} unreachable surface(s): ${unreachableSurfaces.join(', ')}.`);
    }
    const expectedHandler = task.ownerStage === 'encounter_architect'
      ? 'encounter_route'
      : task.ownerStage === 'choice_author'
        ? 'choice_reauthor'
        : undefined;
    if (expectedHandler && task.repairHandler !== expectedHandler) {
      throw new NarrativeTaskCompilerError(`Task ${task.id} assigns ${task.ownerStage} repair handler ${task.repairHandler}; expected ${expectedHandler}.`);
    }
    if (task.ownerStage === 'choice_author') {
      if (task.target.scope !== 'all_choice_outcomes' && task.target.scope !== 'all_options') {
        throw new Error(`[NarrativeTaskCompiler] ChoiceAuthor task ${task.id} has unreachable target ${task.target.scope}.`);
      }
      if (task.target.scope === 'all_choice_outcomes' && !task.target.surfaces.includes('choice_outcome')) {
        throw new Error(`[NarrativeTaskCompiler] ChoiceAuthor task ${task.id} does not target rendered outcome prose.`);
      }
    }
    if (task.target.scope === 'all_choice_outcomes' && task.ownerStage !== 'choice_author') {
      throw new Error(`[NarrativeTaskCompiler] Outcome task ${task.id} is assigned to ${task.ownerStage}.`);
    }
    const atomIds = new Set(task.evidenceAtoms.map((atom) => atom.id));
    for (const group of task.evidenceGroups ?? []) {
      const danglingAtomIds = group.atomIds.filter((atomId) => !atomIds.has(atomId));
      if (danglingAtomIds.length > 0) {
        throw new Error(`[NarrativeTaskCompiler] Evidence group ${group.id} references missing atoms: ${danglingAtomIds.join(', ')}.`);
      }
      if (group.blocking && group.atomIds.length === 0) {
        throw new Error(`[NarrativeTaskCompiler] Blocking evidence group ${group.id} is empty.`);
      }
    }
    for (const prerequisiteTaskId of task.prerequisiteTaskIds ?? []) {
      const prerequisite = taskById.get(prerequisiteTaskId);
      if (!prerequisite) throw new Error(`[NarrativeTaskCompiler] Task ${task.id} references missing prerequisite task ${prerequisiteTaskId}.`);
      if (prerequisite.episodeNumber !== task.episodeNumber || prerequisite.sceneId !== task.sceneId) {
        throw new Error(`[NarrativeTaskCompiler] Task ${task.id} has a cross-owner prerequisite ${prerequisiteTaskId}.`);
      }
      if (stageOrder[prerequisite.ownerStage] > stageOrder[task.ownerStage]) {
        throw new Error(`[NarrativeTaskCompiler] Task ${task.id} runs before prerequisite task ${prerequisiteTaskId}.`);
      }
    }
    for (const atom of task.evidenceAtoms) {
      if (atom.producerStage && atom.producerStage !== task.ownerStage) {
        throw new Error(`[NarrativeTaskCompiler] Task ${task.id} contains atom ${atom.id} assigned to ${atom.producerStage}.`);
      }
      for (const prerequisiteAtomId of atom.prerequisiteAtomIds ?? []) {
        const prerequisiteTask = taskByAtomId.get(prerequisiteAtomId);
        if (!prerequisiteTask) throw new Error(`[NarrativeTaskCompiler] Atom ${atom.id} references missing prerequisite atom ${prerequisiteAtomId}.`);
        if (stageOrder[prerequisiteTask.ownerStage] > stageOrder[task.ownerStage]) {
          throw new Error(`[NarrativeTaskCompiler] Atom ${atom.id} is assigned before prerequisite atom ${prerequisiteAtomId}.`);
        }
      }
    }
  }
}

function taskCompatibilitySignature(task: NarrativeRealizationTask): string {
  return JSON.stringify({
    contractId: task.contractId,
    canonicalEventId: task.canonicalEventId,
    episodeNumber: task.episodeNumber,
    ownerStage: task.ownerStage,
    repairHandler: task.repairHandler,
    sceneId: task.sceneId,
    eventId: task.eventId,
    evidenceScope: task.evidenceScope,
    artifactPath: task.artifactPath,
    minimumEvidenceHits: task.minimumEvidenceHits,
    target: task.target,
    blocking: task.blocking,
  });
}

/**
 * Multiple planning projections may carry the same canonical contract into a
 * scene. Task derivation is idempotent for equivalent projections, but a reused
 * task id with different ownership or evidence remains a compiler error.
 */
function coalesceEquivalentTasks(tasks: NarrativeRealizationTask[]): NarrativeRealizationTask[] {
  const byId = new Map<string, NarrativeRealizationTask>();
  for (const task of tasks) {
    const existing = byId.get(task.id);
    if (!existing) {
      byId.set(task.id, task);
      continue;
    }
    if (taskCompatibilitySignature(existing) !== taskCompatibilitySignature(task)) {
      throw new Error(`[NarrativeTaskCompiler] Conflicting projections reuse task id ${task.id}.`);
    }
    existing.projectionOf = Array.from(new Set([...(existing.projectionOf ?? []), ...(task.projectionOf ?? [])]));
    existing.sourceKinds = Array.from(new Set([...(existing.sourceKinds ?? []), ...(task.sourceKinds ?? [])]));
    existing.sourceContractIds = Array.from(new Set([...existing.sourceContractIds, ...task.sourceContractIds]));
    existing.prerequisiteTaskIds = Array.from(new Set([...(existing.prerequisiteTaskIds ?? []), ...(task.prerequisiteTaskIds ?? [])]));
    const atomById = new Map(existing.evidenceAtoms.map((atom) => [atom.id, atom]));
    for (const atom of task.evidenceAtoms) {
      const duplicate = atomById.get(atom.id);
      if (duplicate && JSON.stringify(duplicate) !== JSON.stringify(atom)) {
        throw new Error(`[NarrativeTaskCompiler] Conflicting evidence projections reuse atom id ${atom.id}.`);
      }
      if (!duplicate) existing.evidenceAtoms.push(atom);
    }
    existing.evidenceGroups ??= [];
    for (const group of task.evidenceGroups ?? []) {
      const duplicate = existing.evidenceGroups.find((candidate) => candidate.id === group.id);
      if (!duplicate) {
        existing.evidenceGroups.push(group);
        continue;
      }
      const groupShape = ({ atomIds: _atomIds, sourceContractIds: _sourceContractIds, ...value }: NarrativeEvidenceGroup) => value;
      if (JSON.stringify(groupShape(duplicate)) !== JSON.stringify(groupShape(group))) {
        throw new Error(`[NarrativeTaskCompiler] Conflicting evidence groups reuse id ${group.id}.`);
      }
      duplicate.atomIds = Array.from(new Set([...duplicate.atomIds, ...group.atomIds]));
      duplicate.sourceContractIds = Array.from(new Set([...duplicate.sourceContractIds, ...group.sourceContractIds]));
    }
  }
  return [...byId.values()];
}

function targetForEventRequirement(
  requirement: NarrativeEvidenceRequirement,
  outcomeTier: string | undefined,
  scene: PlannedScene | undefined,
): NarrativeRealizationTask['target'] {
  const surfaces = requirement.requiredSurface === 'owner_scene'
    ? ownerSurfacesForEvent(scene)
    : surfaceForEventRequirement(requirement);
  if (requirement.requiredSurface === 'any_route') {
    return {
      scope: 'any_route',
      outcomeTiers: outcomeTier
        ? [outcomeTier]
        : ['victory', 'partialVictory', 'success', 'complicated', 'defeat', 'escape', 'failure'],
      surfaces,
    };
  }
  if (requirement.requiredSurface !== 'all_routes' || !outcomeTier) {
    return { scope: 'owner', surfaces };
  }
  return routePolicyForEventRequirement(requirement) === 'terminal_required'
    ? { scope: 'route_terminal', outcomeTier, surfaces }
    : { scope: 'route_path', outcomeTier, surfaces };
}

export function compileNarrativeRealizationTasks(
  graph: NarrativeContractGraph,
  scenes: PlannedScene[],
): NarrativeRealizationTask[] {
  const sceneById = new Map(scenes.map((scene) => [scene.id, scene]));
  const tasks: NarrativeRealizationTask[] = [];

  for (const premise of graph.premiseContracts ?? []) {
    const sceneId = premise.targetSceneIds[0];
    const execution = resolveTaskExecutionTarget({
      scene: sceneId ? sceneById.get(sceneId) : undefined,
      episodeNumber: premise.episodeNumber,
      kind: 'premise',
      preferredSurfaces: premise.requiredSurface as NarrativeRealizationSurface[],
    });
    tasks.push({
      id: `task:${premise.id}`,
      contractId: premise.id,
      episodeNumber: premise.episodeNumber,
      ownerStage: execution.ownerStage,
      repairHandler: execution.repairHandler,
      sceneId,
      artifactPath: execution.artifactPath,
      evidenceAtoms: premiseAtoms(premise),
      minimumEvidenceHits: premise.minimumEvidenceHits,
      target: { scope: 'owner', surfaces: execution.surfaces },
      sourceContractIds: premise.sourceContractIds,
      blocking: premise.blocking,
    });
  }

  for (const event of graph.events) {
    if (event.realizationMode === 'depiction' && event.ownerSceneId) {
      const scene = sceneById.get(event.ownerSceneId);
      ensureOwnerTasks(tasks, event, scene);
    }
    for (const requirement of event.evidenceRequirements ?? []) {
      const scene = event.ownerSceneId ? sceneById.get(event.ownerSceneId) : undefined;
      const execution = resolveTaskExecutionTarget({
        scene,
        episodeNumber: event.episodeNumber,
        kind: 'event',
      });
      const tiers = requirement.requiredSurface === 'all_routes'
        ? (event.requiredOutcomeTiers ?? ['all-routes'])
        : [undefined];
      for (const outcomeTier of tiers) {
        tasks.push({
          id: `task:${requirement.id}${outcomeTier ? `:route:${outcomeTier}` : ''}`,
          contractId: requirement.id,
          canonicalEventId: event.id,
          sourceKinds: ['event'],
          episodeNumber: event.episodeNumber,
          ownerStage: execution.ownerStage,
          repairHandler: execution.repairHandler,
          sceneId: event.ownerSceneId,
          eventId: event.id,
          artifactPath: execution.artifactPath,
          // acceptedPatterns are alternatives for one authored evidence
          // requirement. Keep them in one atom so the owner gate requires one
          // valid realization, matching NarrativeContractValidator semantics,
          // instead of requiring every synonym on the same route.
          evidenceAtoms: [{
            id: `${requirement.id}:evidence:1${outcomeTier ? `:${outcomeTier}` : ''}`,
            description: `${requirement.kind} evidence for ${event.id}${outcomeTier ? ` on ${outcomeTier}` : ''}: ${requirement.acceptedPatterns.join(' / ')}`,
            acceptedPatterns: [...requirement.acceptedPatterns],
            sourceText: event.sourceText,
            kind: requirement.requiredExactText ? 'lexical' : 'route',
            required: true,
          }],
          target: targetForEventRequirement(requirement, outcomeTier, scene),
          sourceContractIds: event.sourceContractIds,
          blocking: requirement.blocking,
        });
      }
    }
  }

  for (const presence of graph.characterPresenceContracts ?? []) {
    if (presence.mode !== 'named_on_page') continue;
    const execution = resolveTaskExecutionTarget({
      scene: sceneById.get(presence.sceneId),
      episodeNumber: presence.episodeNumber,
      kind: 'presence',
    });
    tasks.push({
      id: `task:${presence.id}:named-introduction`,
      contractId: presence.id,
      episodeNumber: presence.episodeNumber,
      ownerStage: execution.ownerStage,
      repairHandler: execution.repairHandler,
      sceneId: presence.sceneId,
      evidenceScope: { npcId: presence.characterId },
      artifactPath: execution.artifactPath,
      evidenceAtoms: [{
        id: `${presence.id}:name`,
        description: `Name ${presence.characterName} on-page in the canonical introduction scene`,
        acceptedPatterns: [...presence.requiredEvidence],
        sourceText: presence.characterName,
        kind: 'lexical',
        required: true,
      }],
      target: { scope: 'owner', surfaces: execution.surfaces },
      sourceContractIds: [...presence.sourceContractIds],
      blocking: true,
    });
  }

  for (const transition of graph.transitionContracts ?? []) {
    const scene = sceneById.get(transition.toSceneId);
    const execution = resolveTaskExecutionTarget({
      scene,
      episodeNumber: transition.episodeNumber,
      kind: 'transition',
    });
    const evidenceAtoms: NarrativeEvidenceAtom[] = [];
    if (transition.locationRequirement?.required) {
      evidenceAtoms.push({
        id: `${transition.id}:bridge:location`,
        description: `Orient the receiving scene at ${transition.locationRequirement.canonicalValue}`,
        acceptedPatterns: [
          transition.locationRequirement.canonicalValue,
          ...transition.locationRequirement.acceptedAliases,
        ],
        kind: 'semantic',
        matchStrategy: 'location_identity',
        semanticRole: 'location_entry',
        producerStage: execution.ownerStage,
        temporalSlot: execution.temporalSlot,
        stagedLocation: transition.locationRequirement.canonicalValue,
        required: true,
      });
    }
    if (transition.timeRequirement?.required) {
      evidenceAtoms.push({
        id: `${transition.id}:bridge:time`,
        description: `Orient the receiving scene at ${transition.timeRequirement.canonicalValue}`,
        acceptedPatterns: [
          transition.timeRequirement.canonicalValue,
          ...transition.timeRequirement.acceptedAliases,
        ],
        kind: 'semantic',
        matchStrategy: 'temporal_orientation',
        semanticRole: 'temporal_transition',
        producerStage: execution.ownerStage,
        temporalSlot: execution.temporalSlot,
        required: true,
      });
    }
    if (transition.bridgePolicy === 'continuous_action') {
      evidenceAtoms.push({
        id: `${transition.id}:bridge:movement`,
        description: `Show continuous movement from ${transition.fromLocation ?? transition.fromSceneId} to ${transition.toLocation ?? transition.toSceneId}`,
        acceptedPatterns: [`${transition.fromLocation ?? ''} to ${transition.toLocation ?? ''}`.trim()],
        kind: 'semantic',
        matchStrategy: 'transition_action',
        semanticRole: 'transition_bridge',
        producerStage: execution.ownerStage,
        temporalSlot: execution.temporalSlot,
        referencedLocations: [transition.fromLocation, transition.toLocation].filter((value): value is string => Boolean(value)),
        required: true,
      });
    }
    for (const state of transition.stateContracts ?? []) {
      if (!state.blocking || state.requiredEvidence.length === 0) continue;
      evidenceAtoms.push({
        id: `${transition.id}:bridge:state:${state.id}`,
        description: `Carry ${state.subject} into the receiving scene as ${state.toDisposition ?? 'the required state'}`,
        acceptedPatterns: [...new Set([...state.requiredEvidence, state.toDisposition].filter((value): value is string => Boolean(value)))],
        sourceText: state.toDisposition,
        kind: 'semantic',
        matchStrategy: 'state_transition',
        semanticRole: 'state_change',
        subjectIds: [state.subject],
        producerStage: execution.ownerStage,
        temporalSlot: execution.temporalSlot,
        required: true,
      });
    }
    // Version-6 compatibility only. Current graphs compile typed location/time
    // requirements above; legacy artifacts retain their evidence without being
    // mistaken for several independent mandatory facts.
    if (evidenceAtoms.length === 0 && transition.requiredBridgeEvidence.length > 0) {
      evidenceAtoms.push({
        id: `${transition.id}:bridge:legacy`,
        description: `Carry the ${transition.fromSceneId} to ${transition.toSceneId} transition on-page`,
        acceptedPatterns: [...new Set(transition.requiredBridgeEvidence)],
        kind: 'semantic',
        semanticRole: 'transition_bridge',
        producerStage: execution.ownerStage,
        temporalSlot: execution.temporalSlot,
        required: true,
      });
    }
    if (!transition.blocking || evidenceAtoms.length === 0) continue;
    tasks.push({
      id: `task:${transition.id}:bridge`,
      contractId: transition.id,
      episodeNumber: transition.episodeNumber,
      sourceKinds: ['transition'],
      ownerStage: execution.ownerStage,
      repairHandler: execution.repairHandler,
      sceneId: transition.toSceneId,
      artifactPath: execution.artifactPath,
      evidenceAtoms,
      target: { scope: 'owner', surfaces: execution.surfaces },
      sourceContractIds: [...transition.sourceContractIds],
      blocking: true,
    });
  }

  for (const scene of scenes) {
    for (const contract of scene.storyCircleBeatContracts ?? []) {
      if (contract.blockingLevel === 'warning' || !contract.requiredRealization.includes('final_prose')) continue;
      const projectionText = storyCircleProjectionText(contract);
      const matchingEvent = graph.events
        .filter((event) => event.realizationMode === 'depiction' && event.ownerSceneId === scene.id)
        .map((event) => ({ event, overlap: sourceOverlap(event.sourceText, projectionText) }))
        .sort((left, right) => right.overlap - left.overlap)[0];
      if (matchingEvent && matchingEvent.overlap >= 0.55) {
        const ownerTasks = ensureOwnerTasks(tasks, matchingEvent.event, scene);
        if (ownerTasks.length > 0) {
          for (const ownerTask of ownerTasks) {
            mergeProjectionIntoOwnerTask(
              ownerTask,
              contract.id,
              'story_circle',
              [contract.id],
              [contract.sourceText, ...contract.eventAtoms],
            );
          }
          continue;
        }
      }
      const execution = resolveTaskExecutionTarget({
        scene,
        episodeNumber: scene.episodeNumber,
        kind: 'story_circle',
      });
      tasks.push({
        id: `task:${contract.id}:story-circle`,
        contractId: contract.id,
        sourceKinds: ['story_circle'],
        episodeNumber: scene.episodeNumber,
        ownerStage: execution.ownerStage,
        repairHandler: execution.repairHandler,
        sceneId: scene.id,
        artifactPath: execution.artifactPath,
        evidenceAtoms: (contract.eventAtoms.length > 0 ? contract.eventAtoms : [contract.sourceText]).map((atom, index) => ({
          id: `${contract.id}:event:${index + 1}`,
          description: `Realize Story Circle ${contract.beat} event: ${atom}`,
          acceptedPatterns: [atom],
          sourceText: contract.sourceText,
          kind: 'semantic' as const,
          required: true,
        })),
        target: { scope: 'owner', surfaces: execution.surfaces },
        sourceContractIds: [contract.id],
        blocking: true,
      });
    }
    for (const pacing of scene.relationshipPacing ?? []) {
      const milestone = pacing.milestone;
      if (milestone?.routeRealizationPolicy === 'all_routes') {
        const atoms: NarrativeEvidenceAtom[] = [
          {
            id: `${milestone.id}:milestone-id`,
            description: `Every option realizes milestone ${milestone.id}`,
            acceptedPatterns: [`milestone:${milestone.id}`],
            kind: 'lexical',
            required: true,
          },
          {
            id: `${milestone.id}:group-id`,
            description: `Every option targets canonical group ${pacing.groupId ?? milestone.subjectId}`,
            acceptedPatterns: [`group:${pacing.groupId ?? milestone.subjectId}`],
            kind: 'lexical',
            required: true,
          },
          ...milestone.memberNpcIds.flatMap((npcId) => ([
            {
              id: `${milestone.id}:movement:${npcId}`,
              description: `Every option moves canonical member ${npcId}`,
              acceptedPatterns: [`consequence:${npcId}`],
              kind: 'lexical' as const,
              required: true,
            },
            {
              id: `${milestone.id}:evidence:${npcId}`,
              description: `Every option emits relationship evidence for ${npcId}`,
              acceptedPatterns: [`evidence:${npcId}`],
              kind: 'lexical' as const,
              required: true,
            },
          ])),
        ];
        tasks.push({
          id: `task:${milestone.id}:all-options`,
          contractId: milestone.id,
          episodeNumber: scene.episodeNumber,
          ownerStage: 'choice_author',
          repairHandler: 'choice_reauthor',
          sceneId: scene.id,
          evidenceScope: { groupId: pacing.groupId },
          artifactPath: `episodes[${scene.episodeNumber}].scenes[${scene.id}].choices`,
          evidenceAtoms: atoms,
          target: { scope: 'all_options', surfaces: ['choice_text'] },
          sourceContractIds: [pacing.id, milestone.id],
          blocking: true,
        });
      }
      if (pacing.blockedLabels.length === 0) continue;
      const atoms = pacing.blockedLabels.map((label) => ({
        id: `${pacing.id}:${scene.id}:blocked:${label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`,
        description: `Blocked relationship label before ${pacing.targetStage}: ${label}`,
        acceptedPatterns: [label],
        kind: 'relationship_label' as const,
        required: true,
        polarity: 'forbidden' as const,
      }));
      const execution = resolveTaskExecutionTarget({
        scene,
        episodeNumber: scene.episodeNumber,
        kind: 'relationship',
      });
      const relationshipTask: NarrativeRealizationTask = {
        id: `task:${pacing.id}:${scene.id}:relationship-labels`,
        contractId: pacing.id,
        sourceKinds: ['relationship'],
        episodeNumber: scene.episodeNumber,
        ownerStage: execution.ownerStage,
        repairHandler: execution.repairHandler,
        sceneId: scene.id,
        evidenceScope: pacing.npcId ? { npcId: pacing.npcId } : { groupId: pacing.groupId },
        artifactPath: execution.artifactPath,
        evidenceAtoms: atoms,
        target: { scope: 'owner', surfaces: execution.surfaces },
        sourceContractIds: [pacing.id],
        blocking: true,
      };
      tasks.push(relationshipTask);
      if (!isEncounterScene(scene) && scene.hasChoice) {
        tasks.push({
          ...relationshipTask,
          id: `${relationshipTask.id}:choices`,
          ownerStage: 'choice_author',
          repairHandler: 'choice_reauthor',
          artifactPath: `episodes[${scene.episodeNumber}].scenes[${scene.id}].choices`,
          evidenceAtoms: atoms.map((atom) => ({ ...atom, id: `${atom.id}:choice`, producerStage: 'choice_author' })),
          target: { scope: 'all_options', surfaces: ['choice_text'] },
        });
      }
    }
  }

  const coalescedTasks = coalesceEquivalentTasks(tasks).map((task) => ({
    ...task,
    evidenceAtoms: task.evidenceAtoms.map(withNarrativeVerificationAuthority),
  }));
  const canonicalOwnerTasks = new Set<string>();
  for (const task of coalescedTasks) {
    if (!task.blocking || !task.canonicalEventId || (!task.id.endsWith(':owner-event') && !task.id.endsWith(':choice-resolution'))) continue;
    const key = `${task.episodeNumber}|${task.sceneId ?? ''}|${task.ownerStage}|${task.canonicalEventId}`;
    if (canonicalOwnerTasks.has(key)) {
      throw new Error(`[NarrativeTaskCompiler] Duplicate canonical owner task for ${task.canonicalEventId} in scene ${task.sceneId}.`);
    }
    canonicalOwnerTasks.add(key);
  }
  assertTaskFeasibility(coalescedTasks, sceneById);
  for (const task of coalescedTasks) {
    if (!task.blocking) continue;
    const missingAuthority = task.evidenceAtoms.find((atom) => !atom.verificationAuthority);
    if (missingAuthority) {
      throw new Error(`[NarrativeTaskCompiler] Blocking atom ${missingAuthority.id} has no verification authority.`);
    }
  }
  return coalescedTasks.sort((a, b) => a.episodeNumber - b.episodeNumber || a.id.localeCompare(b.id));
}
