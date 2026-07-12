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
      tasks.push({
        id: `task:${contract.id}:story-circle`,
        contractId: contract.id,
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

  return tasks.sort((a, b) => a.episodeNumber - b.episodeNumber || a.id.localeCompare(b.id));
}
