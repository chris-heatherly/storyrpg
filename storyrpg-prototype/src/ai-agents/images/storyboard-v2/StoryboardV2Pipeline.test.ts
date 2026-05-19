import { describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { AssetRegistry } from '../assetRegistry';
import { StoryboardV2Pipeline } from './StoryboardV2Pipeline';

vi.mock('../../services/imageGenerationService', () => ({
  ImageGenerationService: class {
    setOutputDirectory() {}
    async generateImage() {
      throw new Error('mock service should be injected by tests');
    }
  },
}));

describe('StoryboardV2Pipeline', () => {
  async function makeMockImageService(
    outputDirectory: string,
    prompts: any[],
    qaReports?: any[],
    options?: { omitImageDataFor?: (identifier: string) => boolean },
  ) {
    const sharp = (await import('sharp')).default;
    const sheetBuffer = await sharp({
      create: {
        width: 1536,
        height: 1024,
        channels: 4,
        background: { r: 30, g: 40, b: 50, alpha: 1 },
      },
    }).png().toBuffer();
    const panelBuffer = await sharp({
      create: {
        width: 1024,
        height: 1536,
        channels: 4,
        background: { r: 60, g: 70, b: 80, alpha: 1 },
      },
    }).png().toBuffer();
    return {
      setOutputDirectory: () => {},
      generateImage: async (prompt: any, identifier: string, metadata: any, refs?: any[]) => {
        prompts.push({ prompt, identifier, metadata, refs });
        const buffer = identifier.includes('panels/') ? panelBuffer : sheetBuffer;
        const imagePath = `${outputDirectory}images/storyboard-v2/${identifier}.png`;
        await fs.mkdir(path.dirname(imagePath), { recursive: true });
        await fs.writeFile(imagePath, buffer);
        return {
          prompt,
          imageUrl: `generated-stories/test/images/${identifier}.png`,
          imagePath,
          imageData: options?.omitImageDataFor?.(identifier) ? undefined : buffer.toString('base64'),
          mimeType: options?.omitImageDataFor?.(identifier) ? undefined : 'image/png',
          metadata: { provider: 'openai', model: 'gpt-image-2' },
        };
      },
      checkImageForDefects: async () => qaReports?.shift() || ({ passed: true, issues: [], reason: 'test pass' }),
    };
  }

  const baseConfig = {
    agents: {} as any,
    validation: {} as any,
    debug: false,
    outputDir: './generated',
    artStyle: 'messy risograph pulp fantasy',
    imageGen: {
      enabled: true,
      pipelineMode: 'storyboard-v2',
      openaiApiKey: 'test',
      openaiImageModel: 'gpt-image-2',
    },
  } as any;

  it('keeps raw art style authoritative and selects essential refs', async () => {
    const prompts: any[] = [];
    const outputDirectory = `${await fs.mkdtemp(path.join(os.tmpdir(), 'storyboard-v2-'))}/`;
    const mockImageService = await makeMockImageService(outputDirectory, prompts);
    const pipeline = new StoryboardV2Pipeline({
      config: baseConfig,
      imageService: mockImageService as any,
      assetRegistry: new AssetRegistry('test'),
      outputDirectory,
    });

    await pipeline.generateEpisode({
      brief: {
        story: { title: 'Test Story', genre: 'fantasy', tone: 'ominous' },
        episode: { number: 1, title: 'Pilot' },
        protagonist: { id: 'hero', name: 'Mara' },
      },
      characterBible: {
        characters: [{
          id: 'char-erosalex-kiriakis',
          name: 'Eros/Alex Kiriakis',
          role: 'love-interest',
          importance: 'major',
          overview: 'A charming offscreen presence.',
          physicalDescription: 'golden skin and warm hands',
          typicalAttire: 'white shirt',
          distinctiveFeatures: ['shifting eyes'],
        }, {
          id: 'hero',
          name: 'Mara',
          role: 'protagonist',
          importance: 'major',
          overview: 'A worried scout.',
          physicalDescription: 'short silver hair and brown skin',
          typicalAttire: 'gray cloak',
          distinctiveFeatures: ['scar through eyebrow'],
        }],
      } as any,
      sceneContents: [{
        sceneId: 'scene-1',
        sceneName: 'Gate',
        startingBeatId: 'b1',
        charactersInvolved: ['hero', 'char-erosalex-kiriakis'],
        beats: [{ id: 'b1', text: 'Mara pushes open the gate.', speaker: 'Mara', primaryAction: 'pushes open the gate' }],
      } as any],
      encounters: new Map(),
    });

    const sheetCall = prompts.find((call) => call.identifier.includes('sheets/storyboard-v2-'));
    expect(sheetCall.prompt.prompt.startsWith('ART STYLE: messy risograph pulp fantasy')).toBe(true);
    expect(sheetCall.prompt.prompt).toContain('lower 30-40% visually calmer and darker');
    expect(sheetCall.prompt.prompt).toContain('Do not render readable text anywhere in the image');
    expect(sheetCall.prompt.prompt).toContain('PHONE / SCREEN POLICY');
    expect(sheetCall.prompt.prompt).toContain('Never use white mats');
    expect(sheetCall.prompt.prompt).toContain('episodeStyleLockRef controls palette');
    expect(sheetCall.prompt.prompt).toContain('each visible canonical character may appear exactly once');
    expect(sheetCall.prompt.prompt).toContain('VISUAL STORYTELLING DIRECTIVE');
    expect(sheetCall.prompt.prompt).toContain('Scene visual geography');
    expect(sheetCall.prompt.prompt).toContain('Scene visual movement line');
    expect(sheetCall.prompt.prompt).toContain('Scene visual shot rhythm');
    expect(sheetCall.prompt.prompt).toContain('Coverage plan');
    expect(sheetCall.prompt.prompt).toContain('60% base');
    expect(sheetCall.prompt.prompt).toContain('Lighting and color are variations inside the master art style, not new style instructions.');
    expect(sheetCall.prompt.prompt.indexOf('REFERENCE ROLE HIERARCHY:')).toBeLessThan(sheetCall.prompt.prompt.indexOf('VISUAL STORYTELLING DIRECTIVE'));
    expect(sheetCall.prompt.prompt).not.toContain('dramatic cinematic story art');
    expect(sheetCall.prompt.prompt).not.toMatch(/\b(?:photoreal|DSLR|Hitchcock|Kubrick|orange and teal)\b/i);
    expect(sheetCall.refs.map((ref: any) => ref.role)).toEqual([
      'character-reference',
      'episode-style-lock',
    ]);
    const refineCall = prompts.find((call) => call.identifier.includes('panels/storyboard-v2-'));
    expect(refineCall.prompt.prompt.startsWith('ART STYLE: messy risograph pulp fantasy')).toBe(true);
    expect(refineCall.prompt.prompt).toContain('VISUAL STORYTELLING DIRECTIVE');
    expect(refineCall.prompt.prompt.indexOf('REFERENCE ROLE HIERARCHY:')).toBeLessThan(refineCall.prompt.prompt.indexOf('VISUAL STORYTELLING DIRECTIVE'));
    expect(refineCall.metadata.renderRoute).toBe('storyboard-sheet-crop-refine');
    expect(refineCall.refs.map((ref: any) => ref.role)).toEqual([
      'storyboard-panel-crop',
      'character-reference',
      'episode-style-lock',
    ]);
  });

  it('prewarms character references for every CharacterBible character before storyboard rendering', async () => {
    const prompts: any[] = [];
    const outputDirectory = `${await fs.mkdtemp(path.join(os.tmpdir(), 'storyboard-v2-'))}/`;
    const mockImageService = await makeMockImageService(outputDirectory, prompts);
    const pipeline = new StoryboardV2Pipeline({
      config: baseConfig,
      imageService: mockImageService as any,
      assetRegistry: new AssetRegistry('test'),
      outputDirectory,
    });

    await pipeline.generateEpisode({
      brief: {
        story: { title: 'Test Story', genre: 'fantasy', tone: 'ominous' },
        episode: { number: 1, title: 'Pilot' },
        protagonist: { id: 'hero', name: 'Mara' },
      },
      characterBible: {
        characters: [{
          id: 'hero',
          name: 'Mara',
          role: 'protagonist',
          physicalDescription: 'short silver hair and brown skin',
        }, {
          id: 'ally',
          name: 'Ilya',
          role: 'ally',
          physicalDescription: 'black braid and opal ring',
        }, {
          id: 'offscreen-god',
          name: 'Hermes',
          role: 'supporting',
          physicalDescription: 'winged shoes and quick smile',
        }],
      } as any,
      sceneContents: [{
        sceneId: 'scene-1',
        sceneName: 'Gate',
        startingBeatId: 'b1',
        charactersInvolved: ['hero'],
        beats: [{ id: 'b1', text: 'Mara opens the gate.', speaker: 'Mara' }],
      } as any],
      encounters: new Map(),
    });

    const refCalls = prompts.filter((call) => call.identifier.includes('storyboard-v2-ref-'));
    expect(refCalls.map((call) => call.identifier)).toEqual(expect.arrayContaining([
      'storyboard-v2-ref-hero',
      'storyboard-v2-ref-ally',
      'storyboard-v2-ref-offscreen-god',
    ]));
    const sheetCallIndex = prompts.findIndex((call) => call.identifier.includes('sheets/storyboard-v2-'));
    expect(prompts.findIndex((call) => call.identifier === 'storyboard-v2-ref-offscreen-god')).toBeLessThan(sheetCallIndex);

    const referenceManifest = JSON.parse(await fs.readFile(`${outputDirectory}images/storyboard-v2/reference-manifest.json`, 'utf8'));
    expect(referenceManifest.characterRefs.map((ref: any) => ref.characterId)).toEqual(expect.arrayContaining([
      'hero',
      'ally',
      'offscreen-god',
    ]));
  });

  it('generates chunked sheets and crops local 9:16 story images from them', async () => {
    const prompts: any[] = [];
    const outputDirectory = `${await fs.mkdtemp(path.join(os.tmpdir(), 'storyboard-v2-'))}/`;
    const mockImageService = await makeMockImageService(outputDirectory, prompts);
    const pipeline = new StoryboardV2Pipeline({
      config: baseConfig,
      imageService: mockImageService as any,
      assetRegistry: new AssetRegistry('test'),
      outputDirectory,
    });

    await pipeline.generateEpisode({
      brief: {
        story: { title: 'Test Story', genre: 'fantasy', tone: 'ominous' },
        episode: { number: 1, title: 'Pilot' },
        protagonist: { id: 'hero', name: 'Mara' },
      },
      characterBible: {
        characters: [{
          id: 'char-erosalex-kiriakis',
          name: 'Eros/Alex Kiriakis',
          role: 'love-interest',
          importance: 'major',
          overview: 'A charming offscreen presence.',
          physicalDescription: 'golden skin and warm hands',
          typicalAttire: 'white shirt',
          distinctiveFeatures: ['shifting eyes'],
        }, {
          id: 'hero',
          name: 'Mara',
          role: 'protagonist',
          importance: 'major',
          overview: 'A worried scout.',
          physicalDescription: 'short silver hair and brown skin',
          typicalAttire: 'gray cloak',
          distinctiveFeatures: ['scar through eyebrow'],
        }],
      } as any,
      sceneContents: [{
        sceneId: 'scene-1',
        sceneName: 'Gate',
        startingBeatId: 'beat-1',
        charactersInvolved: ['hero'],
        beats: Array.from({ length: 7 }, (_, index) => ({
          id: `beat-${index + 1}`,
          text: `Mara advances through gate moment ${index + 1}.`,
          speaker: 'Mara',
        })),
      } as any],
      encounters: new Map(),
    });

    const sheetPrompts = prompts.filter((call) => call.identifier.includes('sheets/storyboard-v2-'));
    expect(sheetPrompts).toHaveLength(2);

    const sheetManifest = JSON.parse(await fs.readFile(`${outputDirectory}images/storyboard-v2/sheet-manifest.json`, 'utf8'));
    expect(sheetManifest.sheets).toHaveLength(2);
    expect(sheetManifest.sheets[0].crops).toHaveLength(6);
    expect(sheetManifest.sheets[1].crops).toHaveLength(1);
    expect(sheetManifest.sheets[0].crops[0].cellBox).toEqual({ x: 0, y: 0, width: 512, height: 512 });
    expect(sheetManifest.sheets[0].crops[0].cropBox.x).toBeGreaterThan(sheetManifest.sheets[0].crops[0].cellBox.x);
    expect(sheetManifest.sheets[0].crops[0].draftCropImagePath).toContain('images/storyboard-v2/crops/');
    expect(sheetManifest.sheets[0].crops[0].finalImagePath).toContain('images/storyboard-v2/panels/');

    const localManifest = JSON.parse(await fs.readFile(`${outputDirectory}images/storyboard-v2/local-images.json`, 'utf8'));
    expect(localManifest.images).toHaveLength(7);
    const firstPanelPath = localManifest.images[0].imagePath;
    const metadata = await (await import('sharp')).default(firstPanelPath).metadata();
    expect(metadata.width).toBe(1024);
    expect(metadata.height).toBe(1536);
  });

  it('records sheet-level failures when a storyboard sheet has no image data', async () => {
    const prompts: any[] = [];
    const outputDirectory = `${await fs.mkdtemp(path.join(os.tmpdir(), 'storyboard-v2-'))}/`;
    const mockImageService = await makeMockImageService(outputDirectory, prompts, undefined, {
      omitImageDataFor: (identifier) => identifier === 'sheets/storyboard-v2-episode-1-scene-1-sheet-2',
    });
    const pipeline = new StoryboardV2Pipeline({
      config: baseConfig,
      imageService: mockImageService as any,
      assetRegistry: new AssetRegistry('test'),
      outputDirectory,
    });

    const result = await pipeline.generateEpisode({
      brief: {
        story: { title: 'Test Story', genre: 'fantasy', tone: 'ominous' },
        episode: { number: 1, title: 'Pilot' },
        protagonist: { id: 'hero', name: 'Mara' },
      },
      characterBible: {
        characters: [{
          id: 'hero',
          name: 'Mara',
          role: 'protagonist',
          importance: 'major',
          overview: 'A worried scout.',
          physicalDescription: 'short silver hair and brown skin',
          typicalAttire: 'gray cloak',
          distinctiveFeatures: ['scar through eyebrow'],
        }],
      } as any,
      sceneContents: [{
        sceneId: 'scene-1',
        sceneName: 'Gate',
        startingBeatId: 'beat-1',
        charactersInvolved: ['hero'],
        beats: Array.from({ length: 7 }, (_, index) => ({
          id: `beat-${index + 1}`,
          text: `Mara advances through gate moment ${index + 1}.`,
          speaker: 'Mara',
        })),
      } as any],
      encounters: new Map(),
    });

    expect(result.beatImages.size).toBe(6);
    expect(result.beatImages.has('episode-1-scene-1::beat-7')).toBe(false);
    expect(result.diagnostics.failedSlots).toEqual(expect.arrayContaining([
      expect.objectContaining({
        slotId: 'sheets/storyboard-v2-episode-1-scene-1-sheet-2',
        error: 'Storyboard sheet result did not include image data for cropping.',
      }),
      expect.objectContaining({
        slotId: 'story-beat:episode-1-scene-1::beat-7',
        error: expect.stringContaining('Skipped because storyboard sheet episode-1-scene-1-sheet-2 failed'),
      }),
    ]));
    expect(result.diagnostics.imageCompleteness.complete).toBe(false);
    expect(result.diagnostics.requiredSlotFailures).toEqual(expect.arrayContaining([
      expect.objectContaining({
        slotId: 'story-beat:episode-1-scene-1::beat-7',
        family: 'story-beat',
        error: expect.stringContaining('scene background fallback does not satisfy beat-level coverage'),
      }),
    ]));

    const promptAudit = JSON.parse(await fs.readFile(`${outputDirectory}images/storyboard-v2/prompts/episode-1-scene-1-sheet-2.sheet.json`, 'utf8'));
    expect(promptAudit.failure).toBe('Storyboard sheet result did not include image data for cropping.');
  });

  it('honors a twelve-panel storyboard sheet cap', async () => {
    const prompts: any[] = [];
    const outputDirectory = `${await fs.mkdtemp(path.join(os.tmpdir(), 'storyboard-v2-'))}/`;
    const mockImageService = await makeMockImageService(outputDirectory, prompts);
    const pipeline = new StoryboardV2Pipeline({
      config: {
        ...baseConfig,
        imageGen: {
          ...baseConfig.imageGen,
          storyboardV2: { maxPanelsPerSheet: 12 },
        },
      },
      imageService: mockImageService as any,
      assetRegistry: new AssetRegistry('test'),
      outputDirectory,
    });

    await pipeline.generateEpisode({
      brief: {
        story: { title: 'Test Story', genre: 'fantasy', tone: 'ominous' },
        episode: { number: 1, title: 'Pilot' },
        protagonist: { id: 'hero', name: 'Mara' },
      },
      characterBible: {
        characters: [{
          id: 'hero',
          name: 'Mara',
          role: 'protagonist',
          importance: 'major',
          overview: 'A worried scout.',
          physicalDescription: 'short silver hair and brown skin',
          typicalAttire: 'gray cloak',
          distinctiveFeatures: ['scar through eyebrow'],
        }],
      } as any,
      sceneContents: [{
        sceneId: 'scene-1',
        sceneName: 'Gate',
        startingBeatId: 'beat-1',
        charactersInvolved: ['hero'],
        beats: Array.from({ length: 13 }, (_, index) => ({
          id: `beat-${index + 1}`,
          text: `Mara advances through gate moment ${index + 1}.`,
          speaker: 'Mara',
        })),
      } as any],
      encounters: new Map(),
    });

    const sheetPrompts = prompts.filter((call) => call.identifier.includes('sheets/storyboard-v2-'));
    expect(sheetPrompts).toHaveLength(2);
    expect(sheetPrompts[0].metadata.panelCount).toBe(12);
    expect(sheetPrompts[0].prompt.prompt).toContain('GRID: 4 columns x 3 rows');
    expect(sheetPrompts[0].prompt.aspectRatio).toBe('36:48');

    const sheetManifest = JSON.parse(await fs.readFile(`${outputDirectory}images/storyboard-v2/sheet-manifest.json`, 'utf8'));
    expect(sheetManifest.maxPanelsPerSheet).toBe(12);
    expect(sheetManifest.sheets[0].layout).toMatchObject({ columns: 4, rows: 3, panelAspectRatio: '9:16' });
    expect(sheetManifest.sheets[0].crops).toHaveLength(12);
    expect(sheetManifest.sheets[1].crops).toHaveLength(1);
  });

  it('requests exact sheet ratios so every cell stays 9:16 on a nine-panel sheet', async () => {
    const prompts: any[] = [];
    const outputDirectory = `${await fs.mkdtemp(path.join(os.tmpdir(), 'storyboard-v2-'))}/`;
    const mockImageService = await makeMockImageService(outputDirectory, prompts);
    const pipeline = new StoryboardV2Pipeline({
      config: {
        ...baseConfig,
        imageGen: {
          ...baseConfig.imageGen,
          storyboardV2: { maxPanelsPerSheet: 9 },
        },
      },
      imageService: mockImageService as any,
      assetRegistry: new AssetRegistry('test'),
      outputDirectory,
    });

    await pipeline.generateEpisode({
      brief: {
        story: { title: 'Test Story', genre: 'fantasy', tone: 'ominous' },
        episode: { number: 1, title: 'Pilot' },
        protagonist: { id: 'hero', name: 'Mara' },
      },
      characterBible: {
        characters: [{
          id: 'hero',
          name: 'Mara',
          role: 'protagonist',
          importance: 'major',
          overview: 'A worried scout.',
          physicalDescription: 'short silver hair and brown skin',
          typicalAttire: 'gray cloak',
          distinctiveFeatures: ['scar through eyebrow'],
        }],
      } as any,
      sceneContents: [{
        sceneId: 'scene-1',
        sceneName: 'Gate',
        startingBeatId: 'beat-1',
        charactersInvolved: ['hero'],
        beats: Array.from({ length: 9 }, (_, index) => ({
          id: `beat-${index + 1}`,
          text: `Mara advances through gate moment ${index + 1}.`,
          speaker: 'Mara',
        })),
      } as any],
      encounters: new Map(),
    });

    const sheetPrompts = prompts.filter((call) => call.identifier.includes('sheets/storyboard-v2-'));
    expect(sheetPrompts).toHaveLength(1);
    expect(sheetPrompts[0].metadata.panelCount).toBe(9);
    expect(sheetPrompts[0].prompt.aspectRatio).toBe('27:48');
    expect(sheetPrompts[0].prompt.prompt).toContain('GRID: 3 columns x 3 rows');
    expect(sheetPrompts[0].prompt.prompt).toContain('Overall sheet aspect ratio must be 27:48 so every grid cell is exactly 9:16');
    expect(sheetPrompts[0].prompt.prompt).toContain('including the bottom row');

    const sheetManifest = JSON.parse(await fs.readFile(`${outputDirectory}images/storyboard-v2/sheet-manifest.json`, 'utf8'));
    expect(sheetManifest.sheets[0].layout).toMatchObject({
      columns: 3,
      rows: 3,
      aspectRatio: '27:48',
      panelAspectRatio: '9:16',
    });
  });

  it('treats sheet gutter QA as advisory and still binds every panel on a nine-panel sheet', async () => {
    const prompts: any[] = [];
    const outputDirectory = `${await fs.mkdtemp(path.join(os.tmpdir(), 'storyboard-v2-'))}/`;
    const mockImageService = await makeMockImageService(outputDirectory, prompts, [
      { passed: false, issues: ['panel_leakage'], reason: 'intentional storyboard gutters detected' },
    ]);
    const pipeline = new StoryboardV2Pipeline({
      config: {
        ...baseConfig,
        imageGen: {
          ...baseConfig.imageGen,
          storyboardV2: { maxPanelsPerSheet: 9 },
        },
      },
      imageService: mockImageService as any,
      assetRegistry: new AssetRegistry('test'),
      outputDirectory,
    });

    const result = await pipeline.generateEpisode({
      brief: {
        story: { title: 'Test Story', genre: 'fantasy', tone: 'ominous' },
        episode: { number: 1, title: 'Pilot' },
        protagonist: { id: 'hero', name: 'Mara' },
      },
      characterBible: {
        characters: [{
          id: 'hero',
          name: 'Mara',
          role: 'protagonist',
          importance: 'major',
          overview: 'A worried scout.',
          physicalDescription: 'short silver hair and brown skin',
          typicalAttire: 'gray cloak',
          distinctiveFeatures: ['scar through eyebrow'],
        }],
      } as any,
      sceneContents: [{
        sceneId: 'scene-1',
        sceneName: 'Gate',
        startingBeatId: 'beat-1',
        charactersInvolved: ['hero'],
        beats: Array.from({ length: 9 }, (_, index) => ({
          id: `beat-${index + 1}`,
          text: `Mara advances through gate moment ${index + 1}.`,
          speaker: 'Mara',
        })),
      } as any],
      encounters: new Map(),
    });

    expect(result.beatImages.size).toBe(9);
    expect(result.diagnostics.imageCompleteness.complete).toBe(true);
    expect(result.diagnostics.requiredSlotFailures).toEqual([]);
    expect(result.diagnostics.failedSlots).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ slotId: expect.stringContaining('story-beat:episode-1-scene-1') }),
    ]));
    expect(result.diagnostics.advisoryQaWarnings).toEqual(expect.arrayContaining([
      expect.objectContaining({
        identifier: 'sheets/storyboard-v2-episode-1-scene-1-sheet-1',
        stage: 'sheet',
        issues: ['panel_border_leakage'],
      }),
    ]));
    expect(prompts.some((call) => call.identifier.includes('qa-regenerate-2'))).toBe(false);

    const summary = JSON.parse(await fs.readFile(`${outputDirectory}images/storyboard-v2/summary.json`, 'utf8'));
    expect(summary.imageCompleteness.complete).toBe(true);
    expect(summary.advisoryQaWarnings[0].issues).toEqual(['panel_border_leakage']);
  });

  it('sanitizes style-fighting story language and records prompt audit diffs', async () => {
    const prompts: any[] = [];
    const outputDirectory = `${await fs.mkdtemp(path.join(os.tmpdir(), 'storyboard-v2-'))}/`;
    const mockImageService = await makeMockImageService(outputDirectory, prompts);
    const pipeline = new StoryboardV2Pipeline({
      config: baseConfig,
      imageService: mockImageService as any,
      assetRegistry: new AssetRegistry('test'),
      outputDirectory,
    });

    await pipeline.generateEpisode({
      brief: {
        story: { title: 'Test Story', genre: 'fantasy', tone: 'ominous cinematic' },
        episode: { number: 1, title: 'Pilot' },
        protagonist: { id: 'hero', name: 'Mara' },
      },
      characterBible: {
        characters: [{
          id: 'char-erosalex-kiriakis',
          name: 'Eros/Alex Kiriakis',
          role: 'love-interest',
          importance: 'major',
          overview: 'A charming offscreen presence.',
          physicalDescription: 'golden skin and warm hands',
          typicalAttire: 'white shirt',
          distinctiveFeatures: ['shifting eyes'],
        }, {
          id: 'hero',
          name: 'Mara',
          role: 'protagonist',
          importance: 'major',
          overview: 'A worried scout.',
          physicalDescription: 'short silver hair and brown skin',
          typicalAttire: 'high fashion gray cloak',
          distinctiveFeatures: ['scar through eyebrow'],
        }],
      } as any,
      sceneContents: [{
        sceneId: 'scene-1',
        sceneName: 'Gate',
        startingBeatId: 'b1',
        charactersInvolved: ['hero', 'char-erosalex-kiriakis'],
        mood: 'photoreal cinematic dread',
        beats: [{
          id: 'b1',
          text: 'Mara crosses a photoreal cinematic courtyard while Alex reads the gesture nearby.',
          speaker: 'Mara',
          primaryAction: 'moves through lens blur and bokeh',
        }],
      } as any],
      encounters: new Map(),
    });

    const sheetCall = prompts.find((call) => call.identifier.includes('sheets/storyboard-v2-'));
    expect(sheetCall.prompt.prompt).not.toContain('photoreal cinematic courtyard');
    expect(sheetCall.prompt.prompt).not.toContain('lens blur');
    expect(sheetCall.prompt.prompt).not.toContain('bokeh');
    expect(sheetCall.prompt.prompt).toContain('Alex reads');
    expect(sheetCall.prompt.prompt).toContain('Eros/Alex Kiriakis (char-erosalex-kiriakis)');
    const audits = JSON.parse(await fs.readFile(`${outputDirectory}images/storyboard-v2/prompt-audits.json`, 'utf8'));
    expect(JSON.stringify(audits.audits)).toContain('photoreal');
    expect(JSON.stringify(audits.audits)).toContain('cinematic');
  });

  it('retries final refinement when duplicate-character QA blocks a panel', async () => {
    const prompts: any[] = [];
    const outputDirectory = `${await fs.mkdtemp(path.join(os.tmpdir(), 'storyboard-v2-'))}/`;
    const mockImageService = await makeMockImageService(outputDirectory, prompts, [
      { passed: true, issues: [], reason: 'sheet clean' },
      { passed: false, issues: ['duplicate_body'], reason: 'same intended character appears twice' },
      { passed: true, issues: [], reason: 'clean retry' },
    ]);
    const pipeline = new StoryboardV2Pipeline({
      config: baseConfig,
      imageService: mockImageService as any,
      assetRegistry: new AssetRegistry('test'),
      outputDirectory,
    });

    await pipeline.generateEpisode({
      brief: {
        story: { title: 'Test Story', genre: 'fantasy', tone: 'ominous' },
        episode: { number: 1, title: 'Pilot' },
        protagonist: { id: 'hero', name: 'Mara' },
      },
      characterBible: {
        characters: [{
          id: 'hero',
          name: 'Mara',
          role: 'protagonist',
          importance: 'major',
          overview: 'A worried scout.',
          physicalDescription: 'short silver hair and brown skin',
          typicalAttire: 'gray cloak',
          distinctiveFeatures: ['scar through eyebrow'],
        }],
      } as any,
      sceneContents: [{
        sceneId: 'scene-1',
        sceneName: 'Gate',
        startingBeatId: 'b1',
        charactersInvolved: ['hero', 'alex'],
        beats: [{ id: 'b1', text: 'Mara pushes open the gate.', speaker: 'Mara' }],
      } as any],
      encounters: new Map(),
    });

    const retryCall = prompts.find((call) => call.identifier.includes('duplicate-character-retry'));
    expect(retryCall).toBeTruthy();
    expect(retryCall.prompt.prompt).toContain('same intended character');
    expect(retryCall.refs.map((ref: any) => ref.role)).toEqual([
      'storyboard-panel-crop',
      'character-reference',
      'episode-style-lock',
    ]);
  });

  it('treats duplicate-body QA as advisory for unnamed crowd panels around one canonical character', async () => {
    const prompts: any[] = [];
    const outputDirectory = `${await fs.mkdtemp(path.join(os.tmpdir(), 'storyboard-v2-'))}/`;
    const mockImageService = await makeMockImageService(outputDirectory, prompts, [
      { passed: true, issues: [], reason: 'sheet clean' },
      { passed: false, issues: ['duplicate_body'], reason: 'unnamed dancers resemble the hero' },
    ]);
    const registry = new AssetRegistry('test');
    const pipeline = new StoryboardV2Pipeline({
      config: baseConfig,
      imageService: mockImageService as any,
      assetRegistry: registry,
      outputDirectory,
    });

    await pipeline.generateEpisode({
      brief: {
        story: { title: 'Test Story', genre: 'fantasy', tone: 'ominous' },
        episode: { number: 1, title: 'Pilot' },
        protagonist: { id: 'hero', name: 'Mara' },
      },
      characterBible: {
        characters: [{
          id: 'hero',
          name: 'Mara',
          role: 'protagonist',
          importance: 'major',
          overview: 'A worried scout.',
          physicalDescription: 'short silver hair and brown skin',
          typicalAttire: 'gray cloak',
          distinctiveFeatures: ['scar through eyebrow'],
        }],
      } as any,
      sceneContents: [{
        sceneId: 'scene-1',
        sceneName: 'Gate',
        startingBeatId: 'b1',
        charactersInvolved: ['hero'],
        beats: [{
          id: 'b1',
          text: 'Dancers gather around Mara in a loose circle.',
          speaker: 'Mara',
          visualMoment: 'A circle of unnamed dancers surrounds Mara while the crowd moves in rhythm',
          primaryAction: 'Dancers gather around Mara',
          mustShowDetail: 'circle of dancers',
        }],
      } as any],
      encounters: new Map(),
    });

    expect(prompts.some((call) => call.identifier.includes('duplicate-character-retry'))).toBe(false);
    const record = registry.get('story-beat:episode-1-scene-1::b1');
    expect(record?.status).toBe('succeeded');
    const sheetManifest = JSON.parse(await fs.readFile(`${outputDirectory}images/storyboard-v2/sheet-manifest.json`, 'utf8'));
    const crop = sheetManifest.sheets[0].crops[0];
    expect(crop.finalImagePath).toContain('images/storyboard-v2/panels/');
    expect(crop.panelQa.final.passed).toBe(true);
    expect(crop.panelQa.final.advisoryIssues).toContain('duplicate_body');
  });

  it('repairs style-only storyboard sheet QA failures with image edit before cropping', async () => {
    const prompts: any[] = [];
    const outputDirectory = `${await fs.mkdtemp(path.join(os.tmpdir(), 'storyboard-v2-'))}/`;
    const mockImageService = await makeMockImageService(outputDirectory, prompts, [
      { passed: false, issues: ['style_drift'], reason: 'rendering language does not match the declared style' },
      { passed: true, issues: [], reason: 'style repaired' },
      { passed: true, issues: [], reason: 'panel clean' },
    ]);
    const pipeline = new StoryboardV2Pipeline({
      config: baseConfig,
      imageService: mockImageService as any,
      assetRegistry: new AssetRegistry('test'),
      outputDirectory,
    });

    await pipeline.generateEpisode({
      brief: {
        story: { title: 'Test Story', genre: 'fantasy', tone: 'ominous' },
        episode: { number: 1, title: 'Pilot' },
        protagonist: { id: 'hero', name: 'Mara' },
      },
      characterBible: {
        characters: [{
          id: 'hero',
          name: 'Mara',
          role: 'protagonist',
          importance: 'major',
          overview: 'A worried scout.',
          physicalDescription: 'short silver hair and brown skin',
          typicalAttire: 'gray cloak',
          distinctiveFeatures: ['scar through eyebrow'],
        }],
      } as any,
      sceneContents: [{
        sceneId: 'scene-1',
        sceneName: 'Gate',
        startingBeatId: 'b1',
        charactersInvolved: ['hero'],
        beats: [{ id: 'b1', text: 'Mara pushes open the gate.', speaker: 'Mara' }],
      } as any],
      encounters: new Map(),
    });

    const repairCall = prompts.find((call) => call.identifier.includes('style-repair-2'));
    expect(repairCall).toBeTruthy();
    expect(repairCall.metadata.renderRoute).toBe('storyboard-sheet-style-edit-repair');
    expect(repairCall.prompt.prompt).toContain('Repair only these QA deviations');
    expect(repairCall.refs.map((ref: any) => ref.role)).toEqual([
      'composition-reference',
      'character-reference',
      'episode-style-lock',
    ]);

    const sheetManifest = JSON.parse(await fs.readFile(`${outputDirectory}images/storyboard-v2/sheet-manifest.json`, 'utf8'));
    expect(sheetManifest.sheets[0].sheetQa.repairMode).toBe('edit');
    expect(sheetManifest.sheets[0].sheetQa.final.passed).toBe(true);
  });

  it('regenerates storyboard sheets for structural QA failures before cropping', async () => {
    const prompts: any[] = [];
    const outputDirectory = `${await fs.mkdtemp(path.join(os.tmpdir(), 'storyboard-v2-'))}/`;
    const mockImageService = await makeMockImageService(outputDirectory, prompts, [
      { passed: false, issues: ['visible_text'], reason: 'panel labels are visible' },
      { passed: true, issues: [], reason: 'regenerated clean' },
      { passed: true, issues: [], reason: 'panel clean' },
    ]);
    const pipeline = new StoryboardV2Pipeline({
      config: baseConfig,
      imageService: mockImageService as any,
      assetRegistry: new AssetRegistry('test'),
      outputDirectory,
    });

    await pipeline.generateEpisode({
      brief: {
        story: { title: 'Test Story', genre: 'fantasy', tone: 'ominous' },
        episode: { number: 1, title: 'Pilot' },
        protagonist: { id: 'hero', name: 'Mara' },
      },
      characterBible: {
        characters: [{
          id: 'hero',
          name: 'Mara',
          role: 'protagonist',
          importance: 'major',
          overview: 'A worried scout.',
          physicalDescription: 'short silver hair and brown skin',
          typicalAttire: 'gray cloak',
          distinctiveFeatures: ['scar through eyebrow'],
        }],
      } as any,
      sceneContents: [{
        sceneId: 'scene-1',
        sceneName: 'Gate',
        startingBeatId: 'b1',
        charactersInvolved: ['hero'],
        beats: [{ id: 'b1', text: 'Mara pushes open the gate.', speaker: 'Mara' }],
      } as any],
      encounters: new Map(),
    });

    const regenCall = prompts.find((call) => call.identifier.includes('qa-regenerate-2'));
    expect(regenCall).toBeTruthy();
    expect(regenCall.metadata.renderRoute).toBe('storyboard-sheet-qa-regenerate');
    expect(regenCall.prompt.prompt).toContain('Replace every readable phone screen');
    expect(regenCall.prompt.prompt).toContain('PHONE / SCREEN POLICY');
    expect(regenCall.prompt.prompt).toContain('WARDROBE / IDENTITY POLICY');
    expect(regenCall.prompt.negativePrompt).toContain('readable phone UI');
    expect(regenCall.refs.map((ref: any) => ref.role)).toEqual([
      'character-reference',
      'episode-style-lock',
    ]);
  });

  it('continues to derive panels when repaired sheet QA remains unresolved', async () => {
    const prompts: any[] = [];
    const outputDirectory = `${await fs.mkdtemp(path.join(os.tmpdir(), 'storyboard-v2-'))}/`;
    const mockImageService = await makeMockImageService(outputDirectory, prompts, [
      { passed: false, issues: ['visible_text'], reason: 'laptop text is readable' },
      { passed: false, issues: ['visible_text'], reason: 'one screen still has readable text' },
      { passed: true, issues: [], reason: 'panel clean' },
    ]);
    const registry = new AssetRegistry('test');
    const pipeline = new StoryboardV2Pipeline({
      config: baseConfig,
      imageService: mockImageService as any,
      assetRegistry: registry,
      outputDirectory,
    });

    const result = await pipeline.generateEpisode({
      brief: {
        story: { title: 'Test Story', genre: 'fantasy', tone: 'ominous' },
        episode: { number: 1, title: 'Pilot' },
        protagonist: { id: 'hero', name: 'Mara' },
      },
      characterBible: {
        characters: [{
          id: 'hero',
          name: 'Mara',
          role: 'protagonist',
          importance: 'major',
          overview: 'A worried scout.',
          physicalDescription: 'short silver hair and brown skin',
          typicalAttire: 'gray cloak',
          distinctiveFeatures: ['scar through eyebrow'],
        }],
      } as any,
      sceneContents: [{
        sceneId: 'scene-1',
        sceneName: 'Desk',
        startingBeatId: 'b1',
        charactersInvolved: ['hero'],
        beats: [{ id: 'b1', text: 'Mara writes beside the cold lamp.', speaker: 'Mara' }],
      } as any],
      encounters: new Map(),
    });

    expect(result.beatImages.get('episode-1-scene-1::b1')).toBeTruthy();
    expect(registry.get('story-beat:episode-1-scene-1::b1')?.status).toBe('succeeded');
    expect(result.diagnostics.failedSlots).toEqual(expect.arrayContaining([
      expect.objectContaining({
        slotId: 'episode-1-scene-1-sheet-1',
        error: expect.stringContaining('Storyboard sheet QA failed after regenerate repair'),
      }),
    ]));
  });

  it('keeps sheet character QA advisory while final panel character QA remains blocking', async () => {
    const prompts: any[] = [];
    const outputDirectory = `${await fs.mkdtemp(path.join(os.tmpdir(), 'storyboard-v2-'))}/`;
    const mockImageService = await makeMockImageService(outputDirectory, prompts, [
      { passed: false, issues: ['extra_limbs'], reason: 'sheet-level identity concern' },
      { passed: false, issues: ['extra_limbs'], reason: 'final panel identity drift' },
      { passed: true, issues: [], reason: 'panel repaired' },
    ]);
    const pipeline = new StoryboardV2Pipeline({
      config: baseConfig,
      imageService: mockImageService as any,
      assetRegistry: new AssetRegistry('test'),
      outputDirectory,
    });

    const result = await pipeline.generateEpisode({
      brief: {
        story: { title: 'Test Story', genre: 'fantasy', tone: 'ominous' },
        episode: { number: 1, title: 'Pilot' },
        protagonist: { id: 'hero', name: 'Mara' },
      },
      characterBible: {
        characters: [{
          id: 'hero',
          name: 'Mara',
          role: 'protagonist',
          importance: 'major',
          overview: 'A worried scout.',
          physicalDescription: 'short silver hair and brown skin',
          typicalAttire: 'gray cloak',
          distinctiveFeatures: ['scar through eyebrow'],
        }],
      } as any,
      sceneContents: [{
        sceneId: 'scene-1',
        sceneName: 'Gate',
        startingBeatId: 'b1',
        charactersInvolved: ['hero'],
        beats: [{ id: 'b1', text: 'Mara pushes open the gate.', speaker: 'Mara' }],
      } as any],
      encounters: new Map(),
    });

    expect(prompts.some((call) => call.identifier.includes('sheets/') && call.identifier.includes('qa-regenerate-2'))).toBe(false);
    const panelRetry = prompts.find((call) => call.identifier.includes('panels/') && call.identifier.includes('qa-regenerate-2'));
    expect(panelRetry).toBeTruthy();
    expect(result.diagnostics.advisoryQaWarnings).toEqual(expect.arrayContaining([
      expect.objectContaining({
        identifier: 'sheets/storyboard-v2-episode-1-scene-1-sheet-1',
        stage: 'sheet',
        issues: ['character_identity_drift'],
      }),
    ]));
    expect(result.diagnostics.failedSlots).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ slotId: 'story-beat:episode-1-scene-1::b1' }),
    ]));
    expect(result.diagnostics.imageCompleteness.complete).toBe(true);
  });

  it('repairs style-only final panel QA failures with the panel image plus crop refs', async () => {
    const prompts: any[] = [];
    const outputDirectory = `${await fs.mkdtemp(path.join(os.tmpdir(), 'storyboard-v2-'))}/`;
    const mockImageService = await makeMockImageService(outputDirectory, prompts, [
      { passed: true, issues: [], reason: 'sheet clean' },
      { passed: false, issues: ['style_drift'], reason: 'panel rendering language drifts from declared style' },
      { passed: true, issues: [], reason: 'panel repaired' },
    ]);
    const pipeline = new StoryboardV2Pipeline({
      config: baseConfig,
      imageService: mockImageService as any,
      assetRegistry: new AssetRegistry('test'),
      outputDirectory,
    });

    await pipeline.generateEpisode({
      brief: {
        story: { title: 'Test Story', genre: 'fantasy', tone: 'ominous' },
        episode: { number: 1, title: 'Pilot' },
        protagonist: { id: 'hero', name: 'Mara' },
      },
      characterBible: {
        characters: [{
          id: 'hero',
          name: 'Mara',
          role: 'protagonist',
          importance: 'major',
          overview: 'A worried scout.',
          physicalDescription: 'short silver hair and brown skin',
          typicalAttire: 'gray cloak',
          distinctiveFeatures: ['scar through eyebrow'],
        }],
      } as any,
      sceneContents: [{
        sceneId: 'scene-1',
        sceneName: 'Gate',
        startingBeatId: 'b1',
        charactersInvolved: ['hero'],
        beats: [{ id: 'b1', text: 'Mara pushes open the gate.', speaker: 'Mara' }],
      } as any],
      encounters: new Map(),
    });

    const repairCall = prompts.find((call) => call.identifier.includes('panels/') && call.identifier.includes('style-repair'));
    expect(repairCall).toBeTruthy();
    expect(repairCall.metadata.renderRoute).toBe('storyboard-sheet-crop-refine-style-edit-repair');
    expect(repairCall.refs.map((ref: any) => ref.role)).toEqual([
      'composition-reference',
      'storyboard-panel-crop',
      'character-reference',
      'episode-style-lock',
    ]);
  });
});
