/**
 * World Building Phase
 *
 * Creates the world bible containing locations, factions, and world rules.
 *
 * Faithful port of FullStoryPipeline.runWorldBuilding (pure move): same
 * events, same WorldBuilder input (including memoryContext and season-plan
 * locationIntroductions), same withTimeout wrapper, same PipelineError shape.
 * Checkpoints stay at the call sites — the single- and multi-episode drivers
 * checkpoint differently.
 */

import { WorldBuilder, WorldBible, WorldBuilderInput } from '../../agents/WorldBuilder';
import { withTimeout, PIPELINE_TIMEOUTS } from '../../utils/withTimeout';
import { PipelineError } from '../errors';
import { PipelineContext } from './index';

// ========================================
// INPUT TYPE
// ========================================

/**
 * The exact slice of the creative brief runWorldBuilding consumed, plus the
 * cached pipeline memory the monolith read from `this.cachedPipelineMemory`.
 */
export interface WorldBuildingInput {
  /**
   * brief.story, passed through whole — the monolith spread it into
   * storyContext, so any extra fields a brief carries must keep flowing.
   */
  story: {
    title: string;
    genre: string;
    synopsis: string;
    tone: string;
    themes: string[];
    [extra: string]: unknown;
  };
  /** Top-level brief.userPrompt (NOT brief.story.userPrompt). */
  userPrompt?: string;
  world: {
    premise: string;
    timePeriod: string;
    technologyLevel: string;
    magicSystem?: string;
    keyLocations: Array<{
      id: string;
      name: string;
      type: string;
      description: string;
      importance: 'major' | 'minor' | 'backdrop';
    }>;
  };
  /** brief.episode.startingLocation — only used for the debug event. */
  startingLocationId: string;
  rawDocument?: string;
  /** Pipeline optimization memory (this.cachedPipelineMemory), when loaded. */
  memoryContext?: string;
  /** seasonPlan.locationIntroductions, when a season plan is present. */
  locationIntroductions?: WorldBuilderInput['locationIntroductions'];
  /** config.debug — gates the per-location debug events. */
  debug?: boolean;
}

// ========================================
// PHASE IMPLEMENTATION
// ========================================

export class WorldBuildingPhase {
  readonly name = 'world_building';

  constructor(private readonly worldBuilder: WorldBuilder) {}

  async run(input: WorldBuildingInput, context: PipelineContext): Promise<WorldBible> {
    context.emit({ type: 'agent_start', agent: 'WorldBuilder', message: 'Creating world bible' });

    // Debug: Log the locations being sent to WorldBuilder
    context.emit({
      type: 'debug',
      phase: 'world',
      message: `Sending ${input.world.keyLocations.length} locations to WorldBuilder`,
    });
    if (input.debug) {
      input.world.keyLocations.forEach((loc, i) => {
        context.emit({
          type: 'debug',
          phase: 'world',
          message: `  ${i + 1}. ${loc.id}: "${loc.name}" (${loc.importance})`,
        });
      });
    }
    context.emit({
      type: 'debug',
      phase: 'world',
      message: `Starting location ID: ${input.startingLocationId}`,
    });

    const result = await withTimeout(
      this.worldBuilder.execute({
        storyContext: {
          ...input.story,
          userPrompt: input.userPrompt,
        },
        worldPremise: input.world.premise,
        timePeriod: input.world.timePeriod,
        technologyLevel: input.world.technologyLevel,
        magicSystem: input.world.magicSystem,
        locationsToCreate: input.world.keyLocations.map((loc) => ({
          id: loc.id,
          name: loc.name,
          type: loc.type,
          briefDescription: loc.description,
          importance: loc.importance,
        })),
        rawDocument: input.rawDocument,
        memoryContext: input.memoryContext || undefined,
        locationIntroductions: input.locationIntroductions,
      }),
      PIPELINE_TIMEOUTS.llmAgent,
      'WorldBuilder.execute'
    );

    if (!result || !result.success || !result.data) {
      console.error(`[Pipeline] World Builder failed with error:`, result?.error);
      throw new PipelineError(`World Builder failed: ${result?.error}`, 'world_building', {
        agent: 'WorldBuilder',
        context: {
          locationsRequested: input.world.keyLocations.length,
          premise: input.world.premise?.substring(0, 100),
        },
      });
    }

    context.emit({
      type: 'agent_complete',
      agent: 'WorldBuilder',
      message: `Created ${result.data.locations.length} locations, ${result.data.factions.length} factions`,
    });

    return result.data;
  }
}

// Export for direct use
export { WorldBuilder, WorldBible };
