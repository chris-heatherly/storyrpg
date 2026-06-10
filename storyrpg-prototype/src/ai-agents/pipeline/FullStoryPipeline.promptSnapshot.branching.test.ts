/**
 * Branching + encounter prompt-snapshot characterization test (refactor
 * safety net — second slice).
 *
 * Same harness as FullStoryPipeline.promptSnapshot.test.ts, but the scripted
 * blueprint exercises the content-generation shapes the linear slice cannot:
 *   - a real branch point (choicePoint.branches + 2-target leadsTo) with
 *     per-target routed choices,
 *   - a reconvergence scene stamped with a residue requirement, and
 *   - an encounter scene (EncounterArchitect instead of SceneWriter).
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
import { buildBranchingRunFixtureMap } from '../testing/branchingRunFixtures';
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
      synopsis:
        'Mara finds the passage behind the library portrait and chooses between taking it alone or facing Edric.',
      startingLocation: 'loc-1',
    },
    options: {
      // 2 major choices → the season choice plan allocates a non-expression
      // slot for the branch point (an all-expression slice would force the
      // branching choice point to 'expression', which cannot branch).
      targetSceneCount: 4,
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
    // This slice REQUIRES the branch: the blueprint carries one branch point
    // (scene-1 → scene-2a | scene-2b) reconverging at scene-3, plus one
    // encounter scene. Encounter minimums stay 0 so the encounter is driven
    // by the blueprint, not by a config-repair loop.
    minEncountersShort: 0,
    minEncountersMedium: 0,
    minEncountersLong: 0,
    requireSceneGraphBranching: true,
    allowLinearBottleneckEpisodes: false,
  };
  config.debug = false;
  return new FullStoryPipeline(config);
}

describe('FullStoryPipeline prompt snapshot (branching + encounter characterization)', () => {
  it('generates the branching brief with an unchanged prompt/event sequence', async () => {
    // The output writer resolves `generated-stories/` against cwd in node —
    // run from a temp dir so the test never pollutes the real corpus.
    const { mkdtempSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const previousCwd = process.cwd();
    const scratch = mkdtempSync(join(tmpdir(), 'storyrpg-branching-snapshot-'));
    process.chdir(scratch);

    const session = startPromptCapture(createScriptedResponder(buildBranchingRunFixtureMap()));
    let result;
    try {
      const pipeline = await buildPipeline();
      result = await pipeline.generate(buildBrief());
    } finally {
      session.stop();
      process.chdir(previousCwd);
      rmSync(scratch, { recursive: true, force: true });
    }

    if (!result.success) {
      // Surface the terminal failure with full detail before the assertion.
      const errorEvents = (result.events ?? []).filter((e) => e.type === 'error').slice(-5);
      console.error('[branchingSnapshot] error events:', JSON.stringify(errorEvents, null, 2));
      const { writeFileSync } = await import('node:fs');
      writeFileSync('/tmp/branching-snapshot-debug.json', serializePromptSnapshot(session.exchanges));
      console.error('[branchingSnapshot] captured exchanges dumped to /tmp/branching-snapshot-debug.json');
    }
    expect(result.error ?? '').toBe('');
    expect(result.success).toBe(true);

    // 1. Ordering summary — fast to eyeball when the full snapshot diff is big.
    await expect(summarizePromptSnapshot(session.exchanges).join('\n') + '\n').toMatchFileSnapshot(
      '__goldens__/branching-run-prompt-order.txt'
    );

    // 2. Full prompt sequence — the byte-identical refactor gate.
    await expect(serializePromptSnapshot(session.exchanges)).toMatchFileSnapshot(
      '__goldens__/branching-run-prompt-snapshot.json'
    );

    // 3. Event + checkpoint sequence — progress/resume contract.
    const eventLog = {
      events: normalizeEventsForSnapshot(result.events ?? []),
      checkpoints: normalizeCheckpointsForSnapshot(result.checkpoints ?? []),
    };
    await expect(JSON.stringify(eventLog, null, 2) + '\n').toMatchFileSnapshot(
      '__goldens__/branching-run-event-sequence.json'
    );
  }, 180000);
});
