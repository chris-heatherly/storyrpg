import type {
  Beat,
  Encounter,
  EncounterBeat,
  Episode,
  Scene,
} from '../../types';

export interface MicroEpisodeStructureOptions {
  minScenes?: number;
  maxScenes?: number;
  normalMinBeats?: number;
  normalMaxBeats?: number;
  encounterMaxBeats?: number;
}

export interface MicroEpisodeStructureIssue {
  severity: 'error' | 'warning';
  type:
    | 'scene_count'
    | 'normal_beat_count'
    | 'missing_choice'
    | 'missing_cliffhanger'
    | 'encounter_missing_choice'
    | 'encounter_path_too_long'
    | 'route_meta';
  message: string;
  episodeId: string;
  sceneId?: string;
}

export interface MicroEpisodeStructureResult {
  valid: boolean;
  summary: string;
  issues: MicroEpisodeStructureIssue[];
  metrics: {
    sceneCount: number;
    normalBeatCount: number;
    visibleChoiceCount: number;
    encounterChoiceCount: number;
    encounterEffectivePathBeats: number;
  };
}

const DEFAULTS = {
  minScenes: 1,
  maxScenes: 1,
  normalMinBeats: 6,
  normalMaxBeats: 10,
  encounterMaxBeats: 15,
};

export class MicroEpisodeStructureValidator {
  validateEpisode(
    episode: Episode,
    options: MicroEpisodeStructureOptions = {}
  ): MicroEpisodeStructureResult {
    const config = { ...DEFAULTS, ...options };
    const issues: MicroEpisodeStructureIssue[] = [];
    const sceneCount = episode.scenes.length;
    const scene = episode.scenes[0];
    const hasEncounter = Boolean(scene?.encounter);

    if (sceneCount < config.minScenes || sceneCount > config.maxScenes) {
      issues.push({
        severity: 'error',
        type: 'scene_count',
        message: `Scene-length episode must contain ${config.minScenes === config.maxScenes ? `exactly ${config.maxScenes}` : `${config.minScenes}-${config.maxScenes}`} scene(s); found ${sceneCount}.`,
        episodeId: episode.id,
      });
    }

    if (scene && episode.startingSceneId !== scene.id) {
      issues.push({
        severity: 'error',
        type: 'route_meta',
        message: `startingSceneId must point at the single scene (${scene.id}); found ${episode.startingSceneId}.`,
        episodeId: episode.id,
        sceneId: scene.id,
      });
    }

    if (episode.routeMeta?.kind === 'branch') {
      if (!episode.routeMeta.branchGroupId || !episode.routeMeta.branchPathId || !episode.unlockConditions) {
        issues.push({
          severity: 'error',
          type: 'route_meta',
          message: 'Branch episode must declare branchGroupId, branchPathId, and unlockConditions.',
          episodeId: episode.id,
          sceneId: scene?.id,
        });
      }
    }

    const normalBeatCount = hasEncounter ? 0 : (scene?.beats.length || 0);
    const visibleChoiceCount = hasEncounter ? 0 : countVisibleChoices(scene);
    const encounterChoiceCount = scene?.encounter ? countEncounterChoices(scene.encounter) : 0;
    const encounterEffectivePathBeats = scene?.encounter ? countEncounterEffectivePathBeats(scene.encounter) : 0;

    if (scene && !hasEncounter) {
      if (normalBeatCount < config.normalMinBeats || normalBeatCount > config.normalMaxBeats) {
        issues.push({
          severity: 'error',
          type: 'normal_beat_count',
          message: `Normal scene-length episode must have ${config.normalMinBeats}-${config.normalMaxBeats} beats; found ${normalBeatCount}.`,
          episodeId: episode.id,
          sceneId: scene.id,
        });
      }

      if (visibleChoiceCount < 1) {
        issues.push({
          severity: 'error',
          type: 'missing_choice',
          message: 'Normal scene-length episode must contain at least one visible choice.',
          episodeId: episode.id,
          sceneId: scene.id,
        });
      }

      const finalBeat = scene.beats[scene.beats.length - 1];
      if (!finalBeat?.text?.trim()) {
        issues.push({
          severity: 'error',
          type: 'missing_cliffhanger',
          message: 'Normal scene-length episode needs a final beat that can carry the cliffhanger/forward-pressure contract.',
          episodeId: episode.id,
          sceneId: scene.id,
        });
      }
    }

    if (scene?.encounter) {
      if (encounterChoiceCount < 1) {
        issues.push({
          severity: 'error',
          type: 'encounter_missing_choice',
          message: 'Encounter scene-length episode must contain at least one encounter choice.',
          episodeId: episode.id,
          sceneId: scene.id,
        });
      }

      if (encounterEffectivePathBeats > config.encounterMaxBeats) {
        issues.push({
          severity: 'error',
          type: 'encounter_path_too_long',
          message: `Encounter effective playable path must be <= ${config.encounterMaxBeats} beats; found ${encounterEffectivePathBeats}.`,
          episodeId: episode.id,
          sceneId: scene.id,
        });
      }
    }

    const errors = issues.filter(issue => issue.severity === 'error');
    return {
      valid: errors.length === 0,
      summary: errors.length === 0
        ? `valid micro-episode (${sceneCount} scene, ${hasEncounter ? `${encounterEffectivePathBeats} encounter path beats` : `${normalBeatCount} beats`})`
        : `${errors.length} micro-episode error(s)`,
      issues,
      metrics: {
        sceneCount,
        normalBeatCount,
        visibleChoiceCount,
        encounterChoiceCount,
        encounterEffectivePathBeats,
      },
    };
  }
}

function countVisibleChoices(scene?: Scene): number {
  if (!scene) return 0;
  return scene.beats.reduce((sum, beat) => {
    const choices = beat.choices?.filter(choice => choice.showWhenLocked !== true) || [];
    return sum + choices.length;
  }, 0);
}

function countEncounterChoices(encounter: Encounter): number {
  return encounter.phases.reduce((sum, phase) => {
    return sum + phase.beats.reduce((phaseSum, beat) => {
      return phaseSum + (isEncounterBeat(beat) ? beat.choices.length : ((beat as Beat).choices?.length || 0));
    }, 0);
  }, 0);
}

function countEncounterEffectivePathBeats(encounter: Encounter): number {
  const phaseBeatCount = encounter.phases.reduce((sum, phase) => {
    return sum + phase.beats.reduce((phaseSum, beat) => {
      if (!isEncounterBeat(beat)) return phaseSum + 1;
      return phaseSum + Math.max(1, countEncounterBeatPath(beat));
    }, 0);
  }, 0);

  const storyletMax = Math.max(
    0,
    ...Object.values(encounter.storylets || {}).map(storylet => storylet?.beats?.length || 0)
  );

  return phaseBeatCount + storyletMax;
}

function countEncounterBeatPath(beat: EncounterBeat, visited = new Set<string>()): number {
  if (visited.has(beat.id)) return 1;
  visited.add(beat.id);
  const nextSituationCounts = beat.choices.flatMap(choice =>
    Object.values(choice.outcomes).map(outcome => {
      const nextSituation = outcome.nextSituation;
      if (!nextSituation) return 0;
      const nestedChoices = nextSituation.choices || [];
      const nestedDepth = Math.max(
        0,
        ...nestedChoices.flatMap(nestedChoice =>
          Object.values(nestedChoice.outcomes).map(nestedOutcome =>
            nestedOutcome.nextSituation ? 1 : 0
          )
        )
      );
      return 1 + nestedDepth;
    })
  );
  return 1 + Math.max(0, ...nextSituationCounts);
}

function isEncounterBeat(beat: Beat | EncounterBeat): beat is EncounterBeat {
  return 'setupText' in beat && 'choices' in beat;
}
