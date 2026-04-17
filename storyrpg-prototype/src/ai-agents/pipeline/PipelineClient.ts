/**
 * Pipeline Client Facade
 *
 * Narrow, client-safe entry point for launching / interacting with the
 * story generation pipeline from the Expo UI layer (App.tsx, screens,
 * hooks). The client does NOT import the pipeline classes at module load
 * time — it lazy-loads the heavy orchestrator on first use so the web
 * bundle does not pay the cost of pulling the entire 13k-line
 * `FullStoryPipeline` module (plus its node/fs dependencies) just to
 * render the library and settings screens.
 *
 * As Phase 3 breaks the orchestrator into `phases/*.ts` modules, this
 * facade can migrate from driving `FullStoryPipeline` directly to a
 * phase-based runner without changing the client-facing API.
 */

import type { Story } from '../../types';
import type { PipelineConfig } from '../config';
import type {
  FullCreativeBrief,
  FullPipelineResult,
} from './FullStoryPipeline';
import type {
  PipelineEvent,
  PipelineEventHandler,
} from './events';
import { sanitizeStoryForPersistence } from '../utils/storyPayloads';

type FullStoryPipelineCtor = typeof import('./FullStoryPipeline').FullStoryPipeline;

let FullStoryPipelineCtorCache: FullStoryPipelineCtor | null = null;

async function loadFullStoryPipeline(): Promise<FullStoryPipelineCtor> {
  if (FullStoryPipelineCtorCache) return FullStoryPipelineCtorCache;
  const mod = await import('./FullStoryPipeline');
  FullStoryPipelineCtorCache = mod.FullStoryPipeline;
  return FullStoryPipelineCtorCache;
}

export interface PipelineHandle {
  onEvent(handler: PipelineEventHandler): void;
  setExternalJobId(jobId: string): void;
  getCurrentJobId(): string | null;
  cancel(): void;
  generate(brief: FullCreativeBrief): Promise<FullPipelineResult>;
  /**
   * Escape hatch: exposes the underlying pipeline instance. Used by the
   * legacy video-only flow in `App.tsx` that reaches into `videoService`
   * and calls `runVideoOnly`. New code should avoid this and extend the
   * facade with properly-typed methods instead.
   */
  readonly raw: unknown;
}

export interface PipelineClient {
  /** Construct a ready-to-run pipeline handle. */
  createPipeline(config?: PipelineConfig): Promise<PipelineHandle>;

  /** Rename an on-disk generated story. */
  renameStory(
    storyId: string,
    oldOutputDir: string,
    newTitle: string,
  ): Promise<boolean>;

  /** Strip bulky / non-persistable fields from a Story before writing to storage. */
  sanitizeStoryForPersistence(story: Story): Story;
}

/**
 * Default implementation backed by the monolithic FullStoryPipeline.
 */
export const pipelineClient: PipelineClient = {
  async createPipeline(config?: PipelineConfig): Promise<PipelineHandle> {
    const Ctor = await loadFullStoryPipeline();
    const instance = new Ctor(config);
    const handle: PipelineHandle = {
      onEvent: (handler) => instance.onEvent(handler),
      setExternalJobId: (jobId) => instance.setExternalJobId(jobId),
      getCurrentJobId: () => instance.getCurrentJobId(),
      cancel: () => instance.cancel(),
      generate: (brief) => instance.generate(brief),
      get raw(): unknown {
        return instance;
      },
    };
    return handle;
  },

  async renameStory(
    storyId: string,
    oldOutputDir: string,
    newTitle: string,
  ): Promise<boolean> {
    const { renameStory } = await import('../utils/pipelineOutputWriter');
    return renameStory(storyId, oldOutputDir, newTitle);
  },

  sanitizeStoryForPersistence,
};

export type { PipelineEvent, PipelineEventHandler };
