import { describe, it, expect } from 'vitest';
import {
  buildReferencePack,
  filterBranchSafeContinuityRefs,
  filterRefsForProvider,
} from './referencePackBuilder';
import type { ReferenceImage } from '../services/imageGenerationService';

function ref(role: string, opts: Partial<ReferenceImage> = {}): ReferenceImage {
  return {
    data: 'iVBORw0KGgo=',
    mimeType: 'image/png',
    role,
    ...opts,
  };
}

describe('buildReferencePack — composite-sheet handling', () => {
  it('does not count composite-sheet refs against per-character identity slots', () => {
    // When a character provides a composite + two full-body views, the per-
    // character identity cap (`maxPerCharacter`) should still be filled by
    // the two full-body views — the composite must NOT consume an identity
    // slot because it's routed as style/--cref downstream.
    const composite = ref('composite-sheet', { characterName: 'Aoi', viewType: 'composite' });
    const front = ref('character-reference', { characterName: 'Aoi', viewType: 'front' });
    const threeQuarter = ref('character-reference', { characterName: 'Aoi', viewType: 'three-quarter' });
    const profile = ref('character-reference', { characterName: 'Aoi', viewType: 'profile' });

    const pack = buildReferencePack(
      'slot-1',
      'story-scene',
      [composite, front, threeQuarter, profile],
    );

    const identityViews = pack.references.filter(
      (r) => r.role === 'character-reference' && r.characterName === 'Aoi',
    );
    // story-scene.maxPerCharacter = 3 — all three individual views survive
    expect(identityViews).toHaveLength(3);
  });

  it('keeps the composite surviving when slot budget allows', () => {
    // With a small pack, the composite should still make it into the final
    // pack (the per-provider filter will decide how to route it). It just
    // shouldn't be promoted above individual identity views.
    const composite = ref('composite-sheet', { characterName: 'Aoi', viewType: 'composite' });
    const face = ref('character-reference-face', { characterName: 'Aoi' });

    const pack = buildReferencePack(
      'slot-2',
      'story-scene',
      [composite, face],
    );

    // Face always wins priority over composite — verify face is present.
    expect(pack.references.find((r) => r.role === 'character-reference-face')).toBeDefined();
    // Composite may or may not be present depending on budget, but the face
    // must come first in the sorted order.
    const faceIdx = pack.references.findIndex((r) => r.role === 'character-reference-face');
    const compIdx = pack.references.findIndex((r) => r.role === 'composite-sheet');
    if (compIdx !== -1) {
      expect(faceIdx).toBeLessThan(compIdx);
    }
  });

  it('preserves uploaded style anchors in reserved style slots without evicting character identity', () => {
    const styleAnchor = ref('style-anchor', { viewType: 'uploaded-1' });
    const location = ref('location-master-shot', { viewType: 'location' });
    const face = ref('character-reference-face', { characterName: 'Aoi' });
    const front = ref('character-reference', { characterName: 'Aoi', viewType: 'front' });
    const profile = ref('character-reference', { characterName: 'Aoi', viewType: 'profile' });

    const pack = buildReferencePack(
      'slot-3',
      'story-beat',
      [front, profile, location, styleAnchor, face],
    );

    expect(pack.references.find((r) => r.role === 'style-anchor')).toBeDefined();
    expect(pack.references.find((r) => r.role === 'character-reference-face')).toBeDefined();
    expect(pack.references.find((r) => r.role === 'character-reference' && r.viewType === 'front')).toBeDefined();
  });

  it('routes style anchors through provider filters for Gemini/Atlas and Midjourney', () => {
    const styleAnchor = ref('style-anchor', { url: 'https://example.test/style.png' });
    const composite = ref('composite-sheet', { characterName: 'Aoi', viewType: 'composite', url: 'https://example.test/aoi.png' });
    const face = ref('character-reference-face', { characterName: 'Aoi' });
    const refs = [styleAnchor, composite, face];

    expect(filterRefsForProvider(refs, 'nano-banana').refs.find((r) => r.role === 'style-anchor')).toBeDefined();
    expect(filterRefsForProvider(refs, 'atlas-cloud').refs.find((r) => r.role === 'style-anchor')).toBeDefined();

    const midjourneyRefs = filterRefsForProvider(refs, 'midapi').refs;
    expect(midjourneyRefs.map((r) => r.role)).toEqual(['style-anchor', 'composite-sheet']);
  });

  it('keeps one style anchor for OpenAI alongside clean character identity refs', () => {
    const styleAnchor = ref('style-anchor', { url: 'https://example.test/style.png' });
    const face = ref('character-reference-face', { characterName: 'Aoi' });
    const profile = ref('character-reference', { characterName: 'Aoi', viewType: 'profile' });

    const openAiRefs = filterRefsForProvider([profile, styleAnchor, face], 'dall-e').refs;

    expect(openAiRefs.find((r) => r.role === 'style-anchor')).toBeDefined();
    expect(openAiRefs.find((r) => r.role === 'character-reference-face')).toBeDefined();
    expect(openAiRefs.find((r) => r.viewType === 'profile')).toBeUndefined();
  });

  it('keeps storyboard crops for OpenAI crop-refine calls with identity and style refs', () => {
    const crop = ref('storyboard-panel-crop', { viewType: 'draft-crop' });
    const styleLock = ref('episode-style-lock', { viewType: 'style' });
    const daphne = ref('character-reference', {
      characterId: 'char-daphne',
      characterName: 'Daphne',
      viewType: 'front',
    });
    const eros = ref('character-reference', {
      characterId: 'char-eros',
      characterName: 'Eros',
      viewType: 'front',
    });

    const openAiRefs = filterRefsForProvider([crop, daphne, eros, styleLock], 'dall-e').refs;

    expect(openAiRefs.map((r) => r.role)).toEqual([
      'storyboard-panel-crop',
      'character-reference',
      'character-reference',
      'episode-style-lock',
    ]);
  });

  it('drops previous-panel continuity refs from sibling branches', () => {
    const samePath = ref('previous-panel-continuity', { branchPath: 'loyal' } as any);
    const siblingPath = ref('previous-panel-continuity', { branchPath: 'rebel' } as any);
    const storyboardCrop = ref('storyboard-panel-crop', { branchPath: 'rebel' } as any);
    const character = ref('character-reference-face', { characterName: 'Aoi' });

    const filtered = filterBranchSafeContinuityRefs(
      [samePath, siblingPath, storyboardCrop, character],
      { currentBranchPath: 'loyal' },
    );

    expect(filtered).toContain(samePath);
    expect(filtered).not.toContain(siblingPath);
    // Storyboard crops remain authoritative references even when tagged with a
    // branch; only loose previous-panel continuity refs are stripped.
    expect(filtered).toContain(storyboardCrop);
    expect(filtered).toContain(character);
  });
});
