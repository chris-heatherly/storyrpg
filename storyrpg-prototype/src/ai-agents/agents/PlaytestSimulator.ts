/**
 * Playtest Simulator Agent
 *
 * The automated testing specialist responsible for:
 * - Simulating player paths through the episode
 * - Testing all branches and choices
 * - Identifying unreachable content
 * - Verifying state consistency across paths
 */

import { AgentConfig } from '../config';
import { BaseAgent, AgentResponse } from './BaseAgent';
import { CompiledEpisode, CompiledScene, CompiledBeat, CompiledChoice } from './ScriptCompiler';

// Simulation strategies
export type PlayStrategy =
  | 'random' // Random choices
  | 'exhaustive' // Try every path
  | 'optimal' // Try to get best outcomes
  | 'chaotic' // Make worst choices
  | 'persona'; // Simulate specific player type

// Input types
export interface PlaytestSimulatorInput {
  // Episode to test
  episode: CompiledEpisode;

  // Simulation parameters
  strategy: PlayStrategy;
  maxPaths: number; // Limit for exhaustive testing
  maxStepsPerPath: number; // Prevent infinite loops

  // Persona definition (if strategy === 'persona')
  persona?: {
    name: string;
    priorities: string[]; // What this player type values
    avoids: string[]; // What they avoid
  };

  // State initialization overrides
  initialStateOverrides?: {
    flags?: Record<string, boolean>;
    scores?: Record<string, number>;
    tags?: string[];
  };
}

// Output types
export interface SimulatedPath {
  id: string;
  strategy: PlayStrategy;

  // Path trace
  steps: PathStep[];

  // Final state
  finalState: GameState;

  // Path metrics
  metrics: {
    totalSteps: number;
    scenesVisited: string[];
    choicesMade: number;
    uniqueBeatsEncountered: number;
  };

  // Issues encountered
  issues: PathIssue[];

  // Path summary
  summary: string;
}

export interface PathStep {
  stepNumber: number;
  sceneId: string;
  beatId: string;
  action: 'read' | 'choice' | 'transition';
  choiceId?: string;
  choiceText?: string;
  stateChanges: StateChange[];
  notes?: string;
}

export interface StateChange {
  variable: string;
  oldValue: unknown;
  newValue: unknown;
}

export interface GameState {
  flags: Record<string, boolean>;
  scores: Record<string, number>;
  tags: string[];
  currentSceneId: string;
  visitedScenes: string[];
  visitedBeats: string[];
}

export interface PathIssue {
  severity: 'error' | 'warning' | 'info';
  type: 'dead_end' | 'infinite_loop' | 'unreachable' | 'broken_condition' | 'missing_transition' | 'invalid_state';
  stepNumber: number;
  sceneId: string;
  beatId?: string;
  description: string;
  context: string;
}

export interface PlaytestReport {
  episodeId: string;
  strategy: PlayStrategy;

  // Paths simulated
  paths: SimulatedPath[];

  // Coverage analysis
  coverage: {
    scenesTotal: number;
    scenesReached: number;
    beatsTotal: number;
    beatsReached: number;
    choicesTotal: number;
    choicesTaken: number;
    coveragePercentage: number;
  };

  // Unreached content
  unreachedScenes: string[];
  unreachedBeats: string[];
  unreachedChoices: string[];

  // Aggregate issues
  issues: PathIssue[];

  // State analysis
  stateAnalysis: {
    flagsUsed: string[];
    scoresChanged: string[];
    tagsGained: string[];
    stateConflicts: string[];
  };

  // Recommendations
  recommendations: string[];
}

export class PlaytestSimulator extends BaseAgent {
  constructor(config: AgentConfig) {
    super('Playtest Simulator', config);
  }

  protected getAgentSpecificPrompt(): string {
    return `
## Your Role: Playtest Simulator

You automate testing of interactive narratives by simulating player paths through the content. Your job is to find bugs, unreachable content, and broken logic before real players encounter them.

## Simulation Strategies

### Random
- Make random choices at each decision point
- Good for quick smoke testing
- May miss edge cases

### Exhaustive
- Systematically try every possible path
- Guarantees complete coverage
- Can be slow for complex episodes

### Optimal
- Try to make choices that lead to best outcomes
- Simulates engaged, goal-oriented players
- Tests the "golden path"

### Chaotic
- Make counterproductive choices
- Tests edge cases and fail states
- Ensures failures are handled

### Persona
- Simulate a specific player archetype
- Makes choices based on defined priorities
- Tests if target audience's path is satisfying

## What You Test

### Reachability
- Can all scenes be reached?
- Can all beats be seen?
- Can all choices be made?

### State Consistency
- Do flags get set before being read?
- Are scores in valid ranges?
- Do conditions ever conflict?

### Navigation
- Do all paths lead somewhere?
- Are there infinite loops?
- Do dead ends make sense?

### Condition Logic
- Are conditions satisfiable?
- Do locked choices ever unlock?
- Are there impossible states?

## Issue Detection

- **DEAD_END**: Path stops with no way forward
- **INFINITE_LOOP**: Same state repeats indefinitely
- **UNREACHABLE**: Content that can't be reached
- **BROKEN_CONDITION**: Condition that can't be satisfied
- **MISSING_TRANSITION**: No valid next step
- **INVALID_STATE**: State values outside expected range
`;
  }

  async execute(input: PlaytestSimulatorInput): Promise<AgentResponse<PlaytestReport>> {
    console.log(`[PlaytestSimulator] Running ${input.strategy} simulation on episode: ${input.episode.id}`);

    try {
      let paths: SimulatedPath[];

      switch (input.strategy) {
        case 'exhaustive':
          paths = this.runExhaustiveSimulation(input);
          break;
        case 'random':
          paths = this.runRandomSimulation(input, input.maxPaths);
          break;
        case 'optimal':
          paths = this.runOptimalSimulation(input);
          break;
        case 'chaotic':
          paths = this.runChaoticSimulation(input);
          break;
        case 'persona':
          paths = this.runPersonaSimulation(input);
          break;
        default:
          paths = this.runRandomSimulation(input, 5);
      }

      // Build the report
      const report = this.buildReport(input, paths);

      console.log(`[PlaytestSimulator] Completed ${paths.length} paths, ${report.coverage.coveragePercentage.toFixed(1)}% coverage`);

      return {
        success: true,
        data: report,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`[PlaytestSimulator] Error:`, errorMsg);
      return {
        success: false,
        error: errorMsg,
      };
    }
  }

  private runExhaustiveSimulation(input: PlaytestSimulatorInput): SimulatedPath[] {
    const paths: SimulatedPath[] = [];
    const queue: Array<{ state: GameState; history: PathStep[] }> = [];

    // Start with initial state
    const initialState = this.createInitialState(input);
    queue.push({ state: initialState, history: [] });

    const visitedStates = new Set<string>();
    let pathCount = 0;

    while (queue.length > 0 && pathCount < input.maxPaths) {
      const { state, history } = queue.shift()!;

      // Check for duplicate states
      const stateHash = this.hashState(state);
      if (visitedStates.has(stateHash)) continue;
      visitedStates.add(stateHash);

      // Get current scene
      const scene = input.episode.scenes.find(s => s.id === state.currentSceneId);
      if (!scene) {
        // Dead end - no scene found
        paths.push(this.createPath(`path-${pathCount++}`, 'exhaustive', history, state, [{
          severity: 'error',
          type: 'missing_transition',
          stepNumber: history.length,
          sceneId: state.currentSceneId,
          description: `Scene "${state.currentSceneId}" not found`,
          context: 'Scene lookup failed',
        }]));
        continue;
      }

      // Simulate through beats
      const { finalState, steps, issues, branches } = this.simulateScene(
        scene,
        { ...state },
        history,
        input
      );

      // If there are branches (choices), add them to the queue
      if (branches.length > 0) {
        for (const branch of branches) {
          if (steps.length + history.length < input.maxStepsPerPath) {
            queue.push({
              state: branch.state,
              history: [...history, ...steps.slice(0, branch.afterStep), branch.choiceStep],
            });
          }
        }
      } else {
        // No more branches - this is a complete path
        paths.push(this.createPath(`path-${pathCount++}`, 'exhaustive', [...history, ...steps], finalState, issues));
      }
    }

    return paths;
  }

  private runRandomSimulation(input: PlaytestSimulatorInput, count: number): SimulatedPath[] {
    const paths: SimulatedPath[] = [];

    for (let i = 0; i < count; i++) {
      const path = this.simulateSinglePath(input, 'random');
      paths.push(path);
    }

    return paths;
  }

  private runOptimalSimulation(input: PlaytestSimulatorInput): SimulatedPath[] {
    // For optimal, we try to choose options that seem positive
    const path = this.simulateSinglePath(input, 'optimal');
    return [path];
  }

  private runChaoticSimulation(input: PlaytestSimulatorInput): SimulatedPath[] {
    // For chaotic, we try to choose options that seem negative
    const path = this.simulateSinglePath(input, 'chaotic');
    return [path];
  }

  private runPersonaSimulation(input: PlaytestSimulatorInput): SimulatedPath[] {
    if (!input.persona) {
      return this.runRandomSimulation(input, 1);
    }

    const path = this.simulateSinglePath(input, 'persona');
    return [path];
  }

  private simulateSinglePath(input: PlaytestSimulatorInput, strategy: PlayStrategy): SimulatedPath {
    let state = this.createInitialState(input);
    const steps: PathStep[] = [];
    const issues: PathIssue[] = [];
    let stepCount = 0;

    while (stepCount < input.maxStepsPerPath) {
      const scene = input.episode.scenes.find(s => s.id === state.currentSceneId);
      if (!scene) {
        issues.push({
          severity: 'error',
          type: 'missing_transition',
          stepNumber: stepCount,
          sceneId: state.currentSceneId,
          description: `Scene "${state.currentSceneId}" not found`,
          context: 'Scene lookup failed',
        });
        break;
      }

      // Mark scene as visited
      if (!state.visitedScenes.includes(scene.id)) {
        state.visitedScenes.push(scene.id);
      }

      // Process beats
      for (const beat of scene.beats) {
        if (stepCount >= input.maxStepsPerPath) break;

        // Mark beat as visited
        if (!state.visitedBeats.includes(beat.id)) {
          state.visitedBeats.push(beat.id);
        }

        if (beat.choices && beat.choices.length > 0) {
          // Choice beat
          const availableChoices = beat.choices.filter(c =>
            !c.condition || this.evaluateCondition(c.condition, state)
          );

          if (availableChoices.length === 0) {
            issues.push({
              severity: 'warning',
              type: 'broken_condition',
              stepNumber: stepCount,
              sceneId: scene.id,
              beatId: beat.id,
              description: 'No choices available - all are locked',
              context: `Beat has ${beat.choices.length} choices but none are accessible`,
            });
            break;
          }

          // Select a choice based on strategy
          const choice = this.selectChoice(availableChoices, strategy, state, input.persona);

          // Apply consequences
          const stateChanges = this.applyConsequences(choice.consequences, state);

          steps.push({
            stepNumber: stepCount++,
            sceneId: scene.id,
            beatId: beat.id,
            action: 'choice',
            choiceId: choice.id,
            choiceText: choice.text,
            stateChanges,
          });

          // Navigate
          if (choice.nextSceneId) {
            state.currentSceneId = choice.nextSceneId;
            break; // Exit beat loop, continue with new scene
          } else if (choice.nextBeatId) {
            // Continue to specific beat in same scene
            const beatIndex = scene.beats.findIndex(b => b.id === choice.nextBeatId);
            if (beatIndex === -1) {
              issues.push({
                severity: 'error',
                type: 'missing_transition',
                stepNumber: stepCount,
                sceneId: scene.id,
                beatId: beat.id,
                description: `Next beat "${choice.nextBeatId}" not found`,
                context: 'Choice navigation failed',
              });
              break;
            }
          }
        } else {
          // Non-choice beat
          steps.push({
            stepNumber: stepCount++,
            sceneId: scene.id,
            beatId: beat.id,
            action: beat.isTerminal ? 'transition' : 'read',
            stateChanges: [],
          });

          if (beat.isTerminal) {
            // Check for scene transitions
            if (scene.transitions.length > 0) {
              const validTransition = scene.transitions.find(t =>
                !t.condition || this.evaluateCondition(t.condition, state)
              );

              if (validTransition) {
                state.currentSceneId = validTransition.targetSceneId;
              } else {
                // No valid transition - path ends
                break;
              }
            } else {
              // No transitions - path ends
              break;
            }
          }
        }
      }

      // Check for infinite loops
      if (this.detectLoop(steps)) {
        issues.push({
          severity: 'error',
          type: 'infinite_loop',
          stepNumber: stepCount,
          sceneId: scene.id,
          description: 'Possible infinite loop detected',
          context: 'Same scene/beat visited multiple times in sequence',
        });
        break;
      }
    }

    if (stepCount >= input.maxStepsPerPath) {
      issues.push({
        severity: 'warning',
        type: 'infinite_loop',
        stepNumber: stepCount,
        sceneId: state.currentSceneId,
        description: 'Max steps reached - possible infinite path',
        context: `Path reached ${input.maxStepsPerPath} steps without ending`,
      });
    }

    return this.createPath(`path-${Date.now()}`, strategy, steps, state, issues);
  }

  private simulateScene(
    scene: CompiledScene,
    state: GameState,
    history: PathStep[],
    input: PlaytestSimulatorInput
  ): {
    finalState: GameState;
    steps: PathStep[];
    issues: PathIssue[];
    branches: Array<{ afterStep: number; state: GameState; choiceStep: PathStep }>;
  } {
    const steps: PathStep[] = [];
    const issues: PathIssue[] = [];
    const branches: Array<{ afterStep: number; state: GameState; choiceStep: PathStep }> = [];

    // Mark scene as visited
    if (!state.visitedScenes.includes(scene.id)) {
      state.visitedScenes.push(scene.id);
    }

    for (let beatIndex = 0; beatIndex < scene.beats.length; beatIndex++) {
      const beat = scene.beats[beatIndex];

      // Mark beat as visited
      if (!state.visitedBeats.includes(beat.id)) {
        state.visitedBeats.push(beat.id);
      }

      if (beat.choices && beat.choices.length > 0) {
        // This is a branching point - create branches for each available choice
        const availableChoices = beat.choices.filter(c =>
          !c.condition || this.evaluateCondition(c.condition, state)
        );

        for (const choice of availableChoices) {
          const branchState = JSON.parse(JSON.stringify(state)) as GameState;
          const stateChanges = this.applyConsequences(choice.consequences, branchState);

          if (choice.nextSceneId) {
            branchState.currentSceneId = choice.nextSceneId;
          }

          branches.push({
            afterStep: steps.length,
            state: branchState,
            choiceStep: {
              stepNumber: history.length + steps.length,
              sceneId: scene.id,
              beatId: beat.id,
              action: 'choice',
              choiceId: choice.id,
              choiceText: choice.text,
              stateChanges,
            },
          });
        }

        // For the main path, take the first available choice
        if (availableChoices.length > 0) {
          const choice = availableChoices[0];
          const stateChanges = this.applyConsequences(choice.consequences, state);

          steps.push({
            stepNumber: history.length + steps.length,
            sceneId: scene.id,
            beatId: beat.id,
            action: 'choice',
            choiceId: choice.id,
            choiceText: choice.text,
            stateChanges,
          });

          if (choice.nextSceneId) {
            state.currentSceneId = choice.nextSceneId;
            break;
          }
        }
      } else {
        steps.push({
          stepNumber: history.length + steps.length,
          sceneId: scene.id,
          beatId: beat.id,
          action: beat.isTerminal ? 'transition' : 'read',
          stateChanges: [],
        });
      }
    }

    return { finalState: state, steps, issues, branches };
  }

  private createInitialState(input: PlaytestSimulatorInput): GameState {
    const state: GameState = {
      flags: { ...input.episode.initialState.flags },
      scores: { ...input.episode.initialState.scores },
      tags: [...input.episode.initialState.tags],
      currentSceneId: input.episode.startingSceneId,
      visitedScenes: [],
      visitedBeats: [],
    };

    // Apply overrides
    if (input.initialStateOverrides) {
      if (input.initialStateOverrides.flags) {
        Object.assign(state.flags, input.initialStateOverrides.flags);
      }
      if (input.initialStateOverrides.scores) {
        Object.assign(state.scores, input.initialStateOverrides.scores);
      }
      if (input.initialStateOverrides.tags) {
        state.tags = [...input.initialStateOverrides.tags];
      }
    }

    return state;
  }

  private hashState(state: GameState): string {
    return JSON.stringify({
      flags: state.flags,
      scores: state.scores,
      tags: state.tags.sort(),
      currentSceneId: state.currentSceneId,
    });
  }

  private evaluateCondition(condition: string, state: GameState): boolean {
    // Simple condition evaluation
    // Format: hasFlag:flagName, score:scoreName>5, hasTag:tagName, etc.

    if (condition.startsWith('hasFlag:')) {
      const flagName = condition.slice(8);
      return state.flags[flagName] === true;
    }

    if (condition.startsWith('score:')) {
      const match = condition.match(/score:(\w+)([<>=]+)(\d+)/);
      if (match) {
        const [, scoreName, op, valueStr] = match;
        const scoreValue = state.scores[scoreName] || 0;
        const targetValue = parseInt(valueStr);

        switch (op) {
          case '>': return scoreValue > targetValue;
          case '<': return scoreValue < targetValue;
          case '>=': return scoreValue >= targetValue;
          case '<=': return scoreValue <= targetValue;
          case '==': return scoreValue === targetValue;
          default: return false;
        }
      }
    }

    if (condition.startsWith('hasTag:')) {
      const tagName = condition.slice(7);
      return state.tags.includes(tagName);
    }

    // Default to true for unknown conditions
    return true;
  }

  private selectChoice(
    choices: CompiledChoice[],
    strategy: PlayStrategy,
    state: GameState,
    persona?: { priorities: string[]; avoids: string[] }
  ): CompiledChoice {
    switch (strategy) {
      case 'random':
        return choices[Math.floor(Math.random() * choices.length)];

      case 'optimal':
        // Prefer choices with positive consequences
        const positiveChoice = choices.find(c =>
          c.consequences.some(con => typeof con.value === 'number' && con.value > 0)
        );
        return positiveChoice || choices[0];

      case 'chaotic':
        // Prefer choices with negative consequences or that seem risky
        const negativeChoice = choices.find(c =>
          c.consequences.some(con => typeof con.value === 'number' && con.value < 0)
        );
        return negativeChoice || choices[choices.length - 1];

      case 'persona':
        if (persona) {
          // Score each choice based on persona priorities
          let bestChoice = choices[0];
          let bestScore = -Infinity;

          for (const choice of choices) {
            let score = 0;
            const choiceText = choice.text.toLowerCase();

            for (const priority of persona.priorities) {
              if (choiceText.includes(priority.toLowerCase())) score += 10;
            }
            for (const avoid of persona.avoids) {
              if (choiceText.includes(avoid.toLowerCase())) score -= 10;
            }

            if (score > bestScore) {
              bestScore = score;
              bestChoice = choice;
            }
          }

          return bestChoice;
        }
        return choices[0];

      default:
        return choices[0];
    }
  }

  private applyConsequences(
    consequences: CompiledChoice['consequences'],
    state: GameState
  ): StateChange[] {
    const changes: StateChange[] = [];

    for (const consequence of consequences) {
      const oldValue = this.getStateValue(consequence.target, state);

      switch (consequence.type) {
        case 'setFlag':
          state.flags[consequence.target] = consequence.value as boolean;
          break;
        case 'changeScore':
          state.scores[consequence.target] = (state.scores[consequence.target] || 0) + (consequence.value as number);
          break;
        case 'addTag':
          if (!state.tags.includes(consequence.target)) {
            state.tags.push(consequence.target);
          }
          break;
        case 'removeTag':
          state.tags = state.tags.filter(t => t !== consequence.target);
          break;
      }

      const newValue = this.getStateValue(consequence.target, state);
      if (oldValue !== newValue) {
        changes.push({ variable: consequence.target, oldValue, newValue });
      }
    }

    return changes;
  }

  private getStateValue(target: string, state: GameState): unknown {
    if (target in state.flags) return state.flags[target];
    if (target in state.scores) return state.scores[target];
    if (state.tags.includes(target)) return true;
    return undefined;
  }

  private detectLoop(steps: PathStep[]): boolean {
    if (steps.length < 10) return false;

    // Check if last 5 steps repeat
    const lastFive = steps.slice(-5);
    const prevFive = steps.slice(-10, -5);

    const lastFiveStr = lastFive.map(s => `${s.sceneId}:${s.beatId}:${s.choiceId}`).join('|');
    const prevFiveStr = prevFive.map(s => `${s.sceneId}:${s.beatId}:${s.choiceId}`).join('|');

    return lastFiveStr === prevFiveStr;
  }

  private createPath(
    id: string,
    strategy: PlayStrategy,
    steps: PathStep[],
    finalState: GameState,
    issues: PathIssue[]
  ): SimulatedPath {
    const scenesVisited = [...new Set(steps.map(s => s.sceneId))];
    const choicesMade = steps.filter(s => s.action === 'choice').length;
    const uniqueBeatsEncountered = [...new Set(steps.map(s => s.beatId))].length;

    return {
      id,
      strategy,
      steps,
      finalState,
      metrics: {
        totalSteps: steps.length,
        scenesVisited,
        choicesMade,
        uniqueBeatsEncountered,
      },
      issues,
      summary: this.generatePathSummary(steps, finalState, issues),
    };
  }

  private generatePathSummary(steps: PathStep[], finalState: GameState, issues: PathIssue[]): string {
    const scenes = [...new Set(steps.map(s => s.sceneId))];
    const choices = steps.filter(s => s.action === 'choice');

    let summary = `Path through ${scenes.length} scenes with ${choices.length} choices.`;

    if (issues.length > 0) {
      const errors = issues.filter(i => i.severity === 'error').length;
      const warnings = issues.filter(i => i.severity === 'warning').length;
      summary += ` Issues: ${errors} errors, ${warnings} warnings.`;
    } else {
      summary += ' No issues found.';
    }

    return summary;
  }

  private buildReport(input: PlaytestSimulatorInput, paths: SimulatedPath[]): PlaytestReport {
    // Calculate coverage
    const allScenes = new Set(input.episode.scenes.map(s => s.id));
    const allBeats = new Set(input.episode.scenes.flatMap(s => s.beats.map(b => b.id)));
    const allChoices = new Set(
      input.episode.scenes.flatMap(s =>
        s.beats.flatMap(b => b.choices?.map(c => c.id) || [])
      )
    );

    const reachedScenes = new Set(paths.flatMap(p => p.metrics.scenesVisited));
    const reachedBeats = new Set(paths.flatMap(p => p.steps.map(s => s.beatId)));
    const takenChoices = new Set(
      paths.flatMap(p => p.steps.filter(s => s.choiceId).map(s => s.choiceId!))
    );

    const unreachedScenes = [...allScenes].filter(s => !reachedScenes.has(s));
    const unreachedBeats = [...allBeats].filter(b => !reachedBeats.has(b));
    const unreachedChoices = [...allChoices].filter(c => !takenChoices.has(c));

    // Aggregate issues
    const allIssues = paths.flatMap(p => p.issues);
    const uniqueIssues = this.deduplicateIssues(allIssues);

    // State analysis
    const flagsUsed = new Set<string>();
    const scoresChanged = new Set<string>();
    const tagsGained = new Set<string>();

    for (const path of paths) {
      for (const step of path.steps) {
        for (const change of step.stateChanges) {
          if (change.variable.includes('.')) {
            // relationship
          } else if (typeof change.newValue === 'boolean') {
            flagsUsed.add(change.variable);
          } else if (typeof change.newValue === 'number') {
            scoresChanged.add(change.variable);
          } else {
            tagsGained.add(change.variable);
          }
        }
      }
    }

    // Generate recommendations
    const recommendations: string[] = [];

    if (unreachedScenes.length > 0) {
      recommendations.push(`${unreachedScenes.length} scene(s) were never reached - check navigation paths`);
    }

    if (uniqueIssues.filter(i => i.severity === 'error').length > 0) {
      recommendations.push('Critical errors found - must fix before shipping');
    }

    const coveragePercentage = allBeats.size > 0
      ? (reachedBeats.size / allBeats.size) * 100
      : 100;

    if (coveragePercentage < 80) {
      recommendations.push(`Coverage is only ${coveragePercentage.toFixed(1)}% - consider more test paths`);
    }

    return {
      episodeId: input.episode.id,
      strategy: input.strategy,
      paths,
      coverage: {
        scenesTotal: allScenes.size,
        scenesReached: reachedScenes.size,
        beatsTotal: allBeats.size,
        beatsReached: reachedBeats.size,
        choicesTotal: allChoices.size,
        choicesTaken: takenChoices.size,
        coveragePercentage,
      },
      unreachedScenes,
      unreachedBeats,
      unreachedChoices,
      issues: uniqueIssues,
      stateAnalysis: {
        flagsUsed: [...flagsUsed],
        scoresChanged: [...scoresChanged],
        tagsGained: [...tagsGained],
        stateConflicts: [],
      },
      recommendations,
    };
  }

  private deduplicateIssues(issues: PathIssue[]): PathIssue[] {
    const seen = new Set<string>();
    return issues.filter(issue => {
      const key = `${issue.type}:${issue.sceneId}:${issue.beatId}:${issue.description}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
}
