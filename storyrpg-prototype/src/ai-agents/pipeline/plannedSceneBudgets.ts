import type { SeasonPlan } from '../../types/seasonPlan';
import type { ConsequenceTier } from '../../types/scenePlan';

type PlanLike = Pick<SeasonPlan, 'scenePlan' | 'episodes'> | undefined;

function visitPlannedScenes(
  seasonPlan: PlanLike,
  visit: (scene: NonNullable<NonNullable<SeasonPlan['scenePlan']>['scenes']>[number]) => void,
): void {
  for (const scene of seasonPlan?.scenePlan?.scenes ?? []) {
    visit(scene);
  }
  for (const episode of seasonPlan?.episodes ?? []) {
    for (const scene of episode.plannedScenes ?? []) {
      visit(scene);
    }
  }
}

export function plannedChoiceTypesByScene(seasonPlan: PlanLike): Record<string, string> {
  const byScene: Record<string, string> = {};
  visitPlannedScenes(seasonPlan, (scene) => {
    if (scene.id && scene.choiceType) byScene[scene.id] = scene.choiceType;
  });
  return byScene;
}

export function plannedConsequenceTiersByScene(seasonPlan: PlanLike): Record<string, ConsequenceTier> {
  const byScene: Record<string, ConsequenceTier> = {};
  visitPlannedScenes(seasonPlan, (scene) => {
    if (scene.id && scene.consequenceTier) byScene[scene.id] = scene.consequenceTier;
  });
  return byScene;
}

export function plannedConsequenceTierForScene(
  seasonPlan: PlanLike,
  sceneId: string | undefined,
): ConsequenceTier | undefined {
  if (!sceneId) return undefined;
  return plannedConsequenceTiersByScene(seasonPlan)[sceneId];
}
