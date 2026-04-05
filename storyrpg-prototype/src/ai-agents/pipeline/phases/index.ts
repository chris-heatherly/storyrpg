/**
 * Pipeline Phases
 * 
 * Each phase handles a distinct stage of story generation.
 * Phases are orchestrated by FullStoryPipeline.
 */

import { PipelineEvent } from '../EpisodePipeline';
import { PipelineConfig } from '../../config';
import { WorldBible } from '../../agents/WorldBuilder';
import { CharacterBible } from '../../agents/CharacterDesigner';
import { EpisodeBlueprint } from '../../agents/StoryArchitect';
import { SceneContent } from '../../agents/SceneWriter';
import { ChoiceSet } from '../../agents/ChoiceAuthor';
import { EncounterStructure } from '../../agents/EncounterArchitect';
import { BranchAnalysis } from '../../agents/BranchManager';
import { QAReport } from '../../agents/QAAgents';
import { Story, Episode } from '../../../types';

// ========================================
// PHASE CONTEXT & RESULTS
// ========================================

/**
 * Shared context passed between phases.
 */
export interface PipelineContext {
  config: PipelineConfig;
  emit: (event: Omit<PipelineEvent, 'timestamp'>) => void;
  addCheckpoint: (name: string, data: unknown, optional?: boolean) => void;
}

/**
 * Brief information for story generation.
 */
export interface StoryBrief {
  story: {
    title: string;
    genre: string;
    synopsis: string;
    tone: string;
    targetEpisodeCount?: number;
    userPrompt?: string;
  };
  episode: {
    number: number;
    title: string;
    synopsis: string;
    startingLocation: string;
    previousSummary?: string;
  };
  protagonist: {
    id: string;
    name: string;
    description: string;
    pronouns: 'he/him' | 'she/her' | 'they/them';
    backstory?: string;
    goals?: string[];
    flaws?: string[];
  };
  options?: {
    targetSceneCount?: number;
    majorChoiceCount?: number;
    includeEncounters?: boolean;
    generateImages?: boolean;
  };
  multiEpisode?: {
    sourceAnalysis?: unknown;
    previousCharacterBible?: CharacterBible;
    preferences?: {
      targetScenesPerEpisode?: number;
      targetChoicesPerEpisode?: number;
      pacing?: 'tight' | 'moderate' | 'expansive';
    };
  };
}

// ========================================
// PHASE RESULTS
// ========================================

export interface WorldBuildingResult {
  worldBible: WorldBible;
}

export interface CharacterDesignResult {
  characterBible: CharacterBible;
}

export interface StoryStructureResult {
  episodeBlueprint: EpisodeBlueprint;
  branchAnalysis?: BranchAnalysis;
}

export interface ContentGenerationResult {
  sceneContents: SceneContent[];
  choiceSets: ChoiceSet[];
  encounters: Map<string, EncounterStructure>;
}

export interface QAValidationResult {
  qaReport: QAReport;
  passed: boolean;
}

export interface ImageGenerationResult {
  sceneImages: Map<string, string[]>;
  encounterImages: Map<string, Map<string, string>>;
  characterImages: Map<string, unknown>;
}

export interface AssemblyResult {
  story: Story;
  episode: Episode;
}

// ========================================
// PHASE INTERFACE
// ========================================

/**
 * Base interface for all pipeline phases.
 */
export interface PipelinePhase<TInput, TResult> {
  name: string;
  run(input: TInput, context: PipelineContext): Promise<TResult>;
}

// Re-export for convenience
export type { PipelineEvent } from '../EpisodePipeline';
export type { PipelineConfig } from '../../config';
