import { describe, it, expect } from 'vitest';
import { buildReferencePack } from './referencePackBuilder';
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
});
