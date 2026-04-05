/**
 * AI Agents Module
 *
 * Export all agents, pipeline, and utilities for story generation.
 */

// Configuration
export { loadConfig, type AgentConfig, type PipelineConfig } from './config';

// Base agent
export { BaseAgent, type AgentMessage, type AgentResponse } from './agents/BaseAgent';

// Creative Direction Agents
export {
  StoryArchitect,
  type StoryArchitectInput,
  type EpisodeBlueprint,
  type SceneBlueprint,
} from './agents/StoryArchitect';

export {
  WorldBuilder,
  type WorldBuilderInput,
  type WorldBible,
  type LocationDetails,
  type FactionDetails,
} from './agents/WorldBuilder';

export {
  CharacterDesigner,
  type CharacterDesignerInput,
  type CharacterBible,
  type CharacterProfile,
  type VoiceProfile,
  type CharacterRelationship,
} from './agents/CharacterDesigner';

// Narrative Generation Agents
export {
  SceneWriter,
  type SceneWriterInput,
  type SceneContent,
  type GeneratedBeat,
} from './agents/SceneWriter';

export {
  ChoiceAuthor,
  type ChoiceAuthorInput,
  type ChoiceSet,
  type GeneratedChoice,
  type StakesAnnotation,
} from './agents/ChoiceAuthor';

// Quality Assurance Agents
export {
  ContinuityChecker,
  VoiceValidator,
  StakesAnalyzer,
  QARunner,
  type ContinuityCheckerInput,
  type ContinuityReport,
  type ContinuityIssue,
  type VoiceValidatorInput,
  type VoiceReport,
  type VoiceIssue,
  type StakesAnalyzerInput,
  type StakesReport,
  type StakesIssue,
  type QAInput,
  type QAReport,
} from './agents/QAAgents';

// Pipeline
export {
  EpisodePipeline,
  type CreativeBrief,
  type PipelineEvent,
  type PipelineEventHandler,
  type PipelineResult,
} from './pipeline/EpisodePipeline';

export {
  FullStoryPipeline,
  type FullCreativeBrief,
  type FullPipelineResult,
} from './pipeline/FullStoryPipeline';

// Storytelling principles (for custom agents)
export {
  CORE_STORYTELLING_PROMPT,
  FICTION_FIRST_PHILOSOPHY,
  STAKES_TRIANGLE,
  CHOICE_GEOMETRY,
  CONSEQUENCE_BUDGETING,
  THREE_LAYER_MEMORY,
  BRANCH_AND_BOTTLENECK,
  QUALITY_MANTRAS,
} from './prompts/storytellingPrinciples';
