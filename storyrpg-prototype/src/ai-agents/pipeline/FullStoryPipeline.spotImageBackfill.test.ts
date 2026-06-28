// @ts-nocheck
import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

(globalThis as any).__DEV__ = false;

vi.mock('expo-file-system', () => ({
  documentDirectory: '/tmp/',
  EncodingType: { Base64: 'base64' },
  writeAsStringAsync: vi.fn(),
  makeDirectoryAsync: vi.fn(),
  getInfoAsync: vi.fn(async () => ({ exists: false, isDirectory: false })),
  readAsStringAsync: vi.fn(),
}));

describe('FullStoryPipeline targeted image backfill', () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirs.map(dir => fs.rm(dir, { recursive: true, force: true })));
    tempDirs.length = 0;
  });

  async function writeJson(file: string, value: unknown) {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, JSON.stringify(value, null, 2));
  }

  it('renders only requested beats, writes reports, and patches the story package', async () => {
    const { FullStoryPipeline } = await import('./FullStoryPipeline');
    const outputDir = `${await fs.mkdtemp(path.join(os.tmpdir(), 'storyrpg-spot-'))}/`;
    tempDirs.push(outputDir);

    const story = {
      id: 'story-spot',
      title: 'Spot Story',
      genre: 'Romance',
      synopsis: 'A spot backfill fixture.',
      coverImage: '',
      author: 'Test',
      tags: [],
      initialState: {
        attributes: {},
        skills: {},
        tags: [],
        inventory: [],
      },
      npcs: [],
      episodes: [{
        id: 'episode-1',
        number: 1,
        title: 'One',
        synopsis: 'Test',
        coverImage: '',
        startingSceneId: 'scene-1',
        scenes: [{
          id: 'scene-1',
          name: 'Door',
          startingBeatId: 'beat-1',
          beats: [
            { id: 'beat-1', text: 'You stand at the anonymous door.', image: '' },
            { id: 'beat-2', text: 'The next room waits.', image: '' },
          ],
        }],
      }],
    };

    await writeJson(path.join(outputDir, '00-input-brief.json'), {
      story: { title: 'Spot Story', genre: 'romance', tone: 'moody' },
      episode: { number: 1, title: 'One' },
      protagonist: { id: 'char-kylie', name: 'Kylie' },
    });
    await writeJson(path.join(outputDir, '01-world-bible.json'), { locations: [] });
    await writeJson(path.join(outputDir, '02-character-bible.json'), {
      characters: [{ id: 'char-kylie', name: 'Kylie', physicalDescription: 'blonde glasses' }],
    });
    await writeJson(path.join(outputDir, 'story.json'), { story, generator: { artStyle: 'test style' } });

    let imageOutputDir = '';
    const generated: any[] = [];
    const pipeline = new FullStoryPipeline({
      agents: {
        storyArchitect: { provider: 'anthropic', model: 'test', apiKey: '', maxTokens: 1000, temperature: 0 },
      } as any,
      validation: {} as any,
      debug: false,
      artStyle: 'wrong current generator style',
      imageGen: { enabled: true, provider: 'nano-banana', geminiApiKey: 'test-key' },
    } as any);
    pipeline.imageService = {
      setOutputDirectory: (dir: string) => { imageOutputDir = dir; },
      getGeminiSettings: () => ({}),
      updateGeminiSettings: vi.fn(),
      setArtStyleProfile: vi.fn(),
      generateImage: async (prompt: any, identifier: string, metadata: any, refs: any[]) => {
        generated.push({ prompt, identifier, metadata, refs });
        await fs.mkdir(path.join(imageOutputDir, 'prompts'), { recursive: true });
        await fs.writeFile(path.join(imageOutputDir, 'prompts', `${identifier}.json`), JSON.stringify({ identifier, metadata, prompt }, null, 2));
        const imagePath = path.join(imageOutputDir, `${identifier}.png`);
        await fs.writeFile(imagePath, 'png');
        return {
          prompt,
          imagePath,
          imageUrl: `generated-stories/story-spot/images/${identifier}.png`,
          metadata: { provider: 'test' },
        };
      },
    };

    const result = await pipeline.generateTargetedBeatImagesForDraft(outputDir, [
      { episodeNumber: 1, sceneId: 'scene-1', beatId: 'beat-1' },
    ]);

    expect(result.success).toBe(true);
    expect(generated).toHaveLength(1);
    expect(generated[0].metadata).toMatchObject({ type: 'beat', sceneId: 'scene-1', beatId: 'beat-1' });
    expect(generated[0].prompt.style).toBe('test style');
    expect(generated[0].prompt.prompt).not.toContain('wrong current generator style');

    const modern = JSON.parse(await fs.readFile(path.join(outputDir, 'story.json'), 'utf8'));
    expect(modern.story.episodes[0].scenes[0].beats[0].image).toContain('beat-episode-1-scene-1-beat-1');
    expect(modern.story.episodes[0].scenes[0].beats[1].image).toBe('');

    const missing = JSON.parse(await fs.readFile(path.join(outputDir, 'missing-image-slots.json'), 'utf8'));
    expect(missing.slots).toEqual([
      expect.objectContaining({ episodeNumber: 1, sceneId: 'scene-1', beatId: 'beat-1', status: 'patched' }),
    ]);
    const report = JSON.parse(await fs.readFile(path.join(outputDir, 'spot-image-backfill-report.json'), 'utf8'));
    expect(report.targets[0]).toMatchObject({ status: 'patched', patchedStoryPackage: true });
  });
});
