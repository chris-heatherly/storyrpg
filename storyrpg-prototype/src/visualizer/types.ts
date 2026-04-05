import { Story, Episode, Scene, Beat, Encounter, EncounterPhase, Choice } from '../types';
import { TERMINAL } from '../theme';

export type NodeType = 'episode' | 'scene' | 'beat' | 'encounter' | 'phase';

export type EdgeType = 'next' | 'choice' | 'scene-transition' | 'fallback' | 'outcome' | 'phase-success' | 'phase-failure';

export interface GraphNode {
  id: string;
  type: NodeType;
  label: string;
  sublabel?: string;
  data: Episode | Scene | Beat | Encounter | EncounterPhase;
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
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  type: EdgeType;
  label?: string;
  conditioned: boolean;
}

export interface StoryGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  bounds: { width: number; height: number };
  episodeGroups: Map<string, string[]>;
  sceneGroups: Map<string, string[]>;
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
  },

  nodeBorders: {
    beat: TERMINAL.colors.primaryDim,
    scene: TERMINAL.colors.primary,
    episode: TERMINAL.colors.primaryBright,
    encounter: '#9966ff',
    phase: '#6666ff',
  },

  edges: {
    next: TERMINAL.colors.primaryDim,
    choice: TERMINAL.colors.amber,
    'scene-transition': TERMINAL.colors.cyan,
    fallback: TERMINAL.colors.muted,
    outcome: '#33cc33',
    'phase-success': '#33cc33',
    'phase-failure': '#cc3333',
  },

  selection: TERMINAL.colors.cyan,
  highlight: 'rgba(51, 255, 51, 0.2)',

  indicators: {
    condition: '#ff9933',
    consequence: '#33cc33',
    statCheck: '#9966ff',
  },
};
