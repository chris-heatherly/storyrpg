import { describe, expect, it } from 'vitest';
import { buildPipelineConfig } from './buildPipelineConfig';
import { buildVerbatimProfile } from '../images/artStyleProfile';

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
      panelMode: 'all-beats',
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
      panelMode: 'all-beats',
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

  it('routes OpenAI providers to the OpenAI key while preserving Anthropic/Gemini keys', () => {
    const config = buildPipelineConfig({
      llmProvider: 'openai',
      llmModel: 'gpt-5',
      imageLlmProvider: 'anthropic',
      imageLlmModel: 'claude-3-5-haiku-20241022',
      videoLlmProvider: 'gemini',
      videoLlmModel: 'gemini-2.5-flash',
      apiKey: 'anthropic-key',
      openaiApiKey: 'openai-key',
      geminiApiKey: 'gemini-key',
      elevenLabsApiKey: '',
      atlasCloudApiKey: '',
      atlasCloudModel: 'bytedance/seedream-v4.5',
      midapiToken: '',
      imageProvider: 'dall-e',
      imageStrategy: 'all-beats',
      panelMode: 'all-beats',
      artStyle: '',
      geminiSettings: {} as any,
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
        enabled: false,
        model: 'veo-3.1-fast-generate-preview',
        durationSeconds: 6,
        resolution: '1080p',
        aspectRatio: '9:16',
        strategy: 'selective',
      },
    });

    expect(config.agents.storyArchitect.provider).toBe('openai');
    expect(config.agents.storyArchitect.apiKey).toBe('openai-key');
    expect(config.agents.imagePlanner?.provider).toBe('anthropic');
    expect(config.agents.imagePlanner?.apiKey).toBe('anthropic-key');
    expect(config.agents.videoDirector?.provider).toBe('gemini');
    expect(config.agents.videoDirector?.apiKey).toBe('gemini-key');
    expect(config.imageGen?.provider).toBe('dall-e');
    expect(config.imageGen?.openaiApiKey).toBe('openai-key');
    expect(config.imageGen?.openaiImageModel).toBe('gpt-image-2');
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
      panelMode: 'single',
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

  it('forwards stable-diffusion settings and defaults the backend to a1111', () => {
    const config = buildPipelineConfig({
      llmProvider: 'anthropic',
      llmModel: 'claude-sonnet-4-20250514',
      imageLlmProvider: 'anthropic',
      imageLlmModel: '',
      videoLlmProvider: 'anthropic',
      videoLlmModel: '',
      apiKey: 'anthropic-key',
      geminiApiKey: '',
      elevenLabsApiKey: '',
      atlasCloudApiKey: '',
      atlasCloudModel: 'bytedance/seedream-v4.5',
      midapiToken: '',
      imageProvider: 'stable-diffusion',
      imageStrategy: 'all-beats',
      panelMode: 'all-beats',
      artStyle: 'noir ink wash',
      geminiSettings: {} as any,
      midjourneySettings: {} as any,
      stableDiffusionSettings: {
        baseUrl: 'http://localhost:7860',
        defaultModel: 'sdxl-base-1.0',
        defaultSteps: 32,
        styleLoras: [{ name: 'studio_ghibli', weight: 0.8 }],
      } as any,
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

    expect(config.imageGen?.provider).toBe('stable-diffusion');
    expect(config.imageGen?.stableDiffusion?.baseUrl).toBe('http://localhost:7860');
    expect(config.imageGen?.stableDiffusion?.defaultModel).toBe('sdxl-base-1.0');
    expect(config.imageGen?.stableDiffusion?.backend).toBe('a1111');
    expect(config.imageGen?.stableDiffusion?.defaultSteps).toBe(32);
    expect(config.imageGen?.stableDiffusion?.styleLoras?.[0].name).toBe('studio_ghibli');
  });

  it('omits stable-diffusion config when provider is not SD and no overrides given', () => {
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
      midapiToken: '',
      imageProvider: 'nano-banana',
      imageStrategy: 'all-beats',
      panelMode: 'all-beats',
      artStyle: '',
      geminiSettings: {} as any,
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
        enabled: false,
        model: 'veo-3.1-fast-generate-preview',
        durationSeconds: 6,
        resolution: '1080p',
        aspectRatio: '9:16',
        strategy: 'selective',
      },
    });

    expect(config.imageGen?.stableDiffusion).toBeUndefined();
  });

  it('defaults LoRA auto-train to disabled and off', () => {
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
      atlasCloudModel: '',
      midapiToken: '',
      imageProvider: 'nano-banana',
      imageStrategy: 'all-beats',
      panelMode: 'single',
      artStyle: '',
      geminiSettings: {} as any,
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
        enabled: false,
        model: 'veo-3.1-fast-generate-preview',
        durationSeconds: 6,
        resolution: '1080p',
        aspectRatio: '9:16',
        strategy: 'selective',
      },
    });
    expect(config.imageGen?.loraTraining).toBeDefined();
    expect(config.imageGen?.loraTraining?.enabled).toBe(false);
    expect(config.imageGen?.loraTraining?.backend).toBe('disabled');
    expect(config.imageGen?.loraTraining?.characterThresholds.minRefs).toBe(6);
    expect(config.imageGen?.loraTraining?.styleThresholds.minEpisodes).toBe(2);
  });

  it('accepts a LoRA training override from the UI and enables the kohya backend', () => {
    const config = buildPipelineConfig({
      llmProvider: 'anthropic',
      llmModel: 'claude-sonnet-4-20250514',
      imageLlmProvider: 'anthropic',
      imageLlmModel: '',
      videoLlmProvider: 'anthropic',
      videoLlmModel: '',
      apiKey: 'anthropic-key',
      geminiApiKey: '',
      elevenLabsApiKey: '',
      atlasCloudApiKey: '',
      atlasCloudModel: '',
      midapiToken: '',
      imageProvider: 'stable-diffusion',
      imageStrategy: 'all-beats',
      panelMode: 'all-beats',
      artStyle: 'graphic novel',
      geminiSettings: {} as any,
      midjourneySettings: {} as any,
      loraTrainingSettings: {
        enabled: true,
        backend: 'kohya',
        baseUrl: 'http://kohya.test',
        characterThresholds: { minRefs: 4, tiers: ['major', 'core'], blockScenes: false },
        styleThresholds: { minEpisodes: 1, forceStyle: true },
        training: { baseModel: 'sd_xl_base_1.0.safetensors', steps: 2000 },
      },
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
    expect(config.imageGen?.loraTraining?.enabled).toBe(true);
    expect(config.imageGen?.loraTraining?.backend).toBe('kohya');
    expect(config.imageGen?.loraTraining?.baseUrl).toBe('http://kohya.test');
    expect(config.imageGen?.loraTraining?.characterThresholds.minRefs).toBe(4);
    expect(config.imageGen?.loraTraining?.characterThresholds.tiers).toEqual(['major', 'core']);
    expect(config.imageGen?.loraTraining?.characterThresholds.blockScenes).toBe(false);
    expect(config.imageGen?.loraTraining?.styleThresholds.forceStyle).toBe(true);
    expect(config.imageGen?.loraTraining?.training.steps).toBe(2000);
    expect(config.imageGen?.loraTraining?.training.baseModel).toBe('sd_xl_base_1.0.safetensors');
  });

  it('threads the UI-supplied ArtStyleProfile and preapproved anchors through to imageGen', () => {
    const profile = buildVerbatimProfile('romance novel cover');
    const config = buildPipelineConfig(
      {
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
        midapiToken: '',
        imageProvider: 'nano-banana',
        imageStrategy: 'all-beats',
        panelMode: 'single',
        artStyle: 'romance novel cover',
        geminiSettings: {} as any,
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
          enabled: false,
          model: 'veo-3.1-fast-generate-preview',
          durationSeconds: 6,
          resolution: '1080p',
          aspectRatio: '9:16',
          strategy: 'selective',
        },
      },
      {
        artStyleProfileOverride: profile,
        preapprovedStyleAnchors: {
          character: { imagePath: '/tmp/style-bible/character.png' },
          arcStrip: { data: 'AAA', mimeType: 'image/png' },
        },
      },
    );

    expect(config.imageGen?.artStyleProfile).toBe(profile);
    expect(config.imageGen?.gemini?.canonicalArtStyle).toContain('romance novel cover');
    expect(config.imageGen?.gemini?.canonicalArtStyle).toContain(profile.renderingTechnique);
    expect(config.imageGen?.preapprovedStyleAnchors?.character?.imagePath).toBe('/tmp/style-bible/character.png');
    expect(config.imageGen?.preapprovedStyleAnchors?.arcStrip?.data).toBe('AAA');
    expect(config.imageGen?.preapprovedStyleAnchors?.environment).toBeUndefined();
  });
});
