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

function sceneStage(scene: PlannedScene | undefined): NarrativeRealizationOwnerStage {
  if (scene?.kind === 'encounter' || scene?.encounter) return 'encounter_architect';
  return 'scene_writer';
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
  return scene?.kind === 'encounter' || scene?.encounter
    ? ['encounter_setup', 'encounter_phase', 'encounter_outcome', 'terminal_storylet']
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

function ownerTaskForEvent(
  tasks: NarrativeRealizationTask[],
  event: NarrativeEventContract,
  scene: PlannedScene | undefined,
): NarrativeRealizationTask | undefined {
  return tasks.find((task) =>
    task.canonicalEventId === event.id
    && task.sceneId === event.ownerSceneId
    && task.target.scope === 'owner'
    && task.ownerStage === sceneStage(scene),
  );
}

function ensureOwnerTask(
  tasks: NarrativeRealizationTask[],
  event: NarrativeEventContract,
  scene: PlannedScene | undefined,
): NarrativeRealizationTask | undefined {
  if (!event.ownerSceneId || event.realizationMode !== 'depiction') return undefined;
  const existing = ownerTaskForEvent(tasks, event, scene);
  if (existing) return existing;
  const evidenceAtoms = genericEventAtoms(event);
  if (evidenceAtoms.length === 0) return undefined;
  const task: NarrativeRealizationTask = {
    id: `task:${event.id}:owner-event`,
    contractId: event.id,
    canonicalEventId: event.id,
    projectionOf: [],
    sourceKinds: ['event'],
    episodeNumber: event.episodeNumber,
    ownerStage: sceneStage(scene),
    repairHandler: scene?.kind === 'encounter' || scene?.encounter ? 'encounter_route' : 'scene_prose',
    sceneId: event.ownerSceneId,
    eventId: event.id,
    artifactPath: `episodes[${event.episodeNumber}].scenes[${event.ownerSceneId}]`,
    evidenceAtoms,
    evidenceGroups: [{
      id: `${event.id}:owner`,
      description: `All blocking projections for ${event.id} resolve on one owner surface.`,
      requirement: 'all',
      atomIds: evidenceAtoms.filter((atom) => atom.required !== false).map((atom) => atom.id),
      blocking: true,
      sourceContractIds: [...event.sourceContractIds],
    }],
    target: { scope: 'owner', surfaces: ownerSurfacesForEvent(scene) },
    sourceContractIds: [...event.sourceContractIds],
    blocking: true,
  };
  tasks.push(task);
  return task;
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
  const group: NarrativeEvidenceGroup = {
    id: `${task.canonicalEventId ?? task.contractId}:owner`,
    description: `All blocking projections for ${task.canonicalEventId ?? task.contractId} resolve on one owner surface.`,
    requirement: 'all',
    atomIds: task.evidenceAtoms
      .filter((atom) => atom.polarity !== 'forbidden' && atom.required !== false)
      .map((atom) => atom.id),
    blocking: task.blocking,
    sourceContractIds: [...task.sourceContractIds],
  };
  task.evidenceGroups = [group];
}

function targetForEventRequirement(
  requirement: NarrativeEvidenceRequirement,
  outcomeTier: string | undefined,
): NarrativeRealizationTask['target'] {
  const surfaces = surfaceForEventRequirement(requirement);
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
    tasks.push({
      id: `task:${premise.id}`,
      contractId: premise.id,
      episodeNumber: premise.episodeNumber,
      ownerStage: 'scene_writer',
      repairHandler: 'premise_realization',
      sceneId,
      artifactPath: sceneId ? `episodes[${premise.episodeNumber}].scenes[${sceneId}]` : undefined,
      evidenceAtoms: premiseAtoms(premise),
      minimumEvidenceHits: premise.minimumEvidenceHits,
      target: { scope: 'owner', surfaces: premise.requiredSurface as NarrativeRealizationSurface[] },
      sourceContractIds: premise.sourceContractIds,
      blocking: premise.blocking,
    });
  }

  for (const event of graph.events) {
    if (event.realizationMode === 'depiction' && !(event.evidenceRequirements?.length) && event.ownerSceneId) {
      const scene = sceneById.get(event.ownerSceneId);
      ensureOwnerTask(tasks, event, scene);
    }
    for (const requirement of event.evidenceRequirements ?? []) {
      const scene = event.ownerSceneId ? sceneById.get(event.ownerSceneId) : undefined;
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
          ownerStage: sceneStage(scene),
          repairHandler: scene?.kind === 'encounter' || scene?.encounter ? 'encounter_route' : 'scene_prose',
          sceneId: event.ownerSceneId,
          eventId: event.id,
          artifactPath: event.ownerSceneId ? `episodes[${event.episodeNumber}].scenes[${event.ownerSceneId}].encounter` : undefined,
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
          target: targetForEventRequirement(requirement, outcomeTier),
          sourceContractIds: event.sourceContractIds,
          blocking: requirement.blocking,
        });
      }
    }
  }

  for (const presence of graph.characterPresenceContracts ?? []) {
    if (presence.mode !== 'named_on_page') continue;
    tasks.push({
      id: `task:${presence.id}:named-introduction`,
      contractId: presence.id,
      episodeNumber: presence.episodeNumber,
      ownerStage: 'scene_writer',
      repairHandler: 'scene_prose',
      sceneId: presence.sceneId,
      evidenceScope: { npcId: presence.characterId },
      artifactPath: `episodes[${presence.episodeNumber}].scenes[${presence.sceneId}]`,
      evidenceAtoms: [{
        id: `${presence.id}:name`,
        description: `Name ${presence.characterName} on-page in the canonical introduction scene`,
        acceptedPatterns: [...presence.requiredEvidence],
        sourceText: presence.characterName,
        kind: 'lexical',
        required: true,
      }],
      target: { scope: 'owner', surfaces: ['beat_text', 'dialogue'] },
      sourceContractIds: [...presence.sourceContractIds],
      blocking: true,
    });
  }

  for (const transition of graph.transitionContracts ?? []) {
    const evidence = [
      ...(transition.requiredBridgeEvidence ?? []),
      ...(transition.stateContracts ?? []).flatMap((state) => state.requiredEvidence ?? []),
    ].filter(Boolean);
    if (!transition.blocking || evidence.length === 0) continue;
    tasks.push({
      id: `task:${transition.id}:bridge`,
      contractId: transition.id,
      episodeNumber: transition.episodeNumber,
      ownerStage: 'scene_writer',
      repairHandler: 'scene_prose',
      sceneId: transition.toSceneId,
      artifactPath: `episodes[${transition.episodeNumber}].scenes[${transition.toSceneId}]`,
      evidenceAtoms: [...new Set(evidence)].map((pattern, index) => ({
        id: `${transition.id}:bridge:${index + 1}`,
        description: `Carry the ${transition.fromSceneId} to ${transition.toSceneId} transition on-page: ${pattern}`,
        acceptedPatterns: [pattern],
        kind: 'semantic' as const,
        required: true,
      })),
      target: { scope: 'owner', surfaces: ['beat_text', 'dialogue'] },
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
        const ownerTask = ensureOwnerTask(tasks, matchingEvent.event, scene);
        if (ownerTask) {
          mergeProjectionIntoOwnerTask(
            ownerTask,
            contract.id,
            'story_circle',
            [contract.id],
            [contract.sourceText, ...contract.eventAtoms],
          );
          continue;
        }
      }
      tasks.push({
        id: `task:${contract.id}:story-circle`,
        contractId: contract.id,
        sourceKinds: ['story_circle'],
        episodeNumber: scene.episodeNumber,
        ownerStage: 'scene_writer',
        repairHandler: 'scene_prose',
        sceneId: scene.id,
        artifactPath: `episodes[${scene.episodeNumber}].scenes[${scene.id}]`,
        evidenceAtoms: (contract.eventAtoms.length > 0 ? contract.eventAtoms : [contract.sourceText]).map((atom, index) => ({
          id: `${contract.id}:event:${index + 1}`,
          description: `Realize Story Circle ${contract.beat} event: ${atom}`,
          acceptedPatterns: [atom],
          sourceText: contract.sourceText,
          kind: 'semantic' as const,
          required: true,
        })),
        target: { scope: 'owner', surfaces: ['beat_text', 'dialogue', 'text_variant'] },
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
      const atoms = pacing.blockedLabels.map((label, index) => ({
        id: `${pacing.id}:blocked:${index + 1}`,
        description: `Blocked relationship label before ${pacing.targetStage}: ${label}`,
        acceptedPatterns: [label],
        kind: 'relationship_label' as const,
        required: true,
        polarity: 'forbidden' as const,
      }));
      tasks.push({
        id: `task:${pacing.id}:relationship-labels`,
        contractId: pacing.id,
        episodeNumber: scene.episodeNumber,
        ownerStage: 'scene_writer',
        repairHandler: 'relationship_pacing',
        sceneId: scene.id,
        evidenceScope: pacing.npcId ? { npcId: pacing.npcId } : { groupId: pacing.groupId },
        artifactPath: `episodes[${scene.episodeNumber}].scenes[${scene.id}]`,
        evidenceAtoms: atoms,
        target: { scope: 'owner', surfaces: ['beat_text', 'dialogue', 'choice_text'] },
        sourceContractIds: [pacing.id],
        blocking: true,
      });
    }
  }

  const canonicalOwnerTasks = new Set<string>();
  for (const task of tasks) {
    if (!task.blocking || !task.canonicalEventId || !task.id.endsWith(':owner-event')) continue;
    const key = `${task.episodeNumber}|${task.sceneId ?? ''}|${task.ownerStage}|${task.canonicalEventId}`;
    if (canonicalOwnerTasks.has(key)) {
      throw new Error(`[NarrativeTaskCompiler] Duplicate canonical owner task for ${task.canonicalEventId} in scene ${task.sceneId}.`);
    }
    canonicalOwnerTasks.add(key);
  }
  return tasks.sort((a, b) => a.episodeNumber - b.episodeNumber || a.id.localeCompare(b.id));
}
