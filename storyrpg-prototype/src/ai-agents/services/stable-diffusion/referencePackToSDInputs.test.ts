import { describe, expect, it } from 'vitest';
import { referencePackToSDInputs } from './referencePackToSDInputs';
import type { StableDiffusionSettings } from '../../config';
import type { ReferenceImage } from '../imageGenerationService';

const settings: StableDiffusionSettings = {
  baseUrl: 'http://localhost:7860',
  backend: 'a1111',
  ipAdapterModel: 'ip-adapter_sdxl',
  controlNetModels: {
    depth: 'depth_midas_sdxl',
    canny: 'canny_sdxl',
    referenceOnly: 'reference_only_sdxl',
  },
};

function img(role: string, purpose?: any, characterName?: string): ReferenceImage {
  return {
    data: 'iVBORw0KGgo=',
    mimeType: 'image/png',
    role,
    purpose,
    characterName,
  };
}

describe('referencePackToSDInputs', () => {
  it('returns empty bundle for no refs', () => {
    const out = referencePackToSDInputs(undefined, settings, {});
    expect(out.controlNets).toEqual([]);
    expect(out.init).toBeUndefined();
    expect(out.ipAdapter).toBeUndefined();
    expect(out.mask).toBeUndefined();
  });

  it('respects explicit purpose=img2img-init over previous-panel-continuity', () => {
    const previous = img('previous-panel-continuity');
    const explicit = img('some-other-role', 'img2img-init');
    const out = referencePackToSDInputs([previous, explicit], settings, {});
    expect(out.init).toBe(explicit);
  });

  it('falls back to previous-panel-continuity when no explicit init', () => {
    const previous = img('previous-panel-continuity');
    const out = referencePackToSDInputs([previous], settings, {});
    expect(out.init).toBe(previous);
  });

  it('picks an inpaint mask by purpose', () => {
    const mask = img('mask', 'inpaint-mask');
    const out = referencePackToSDInputs([mask], settings, {});
    expect(out.mask).toBe(mask);
  });

  it('wires an IP-Adapter from a face crop when ipAdapterModel is set', () => {
    const face = img('character-reference-face', undefined, 'hero');
    const out = referencePackToSDInputs([face], settings, {});
    expect(out.ipAdapter).toBeDefined();
    expect(out.ipAdapter!.image).toBe(face);
    expect(out.ipAdapter!.unit.model).toBe('ip-adapter_sdxl');
  });

  it('auto-promotes a controlnet-depth purpose ref', () => {
    const envRef = img('scene-master-environment', 'controlnet-depth');
    const out = referencePackToSDInputs([envRef], settings, {});
    expect(out.controlNets).toHaveLength(1);
    expect(out.controlNets[0].unit.module).toBe('depth_midas');
    expect(out.controlNets[0].unit.model).toBe('depth_midas_sdxl');
    expect(out.controlNets[0].image).toBe(envRef);
  });

  it('heuristically wires depth for an environment ref when no purpose is set', () => {
    const envRef = img('location-wide-shot');
    const out = referencePackToSDInputs([envRef], settings, {});
    expect(out.controlNets[0]?.unit.module).toBe('depth_midas');
  });

  it('prefers explicit prompt-level controlnet unit over heuristics', () => {
    const envRef = img('location-wide-shot');
    const out = referencePackToSDInputs([envRef], settings, {
      controlNet: [
        { module: 'canny', model: 'canny_sdxl', imageRole: 'location-wide-shot', weight: 0.7 },
      ],
    });
    expect(out.controlNets).toHaveLength(1);
    expect(out.controlNets[0].unit.module).toBe('canny');
    expect(out.controlNets[0].unit.weight).toBe(0.7);
  });

  it('does not double-claim a ref between init and controlnet', () => {
    const ref = img('previous-panel-continuity', 'img2img-init');
    const out = referencePackToSDInputs([ref], settings, {});
    expect(out.init).toBe(ref);
    expect(out.controlNets).toEqual([]);
  });

  it('lists leftover refs under unused for diagnostics', () => {
    const junk = img('random-mood-board');
    const out = referencePackToSDInputs([junk], settings, {});
    expect(out.unused).toContain(junk);
  });

  it('filters out composite-sheet refs before routing to SD units', () => {
    const composite = img('composite-sheet', undefined, 'hero');
    const face = img('character-reference-face', undefined, 'hero');
    const out = referencePackToSDInputs([composite, face], settings, {});
    // Composite is dropped entirely (not routed, not in unused) to avoid
    // muddying the IP-Adapter embedding with a multi-panel turnaround.
    expect(out.ipAdapter?.image).toBe(face);
    expect(out.unused).not.toContain(composite);
    const allClaimed = [
      out.init,
      out.mask,
      out.ipAdapter?.image,
      ...out.controlNets.map((c) => c.image),
    ].filter(Boolean);
    expect(allClaimed).not.toContain(composite);
  });
});
