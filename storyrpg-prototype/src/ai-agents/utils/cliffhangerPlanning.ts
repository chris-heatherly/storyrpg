import type { CliffhangerType } from '../../types';
import type { CliffhangerIntensity, CliffhangerPlan } from '../../types/seasonPlan';
import type { EpisodeOutline, StoryCircleBeat, StoryCircleRoleAssignment } from '../../types/sourceAnalysis';
import { storyCircleRoleBeats } from './storyCircleDistribution';

const STORY_CIRCLE_CLIFFHANGER_PRIORITY: StoryCircleBeat[] = [
  'take',
  'find',
  'search',
  'go',
  'need',
  'return',
  'change',
  'you',
];

export interface CliffhangerDefaults {
  type: CliffhangerType;
  intensity: CliffhangerIntensity;
  emotionalCharge: string;
  newOpenQuestion: string;
  nextEpisodePressure: string;
}

export function selectCliffhangerStoryCircleBeat(
  roles: StoryCircleRoleAssignment[] | undefined,
  episodeNumber = 1,
): StoryCircleBeat {
  const beats = storyCircleRoleBeats(roles);
  if (episodeNumber === 1 && beats.includes('you')) return 'you';
  for (const beat of STORY_CIRCLE_CLIFFHANGER_PRIORITY) {
    if (beats.includes(beat)) return beat;
  }
  return beats[0] || 'search';
}

export function getCliffhangerDefaultsForStoryCircleBeat(
  beat: StoryCircleBeat,
  episodeNumber: number,
  totalEpisodes: number,
): CliffhangerDefaults {
  if (episodeNumber === 1) {
    return {
      type: 'shock',
      intensity: 'high',
      emotionalCharge: 'shock, dread, or intimate alarm',
      newOpenQuestion: 'What is the larger danger or personal truth the protagonist has just stumbled into?',
      nextEpisodePressure: 'The next episode must answer what this turn means and force the protagonist to respond.',
    };
  }

  switch (beat) {
    case 'you':
      return {
        type: 'emotional_hook',
        intensity: 'high',
        emotionalCharge: 'personal rupture or destabilizing wonder',
        newOpenQuestion: 'Why is the ordinary world more dangerous or personal than it first appeared?',
        nextEpisodePressure: 'The protagonist must follow the new personal disturbance.',
      };
    case 'need':
    case 'go':
      return {
        type: 'decision',
        intensity: 'high',
        emotionalCharge: 'commitment pressure',
        newOpenQuestion: 'What will the protagonist sacrifice now that retreat is impossible?',
        nextEpisodePressure: 'The next episode begins from forced commitment or pursuit.',
      };
    case 'search':
      return {
        type: 'betrayal',
        intensity: 'high',
        emotionalCharge: 'exposed vulnerability',
        newOpenQuestion: 'How far can the antagonizing force reach, and who is no longer safe?',
        nextEpisodePressure: 'The next episode must deal with a loss, betrayal, or tightened threat.',
      };
    case 'find':
      return {
        type: 'reframe',
        intensity: 'high',
        emotionalCharge: 'major revelation and reorientation',
        newOpenQuestion: 'What does the central conflict mean now that a core assumption has flipped?',
        nextEpisodePressure: 'The protagonist must act from a new understanding of the stakes.',
      };
    case 'take':
      return {
        type: 'emotional_hook',
        intensity: 'high',
        emotionalCharge: 'emotional collapse, moral cost, or apparent failure',
        newOpenQuestion: 'What remains of the protagonist after this cost lands?',
        nextEpisodePressure: 'The next episode must reckon with the fallout and force transformation.',
      };
    case 'return':
      return {
        type: episodeNumber >= totalEpisodes ? 'transformation' : 'danger',
        intensity: episodeNumber >= totalEpisodes ? 'medium' : 'high',
        emotionalCharge: episodeNumber >= totalEpisodes ? 'catharsis with future pressure' : 'high-stakes uncertainty',
        newOpenQuestion: episodeNumber >= totalEpisodes
          ? 'What future or next-season pressure remains after the main conflict closes?'
          : 'What is the immediate fallout of the climactic outcome?',
        nextEpisodePressure: episodeNumber >= totalEpisodes
          ? 'Only seed future cost if the season is continuing.'
          : 'The next episode must deal with the consequences of the climax.',
      };
    case 'change':
      return {
        type: 'mystery',
        intensity: 'medium',
        emotionalCharge: 'future cost or quiet unease',
        newOpenQuestion: 'What future cost remains after the main arc resolves?',
        nextEpisodePressure: 'Do not reopen the solved main conflict; point to aftermath or next-season pressure.',
      };
    default:
      return {
        type: 'mystery',
        intensity: 'medium',
        emotionalCharge: 'curiosity and forward pressure',
        newOpenQuestion: 'What complication or hidden cost will drive the next episode?',
        nextEpisodePressure: 'The next episode should pursue the newly opened problem.',
      };
  }
}

export function shouldForceHighIntensityHook(
  episodeNumber: number,
  totalEpisodes: number,
  beat: StoryCircleBeat,
): boolean {
  if (episodeNumber === 1) return true;
  if (beat === 'find' || beat === 'take') return true;
  return totalEpisodes >= 6 && episodeNumber > 1 && episodeNumber < totalEpisodes && (episodeNumber - 1) % 3 === 0;
}

function nextLoopLaunchBeatFor(
  beat: StoryCircleBeat,
  episodeNumber: number,
  totalEpisodes: number,
): StoryCircleBeat {
  if (episodeNumber >= totalEpisodes) return 'change';
  return beat === 'take' || beat === 'return' || beat === 'change' ? 'need' : 'go';
}

export function buildDefaultCliffhangerPlan(params: {
  episode: Pick<EpisodeOutline, 'episodeNumber' | 'title' | 'synopsis' | 'narrativeFunction' | 'storyCircleRole'>;
  totalEpisodes: number;
  seasonStakes?: string;
  nextEpisodeTitle?: string;
}): CliffhangerPlan {
  const { episode, totalEpisodes, seasonStakes, nextEpisodeTitle } = params;
  const storyCircleBeat = selectCliffhangerStoryCircleBeat(episode.storyCircleRole, episode.episodeNumber);
  const defaults = getCliffhangerDefaultsForStoryCircleBeat(storyCircleBeat, episode.episodeNumber, totalEpisodes);
  const forceHigh = shouldForceHighIntensityHook(episode.episodeNumber, totalEpisodes, storyCircleBeat);
  const type = forceHigh && defaults.type === 'mystery' ? 'emotional_hook' : defaults.type;
  const intensity = forceHigh ? 'high' : defaults.intensity;
  const immediateResolution = episode.narrativeFunction?.conflict || episode.synopsis;
  const nextPressure = nextEpisodeTitle
    ? `Pressure carries into "${nextEpisodeTitle}": ${defaults.nextEpisodePressure}`
    : defaults.nextEpisodePressure;

  return {
    type,
    intensity,
    hook: `${episode.title} ends by resolving "${immediateResolution}" just enough to expose ${defaults.newOpenQuestion.toLowerCase()}`,
    setup: `Seed the ending through concrete details in the episode buildup; connect it to ${seasonStakes || 'the season stakes'} rather than an unrelated surprise.`,
    resolvedEpisodeTension: episode.narrativeFunction?.resolution || `The immediate tension of "${episode.title}" has a visible consequence.`,
    newOpenQuestion: defaults.newOpenQuestion,
    emotionalCharge: defaults.emotionalCharge,
    nextEpisodePressure: nextPressure,
    storyCircleLaunchBeat: nextLoopLaunchBeatFor(storyCircleBeat, episode.episodeNumber, totalEpisodes),
    style: 'serialized_tv',
  };
}

export function normalizeCliffhangerPlan(
  raw: Partial<CliffhangerPlan> | undefined,
  fallback: CliffhangerPlan,
): CliffhangerPlan {
  return {
    ...fallback,
    ...raw,
    type: raw?.type || fallback.type,
    intensity: raw?.intensity || fallback.intensity,
    hook: raw?.hook || fallback.hook,
    setup: raw?.setup || fallback.setup,
    resolvedEpisodeTension: raw?.resolvedEpisodeTension || fallback.resolvedEpisodeTension,
    newOpenQuestion: raw?.newOpenQuestion || fallback.newOpenQuestion,
    emotionalCharge: raw?.emotionalCharge || fallback.emotionalCharge,
    nextEpisodePressure: raw?.nextEpisodePressure || fallback.nextEpisodePressure,
    storyCircleLaunchBeat: raw?.storyCircleLaunchBeat || fallback.storyCircleLaunchBeat,
    style: 'serialized_tv',
  };
}
