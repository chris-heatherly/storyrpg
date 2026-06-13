/**
 * Branch Manager Agent
 *
 * The narrative flow expert responsible for:
 * - Managing branching and reconvergence points
 * - Tracking state implications across branches
 * - Ensuring all paths lead to meaningful outcomes
 * - Validating branch-and-bottleneck structure integrity
 */

import { AgentConfig } from '../config';
import { BaseAgent, AgentResponse } from './BaseAgent';
import { SceneBlueprint } from './StoryArchitect';
import { buildBranchSkeleton, type BranchSkeleton } from '../utils/branchTopology';
import type {
  StoryAnchors,
  SevenPointStructure,
  StructuralRole,
} from '../../types/sourceAnalysis';

// Input types
export interface BranchManagerInput {
  // Episode context
  episodeId: string;
  episodeTitle: string;

  // Scene graph from Story Architect
  scenes: SceneBlueprint[];
  startingSceneId: string;
  bottleneckScenes: string[];

  // State context
  availableFlags: Array<{ name: string; description: string }>;
  availableScores: Array<{ name: string; description: string }>;
  availableTags: Array<{ name: string; description: string }>;

  // Story context
  storyContext: {
    title: string;
    genre: string;
    tone: string;
  };

  /**
   * Season narrative anchors. Branch reconvergence bottlenecks should
   * funnel every path back toward the season Climax and honour the
   * Stakes anchor.
   */
  seasonAnchors?: StoryAnchors;

  /** Season 7-point beat map. */
  seasonSevenPoint?: SevenPointStructure;

  /**
   * Structural beat(s) this episode carries. Midpoint and Plot Turn 2
   * episodes are the best homes for high-cost, high-divergence branches.
   * Hook / Resolution episodes should keep branches tight.
   */
  episodeStructuralRole?: StructuralRole[];
}

// Output types
export interface BranchPath {
  id: string;
  name: string;
  description: string;
  startSceneId: string;
  endSceneId: string;
  sceneSequence: string[];
  stateChanges: StateChange[];
  narrativeTheme?: string;
}

export interface StateChange {
  type: 'flag' | 'score' | 'tag' | 'relationship';
  name: string;
  change: string | number | boolean;
  sceneId: string;
  significance: 'minor' | 'moderate' | 'major';
}

export interface ReconvergencePoint {
  sceneId: string;
  incomingBranches: string[];
  stateReconciliation: StateReconciliation[];
  narrativeAcknowledgment: string;
}

export interface StateReconciliation {
  stateVariable: string;
  possibleValues: string[];
  howToHandle: string;
}

export interface BranchAnalysis {
  episodeId: string;
  branchPaths: BranchPath[];
  reconvergencePoints: ReconvergencePoint[];
  stateTrackingMap: StateTrackingEntry[];
  validationIssues: ValidationIssue[];
  recommendations: string[];
}

export interface StateTrackingEntry {
  variable: string;
  type: 'flag' | 'score' | 'tag' | 'relationship';
  setInScenes: string[];
  usedInScenes: string[];
  possibleValues: string[];
}

export interface ValidationIssue {
  severity: 'warning' | 'error';
  type: 'orphan_branch' | 'missing_reconvergence' | 'state_conflict' | 'unreachable_scene' | 'dead_end';
  description: string;
  affectedScenes: string[];
  suggestedFix?: string;
}

export class BranchManager extends BaseAgent {
  constructor(config: AgentConfig) {
    super('Branch Manager', config);
    this.includeSystemPrompt = true;
  }

  protected getAgentSpecificPrompt(): string {
    return `
## Your Role: Branch Manager (Annotation Pass)

The branch STRUCTURE — every distinct path through the scene graph and every
reconvergence point — has already been computed deterministically from the
scene graph and is given to you below. Do NOT re-derive it, second-guess it, or
add/remove paths or reconvergence points.

Your job is purely to ANNOTATE that structure with language:
- For each given path: a short evocative name, a one-line description of what
  makes it distinct, and its narrative theme.
- For each given reconvergence point: a sentence of narrative acknowledgment
  (how the story should nod to the different incoming paths) and, where
  relevant, how to reconcile differing state at that point.
- A few actionable recommendations for the episode's branch design.

(The BRANCH-AND-BOTTLENECK framework is in the shared system prompt — apply its
principles when judging what makes a path distinct and how reconvergence should
read. Do not repeat the framework definitions.)

Return ONLY the requested annotation JSON, keyed by the exact ids / scene ids
provided. Never invent ids that were not given to you.
`;
  }

  async execute(input: BranchManagerInput): Promise<AgentResponse<BranchAnalysis>> {
    console.info(`[BranchManager] Analyzing branch structure for episode: ${input.episodeId}`);

    // 1. Deterministic skeleton — correct by construction, cannot fail to parse.
    const skeleton = buildBranchSkeleton(input.scenes, input.startingSceneId);
    const analysis = this.assembleDeterministic(skeleton, input);

    if (skeleton.pathsTruncated) {
      console.warn(`[BranchManager] Path enumeration hit cap for ${input.episodeId}; annotating a representative subset.`);
    }

    // 2. Best-effort LLM ANNOTATION over the skeleton. The output is small and
    //    flat (labels + prose keyed by deterministic ids), so the parse-failure
    //    surface is tiny. If it fails we keep the deterministic skeleton with
    //    fallback labels — the structure downstream consumers rely on is intact.
    if (skeleton.reconvergence.length === 0 && skeleton.paths.length <= 1) {
      // Linear episode — no branches or reconvergence worth annotating. Skip the
      // LLM round-trip entirely (saves a call and removes its failure surface).
      console.info(`[BranchManager] No branches/reconvergence for ${input.episodeId}; skipping annotation call.`);
      return { success: true, data: analysis };
    }

    try {
      const prompt = this.buildAnnotationPrompt(input, skeleton);
      // Schema-strict output: the small, flat annotation shape is enforced at the
      // provider (Anthropic forced tool use / OpenAI json_schema), so the parse
      // surface is near-zero. Degrades to text+parseJSON where unsupported.
      const response = await this.callLLM(
        [{ role: 'user', content: prompt }],
        4,
        { jsonSchema: { name: 'branch_annotations', description: 'Annotations for the deterministic branch structure', schema: BRANCH_ANNOTATION_SCHEMA } },
      );
      const annotations = this.parseJSON<BranchAnnotationPayload>(response);
      this.applyAnnotations(analysis, annotations);
      console.info(`[BranchManager] Annotated ${analysis.branchPaths.length} paths, ${analysis.reconvergencePoints.length} reconvergence points, ${analysis.validationIssues.length} issues`);
      return { success: true, data: analysis, rawResponse: response };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      // NOT a failure: the deterministic structure stands; only the prose flavor
      // is missing. Returning success keeps reconvergence residue and branch
      // labels working off the skeleton instead of dropping them entirely.
      console.warn(`[BranchManager] Annotation pass failed (non-critical); using deterministic skeleton: ${errorMsg}`);
      return { success: true, data: analysis };
    }
  }

  /**
   * Build the full {@link BranchAnalysis} from the deterministic skeleton, with
   * fallback labels and no LLM prose. Annotations are merged in afterward.
   */
  private assembleDeterministic(skeleton: BranchSkeleton, input: BranchManagerInput): BranchAnalysis {
    const nameOf = new Map(input.scenes.map((s) => [s.id, s.name] as const));
    const label = (id: string) => nameOf.get(id) || id;

    const branchPaths: BranchPath[] = skeleton.paths.map((p) => ({
      id: p.id,
      name: `${label(p.startSceneId)} → ${label(p.endSceneId)}`,
      description: `Path through ${p.sceneSequence.length} scenes.`,
      startSceneId: p.startSceneId,
      endSceneId: p.endSceneId,
      sceneSequence: p.sceneSequence,
      stateChanges: [],
    }));

    const reconvergencePoints: ReconvergencePoint[] = skeleton.reconvergence.map((r) => ({
      sceneId: r.sceneId,
      incomingBranches: r.incomingPathIds,
      stateReconciliation: [],
      narrativeAcknowledgment: '',
    }));

    // Deterministic state-tracking map: which scenes set which authored flags
    // (treatment seeds + ending/branch axes). `usedInScenes` is left empty —
    // concrete reads are not known until ChoiceAuthor runs, and no consumer
    // depends on this field. Honest-by-construction, no LLM guessing.
    const setBy = new Map<string, Set<string>>();
    for (const scene of input.scenes) {
      const cp = scene.choicePoint;
      if (!cp) continue;
      for (const flag of [...(cp.setsTreatmentSeeds || []), ...(cp.setsBranchAxes || [])]) {
        if (!setBy.has(flag)) setBy.set(flag, new Set());
        setBy.get(flag)!.add(scene.id);
      }
    }
    const stateTrackingMap: StateTrackingEntry[] = [...setBy.entries()].map(([variable, scenes]) => ({
      variable,
      type: 'flag',
      setInScenes: [...scenes],
      usedInScenes: [],
      possibleValues: ['true', 'false'],
    }));

    // Deterministic validation: unreachable scenes. (Dead-end detection requires
    // the episode's endingSceneId, which the pipeline's deterministic topology
    // pass already reports separately — we don't duplicate it here, and we skip
    // unreachable reporting when path enumeration was capped, to avoid false
    // positives from a truncated path set.)
    const validationIssues: ValidationIssue[] = [];
    if (!skeleton.pathsTruncated) {
      const reachable = new Set<string>();
      for (const p of skeleton.paths) for (const sid of p.sceneSequence) reachable.add(sid);
      for (const scene of input.scenes) {
        if (!reachable.has(scene.id)) {
          validationIssues.push({
            severity: 'error',
            type: 'unreachable_scene',
            description: `Scene ${scene.id} ("${scene.name}") is not reachable from ${input.startingSceneId}.`,
            affectedScenes: [scene.id],
            suggestedFix: 'Add an incoming edge from a reachable scene, or remove the scene.',
          });
        }
      }
    }

    return {
      episodeId: input.episodeId,
      branchPaths,
      reconvergencePoints,
      stateTrackingMap,
      validationIssues,
      recommendations: [],
    };
  }

  /** Merge LLM annotations onto the deterministic analysis, keyed by id / sceneId. */
  private applyAnnotations(analysis: BranchAnalysis, ann: BranchAnnotationPayload): void {
    const nonEmpty = (s: unknown): s is string => typeof s === 'string' && s.trim().length > 0;

    if (Array.isArray(ann?.pathAnnotations)) {
      const byId = new Map(analysis.branchPaths.map((p) => [p.id, p] as const));
      for (const a of ann.pathAnnotations) {
        const path = a && byId.get(a.id);
        if (!path) continue; // ignore ids the LLM invented
        if (nonEmpty(a.name)) path.name = a.name;
        if (nonEmpty(a.description)) path.description = a.description;
        if (nonEmpty(a.narrativeTheme)) path.narrativeTheme = a.narrativeTheme;
      }
    }

    if (Array.isArray(ann?.reconvergenceAnnotations)) {
      const bySceneId = new Map(analysis.reconvergencePoints.map((r) => [r.sceneId, r] as const));
      for (const a of ann.reconvergenceAnnotations) {
        const point = a && bySceneId.get(a.sceneId);
        if (!point) continue;
        if (nonEmpty(a.narrativeAcknowledgment)) point.narrativeAcknowledgment = a.narrativeAcknowledgment;
        if (Array.isArray(a.stateReconciliation)) {
          point.stateReconciliation = a.stateReconciliation
            .filter((sr) => sr && (nonEmpty(sr.stateVariable) || nonEmpty(sr.howToHandle)))
            .map((sr) => ({
              stateVariable: sr.stateVariable || '',
              possibleValues: Array.isArray(sr.possibleValues) ? sr.possibleValues : [],
              howToHandle: sr.howToHandle || '',
            }));
        }
      }
    }

    if (Array.isArray(ann?.recommendations)) {
      analysis.recommendations = ann.recommendations.filter(nonEmpty);
    }
  }

  private buildAnnotationPrompt(input: BranchManagerInput, skeleton: BranchSkeleton): string {
    const nameOf = new Map(input.scenes.map((s) => [s.id, s.name] as const));
    const label = (id: string) => `${id}${nameOf.has(id) ? ` ("${nameOf.get(id)}")` : ''}`;

    const pathsList = skeleton.paths
      .map((p) => `  - ${p.id}: ${p.sceneSequence.map(label).join(' → ')}`)
      .join('\n');

    const reconvList = skeleton.reconvergence
      .map((r) => `  - ${label(r.sceneId)} — paths converging here: [${r.incomingPathIds.join(', ')}]`)
      .join('\n');

    return `
Annotate the branch structure for this episode. The structure below was computed
deterministically from the scene graph — treat it as fixed and authoritative.

## Story Context
- **Title**: ${input.storyContext.title}
- **Genre**: ${input.storyContext.genre}
- **Tone**: ${input.storyContext.tone}

## Episode
- **ID**: ${input.episodeId}
- **Title**: ${input.episodeTitle}

## Paths (annotate each by its exact id)
${pathsList || '  (none)'}

## Reconvergence points (annotate each by its exact sceneId)
${reconvList || '  (none)'}

## Required JSON (annotation only — do NOT add or remove paths/points)

{
  "pathAnnotations": [
    {
      "id": "path-1",
      "name": "Short evocative name for this route",
      "description": "One line on what makes this path distinct",
      "narrativeTheme": "The theme/flavor of this path"
    }
  ],
  "reconvergenceAnnotations": [
    {
      "sceneId": "scene-id",
      "narrativeAcknowledgment": "One sentence the story can use to nod to the different incoming paths",
      "stateReconciliation": [
        { "stateVariable": "flag_or_relationship", "possibleValues": ["value1", "value2"], "howToHandle": "How to reconcile" }
      ]
    }
  ],
  "recommendations": ["Actionable branch-design suggestions"]
}

RULES:
1. Use ONLY the path ids and scene ids listed above — never invent new ones.
2. Provide one annotation entry per path and per reconvergence point.
3. stateReconciliation is optional per point; include it only where paths plausibly differ in state.
4. Return ONLY valid JSON, no markdown, no extra text.
`;
  }
}

/** JSON Schema for {@link BranchAnnotationPayload} — enforced provider-side. */
const BRANCH_ANNOTATION_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    pathAnnotations: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          description: { type: 'string' },
          narrativeTheme: { type: 'string' },
        },
        required: ['id'],
      },
    },
    reconvergenceAnnotations: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          sceneId: { type: 'string' },
          narrativeAcknowledgment: { type: 'string' },
          stateReconciliation: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                stateVariable: { type: 'string' },
                possibleValues: { type: 'array', items: { type: 'string' } },
                howToHandle: { type: 'string' },
              },
            },
          },
        },
        required: ['sceneId'],
      },
    },
    recommendations: { type: 'array', items: { type: 'string' } },
  },
};

/** Small, flat payload the annotation LLM call returns (keyed by deterministic ids). */
interface BranchAnnotationPayload {
  pathAnnotations?: Array<{
    id: string;
    name?: string;
    description?: string;
    narrativeTheme?: string;
  }>;
  reconvergenceAnnotations?: Array<{
    sceneId: string;
    narrativeAcknowledgment?: string;
    stateReconciliation?: Array<{
      stateVariable?: string;
      possibleValues?: string[];
      howToHandle?: string;
    }>;
  }>;
  recommendations?: string[];
}
