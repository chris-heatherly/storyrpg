/**
 * Scene-first planning feature flag.
 *
 * Scene-first planning enumerates episodes AND their scenes at the season level
 * (see {@link SeasonScenePlan}), inverting the historical beat-first flow where
 * StoryArchitect invented scenes per-episode. It is OFF by default and opt-in
 * via the `SCENE_FIRST_PLANNING` env flag, matching the repo's default-off
 * convention for new planning behavior. When the source is an authored treatment
 * in `sceneEpisodes` mode, the author is already thinking in scenes, so the
 * feature auto-enables for that mode.
 */

/** The env var that opts a run into scene-first planning. */
export const SCENE_FIRST_PLANNING_FLAG = 'SCENE_FIRST_PLANNING';

/**
 * Whether scene-first planning is enabled for this run.
 *
 * @param episodeStructureMode optional season/episode structure mode; when
 *   `'sceneEpisodes'` the feature auto-enables regardless of the env flag.
 */
export function isSceneFirstPlanningEnabled(
  episodeStructureMode?: 'standard' | 'sceneEpisodes',
): boolean {
  if (process.env[SCENE_FIRST_PLANNING_FLAG] === '1') return true;
  if (episodeStructureMode === 'sceneEpisodes') return true;
  return false;
}
