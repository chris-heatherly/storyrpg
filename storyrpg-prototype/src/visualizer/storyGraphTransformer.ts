import { Story, Episode, Scene, Beat, Encounter, EncounterPhase, Choice } from '../types';
import { GraphNode, GraphEdge, StoryGraph, NodeType, EdgeType, DEFAULT_LAYOUT_CONFIG } from './types';

export function transformStoryToGraph(story: Story): StoryGraph {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const episodeGroups = new Map<string, string[]>();
  const sceneGroups = new Map<string, string[]>();

  for (const episode of story.episodes) {
    const episodeNodeIds: string[] = [];

    for (const scene of episode.scenes) {
      const sceneNodeIds: string[] = [];

      if (scene.encounter) {
        // Handle encounter scenes
        const encounterNodes = processEncounter(
          scene.encounter,
          scene.id,
          episode.id,
          nodes.length
        );

        for (const node of encounterNodes.nodes) {
          nodes.push(node);
          sceneNodeIds.push(node.id);
          episodeNodeIds.push(node.id);
        }
        edges.push(...encounterNodes.edges);

        // Add edge from previous scene to encounter start
        addSceneEntryEdge(scene, encounterNodes.startNodeId, edges);

      } else {
        // Handle regular beat-based scenes
        const sceneNodes = processScene(scene, episode.id, nodes.length);

        for (const node of sceneNodes.nodes) {
          nodes.push(node);
          sceneNodeIds.push(node.id);
          episodeNodeIds.push(node.id);
        }
        edges.push(...sceneNodes.edges);

        // Add scene entry and exit markers for regular scenes
        if (sceneNodes.startNodeId) {
          addSceneEntryEdge(scene, sceneNodes.startNodeId, edges, sceneNodes.exitNodeId);
        }
      }

      sceneGroups.set(scene.id, sceneNodeIds);
    }

    episodeGroups.set(episode.id, episodeNodeIds);

    // Add scene-to-scene transitions within episode
    addSceneTransitions(episode, edges);
  }

  // Resolve cross-scene references
  resolveSceneReferences(story, edges);

  return {
    nodes,
    edges,
    bounds: { width: 0, height: 0 }, // Calculated by layout engine
    episodeGroups,
    sceneGroups,
  };
}

function processScene(
  scene: Scene,
  episodeId: string,
  startIndex: number
): { nodes: GraphNode[]; edges: GraphEdge[]; startNodeId: string; exitNodeId: string } {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const beatMap = new Map<string, GraphNode>();

  // Process all beats in the scene
  for (const beat of scene.beats) {
    const node = createBeatNode(beat, scene.id, episodeId, startIndex + nodes.length);
    nodes.push(node);
    beatMap.set(beat.id, node);
  }

  // Create edges based on beat connections
  for (const beat of scene.beats) {
    const sourceNode = beatMap.get(beat.id);
    if (!sourceNode) continue;

    // Linear progression via nextBeatId
    if (beat.nextBeatId) {
      const targetNode = beatMap.get(beat.nextBeatId);
      if (targetNode) {
        edges.push({
          id: `edge-${sourceNode.id}-to-${targetNode.id}`,
          source: sourceNode.id,
          target: targetNode.id,
          type: 'next',
          conditioned: false,
        });
      }
    }

    // Scene transition via nextSceneId (will be resolved later)
    if (beat.nextSceneId && !beat.nextBeatId && !beat.choices?.length) {
      edges.push({
        id: `edge-${sourceNode.id}-to-scene-${beat.nextSceneId}`,
        source: sourceNode.id,
        target: `scene-entry-${beat.nextSceneId}`,
        type: 'scene-transition',
        conditioned: false,
      });
    }

    // Choice branches
    if (beat.choices) {
      for (const choice of beat.choices) {
        if (choice.nextBeatId) {
          const targetNode = beatMap.get(choice.nextBeatId);
          if (targetNode) {
            edges.push({
              id: `edge-${sourceNode.id}-choice-${choice.id}-to-${targetNode.id}`,
              source: sourceNode.id,
              target: targetNode.id,
              type: 'choice',
              label: truncateText(choice.text, 30),
              conditioned: !!choice.conditions,
            });
          }
        }

        if (choice.nextSceneId) {
          edges.push({
            id: `edge-${sourceNode.id}-choice-${choice.id}-to-scene-${choice.nextSceneId}`,
            source: sourceNode.id,
            target: `scene-entry-${choice.nextSceneId}`,
            type: 'scene-transition',
            label: truncateText(choice.text, 30),
            conditioned: !!choice.conditions,
          });
        }
      }
    }
  }

  const startNodeId = beatMap.get(scene.startingBeatId)?.id || nodes[0]?.id || '';

  // Find exit node - the last beat that doesn't have a nextBeatId or choices that lead elsewhere
  let exitNodeId = nodes[nodes.length - 1]?.id || '';
  for (let i = scene.beats.length - 1; i >= 0; i--) {
    const beat = scene.beats[i];
    // A beat is an exit if it has no nextBeatId and no choices with nextBeatId
    const hasNextBeat = !!beat.nextBeatId;
    const hasChoiceWithNextBeat = beat.choices?.some(c => c.nextBeatId);
    if (!hasNextBeat && !hasChoiceWithNextBeat) {
      exitNodeId = beatMap.get(beat.id)?.id || exitNodeId;
      break;
    }
  }

  return { nodes, edges, startNodeId, exitNodeId };
}

function processEncounter(
  encounter: Encounter,
  sceneId: string,
  episodeId: string,
  startIndex: number
): { nodes: GraphNode[]; edges: GraphEdge[]; startNodeId: string } {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const phaseMap = new Map<string, GraphNode>();

  // Create a node for each phase
  for (const phase of encounter.phases) {
    const node = createPhaseNode(phase, encounter, sceneId, episodeId, startIndex + nodes.length);
    nodes.push(node);
    phaseMap.set(phase.id, node);
  }

  // Create edges for phase transitions
  for (const phase of encounter.phases) {
    const sourceNode = phaseMap.get(phase.id);
    if (!sourceNode) continue;

    // Success transition
    if (phase.onSuccess?.nextPhaseId) {
      const targetNode = phaseMap.get(phase.onSuccess.nextPhaseId);
      if (targetNode) {
        edges.push({
          id: `edge-${sourceNode.id}-success-to-${targetNode.id}`,
          source: sourceNode.id,
          target: targetNode.id,
          type: 'phase-success',
          label: 'Success',
          conditioned: false,
        });
      }
    }

    // Failure transition
    if (phase.onFailure?.nextPhaseId) {
      const targetNode = phaseMap.get(phase.onFailure.nextPhaseId);
      if (targetNode) {
        edges.push({
          id: `edge-${sourceNode.id}-failure-to-${targetNode.id}`,
          source: sourceNode.id,
          target: targetNode.id,
          type: 'phase-failure',
          label: 'Failure',
          conditioned: false,
        });
      }
    }
  }

  // Add outcome edges (victory/defeat/escape lead to nextSceneId)
  const finalPhases = encounter.phases.filter(
    (p) => !p.onSuccess?.nextPhaseId || !p.onFailure?.nextPhaseId
  );

  for (const phase of finalPhases) {
    const sourceNode = phaseMap.get(phase.id);
    if (!sourceNode) continue;

    if (encounter.outcomes.victory?.nextSceneId && !phase.onSuccess?.nextPhaseId) {
      edges.push({
        id: `edge-${sourceNode.id}-victory-to-scene-${encounter.outcomes.victory.nextSceneId}`,
        source: sourceNode.id,
        target: `scene-entry-${encounter.outcomes.victory.nextSceneId}`,
        type: 'outcome',
        label: 'Victory',
        conditioned: false,
      });
    }

    if (encounter.outcomes.defeat?.nextSceneId && !phase.onFailure?.nextPhaseId) {
      edges.push({
        id: `edge-${sourceNode.id}-defeat-to-scene-${encounter.outcomes.defeat.nextSceneId}`,
        source: sourceNode.id,
        target: `scene-entry-${encounter.outcomes.defeat.nextSceneId}`,
        type: 'outcome',
        label: 'Defeat',
        conditioned: false,
      });
    }
  }

  const startNodeId = phaseMap.get(encounter.startingPhaseId)?.id || nodes[0]?.id || '';

  return { nodes, edges, startNodeId };
}

function createBeatNode(
  beat: Beat,
  sceneId: string,
  episodeId: string,
  index: number
): GraphNode {
  const hasChoices = !!beat.choices && beat.choices.length > 0;
  const hasStatCheck = beat.choices?.some((c) => c.statCheck) || false;
  const hasConditions =
    (beat.textVariants && beat.textVariants.length > 0) ||
    beat.choices?.some((c) => c.conditions !== undefined) ||
    false;
  const hasConsequences =
    (beat.onShow && beat.onShow.length > 0) ||
    beat.choices?.some((c) => c.consequences && c.consequences.length > 0) ||
    false;

  // Use index to guarantee uniqueness even if beat IDs are duplicated
  return {
    id: `beat-${sceneId}-${beat.id}-${index}`,
    type: 'beat',
    label: beat.speaker || truncateText(beat.text, 40),
    sublabel: beat.speaker ? truncateText(beat.text, 30) : undefined,
    data: beat,
    x: 0,
    y: 0,
    width: DEFAULT_LAYOUT_CONFIG.nodeWidth,
    height: DEFAULT_LAYOUT_CONFIG.nodeHeight,
    parentId: sceneId,
    sceneId,
    episodeId,
    depth: index,
    hasConditions,
    hasConsequences,
    hasStatCheck,
    hasChoices,
    image: beat.image,
    choiceCount: beat.choices?.length || 0,
  };
}

function createPhaseNode(
  phase: EncounterPhase,
  encounter: Encounter,
  sceneId: string,
  episodeId: string,
  index: number
): GraphNode {
  // Use index to guarantee uniqueness even if phase IDs are duplicated
  return {
    id: `phase-${sceneId}-${phase.id}-${index}`,
    type: 'phase',
    label: phase.name,
    sublabel: `${encounter.type} - ${encounter.name}`,
    data: phase,
    x: 0,
    y: 0,
    width: DEFAULT_LAYOUT_CONFIG.nodeWidth,
    height: DEFAULT_LAYOUT_CONFIG.nodeHeight,
    parentId: sceneId,
    sceneId,
    episodeId,
    depth: index,
    hasConditions: false,
    hasConsequences:
      (phase.onSuccess?.consequences?.length || 0) > 0 ||
      (phase.onFailure?.consequences?.length || 0) > 0,
    hasStatCheck: phase.beats.some((b) => b.choices?.some((c) => c.statCheck)),
    hasChoices: phase.beats.some((b) => b.choices && b.choices.length > 0),
    image: phase.situationImage,
    choiceCount: phase.beats.reduce((sum, b) => sum + (b.choices?.length || 0), 0),
  };
}

function addSceneEntryEdge(scene: Scene, targetNodeId: string, edges: GraphEdge[], exitNodeId?: string) {
  // Mark the scene entry point for later reference resolution
  edges.push({
    id: `scene-entry-marker-${scene.id}`,
    source: `scene-entry-${scene.id}`,
    target: targetNodeId,
    type: 'next',
    conditioned: !!scene.conditions,
  });

  // Also mark the exit node if provided
  if (exitNodeId) {
    edges.push({
      id: `scene-exit-marker-${scene.id}`,
      source: exitNodeId,
      target: `scene-exit-${scene.id}`,
      type: 'next',
      conditioned: false,
    });
  }
}

function addSceneTransitions(episode: Episode, edges: GraphEdge[]) {
  // Scenes flow sequentially unless overridden by explicit nextSceneId
  for (let i = 0; i < episode.scenes.length - 1; i++) {
    const currentScene = episode.scenes[i];
    const nextScene = episode.scenes[i + 1];

    // Check if there's already an explicit edge to the next scene
    const hasExplicitEdge = edges.some(
      (e) => e.target === `scene-entry-${nextScene.id}` && e.source.includes(currentScene.id)
    );

    if (!hasExplicitEdge) {
      // Add implicit sequential transition
      edges.push({
        id: `implicit-scene-${episode.id}-${currentScene.id}-to-${nextScene.id}`,
        source: `scene-exit-${currentScene.id}`,
        target: `scene-entry-${nextScene.id}`,
        type: 'scene-transition',
        conditioned: !!nextScene.conditions,
      });
    }
  }
}

function resolveSceneReferences(story: Story, edges: GraphEdge[]) {
  // Build maps of scene IDs to their entry and exit node IDs
  const sceneEntryMap = new Map<string, string>();
  const sceneExitMap = new Map<string, string>();

  for (const edge of edges) {
    if (edge.id.startsWith('scene-entry-marker-')) {
      const sceneId = edge.source.replace('scene-entry-', '');
      sceneEntryMap.set(sceneId, edge.target);
    }
    if (edge.id.startsWith('scene-exit-marker-')) {
      const sceneId = edge.target.replace('scene-exit-', '');
      sceneExitMap.set(sceneId, edge.source);
    }
  }

  // Update edges that reference scene entries and exits
  for (const edge of edges) {
    // Resolve scene entry targets
    if (edge.target.startsWith('scene-entry-')) {
      const sceneId = edge.target.replace('scene-entry-', '');
      const actualTarget = sceneEntryMap.get(sceneId);
      if (actualTarget) {
        edge.target = actualTarget;
      }
    }

    // Resolve scene exit sources
    if (edge.source.startsWith('scene-exit-')) {
      const sceneId = edge.source.replace('scene-exit-', '');
      const actualSource = sceneExitMap.get(sceneId);
      if (actualSource) {
        edge.source = actualSource;
      }
    }
  }

  // Remove marker edges
  const markersToRemove = edges.filter(
    (e) => e.id.startsWith('scene-entry-marker-') || e.id.startsWith('scene-exit-marker-')
  );
  for (const marker of markersToRemove) {
    const index = edges.indexOf(marker);
    if (index > -1) {
      edges.splice(index, 1);
    }
  }

  // Remove edges with unresolved references (they would have no valid source/target)
  const unresolvedEdges = edges.filter(
    (e) => e.source.startsWith('scene-exit-') || e.target.startsWith('scene-entry-')
  );
  for (const unresolved of unresolvedEdges) {
    const index = edges.indexOf(unresolved);
    if (index > -1) {
      edges.splice(index, 1);
    }
  }
}

function truncateText(text: unknown, maxLength: number): string {
  // Handle non-string values (LLM sometimes returns objects)
  const str = typeof text === 'string' ? text : String(text || '');
  if (str.length <= maxLength) return str;
  return str.substring(0, maxLength - 3) + '...';
}

export function getNodesByScene(graph: StoryGraph, sceneId: string): GraphNode[] {
  const nodeIds = graph.sceneGroups.get(sceneId) || [];
  return graph.nodes.filter((n) => nodeIds.includes(n.id));
}

export function getNodesByEpisode(graph: StoryGraph, episodeId: string): GraphNode[] {
  const nodeIds = graph.episodeGroups.get(episodeId) || [];
  return graph.nodes.filter((n) => nodeIds.includes(n.id));
}

export function getConnectedNodes(graph: StoryGraph, nodeId: string): GraphNode[] {
  const connectedIds = new Set<string>();

  for (const edge of graph.edges) {
    if (edge.source === nodeId) {
      connectedIds.add(edge.target);
    }
    if (edge.target === nodeId) {
      connectedIds.add(edge.source);
    }
  }

  return graph.nodes.filter((n) => connectedIds.has(n.id));
}

export function getOutgoingEdges(graph: StoryGraph, nodeId: string): GraphEdge[] {
  return graph.edges.filter((e) => e.source === nodeId);
}

export function getIncomingEdges(graph: StoryGraph, nodeId: string): GraphEdge[] {
  return graph.edges.filter((e) => e.target === nodeId);
}
