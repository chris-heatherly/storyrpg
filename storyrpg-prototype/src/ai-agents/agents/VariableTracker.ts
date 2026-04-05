/**
 * Variable Tracker Agent
 *
 * The state management specialist responsible for:
 * - Maintaining a registry of all variables (flags, scores, tags)
 * - Detecting orphaned variables (set but never read)
 * - Finding undefined variable references
 * - Tracking variable usage patterns across episodes
 */

import { AgentConfig } from '../config';
import { BaseAgent, AgentResponse } from './BaseAgent';
import { SceneContent } from './SceneWriter';
import { ChoiceSet } from './ChoiceAuthor';

// Variable types
export type VariableType = 'flag' | 'score' | 'tag' | 'relationship';

// Input types
export interface VariableTrackerInput {
  // Variable definitions
  definedFlags: Array<{ name: string; description: string }>;
  definedScores: Array<{ name: string; description: string; min?: number; max?: number }>;
  definedTags: Array<{ name: string; description: string }>;
  definedRelationships: Array<{
    npcId: string;
    npcName: string;
    dimensions: Array<'trust' | 'affection' | 'respect' | 'fear'>;
  }>;

  // Content to analyze
  sceneContents: SceneContent[];
  choiceSets: ChoiceSet[];

  // Episode context
  episodeId: string;

  // Cross-episode tracking (optional)
  previousEpisodeVariables?: VariableReport;
}

// Output types
export interface VariableUsage {
  name: string;
  type: VariableType;
  description?: string;

  // Where it's used
  setIn: Array<{
    sceneId: string;
    beatId?: string;
    choiceId?: string;
    context: string;
  }>;

  readIn: Array<{
    sceneId: string;
    beatId?: string;
    choiceId?: string;
    context: string;
  }>;

  // Analysis
  isOrphan: boolean; // Set but never read
  isUndefined: boolean; // Read but never set
  usageCount: number;
  importance: 'low' | 'medium' | 'high';
}

export interface VariableIssue {
  severity: 'error' | 'warning' | 'suggestion';
  type: 'orphan' | 'undefined' | 'type_mismatch' | 'impossible_value' | 'unused_definition';
  variableName: string;
  variableType: VariableType;
  description: string;
  locations: string[];
  suggestedFix: string;
}

export interface VariableReport {
  episodeId: string;

  // Variable registry
  variables: VariableUsage[];

  // Summary counts
  summary: {
    totalFlags: number;
    totalScores: number;
    totalTags: number;
    totalRelationships: number;
    orphanCount: number;
    undefinedCount: number;
  };

  // Issues found
  issues: VariableIssue[];

  // Variable flow analysis
  flowAnalysis: {
    variablesSetThisEpisode: string[];
    variablesReadThisEpisode: string[];
    variablesCarriedForward: string[];
    newVariablesIntroduced: string[];
  };

  // Recommendations
  recommendations: string[];
}

export class VariableTracker extends BaseAgent {
  constructor(config: AgentConfig) {
    super('Variable Tracker', config);
  }

  protected getAgentSpecificPrompt(): string {
    return `
## Your Role: Variable Tracker

You maintain the state registry and ensure all variables are properly defined, used, and meaningful. Clean state management is crucial for branching narratives.

## What You Track

### Flags (Boolean)
- True/False state
- Usually set once, read many times
- Common for tracking "has done X" or "knows Y"

### Scores (Numeric)
- Can increase or decrease
- Often bounded (min/max)
- Track progress, resources, or cumulative choices

### Tags (Identity)
- Player identity markers
- Usually gained, rarely lost
- Represent character traits or alignments

### Relationships
- Per-NPC, per-dimension
- Dimensions: trust, affection, respect, fear
- Change based on interactions

## Issues to Detect

### Orphan Variables
Variables that are SET but never READ anywhere.
- Wastes player's mental tracking
- May indicate incomplete implementation
- Could be future-episode setup (check context)

### Undefined Variables
Variables that are READ but never SET.
- Will cause runtime errors or undefined behavior
- Must be fixed before shipping

### Type Mismatches
- Using flag operations on scores
- Comparing incompatible types
- Setting impossible values

### Unused Definitions
Variables defined but never used at all.
- Clutters the state space
- May indicate cut content

## Analysis Guidelines

1. Extract all SET operations from consequences
2. Extract all READ operations from conditions
3. Cross-reference with definitions
4. Report discrepancies
5. Suggest fixes where possible
`;
  }

  async execute(input: VariableTrackerInput): Promise<AgentResponse<VariableReport>> {
    console.log(`[VariableTracker] Tracking variables for episode: ${input.episodeId}`);

    try {
      // This is mostly deterministic analysis, with LLM for edge cases
      const report = this.analyzeVariables(input);

      console.log(`[VariableTracker] Found ${report.summary.orphanCount} orphans, ${report.summary.undefinedCount} undefined references`);

      return {
        success: true,
        data: report,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`[VariableTracker] Error:`, errorMsg);
      return {
        success: false,
        error: errorMsg,
      };
    }
  }

  private analyzeVariables(input: VariableTrackerInput): VariableReport {
    const variables: VariableUsage[] = [];
    const issues: VariableIssue[] = [];

    // Track sets and reads
    const sets = new Map<string, Array<{ sceneId: string; beatId?: string; choiceId?: string; context: string }>>();
    const reads = new Map<string, Array<{ sceneId: string; beatId?: string; choiceId?: string; context: string }>>();

    // Analyze scene contents for text variants (conditions = reads)
    for (const scene of input.sceneContents) {
      for (const beat of scene.beats) {
        // Check text variants
        if (beat.textVariants) {
          for (const variant of beat.textVariants) {
            if (variant.condition) {
              const conditionVars = this.extractVariablesFromCondition(variant.condition);
              for (const varName of conditionVars) {
                if (!reads.has(varName)) reads.set(varName, []);
                reads.get(varName)!.push({
                  sceneId: scene.sceneId,
                  beatId: beat.id,
                  context: `Text variant condition: ${this.formatCondition(variant.condition)}`,
                });
              }
            }
          }
        }
      }
    }

    // Analyze choice sets (conditions = reads, consequences = sets)
    for (const choiceSet of input.choiceSets) {
      for (const choice of choiceSet.choices) {
        // Check conditions (reads)
        if (choice.conditions) {
          const conditionVars = this.extractVariablesFromCondition(choice.conditions);
          for (const varName of conditionVars) {
            if (!reads.has(varName)) reads.set(varName, []);
            reads.get(varName)!.push({
              sceneId: choiceSet.beatId,
              choiceId: choice.id,
              context: `Choice conditions: ${this.formatCondition(choice.conditions)}`,
            });
          }
        }

        // Check consequences (sets)
        if (choice.consequences) {
          for (const consequence of choice.consequences) {
            const varInfo = this.extractVariableFromConsequence(consequence);
            if (varInfo) {
              if (!sets.has(varInfo.name)) sets.set(varInfo.name, []);
              sets.get(varInfo.name)!.push({
                sceneId: choiceSet.beatId,
                choiceId: choice.id,
                context: `Consequence: ${varInfo.description}`,
              });
            }
          }
        }
      }
    }

    // Build variable usage from definitions
    for (const flag of input.definedFlags) {
      variables.push(this.buildVariableUsage(flag.name, 'flag', flag.description, sets, reads));
    }

    for (const score of input.definedScores) {
      variables.push(this.buildVariableUsage(score.name, 'score', score.description, sets, reads));
    }

    for (const tag of input.definedTags) {
      variables.push(this.buildVariableUsage(tag.name, 'tag', tag.description, sets, reads));
    }

    for (const rel of input.definedRelationships) {
      for (const dimension of rel.dimensions) {
        const name = `${rel.npcId}.${dimension}`;
        variables.push(this.buildVariableUsage(name, 'relationship', `${rel.npcName}'s ${dimension}`, sets, reads));
      }
    }

    // Check for undefined variables (used but not defined)
    const definedNames = new Set(variables.map(v => v.name));
    const allReferencedNames = new Set([...sets.keys(), ...reads.keys()]);

    for (const name of allReferencedNames) {
      if (!definedNames.has(name)) {
        // This variable is used but not defined
        const setLocations = sets.get(name) || [];
        const readLocations = reads.get(name) || [];

        variables.push({
          name,
          type: this.inferVariableType(name, sets.get(name), reads.get(name)),
          setIn: setLocations,
          readIn: readLocations,
          isOrphan: setLocations.length > 0 && readLocations.length === 0,
          isUndefined: readLocations.length > 0 && setLocations.length === 0,
          usageCount: setLocations.length + readLocations.length,
          importance: 'medium',
        });

        if (readLocations.length > 0 && setLocations.length === 0) {
          issues.push({
            severity: 'error',
            type: 'undefined',
            variableName: name,
            variableType: this.inferVariableType(name, sets.get(name), reads.get(name)),
            description: `Variable "${name}" is read but never set`,
            locations: readLocations.map(l => `${l.sceneId}/${l.beatId || l.choiceId}`),
            suggestedFix: `Define "${name}" and ensure it's set before being read`,
          });
        }
      }
    }

    // Check for orphan variables (set but never read)
    for (const variable of variables) {
      if (variable.isOrphan && !variable.isUndefined) {
        issues.push({
          severity: 'warning',
          type: 'orphan',
          variableName: variable.name,
          variableType: variable.type,
          description: `Variable "${variable.name}" is set but never read`,
          locations: variable.setIn.map(l => `${l.sceneId}/${l.beatId || l.choiceId}`),
          suggestedFix: `Either use "${variable.name}" in a condition or remove if unnecessary`,
        });
      }
    }

    // Check for unused definitions
    for (const variable of variables) {
      if (variable.usageCount === 0) {
        issues.push({
          severity: 'suggestion',
          type: 'unused_definition',
          variableName: variable.name,
          variableType: variable.type,
          description: `Variable "${variable.name}" is defined but never used`,
          locations: [],
          suggestedFix: `Remove the definition or implement usage`,
        });
      }
    }

    // Build summary
    const summary = {
      totalFlags: variables.filter(v => v.type === 'flag').length,
      totalScores: variables.filter(v => v.type === 'score').length,
      totalTags: variables.filter(v => v.type === 'tag').length,
      totalRelationships: variables.filter(v => v.type === 'relationship').length,
      orphanCount: variables.filter(v => v.isOrphan).length,
      undefinedCount: variables.filter(v => v.isUndefined).length,
    };

    // Build flow analysis
    const flowAnalysis = {
      variablesSetThisEpisode: [...new Set(Array.from(sets.keys()))],
      variablesReadThisEpisode: [...new Set(Array.from(reads.keys()))],
      variablesCarriedForward: variables
        .filter(v => v.setIn.length > 0 && v.readIn.length === 0)
        .map(v => v.name),
      newVariablesIntroduced: input.previousEpisodeVariables
        ? variables
            .filter(v => !input.previousEpisodeVariables!.variables.find(pv => pv.name === v.name))
            .map(v => v.name)
        : variables.map(v => v.name),
    };

    // Generate recommendations
    const recommendations: string[] = [];

    if (summary.orphanCount > 0) {
      recommendations.push(`Review ${summary.orphanCount} orphan variable(s) - they may be setup for future episodes or dead code`);
    }

    if (summary.undefinedCount > 0) {
      recommendations.push(`CRITICAL: ${summary.undefinedCount} undefined variable(s) must be fixed before shipping`);
    }

    if (flowAnalysis.variablesCarriedForward.length > 0) {
      recommendations.push(`${flowAnalysis.variablesCarriedForward.length} variable(s) set this episode may need to be used in future episodes`);
    }

    return {
      episodeId: input.episodeId,
      variables,
      summary,
      issues,
      flowAnalysis,
      recommendations,
    };
  }

  private buildVariableUsage(
    name: string,
    type: VariableType,
    description: string | undefined,
    sets: Map<string, Array<{ sceneId: string; beatId?: string; choiceId?: string; context: string }>>,
    reads: Map<string, Array<{ sceneId: string; beatId?: string; choiceId?: string; context: string }>>
  ): VariableUsage {
    const setIn = sets.get(name) || [];
    const readIn = reads.get(name) || [];

    return {
      name,
      type,
      description,
      setIn,
      readIn,
      isOrphan: setIn.length > 0 && readIn.length === 0,
      isUndefined: readIn.length > 0 && setIn.length === 0,
      usageCount: setIn.length + readIn.length,
      importance: this.determineImportance(setIn.length, readIn.length),
    };
  }

  private extractVariablesFromCondition(condition: unknown): string[] {
    const variables: string[] = [];

    if (typeof condition === 'string') {
      // Simple string condition - extract variable names
      const flagMatch = condition.match(/hasFlag:(\w+)/);
      if (flagMatch) variables.push(flagMatch[1]);

      const scoreMatch = condition.match(/score:(\w+)/);
      if (scoreMatch) variables.push(scoreMatch[1]);

      const tagMatch = condition.match(/hasTag:(\w+)/);
      if (tagMatch) variables.push(tagMatch[1]);

      const relMatch = condition.match(/relationship:(\w+\.\w+)/);
      if (relMatch) variables.push(relMatch[1]);

      return variables;
    }

    if (typeof condition === 'object' && condition !== null) {
      const cond = condition as Record<string, unknown>;

      if (cond.type === 'hasFlag' && cond.flag) {
        variables.push(String(cond.flag));
      }
      if (cond.type === 'scoreCheck' && cond.score) {
        variables.push(String(cond.score));
      }
      if (cond.type === 'hasTag' && cond.tag) {
        variables.push(String(cond.tag));
      }
      if (cond.type === 'relationship' && cond.npcId && cond.dimension) {
        variables.push(`${cond.npcId}.${cond.dimension}`);
      }
      if (cond.type === 'and' || cond.type === 'or') {
        if (Array.isArray(cond.conditions)) {
          for (const subCond of cond.conditions) {
            variables.push(...this.extractVariablesFromCondition(subCond));
          }
        }
      }
    }

    return variables;
  }

  private extractVariableFromConsequence(consequence: unknown): { name: string; description: string } | null {
    if (typeof consequence !== 'object' || consequence === null) {
      return null;
    }

    const c = consequence as Record<string, unknown>;

    switch (c.type) {
      case 'setFlag':
        return { name: String(c.flag), description: `set ${c.flag} = ${c.value}` };
      case 'changeScore':
        return { name: String(c.score), description: `change ${c.score} by ${c.change}` };
      case 'addTag':
        return { name: String(c.tag), description: `add tag ${c.tag}` };
      case 'removeTag':
        return { name: String(c.tag), description: `remove tag ${c.tag}` };
      case 'relationship':
        return {
          name: `${c.npcId}.${c.dimension}`,
          description: `change ${c.npcId}.${c.dimension} by ${c.change}`,
        };
      default:
        return null;
    }
  }

  private formatCondition(condition: unknown): string {
    if (typeof condition === 'string') {
      return condition;
    }
    return JSON.stringify(condition);
  }

  private inferVariableType(
    name: string,
    sets?: Array<{ context: string }>,
    reads?: Array<{ context: string }>
  ): VariableType {
    // Infer from name patterns
    if (name.includes('.')) {
      return 'relationship';
    }

    // Infer from usage context
    const contexts = [...(sets?.map(s => s.context) || []), ...(reads?.map(r => r.context) || [])];
    for (const context of contexts) {
      if (context.includes('setFlag') || context.includes('hasFlag')) return 'flag';
      if (context.includes('Score') || context.includes('score')) return 'score';
      if (context.includes('Tag') || context.includes('tag')) return 'tag';
      if (context.includes('relationship')) return 'relationship';
    }

    // Default to flag
    return 'flag';
  }

  private determineImportance(setCount: number, readCount: number): 'low' | 'medium' | 'high' {
    const total = setCount + readCount;
    if (total > 5) return 'high';
    if (total > 2) return 'medium';
    return 'low';
  }
}
