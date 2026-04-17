/**
 * Agent Exports
 */

export { BaseAgent, type AgentMessage, type AgentResponse } from './BaseAgent';

// Creative Direction Agents
export {
  StoryArchitect,
  type StoryArchitectInput,
  type EpisodeBlueprint,
  type SceneBlueprint,
} from './StoryArchitect';

export {
  WorldBuilder,
  type WorldBuilderInput,
  type WorldBible,
  type LocationDetails,
  type FactionDetails,
} from './WorldBuilder';

export {
  CharacterDesigner,
  type CharacterDesignerInput,
  type CharacterBible,
  type CharacterProfile,
  type VoiceProfile,
  type CharacterRelationship,
} from './CharacterDesigner';

// Narrative Generation Agents
export {
  SceneWriter,
  type SceneWriterInput,
  type SceneContent,
  type GeneratedBeat,
} from './SceneWriter';

export {
  ChoiceAuthor,
  type ChoiceAuthorInput,
  type ChoiceSet,
  type GeneratedChoice,
  type StakesAnnotation,
} from './ChoiceAuthor';

// Branch Management Agents
export {
  BranchManager,
  type BranchManagerInput,
  type BranchAnalysis,
  type BranchPath,
  type ReconvergencePoint,
  type StateTrackingEntry,
  type ValidationIssue,
} from './BranchManager';

// Encounter Design Agents
export {
  EncounterArchitect,
  type EncounterArchitectInput,
  type EncounterStructure,
  type EncounterBeat,
  type SkillChallenge,
  type ImageSequenceSpec,
  type TensionPoint,
  type EscalationPhase,
} from './EncounterArchitect';

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
} from './QAAgents';

// Image Generation Agent Team
export {
  ImageGenerator,
  type SceneImageRequest,
  type BeatImageRequest,
  type CoverImageRequest,
  type ImagePrompt,
  type GeneratedImage,
  type ImageGenerationResult,
  type EncounterSequenceRequest,
} from './ImageGenerator';

export { ImageAgentTeam } from './image-team/ImageAgentTeam';
export { StoryboardAgent, type VisualPlan, type StoryboardRequest } from './image-team/StoryboardAgent';
export { VisualIllustratorAgent, type IllustrationRequest } from './image-team/VisualIllustratorAgent';
export { EncounterImageAgent, type EncounterSequencePlan } from './image-team/EncounterImageAgent';
export { ConsistencyScorerAgent, type ConsistencyScore, type ConsistencyRequest } from './image-team/ConsistencyScorerAgent';
export { CompositionValidatorAgent, type CompositionValidation, type CompositionRequest } from './image-team/CompositionValidatorAgent';
