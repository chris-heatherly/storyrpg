import type { Story } from '../../types';

export interface EmptyPlayableSceneFinding {
  validator: 'EmptyPlayableSceneValidator';
  severity: 'error';
  type: 'empty_scene' | 'empty_encounter_scene';
  message: string;
  episodeId?: string;
  episodeNumber?: number;
  sceneId: string;
  path: string;
}

export interface EmptyPlayableSceneReport {
  passed: boolean;
  findings: EmptyPlayableSceneFinding[];
  emptySceneIds: string[];
  emptyEncounterSceneIds: string[];
}

export class EmptyPlayableSceneValidator {
  validate(input: { story: Story }): EmptyPlayableSceneReport {
    const findings: EmptyPlayableSceneFinding[] = [];
    const emptySceneIds: string[] = [];
    const emptyEncounterSceneIds: string[] = [];

    input.story.episodes?.forEach((episode, episodeIndex) => {
      episode.scenes?.forEach((scene, sceneIndex) => {
        const beats = scene.beats || [];
        const hasBeatText = beats.some((beat) => hasText(beat.text));
        const choices = beats.flatMap((beat) => beat.choices || []);
        const hasChoices = choices.length > 0;
        const sceneRecord = scene as unknown as Record<string, unknown>;
        const hasStorylets = Array.isArray(sceneRecord.storylets) && sceneRecord.storylets.length > 0;
        const isEncounter = Boolean(scene.encounter || sceneRecord.isEncounter || sceneRecord.encounterState);
        const encounterRecord = scene.encounter as unknown as Record<string, unknown> | undefined;
        const hasEncounterContent = isEncounter && (
          hasText(encounterRecord?.description)
          || hasText(encounterRecord?.objective)
          || hasText(encounterRecord?.successOutcome)
          || hasText(encounterRecord?.failureOutcome)
          || (Array.isArray(encounterRecord?.phases) && encounterRecord!.phases.length > 0)
        );
        if (hasBeatText || hasChoices || hasStorylets || hasEncounterContent) return;

        const type: EmptyPlayableSceneFinding['type'] = isEncounter ? 'empty_encounter_scene' : 'empty_scene';
        if (isEncounter) emptyEncounterSceneIds.push(scene.id);
        emptySceneIds.push(scene.id);
        findings.push({
          validator: 'EmptyPlayableSceneValidator',
          severity: 'error',
          type,
          message: isEncounter
            ? `Encounter scene "${scene.id}" has no beats, choices, storylets, or encounter outcomes.`
            : `Scene "${scene.id}" has no playable beats, choices, or storylets.`,
          episodeId: episode.id,
          episodeNumber: episode.number ?? episodeIndex + 1,
          sceneId: scene.id,
          path: `episodes[${episodeIndex}].scenes[${sceneIndex}]`,
        });
      });
    });

    return {
      passed: findings.length === 0,
      findings,
      emptySceneIds,
      emptyEncounterSceneIds,
    };
  }
}

function hasText(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}
