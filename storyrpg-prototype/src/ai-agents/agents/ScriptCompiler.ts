/**
 * Script Compiler Agent
 *
 * The output format specialist responsible for:
 * - Converting generated content into game-ready format
 * - Ensuring all data structures are complete and valid
 * - Generating the final episode JSON
 * - Validating scene connections and state references
 */

import { AgentConfig } from '../config';
import { BaseAgent, AgentResponse } from './BaseAgent';
import { SceneContent, GeneratedBeat } from './SceneWriter';
import { ChoiceSet } from './ChoiceAuthor';
import { EpisodeBlueprint, SceneBlueprint } from './StoryArchitect';
import { Choice } from '../../types';

// Input types
export interface ScriptCompilerInput {
  // Episode blueprint
  blueprint: EpisodeBlueprint;

  // Generated content
  sceneContents: SceneContent[];
  choiceSets: ChoiceSet[];

  // Story metadata
  storyMetadata: {
    storyId: string;
    title: string;
    genre: string;
    tone: string;
  };

  // Characters
  protagonist: {
    id: string;
    name: string;
    pronouns: 'he/him' | 'she/her' | 'they/them';
  };

  npcs: Array<{
    id: string;
    name: string;
    description: string;
    voiceProfileId?: string;
  }>;

  // Locations
  locations: Array<{
    id: string;
    name: string;
    description: string;
    imageUrl?: string;
  }>;

  // State definitions
  flags: Array<{ name: string; description: string; defaultValue: boolean }>;
  scores: Array<{ name: string; description: string; defaultValue: number; min?: number; max?: number }>;
  tags: Array<{ name: string; description: string }>;
}

// Output types - the compiled episode
export interface CompiledEpisode {
  // Metadata
  id: string;
  storyId: string;
  number: number;
  title: string;
  synopsis: string;

  // Content
  scenes: CompiledScene[];
  startingSceneId: string;

  // State initialization
  initialState: {
    flags: Record<string, boolean>;
    scores: Record<string, number>;
    tags: string[];
  };

  // Validation info
  validation: {
    sceneCount: number;
    choiceCount: number;
    totalBeats: number;
    unresolvedReferences: string[];
    warnings: string[];
  };

  // Compilation metadata
  compiledAt: string;
  sourceBlueprint: string;
}

export interface CompiledScene {
  id: string;
  name: string;
  description: string;
  locationId: string;
  mood: string;

  // NPCs in scene
  npcsPresent: string[];

  // Beats
  beats: CompiledBeat[];

  // Navigation
  transitions: Array<{
    targetSceneId: string;
    condition?: string;
    trigger: 'auto' | 'choice' | 'event';
  }>;

  // Scene metadata
  isBottleneck: boolean;
  narrativeFunction: string;
}

export interface CompiledBeat {
  id: string;
  type: 'narration' | 'dialogue' | 'choice' | 'transition' | 'checkpoint';

  // Content
  text: string;
  speaker?: string;
  textVariants?: Array<{
    condition: string;
    text: string;
  }>;

  // Choice data (if type === 'choice')
  choices?: CompiledChoice[];

  // Flow control
  nextBeatId?: string;
  isTerminal?: boolean;

  // Image reference
  imageId?: string;
}

export interface CompiledChoice {
  id: string;
  text: string;
  type: 'expression' | 'relationship' | 'strategic' | 'dilemma';

  // Conditions
  condition?: string;
  lockedText?: string;

  // Consequences
  consequences: Array<{
    type: string;
    target: string;
    value: unknown;
  }>;

  // Navigation
  nextBeatId?: string;
  nextSceneId?: string;
}

export class ScriptCompiler extends BaseAgent {
  constructor(config: AgentConfig) {
    super('Script Compiler', config);
  }

  protected getAgentSpecificPrompt(): string {
    return `
## Your Role: Script Compiler

You are the final stage of the content pipeline, converting all generated content into a clean, game-ready format. Your output must be complete, consistent, and valid.

## What You Compile

### Scenes
- Merge blueprint structure with generated content
- Ensure all scenes have proper navigation
- Validate NPC and location references

### Beats
- Convert generated beats to final format
- Ensure proper beat sequencing
- Handle text variants and conditions

### Choices
- Compile choice sets into beats
- Validate consequence references
- Ensure navigation is complete

### State
- Initialize all flags and scores
- Validate state references in conditions
- Check for orphaned state variables

## Validation Checks

1. Every scene referenced exists
2. Every NPC referenced exists
3. Every location referenced exists
4. All choices lead somewhere valid
5. No orphaned beats (unreachable)
6. No dead ends (unless intentional)
7. All conditions reference valid state

## Output Quality

- No undefined or null values
- All required fields populated
- Consistent ID formats
- Clean, parseable JSON
`;
  }

  async execute(input: ScriptCompilerInput): Promise<AgentResponse<CompiledEpisode>> {
    console.log(`[ScriptCompiler] Compiling episode: ${input.blueprint.title}`);

    try {
      // Compile without LLM - this is deterministic transformation
      const compiled = this.compileEpisode(input);

      console.log(`[ScriptCompiler] Compiled ${compiled.scenes.length} scenes with ${compiled.validation.totalBeats} beats`);

      // Validate the compiled output
      this.validateCompilation(compiled, input);

      return {
        success: true,
        data: compiled,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`[ScriptCompiler] Error:`, errorMsg);
      return {
        success: false,
        error: errorMsg,
      };
    }
  }

  private compileEpisode(input: ScriptCompilerInput): CompiledEpisode {
    const scenes: CompiledScene[] = [];
    let totalBeats = 0;
    let choiceCount = 0;
    const unresolvedReferences: string[] = [];
    const warnings: string[] = [];

    // Create lookup maps
    const contentBySceneId = new Map<string, SceneContent>();
    for (const content of input.sceneContents) {
      contentBySceneId.set(content.sceneId, content);
    }

    const choicesByBeatId = new Map<string, ChoiceSet>();
    for (const choiceSet of input.choiceSets) {
      choicesByBeatId.set(choiceSet.beatId, choiceSet);
      choiceCount += choiceSet.choices.length;
    }

    // Compile each scene
    for (const blueprintScene of input.blueprint.scenes) {
      const content = contentBySceneId.get(blueprintScene.id);

      if (!content) {
        warnings.push(`No content found for scene: ${blueprintScene.id}`);
        continue;
      }

      const compiledScene = this.compileScene(
        blueprintScene,
        content,
        choicesByBeatId,
        input.blueprint.bottleneckScenes,
        input
      );

      scenes.push(compiledScene);
      totalBeats += compiledScene.beats.length;
    }

    // Check for unreferenced scenes
    for (const scene of scenes) {
      for (const transition of scene.transitions) {
        if (!scenes.find(s => s.id === transition.targetSceneId)) {
          unresolvedReferences.push(`Scene ${scene.id} references unknown scene: ${transition.targetSceneId}`);
        }
      }
    }

    // Build initial state
    const initialState = this.buildInitialState(input);

    return {
      id: `${input.storyMetadata.storyId}-ep-${input.blueprint.episodeId}`,
      storyId: input.storyMetadata.storyId,
      number: parseInt(input.blueprint.episodeId.replace(/\D/g, '')) || 1,
      title: input.blueprint.title,
      synopsis: input.blueprint.synopsis,
      scenes,
      startingSceneId: input.blueprint.startingSceneId,
      initialState,
      validation: {
        sceneCount: scenes.length,
        choiceCount,
        totalBeats,
        unresolvedReferences,
        warnings,
      },
      compiledAt: new Date().toISOString(),
      sourceBlueprint: input.blueprint.episodeId,
    };
  }

  private compileScene(
    blueprint: SceneBlueprint,
    content: SceneContent,
    choicesByBeatId: Map<string, ChoiceSet>,
    bottleneckScenes: string[],
    input: ScriptCompilerInput
  ): CompiledScene {
    // Validate location reference
    const locationExists = input.locations.some(l => l.id === blueprint.location);
    if (!locationExists) {
      console.warn(`[ScriptCompiler] Unknown location: ${blueprint.location} in scene ${blueprint.id}`);
    }

    // Validate NPC references
    for (const npcId of blueprint.npcsPresent) {
      const npcExists = input.npcs.some(n => n.id === npcId);
      if (!npcExists) {
        console.warn(`[ScriptCompiler] Unknown NPC: ${npcId} in scene ${blueprint.id}`);
      }
    }

    // Compile beats
    const compiledBeats: CompiledBeat[] = [];

    for (let i = 0; i < content.beats.length; i++) {
      const beat = content.beats[i];
      const nextBeat = content.beats[i + 1];

      // Check if this beat has choices
      const choiceSet = choicesByBeatId.get(beat.id);

      const compiledBeat = this.compileBeat(beat, choiceSet, nextBeat?.id);
      compiledBeats.push(compiledBeat);
    }

    // Build transitions from blueprint
    const transitions = blueprint.leadsTo.map(targetId => ({
      targetSceneId: targetId,
      trigger: 'choice' as const,
    }));

    return {
      id: blueprint.id,
      name: blueprint.name,
      description: blueprint.description,
      locationId: blueprint.location,
      mood: blueprint.mood,
      npcsPresent: blueprint.npcsPresent,
      beats: compiledBeats,
      transitions,
      isBottleneck: bottleneckScenes.includes(blueprint.id),
      narrativeFunction: blueprint.narrativeFunction,
    };
  }

  private compileBeat(
    beat: GeneratedBeat,
    choiceSet: ChoiceSet | undefined,
    nextBeatId: string | undefined
  ): CompiledBeat {
    // Determine beat type
    let type: CompiledBeat['type'] = 'narration';
    if (beat.speaker) {
      type = 'dialogue';
    } else if (choiceSet) {
      type = 'choice';
    }

    const compiledBeat: CompiledBeat = {
      id: beat.id,
      type,
      text: beat.text,
      speaker: beat.speaker,
      nextBeatId: choiceSet ? undefined : nextBeatId,
      isTerminal: !nextBeatId && !choiceSet,
    };

    // Add text variants
    if (beat.textVariants && beat.textVariants.length > 0) {
      compiledBeat.textVariants = beat.textVariants.map(v => ({
        condition: this.formatCondition(v.condition),
        text: v.text,
      }));
    }

    // Add choices if present
    if (choiceSet) {
      compiledBeat.choices = choiceSet.choices.map(choice => this.compileChoice(choice));
    }

    return compiledBeat;
  }

  private compileChoice(choice: Choice): CompiledChoice {
    const compiled: CompiledChoice = {
      id: choice.id,
      text: choice.text,
      type: choice.choiceType || 'strategic',
      consequences: [],
    };

    // Add conditions
    if (choice.conditions) {
      compiled.condition = this.formatCondition(choice.conditions);
    }

    // Add locked text
    if (choice.lockedText) {
      compiled.lockedText = choice.lockedText;
    }

    // Compile consequences
    if (choice.consequences) {
      for (const consequence of choice.consequences) {
        compiled.consequences.push({
          type: consequence.type,
          target: this.getConsequenceTarget(consequence),
          value: this.getConsequenceValue(consequence),
        });
      }
    }

    // Add navigation
    if (choice.nextBeatId) {
      compiled.nextBeatId = choice.nextBeatId;
    }
    if (choice.nextSceneId) {
      compiled.nextSceneId = choice.nextSceneId;
    }

    return compiled;
  }

  private formatCondition(condition: unknown): string {
    if (typeof condition === 'string') {
      return condition;
    }

    // Handle ConditionExpression type
    if (typeof condition === 'object' && condition !== null) {
      const cond = condition as Record<string, unknown>;

      if (cond.type === 'hasFlag') {
        return `hasFlag:${cond.flag}`;
      }
      if (cond.type === 'scoreCheck') {
        return `score:${cond.score}${cond.comparison}${cond.value}`;
      }
      if (cond.type === 'hasTag') {
        return `hasTag:${cond.tag}`;
      }
      if (cond.type === 'relationship') {
        return `relationship:${cond.npcId}.${cond.dimension}${cond.comparison}${cond.value}`;
      }
      if (cond.type === 'and') {
        return `(${(cond.conditions as unknown[]).map(c => this.formatCondition(c)).join(' AND ')})`;
      }
      if (cond.type === 'or') {
        return `(${(cond.conditions as unknown[]).map(c => this.formatCondition(c)).join(' OR ')})`;
      }
    }

    return String(condition);
  }

  private getConsequenceTarget(consequence: unknown): string {
    const c = consequence as Record<string, unknown>;
    switch (c.type) {
      case 'setFlag':
        return String(c.flag);
      case 'changeScore':
        return String(c.score);
      case 'addTag':
      case 'removeTag':
        return String(c.tag);
      case 'relationship':
        return `${c.npcId}.${c.dimension}`;
      case 'attribute':
        return String(c.attribute);
      default:
        return 'unknown';
    }
  }

  private getConsequenceValue(consequence: unknown): unknown {
    const c = consequence as Record<string, unknown>;
    switch (c.type) {
      case 'setFlag':
        return c.value;
      case 'changeScore':
        return c.change;
      case 'addTag':
        return true;
      case 'removeTag':
        return false;
      case 'relationship':
        return c.change;
      case 'attribute':
        return c.change;
      default:
        return null;
    }
  }

  private buildInitialState(input: ScriptCompilerInput): CompiledEpisode['initialState'] {
    const flags: Record<string, boolean> = {};
    const scores: Record<string, number> = {};
    const tags: string[] = [];

    for (const flag of input.flags) {
      flags[flag.name] = flag.defaultValue;
    }

    for (const score of input.scores) {
      scores[score.name] = score.defaultValue;
    }

    // Tags start empty by default

    return { flags, scores, tags };
  }

  private validateCompilation(compiled: CompiledEpisode, input: ScriptCompilerInput): void {
    // Check starting scene exists
    const startingScene = compiled.scenes.find(s => s.id === compiled.startingSceneId);
    if (!startingScene) {
      throw new Error(`Starting scene ${compiled.startingSceneId} not found in compiled scenes`);
    }

    // Check all scenes are reachable (basic check)
    const reachableScenes = new Set<string>();
    const toVisit = [compiled.startingSceneId];

    while (toVisit.length > 0) {
      const sceneId = toVisit.pop()!;
      if (reachableScenes.has(sceneId)) continue;

      reachableScenes.add(sceneId);
      const scene = compiled.scenes.find(s => s.id === sceneId);
      if (scene) {
        for (const transition of scene.transitions) {
          if (!reachableScenes.has(transition.targetSceneId)) {
            toVisit.push(transition.targetSceneId);
          }
        }
        // Also check choice navigation
        for (const beat of scene.beats) {
          if (beat.choices) {
            for (const choice of beat.choices) {
              if (choice.nextSceneId && !reachableScenes.has(choice.nextSceneId)) {
                toVisit.push(choice.nextSceneId);
              }
            }
          }
        }
      }
    }

    // Warn about unreachable scenes
    for (const scene of compiled.scenes) {
      if (!reachableScenes.has(scene.id)) {
        compiled.validation.warnings.push(`Scene ${scene.id} is not reachable from starting scene`);
      }
    }

    // Check for empty scenes
    for (const scene of compiled.scenes) {
      if (scene.beats.length === 0) {
        compiled.validation.warnings.push(`Scene ${scene.id} has no beats`);
      }
    }

    // Check choice navigation
    for (const scene of compiled.scenes) {
      for (const beat of scene.beats) {
        if (beat.choices) {
          for (const choice of beat.choices) {
            if (!choice.nextBeatId && !choice.nextSceneId) {
              compiled.validation.warnings.push(
                `Choice ${choice.id} in scene ${scene.id} has no navigation target`
              );
            }
          }
        }
      }
    }
  }
}
