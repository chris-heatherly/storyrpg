// ========================================
// COMMON TYPE DEFINITIONS
// Shared types used across the application
// ========================================

/**
 * Scene purpose types for narrative structure
 */
export type ScenePurpose = 'opening' | 'development' | 'choice' | 'bottleneck' | 'climax' | 'resolution' | 'transition';

export const VALID_SCENE_PURPOSES: readonly ScenePurpose[] = [
  'opening', 'development', 'choice', 'bottleneck', 'climax', 'resolution', 'transition'
] as const;

/**
 * Validate that a string is a valid scene purpose
 */
export function isValidScenePurpose(purpose: string): purpose is ScenePurpose {
  return VALID_SCENE_PURPOSES.includes(purpose as ScenePurpose);
}
