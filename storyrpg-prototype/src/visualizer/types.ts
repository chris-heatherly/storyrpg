import { Story, Episode, Scene, Beat, Encounter, EncounterPhase, Choice } from '../types';
import { TERMINAL } from '../theme';

export type NodeType =
  | 'episode'
  | 'scene'
  | 'beat'
  | 'encounter'
  | 'phase'
  | 'encounter-choice'
  | 'encounter-outcome'
  | 'encounter-situation'
  | 'tint'
  | 'tint-payoff'
  | 'branchlet'
  | 'storylet'
  | 'storylet-beat'
  | 'callback-source'
  | 'callback-payoff';

export type EdgeType =
  | 'next'
  | 'choice'
  | 'scene-transition'
  | 'fallback'
  | 'outcome'
  | 'phase-success'
  | 'phase-failure'
  | 'tint'
  | 'tint-payoff'
  | 'branchlet'
  | 'storylet'
  | 'callback';

export type VisualizerMode = 'author' | 'player';

export type ChoiceSystemFacet =
  | 'routing'
  | 'relationship'
  | 'stat'
  | 'identity'
  | 'delayed'
  | 'branching';

export interface ChoiceSystemFilterState {
  showRouting: boolean;
  showRelationships: boolean;
  showStats: boolean;
  showLockedPaths: boolean;
  showDelayedCallbacks: boolean;
  showOnlyMeaningfulBranches: boolean;
  showTints: boolean;
  showTintPayoffs: boolean;
  showBranchlets: boolean;
  showStorylets: boolean;
  showCallbacks: boolean;
}

export interface ChoiceSystemConditionSummary {
  kind: 'relationship' | 'attribute' | 'skill' | 'flag' | 'score' | 'tag' | 'item' | 'identity' | 'compound' | 'unknown';
  authorLabel: string;
  playerLabel: string;
  npcId?: string;
  dimension?: string;
}

export interface ChoiceSystemEffectSummary {
  kind: 'relationship' | 'attribute' | 'skill' | 'flag' | 'score' | 'tag' | 'item' | 'identity' | 'delayed' | 'memory' | 'residue' | 'unknown';
  authorLabel: string;
  playerLabel: string;
  npcId?: string;
  dimension?: string;
  direction?: 'up' | 'down' | 'neutral';
}

export interface ChoiceSystemCheckSummary {
  kind: 'attribute' | 'skill' | 'weighted';
  authorLabel: string;
  playerLabel: string;
}

export interface ChoiceSystemRouteSummary {
  kind: 'nextBeat' | 'nextScene' | 'implicit';
  authorLabel: string;
  playerLabel: string;
  isMeaningfulBranch: boolean;
}

export interface ChoiceSystemChoiceSummary {
  id: string;
  text: string;
  choiceType: NonNullable<Choice['choiceType']> | 'standard';
  route: ChoiceSystemRouteSummary;
  conditions: ChoiceSystemConditionSummary[];
  effects: ChoiceSystemEffectSummary[];
  check?: ChoiceSystemCheckSummary;
  hasDelayedCallback: boolean;
  hasLockedGate: boolean;
  relationshipNpcIds: string[];
  facets: ChoiceSystemFacet[];
  authorSummary: string;
  playerSummary: string;
}

export interface ChoiceSystemNodeMetadata {
  choices: ChoiceSystemChoiceSummary[];
  npcIds: string[];
  facets: ChoiceSystemFacet[];
  badges: Array<{
    facet: ChoiceSystemFacet;
    authorLabel: string;
    playerLabel: string;
  }>;
}

export interface ChoiceSystemEdgeMetadata {
  choiceId?: string;
  choiceType?: ChoiceSystemChoiceSummary['choiceType'];
  facets: ChoiceSystemFacet[];
  route?: ChoiceSystemRouteSummary;
  conditions: ChoiceSystemConditionSummary[];
  effects: ChoiceSystemEffectSummary[];
  check?: ChoiceSystemCheckSummary;
  hasDelayedCallback: boolean;
  hasLockedGate: boolean;
  relationshipNpcIds: string[];
  authorLabel?: string;
  playerLabel?: string;
}

export interface ChoiceSystemNpcSummary {
  npcId: string;
  dimensions: Record<'trust' | 'affection' | 'respect' | 'fear', {
    gates: number;
    effects: number;
  }>;
}

export type SyntheticGraphKind =
  | 'encounter-choice'
  | 'encounter-outcome'
  | 'encounter-situation'
  | 'tint'
  | 'tint-payoff'
  | 'branchlet'
  | 'storylet'
  | 'storylet-beat'
  | 'callback-source'
  | 'callback-payoff';

export interface SyntheticGraphNodeData {
  id: string;
  kind: SyntheticGraphKind;
  sourceId?: string;
  sourceChoiceId?: string;
  sourceBeatId?: string;
  targetBeatId?: string;
  targetSceneId?: string;
  flag?: string;
  hookId?: string;
  outcome?: string;
  tier?: string;
  authorLabel: string;
  playerLabel: string;
  text?: string;
  details?: string[];
}

export interface SyntheticGraphEdgeData {
  kind: SyntheticGraphKind | 'storylet-route';
  flag?: string;
  hookId?: string;
  choiceId?: string;
  outcome?: string;
  tier?: string;
  authorLabel: string;
  playerLabel: string;
}

export interface GraphNode {
  id: string;
  type: NodeType;
  label: string;
  sublabel?: string;
  data: Episode | Scene | Beat | Encounter | EncounterPhase | SyntheticGraphNodeData;
  x: number;
  y: number;
  width: number;
  height: number;
  parentId: string | null;
  sceneId: string | null;
  episodeId: string | null;
  depth: number;
  hasConditions: boolean;
  hasConsequences: boolean;
  hasStatCheck: boolean;
  hasChoices: boolean;
  choiceCount: number;
  image?: string;
  fullText?: string;
  sceneTitle?: string;
  beatNumber?: number;
  choiceSystem?: ChoiceSystemNodeMetadata;
  synthetic?: SyntheticGraphNodeData;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  type: EdgeType;
  label?: string;
  conditioned: boolean;
  choiceSystem?: ChoiceSystemEdgeMetadata;
  synthetic?: SyntheticGraphEdgeData;
}

export interface StoryGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  bounds: { width: number; height: number };
  episodeGroups: Map<string, string[]>;
  sceneGroups: Map<string, string[]>;
  choiceSystem?: {
    npcs: ChoiceSystemNpcSummary[];
  };
}

export interface MapJumpShortcut {
  id: string;
  label: string;
  kind: 'scene' | 'encounter' | 'storylet' | 'branchlet';
  nodeId: string;
}

export interface ViewState {
  scale: number;
  translateX: number;
  translateY: number;
}

export interface LayoutConfig {
  nodeWidth: number;
  nodeHeight: number;
  horizontalSpacing: number;
  verticalSpacing: number;
  scenePadding: number;
  episodePadding: number;
}

export const DEFAULT_LAYOUT_CONFIG: LayoutConfig = {
  nodeWidth: 180,
  nodeHeight: 60,
  horizontalSpacing: 40,
  verticalSpacing: 80,
  scenePadding: 20,
  episodePadding: 30,
};

// Terminal-themed visualizer colors
export const VISUALIZER_COLORS = {
  background: TERMINAL.colors.bg,
  accent: TERMINAL.colors.amber,
  text: TERMINAL.colors.primary,
  textMuted: TERMINAL.colors.muted,

  nodeTypes: {
    beat: '#0a1a0a',
    scene: '#0a0f0a',
    episode: '#0f1a0f',
    encounter: '#1a0a1a',
    phase: '#0f0a1a',
    'encounter-choice': '#101526',
    'encounter-outcome': '#101820',
    'encounter-situation': '#0d1620',
    tint: '#1a1020',
    'tint-payoff': '#1a1510',
    branchlet: '#20120a',
    storylet: '#101526',
    'storylet-beat': '#0d1620',
    'callback-source': '#20151a',
    'callback-payoff': '#20151a',
  },

  nodeBorders: {
    beat: TERMINAL.colors.primaryDim,
    scene: TERMINAL.colors.primary,
    episode: TERMINAL.colors.primaryBright,
    encounter: '#9966ff',
    phase: '#6666ff',
    'encounter-choice': TERMINAL.colors.amber,
    'encounter-outcome': '#66ccff',
    'encounter-situation': '#3399ff',
    tint: '#ff66cc',
    'tint-payoff': '#facc15',
    branchlet: '#ff6633',
    storylet: '#66ccff',
    'storylet-beat': '#3399ff',
    'callback-source': '#ff99cc',
    'callback-payoff': '#ff99cc',
  },

  edges: {
    next: TERMINAL.colors.primaryDim,
    choice: TERMINAL.colors.amber,
    'scene-transition': TERMINAL.colors.cyan,
    fallback: TERMINAL.colors.muted,
    outcome: '#33cc33',
    'phase-success': '#33cc33',
    'phase-failure': '#cc3333',
    tint: '#ff66cc',
    'tint-payoff': '#facc15',
    branchlet: '#ff6633',
    storylet: '#66ccff',
    callback: '#ff99cc',
  },

  outcomes: {
    victory: '#45d94a',
    partialVictory: '#facc15',
    defeat: '#ef4444',
    escape: TERMINAL.colors.cyan,
  },

  selection: TERMINAL.colors.cyan,
  highlight: 'rgba(51, 255, 51, 0.2)',

  indicators: {
    condition: '#ff9933',
    consequence: '#33cc33',
    statCheck: '#9966ff',
    relationship: '#33ccff',
    identity: '#ff66cc',
    delayed: '#facc15',
    branching: '#ff6633',
    storylet: '#66ccff',
    callback: '#ff99cc',
  },

  choiceTypes: {
    standard: TERMINAL.colors.amber,
    expression: '#7dd3fc',
    relationship: '#33ccff',
    strategic: '#9966ff',
    dilemma: '#ff6633',
  },
};
