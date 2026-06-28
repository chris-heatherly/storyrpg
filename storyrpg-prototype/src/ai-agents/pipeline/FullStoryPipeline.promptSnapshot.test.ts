/**
 * Full-run prompt-snapshot characterization test (refactor safety net).
 *
 * Runs FullStoryPipeline.generate() for a fixed 1-episode text-only brief with
 * every LLM call answered by scripted fixtures, then golden-files:
 *   1. the ordered sequence of prompts the pipeline assembled, and
 *   2. the normalized event/checkpoint sequence.
 *
 * If a refactor changes either golden, it changed pipeline behavior — it is
 * not a pure move. See docs/PIPELINE_REFACTOR_PLAN.md (Phase 0).
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
import { buildFullRunFixtureMap } from '../testing/fullRunFixtures';
import { disableArchitectCraftGatesForSnapshot } from '../testing/architectGateTestEnv';
import type { FullCreativeBrief } from './FullStoryPipeline';

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
      majorChoiceCount: 1,
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
  config.sceneCritic = { ...(config.sceneCritic ?? {}), enabled: false };
  config.memory = {
    pipelineOptimization: false,
    characterKnowledge: false,
    ...(config.memory ?? {}),
    enabled: false,
  };
  config.validation = { ...(config.validation ?? {}), enabled: true, mode: 'advisory', playwrightQA: false };
  config.generation = {
    ...(config.generation ?? {}),
    assetGenerationMode: 'story-only',
    episodeParallelismEnabled: false,
    imageWorkerModeEnabled: false,
    audioWorkerModeEnabled: false,
    // Keep the first characterization slice small: a linear 3-scene episode
    // with no encounters. Encounter + branch coverage is added before the
    // ContentGeneration extraction (see docs/PIPELINE_REFACTOR_PLAN.md).
    minEncountersShort: 0,
    minEncountersMedium: 0,
    minEncountersLong: 0,
    requireSceneGraphBranching: false,
    allowLinearBottleneckEpisodes: true,
    // ThreadPlanner/TwistArchitect/CharacterArcTracker are now default-ON in
    // production. This baseline characterizes the core generation path without
    // them; pin them OFF so the golden is independent of the production default.
    enableThreadAndTwistPlanning: false,
    enableCharacterArcTracking: false,
  };
  config.debug = false;
  return new FullStoryPipeline(config);
}

describe('FullStoryPipeline prompt snapshot (characterization)', () => {
  it('generates the fixed brief with an unchanged prompt/event sequence', async () => {
    // The output writer resolves `generated-stories/` against cwd in node —
    // run from a temp dir so the test never pollutes the real corpus.
    const { mkdtempSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const previousCwd = process.cwd();
    const scratch = mkdtempSync(join(tmpdir(), 'storyrpg-prompt-snapshot-'));
    process.chdir(scratch);

    const restoreArchitectCraftGates = disableArchitectCraftGatesForSnapshot();
    const session = startPromptCapture(createScriptedResponder(buildFullRunFixtureMap()));
    let result;
    try {
      const pipeline = await buildPipeline();
      result = await pipeline.generate(buildBrief());
    } finally {
      session.stop();
      restoreArchitectCraftGates();
      process.chdir(previousCwd);
      rmSync(scratch, { recursive: true, force: true });
    }

    if (!result.success) {
      // Surface the terminal failure with full detail before the assertion.
      const errorEvents = (result.events ?? []).filter((e) => e.type === 'error').slice(-5);
      console.error('[promptSnapshot] error events:', JSON.stringify(errorEvents, null, 2));
      const { writeFileSync } = await import('node:fs');
      writeFileSync('/tmp/prompt-snapshot-debug.json', serializePromptSnapshot(session.exchanges));
      console.error('[promptSnapshot] captured exchanges dumped to /tmp/prompt-snapshot-debug.json');
    }
    expect(result.error ?? '').toBe('');
    expect(result.success).toBe(true);

    // 1. Ordering summary — fast to eyeball when the full snapshot diff is big.
    await expect(summarizePromptSnapshot(session.exchanges).join('\n') + '\n').toMatchFileSnapshot(
      '__goldens__/full-run-prompt-order.txt'
    );

    // 2. Full prompt sequence — the byte-identical refactor gate.
    await expect(serializePromptSnapshot(session.exchanges)).toMatchFileSnapshot(
      '__goldens__/full-run-prompt-snapshot.json'
    );

    // 3. Event + checkpoint sequence — progress/resume contract.
    const eventLog = {
      events: normalizeEventsForSnapshot(result.events ?? []),
      checkpoints: normalizeCheckpointsForSnapshot(result.checkpoints ?? []),
    };
    await expect(JSON.stringify(eventLog, null, 2) + '\n').toMatchFileSnapshot(
      '__goldens__/full-run-event-sequence.json'
    );
  }, 120000);
});
