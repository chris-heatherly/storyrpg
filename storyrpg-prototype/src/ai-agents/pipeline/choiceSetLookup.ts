export interface SceneChoiceScope {
  sceneId?: string;
  beats?: Array<{ id?: string }>;
}

export interface ChoiceSetScope {
  sceneId?: string;
  beatId?: string;
}

export function sceneHasChoiceBeat(scene: SceneChoiceScope | undefined, beatId: string | undefined): boolean {
  if (!scene || !beatId) return false;
  return Boolean(scene.beats?.some((beat) => beat.id === beatId));
}

export function choiceSetBelongsToScene(
  choiceSet: ChoiceSetScope | undefined,
  scene: SceneChoiceScope | undefined,
): boolean {
  if (!choiceSet?.sceneId || !scene?.sceneId) return false;
  if (choiceSet.sceneId !== scene.sceneId) return false;
  return sceneHasChoiceBeat(scene, choiceSet.beatId);
}

export function findChoiceSetForScene<T extends ChoiceSetScope, S extends SceneChoiceScope>(
  choiceSets: readonly T[],
  scene: S | undefined,
): T | undefined {
  return choiceSets.find((choiceSet) => choiceSetBelongsToScene(choiceSet, scene));
}

export function findChoiceSetIndexForScene<T extends ChoiceSetScope, S extends SceneChoiceScope>(
  choiceSets: readonly T[],
  scene: S | undefined,
): number {
  return choiceSets.findIndex((choiceSet) => choiceSetBelongsToScene(choiceSet, scene));
}

export function findSceneForChoiceSet<S extends SceneChoiceScope, T extends ChoiceSetScope>(
  scenes: readonly S[],
  choiceSet: T | undefined,
): S | undefined {
  return scenes.find((scene) => choiceSetBelongsToScene(choiceSet, scene));
}
