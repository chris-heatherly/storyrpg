import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

const STORY_DIR = path.resolve('generated-stories/bite-me_2026-05-18T17-06-20');
const describeOpenAiRerender = process.env.RUN_OPENAI_RERENDER_TEST === 'true' ? describe : describe.skip;

(globalThis as any).__DEV__ = false;

vi.mock('expo-file-system', () => ({
  documentDirectory: '/tmp/',
  EncodingType: { Base64: 'base64' },
  writeAsStringAsync: vi.fn(),
  makeDirectoryAsync: vi.fn(),
  getInfoAsync: vi.fn(async () => ({ exists: false, isDirectory: false })),
  readAsStringAsync: vi.fn(),
}));

function cloneWithoutGeneratedImages<T>(value: T): T {
  const cloned = JSON.parse(JSON.stringify(value));
  const visit = (node: any) => {
    if (!node || typeof node !== 'object') return;
    delete node.image;
    delete node.imageUrl;
    delete node.imagePath;
    delete node.panelImages;
    delete node.backgroundImage;
    for (const child of Object.values(node)) {
      if (Array.isArray(child)) child.forEach(visit);
      else visit(child);
    }
  };
  visit(cloned);
  return cloned;
}

async function patchStoryFiles(urlsByBeat: Map<string, string>, sceneBackground?: string) {
  const files = [
    path.join(STORY_DIR, 'story.json'),
    path.join(STORY_DIR, 'checkpoints/final-story-before-save.json'),
  ];

  for (const file of files) {
    const pkg = JSON.parse(await fs.readFile(file, 'utf8'));
    const story = pkg.story || pkg;
    const episode = (story.episodes || []).find((ep: any) => ep.number === 1) || story.episodes?.[0];
    const scene = episode?.scenes?.find((candidate: any) => candidate.id === 'scene-5');
    if (!scene) continue;
    scene.backgroundImage = sceneBackground || urlsByBeat.get('episode-1-scene-5::beat-1') || scene.backgroundImage;
    for (const beat of scene.beats || []) {
      const url = urlsByBeat.get(`episode-1-scene-5::${beat.id}`);
      if (url) beat.image = url;
    }
    story.imagesStatus = 'partial';
    await fs.writeFile(file, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8');
  }
}

describeOpenAiRerender('Bite Me S5 OpenAI rerender', () => {
  it('rerenders scene 5 through storyboard-v2 with GPT Image and patches the story package', { timeout: 60 * 60 * 1000 }, async () => {
    const { AssetRegistry } = await import('../assetRegistry');
    const { StoryboardV2Pipeline } = await import('./StoryboardV2Pipeline');

    const openaiKey = process.env.OPENAI_API_KEY || process.env.EXPO_PUBLIC_OPENAI_API_KEY;
    expect(openaiKey, 'OPENAI_API_KEY or EXPO_PUBLIC_OPENAI_API_KEY must be set').toBeTruthy();

    const storyPackage = JSON.parse(await fs.readFile(path.join(STORY_DIR, 'story.json'), 'utf8'));
    const story = storyPackage.story;
    const episode = (story.episodes || []).find((ep: any) => ep.number === 1) || story.episodes[0];
    const scene5 = episode.scenes.find((scene: any) => scene.id === 'scene-5');
    const characterBible = JSON.parse(await fs.readFile(path.join(STORY_DIR, '02-character-bible.json'), 'utf8'));
    const artStyle = storyPackage.generator?.canonicalArtStyle || storyPackage.generator?.artStyle || 'expressive illustrated story art';
    const outputDirectory = path.join(STORY_DIR, 'openai-s5-rerender-1779206118430') + path.sep;
    const assetRegistry = new AssetRegistry(storyPackage.storyId || story.id || 'bite-me');

    const pipeline = new StoryboardV2Pipeline({
      config: {
        agents: {} as any,
        validation: {} as any,
        debug: false,
        outputDir: outputDirectory,
        artStyle,
        imageGen: {
          enabled: true,
          provider: 'dall-e',
          pipelineMode: 'storyboard-v2',
          openaiApiKey: openaiKey,
          openaiImageModel: process.env.EXPO_PUBLIC_OPENAI_IMAGE_MODEL || process.env.OPENAI_IMAGE_MODEL || 'gpt-image-2',
          openaiModeration: 'auto',
          storyboardV2: {
            maxPanelsPerSheet: 8,
            refineCroppedPanels: true,
          },
        },
        generation: {
          failurePolicy: 'continue',
        },
      } as any,
      assetRegistry,
      outputDirectory,
    });

    const result = await pipeline.generateEpisode({
      brief: {
        story: {
          title: story.title,
          genre: story.genre || 'paranormal romance',
          tone: story.tone || 'witty, romantic, supernatural',
          synopsis: story.synopsis,
        },
        episode: {
          number: episode.number || 1,
          title: episode.title || episode.name || 'Dating After Dusk',
          synopsis: episode.synopsis,
        },
        protagonist: {
          id: characterBible.protagonist?.id || 'char-kylie-marinescu',
          name: characterBible.protagonist?.name || 'Kylie Marinescu',
        },
      },
      sceneContents: [cloneWithoutGeneratedImages({
        sceneId: scene5.id,
        sceneName: scene5.name || 'Dating After Dusk',
        beats: scene5.beats,
        startingBeatId: scene5.startingBeatId || scene5.beats?.[0]?.id || 'beat-1',
        moodProgression: [],
        charactersInvolved: scene5.charactersInvolved || ['Kylie'],
        keyMoments: [],
        continuityNotes: [],
        sequenceIntent: scene5.sequenceIntent,
        sceneVisualSequencePlan: scene5.sceneVisualSequencePlan,
        isBottleneck: scene5.isBottleneck,
        isConvergencePoint: scene5.isConvergencePoint,
      }) as any],
      characterBible,
      encounters: new Map(),
    });

    expect(result.beatImages.size).toBeGreaterThan(0);
    await patchStoryFiles(result.beatImages, result.sceneImages.get('episode-1-scene-5'));

    const patched = JSON.parse(await fs.readFile(path.join(STORY_DIR, 'story.json'), 'utf8'));
    const patchedScene = patched.story.episodes[0].scenes.find((scene: any) => scene.id === 'scene-5');
    expect(patchedScene.beats.every((beat: any) => String(beat.image || '').includes('/openai-s5-rerender-'))).toBe(true);
  });
});
