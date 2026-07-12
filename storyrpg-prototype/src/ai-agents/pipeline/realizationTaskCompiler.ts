import type { PlannedScene } from '../../types/scenePlan';
import type {
  NarrativeContractGraph,
  NarrativeEvidenceAtom,
  NarrativeEvidenceRequirement,
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
    for (const requirement of event.evidenceRequirements ?? []) {
      const scene = event.ownerSceneId ? sceneById.get(event.ownerSceneId) : undefined;
      const tiers = requirement.requiredSurface === 'all_routes'
        ? (event.requiredOutcomeTiers ?? ['all-routes'])
        : [undefined];
      for (const outcomeTier of tiers) {
        tasks.push({
          id: `task:${requirement.id}${outcomeTier ? `:route:${outcomeTier}` : ''}`,
          contractId: requirement.id,
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

  for (const scene of scenes) {
    for (const pacing of scene.relationshipPacing ?? []) {
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

  return tasks.sort((a, b) => a.episodeNumber - b.episodeNumber || a.id.localeCompare(b.id));
}
