import { describe, expect, it, vi } from 'vitest';

(globalThis as any).__DEV__ = false;

vi.mock('expo-file-system', () => ({
  documentDirectory: '/tmp/',
  EncodingType: { Base64: 'base64' },
  writeAsStringAsync: vi.fn(),
  makeDirectoryAsync: vi.fn(),
  getInfoAsync: vi.fn(async () => ({ exists: false, isDirectory: false })),
  readAsStringAsync: vi.fn(),
}));

import { AudioPhase, bindGeneratedAudioToStory, AudioPhaseDeps } from './AudioPhase';
import type { PipelineEvent } from '../events';

function makeStory() {
  return {
    id: 'story-1',
    episodes: [
      {
        id: 'ep-1',
        number: 1,
        scenes: [
          {
            id: 'scene-1',
            beats: [{ id: 'beat-1' }, { id: 'beat-2' }],
            encounter: {
              beats: [{ id: 'enc-beat-1' }],
              phases: [{ beats: [{ id: 'phase-beat-1' }] }],
            },
          },
        ],
      },
    ],
  } as any;
}

function makeDeps(overrides: Partial<AudioPhaseDeps> = {}): AudioPhaseDeps & {
  calls: { phasesCompleted: string[]; phasesRequired: string[] };
} {
  const calls = { phasesCompleted: [] as string[], phasesRequired: [] as string[] };
  return {
    audioService: {
      autoCastVoices: vi.fn(async () => undefined),
      extractBeatsForAudio: vi.fn(() => [
        { beatId: 'beat-1', text: 'a' },
        { beatId: 'beat-2', text: 'b' },
      ]),
      generateStoryAudio: vi.fn(async (_id: string, _beats: unknown[], onProgress?: (c: number, t: number) => void) => {
        onProgress?.(1, 2);
        return {
          success: true,
          generated: 1,
          cached: 1,
          failed: 0,
          results: [
            { beatId: 'beat-1', audioUrl: 'audio://one', cached: false },
            { beatId: 'beat-2', audioUrl: 'audio://two', cached: true },
          ],
          errors: [],
        };
      }),
    } as any,
    audioWorkerQueue: { run: (task) => task() },
    requirePhases: vi.fn((phase) => calls.phasesRequired.push(phase)),
    markPhaseComplete: vi.fn((phase) => calls.phasesCompleted.push(phase)),
    measurePhase: (_phase, task) => task(),
    checkCancellation: vi.fn(async () => undefined),
    calls,
    ...overrides,
  };
}

function makeContext(narration: Record<string, unknown>, events: PipelineEvent[]) {
  return {
    config: { narration } as any,
    emit: (event: Omit<PipelineEvent, 'timestamp'>) =>
      events.push({ ...event, timestamp: new Date() } as PipelineEvent),
    addCheckpoint: vi.fn(),
  };
}

describe('AudioPhase', () => {
  it('generates, binds, and logs audio on the happy path', async () => {
    const deps = makeDeps();
    const events: PipelineEvent[] = [];
    const story = makeStory();
    const audioDiagnostics: any[] = [];

    await new AudioPhase(deps).run(
      { story, characterBible: { characters: [{ id: 'c1' }] } as any, audioDiagnostics },
      makeContext({ enabled: true, preGenerateAudio: true, elevenLabsApiKey: 'k' }, events)
    );

    expect(deps.calls.phasesRequired).toEqual(['audio_generation']);
    expect(deps.calls.phasesCompleted).toEqual(['audio_generation']);
    expect(story.episodes[0].scenes[0].beats.map((b: any) => b.audio)).toEqual([
      'audio://one',
      'audio://two',
    ]);
    expect(audioDiagnostics.map((d) => d.stage)).toEqual([
      'voice_cast',
      'batch_generation',
      'binding',
      'binding',
      'binding',
    ]);
    expect(events.map((e) => e.type)).toEqual([
      'phase_start',
      'agent_start', // progress callback
      'debug',
      'phase_complete',
    ]);
  });

  it('records the skip diagnostic when narration is not configured', async () => {
    const deps = makeDeps();
    const events: PipelineEvent[] = [];
    const audioDiagnostics: any[] = [];

    await new AudioPhase(deps).run(
      { story: makeStory(), audioDiagnostics },
      makeContext({ enabled: false }, events)
    );

    expect(audioDiagnostics).toHaveLength(1);
    expect(audioDiagnostics[0].stage).toBe('gate');
    expect(audioDiagnostics[0].status).toBe('skipped');
    expect(events).toHaveLength(0);
    expect(deps.calls.phasesCompleted).toEqual([]);
  });

  it('degrades to a warning when audio generation throws (non-blocking)', async () => {
    const deps = makeDeps();
    (deps.audioService.generateStoryAudio as any).mockRejectedValueOnce(new Error('elevenlabs down'));
    const events: PipelineEvent[] = [];
    const audioDiagnostics: any[] = [];

    await new AudioPhase(deps).run(
      { story: makeStory(), audioDiagnostics },
      makeContext({ enabled: true, preGenerateAudio: true, elevenLabsApiKey: 'k' }, events)
    );

    expect(events.some((e) => e.type === 'warning')).toBe(true);
    expect(deps.calls.phasesCompleted).toEqual([]);
    expect(audioDiagnostics.at(-1)?.status).toBe('failed');
  });
});

describe('bindGeneratedAudioToStory', () => {
  it('binds scene beats and both encounter beat shapes', () => {
    const story = makeStory();
    const mapped = bindGeneratedAudioToStory(story, [
      { beatId: 'beat-1', audioUrl: 'audio://one' },
      { beatId: 'enc-beat-1', audioUrl: 'audio://enc' },
      { beatId: 'phase-beat-1', audioUrl: 'audio://phase' },
      { beatId: 'missing', audioUrl: 'audio://nope' },
      { beatId: 'beat-2' }, // no url — ignored
    ]);
    expect(mapped).toBe(3);
    expect(story.episodes[0].scenes[0].encounter.beats[0].audio).toBe('audio://enc');
    expect(story.episodes[0].scenes[0].encounter.phases[0].beats[0].audio).toBe('audio://phase');
  });

  it('returns 0 when no results carry urls', () => {
    expect(bindGeneratedAudioToStory(makeStory(), [{ beatId: 'beat-1' }])).toBe(0);
  });
});
