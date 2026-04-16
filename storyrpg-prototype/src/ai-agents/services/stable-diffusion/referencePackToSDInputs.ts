/**
 * Map a flat `ReferenceImage[]` into the distinct input slots Stable Diffusion
 * backends care about: an init image for img2img, ControlNet units, and an
 * IP-Adapter identity reference.
 *
 * Selection logic (in priority order):
 *  - Explicit `ref.purpose` wins: that's the whole point of the field.
 *  - When `purpose` is absent we fall back to role heuristics so legacy
 *    reference packs still produce sensible defaults (face crops → IP-Adapter,
 *    environment refs → ControlNet depth).
 *  - Only one init image and one IP-Adapter ref are chosen; ControlNet can
 *    stack multiple modules.
 */

import type {
  ImagePromptControlNet,
  ImagePromptIpAdapter,
} from '../../agents/ImageGenerator';
import type { StableDiffusionSettings } from '../../config';
import type { ReferenceImage } from '../imageGenerationService';

export interface SDReferenceBundle {
  init?: ReferenceImage;
  mask?: ReferenceImage;
  controlNets: Array<{
    unit: ImagePromptControlNet;
    image: ReferenceImage;
  }>;
  ipAdapter?: {
    unit: ImagePromptIpAdapter;
    image: ReferenceImage;
  };
  /**
   * Leftover references that weren't consumed by a specific SD pipeline slot.
   * Emitted mostly for diagnostics — adapters may ignore them.
   */
  unused: ReferenceImage[];
}

function roleLooksLikeFace(role: string): boolean {
  const r = role.toLowerCase();
  return r.includes('face') || r === 'character-face' || r.startsWith('character-reference-face');
}

function roleLooksLikeEnvironment(role: string): boolean {
  const r = role.toLowerCase();
  return r.includes('environment') || r.includes('location') || r.includes('scene-master');
}

function roleLooksLikeStyle(role: string): boolean {
  const r = role.toLowerCase();
  return r.includes('style') || r.includes('art-reference');
}

function roleLooksLikePreviousPanel(role: string): boolean {
  const r = role.toLowerCase();
  return r === 'previous-panel-continuity' || r.includes('previous-panel') || r.includes('previous-scene');
}

/**
 * Pick a single init-image candidate from a pool, preferring explicit purpose
 * tags and then common "previous panel" continuity refs.
 */
function pickInit(refs: ReferenceImage[]): ReferenceImage | undefined {
  const explicit = refs.find(r => r.purpose === 'img2img-init');
  if (explicit) return explicit;
  return refs.find(r => roleLooksLikePreviousPanel(r.role));
}

function pickMask(refs: ReferenceImage[]): ReferenceImage | undefined {
  return refs.find(r => r.purpose === 'inpaint-mask');
}

function pickIpAdapter(
  refs: ReferenceImage[],
  settings: StableDiffusionSettings,
  explicitUnit?: ImagePromptIpAdapter,
): { unit: ImagePromptIpAdapter; image: ReferenceImage } | undefined {
  const explicit = refs.find(r => r.purpose === 'ip-adapter');
  const fallback = refs.find(r => roleLooksLikeFace(r.role));
  const image = explicit || fallback;
  if (!image) return undefined;
  const model = explicitUnit?.model || settings.ipAdapterModel;
  if (!model) return undefined;
  const unit: ImagePromptIpAdapter = {
    model,
    imageRole: explicitUnit?.imageRole || image.role,
    weight: explicitUnit?.weight ?? 0.7,
  };
  return { unit, image };
}

function pickControlNets(
  refs: ReferenceImage[],
  settings: StableDiffusionSettings,
  explicitUnits: ImagePromptControlNet[] | undefined,
  alreadyClaimed: Set<ReferenceImage>,
): Array<{ unit: ImagePromptControlNet; image: ReferenceImage }> {
  const out: Array<{ unit: ImagePromptControlNet; image: ReferenceImage }> = [];
  const modelFor = (purpose: string): string | undefined => {
    if (purpose === 'controlnet-depth') return settings.controlNetModels?.depth;
    if (purpose === 'controlnet-canny') return settings.controlNetModels?.canny;
    if (purpose === 'reference-only') return settings.controlNetModels?.referenceOnly;
    return undefined;
  };

  // 1. Honor prompt-level ControlNet units first — find an image matching the
  //    requested role or purpose.
  for (const unit of explicitUnits || []) {
    const image = refs.find(
      r => !alreadyClaimed.has(r) && (r.role === unit.imageRole || r.purpose === unit.imageRole),
    );
    if (image) {
      alreadyClaimed.add(image);
      out.push({ unit, image });
    }
  }

  // 2. Auto-promote references tagged with an SD ControlNet purpose.
  for (const ref of refs) {
    if (alreadyClaimed.has(ref)) continue;
    const p = ref.purpose;
    if (!p || !p.startsWith('controlnet-') && p !== 'reference-only') continue;
    const model = modelFor(p);
    if (!model) continue;
    const moduleMap: Record<string, string> = {
      'controlnet-depth': 'depth_midas',
      'controlnet-canny': 'canny',
      'reference-only': 'reference_only',
    };
    const unit: ImagePromptControlNet = {
      module: moduleMap[p] || 'reference_only',
      model,
      imageRole: ref.role,
      weight: p === 'reference-only' ? 0.6 : 0.55,
    };
    alreadyClaimed.add(ref);
    out.push({ unit, image: ref });
  }

  // 3. Heuristic fallback: if the caller didn't tag anything but provided an
  //    environment/style reference AND has models configured, wire depth for
  //    environment and reference-only for style.
  if (out.length === 0) {
    const envRef = refs.find(r => !alreadyClaimed.has(r) && roleLooksLikeEnvironment(r.role));
    if (envRef && settings.controlNetModels?.depth) {
      alreadyClaimed.add(envRef);
      out.push({
        unit: {
          module: 'depth_midas',
          model: settings.controlNetModels.depth,
          imageRole: envRef.role,
          weight: 0.5,
        },
        image: envRef,
      });
    }
    const styleRef = refs.find(r => !alreadyClaimed.has(r) && roleLooksLikeStyle(r.role));
    if (styleRef && settings.controlNetModels?.referenceOnly) {
      alreadyClaimed.add(styleRef);
      out.push({
        unit: {
          module: 'reference_only',
          model: settings.controlNetModels.referenceOnly,
          imageRole: styleRef.role,
          weight: 0.45,
        },
        image: styleRef,
      });
    }
  }

  return out;
}

export function referencePackToSDInputs(
  refs: ReferenceImage[] | undefined,
  settings: StableDiffusionSettings,
  prompt: {
    controlNet?: ImagePromptControlNet[];
    ipAdapter?: ImagePromptIpAdapter;
  },
): SDReferenceBundle {
  const list = Array.isArray(refs) ? [...refs] : [];
  const claimed = new Set<ReferenceImage>();

  const init = pickInit(list);
  if (init) claimed.add(init);

  const mask = pickMask(list);
  if (mask) claimed.add(mask);

  const ipAdapter = pickIpAdapter(list, settings, prompt.ipAdapter);
  if (ipAdapter) claimed.add(ipAdapter.image);

  const controlNets = pickControlNets(list, settings, prompt.controlNet, claimed);

  const unused = list.filter(r => !claimed.has(r));
  return { init, mask, controlNets, ipAdapter, unused };
}
