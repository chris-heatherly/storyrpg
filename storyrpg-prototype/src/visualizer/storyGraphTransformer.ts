// @ts-nocheck — TODO(tech-debt): Phase 7 data-model consolidation.
import { Story, Episode, Scene, Beat, Encounter, EncounterPhase, Choice, EncounterChoiceOutcome } from '../types';
import { GraphNode, GraphEdge, StoryGraph, NodeType, EdgeType, DEFAULT_LAYOUT_CONFIG } from './types';
import { mediaRefAsString } from '../assets/assetRef';
import { PROXY_CONFIG } from '../config/endpoints';
import { normalizeVisualizerText } from './displayText';

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
        const sceneNodes = processScene(scene, episode, story.outputDir, storyHasGeneratedEpisodeArt(story), nodes.length);

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
  episode: Episode,
  outputDir: string | undefined,
  allowGeneratedImageFallbacks: boolean,
  startIndex: number
): { nodes: GraphNode[]; edges: GraphEdge[]; startNodeId: string; exitNodeId: string } {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const beatMap = new Map<string, GraphNode>();

  // Process all beats in the scene
  for (const [beatIndex, beat] of scene.beats.entries()) {
    const node = createBeatNode(beat, scene, episode, outputDir, allowGeneratedImageFallbacks, beatIndex, startIndex + nodes.length);
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

    if (!beat.nextBeatId && !beat.nextSceneId && !beat.choices?.length && scene.leadsTo?.length === 1) {
      edges.push({
        id: `edge-${sourceNode.id}-to-scene-${scene.leadsTo[0]}`,
        source: sourceNode.id,
        target: `scene-entry-${scene.leadsTo[0]}`,
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
                  label: String(choice.text || ''),
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
            label: String(choice.text || ''),
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
    const hasPlayableChoices = phase.beats?.some((beat: any) => Array.isArray(beat.choices) && beat.choices.length > 0);
    if (hasPlayableChoices) {
      addEncounterChoiceFlow(phase, sourceNode, encounter, sceneId, episodeId, startIndex + nodes.length, nodes, edges);
      continue;
    }

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
    if (phaseHasPlayableChoices(phase)) continue;

    if (encounter.outcomes.victory?.nextSceneId && !phase.onSuccess?.nextPhaseId) {
      edges.push({
        id: `edge-${sourceNode.id}-victory-to-scene-${encounter.outcomes.victory.nextSceneId}`,
        source: sourceNode.id,
        target: `scene-entry-${encounter.outcomes.victory.nextSceneId}`,
        type: 'outcome',
        label: 'Victory',
        conditioned: false,
        synthetic: {
          kind: 'encounter-outcome',
          outcome: 'victory',
          authorLabel: 'VICTORY',
          playerLabel: 'VICTORY',
        },
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
        synthetic: {
          kind: 'encounter-outcome',
          outcome: 'defeat',
          authorLabel: 'DEFEAT',
          playerLabel: 'DEFEAT',
        },
      });
    }
  }

  const startNodeId = phaseMap.get(encounter.startingPhaseId)?.id || nodes[0]?.id || '';

  return { nodes, edges, startNodeId };
}

function addEncounterChoiceFlow(
  phase: EncounterPhase,
  phaseNode: GraphNode,
  encounter: Encounter,
  sceneId: string,
  episodeId: string,
  indexStart: number,
  nodes: GraphNode[],
  edges: GraphEdge[]
) {
  const playableBeats = (phase.beats || []).filter((beat: any) => Array.isArray(beat.choices) && beat.choices.length > 0);
  playableBeats.forEach((beat: any, beatIndex: number) => {
    addEncounterChoicesForSituation({
      parentNode: phaseNode,
      choices: beat.choices || [],
      encounter,
      sceneId,
      episodeId,
      nodes,
      edges,
      pathPrefix: `${phase.id}-${beat.id || beatIndex}`,
      depth: 0,
      indexStart,
    });
  });
}

function addEncounterChoicesForSituation(input: {
  parentNode: GraphNode;
  choices: any[];
  encounter: Encounter;
  sceneId: string;
  episodeId: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
  pathPrefix: string;
  depth: number;
  indexStart: number;
}) {
  const { parentNode, choices, encounter, sceneId, episodeId, nodes, edges, pathPrefix, depth, indexStart } = input;
  choices.forEach((choice: any, choiceIndex: number) => {
    const choiceId = sanitizeId(choice.id || `choice-${choiceIndex}`);
    const choiceNode = createEncounterSyntheticNode({
      id: `encounter-choice-${sceneId}-${pathPrefix}-${choiceId}`,
      type: 'encounter-choice',
      kind: 'encounter-choice',
      label: normalizeVisualizerText(choice.text || `Choice ${choiceIndex + 1}`),
      sublabel: [choice.primarySkill, choice.approach].filter(Boolean).join(' • '),
      sceneId,
      episodeId,
      sourceChoiceId: choice.id,
      sourceId: pathPrefix,
      authorLabel: normalizeVisualizerText(choice.text || `Choice ${choiceIndex + 1}`),
      playerLabel: normalizeVisualizerText(choice.text || `Choice ${choiceIndex + 1}`),
      text: normalizeVisualizerText(choice.text),
      width: 230,
      height: 44,
      depth: indexStart + nodes.length,
    });
    nodes.push(choiceNode);
    edges.push({
      id: `edge-${parentNode.id}-choice-${choiceNode.id}`,
      source: parentNode.id,
      target: choiceNode.id,
      type: 'choice',
      label: '',
      conditioned: false,
    });

    for (const tier of ['success', 'complicated', 'failure'] as const) {
      const outcome = choice.outcomes?.[tier];
      if (!outcome) continue;
      const resultOutcome = getTerminalEncounterOutcome(outcome, tier, encounter);
      const nextSituation = outcome.nextSituation;
      if (resultOutcome && !nextSituation?.choices?.length) {
        const nextSceneId = encounter.outcomes?.[resultOutcome]?.nextSceneId;
        if (!nextSceneId) continue;
        edges.push({
          id: `edge-${choiceNode.id}-${tier}-to-scene-${nextSceneId}`,
          source: choiceNode.id,
          target: `scene-entry-${nextSceneId}`,
          type: 'outcome',
          label: humanizeOutcomeLabel(resultOutcome),
          conditioned: false,
          synthetic: {
            kind: 'encounter-outcome',
            outcome: resultOutcome,
            authorLabel: humanizeOutcomeLabel(resultOutcome),
            playerLabel: humanizeOutcomeLabel(resultOutcome),
          },
        });
        continue;
      }
      if (nextSituation?.choices?.length && depth < 4) {
        const outcomeLabel = resultOutcome ? humanizeOutcomeLabel(resultOutcome) : formatOutcomeTier(tier);
        const situationImage = mediaRefAsString(nextSituation.situationImage) || undefined;
        const situationNode = createEncounterSyntheticNode({
          id: `encounter-situation-${sceneId}-${pathPrefix}-${choiceId}-${tier}`,
          type: 'encounter-situation',
          kind: 'encounter-situation',
          label: `${formatOutcomeTier(tier)} Follow-Up`,
          sublabel: truncateText(normalizeVisualizerText(nextSituation.setupText), 70),
          sceneId,
          episodeId,
          sourceChoiceId: choice.id,
          sourceId: pathPrefix,
          authorLabel: `${formatOutcomeTier(tier)} follow-up`,
          playerLabel: `${formatOutcomeTier(tier)} follow-up`,
          text: normalizeVisualizerText(nextSituation.setupText),
          details: nextSituation.setupText ? [normalizeVisualizerText(nextSituation.setupText)] : undefined,
          image: situationImage,
          fullText: normalizeVisualizerText(nextSituation.setupText),
          width: situationImage ? 240 : 340,
          height: situationImage ? 405 : Math.max(150, 72 + wrapLineCount(normalizeVisualizerText(nextSituation.setupText), 46) * 13),
          sceneTitle: encounter.name || 'Encounter',
          choiceCount: nextSituation.choices.length,
          depth: indexStart + nodes.length,
        });
        nodes.push(situationNode);
        edges.push({
          id: `edge-${choiceNode.id}-${tier}-to-${situationNode.id}`,
          source: choiceNode.id,
          target: situationNode.id,
          type: tier === 'failure' ? 'phase-failure' : 'phase-success',
          label: outcomeLabel,
          conditioned: false,
          synthetic: {
            kind: 'encounter-outcome',
            outcome: resultOutcome,
            tier,
            authorLabel: outcomeLabel,
            playerLabel: outcomeLabel,
          },
        });
        addEncounterChoicesForSituation({
          parentNode: situationNode,
          choices: nextSituation.choices,
          encounter,
          sceneId,
          episodeId,
          nodes,
          edges,
          pathPrefix: `${pathPrefix}-${choiceId}-${tier}`,
          depth: depth + 1,
          indexStart,
        });
      }
    }
  });
}

function createBeatNode(
  beat: Beat,
  scene: Scene,
  episode: Episode,
  outputDir: string | undefined,
  allowGeneratedImageFallbacks: boolean,
  beatIndex: number,
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

  const storyText = normalizeVisualizerText(typeof beat.text === 'string' ? beat.text : String(beat.text || ''));
  const wrappedLineCount = wrapLineCount(storyText, 46);
  const imageUrl = mediaRefAsString(beat.image) || (allowGeneratedImageFallbacks ? buildStoryboardBeatImageUrl(outputDir, episode, scene, beat) : undefined);
  const nodeWidth = imageUrl ? 240 : 340;
  const textHeight = wrappedLineCount * 13;
  const nodeHeight = imageUrl ? 405 : Math.max(120, 50 + textHeight + 34);

  // Use index to guarantee uniqueness even if beat IDs are duplicated
  return {
    id: `beat-${scene.id}-${beat.id}-${index}`,
    type: 'beat',
    label: `${scene.title || scene.id} • Beat ${beatIndex + 1}`,
    sublabel: storyText,
    data: beat,
    x: 0,
    y: 0,
    width: nodeWidth,
    height: nodeHeight,
    parentId: scene.id,
    sceneId: scene.id,
    episodeId: episode.id,
    depth: index,
    hasConditions,
    hasConsequences,
    hasStatCheck,
    hasChoices,
    image: imageUrl,
    fullText: storyText,
    sceneTitle: scene.title || scene.id,
    beatNumber: beatIndex + 1,
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
  const playableBeat = getEncounterPlayableBeat(phase);
  const setupText = normalizeVisualizerText(playableBeat?.setupText || phase.description || `${encounter.type} - ${encounter.name}`);
  const imageUrl = mediaRefAsString(playableBeat?.situationImage || phase.situationImage) || undefined;
  const choiceCount = phase.beats.reduce((sum, b) => sum + (b.choices?.length || 0), 0);
  // Use index to guarantee uniqueness even if phase IDs are duplicated
  return {
    id: `phase-${sceneId}-${phase.id}-${index}`,
    type: 'phase',
    label: phase.name,
    sublabel: setupText,
    data: phase,
    x: 0,
    y: 0,
    width: imageUrl ? 240 : 340,
    height: imageUrl ? 405 : Math.max(150, 72 + wrapLineCount(setupText, 46) * 13),
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
    image: imageUrl,
    fullText: setupText,
    sceneTitle: encounter.name || phase.name || sceneId,
    choiceCount,
  };
}

function createEncounterSyntheticNode(input: {
  id: string;
  type: NodeType;
  kind: string;
  label: string;
  sublabel?: string;
  sceneId: string;
  episodeId: string;
  sourceId?: string;
  sourceChoiceId?: string;
  outcome?: string;
  tier?: string;
  authorLabel: string;
  playerLabel: string;
  text?: string;
  details?: string[];
  image?: string;
  fullText?: string;
  width?: number;
  height?: number;
  sceneTitle?: string;
  choiceCount?: number;
  depth: number;
}): GraphNode {
  const synthetic = {
    id: input.id,
    kind: input.kind,
    sourceId: input.sourceId,
    sourceChoiceId: input.sourceChoiceId,
    outcome: input.outcome,
    tier: input.tier,
    authorLabel: input.authorLabel,
    playerLabel: input.playerLabel,
    text: input.text,
    details: input.details,
  };
  return {
    id: input.id,
    type: input.type,
    label: input.label,
    sublabel: input.sublabel,
    data: synthetic,
    x: 0,
    y: 0,
    width: input.width ?? DEFAULT_LAYOUT_CONFIG.nodeWidth,
    height: input.height ?? DEFAULT_LAYOUT_CONFIG.nodeHeight,
    parentId: input.sceneId,
    sceneId: input.sceneId,
    episodeId: input.episodeId,
    depth: input.depth,
    hasConditions: false,
    hasConsequences: input.type === 'encounter-outcome',
    hasStatCheck: false,
    hasChoices: input.type === 'encounter-choice' || (input.choiceCount ?? 0) > 0,
    choiceCount: input.choiceCount ?? 0,
    image: input.image,
    fullText: input.fullText || input.text,
    sceneTitle: input.sceneTitle,
    synthetic,
  };
}

function phaseHasPlayableChoices(phase: EncounterPhase): boolean {
  return phase.beats?.some((beat: any) => Array.isArray(beat.choices) && beat.choices.length > 0) ?? false;
}

function getEncounterPlayableBeat(phase: EncounterPhase): any | undefined {
  return (phase.beats || []).find((beat: any) => beat.setupText || beat.situationImage || (Array.isArray(beat.choices) && beat.choices.length > 0));
}

function buildStoryboardBeatImageUrl(
  outputDir: string | undefined,
  episode: Episode,
  scene: Scene,
  beat: Beat,
): string | undefined {
  if (!outputDir || !beat?.id || !scene?.id) return undefined;
  const episodeNumber = episode.number ?? extractTrailingNumber(episode.id) ?? 1;
  const storyDir = outputDir.replace(/^\/+|\/+$/g, '');
  if (!storyDir) return undefined;
  const filename = `storyboard-v2-story-beat-episode-${episodeNumber}-${scene.id}-${beat.id}.png`;
  return `${PROXY_CONFIG.getProxyUrl()}/${storyDir}/images/storyboard-v2/panels/${filename}`;
}

function storyHasGeneratedEpisodeArt(story: Story): boolean {
  return Boolean((story as any).imageArtifacts?.hasEpisodeArt);
}

function extractTrailingNumber(value: string | undefined): number | undefined {
  const match = String(value || '').match(/(\d+)$/);
  return match ? Number(match[1]) : undefined;
}

function getTerminalEncounterOutcome(outcome: any, tier: string, encounter: Encounter): string | undefined {
  if (outcome.encounterOutcome) return outcome.encounterOutcome;
  if (outcome.nextSituation || outcome.nextBeatId) return undefined;
  if (tier === 'success' && encounter.outcomes?.victory) return 'victory';
  if (tier === 'complicated' && encounter.outcomes?.partialVictory) return 'partialVictory';
  if (tier === 'complicated' && encounter.outcomes?.escape) return 'escape';
  if (tier === 'failure' && encounter.outcomes?.defeat) return 'defeat';
  return undefined;
}

function formatOutcomeTier(tier: string): string {
  if (tier === 'complicated') return 'Complicated';
  return tier.charAt(0).toUpperCase() + tier.slice(1);
}

function humanizeOutcomeLabel(outcome: string): string {
  return outcome.replace(/([a-z])([A-Z])/g, '$1 $2').toUpperCase();
}

function sanitizeId(value: string): string {
  return String(value || '').replace(/[^a-zA-Z0-9_-]+/g, '-');
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

function wrapLineCount(text: string, maxChars: number): number {
  if (!text.trim()) return 1;
  const words = text.split(/\s+/);
  let lines = 1;
  let current = '';
  for (const word of words) {
    if (!current) {
      current = word;
      continue;
    }
    if (`${current} ${word}`.length > maxChars) {
      lines += 1;
      current = word;
    } else {
      current = `${current} ${word}`;
    }
  }
  return lines;
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
