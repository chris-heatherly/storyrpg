type EncounterOutcomeTier = 'success' | 'complicated' | 'failure';

interface EncounterChoiceLike {
  id: string;
  outcomes?: Partial<Record<EncounterOutcomeTier, EncounterOutcomeLike>>;
}

interface EncounterSituationLike {
  situationImage?: string;
  choices?: EncounterChoiceLike[];
}

interface EncounterOutcomeLike {
  outcomeImage?: string;
  nextSituation?: EncounterSituationLike;
}

interface EncounterBeatLike extends EncounterSituationLike {
  id: string;
}

interface EncounterPhaseLike {
  beats?: EncounterBeatLike[];
}

interface StoryletBeatLike {
  id: string;
  image?: string;
}

interface StoryletLike {
  beats?: StoryletBeatLike[];
}

export interface EncounterLike {
  beats?: EncounterBeatLike[];
  phases?: EncounterPhaseLike[];
  storylets?: Record<string, StoryletLike | undefined>;
}

const OUTCOME_TIERS: EncounterOutcomeTier[] = ['success', 'complicated', 'failure'];

export function getEncounterBeats(encounter?: EncounterLike | null): EncounterBeatLike[] {
  if (!encounter) return [];

  if (Array.isArray(encounter.beats) && encounter.beats.length > 0) {
    return encounter.beats;
  }

  if (!Array.isArray(encounter.phases)) {
    return [];
  }

  return encounter.phases.flatMap((phase) => phase.beats || []);
}

function collectMissingChoiceTreeImages(
  sceneId: string,
  beatId: string,
  choices: EncounterChoiceLike[] | undefined,
  missingImages: string[],
  pathPrefix: string = '',
): void {
  for (const choice of choices || []) {
    const choiceKey = pathPrefix ? `${pathPrefix}::${choice.id}` : choice.id;

    for (const tier of OUTCOME_TIERS) {
      const outcome = choice.outcomes?.[tier];
      if (!outcome) continue;

      if (!outcome.outcomeImage) {
        missingImages.push(`outcome:${sceneId}::${beatId}::${choiceKey}::${tier}`);
      }

      const nextSituation = outcome.nextSituation;
      if (!nextSituation) continue;

      if (!nextSituation.situationImage) {
        missingImages.push(`situation:${sceneId}::${beatId}::${choiceKey}::${tier}::situation`);
      }

      collectMissingChoiceTreeImages(
        sceneId,
        beatId,
        nextSituation.choices,
        missingImages,
        `${choiceKey}::${tier}`,
      );
    }
  }
}

export function collectMissingEncounterImageKeys(
  sceneId: string,
  encounter?: EncounterLike | null,
): string[] {
  if (!encounter) return [];

  const missingImages: string[] = [];

  for (const beat of getEncounterBeats(encounter)) {
    if (!beat.situationImage) {
      missingImages.push(`setup:${sceneId}::${beat.id}`);
    }

    collectMissingChoiceTreeImages(sceneId, beat.id, beat.choices, missingImages);
  }

  for (const [outcomeName, storylet] of Object.entries(encounter.storylets || {})) {
    for (const beat of storylet?.beats || []) {
      if (!beat.image) {
        missingImages.push(`storylet:${sceneId}::${outcomeName}::${beat.id}`);
      }
    }
  }

  return missingImages;
}
