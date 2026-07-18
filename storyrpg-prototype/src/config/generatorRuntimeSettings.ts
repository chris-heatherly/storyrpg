import {
  SCENE_DEFAULTS,
  CONCURRENCY_DEFAULTS,
} from '../constants/pipeline';
import {
  PHASE_VALIDATION_DEFAULTS,
  CHOICE_DENSITY_DEFAULTS,
  PIXAR_VALIDATION_DEFAULTS,
  NPC_DEPTH_DEFAULTS,
} from '../constants/validation';
import {
  BEAT_TEXT_CONSTRAINTS,
  CHOICE_CONSTRAINTS,
  DIALOGUE_CONSTRAINTS,
} from '../constants/mobile';

/** Generator runtime settings shared by the UX, headless tools, and config builder. */
export interface GenerationSettings {
  targetSceneCount: number;
  majorChoiceCount: number;
  minBeatsPerScene: number;
  maxBeatsPerScene: number;
  standardBeatCount: number;
  bottleneckBeatCount: number;
  encounterBeatCount: number;
  generateImages: boolean;
  imageGenerationLimit: number;
  panelMode: 'single' | 'special-beats' | 'all-beats';
  imagePlanningMode: 'text' | 'visual-storyboard';
  storyboardMaxPanelsPerSheet: number;
  blockingThreshold: number;
  warningThreshold: number;
  firstChoiceMaxSeconds: number;
  averageGapMaxSeconds: number;
  minChoiceDensity: number;
  maxSentencesPerBeat: number;
  maxWordsPerBeat: number;
  encounterSetupMaxWords: number;
  encounterOutcomeMaxWords: number;
  minChoices: number;
  maxChoices: number;
  maxChoiceWords: number;
  maxDialogueWords: number;
  maxDialogueLines: number;
  resolutionSummaryMaxWords: number;
  minMajorDimensions: number;
  pixarGoodThreshold: number;
  generateCharacterRefs: boolean;
  generateExpressionSheets: boolean;
  generateBodyVocabulary: boolean;
  preGenerateAudio: boolean;
  failFastMode: boolean;
  qualityCouncilEnabled: boolean;
  qualityCouncilMode: 'advisory' | 'repair-routing' | 'strict';
  qualityCouncilRunPlan: boolean;
  qualityCouncilRunChoice: boolean;
  qualityCouncilRunRoutePlaytest: boolean;
  qualityCouncilRunFinal: boolean;
  qualityCouncilFusionEnabled: boolean;
  qualityCouncilFusionOnlyWhen: 'manual' | 'borderline-quality' | 'validator-disagreement' | 'always-final';
  qualityCouncilMaxCalls: number;
  qualityCouncilMaxChoiceCandidates: number;
  choiceDistExpression: number;
  choiceDistRelationship: number;
  choiceDistStrategic: number;
  choiceDistDilemma: number;
  maxBranchingChoicesPerEpisode: number;
  minEncountersShort: number;
  minEncountersMedium: number;
  minEncountersLong: number;
}

export interface GeneratorNarrationSettings {
  enabled: boolean;
  provider?: 'elevenlabs' | 'gemini';
  autoPlay: boolean;
  preGenerateAudio: boolean;
  voiceId: string;
  geminiModel?: string;
  voiceCastingEnabled?: boolean;
  performanceTagsEnabled?: boolean;
  highlightMode: 'none' | 'word' | 'sentence';
}

export interface GeneratorVideoSettings {
  enabled: boolean;
  model: string;
  durationSeconds: number;
  resolution: string;
  aspectRatio: string;
  strategy: string;
}

export const DEFAULT_GENERATION_SETTINGS: GenerationSettings = {
  targetSceneCount: SCENE_DEFAULTS.targetSceneCount,
  majorChoiceCount: SCENE_DEFAULTS.majorChoiceCount,
  minBeatsPerScene: SCENE_DEFAULTS.minBeatsPerScene,
  maxBeatsPerScene: SCENE_DEFAULTS.maxBeatsPerScene,
  standardBeatCount: SCENE_DEFAULTS.standardBeatCount,
  bottleneckBeatCount: SCENE_DEFAULTS.bottleneckBeatCount,
  encounterBeatCount: SCENE_DEFAULTS.encounterBeatCount,
  generateImages: true,
  imageGenerationLimit: CONCURRENCY_DEFAULTS.imageGenerationLimit,
  panelMode: 'single',
  imagePlanningMode: 'text',
  storyboardMaxPanelsPerSheet: 6,
  blockingThreshold: PHASE_VALIDATION_DEFAULTS.blockingThreshold,
  warningThreshold: PHASE_VALIDATION_DEFAULTS.warningThreshold,
  firstChoiceMaxSeconds: CHOICE_DENSITY_DEFAULTS.firstChoiceMaxSeconds,
  averageGapMaxSeconds: CHOICE_DENSITY_DEFAULTS.averageGapMaxSeconds,
  minChoiceDensity: CHOICE_DENSITY_DEFAULTS.minChoiceDensity * 100,
  maxSentencesPerBeat: BEAT_TEXT_CONSTRAINTS.maxSentences,
  maxWordsPerBeat: BEAT_TEXT_CONSTRAINTS.maxWords,
  encounterSetupMaxWords: BEAT_TEXT_CONSTRAINTS.setupTextMaxWords,
  encounterOutcomeMaxWords: BEAT_TEXT_CONSTRAINTS.outcomeTextMaxWords,
  minChoices: CHOICE_CONSTRAINTS.minChoices,
  maxChoices: CHOICE_CONSTRAINTS.maxChoices,
  maxChoiceWords: CHOICE_CONSTRAINTS.maxChoiceWords,
  maxDialogueWords: DIALOGUE_CONSTRAINTS.maxWordsPerLine,
  maxDialogueLines: DIALOGUE_CONSTRAINTS.maxDialogueLines,
  resolutionSummaryMaxWords: 30,
  minMajorDimensions: NPC_DEPTH_DEFAULTS.minMajorDimensions,
  pixarGoodThreshold: PIXAR_VALIDATION_DEFAULTS.scoreThresholds.good,
  generateCharacterRefs: true,
  generateExpressionSheets: true,
  generateBodyVocabulary: true,
  preGenerateAudio: false,
  failFastMode: true,
  qualityCouncilEnabled: false,
  qualityCouncilMode: 'advisory',
  qualityCouncilRunPlan: true,
  qualityCouncilRunChoice: true,
  qualityCouncilRunRoutePlaytest: true,
  qualityCouncilRunFinal: true,
  qualityCouncilFusionEnabled: false,
  qualityCouncilFusionOnlyWhen: 'borderline-quality',
  qualityCouncilMaxCalls: 24,
  qualityCouncilMaxChoiceCandidates: 3,
  choiceDistExpression: 35,
  choiceDistRelationship: 30,
  choiceDistStrategic: 20,
  choiceDistDilemma: 15,
  maxBranchingChoicesPerEpisode: 2,
  minEncountersShort: 1,
  minEncountersMedium: 1,
  minEncountersLong: 2,
};
