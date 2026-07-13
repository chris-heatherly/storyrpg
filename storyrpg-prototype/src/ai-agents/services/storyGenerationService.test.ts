import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentConfig, PipelineConfig } from '../config';

const analyzeSourceMaterial = vi.fn();
const generate = vi.fn();
const generateMultipleEpisodes = vi.fn();
const generateImagesForDraft = vi.fn();
const generateTargetedBeatImagesForDraft = vi.fn();
const seasonPlannerExecute = vi.fn();
const pipelineInstances: MockPipeline[] = [];

function mockAgentConfig(): AgentConfig {
  return {
    provider: 'anthropic',
    model: 'test-model',
    apiKey: '',
    maxTokens: 1000,
    temperature: 0,
  };
}

function mockPipelineConfig(overrides: Partial<PipelineConfig> = {}): PipelineConfig {
  return {
    agents: {
      storyArchitect: mockAgentConfig(),
      sceneWriter: mockAgentConfig(),
      choiceAuthor: mockAgentConfig(),
    },
    validation: {} as PipelineConfig['validation'],
    debug: false,
    outputDir: '/tmp/story',
    ...overrides,
  };
}

class MockPipeline {
  public config: any;
  public eventHandler?: (event: any) => void;
  public imageHandler?: (event: any) => void;
  public videoHandler?: (event: any) => void;
  public imageService = {
    onEvent: (handler: (event: any) => void) => {
      this.imageHandler = handler;
      return () => undefined;
    },
  };
  public videoService = {
    onEvent: (handler: (event: any) => void) => {
      this.videoHandler = handler;
      return () => undefined;
    },
  };

  constructor(config?: any) {
    this.config = config;
    pipelineInstances.push(this);
  }

  onEvent(handler: (event: any) => void) {
    this.eventHandler = handler;
  }

  async analyzeSourceMaterial(...args: any[]) {
    return analyzeSourceMaterial(...args);
  }

  async generate(...args: any[]) {
    return generate(...args);
  }

  async generateMultipleEpisodes(...args: any[]) {
    return generateMultipleEpisodes(...args);
  }

  async generateImagesForDraft(...args: any[]) {
    return generateImagesForDraft(...args);
  }

  async generateTargetedBeatImagesForDraft(...args: any[]) {
    return generateTargetedBeatImagesForDraft(...args);
  }
}

vi.mock('../pipeline/FullStoryPipeline', () => ({
  FullStoryPipeline: MockPipeline,
}));

vi.mock('../agents/SeasonPlannerAgent', () => ({
  SeasonPlannerAgent: class {
    execute = seasonPlannerExecute;
  },
}));

const { runImageGenerationBatch, runStoryAnalysis, runStoryGeneration } = await import('./storyGenerationService');

describe('storyGenerationService', () => {
  beforeEach(() => {
    analyzeSourceMaterial.mockReset();
    generate.mockReset();
    generateMultipleEpisodes.mockReset();
    generateImagesForDraft.mockReset();
    generateTargetedBeatImagesForDraft.mockReset();
    seasonPlannerExecute.mockReset();
    pipelineInstances.length = 0;
  });

  it('reuses resumed analysis and season plan outputs when available', async () => {
    const resumedAnalysis = {
      totalEpisodes: 3,
      analysis: { sourceTitle: 'Resumed Story' },
    };
    const resumedPlan = {
      success: true,
      data: { id: 'season-1', totalEpisodes: 3 },
    };

    const result = await runStoryAnalysis({
      sourceText: 'ignored',
      title: 'Ignored',
      resumeCheckpoint: {
        steps: {
          source_analysis: { status: 'completed' },
          season_plan: { status: 'completed' },
        },
        outputs: {
          source_analysis: resumedAnalysis,
          season_plan: resumedPlan,
        },
      },
    });

    expect(analyzeSourceMaterial).not.toHaveBeenCalled();
    expect(seasonPlannerExecute).not.toHaveBeenCalled();
    expect(result.analysisResult).toEqual(resumedAnalysis);
    expect(result.seasonPlan).toEqual(resumedPlan.data);
  });

  it('publishes fresh source analysis before season planning begins', async () => {
    const order: string[] = [];
    const analysisResult = { totalEpisodes: 1, analysis: { sourceTitle: 'Fresh Story' } };
    analyzeSourceMaterial.mockImplementation(async () => {
      order.push('analyze');
      return analysisResult;
    });
    seasonPlannerExecute.mockImplementation(async () => {
      order.push('plan');
      return { success: true, data: { id: 'season-1' } };
    });

    await runStoryAnalysis({
      sourceText: 'Fresh source',
      title: 'Fresh Story',
      onSourceAnalysisComplete: (result) => {
        expect(result).toBe(analysisResult);
        order.push('checkpoint');
      },
    });

    expect(order).toEqual(['analyze', 'checkpoint', 'plan']);
  });

  it('runs multi-episode generation and forwards pipeline job events', async () => {
    const onEvent = vi.fn();
    const onImageJobEvent = vi.fn();
    const onVideoJobEvent = vi.fn();

    generateMultipleEpisodes.mockImplementation(async () => {
      const instance = pipelineInstances[0];
      instance.eventHandler?.({
        type: 'phase_start',
        phase: 'content',
        message: 'Generating',
        timestamp: new Date(),
      });
      instance.imageHandler?.({ type: 'job_added', job: { id: 'img-1' } });
      instance.videoHandler?.({ type: 'job_added', job: { id: 'vid-1' } });
      return { success: true, story: { id: 'story-1' } };
    });

    const response = await runStoryGeneration({
      brief: { episode: { number: 2 } } as any,
      sourceAnalysis: { sourceTitle: 'Source' } as any,
      episodeRange: { start: 1, end: 2 },
      onEvent,
      onImageJobEvent,
      onVideoJobEvent,
    });

    expect(generate).not.toHaveBeenCalled();
    expect(generateMultipleEpisodes).toHaveBeenCalledTimes(1);
    expect(onEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'phase_start', phase: 'content' }),
    );
    expect(onImageJobEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'job_added' }),
    );
    expect(onVideoJobEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'job_added' }),
    );
    expect(response.result).toEqual({ success: true, story: { id: 'story-1' } });
  });

  it('forces image rendering off for story-only generation mode', async () => {
    generate.mockResolvedValue({ success: true });

    await runStoryGeneration({
      config: {
        generation: { assetGenerationMode: 'story-only' },
        imageGen: { enabled: true, provider: 'nano-banana' },
        videoGen: { enabled: true },
      } as any,
      brief: { story: { title: 'Draft' } } as any,
    });

    expect(pipelineInstances[0].config.imageGen.enabled).toBe(false);
    expect(pipelineInstances[0].config.videoGen.enabled).toBe(false);
  });

  it('runs image-only generation from an output directory', async () => {
    generateImagesForDraft.mockResolvedValue({ success: true, outputDirectory: '/tmp/story/' });

    const response = await runImageGenerationBatch({
      config: { imageGen: { enabled: false } } as any,
      outputDirectory: '/tmp/story/',
    });

		    expect(generateImagesForDraft).toHaveBeenCalledWith('/tmp/story/', undefined, { targetEpisodeNumber: undefined });
		    expect(pipelineInstances[0].config.imageGen.enabled).toBe(true);
		    expect(pipelineInstances[0].config.imageGen.strategy).toBe('all-beats');
		    expect(pipelineInstances[0].config.generation.assetGenerationMode).toBe('image-only');
	    expect(response.result).toEqual({ success: true, outputDirectory: '/tmp/story/' });
	  });

		  it('passes target episode to image-only generation', async () => {
		    generateImagesForDraft.mockResolvedValue({ success: true, outputDirectory: '/tmp/story/' });

		    await runImageGenerationBatch({
		      config: mockPipelineConfig(),
		      outputDirectory: '/tmp/story/',
		      targetEpisodeNumber: 2,
		    });

	    expect(generateImagesForDraft).toHaveBeenCalledWith('/tmp/story/', undefined, { targetEpisodeNumber: 2 });
	  });

  it('routes target slots to spot image backfill with spot-safe defaults', async () => {
    generateTargetedBeatImagesForDraft.mockResolvedValue({ success: true, outputDirectory: '/tmp/story/' });
    const targetSlots = [{ episodeNumber: 1, sceneId: 'scene-3', beatId: 'beat-1' }];

    await runImageGenerationBatch({
      config: mockPipelineConfig(),
      outputDirectory: '/tmp/story/',
      targetSlots,
    });

    expect(generateImagesForDraft).not.toHaveBeenCalled();
    expect(generateTargetedBeatImagesForDraft).toHaveBeenCalledWith('/tmp/story/', targetSlots, {
      skipEncounterImages: true,
      skipCover: true,
      skipCharacterRefs: true,
      skipVisualContractValidation: true,
    });
  });
	});
