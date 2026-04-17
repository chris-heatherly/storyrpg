import { describe, expect, it } from 'vitest';

import type { ArtStyleProfile } from './artStyleProfile';
import {
  buildCharacterDataset,
  buildStyleDataset,
  buildTriggerToken,
  collectCharacterReferences,
  deriveLoraName,
  preapprovedAnchorToDataset,
  type DatasetCharacterReference,
} from './datasetBuilder';

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

describe('deriveLoraName', () => {
  it('slugs the seed and prefixes by kind', () => {
    expect(deriveLoraName('character', 'Tara Vale')).toBe('char_tara_vale');
    expect(deriveLoraName('style', 'graphic novel ink!!')).toBe('style_graphic_novel_ink');
  });

  it('handles empty seeds', () => {
    expect(deriveLoraName('character', '---')).toBe('char_unnamed');
  });
});

describe('buildTriggerToken', () => {
  it('embeds a short fingerprint', () => {
    expect(buildTriggerToken('hero', 'abcdef1234567890')).toBe('hero_abcdef12');
  });
  it('falls back to name-only when fingerprint is empty', () => {
    expect(buildTriggerToken('hero', '')).toBe('hero');
  });
});

describe('buildCharacterDataset', () => {
  const refs: DatasetCharacterReference[] = [
    { viewKey: 'front', imagePath: '/tmp/hero/front.png', mimeType: 'image/png' },
    { viewKey: 'three_quarter', imagePath: '/tmp/hero/3q.png' },
    { viewKey: 'profile', imagePath: '/tmp/hero/profile.png' },
    // Inline-only should be dropped — trainer needs a filesystem path.
    { viewKey: 'back', data: 'BASE64', mimeType: 'image/png' },
    // Expression
    { viewKey: 'expression-happy', imagePath: '/tmp/hero/happy.png' },
  ];

  it('emits one training image per ref that has a path', () => {
    const dataset = buildCharacterDataset({
      character: {
        name: 'Hero',
        role: 'major',
        physicalDescription: 'tall with auburn hair',
        distinctiveFeatures: ['crescent scar', 'green eyes'],
        typicalAttire: 'leather long coat',
      },
      trigger: 'hero_abcdef12',
      references: refs,
      style: STYLE,
    });
    expect(dataset).toHaveLength(4);
    expect(dataset.map((d) => d.path)).toEqual([
      '/tmp/hero/front.png',
      '/tmp/hero/3q.png',
      '/tmp/hero/profile.png',
      '/tmp/hero/happy.png',
    ]);
  });

  it('leads every caption with the trigger token and identity anchors', () => {
    const dataset = buildCharacterDataset({
      character: {
        name: 'Hero',
        physicalDescription: 'tall with auburn hair',
        distinctiveFeatures: ['crescent scar'],
        typicalAttire: 'leather long coat',
      },
      trigger: 'hero_abcdef12',
      references: refs,
      style: STYLE,
    });
    for (const image of dataset) {
      expect(image.caption?.startsWith('hero_abcdef12')).toBe(true);
      expect(image.caption).toMatch(/tall with auburn hair/);
      expect(image.caption).toMatch(/crescent scar/);
      expect(image.caption).toMatch(/leather long coat/);
      expect(image.caption).toMatch(/graphic novel ink/);
    }
  });

  it('differentiates view types in captions', () => {
    const dataset = buildCharacterDataset({
      character: { name: 'Hero' },
      trigger: 'hero',
      references: refs,
      style: STYLE,
    });
    const captions = dataset.map((d) => d.caption || '');
    expect(captions[0]).toMatch(/front view/);
    expect(captions[1]).toMatch(/three quarter view/);
    expect(captions[3]).toMatch(/happy expression/);
  });

  it('dedupes repeated caption fragments', () => {
    const dataset = buildCharacterDataset({
      character: { name: 'Hero', physicalDescription: 'hero_abcdef12' },
      trigger: 'hero_abcdef12',
      references: [refs[0]],
      style: STYLE,
    });
    const caption = dataset[0].caption || '';
    const hits = caption.match(/hero_abcdef12/g) || [];
    expect(hits).toHaveLength(1);
  });
});

describe('buildStyleDataset', () => {
  it('produces trigger-led captions with style DNA appended', () => {
    const dataset = buildStyleDataset({
      style: STYLE,
      trigger: 'style_graphic_novel',
      anchors: [
        { role: 'character', imagePath: '/tmp/style/character.png' },
        { role: 'arcStrip', imagePath: '/tmp/style/arc.png' },
        { role: 'environment', data: 'INLINE', mimeType: 'image/png' },
      ],
      additional: [{ role: 'beat-1-1', imagePath: '/tmp/style/beat.png' }],
    });
    expect(dataset).toHaveLength(3);
    expect(dataset[0].caption?.startsWith('style_graphic_novel, character,')).toBe(true);
    expect(dataset[0].caption).toMatch(/uniform line weight inked panels/);
    expect(dataset[0].caption).toMatch(/ligne claire/);
    expect(dataset.map((d) => d.path)).toEqual([
      '/tmp/style/character.png',
      '/tmp/style/arc.png',
      '/tmp/style/beat.png',
    ]);
  });
});

describe('collectCharacterReferences', () => {
  it('copies viewType keys and preserves paths', () => {
    const images = new Map([
      ['front', { imagePath: '/tmp/front.png', imageData: 'x', mimeType: 'image/png' }],
      ['expression-happy', { imagePath: '/tmp/happy.png', mimeType: 'image/png' }],
      ['broken', { imageData: '', mimeType: 'image/png' }],
    ]);
    const refs = collectCharacterReferences(images as any);
    expect(refs).toHaveLength(2);
    expect(refs[0].viewKey).toBe('front');
    expect(refs[1].imagePath).toBe('/tmp/happy.png');
  });
});

describe('preapprovedAnchorToDataset', () => {
  it('returns undefined when neither data nor path are set', () => {
    expect(preapprovedAnchorToDataset('character', undefined)).toBeUndefined();
    expect(preapprovedAnchorToDataset('character', {})).toBeUndefined();
  });
  it('preserves the role and path', () => {
    expect(
      preapprovedAnchorToDataset('arcStrip', { imagePath: '/tmp/a.png', mimeType: 'image/png' }),
    ).toEqual({ role: 'arcStrip', imagePath: '/tmp/a.png', data: undefined, mimeType: 'image/png' });
  });
});
