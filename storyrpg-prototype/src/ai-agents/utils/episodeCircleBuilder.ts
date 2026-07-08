import type {
  StoryCircleBeat,
  StoryCircleRoleAssignment,
  StoryCircleStructure,
} from '../../types/sourceAnalysis';
import { STORY_CIRCLE_BEATS } from '../../types/sourceAnalysis';
import { storyCircleRoleBeats } from './storyCircleDistribution';
import { splitCompoundSentence, splitTreatmentSentences } from './treatmentEventAtomizer';

export interface ScopedEpisodeCircleInput {
  episodeNumber: number;
  episodeTitle: string;
  synopsis: string;
  majorPressure?: string;
  episodeTurns?: string[];
  storyCircleRole?: StoryCircleRoleAssignment[];
  arc?: Partial<StoryCircleStructure>;
  isFutureSeasonScopedText?: (text: string) => boolean;
}

const BEAT_TEMPLATES: Record<StoryCircleBeat, (title: string, body: string) => string> = {
  you: (title, body) => `In "${title}", establish the episode's known world or current normal before disruption: ${body}`,
  need: (_title, body) => `Name the episode want/lack that starts motion and makes the pressure active: ${body}`,
  go: (_title, body) => `Cross the episode threshold so old tactics stop working: ${body}`,
  search: (_title, body) => `Test adaptation under pressure through failed plans, new rules, allies, tools, and identity-revealing choices: ${body}`,
  find: (_title, body) => `Deliver the episode's wanted answer, access, proof, intimacy, power, rescue, status, or apparent victory: ${body}`,
  take: (_title, body) => `Make the episode's find cost something visible: ${body}`,
  return: (_title, body) => `Carry the prize and wound back toward the episode's consequence field, relationship, home, arena, or public identity: ${body}`,
  change: (_title, body) => `Prove the episode's new equilibrium through changed behavior, relationship, self-concept, world-state, or tragic refusal: ${body}`,
};

function localArcText(
  arc: Partial<StoryCircleStructure> | undefined,
  beat: StoryCircleBeat,
  isFutureSeasonScopedText?: (text: string) => boolean,
): string | undefined {
  const text = arc?.[beat]?.trim();
  if (!text) return undefined;
  if (isFutureSeasonScopedText?.(text)) return undefined;
  return text;
}

export function flattenAuthoredEpisodeTurns(turns: string[] | undefined): string[] {
  if (!turns?.length) return [];
  const out: string[] = [];
  for (const turn of turns) {
    for (const sentence of splitTreatmentSentences(turn)) {
      for (const fragment of splitCompoundSentence(sentence)) {
        const trimmed = fragment.trim();
        if (trimmed.length >= 12) out.push(trimmed);
      }
    }
  }
  return Array.from(new Set(out));
}

function beatBodyFromTurns(
  beat: StoryCircleBeat,
  turns: string[],
  majorPressure?: string,
  synopsis?: string,
): string | undefined {
  if (turns.length === 0) {
    if (beat === 'need') return majorPressure || synopsis;
    if (beat === 'you') return synopsis;
    return undefined;
  }
  const last = turns.length - 1;
  switch (beat) {
    case 'you':
      return turns.slice(0, Math.min(2, turns.length)).join(' ');
    case 'need':
      return majorPressure || turns[0];
    case 'go':
      return turns[Math.min(2, last)] || turns[0];
    case 'search':
      return turns[Math.max(0, last - 2)] || turns[Math.floor(last / 2)];
    case 'find':
      return turns[Math.max(0, last - 1)] || turns[last];
    case 'take':
      return turns[Math.max(0, last - 1)] || turns[last];
    case 'return':
      return turns[last];
    case 'change':
      return turns[last];
    default:
      return undefined;
  }
}

function synopsisLooksLikeFullEpisodeDump(body: string | undefined, synopsis: string | undefined): boolean {
  if (!body?.trim() || !synopsis?.trim()) return false;
  const normalizedBody = body.trim().toLowerCase();
  const normalizedSynopsis = synopsis.trim().toLowerCase();
  return normalizedBody === normalizedSynopsis || normalizedSynopsis.includes(normalizedBody.slice(0, 80));
}

/**
 * Build episode-level Story Circle guidance scoped to the beats this episode
 * actually carries. Inactive beats stay empty so validators and SceneWriter
 * prompts are not flooded with the full episode synopsis repeated eight times.
 */
export function buildScopedEpisodeCircle(input: ScopedEpisodeCircleInput): StoryCircleStructure {
  const activeBeats = storyCircleRoleBeats(input.storyCircleRole);
  const scopeAllBeats = activeBeats.length === 0;
  const turns = flattenAuthoredEpisodeTurns(input.episodeTurns);
  const circle = {} as StoryCircleStructure;

  for (const beat of STORY_CIRCLE_BEATS) {
    if (!scopeAllBeats && !activeBeats.includes(beat)) {
      circle[beat] = '';
      continue;
    }

    let body = localArcText(input.arc, beat, input.isFutureSeasonScopedText)
      || beatBodyFromTurns(beat, turns, input.majorPressure, input.synopsis)
      || '';

    if (!body.trim() && scopeAllBeats) {
      body = input.synopsis?.trim() || '';
    }

    if (!body.trim()) {
      circle[beat] = '';
      continue;
    }

    if (synopsisLooksLikeFullEpisodeDump(body, input.synopsis) && turns.length > 1) {
      const sliced = beatBodyFromTurns(beat, turns, input.majorPressure, undefined);
      if (sliced?.trim()) body = sliced;
    }

    circle[beat] = BEAT_TEMPLATES[beat](input.episodeTitle, body);
  }

  return circle;
}
