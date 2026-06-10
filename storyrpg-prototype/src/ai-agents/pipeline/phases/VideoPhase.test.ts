import { describe, expect, it, vi, beforeEach } from 'vitest';

(globalThis as any).__DEV__ = false;

vi.mock('expo-file-system', () => ({
  documentDirectory: '/tmp/',
  EncodingType: { Base64: 'base64' },
  writeAsStringAsync: vi.fn(),
  makeDirectoryAsync: vi.fn(),
  getInfoAsync: vi.fn(async () => ({ exists: false, isDirectory: false })),
  readAsStringAsync: vi.fn(),
}));

import { VideoPhase, bindGeneratedVideoToStory, VideoPhaseDeps } from './VideoPhase';
import type { PipelineEvent } from '../events';

function makeDeps(overrides: Partial<VideoPhaseDeps> = {}): VideoPhaseDeps {
  return {
    videoService: {
      clearDiagnostics: vi.fn(),
      getDiagnostics: vi.fn(() => []),
      readFileAsBase64: vi.fn(async () => ({ data: 'img-bytes', mimeType: 'image/png' })),
      generateVideo: vi.fn(async () => ({ videoUrl: 'video://clip-1' })),
    } as any,
    videoDirectorAgent: {
      generateVideoDirection: vi.fn(async () => ({ success: true, data: { motion: 'slow push' } })),
    } as any,
    checkCancellation: vi.fn(async () => undefined),
    scopedSceneId: (sceneId) => `episode-1-${sceneId}`,
    scopedBeatKey: (sceneId, beatId) => `episode-1-${sceneId}::${beatId}`,
    ...overrides,
  };
}

function makeContext(events: PipelineEvent[], strategy = 'selective') {
  return {
    config: { videoGen: { strategy } } as any,
    emit: (event: Omit<PipelineEvent, 'timestamp'>) =>
      events.push({ ...event, timestamp: new Date() } as PipelineEvent),
    addCheckpoint: vi.fn(),
  };
}

const sceneContents = [
  {
    sceneId: 'scene-1',
    sceneName: 'Opening',
    moodProgression: ['tense'],
    beats: [
      { id: 'beat-1', text: 'You enter.', shotType: 'character', visualMoment: 'the door' },
      { id: 'beat-2', text: 'Filler.', shotType: 'character' },
      { id: 'beat-3', text: 'The standoff.', shotType: 'action', isChoicePoint: true },
    ],
  },
] as any;

beforeEach(() => vi.clearAllMocks());

describe('VideoPhase', () => {
  it('animates only selective beats that have images', async () => {
    const deps = makeDeps();
    const events: PipelineEvent[] = [];
    const imageResults = {
      beatImages: new Map([
        ['episode-1-scene-1::beat-1', '/img/1.png'],
        ['episode-1-scene-1::beat-2', '/img/2.png'], // filler — not selective
        ['episode-1-scene-1::beat-3', '/img/3.png'],
      ]),
      sceneImages: new Map(),
    };

    const result = await new VideoPhase(deps).run(
      { sceneContents, imageResults, story: { genre: 'gothic', tone: 'tense' } },
      makeContext(events)
    );

    // beat-1 (first beat + visualMoment) and beat-3 (action/choice) only
    expect(deps.videoService.generateVideo).toHaveBeenCalledTimes(2);
    expect([...result.videoResults.keys()]).toEqual([
      'episode-1-scene-1::beat-1',
      'episode-1-scene-1::beat-3',
    ]);
    expect(result.diagnostics).toEqual([]);
  });

  it('returns the skip diagnostic when no beats qualify', async () => {
    const deps = makeDeps();
    const events: PipelineEvent[] = [];

    const result = await new VideoPhase(deps).run(
      { sceneContents, imageResults: { beatImages: new Map(), sceneImages: new Map() }, story: {} },
      makeContext(events)
    );

    expect(result.videoResults.size).toBe(0);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].stage).toBe('selection');
    expect(deps.videoService.generateVideo).not.toHaveBeenCalled();
  });

  it('records direction failures as diagnostics and keeps going', async () => {
    const deps = makeDeps();
    (deps.videoDirectorAgent.generateVideoDirection as any)
      .mockResolvedValueOnce({ success: false, error: 'no direction' })
      .mockResolvedValueOnce({ success: true, data: { motion: 'pan' } });
    const events: PipelineEvent[] = [];
    const imageResults = {
      beatImages: new Map([
        ['episode-1-scene-1::beat-1', '/img/1.png'],
        ['episode-1-scene-1::beat-3', '/img/3.png'],
      ]),
      sceneImages: new Map(),
    };

    const result = await new VideoPhase(deps).run(
      { sceneContents, imageResults, story: {} },
      makeContext(events)
    );

    expect(result.videoResults.size).toBe(1);
    expect(result.diagnostics.some((d) => d.stage === 'direction' && d.status === 'failed')).toBe(true);
  });
});

describe('bindGeneratedVideoToStory', () => {
  const story = {
    episodes: [
      {
        number: 1,
        scenes: [{ id: 'scene-1', beats: [{ id: 'beat-1' }, { id: 'beat-2' }] }],
      },
      {
        number: 2,
        scenes: [{ id: 'scene-9', beats: [{ id: 'beat-9' }] }],
      },
    ],
  } as any;

  it('binds via scoped and unscoped keys', () => {
    const mapped = bindGeneratedVideoToStory(story, new Map([
      ['episode-1-scene-1::beat-1', 'video://a'],
      ['scene-1::beat-2', 'video://b'],
    ]));
    expect(mapped).toBe(2);
    expect(story.episodes[0].scenes[0].beats[0].video).toBe('video://a');
    expect(story.episodes[0].scenes[0].beats[1].video).toBe('video://b');
  });

  it('honors targetEpisodeNumber', () => {
    const mapped = bindGeneratedVideoToStory(
      story,
      new Map([['episode-2-scene-9::beat-9', 'video://c'], ['scene-1::beat-1', 'video://x']]),
      { targetEpisodeNumber: 2 }
    );
    expect(mapped).toBe(1);
  });

  it('returns 0 for an empty map', () => {
    expect(bindGeneratedVideoToStory(story, new Map())).toBe(0);
  });
});
