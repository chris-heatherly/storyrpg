/**
 * Scene-first planning feature flag.
 *
 * Scene-first planning enumerates episodes AND their scenes at the season level
 * (see {@link SeasonScenePlan}), inverting the historical beat-first flow where
 * StoryArchitect invented scenes per-episode. It is ON by default and opt-OUT
 * via `SCENE_FIRST_PLANNING=0`. When the source is an authored treatment in
 * `sceneEpisodes` mode the author is already thinking in scenes, so the feature
 * stays enabled there even if the env flag is unset.
 */

/** The env var controlling scene-first planning (`0` to opt out). */
export const SCENE_FIRST_PLANNING_FLAG = 'SCENE_FIRST_PLANNING';

/**
 * Whether scene-first planning is enabled for this run. Default ON; only an
 * explicit `SCENE_FIRST_PLANNING=0` disables it (and even then `sceneEpisodes`
 * mode keeps it on, since that source is authored scene-first by construction).
 *
 * @param episodeStructureMode optional season/episode structure mode; when
 *   `'sceneEpisodes'` the feature stays enabled regardless of the env flag.
 */
export function isSceneFirstPlanningEnabled(
  episodeStructureMode?: 'standard' | 'sceneEpisodes',
): boolean {
  if (episodeStructureMode === 'sceneEpisodes') return true;
  if (process.env[SCENE_FIRST_PLANNING_FLAG] === '0') return false;
  return true;
}
