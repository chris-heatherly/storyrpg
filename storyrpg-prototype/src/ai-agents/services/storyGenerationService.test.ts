import { beforeEach, describe, expect, it, vi } from 'vitest';

const analyzeSourceMaterial = vi.fn();
const generate = vi.fn();
const generateMultipleEpisodes = vi.fn();
const seasonPlannerExecute = vi.fn();
const pipelineInstances: MockPipeline[] = [];

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
}

vi.mock('../pipeline/FullStoryPipeline', () => ({
  FullStoryPipeline: MockPipeline,
}));

vi.mock('../agents/SeasonPlannerAgent', () => ({
  SeasonPlannerAgent: class {
    execute = seasonPlannerExecute;
  },
}));

const { runStoryAnalysis, runStoryGeneration } = await import('./storyGenerationService');

describe('storyGenerationService', () => {
  beforeEach(() => {
    analyzeSourceMaterial.mockReset();
    generate.mockReset();
    generateMultipleEpisodes.mockReset();
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
});
