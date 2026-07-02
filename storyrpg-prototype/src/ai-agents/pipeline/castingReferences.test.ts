import { describe, expect, it } from 'vitest';
import { CastingReferences, type CastingReferencesDeps } from './castingReferences';
import type { CharacterBible } from '../agents/CharacterDesigner';

const characterBible = {
  characters: [
    {
      id: 'char-mara',
      name: 'Mara Voss',
      role: 'protagonist',
      physicalDescription: 'Short silver hair and sharp green eyes',
      distinctiveFeatures: ['burn scar on left forearm'],
      typicalAttire: 'worn leather duster',
      traits: ['confident', 'bold'],
      overview: 'A brash smuggler.',
    },
  ],
} as unknown as CharacterBible;

function makeService(overrides?: {
  visualAnchors?: string[];
  characterReferences?: Map<string, any>;
}) {
  const deps: CastingReferencesDeps = {
    imageService: () => ({
      getGeminiSettings: () => ({}),
      getMidjourneySettings: () => ({}),
    }) as any,
    imageAgentTeam: () => ({
      getCharacterSilhouetteProfile: () => undefined,
      getCharacterConsistencyInfo: () => (overrides?.visualAnchors ? { visualAnchors: overrides.visualAnchors } : undefined),
      getCharacterReferenceImages: () => [],
      getCompositeReferenceImage: () => undefined,
    }) as any,
    characterReferences: () => overrides?.characterReferences ?? new Map(),
    locationMasterShots: () => new Map(),
    styleAnchorPaths: () => ({}),
    uploadedStyleReferenceImages: () => [],
    shouldAttachCompositeCharacterRefs: () => false,
    emit: () => {},
  };
  return new CastingReferences(deps);
}

describe('buildCharacterDescriptions', () => {
  it('falls back to physicalDescription and structures canonical appearance', () => {
    const [desc] = makeService().buildCharacterDescriptions(['char-mara'], characterBible);
    expect(desc.name).toBe('Mara Voss');
    expect(desc.appearance).toContain('silver hair');
    expect(desc.appearance).toContain('Distinctive features: burn scar on left forearm');
    expect(desc.appearance).toContain('Attire: worn leather duster');
    expect(desc.canonicalAppearance?.hair).toContain('silver hair');
    expect(desc.canonicalAppearance?.distinguishingMarks).toEqual(['burn scar on left forearm']);
  });

  it('prefers visual anchors over physicalDescription when present', () => {
    const [desc] = makeService({ visualAnchors: ['copper bob, amber eyes'] })
      .buildCharacterDescriptions(['char-mara'], characterBible);
    expect(desc.appearance.startsWith('copper bob, amber eyes')).toBe(true);
  });
});

describe('gatherCharacterBodyVocabularies', () => {
  it('uses the collected body vocabulary when available', () => {
    const characterReferences = new Map([
      ['char-mara', {
        characterName: 'Mara Voss',
        bodyVocabulary: {
          basePosture: { description: 'coiled, ready stance' },
          gestureStyle: 'clipped, economical',
          signaturePoses: [{ poseDescription: 'thumb hooked in belt' }],
          statusDefaults: { withSuperiors: 'wary' },
          stressTells: ['jaw tightens'],
          comfortTells: [],
        },
      }],
    ]);
    const [vocab] = makeService({ characterReferences }).gatherCharacterBodyVocabularies(['char-mara'], characterBible);
    expect(vocab.basePosture).toBe('coiled, ready stance');
    expect(vocab.gestureStyle).toBe('clipped, economical');
    expect(vocab.characteristicPoses).toEqual(['thumb hooked in belt']);
    expect(vocab.statusBehavior).toContain('with superiors: wary');
    expect(vocab.emotionalTells).toContain('stress: jaw tightens');
  });

  it('falls back to personality inference when no vocabulary is collected', () => {
    const [vocab] = makeService().gatherCharacterBodyVocabularies(['char-mara'], characterBible);
    expect(vocab.characterName).toBe('Mara Voss');
    expect(vocab.basePosture).toContain('upright'); // confident/bold traits
    expect(vocab.statusBehavior).toBe('adapts to social context');
  });
});
