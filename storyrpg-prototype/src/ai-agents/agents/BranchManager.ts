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
import { ChoiceType, Consequence } from '../../types';
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
## Your Role: Branch Manager

You are the narrative flow architect who ensures branching stories remain coherent and satisfying. You analyze scene graphs, track state implications, and validate that all paths lead to meaningful outcomes.

(The BRANCH-AND-BOTTLENECK framework — bottleneck scenes, branch zones,
reconvergence rules, distinct-experience rule — is already provided in the
shared system prompt. Apply it here; do NOT repeat the framework definitions.
Your job is to USE those principles to analyze a concrete scene graph.)

## State Tracking Responsibilities

### Track All Variables
- Flags: Boolean state (true/false)
- Scores: Numeric values that can increase/decrease
- Tags: Identity markers the player can gain/lose
- Relationships: Trust, affection, respect, fear with NPCs

### State Implications
- Every choice that sets state must have that state used later
- Orphan state (set but never read) is a design smell
- Contradictory state must be impossible through proper conditions

## Validation Checks

1. **No Dead Ends**: Every scene must lead somewhere (unless it's an ending)
2. **No Orphan Branches**: Every branch must eventually reconverge
3. **No Unreachable Scenes**: Every scene must be reachable from start
4. **State Consistency**: No contradictory state combinations possible
5. **Bottleneck Accessibility**: All bottlenecks reachable from all valid paths

## Analysis Output

For each branch path:
- Identify the complete scene sequence
- List all state changes along the path
- Note the narrative theme/flavor of this path

For reconvergence points:
- Identify which branches converge
- Specify how state differences are reconciled
- Suggest narrative acknowledgment text

For validation:
- Report any structural issues
- Suggest fixes for problems found
- Recommend improvements
`;
  }

  async execute(input: BranchManagerInput): Promise<AgentResponse<BranchAnalysis>> {
    const prompt = this.buildPrompt(input);

    console.log(`[BranchManager] Analyzing branch structure for episode: ${input.episodeId}`);

    try {
      const response = await this.callLLM([
        { role: 'user', content: prompt }
      ]);

      console.log(`[BranchManager] Received response (${response.length} chars)`);

      let analysis: BranchAnalysis;
      try {
        analysis = this.parseJSON<BranchAnalysis>(response);
      } catch (parseError) {
        console.error(`[BranchManager] JSON parse failed. Raw response (first 500 chars):`, response.substring(0, 500));
        throw parseError;
      }

      // Normalize the output
      analysis = this.normalizeAnalysis(analysis, input);

      console.log(`[BranchManager] Found ${analysis.branchPaths?.length || 0} paths, ${analysis.reconvergencePoints?.length || 0} reconvergence points, ${analysis.validationIssues?.length || 0} issues`);

      return {
        success: true,
        data: analysis,
        rawResponse: response,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`[BranchManager] Error:`, errorMsg);
      return {
        success: false,
        error: errorMsg,
      };
    }
  }

  private normalizeAnalysis(analysis: BranchAnalysis, input: BranchManagerInput): BranchAnalysis {
    // Ensure episodeId
    if (!analysis.episodeId) {
      analysis.episodeId = input.episodeId;
    }

    // Ensure branchPaths is an array
    if (!analysis.branchPaths) {
      analysis.branchPaths = [];
    } else if (!Array.isArray(analysis.branchPaths)) {
      analysis.branchPaths = [analysis.branchPaths as unknown as BranchPath];
    }

    // Normalize each branch path
    for (let i = 0; i < analysis.branchPaths.length; i++) {
      const path = analysis.branchPaths[i];
      if (!path.id) {
        path.id = `branch-${i + 1}`;
      }
      if (!path.sceneSequence) {
        path.sceneSequence = [];
      } else if (!Array.isArray(path.sceneSequence)) {
        path.sceneSequence = [path.sceneSequence as unknown as string];
      }
      if (!path.stateChanges) {
        path.stateChanges = [];
      } else if (!Array.isArray(path.stateChanges)) {
        path.stateChanges = [path.stateChanges as unknown as StateChange];
      }
    }

    // Ensure reconvergencePoints is an array
    if (!analysis.reconvergencePoints) {
      analysis.reconvergencePoints = [];
    } else if (!Array.isArray(analysis.reconvergencePoints)) {
      analysis.reconvergencePoints = [analysis.reconvergencePoints as unknown as ReconvergencePoint];
    }

    // Normalize each reconvergence point
    for (const point of analysis.reconvergencePoints) {
      if (!point.incomingBranches) {
        point.incomingBranches = [];
      } else if (!Array.isArray(point.incomingBranches)) {
        point.incomingBranches = [point.incomingBranches as unknown as string];
      }
      if (!point.stateReconciliation) {
        point.stateReconciliation = [];
      } else if (!Array.isArray(point.stateReconciliation)) {
        point.stateReconciliation = [point.stateReconciliation as unknown as StateReconciliation];
      }
    }

    // Ensure stateTrackingMap is an array
    if (!analysis.stateTrackingMap) {
      analysis.stateTrackingMap = [];
    } else if (!Array.isArray(analysis.stateTrackingMap)) {
      analysis.stateTrackingMap = [analysis.stateTrackingMap as unknown as StateTrackingEntry];
    }

    // Normalize state tracking entries
    for (const entry of analysis.stateTrackingMap) {
      if (!entry.setInScenes) {
        entry.setInScenes = [];
      } else if (!Array.isArray(entry.setInScenes)) {
        entry.setInScenes = [entry.setInScenes as unknown as string];
      }
      if (!entry.usedInScenes) {
        entry.usedInScenes = [];
      } else if (!Array.isArray(entry.usedInScenes)) {
        entry.usedInScenes = [entry.usedInScenes as unknown as string];
      }
      if (!entry.possibleValues) {
        entry.possibleValues = [];
      } else if (!Array.isArray(entry.possibleValues)) {
        entry.possibleValues = [entry.possibleValues as unknown as string];
      }
    }

    // Ensure validationIssues is an array
    if (!analysis.validationIssues) {
      analysis.validationIssues = [];
    } else if (!Array.isArray(analysis.validationIssues)) {
      analysis.validationIssues = [analysis.validationIssues as unknown as ValidationIssue];
    }

    // Normalize validation issues
    for (const issue of analysis.validationIssues) {
      if (!issue.affectedScenes) {
        issue.affectedScenes = [];
      } else if (!Array.isArray(issue.affectedScenes)) {
        issue.affectedScenes = [issue.affectedScenes as unknown as string];
      }
    }

    // Ensure recommendations is an array
    if (!analysis.recommendations) {
      analysis.recommendations = [];
    } else if (!Array.isArray(analysis.recommendations)) {
      analysis.recommendations = [analysis.recommendations as unknown as string];
    }

    return analysis;
  }

  private buildPrompt(input: BranchManagerInput): string {
    const scenesList = input.scenes.map(scene => {
      const choiceInfo = scene.choicePoint
        ? `\n    Choice: ${scene.choicePoint.type} - ${scene.choicePoint.description}`
        : '';
      return `  - ${scene.id}: "${scene.name}" (${scene.purpose})
    Leads to: [${scene.leadsTo.join(', ')}]${choiceInfo}`;
    }).join('\n');

    const flagsList = input.availableFlags
      .map(f => `- ${f.name}: ${f.description}`)
      .join('\n');

    const scoresList = input.availableScores
      .map(s => `- ${s.name}: ${s.description}`)
      .join('\n');

    const tagsList = input.availableTags
      .map(t => `- ${t.name}: ${t.description}`)
      .join('\n');

    return `
Analyze the branch structure for the following episode:

## Story Context
- **Title**: ${input.storyContext.title}
- **Genre**: ${input.storyContext.genre}
- **Tone**: ${input.storyContext.tone}

## Episode
- **ID**: ${input.episodeId}
- **Title**: ${input.episodeTitle}
- **Starting Scene**: ${input.startingSceneId}
- **Bottleneck Scenes**: [${input.bottleneckScenes.join(', ')}]

## Scene Graph
${scenesList}

## Available State Variables

**Flags**:
${flagsList || 'None defined'}

**Scores**:
${scoresList || 'None defined'}

**Tags**:
${tagsList || 'None defined'}

## Required JSON Structure

{
  "episodeId": "${input.episodeId}",
  "branchPaths": [
    {
      "id": "branch-1",
      "name": "Path name",
      "description": "What makes this path distinct",
      "startSceneId": "scene-id",
      "endSceneId": "scene-id",
      "sceneSequence": ["scene-1", "scene-2"],
      "stateChanges": [
        {
          "type": "flag",
          "name": "flag_name",
          "change": true,
          "sceneId": "scene-id",
          "significance": "major"
        }
      ],
      "narrativeTheme": "Theme of this path"
    }
  ],
  "reconvergencePoints": [
    {
      "sceneId": "scene-id",
      "incomingBranches": ["branch-1", "branch-2"],
      "stateReconciliation": [
        {
          "stateVariable": "variable_name",
          "possibleValues": ["value1", "value2"],
          "howToHandle": "Description of reconciliation"
        }
      ],
      "narrativeAcknowledgment": "How the story acknowledges different paths"
    }
  ],
  "stateTrackingMap": [
    {
      "variable": "variable_name",
      "type": "flag",
      "setInScenes": ["scene-1"],
      "usedInScenes": ["scene-3"],
      "possibleValues": ["true", "false"]
    }
  ],
  "validationIssues": [
    {
      "severity": "warning",
      "type": "orphan_branch",
      "description": "Description of the issue",
      "affectedScenes": ["scene-id"],
      "suggestedFix": "How to fix it"
    }
  ],
  "recommendations": ["Improvement suggestions"]
}

CRITICAL REQUIREMENTS:
1. Identify ALL distinct paths through the episode
2. Identify ALL reconvergence points where branches meet
3. Track ALL state changes and where they're used
4. Report ALL validation issues (dead ends, unreachable scenes, etc.)
5. Provide actionable recommendations
6. Return ONLY valid JSON, no markdown, no extra text
`;
  }
}
