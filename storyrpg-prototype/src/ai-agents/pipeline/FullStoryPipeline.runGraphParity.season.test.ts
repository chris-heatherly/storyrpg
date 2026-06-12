/**
 * Run-graph episode-loop PARITY test (adoption A2, 2026-06-11).
 *
 * Drives the exact same 2-episode season as
 * FullStoryPipeline.promptSnapshot.season.test.ts, but with
 * `generation.runGraphEpisodeLoop = true`, so the sequential episode loop
 * executes as a run-graph chain (pipeline/runGraph.ts) journaled into the
 * checkpoint artifact store.
 *
 * The parity contract this test enforces:
 *   1. The prompt order and full prompt snapshot match the SAME golden files
 *      as the legacy loop, byte for byte — the run-graph path changes HOW the
 *      loop is scheduled/journaled, never WHAT is generated.
 *   2. The event sequence matches the same golden once the graph's own
 *      journal narration (phase `run_graph`) is filtered out — the
 *      only observable difference is the added journal.
 */
import { describe, expect, it, vi } from 'vitest';

(globalThis as any).__DEV__ = false;

vi.mock('expo-file-system', () => ({
  documentDirectory: '/tmp/',
  EncodingType: { Base64: 'base64' },
  writeAsStringAsync: vi.fn(),
  makeDirectoryAsync: vi.fn(),
  getInfoAsync: vi.fn(async () => ({ exists: false, isDirectory: false })),
  readAsStringAsync: vi.fn(async () => {
    throw new Error('not found');
  }),
  deleteAsync: vi.fn(),
}));

import {
  startPromptCapture,
  createScriptedResponder,
  serializePromptSnapshot,
  summarizePromptSnapshot,
  normalizeEventsForSnapshot,
  normalizeCheckpointsForSnapshot,
} from '../testing/promptCapture';
import { buildSeasonRunFixtureMap, buildSeasonAnalysis } from '../testing/seasonRunFixtures';
import type { FullCreativeBrief } from './FullStoryPipeline';
import type { SourceMaterialAnalysis } from '../../types/sourceAnalysis';

function buildBrief(): FullCreativeBrief {
  return {
    story: {
      title: 'The Locked Wing',
      genre: 'gothic mystery',
      synopsis: 'An archivist catalogues a manor that does not want to be read.',
      tone: 'tense, literary',
      themes: ['trust', 'curiosity'],
    },
    world: {
      premise: 'A salt-worn manor on the cliffs hides a sealed east wing.',
      timePeriod: 'gaslamp era',
      technologyLevel: 'pre-industrial',
      keyLocations: [
        {
          id: 'loc-1',
          name: 'Greyharbor Manor',
          type: 'manor',
          description: 'A salt-worn manor on the cliffs above the harbor town.',
          importance: 'major',
        },
        {
          id: 'loc-2',
          name: 'East Garden',
          type: 'garden',
          description: 'An overgrown walled garden behind the manor.',
          importance: 'major',
        },
      ],
    },
    protagonist: {
      id: 'prot-1',
      name: 'Mara Voss',
      pronouns: 'she/her',
      description: 'A hired archivist who reads houses the way others read faces.',
      role: 'archivist',
    },
    npcs: [
      {
        id: 'npc-1',
        name: 'Edric Hale',
        role: 'wildcard',
        description: 'The manor\'s steward, exact in everything except his answers.',
        importance: 'major',
        relationshipToProtagonist: 'employer\'s agent',
      },
    ],
    episode: {
      number: 1,
      title: 'The Locked Wing',
      synopsis: 'Mara finds the passage behind the library portrait and must choose how to face Edric.',
      startingLocation: 'loc-1',
    },
    options: {
      targetSceneCount: 3,
      majorChoiceCount: 2,
      runQA: false,
    },
  };
}

async function buildPipeline() {
  const { FullStoryPipeline } = await import('./FullStoryPipeline');
  const { loadConfig } = await import('../config');
  const config = loadConfig();
  config.imageGen = { ...(config.imageGen ?? {}), enabled: false };
  config.narration = { ...(config.narration ?? {}), enabled: false, preGenerateAudio: false };
  config.videoGen = undefined;
  config.memory = {
    pipelineOptimization: false,
    characterKnowledge: false,
    ...(config.memory ?? {}),
    enabled: false,
  };
  config.validation = { ...(config.validation ?? {}), enabled: true, mode: 'advisory' };
  config.generation = {
    ...(config.generation ?? {}),
    assetGenerationMode: 'story-only',
    episodeParallelismEnabled: false,
    imageWorkerModeEnabled: false,
    audioWorkerModeEnabled: false,
    minEncountersShort: 0,
    minEncountersMedium: 0,
    minEncountersLong: 0,
    requireSceneGraphBranching: false,
    allowLinearBottleneckEpisodes: true,
    enableThreadAndTwistPlanning: true,
    // THE ONLY DIFFERENCE from the legacy characterization test:
    runGraphEpisodeLoop: true,
  };
  config.debug = false;
  return new FullStoryPipeline(config);
}

describe('FullStoryPipeline run-graph episode loop (parity with the legacy loop)', () => {
  it('produces a byte-identical prompt sequence and event log (modulo the graph journal)', async () => {
    const { mkdtempSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const previousCwd = process.cwd();
    const scratch = mkdtempSync(join(tmpdir(), 'storyrpg-rungraph-parity-'));
    process.chdir(scratch);

    const session = startPromptCapture(createScriptedResponder(buildSeasonRunFixtureMap()));
    let result;
    try {
      const pipeline = await buildPipeline();
      result = await pipeline.generateMultipleEpisodes(
        buildBrief(),
        buildSeasonAnalysis() as unknown as SourceMaterialAnalysis,
        { start: 1, end: 2 },
      );
    } finally {
      session.stop();
      process.chdir(previousCwd);
      rmSync(scratch, { recursive: true, force: true });
    }

    expect(result.error ?? '').toBe('');
    expect(result.success).toBe(true);

    // The graph actually ran: its journal narration covers the foundation
    // steps (A5) and both episode steps (A2).
    const graphEvents = (result.events ?? []).filter((e) => e.phase === 'run_graph');
    expect(graphEvents.map((e) => e.message)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('step_start: foundation-world'),
        expect.stringContaining('step_complete: foundation-characters'),
        expect.stringContaining('step_start: episode-1'),
        expect.stringContaining('step_complete: episode-1'),
        expect.stringContaining('step_start: episode-2'),
        expect.stringContaining('step_complete: episode-2'),
      ]),
    );

    // 1+2. Prompt order + full prompt snapshot: SAME goldens as the legacy loop.
    await expect(summarizePromptSnapshot(session.exchanges).join('\n') + '\n').toMatchFileSnapshot(
      '__goldens__/season-run-prompt-order.txt',
    );
    await expect(serializePromptSnapshot(session.exchanges)).toMatchFileSnapshot(
      '__goldens__/season-run-prompt-snapshot.json',
    );

    // 3. Event + checkpoint sequence: identical once the graph journal lines
    // are removed — the journal is ADDITIVE, nothing else may change.
    const eventLog = {
      events: normalizeEventsForSnapshot(
        (result.events ?? []).filter((e) => e.phase !== 'run_graph'),
      ),
      checkpoints: normalizeCheckpointsForSnapshot(result.checkpoints ?? []),
    };
    await expect(JSON.stringify(eventLog, null, 2) + '\n').toMatchFileSnapshot(
      '__goldens__/season-run-event-sequence.json',
    );
  }, 240000);
});
