import type {
  Beat,
  ConditionExpression,
  Consequence,
  EncounterBeat,
  Episode,
  Story,
} from '../../types';

export interface MicroEpisodeSeasonOptions {
  encounterCadence?: number;
  branchMinEpisodes?: number;
  branchMaxEpisodes?: number;
}

export interface MicroEpisodeSeasonIssue {
  severity: 'error' | 'warning';
  type:
    | 'encounter_cadence'
    | 'branch_length'
    | 'missing_rejoin'
    | 'invalid_rejoin'
    | 'blocking_branch'
    | 'missing_route_flag';
  message: string;
  episodeId?: string;
  branchGroupId?: string;
}

export interface MicroEpisodeSeasonResult {
  valid: boolean;
  summary: string;
  issues: MicroEpisodeSeasonIssue[];
  metrics: {
    masterEpisodeCount: number;
    branchEpisodeCount: number;
    branchGroupCount: number;
    routeFlagsSet: string[];
    routeFlagsRequired: string[];
  };
}

const DEFAULTS = {
  encounterCadence: 6,
  branchMinEpisodes: 1,
  branchMaxEpisodes: 2,
};

export class MicroEpisodeSeasonValidator {
  validateStory(story: Story, options: MicroEpisodeSeasonOptions = {}): MicroEpisodeSeasonResult {
    const config = { ...DEFAULTS, ...options };
    const issues: MicroEpisodeSeasonIssue[] = [];
    const masterEpisodes = story.episodes.filter(episode => episode.routeMeta?.kind !== 'branch');
    const branchEpisodes = story.episodes.filter(episode => episode.routeMeta?.kind === 'branch');
    const masterBySpine = new Map(
      masterEpisodes.map((episode, index) => [episode.routeMeta?.spineIndex || index + 1, episode])
    );

    for (const episode of masterEpisodes) {
      const spineIndex = episode.routeMeta?.spineIndex || episode.number;
      const milestoneEncounterRequired = episode.routeMeta?.isMilestoneEncounter === true
        || (episode.routeMeta?.isMilestoneEncounter == null && spineIndex > 0 && spineIndex % config.encounterCadence === 0);
      if (milestoneEncounterRequired && !episode.scenes.some(scene => scene.encounter)) {
        issues.push({
          severity: 'error',
          type: 'encounter_cadence',
          message: `Master-spine episode ${spineIndex} should be a milestone encounter on cadence ${config.encounterCadence}.`,
          episodeId: episode.id,
        });
      }
    }

    const branchGroups = new Map<string, Episode[]>();
    for (const episode of branchEpisodes) {
      const groupId = episode.routeMeta?.branchGroupId;
      if (!groupId) continue;
      const group = branchGroups.get(groupId) || [];
      group.push(episode);
      branchGroups.set(groupId, group);

      if (episode.routeMeta?.hideWhenInactive !== false && !episode.unlockConditions) {
        issues.push({
          severity: 'error',
          type: 'blocking_branch',
          message: 'Branch-only episode needs route unlockConditions so inactive siblings stay hidden and non-blocking.',
          episodeId: episode.id,
          branchGroupId: groupId,
        });
      }

      const rejoinIndex = episode.routeMeta?.rejoinsAtSpineIndex;
      if (!rejoinIndex) {
        issues.push({
          severity: 'error',
          type: 'missing_rejoin',
          message: 'Branch episode must declare rejoinsAtSpineIndex.',
          episodeId: episode.id,
          branchGroupId: groupId,
        });
      } else if (!masterBySpine.has(rejoinIndex)) {
        issues.push({
          severity: 'error',
          type: 'invalid_rejoin',
          message: `Branch episode rejoins at spine ${rejoinIndex}, but no matching master episode exists.`,
          episodeId: episode.id,
          branchGroupId: groupId,
        });
      }
    }

    for (const [groupId, group] of branchGroups) {
      const pathCounts = new Map<string, number>();
      for (const episode of group) {
        const pathId = episode.routeMeta?.branchPathId || 'unknown';
        pathCounts.set(pathId, (pathCounts.get(pathId) || 0) + 1);
      }

      for (const [pathId, count] of pathCounts) {
        if (count < config.branchMinEpisodes || count > config.branchMaxEpisodes) {
          issues.push({
            severity: 'error',
            type: 'branch_length',
            message: `Branch path ${groupId}/${pathId} has ${count} episode(s); expected ${config.branchMinEpisodes}-${config.branchMaxEpisodes}.`,
            branchGroupId: groupId,
          });
        }
      }
    }

    const routeFlagsSet = collectSetFlags(story.episodes);
    const routeFlagsRequired = collectRequiredFlags(branchEpisodes);
    for (const flag of routeFlagsRequired) {
      if (!routeFlagsSet.has(flag)) {
        issues.push({
          severity: 'error',
          type: 'missing_route_flag',
          message: `Route flag "${flag}" is required by a branch unlock condition but is not set by a reachable prior choice or encounter outcome.`,
        });
      }
    }

    const errors = issues.filter(issue => issue.severity === 'error');
    return {
      valid: errors.length === 0,
      summary: errors.length === 0
        ? `valid scene-length season (${masterEpisodes.length} master, ${branchEpisodes.length} branch)`
        : `${errors.length} scene-length season error(s)`,
      issues,
      metrics: {
        masterEpisodeCount: masterEpisodes.length,
        branchEpisodeCount: branchEpisodes.length,
        branchGroupCount: branchGroups.size,
        routeFlagsSet: [...routeFlagsSet],
        routeFlagsRequired: [...routeFlagsRequired],
      },
    };
  }
}

function collectRequiredFlags(episodes: Episode[]): Set<string> {
  const flags = new Set<string>();
  for (const episode of episodes) {
    collectFlagsFromCondition(episode.unlockConditions, flags);
  }
  return flags;
}

function collectFlagsFromCondition(condition: ConditionExpression | undefined, flags: Set<string>): void {
  if (!condition) return;
  if (condition.type === 'flag') {
    flags.add(condition.flag);
    return;
  }
  if (condition.type === 'and' || condition.type === 'or') {
    condition.conditions.forEach(child => collectFlagsFromCondition(child, flags));
    return;
  }
  if (condition.type === 'not') {
    collectFlagsFromCondition(condition.condition, flags);
  }
}

function collectSetFlags(episodes: Episode[]): Set<string> {
  const flags = new Set<string>();
  for (const episode of episodes) {
    for (const scene of episode.scenes) {
      for (const beat of scene.beats) {
        collectFlagsFromConsequences(beat.onShow, flags);
        beat.choices?.forEach(choice => {
          collectFlagsFromConsequences(choice.consequences, flags);
          choice.delayedConsequences?.forEach(delayed => collectFlagsFromConsequences([delayed.consequence], flags));
        });
      }
      scene.encounter?.phases.forEach(phase => {
        phase.beats.forEach(beat => {
          if (isEncounterBeat(beat)) {
            beat.choices.forEach(choice => {
              Object.values(choice.outcomes).forEach(outcome => {
                collectFlagsFromConsequences(outcome.consequences, flags);
                outcome.delayedConsequences?.forEach(delayed => collectFlagsFromConsequences([delayed.consequence], flags));
              });
            });
          } else {
            collectFlagsFromConsequences((beat as Beat).onShow, flags);
            (beat as Beat).choices?.forEach(choice => collectFlagsFromConsequences(choice.consequences, flags));
          }
        });
      });
      Object.values(scene.encounter?.storylets || {}).forEach(storylet => {
        collectFlagsFromConsequences(storylet?.consequences, flags);
        storylet?.setsFlags?.forEach(setFlag => {
          if (setFlag.value !== false) flags.add(setFlag.flag);
        });
        storylet?.beats?.forEach(beat => {
          beat.choices?.forEach(choice => collectFlagsFromConsequences(choice.consequences, flags));
        });
      });
    }
  }
  return flags;
}

function collectFlagsFromConsequences(consequences: Consequence[] | undefined, flags: Set<string>): void {
  consequences?.forEach(consequence => {
    if (consequence.type === 'setFlag' && consequence.value !== false) {
      flags.add(consequence.flag);
    }
  });
}

function isEncounterBeat(beat: Beat | EncounterBeat): beat is EncounterBeat {
  return 'setupText' in beat && 'choices' in beat;
}
