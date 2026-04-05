/**
 * World Building Phase
 * 
 * Creates the world bible containing locations, factions, and world rules.
 */

import { WorldBuilder, WorldBible } from '../../agents/WorldBuilder';
import { AgentConfig } from '../../config';
import { PipelineContext, StoryBrief, WorldBuildingResult } from './index';

// ========================================
// INPUT TYPE
// ========================================

export interface WorldBuildingInput {
  brief: StoryBrief;
  worldPremise?: string;
  timePeriod?: string;
  technologyLevel?: string;
  magicSystem?: string;
  keyLocations: Array<{
    id: string;
    name: string;
    type: string;
    description: string;
    importance: 'major' | 'minor' | 'backdrop';  // Must match WorldBuilderInput
  }>;
  rawDocument?: string;
}

// ========================================
// PHASE IMPLEMENTATION
// ========================================

export class WorldBuildingPhase {
  private worldBuilder: WorldBuilder;
  private debug: boolean;

  constructor(agentConfig: AgentConfig, debug = false) {
    this.worldBuilder = new WorldBuilder(agentConfig);
    this.debug = debug;
  }

  async run(input: WorldBuildingInput, context: PipelineContext): Promise<WorldBuildingResult> {
    context.emit({ type: 'agent_start', agent: 'WorldBuilder', message: 'Creating world bible' });

    // Debug logging
    context.emit({ 
      type: 'debug', 
      phase: 'world', 
      message: `Sending ${input.keyLocations.length} locations to WorldBuilder` 
    });
    
    if (this.debug) {
      input.keyLocations.forEach((loc, i) => {
        context.emit({ 
          type: 'debug', 
          phase: 'world', 
          message: `  ${i + 1}. ${loc.id}: "${loc.name}" (${loc.importance})` 
        });
      });
    }
    
    context.emit({ 
      type: 'debug', 
      phase: 'world', 
      message: `Starting location ID: ${input.brief.episode.startingLocation}` 
    });

    // Execute world builder
    const result = await this.worldBuilder.execute({
      storyContext: {
        ...input.brief.story,
        userPrompt: input.brief.story.userPrompt,
      },
      worldPremise: input.worldPremise,
      timePeriod: input.timePeriod,
      technologyLevel: input.technologyLevel,
      magicSystem: input.magicSystem,
      locationsToCreate: input.keyLocations.map(loc => ({
        id: loc.id,
        name: loc.name,
        type: loc.type,
        briefDescription: loc.description,
        importance: loc.importance,
      })),
      rawDocument: input.rawDocument,
    });

    if (!result.success || !result.data) {
      throw new Error(`World Builder failed: ${result.error}`);
    }

    context.emit({
      type: 'agent_complete',
      agent: 'WorldBuilder',
      message: `Created ${result.data.locations.length} locations, ${result.data.factions.length} factions`,
    });

    context.addCheckpoint('World Bible', result.data, true);

    return { worldBible: result.data };
  }
}

// Export for direct use
export { WorldBuilder, WorldBible };
