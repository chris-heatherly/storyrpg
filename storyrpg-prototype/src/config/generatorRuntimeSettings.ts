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
  storyCouncilEnabled: boolean;
  storyCouncilMode: 'shadow' | 'select' | 'select-and-repair';
  storyCouncilPreset: 'adaptive' | 'standard' | 'deep' | 'custom';
  storyCouncilCandidateCount: number;
  storyCouncilSynthesisPolicy: 'never' | 'adaptive' | 'always';
  storyCouncilRunEpisodeBlueprints: boolean;
  storyCouncilRunRoutePlaytest: boolean;
  storyCouncilRunFinal: boolean;
  storyCouncilFusionEnabled: boolean;
  storyCouncilFusionOnlyWhen: 'manual' | 'borderline-quality' | 'validator-disagreement' | 'always-final';
  storyCouncilMaxCalls: number;
  storyCouncilMaxConcurrentCandidates: number;
  storyCouncilTokenBudget: number;
  storyCouncilRemediationBudget: number;
  /** @deprecated Persisted-setting migration only. */
  qualityCouncilEnabled?: boolean;
  /** @deprecated Persisted-setting migration only. */
  qualityCouncilMode?: 'advisory' | 'repair-routing' | 'strict';
  /** @deprecated Persisted-setting migration only. */
  qualityCouncilRunPlan?: boolean;
  /** @deprecated Persisted-setting migration only. */
  qualityCouncilRunChoice?: boolean;
  /** @deprecated Persisted-setting migration only. */
  qualityCouncilRunRoutePlaytest?: boolean;
  /** @deprecated Persisted-setting migration only. */
  qualityCouncilRunFinal?: boolean;
  /** @deprecated Persisted-setting migration only. */
  qualityCouncilFusionEnabled?: boolean;
  /** @deprecated Persisted-setting migration only. */
  qualityCouncilFusionOnlyWhen?: 'manual' | 'borderline-quality' | 'validator-disagreement' | 'always-final';
  /** @deprecated Persisted-setting migration only. */
  qualityCouncilMaxCalls?: number;
  /** @deprecated Persisted-setting migration only. */
  qualityCouncilMaxChoiceCandidates?: number;
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
  storyCouncilEnabled: false,
  storyCouncilMode: 'shadow',
  storyCouncilPreset: 'adaptive',
  storyCouncilCandidateCount: 2,
  storyCouncilSynthesisPolicy: 'adaptive',
  storyCouncilRunEpisodeBlueprints: true,
  storyCouncilRunRoutePlaytest: true,
  storyCouncilRunFinal: true,
  storyCouncilFusionEnabled: false,
  storyCouncilFusionOnlyWhen: 'borderline-quality',
  storyCouncilMaxCalls: 24,
  storyCouncilMaxConcurrentCandidates: 2,
  storyCouncilTokenBudget: 120000,
  storyCouncilRemediationBudget: 4,
  choiceDistExpression: 35,
  choiceDistRelationship: 30,
  choiceDistStrategic: 20,
  choiceDistDilemma: 15,
  maxBranchingChoicesPerEpisode: 2,
  minEncountersShort: 1,
  minEncountersMedium: 1,
  minEncountersLong: 2,
};

type LegacyGenerationSettings = Partial<GenerationSettings> & {
  qualityCouncilEnabled?: boolean;
  qualityCouncilMode?: 'advisory' | 'repair-routing' | 'strict';
};

/** Normalize persisted pre-Story-Council settings without retaining LLM-native blocking. */
export function normalizeGenerationSettings(
  input?: LegacyGenerationSettings | null,
): GenerationSettings {
  const value = input ?? {};
  const {
    qualityCouncilEnabled,
    qualityCouncilMode: legacyMode,
    qualityCouncilRunPlan: _qualityCouncilRunPlan,
    qualityCouncilRunChoice: _qualityCouncilRunChoice,
    qualityCouncilRunRoutePlaytest,
    qualityCouncilRunFinal,
    qualityCouncilFusionEnabled,
    qualityCouncilFusionOnlyWhen,
    qualityCouncilMaxCalls,
    qualityCouncilMaxChoiceCandidates: _qualityCouncilMaxChoiceCandidates,
    ...canonical
  } = value;
  const migratedMode: GenerationSettings['storyCouncilMode'] = legacyMode === 'repair-routing' || legacyMode === 'strict'
    ? 'select-and-repair'
    : 'shadow';
  return {
    ...DEFAULT_GENERATION_SETTINGS,
    ...canonical,
    storyCouncilEnabled: canonical.storyCouncilEnabled ?? qualityCouncilEnabled ?? false,
    storyCouncilMode: canonical.storyCouncilMode ?? migratedMode,
    storyCouncilRunRoutePlaytest:
      canonical.storyCouncilRunRoutePlaytest ?? qualityCouncilRunRoutePlaytest ?? true,
    storyCouncilRunFinal:
      canonical.storyCouncilRunFinal ?? qualityCouncilRunFinal ?? true,
    storyCouncilFusionEnabled:
      canonical.storyCouncilFusionEnabled ?? qualityCouncilFusionEnabled ?? false,
    storyCouncilFusionOnlyWhen:
      canonical.storyCouncilFusionOnlyWhen ?? qualityCouncilFusionOnlyWhen ?? 'borderline-quality',
    storyCouncilMaxCalls:
      canonical.storyCouncilMaxCalls ?? qualityCouncilMaxCalls ?? 24,
  };
}
