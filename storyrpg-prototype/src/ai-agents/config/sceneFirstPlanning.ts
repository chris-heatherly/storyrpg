/**
 * Scene-first planning feature flag.
 *
 * Scene-first planning enumerates episodes AND their scenes at the season level
 * (see {@link SeasonScenePlan}), inverting the historical beat-first flow where
 * StoryArchitect invented scenes per-episode. It is ON by default and opt-OUT
 * via `SCENE_FIRST_PLANNING=0`.
 */

/** The env var controlling scene-first planning (`0` to opt out). */
export const SCENE_FIRST_PLANNING_FLAG = 'SCENE_FIRST_PLANNING';

/**
 * Whether scene-first planning is enabled for this run. Default ON; only an
 * explicit `SCENE_FIRST_PLANNING=0` disables it.
 */
export function isSceneFirstPlanningEnabled(): boolean {
  if (process.env[SCENE_FIRST_PLANNING_FLAG] === '0') return false;
  return true;
}
