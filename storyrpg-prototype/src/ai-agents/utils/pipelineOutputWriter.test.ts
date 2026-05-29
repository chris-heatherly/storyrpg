import { mkdir, mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Story } from '../../types';
import { savePipelineOutputs, writeFinalStoryPackage, savePartialStory } from './pipelineOutputWriter';

vi.mock('expo-file-system', () => ({
  default: {},
  writeAsStringAsync: vi.fn(),
  makeDirectoryAsync: vi.fn(),
  getInfoAsync: vi.fn(async () => ({ exists: false })),
  EncodingType: { UTF8: 'utf8', Base64: 'base64' },
}));

const tempDirs: string[] = [];

function makeStory(): Story {
  return {
    id: 'story-writer-test',
    title: 'Story Writer Test',
    genre: 'Mystery',
    synopsis: 'A tiny story package fixture.',
    coverImage: '',
    author: 'Test',
    tags: [],
    initialState: {
      attributes: {
        charm: 0,
        wit: 0,
        courage: 0,
        empathy: 0,
        resolve: 0,
        resourcefulness: 0,
      },
      skills: {},
      tags: [],
      inventory: [],
    },
    npcs: [],
    episodes: [
      {
        id: 'episode-1',
        number: 1,
        title: 'Episode 1',
        synopsis: 'Test episode.',
        coverImage: '',
        startingSceneId: 'scene-1',
        scenes: [
          {
            id: 'scene-1',
            name: 'Scene 1',
            startingBeatId: 'beat-1',
            beats: [{ id: 'beat-1', text: 'The package writes.', choices: [] }],
          },
        ],
      },
    ],
  };
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('pipelineOutputWriter', () => {
  it('savePartialStory writes a marked recovery snapshot with the completed episodes (B2)', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'storyrpg-partial-'));
    tempDirs.push(tempDir);
    const outputDir = `${tempDir}/`;

    await savePartialStory(outputDir, makeStory());

    const raw = await readFile(`${outputDir}partial-story.json`, 'utf8');
    const parsed = JSON.parse(raw);
    expect(parsed._partial).toBe(true);
    expect(parsed.episodeCount).toBe(1);
    expect(parsed.story.title).toBe('Story Writer Test');
  });

  it('savePartialStory is best-effort and does not throw on a bad dir', async () => {
    await expect(savePartialStory('', makeStory())).resolves.toBeUndefined();
  });

  it('writes final story packages through Node built-in modules when require is unavailable', async () => {
    const originalGetBuiltinModule = process.getBuiltinModule;
    const requestedModules: string[] = [];
    vi.spyOn(process, 'getBuiltinModule').mockImplementation(((name: string) => {
      requestedModules.push(name);
      return originalGetBuiltinModule(name);
    }) as typeof process.getBuiltinModule);

    const tempDir = await mkdtemp(join(tmpdir(), 'storyrpg-output-writer-'));
    tempDirs.push(tempDir);
    const outputDir = `${tempDir}/`;

    const result = await writeFinalStoryPackage(outputDir, makeStory(), {
      generator: { version: 'test', pipeline: 'vitest' },
    });

    await expect(readFile(result.storyJsonPath, 'utf8')).resolves.toContain('story-writer-test');
    await expect(readFile(result.manifestPath, 'utf8')).resolves.toContain('story.json');
    await expect(readFile(`${outputDir}08-final-story.json`, 'utf8')).resolves.toContain('Story Writer Test');
    expect(requestedModules).toEqual(expect.arrayContaining(['fs', 'path', 'crypto']));
  });

  it('persists generator style profile and anchors onto the story body', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'storyrpg-output-writer-'));
    tempDirs.push(tempDir);
    const outputDir = `${tempDir}/`;

    const result = await writeFinalStoryPackage(outputDir, makeStory(), {
      generator: {
        version: 'test',
        pipeline: 'vitest',
        artStyleProfile: { name: 'Verbatim', family: 'unknown', rawStyle: 'bright comic art' },
        styleAnchors: { character: { imagePath: 'generated-stories/story/style-bible/character.png' } },
      },
    });

    const pkg = JSON.parse(await readFile(result.storyJsonPath, 'utf8'));
    expect(pkg.story.artStyleProfile).toMatchObject({ rawStyle: 'bright comic art' });
    expect(pkg.story.styleAnchors.character.imagePath).toBe('generated-stories/story/style-bible/character.png');

    const legacy = JSON.parse(await readFile(`${outputDir}08-final-story.json`, 'utf8'));
    expect(legacy.artStyleProfile).toMatchObject({ rawStyle: 'bright comic art' });
    expect(legacy.styleAnchors.character.imagePath).toBe('generated-stories/story/style-bible/character.png');
  });

  it('creates recovered prompt artifacts for bound story images that lack exact prompt files', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'storyrpg-output-writer-'));
    tempDirs.push(tempDir);
    const outputDir = `${tempDir}/`;
    const story = makeStory();
    story.episodes[0].scenes[0].beats[0].image =
      'generated-stories/story-writer-test/images/storyboard-v2/panels/storyboard-v2-story-beat-episode-1-scene-1-beat-1.png';

    await writeFinalStoryPackage(outputDir, story, {
      generator: { version: 'test', artStyle: 'local style lock' },
    });

    const prompt = JSON.parse(await readFile(
      `${outputDir}images/prompts/storyboard-v2-story-beat-episode-1-scene-1-beat-1.json`,
      'utf8',
    ));
    expect(prompt.metadata).toMatchObject({
      type: 'recovered-bound-image-prompt',
      storyId: 'story-writer-test',
      exactOriginalPromptMissing: true,
    });
    expect(prompt.prompt).toContain('The package writes.');
    expect(prompt.prompt).toContain('local style lock');

    const report = JSON.parse(await readFile(`${outputDir}image-prompt-binding-report.json`, 'utf8'));
    expect(report).toMatchObject({ checked: 1, alreadyPresent: 0, recovered: 1 });
    expect(report.records[0]).toMatchObject({
      status: 'recovered',
      promptPath: 'images/prompts/storyboard-v2-story-beat-episode-1-scene-1-beat-1.json',
    });
  });

  it('preserves existing exact prompt artifacts when writing final packages', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'storyrpg-output-writer-'));
    tempDirs.push(tempDir);
    const outputDir = `${tempDir}/`;
    const story = makeStory();
    story.episodes[0].scenes[0].beats[0].image =
      'generated-stories/story-writer-test/images/beat-episode-1-scene-1-beat-1.png';

    await mkdir(`${outputDir}images/prompts`, { recursive: true });
    await writeFile(
      `${outputDir}images/prompts/beat-episode-1-scene-1-beat-1.json`,
      JSON.stringify({ identifier: 'original', prompt: 'original provider prompt' }, null, 2),
    );

    await writeFinalStoryPackage(outputDir, story, {
      generator: { version: 'test', artStyle: 'local style lock' },
    });

    const prompt = JSON.parse(await readFile(`${outputDir}images/prompts/beat-episode-1-scene-1-beat-1.json`, 'utf8'));
    expect(prompt).toEqual({ identifier: 'original', prompt: 'original provider prompt' });

    const report = JSON.parse(await readFile(`${outputDir}image-prompt-binding-report.json`, 'utf8'));
    expect(report).toMatchObject({ checked: 1, alreadyPresent: 1, recovered: 0 });
  });

  it('writes the final story contract sidecar and manifest summary', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'storyrpg-output-writer-'));
    tempDirs.push(tempDir);
    const outputDir = `${tempDir}/`;

    await savePipelineOutputs(outputDir, {
      brief: {
        story: {
          id: 'story-writer-test',
          title: 'Story Writer Test',
          genre: 'Mystery',
          synopsis: 'A tiny story package fixture.',
          themes: [],
        },
      },
      finalStory: makeStory(),
      finalStoryContractReport: {
        passed: true,
        blockingIssues: [],
        warnings: [],
        metrics: {
          episodesChecked: 1,
          scenesChecked: 1,
          beatsChecked: 1,
          encounterScenesChecked: 0,
          validEncounterScenes: 0,
          requestedEpisodesMissing: 0,
          failedIncrementalResults: 0,
          callbackIssues: 0,
          mechanicsLeaks: 0,
        },
        generatedAt: '2026-05-28T00:00:00.000Z',
      },
    } as any, 123);

    const contract = JSON.parse(await readFile(`${outputDir}07b-final-story-contract.json`, 'utf8'));
    expect(contract).toMatchObject({ passed: true });

    const manifest = JSON.parse(await readFile(`${outputDir}manifest.json`, 'utf8'));
    expect(manifest.files).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'Final Story Contract', type: 'final-story-contract' }),
    ]));
    expect(manifest.summary).toMatchObject({
      finalStoryContractPassed: true,
      finalStoryContractBlockingIssues: 0,
    });
  });
});
