import type {
  Beat,
  Choice,
  ConditionExpression,
  Consequence,
  GeneratedStorylet,
  Scene,
  Story,
  StoryletBeat,
} from '../types';
import type {
  EdgeType,
  GraphEdge,
  GraphNode,
  NodeType,
  StoryGraph,
  SyntheticGraphKind,
  SyntheticGraphNodeData,
} from './types';
import { DEFAULT_LAYOUT_CONFIG } from './types';
import { normalizeVisualizerText } from './displayText';

interface TintSource {
  flag: string;
  nodeId: string;
  choiceId: string;
}

interface CallbackSource {
  hookId: string;
  nodeId: string;
}

interface GraphIndexes {
  nodeBySceneBeat: Map<string, GraphNode>;
  firstNodeByScene: Map<string, GraphNode>;
  encounterOutcomeBySceneOutcome: Map<string, GraphNode[]>;
}

const STORYLET_OUTCOMES = ['victory', 'partialVictory', 'defeat', 'escape'] as const;
type StoryletOutcome = typeof STORYLET_OUTCOMES[number];

export function expandStoryGraphResidue(story: Story, graph: StoryGraph): StoryGraph {
  const nodes = graph.nodes.map((node) => ({ ...node }));
  const edges = graph.edges.map((edge) => ({ ...edge }));
  const episodeGroups = cloneGroupMap(graph.episodeGroups);
  const sceneGroups = cloneGroupMap(graph.sceneGroups);
  const indexes = buildIndexes(nodes, sceneGroups, edges);
  const tintSources = new Map<string, TintSource[]>();
  const callbackSources = new Map<string, CallbackSource[]>();
  const callbackPayoffs = new Map<string, string[]>();

  const addNode = (node: GraphNode) => {
    nodes.push(node);
    if (node.sceneId) appendGroup(sceneGroups, node.sceneId, node.id);
    if (node.episodeId) appendGroup(episodeGroups, node.episodeId, node.id);
  };

  for (const episode of story.episodes ?? []) {
    for (const scene of episode.scenes ?? []) {
      for (const beat of scene.beats ?? []) {
        const beatNode = indexes.nodeBySceneBeat.get(key(scene.id, beat.id));
        if (!beatNode) continue;

        addTintPayoffNodes(beat, beatNode, episode.id, scene.id, addNode, edges, tintSources);
        addCallbackPayoffNodes(beat, beatNode, episode.id, scene.id, addNode, edges, callbackPayoffs);

        for (const choice of beat.choices ?? []) {
          addTintSourceNodes(choice, beatNode, episode.id, scene.id, addNode, edges, tintSources);
          addBranchletNode(choice, beatNode, episode.id, scene.id, indexes, addNode, edges);
          addCallbackSourceNode(choice, beatNode, episode.id, scene.id, addNode, edges, callbackSources);
        }
      }

      if (scene.encounter?.storylets) {
        addStoryletNodes(scene, episode.id, indexes, addNode, edges);
      }
    }
  }

  connectTintSourcesToPayoffs(tintSources, nodes, edges);
  connectCallbackSourcesToPayoffs(callbackSources, callbackPayoffs, edges);

  return {
    ...graph,
    nodes,
    edges,
    episodeGroups,
    sceneGroups,
  };
}

export function shouldShowResidueNode(node: GraphNode, filters: {
  showTints: boolean;
  showTintPayoffs: boolean;
  showBranchlets: boolean;
  showStorylets: boolean;
  showCallbacks: boolean;
}): boolean {
  switch (node.type) {
    case 'tint':
      return filters.showTints;
    case 'tint-payoff':
      return filters.showTintPayoffs;
    case 'branchlet':
      return filters.showBranchlets;
    case 'storylet':
    case 'storylet-beat':
      return filters.showStorylets;
    case 'callback-source':
    case 'callback-payoff':
      return filters.showCallbacks;
    default:
      return true;
  }
}

export function shouldShowResidueEdge(edge: GraphEdge, filters: {
  showTints: boolean;
  showTintPayoffs: boolean;
  showBranchlets: boolean;
  showStorylets: boolean;
  showCallbacks: boolean;
}): boolean {
  switch (edge.type) {
    case 'tint':
      return filters.showTints;
    case 'tint-payoff':
      return filters.showTintPayoffs;
    case 'branchlet':
      return filters.showBranchlets;
    case 'storylet':
      return filters.showStorylets;
    case 'callback':
      return filters.showCallbacks;
    default:
      return true;
  }
}

function addTintSourceNodes(
  choice: Choice,
  sourceNode: GraphNode,
  episodeId: string,
  sceneId: string,
  addNode: (node: GraphNode) => void,
  edges: GraphEdge[],
  tintSources: Map<string, TintSource[]>,
) {
  for (const flag of collectChoiceTintFlags(choice)) {
    const node = createSyntheticNode({
      id: `tint-${sceneId}-${sourceNode.data.id}-${choice.id}-${sanitize(flag)}`,
      type: 'tint',
      kind: 'tint',
      label: flag.replace(/^tint:/, ''),
      sublabel: choice.text,
      sceneId,
      episodeId,
      sourceChoiceId: choice.id,
      sourceBeatId: String(sourceNode.data.id),
      flag,
      authorLabel: `tint:${flag} sourceChoice:${choice.id}`,
      playerLabel: 'This choice colors later scenes.',
      details: [`choice:${choice.id}`, `flag:${flag}`],
    });
    addNode(node);
    appendTintSource(tintSources, flag, { flag, nodeId: node.id, choiceId: choice.id });
    edges.push(createSyntheticEdge(sourceNode.id, node.id, 'tint', {
      kind: 'tint',
      flag,
      choiceId: choice.id,
      authorLabel: `sets ${flag}`,
      playerLabel: 'colors later scenes',
    }));
  }
}

function addTintPayoffNodes(
  beat: Beat,
  targetNode: GraphNode,
  episodeId: string,
  sceneId: string,
  addNode: (node: GraphNode) => void,
  edges: GraphEdge[],
  tintSources: Map<string, TintSource[]>,
) {
  for (const [index, variant] of (beat.textVariants ?? []).entries()) {
    const flags = collectTintFlagsFromCondition(variant.condition);
    for (const flag of flags) {
      const node = createSyntheticNode({
        id: `tint-payoff-${sceneId}-${beat.id}-${index}-${sanitize(flag)}`,
        type: 'tint-payoff',
        kind: 'tint-payoff',
        label: flag.replace(/^tint:/, ''),
        sublabel: truncate(variant.text, 42),
        sceneId,
        episodeId,
        targetBeatId: beat.id,
        flag,
        authorLabel: `textVariant payoff:${flag}`,
        playerLabel: 'This prose reacts to an earlier tone choice.',
        text: variant.text,
        details: [`beat:${beat.id}`, `flag:${flag}`],
      });
      addNode(node);
      appendTintSource(tintSources, flag, { flag, nodeId: node.id, choiceId: '' });
      edges.push(createSyntheticEdge(node.id, targetNode.id, 'tint-payoff', {
        kind: 'tint-payoff',
        flag,
        authorLabel: `applies ${flag}`,
        playerLabel: 'changes the scene tone',
      }));
    }
  }
}

function addBranchletNode(
  choice: Choice,
  sourceNode: GraphNode,
  episodeId: string,
  sceneId: string,
  indexes: GraphIndexes,
  addNode: (node: GraphNode) => void,
  edges: GraphEdge[],
) {
  if (!isBranchletChoice(choice)) return;
  const target = choice.nextBeatId
    ? indexes.nodeBySceneBeat.get(key(sceneId, choice.nextBeatId))
    : undefined;
  const node = createSyntheticNode({
    id: `branchlet-${sceneId}-${sourceNode.data.id}-${choice.id}`,
    type: 'branchlet',
    kind: 'branchlet',
    label: choice.consequenceTier ?? 'branchlet',
    sublabel: choice.text,
    sceneId,
    episodeId,
    sourceChoiceId: choice.id,
    sourceBeatId: String(sourceNode.data.id),
    targetBeatId: choice.nextBeatId,
    targetSceneId: choice.nextSceneId,
    tier: choice.consequenceTier,
    authorLabel: `branchlet choice:${choice.id}`,
    playerLabel: 'This opens a short-lived path before the story reconverges.',
    details: [`choice:${choice.id}`, choice.nextBeatId ? `nextBeatId:${choice.nextBeatId}` : 'local residue'],
  });
  addNode(node);
  edges.push(createSyntheticEdge(sourceNode.id, node.id, 'branchlet', {
    kind: 'branchlet',
    choiceId: choice.id,
    authorLabel: `branchlet:${choice.id}`,
    playerLabel: 'opens a short path',
  }));
  if (target) {
    edges.push(createSyntheticEdge(node.id, target.id, 'branchlet', {
      kind: 'branchlet',
      choiceId: choice.id,
      authorLabel: `returns:${choice.nextBeatId}`,
      playerLabel: 'continues from the detour',
    }));
  }
}

function addCallbackSourceNode(
  choice: Choice,
  sourceNode: GraphNode,
  episodeId: string,
  sceneId: string,
  addNode: (node: GraphNode) => void,
  edges: GraphEdge[],
  callbackSources: Map<string, CallbackSource[]>,
) {
  const moment = choice.memorableMoment;
  if (!moment?.id) return;
  const node = createSyntheticNode({
    id: `callback-source-${sceneId}-${sourceNode.data.id}-${choice.id}-${sanitize(moment.id)}`,
    type: 'callback-source',
    kind: 'callback-source',
    label: moment.id,
    sublabel: moment.summary,
    sceneId,
    episodeId,
    sourceChoiceId: choice.id,
    sourceBeatId: String(sourceNode.data.id),
    hookId: moment.id,
    authorLabel: `callback source:${moment.id}`,
    playerLabel: 'The story remembers this choice.',
    text: moment.summary,
    details: [`choice:${choice.id}`, ...(moment.flags ?? []).map((flag) => `flag:${flag}`)],
  });
  addNode(node);
  appendCallback(callbackSources, moment.id, { hookId: moment.id, nodeId: node.id });
  edges.push(createSyntheticEdge(sourceNode.id, node.id, 'callback', {
    kind: 'callback-source',
    hookId: moment.id,
    choiceId: choice.id,
    authorLabel: `records:${moment.id}`,
    playerLabel: 'records a memory',
  }));
}

function addCallbackPayoffNodes(
  beat: Beat,
  targetNode: GraphNode,
  episodeId: string,
  sceneId: string,
  addNode: (node: GraphNode) => void,
  edges: GraphEdge[],
  callbackPayoffs: Map<string, string[]>,
) {
  const hookRefs = new Set<string>(beat.callbackHookIds ?? []);
  for (const variant of beat.textVariants ?? []) {
    if (variant.callbackHookId) hookRefs.add(variant.callbackHookId);
  }
  for (const hookId of hookRefs) {
    const node = createSyntheticNode({
      id: `callback-payoff-${sceneId}-${beat.id}-${sanitize(hookId)}`,
      type: 'callback-payoff',
      kind: 'callback-payoff',
      label: hookId,
      sublabel: truncate(beat.text, 42),
      sceneId,
      episodeId,
      targetBeatId: beat.id,
      hookId,
      authorLabel: `callback payoff:${hookId}`,
      playerLabel: 'This scene pays off an earlier memory.',
      text: beat.text,
      details: [`beat:${beat.id}`, `hook:${hookId}`],
    });
    addNode(node);
    appendPayoff(callbackPayoffs, hookId, node.id);
    edges.push(createSyntheticEdge(node.id, targetNode.id, 'callback', {
      kind: 'callback-payoff',
      hookId,
      authorLabel: `pays off:${hookId}`,
      playerLabel: 'returns to the scene',
    }));
  }
}

function addStoryletNodes(
  scene: Scene,
  episodeId: string,
  indexes: GraphIndexes,
  addNode: (node: GraphNode) => void,
  edges: GraphEdge[],
) {
  const encounter = scene.encounter;
  if (!encounter?.storylets) return;
  const fallbackSourceNode = findEncounterSourceNode(scene.id, indexes);

  for (const outcome of STORYLET_OUTCOMES) {
    const storylet = encounter.storylets[outcome];
    if (!storylet?.beats?.length) continue;
    const outcomeSources = findEncounterOutcomeSourceNodes(scene.id, outcome, indexes);
    const sourceNodeIds = outcomeSources.length > 0
      ? outcomeSources.map((node) => node.id)
      : fallbackSourceNode?.id
        ? [fallbackSourceNode.id]
        : [];
    addStoryletBeatNodes(storylet, sourceNodeIds, scene, episodeId, outcome, indexes, addNode, edges);
  }
}

function addStoryletBeatNodes(
  storylet: GeneratedStorylet,
  sourceNodeIds: string[],
  scene: Scene,
  episodeId: string,
  outcome: StoryletOutcome,
  indexes: GraphIndexes,
  addNode: (node: GraphNode) => void,
  edges: GraphEdge[],
) {
  const beatNodes = new Map<string, GraphNode>();
  for (const [index, beat] of storylet.beats.entries()) {
    const image = typeof beat.image === 'string' ? beat.image : undefined;
    const beatText = normalizeVisualizerText(beat.text);
    const node = createSyntheticNode({
      id: `storylet-beat-${scene.id}-${outcome}-${storylet.id}-${beat.id}`,
      type: 'storylet-beat',
      kind: 'storylet-beat',
      label: `Beat ${index + 1}`,
      sublabel: truncate(beatText, 42),
      sceneId: scene.id,
      episodeId,
      sourceId: storylet.id,
      sourceBeatId: beat.id,
      authorLabel: `storyletBeat:${beat.id}`,
      playerLabel: 'A beat in the aftermath sequence.',
      text: beatText,
      details: [`storylet:${storylet.id}`, `beat:${beat.id}`],
      image,
      fullText: beatText,
      width: image ? 240 : 340,
      height: image ? 405 : Math.max(150, 72 + wrapLineCount(beatText, 46) * 13),
      sceneTitle: humanizeOutcome(outcome),
      beatNumber: index + 1,
      choiceCount: beat.choices?.length ?? 0,
    });
    beatNodes.set(beat.id, node);
    addNode(node);
  }

  const firstBeatId = storylet.beats.some((beat) => beat.id === storylet.startingBeatId)
    ? storylet.startingBeatId
    : storylet.beats[0]?.id;
  const firstBeatNode = firstBeatId ? beatNodes.get(firstBeatId) : undefined;
  if (firstBeatNode) {
    for (const sourceNodeId of sourceNodeIds) {
      edges.push(createSyntheticEdge(sourceNodeId, firstBeatNode.id, 'storylet', {
        kind: 'storylet',
        outcome,
        authorLabel: humanizeOutcome(outcome),
        playerLabel: humanizeOutcome(outcome),
      }));
    }
  }

  for (const [index, beat] of storylet.beats.entries()) {
    const source = beatNodes.get(beat.id);
    if (!source) continue;
    const nextBeatId = beat.nextBeatId ?? (!beat.isTerminal ? storylet.beats[index + 1]?.id : undefined);
    const target = nextBeatId ? beatNodes.get(nextBeatId) : undefined;
    if (target) {
      edges.push(createSyntheticEdge(source.id, target.id, 'storylet', {
        kind: 'storylet',
        outcome,
        authorLabel: '',
        playerLabel: '',
      }));
      continue;
    }

    const nextSceneId = storylet.nextSceneId ?? scene.encounter?.outcomes?.[outcome]?.nextSceneId;
    const nextSceneNode = nextSceneId ? indexes.firstNodeByScene.get(nextSceneId) : undefined;
    if (nextSceneNode && nextSceneId) {
      edges.push(createSyntheticEdge(source.id, nextSceneNode.id, 'storylet', {
        kind: 'storylet-route',
        outcome,
        authorLabel: `to ${formatSceneId(nextSceneId)}`,
        playerLabel: 'returns to the main story',
      }));
    }
  }
}

function connectTintSourcesToPayoffs(
  tintSources: Map<string, TintSource[]>,
  nodes: GraphNode[],
  edges: GraphEdge[],
) {
  const payoffNodes = nodes.filter((node) => node.type === 'tint-payoff' && node.synthetic?.flag);
  for (const payoff of payoffNodes) {
    const sources = tintSources.get(payoff.synthetic!.flag!) ?? [];
    for (const source of sources) {
      if (source.nodeId === payoff.id || !source.choiceId) continue;
      edges.push(createSyntheticEdge(source.nodeId, payoff.id, 'tint-payoff', {
        kind: 'tint-payoff',
        flag: source.flag,
        choiceId: source.choiceId,
        authorLabel: `payoff:${source.flag}`,
        playerLabel: 'echoes as later tone',
      }));
    }
  }
}

function connectCallbackSourcesToPayoffs(
  callbackSources: Map<string, CallbackSource[]>,
  callbackPayoffs: Map<string, string[]>,
  edges: GraphEdge[],
) {
  for (const [hookId, sources] of callbackSources) {
    const payoffs = callbackPayoffs.get(hookId) ?? [];
    for (const source of sources) {
      for (const payoffNodeId of payoffs) {
        edges.push(createSyntheticEdge(source.nodeId, payoffNodeId, 'callback', {
          kind: 'callback-payoff',
          hookId,
          authorLabel: `callback:${hookId}`,
          playerLabel: 'memory pays off later',
        }));
      }
    }
  }
}

function collectChoiceTintFlags(choice: Choice): string[] {
  const flags = new Set<string>();
  if (choice.tintFlag?.startsWith('tint:')) flags.add(choice.tintFlag);
  for (const consequence of choice.consequences ?? []) collectTintFlagFromConsequence(consequence, flags);
  for (const delayed of choice.delayedConsequences ?? []) collectTintFlagFromConsequence(delayed.consequence, flags);
  return Array.from(flags);
}

function collectTintFlagFromConsequence(consequence: Consequence, flags: Set<string>) {
  if (
    consequence?.type === 'setFlag' &&
    consequence.value &&
    typeof consequence.flag === 'string' &&
    consequence.flag.startsWith('tint:')
  ) {
    flags.add(consequence.flag);
  }
}

function collectTintFlagsFromCondition(condition?: ConditionExpression): string[] {
  if (!condition) return [];
  switch (condition.type) {
    case 'flag':
      return condition.flag.startsWith('tint:') ? [condition.flag] : [];
    case 'and':
    case 'or':
      return condition.conditions.flatMap((item) => collectTintFlagsFromCondition(item));
    case 'not':
      return collectTintFlagsFromCondition(condition.condition);
    default:
      return [];
  }
}

function isBranchletChoice(choice: Choice): boolean {
  if (choice.consequenceTier === 'branchlet') return true;
  if (choice.nextBeatId && !choice.nextSceneId && (choice.residueHints?.length || choice.delayedConsequences?.length)) return true;
  return false;
}

function createSyntheticNode(input: {
  id: string;
  type: NodeType;
  kind: SyntheticGraphKind;
  label: string;
  sublabel?: string;
  sceneId: string;
  episodeId: string;
  image?: string;
  fullText?: string;
  width?: number;
  height?: number;
  sceneTitle?: string;
  beatNumber?: number;
  choiceCount?: number;
} & Partial<SyntheticGraphNodeData>): GraphNode {
  const synthetic: SyntheticGraphNodeData = {
    id: input.id,
    kind: input.kind,
    sourceId: input.sourceId,
    sourceChoiceId: input.sourceChoiceId,
    sourceBeatId: input.sourceBeatId,
    targetBeatId: input.targetBeatId,
    targetSceneId: input.targetSceneId,
    flag: input.flag,
    hookId: input.hookId,
    outcome: input.outcome,
    tier: input.tier,
    authorLabel: input.authorLabel ?? input.label,
    playerLabel: input.playerLabel ?? input.label,
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
    depth: 0,
    hasConditions: input.type === 'tint-payoff' || input.type === 'callback-payoff',
    hasConsequences: input.type === 'tint' || input.type === 'branchlet' || input.type === 'callback-source',
    hasStatCheck: false,
    hasChoices: false,
    choiceCount: input.choiceCount ?? 0,
    image: input.image,
    fullText: input.fullText,
    sceneTitle: input.sceneTitle,
    beatNumber: input.beatNumber,
    synthetic,
  };
}

function createSyntheticEdge(
  source: string,
  target: string,
  type: EdgeType,
  synthetic: GraphEdge['synthetic'],
): GraphEdge {
  return {
    id: `edge-${source}-${type}-to-${target}`,
    source,
    target,
    type,
    label: synthetic?.authorLabel,
    conditioned: false,
    synthetic,
  };
}

function buildIndexes(nodes: GraphNode[], sceneGroups: Map<string, string[]>, edges: GraphEdge[]): GraphIndexes {
  const nodeBySceneBeat = new Map<string, GraphNode>();
  const firstNodeByScene = new Map<string, GraphNode>();
  const encounterOutcomeBySceneOutcome = new Map<string, GraphNode[]>();
  const nodeById = new Map(nodes.map((node) => [node.id, node] as const));
  for (const node of nodes) {
    const dataId = (node.data as { id?: string })?.id;
    if (node.sceneId && dataId) nodeBySceneBeat.set(key(node.sceneId, dataId), node);
  }
  for (const edge of edges) {
    if (edge.synthetic?.kind !== 'encounter-outcome' || !edge.synthetic.outcome) continue;
    const source = nodeById.get(edge.source);
    if (source?.sceneId) {
      appendOutcomeNode(encounterOutcomeBySceneOutcome, `${source.sceneId}:${edge.synthetic.outcome}`, source);
    }
  }
  for (const [sceneId, nodeIds] of sceneGroups) {
    const first = nodeIds.map((nodeId) => nodeById.get(nodeId)).find(Boolean);
    if (first) firstNodeByScene.set(sceneId, first);
  }
  return { nodeBySceneBeat, firstNodeByScene, encounterOutcomeBySceneOutcome };
}

function findEncounterSourceNode(sceneId: string, indexes: GraphIndexes): GraphNode | undefined {
  const phaseNodes = Array.from(indexes.nodeBySceneBeat.values()).filter((node) => node.sceneId === sceneId && node.type === 'phase');
  return phaseNodes[phaseNodes.length - 1] ?? indexes.firstNodeByScene.get(sceneId);
}

function findEncounterOutcomeSourceNodes(sceneId: string, outcome: string, indexes: GraphIndexes): GraphNode[] {
  return indexes.encounterOutcomeBySceneOutcome.get(`${sceneId}:${outcome}`) ?? [];
}

function cloneGroupMap(groups: Map<string, string[]>): Map<string, string[]> {
  return new Map(Array.from(groups.entries()).map(([key, value]) => [key, [...value]]));
}

function appendGroup(groups: Map<string, string[]>, key: string, value: string) {
  const existing = groups.get(key) ?? [];
  existing.push(value);
  groups.set(key, existing);
}

function appendTintSource(map: Map<string, TintSource[]>, flag: string, source: TintSource) {
  const existing = map.get(flag) ?? [];
  existing.push(source);
  map.set(flag, existing);
}

function appendCallback(map: Map<string, CallbackSource[]>, hookId: string, source: CallbackSource) {
  const existing = map.get(hookId) ?? [];
  existing.push(source);
  map.set(hookId, existing);
}

function appendPayoff(map: Map<string, string[]>, hookId: string, nodeId: string) {
  const existing = map.get(hookId) ?? [];
  existing.push(nodeId);
  map.set(hookId, existing);
}

function appendOutcomeNode(map: Map<string, GraphNode[]>, key: string, node: GraphNode) {
  const existing = map.get(key) ?? [];
  existing.push(node);
  map.set(key, existing);
}

function key(sceneId: string, beatId: string): string {
  return `${sceneId}:${beatId}`;
}

function sanitize(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]+/g, '-');
}

function truncate(text: string | undefined, maxLength: number): string {
  const value = text ?? '';
  return value.length > maxLength ? `${value.slice(0, maxLength - 3)}...` : value;
}

function wrapLineCount(text: string, maxChars: number): number {
  if (!text.trim()) return 1;
  const words = text.split(/\s+/);
  let lineCount = 1;
  let currentLength = 0;

  for (const word of words) {
    const nextLength = currentLength === 0 ? word.length : currentLength + 1 + word.length;
    if (nextLength > maxChars) {
      lineCount += 1;
      currentLength = word.length;
    } else {
      currentLength = nextLength;
    }
  }

  return lineCount;
}

function humanizeOutcome(outcome: string): string {
  return outcome.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
}

function formatSceneId(sceneId: string): string {
  return sceneId.replace(/-/g, ' ');
}
