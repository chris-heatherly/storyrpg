import { describe, expect, it } from 'vitest';

import type { ArtStyleProfile } from './artStyleProfile';
import type { StableDiffusionSettings } from '../config';
import type { LoraArtifact } from '../services/lora-training/LoraTrainerAdapter';
import {
  computeCharacterLoraFingerprint,
  computeStyleLoraFingerprint,
  emptySnapshot,
  LoraRegistry,
  type LoraRegistryIO,
  mergeIntoStableDiffusionSettings,
} from './loraRegistry';

const STYLE: ArtStyleProfile = {
  name: 'graphic novel ink',
  family: 'comic',
  renderingTechnique: 'uniform line weight inked panels',
  colorPhilosophy: 'flat primaries',
  lightingApproach: 'graphic color-as-light',
  lineWeight: 'uniform clean line',
  compositionStyle: 'tableau clarity',
  moodRange: 'adventurous',
  acceptableDeviations: [],
  genreNegatives: [],
  positiveVocabulary: ['ligne claire', 'clean line'],
  inappropriateVocabulary: [],
};

describe('fingerprinting', () => {
  it('character fingerprints are stable across equivalent inputs', () => {
    const a = computeCharacterLoraFingerprint({
      characterId: 'hero',
      name: 'Hero',
      identityFingerprint: 'abc',
      hyperparameters: { rank: 32, steps: 1500 },
    });
    const b = computeCharacterLoraFingerprint({
      characterId: 'hero',
      name: 'Hero',
      identityFingerprint: 'abc',
      hyperparameters: { rank: 32, steps: 1500 },
    });
    expect(a).toBe(b);
  });

  it('character fingerprints change when identity changes', () => {
    const a = computeCharacterLoraFingerprint({
      characterId: 'hero',
      name: 'Hero',
      identityFingerprint: 'abc',
    });
    const b = computeCharacterLoraFingerprint({
      characterId: 'hero',
      name: 'Hero',
      identityFingerprint: 'xyz',
    });
    expect(a).not.toBe(b);
  });

  it('style fingerprints are stable against anchor hash reordering', () => {
    const a = computeStyleLoraFingerprint({
      profile: STYLE,
      anchorHashes: ['aaa', 'bbb', 'ccc'],
      hyperparameters: { rank: 32 },
    });
    const b = computeStyleLoraFingerprint({
      profile: STYLE,
      anchorHashes: ['ccc', 'bbb', 'aaa'],
      hyperparameters: { rank: 32 },
    });
    expect(a).toBe(b);
  });

  it('style fingerprints differ when the style profile differs', () => {
    const other: ArtStyleProfile = { ...STYLE, name: 'watercolor illustration', family: 'watercolor' };
    expect(
      computeStyleLoraFingerprint({ profile: STYLE, anchorHashes: ['a'] }),
    ).not.toBe(computeStyleLoraFingerprint({ profile: other, anchorHashes: ['a'] }));
  });
});

describe('mergeIntoStableDiffusionSettings', () => {
  it('adds trained character LoRAs keyed by character name', () => {
    const snapshot = {
      storyId: 's1',
      records: {
        char_hero_abcd: {
          name: 'char_hero_abcd',
          kind: 'character' as const,
          fingerprint: 'fp1',
          characterName: 'Hero',
          filePath: '/tmp/char_hero_abcd.safetensors',
          createdAt: '2030-01-01T00:00:00Z',
          weight: 0.9,
        },
      },
    };
    const merged = mergeIntoStableDiffusionSettings(undefined, snapshot);
    expect(merged.characterLoraByName?.['Hero']).toEqual({ name: 'char_hero_abcd', weight: 0.9 });
  });

  it('appends style LoRAs without overwriting UI-provided ones', () => {
    const base: StableDiffusionSettings = {
      styleLoras: [{ name: 'studio_ghibli', weight: 0.7 }],
    };
    const snapshot = {
      storyId: 's1',
      records: {
        style_graphic_novel_ink: {
          name: 'style_graphic_novel_ink',
          kind: 'style' as const,
          fingerprint: 'fp',
          filePath: '/tmp/style.safetensors',
          createdAt: '2030-01-01T00:00:00Z',
        },
      },
    };
    const merged = mergeIntoStableDiffusionSettings(base, snapshot);
    expect(merged.styleLoras?.map((l) => l.name)).toEqual([
      'studio_ghibli',
      'style_graphic_novel_ink',
    ]);
  });

  it('does not override existing characterLoraByName entries', () => {
    const base: StableDiffusionSettings = {
      characterLoraByName: { Hero: { name: 'manual_hero', weight: 0.5 } },
    };
    const snapshot = {
      storyId: 's1',
      records: {
        char_hero_abcd: {
          name: 'char_hero_abcd',
          kind: 'character' as const,
          fingerprint: 'fp',
          characterName: 'Hero',
          filePath: '/tmp/char.safetensors',
          createdAt: '2030-01-01T00:00:00Z',
        },
      },
    };
    const merged = mergeIntoStableDiffusionSettings(base, snapshot);
    expect(merged.characterLoraByName?.['Hero']).toEqual({ name: 'manual_hero', weight: 0.5 });
  });
});

function makeMemoryIO(): { io: LoraRegistryIO; files: Map<string, string> } {
  const files = new Map<string, string>();
  const io: LoraRegistryIO = {
    async ensureDir() {},
    async writeBytes(filePath, base64) {
      files.set(filePath, `__bytes__:${base64}`);
    },
    async writeText(filePath, text) {
      files.set(filePath, text);
    },
    async readText(filePath) {
      return files.get(filePath);
    },
    async exists(filePath) {
      return files.has(filePath);
    },
    async listDir(dirPath) {
      const out: string[] = [];
      for (const key of files.keys()) {
        if (!key.startsWith(`${dirPath}/`)) continue;
        const rest = key.slice(dirPath.length + 1);
        if (rest.includes('/')) continue;
        out.push(rest);
      }
      return out;
    },
    async remove(filePath) {
      files.delete(filePath);
    },
    joinPath: (base, ...parts) => [base, ...parts].join('/'),
  };
  return { io, files };
}

describe('LoraRegistry', () => {
  it('registers artifacts and reloads them via load()', async () => {
    const { io, files } = makeMemoryIO();
    const registry = new LoraRegistry('story-1', '/tmp/story-1/loras', io);

    const artifact: LoraArtifact = {
      name: 'char_hero_abcd',
      kind: 'character',
      fingerprint: 'fp1',
      storyId: 'story-1',
      data: 'QUJDRA==',
    };
    await registry.register(artifact, { characterName: 'Hero', trainerId: 'kohya' });

    expect(files.get('/tmp/story-1/loras/character/char_hero_abcd.safetensors')).toBe('__bytes__:QUJDRA==');
    const meta = files.get('/tmp/story-1/loras/character/char_hero_abcd.meta.json');
    expect(meta).toBeTruthy();
    expect(JSON.parse(meta!).characterName).toBe('Hero');

    const reloaded = new LoraRegistry('story-1', '/tmp/story-1/loras', io);
    const snapshot = await reloaded.load();
    expect(Object.keys(snapshot.records)).toEqual(['char_hero_abcd']);
    expect(reloaded.findByCharacterName('Hero')?.name).toBe('char_hero_abcd');
  });

  it('prune() removes records whose fingerprints are no longer valid', async () => {
    const { io, files } = makeMemoryIO();
    const registry = new LoraRegistry('story-1', '/tmp/story-1/loras', io);
    await registry.register(
      { name: 'char_a', kind: 'character', fingerprint: 'fp1', storyId: 'story-1', data: 'AAA=' },
      { characterName: 'A' },
    );
    await registry.register(
      { name: 'char_b', kind: 'character', fingerprint: 'fp2', storyId: 'story-1', data: 'BBB=' },
      { characterName: 'B' },
    );

    const removed = await registry.prune(new Set(['fp1']));
    expect(removed.map((r) => r.name)).toEqual(['char_b']);
    expect(files.has('/tmp/story-1/loras/character/char_b.safetensors')).toBe(false);
    expect(files.has('/tmp/story-1/loras/character/char_b.meta.json')).toBe(false);
    expect(registry.findByFingerprint('fp1')).toBeDefined();
    expect(registry.findByFingerprint('fp2')).toBeUndefined();
  });

  it('mergeIntoStableDiffusionSettings exposes registered records', async () => {
    const { io } = makeMemoryIO();
    const registry = new LoraRegistry('story-1', '/tmp/story-1/loras', io);
    await registry.register(
      { name: 'style_foo', kind: 'style', fingerprint: 'fp-s', storyId: 'story-1', data: 'S' },
      { styleName: 'foo' },
    );
    const settings = registry.mergeIntoStableDiffusionSettings(undefined);
    expect(settings.styleLoras).toEqual([{ name: 'style_foo', weight: 0.8 }]);
  });

  it('emptySnapshot yields an empty records map', () => {
    const s = emptySnapshot('story-1');
    expect(s.records).toEqual({});
    expect(s.storyId).toBe('story-1');
  });
});
