/**
 * Art style preset library (C7).
 *
 * Curated high-quality `ArtStyleProfile`s the Generator UI can surface as
 * picks. The list is intentionally empty until new curated styles are added.
 *
 * Add a new preset by appending to `ART_STYLE_PRESETS`. Keep `id` stable
 * once published — persisted stories reference it.
 */

import type { ArtStyleProfile } from '../images/artStyleProfile';

export interface ArtStylePreset {
  id: string;
  displayName: string;
  /** Short blurb shown under the preset tile in the UI. */
  description: string;
  /** Optional sample image path (relative to assets) for the picker. */
  samplePath?: string;
  profile: ArtStyleProfile;
}

export const ART_STYLE_PRESETS: ArtStylePreset[] = [];

export function findPresetById(id: string | undefined): ArtStylePreset | undefined {
  if (!id) return undefined;
  return ART_STYLE_PRESETS.find((p) => p.id === id);
}

export function findPresetByStyleName(name: string | undefined): ArtStylePreset | undefined {
  if (!name) return undefined;
  const lower = name.trim().toLowerCase();
  return ART_STYLE_PRESETS.find(
    (p) => p.displayName.toLowerCase() === lower || p.profile.name.toLowerCase() === lower,
  );
}
