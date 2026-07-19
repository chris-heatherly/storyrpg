import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildPipelineConfig } from './buildPipelineConfig';
import { buildVerbatimProfile } from '../images/artStyleProfile';
import { SCENE_DEFAULTS } from '../../constants/pipeline';

const generationSettings = {
  generateImages: true,
  imageGenerationLimit: 2,
  imagePlanningMode: 'text',
  storyboardMaxPanelsPerSheet: 6,
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
  it('defaults normal scene generation to the recommended 3-8 beat range', () => {
    expect(SCENE_DEFAULTS.minBeatsPerScene).toBe(3);
    expect(SCENE_DEFAULTS.maxBeatsPerScene).toBe(8);
    expect(SCENE_DEFAULTS.standardBeatCount).toBe(8);
    expect(SCENE_DEFAULTS.bottleneckBeatCount).toBe(8);
  });

  it('keeps Generator settings controls adjustable while recommending 3-8 beats per scene', () => {
    const source = readFileSync(
      resolve(__dirname, '../../components/GenerationSettingsPanel.tsx'),
      'utf8',
    );

    expect(source).toContain("key: 'minBeatsPerScene'");
    expect(source).toContain('Default lower bound for generated scene beats. 3 is recommended.');
    expect(source).toContain("key: 'maxBeatsPerScene'");
    expect(source).toContain('Default upper bound for generated scene beats. 8 is recommended; increase only for unusually dense scenes.');
    expect(source).toContain("key: 'standardBeatCount'");
    expect(source).toContain('Target cap for standard prose scenes.');
    expect(source).toContain("key: 'bottleneckBeatCount'");
    expect(source).toContain('Target cap for key bottleneck scenes; use higher values sparingly.');
    expect(source).toContain("key: 'maxBeatsPerScene', label: 'Max Beats per Scene', description: 'Default upper bound for generated scene beats. 8 is recommended; increase only for unusually dense scenes.', min: 4, max: 12");
  });

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
    expect(config.agents.storyArchitect.maxTokens).toBe(32768);
    expect(config.agents.imagePlanner?.provider).toBe('gemini');
    expect(config.agents.imagePlanner?.model).toBe('gemini-2.5-flash');
    expect(config.agents.imagePlanner?.apiKey).toBe('shared-gemini-key');
    expect(config.agents.videoDirector?.provider).toBe('anthropic');
    expect(config.agents.videoDirector?.model).toBe('claude-3-5-haiku-20241022');
    expect(config.agents.videoDirector?.apiKey).toBe('anthropic-key');
    expect(config.agents.sceneWriter.maxTokens).toBe(16384);
    expect(config.agents.choiceAuthor.maxTokens).toBe(16384);
    // BranchManager rides the QA-tier assignment with annotation temperature.
    expect(config.agents.branchManager?.provider).toBe('anthropic');
    expect(config.agents.branchManager?.model).toBe('claude-sonnet-4-20250514');
    expect(config.agents.branchManager?.temperature).toBe(0.7);
    expect(config.agents.branchManager?.maxTokens).toBe(4096);
    expect(config.imageGen?.requireCharacterRefsForVisibleCharacters).toBe(true);
    expect(config.imageGen?.minRefsPerVisibleCharacter).toBe(1);
    expect(config.imageGen?.allowTextOnlyCharacterImages).toBe(false);
  });

  it('clamps scene count to the 3-6 episode range', () => {
    const highConfig = buildPipelineConfig({
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
      generationSettings: { ...generationSettings, targetSceneCount: 8 },
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
        model: 'veo-3.1-generate-preview',
        durationSeconds: 8,
        resolution: '720p',
        aspectRatio: '16:9',
        strategy: 'selective',
      },
    });

    const lowConfig = buildPipelineConfig({
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
      generationSettings: { ...generationSettings, targetSceneCount: 1 },
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
        model: 'veo-3.1-generate-preview',
        durationSeconds: 8,
        resolution: '720p',
        aspectRatio: '16:9',
        strategy: 'selective',
      },
    });

    expect(highConfig.generation?.targetSceneCount).toBe(6);
    expect(highConfig.generation?.maxScenesPerEpisode).toBe(6);
    expect(lowConfig.generation?.targetSceneCount).toBe(3);
    expect(lowConfig.generation?.maxScenesPerEpisode).toBe(3);
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
      openaiSettings: {
        reasoningEffort: 'high',
        forceJsonResponse: true,
        imageModel: 'gpt-image-1.5',
        imageModeration: 'low',
      },
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
    expect(config.agents.storyArchitect.openaiReasoningEffort).toBe('high');
    expect(config.agents.storyArchitect.openaiForceJsonResponse).toBe(true);
    expect(config.agents.imagePlanner?.provider).toBe('anthropic');
    expect(config.agents.imagePlanner?.apiKey).toBe('anthropic-key');
    expect(config.agents.videoDirector?.provider).toBe('gemini');
    expect(config.agents.videoDirector?.apiKey).toBe('gemini-key');
    expect(config.imageGen?.provider).toBe('dall-e');
    expect(config.imageGen?.openaiApiKey).toBe('openai-key');
    expect(config.imageGen?.openaiImageModel).toBe('gpt-image-1.5');
    expect(config.imageGen?.openaiModeration).toBe('low');
  });

  it('forces OpenAI image moderation to low even when older persisted settings say auto', () => {
    const config = buildPipelineConfig({
      llmProvider: 'openai',
      llmModel: 'gpt-5',
      imageLlmProvider: 'openai',
      imageLlmModel: 'gpt-5',
      videoLlmProvider: 'openai',
      videoLlmModel: 'gpt-5',
      apiKey: '',
      openaiApiKey: 'openai-key',
      geminiApiKey: '',
      elevenLabsApiKey: '',
      atlasCloudApiKey: '',
      atlasCloudModel: 'bytedance/seedream-v4.5',
      midapiToken: '',
      imageProvider: 'dall-e',
      imageStrategy: 'all-beats',
      panelMode: 'all-beats',
      artStyle: '',
      openaiSettings: {
        reasoningEffort: 'medium',
        forceJsonResponse: true,
        imageModel: 'gpt-image-2',
        imageModeration: 'auto',
      },
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

    expect(config.imageGen?.openaiModeration).toBe('low');
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
        uploadedStyleReferences: [
          { imagePath: '/tmp/style-references/style-ref-1.png' },
          { data: 'BBB', mimeType: 'image/webp' },
        ],
        styleReferenceStrength: 'strong',
      },
    );

    expect(config.imageGen?.artStyleProfile).toBe(profile);
    expect(config.imageGen?.gemini?.canonicalArtStyle).toBe('romance novel cover');
    expect(config.imageGen?.preapprovedStyleAnchors?.character?.imagePath).toBe('/tmp/style-bible/character.png');
    expect(config.imageGen?.preapprovedStyleAnchors?.arcStrip?.data).toBe('AAA');
    expect(config.imageGen?.preapprovedStyleAnchors?.environment).toBeUndefined();
    expect(config.imageGen?.uploadedStyleReferences).toHaveLength(2);
    expect(config.imageGen?.uploadedStyleReferences?.[0].imagePath).toBe('/tmp/style-references/style-ref-1.png');
    expect(config.imageGen?.uploadedStyleReferences?.[1].data).toBe('BBB');
    expect(config.imageGen?.styleReferenceStrength).toBe('strong');
  });

  it('threads visual storyboard image planning mode through imageGen', () => {
    const config = buildPipelineConfig({
      llmProvider: 'anthropic',
      llmModel: 'claude-sonnet-4-5',
      imageLlmProvider: 'anthropic',
      imageLlmModel: 'claude-sonnet-4-5',
      videoLlmProvider: 'anthropic',
      videoLlmModel: 'claude-sonnet-4-5',
      apiKey: 'anthropic-key',
      geminiApiKey: 'gemini-key',
      elevenLabsApiKey: '',
      atlasCloudApiKey: '',
      atlasCloudModel: '',
      midapiToken: '',
      imageProvider: 'dall-e',
      imageStrategy: 'all-beats',
      panelMode: 'single',
      artStyle: 'cinematic fantasy',
      geminiSettings: {},
      midjourneySettings: {},
      generationSettings: { ...generationSettings, imagePlanningMode: 'visual-storyboard' },
      generationMode: 'advisory',
      narrationSettings: { enabled: false } as any,
      videoSettings: { enabled: false } as any,
    });

    expect(config.imageGen?.imagePlanningMode).toBe('visual-storyboard');
  });

  it('threads storyboard sheet panel cap through imageGen', () => {
    const config = buildPipelineConfig({
      llmProvider: 'anthropic',
      llmModel: 'claude-sonnet-4-20250514',
      imageLlmProvider: 'gemini',
      imageLlmModel: 'gemini-2.5-flash',
      videoLlmProvider: 'anthropic',
      videoLlmModel: 'claude-3-5-haiku-20241022',
      apiKey: 'anthropic-key',
      geminiApiKey: 'gemini-key',
      elevenLabsApiKey: '',
      atlasCloudApiKey: '',
      atlasCloudModel: 'bytedance/seedream-v4.5',
      midapiToken: '',
      imageProvider: 'dall-e',
      imageStrategy: 'all-beats',
      panelMode: 'all-beats',
      artStyle: 'painterly',
      geminiSettings: {} as any,
      midjourneySettings: {} as any,
      generationSettings: { ...generationSettings, storyboardMaxPanelsPerSheet: 12 },
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

    expect(config.imageGen?.storyboardV2?.maxPanelsPerSheet).toBe(12);
  });

  it('maps each pipeline role from per-task assignments, including qaRunner', () => {
    const config = buildPipelineConfig({
      llmProvider: 'anthropic',
      llmModel: 'claude-sonnet-4-6',
      imageLlmProvider: 'anthropic',
      imageLlmModel: 'claude-sonnet-4-6',
      videoLlmProvider: 'anthropic',
      videoLlmModel: 'claude-sonnet-4-6',
      taskAssignments: {
        architect: { provider: 'anthropic', model: 'claude-opus-4-8' },
        scene: { provider: 'anthropic', model: 'claude-sonnet-4-6' },
        choice: { provider: 'anthropic', model: 'claude-sonnet-4-6' },
        qa: { provider: 'anthropic', model: 'claude-haiku-4-5' },
        image: { provider: 'gemini', model: 'gemini-2.5-flash' },
        video: { provider: 'openai', model: 'gpt-4o-mini' },
        councilPlan: { provider: 'anthropic', model: 'claude-sonnet-4-6' },
        councilChoice: { provider: 'anthropic', model: 'claude-haiku-4-5' },
        councilPlaytest: { provider: 'anthropic', model: 'claude-haiku-4-5' },
        councilFinal: { provider: 'anthropic', model: 'claude-sonnet-4-6' },
        councilFusion: { provider: 'anthropic', model: 'claude-sonnet-4-6' },
      },
      apiKey: 'anthropic-key',
      openaiApiKey: 'openai-key',
      geminiApiKey: 'gemini-key',
      elevenLabsApiKey: '',
      atlasCloudApiKey: '',
      atlasCloudModel: '',
      midapiToken: '',
      imageProvider: 'nano-banana',
      imageStrategy: 'all-beats',
      panelMode: 'all-beats',
      artStyle: '',
      geminiSettings: {} as any,
      midjourneySettings: {} as any,
      generationSettings,
      generationMode: 'advisory',
      narrationSettings: { enabled: false } as any,
      videoSettings: { enabled: false } as any,
    });

    expect(config.agents.storyArchitect.model).toBe('claude-opus-4-8');
    expect(config.agents.storyArchitect.provider).toBe('anthropic');
    expect(config.agents.sceneWriter.model).toBe('claude-sonnet-4-6');
    expect(config.agents.choiceAuthor.model).toBe('claude-sonnet-4-6');
    // QA decorrelates to a cheaper model within the family.
    expect(config.agents.qaRunner?.model).toBe('claude-haiku-4-5');
    expect(config.agents.qaRunner?.provider).toBe('anthropic');
    expect(config.agents.qaRunner?.apiKey).toBe('anthropic-key');
    expect(config.agents.qaRunner?.temperature).toBe(0.3);
    // Image/video keep cross-provider freedom.
    expect(config.agents.imagePlanner?.provider).toBe('gemini');
    expect(config.agents.imagePlanner?.apiKey).toBe('gemini-key');
    expect(config.agents.videoDirector?.provider).toBe('openai');
    expect(config.agents.videoDirector?.apiKey).toBe('openai-key');
  });

  it('falls back qaRunner to the narrative model when no per-task assignments are given', () => {
    const config = buildPipelineConfig({
      llmProvider: 'anthropic',
      llmModel: 'claude-opus-4-8',
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
      imageProvider: 'nano-banana',
      imageStrategy: 'all-beats',
      panelMode: 'all-beats',
      artStyle: '',
      geminiSettings: {} as any,
      midjourneySettings: {} as any,
      generationSettings,
      generationMode: 'advisory',
      narrationSettings: { enabled: false } as any,
      videoSettings: { enabled: false } as any,
    });

    expect(config.agents.qaRunner?.provider).toBe('anthropic');
    expect(config.agents.qaRunner?.model).toBe('claude-opus-4-8');
  });

  it('keeps Quality Council disabled by default', () => {
    const config = buildPipelineConfig({
      llmProvider: 'gemini',
      llmModel: 'gemini-2.5-pro',
      imageLlmProvider: 'gemini',
      imageLlmModel: '',
      videoLlmProvider: 'gemini',
      videoLlmModel: '',
      apiKey: '',
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
      narrationSettings: { enabled: false } as any,
      videoSettings: { enabled: false } as any,
    });

    expect(config.qualityCouncil?.enabled).toBe(false);
    expect(config.agents.qualityCouncilPlan).toBeUndefined();
    expect(config.agents.qualityCouncilFusion).toBeUndefined();
  });

  it('builds council agent configs only when the toggle is enabled', () => {
    const config = buildPipelineConfig({
      llmProvider: 'gemini',
      llmModel: 'gemini-2.5-pro',
      taskAssignments: {
        architect: { provider: 'gemini', model: 'gemini-2.5-pro' },
        scene: { provider: 'gemini', model: 'gemini-2.5-pro' },
        choice: { provider: 'gemini', model: 'gemini-2.5-pro' },
        qa: { provider: 'gemini', model: 'gemini-2.5-flash' },
        image: { provider: 'gemini', model: 'gemini-2.5-flash' },
        video: { provider: 'gemini', model: 'gemini-2.5-flash' },
        councilPlan: { provider: 'openrouter', model: 'qwen/qwen3.6-flash' },
        councilChoice: { provider: 'openrouter', model: 'qwen/qwen3.6-flash' },
        councilPlaytest: { provider: 'openrouter', model: 'qwen/qwen3.6-flash' },
        councilFinal: { provider: 'openrouter', model: 'qwen/qwen3.6-flash' },
        councilFusion: { provider: 'openrouter', model: 'openrouter/fusion' },
      },
      imageLlmProvider: 'gemini',
      imageLlmModel: '',
      videoLlmProvider: 'gemini',
      videoLlmModel: '',
      apiKey: '',
      openRouterApiKey: 'or-key',
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
      generationSettings: {
        ...generationSettings,
        storyCouncilEnabled: true,
        storyCouncilMode: 'select-and-repair',
        storyCouncilFusionEnabled: true,
      },
      generationMode: 'advisory',
      narrationSettings: { enabled: false } as any,
      videoSettings: { enabled: false } as any,
    });

    expect(config.qualityCouncil?.enabled).toBe(true);
    expect(config.storyCouncil?.enabled).toBe(true);
    expect(config.qualityCouncil?.mode).toBe('select-and-repair');
    expect(config.agents.qualityCouncilPlan?.provider).toBe('openrouter');
    expect(config.agents.qualityCouncilPlan?.apiKey).toBe('or-key');
    expect(config.agents.qualityCouncilFusion?.model).toBe('openrouter/fusion');
    expect(config.agents.qualityCouncilFusion?.openRouter?.route).toBe('fusion');
    expect(config.agents.qualityCouncilFusion?.openRouter?.provider?.requireParameters).toBe(false);
  });
});
