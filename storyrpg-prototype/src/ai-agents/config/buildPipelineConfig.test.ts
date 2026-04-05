import { describe, expect, it } from 'vitest';
import { buildPipelineConfig } from './buildPipelineConfig';

const generationSettings = {
  generateImages: true,
  imageGenerationLimit: 2,
  targetSceneCount: 5,
  majorChoiceCount: 3,
  minBeatsPerScene: 3,
  maxBeatsPerScene: 6,
  standardBeatCount: 4,
  bottleneckBeatCount: 5,
  encounterBeatCount: 6,
  blockingThreshold: 60,
  warningThreshold: 40,
  firstChoiceMaxSeconds: 60,
  averageGapMaxSeconds: 90,
  minChoiceDensity: 0.1,
  maxSentencesPerBeat: 3,
  maxWordsPerBeat: 80,
  maxChoiceWords: 12,
  maxDialogueWords: 20,
  maxDialogueLines: 2,
  encounterSetupMaxWords: 50,
  encounterOutcomeMaxWords: 60,
  resolutionSummaryMaxWords: 40,
  minChoices: 2,
  maxChoices: 4,
  choiceDistExpression: 25,
  choiceDistRelationship: 25,
  choiceDistStrategic: 25,
  choiceDistDilemma: 25,
  maxBranchingChoicesPerEpisode: 2,
  minEncountersShort: 1,
  minEncountersMedium: 1,
  minEncountersLong: 1,
  minMajorDimensions: 2,
  pixarGoodThreshold: 70,
  generateCharacterRefs: true,
  generateExpressionSheets: false,
  generateBodyVocabulary: false,
} as any;

describe('buildPipelineConfig', () => {
  it('allows image and video planner llms to differ from the story llm', () => {
    const config = buildPipelineConfig({
      llmProvider: 'anthropic',
      llmModel: 'claude-sonnet-4-20250514',
      imageLlmProvider: 'gemini',
      imageLlmModel: 'gemini-2.5-flash',
      videoLlmProvider: 'anthropic',
      videoLlmModel: 'claude-3-5-haiku-20241022',
      apiKey: 'anthropic-key',
      geminiApiKey: 'shared-gemini-key',
      elevenLabsApiKey: '',
      atlasCloudApiKey: '',
      atlasCloudModel: 'bytedance/seedream-v4.5',
      midapiToken: '',
      imageProvider: 'nano-banana',
      imageStrategy: 'all-beats',
      artStyle: 'painterly',
      geminiSettings: { model: 'gemini-3.1-flash-image-preview' } as any,
      midjourneySettings: {} as any,
      generationSettings,
      generationMode: 'advisory',
      narrationSettings: {
        enabled: false,
        autoPlay: false,
        preGenerateAudio: false,
        voiceId: '',
        highlightMode: 'word',
      },
      videoSettings: {
        enabled: true,
        model: 'veo-3.1-generate-preview',
        durationSeconds: 8,
        resolution: '720p',
        aspectRatio: '16:9',
        strategy: 'selective',
      },
    });

    expect(config.agents.storyArchitect.provider).toBe('anthropic');
    expect(config.agents.storyArchitect.model).toBe('claude-sonnet-4-20250514');
    expect(config.agents.imagePlanner?.provider).toBe('gemini');
    expect(config.agents.imagePlanner?.model).toBe('gemini-2.5-flash');
    expect(config.agents.imagePlanner?.apiKey).toBe('shared-gemini-key');
    expect(config.agents.videoDirector?.provider).toBe('anthropic');
    expect(config.agents.videoDirector?.model).toBe('claude-3-5-haiku-20241022');
    expect(config.agents.videoDirector?.apiKey).toBe('anthropic-key');
  });

  it('falls back to the image gemini key for scoped gemini llms', () => {
    const config = buildPipelineConfig({
      llmProvider: 'anthropic',
      llmModel: 'claude-sonnet-4-20250514',
      imageLlmProvider: 'gemini',
      imageLlmModel: '',
      videoLlmProvider: 'gemini',
      videoLlmModel: '',
      apiKey: 'anthropic-key',
      geminiApiKey: 'shared-gemini-key',
      elevenLabsApiKey: '',
      atlasCloudApiKey: '',
      atlasCloudModel: 'bytedance/seedream-v4.5',
      midapiToken: '',
      imageProvider: 'nano-banana',
      imageStrategy: 'all-beats',
      artStyle: '',
      geminiSettings: { model: 'gemini-3.1-flash-image-preview' } as any,
      midjourneySettings: {} as any,
      generationSettings,
      generationMode: 'advisory',
      narrationSettings: {
        enabled: false,
        autoPlay: false,
        preGenerateAudio: false,
        voiceId: '',
        highlightMode: 'word',
      },
      videoSettings: {
        enabled: true,
        model: 'veo-3.1-fast-generate-preview',
        durationSeconds: 6,
        resolution: '1080p',
        aspectRatio: '9:16',
        strategy: 'all-beats',
      },
    });

    expect(config.agents.imagePlanner?.apiKey).toBe('shared-gemini-key');
    expect(config.agents.videoDirector?.apiKey).toBe('shared-gemini-key');
    expect(config.agents.imagePlanner?.model).toBe('gemini-2.5-pro');
    expect(config.agents.videoDirector?.model).toBe('gemini-2.5-pro');
  });

  it('keeps Midjourney settings on the normalized provider config', () => {
    const config = buildPipelineConfig({
      llmProvider: 'anthropic',
      llmModel: 'claude-sonnet-4-20250514',
      imageLlmProvider: 'anthropic',
      imageLlmModel: '',
      videoLlmProvider: 'anthropic',
      videoLlmModel: '',
      apiKey: 'anthropic-key',
      geminiApiKey: 'gemini-key',
      elevenLabsApiKey: '',
      atlasCloudApiKey: '',
      atlasCloudModel: 'bytedance/seedream-v4.5',
      midapiToken: 'midapi-token',
      imageProvider: 'midapi',
      imageStrategy: 'selective',
      artStyle: 'graphic novel',
      geminiSettings: { model: 'gemini-3.1-flash-image-preview' } as any,
      midjourneySettings: { srefCode: '12345', version: '7', sceneStylization: 650 } as any,
      generationSettings,
      generationMode: 'advisory',
      narrationSettings: {
        enabled: false,
        autoPlay: false,
        preGenerateAudio: false,
        voiceId: '',
        highlightMode: 'word',
      },
      videoSettings: {
        enabled: false,
        model: 'veo-3.1-fast-generate-preview',
        durationSeconds: 6,
        resolution: '1080p',
        aspectRatio: '9:16',
        strategy: 'selective',
      },
    });

    expect(config.imageGen?.provider).toBe('midapi');
    expect(config.imageGen?.midapiToken).toBe('midapi-token');
    expect(config.imageGen?.midjourney?.srefCode).toBe('12345');
    expect(config.imageGen?.midjourney?.sceneStylization).toBe(650);
  });
});
