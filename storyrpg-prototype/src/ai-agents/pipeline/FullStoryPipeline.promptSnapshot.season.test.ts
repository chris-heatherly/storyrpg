/**
 * Multi-episode (season) prompt-snapshot characterization test (refactor
 * safety net — third slice).
 *
 * Same harness as FullStoryPipeline.promptSnapshot.test.ts, but drives
 * `generateMultipleEpisodes` for a 2-episode season so the season-scoped
 * machinery is characterized: shared world/character foundation, sequential
 * episode generation, season-canon sealing + established-canon prompt blocks,
 * the callback ledger across episodes, the previousSummary handoff, and
 * ThreadPlanner/TwistArchitect (enabled via
 * generation.enableThreadAndTwistPlanning).
 *
 * If a refactor changes a golden, it changed pipeline behavior — it is not a
 * pure move. See docs/PIPELINE_REFACTOR_PLAN.md (Phase 0 / Phase 2,
 * ContentGeneration prerequisite).
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
import { disableArchitectCraftGatesForSnapshot } from '../testing/architectGateTestEnv';
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
  config.sceneCritic = { ...(config.sceneCritic ?? {}), enabled: true, maxScenesPerEpisode: 3 };
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
    imageWorkerModeEnabled: false,
    audioWorkerModeEnabled: false,
    minEncountersShort: 0,
    minEncountersMedium: 0,
    minEncountersLong: 0,
    requireSceneGraphBranching: false,
    allowLinearBottleneckEpisodes: true,
    // Season-scoped coverage: exercise the ThreadPlanner/TwistArchitect seam so
    // the ContentGeneration extraction proves the planning call order and prompt
    // assembly survive the move. CharacterArcTracker is now default-ON in
    // production but pinned OFF here (no scripted fixture for it yet — adding
    // full-pipeline arc coverage is a follow-up); pinning both keeps the golden
    // independent of the production defaults.
    enableThreadAndTwistPlanning: true,
    enableCharacterArcTracking: false,
  };
  config.debug = false;
  return new FullStoryPipeline(config);
}

describe('FullStoryPipeline prompt snapshot (multi-episode season characterization)', () => {
  it('generates the 2-episode season with an unchanged prompt/event sequence', async () => {
    // The output writer resolves `generated-stories/` against cwd in node —
    // run from a temp dir so the test never pollutes the real corpus.
    const { mkdtempSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const previousCwd = process.cwd();
    const scratch = mkdtempSync(join(tmpdir(), 'storyrpg-season-snapshot-'));
    process.chdir(scratch);

    const restoreArchitectCraftGates = disableArchitectCraftGatesForSnapshot();
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
      restoreArchitectCraftGates();
      process.chdir(previousCwd);
      rmSync(scratch, { recursive: true, force: true });
    }

    if (!result.success) {
      // Surface the terminal failure with full detail before the assertion.
      const errorEvents = (result.events ?? []).filter((e) => e.type === 'error').slice(-5);
      console.error('[seasonSnapshot] error events:', JSON.stringify(errorEvents, null, 2));
      const { writeFileSync } = await import('node:fs');
      writeFileSync('/tmp/season-snapshot-debug.json', serializePromptSnapshot(session.exchanges));
      console.error('[seasonSnapshot] captured exchanges dumped to /tmp/season-snapshot-debug.json');
    }
    expect(result.error ?? '').toBe('');
    expect(result.success).toBe(true);

    // 1. Ordering summary — fast to eyeball when the full snapshot diff is big.
    await expect(summarizePromptSnapshot(session.exchanges).join('\n') + '\n').toMatchFileSnapshot(
      '__goldens__/season-run-prompt-order.txt'
    );

    // 2. Full prompt sequence — the byte-identical refactor gate. This is the
    // gate that proves episode 2's prompts carry episode 1's sealed canon,
    // callback hooks, and previousSummary unchanged across a refactor.
    await expect(serializePromptSnapshot(session.exchanges)).toMatchFileSnapshot(
      '__goldens__/season-run-prompt-snapshot.json'
    );

    // 3. Event + checkpoint sequence — progress/resume contract.
    const eventLog = {
      events: normalizeEventsForSnapshot(result.events ?? []),
      checkpoints: normalizeCheckpointsForSnapshot(result.checkpoints ?? []),
    };
    await expect(JSON.stringify(eventLog, null, 2) + '\n').toMatchFileSnapshot(
      '__goldens__/season-run-event-sequence.json'
    );
  }, 240000);
});
