/**
 * Shared prose-tense heuristics.
 *
 * The story's narration convention is PRESENT tense (fiction-first, live
 * second-person action); past tense is reserved for explicit memories,
 * backstory, and recaps. These helpers are the single source of truth for
 * detecting past-tense live-action narration so the scene-time check
 * (ContentGenerationPhase), the final-contract validator
 * (NarrativeFailureModeValidator), and the deterministic repair handler
 * (tenseDriftRepairHandler) all agree on what "drifted" means — bite-me
 * 2026-07-05T20-47-31 shipped a whole scene (s1-2) in past tense that only
 * surfaced at the final contract, hours after it was cheap to fix.
 */

export const PAST_TENSE_LIVE_ACTION =
  /\b(?:you|your|the|a|an|he|she|it|they|[A-Z][a-z]+)\s+(?:was|were|had|did|didn't|felt|took|saw|heard|watched|looked|stepped|turned|reached|held|laughed|asked|said|met|found|made|walked|ran|wrote|gave|opened|closed|kept|thought|knew|wanted|needed|clicked|shattered|followed|stopped|bled)\b/g;

export const PAST_EVENT_MARKER =
  /\b(?:remember|remembers|remembered|memory|back then|before you arrived|earlier|last night|yesterday|years? ago|once|used to|had been|had already|when you were|as a child|in 19\d{2}|in 20\d{2})\b/i;

export function hasPastEventMarker(text: string): boolean {
  return PAST_EVENT_MARKER.test(text);
}

export function stripQuotedDialogue(text: string): string {
  return text.replace(/"[^"]*"/g, ' ').replace(/\u201c[^\u201d]*\u201d/g, ' ');
}

/** Past-tense live-action matches in a beat's narration (dialogue stripped). */
export function pastTenseLiveActionMatches(text: string): number {
  const narrationOnly = stripQuotedDialogue(text);
  return (narrationOnly.match(PAST_TENSE_LIVE_ACTION) ?? []).length;
}

export interface SceneTenseCensus {
  /** Narration beats without an explicit past-event marker (the checkable surface). */
  eligibleBeats: number;
  /** Eligible beats whose narration reads as past-tense live action. */
  driftedBeats: number;
  driftedBeatIds: string[];
}

interface CensusBeat {
  id?: string;
  text?: unknown;
}

/**
 * Census a scene's beats for past-tense live-action narration. A beat counts
 * as drifted with >= 2 subject+past-verb pairs in its (dialogue-stripped)
 * narration — slightly looser than the validator's per-beat blocking
 * threshold (3) so the census sees the whole drifted scene, not only its
 * densest beats.
 */
export function sceneTenseCensus(beats: CensusBeat[] | undefined): SceneTenseCensus {
  const census: SceneTenseCensus = { eligibleBeats: 0, driftedBeats: 0, driftedBeatIds: [] };
  for (const beat of beats ?? []) {
    const text = typeof beat.text === 'string' ? beat.text : '';
    if (!text || hasPastEventMarker(text)) continue;
    census.eligibleBeats += 1;
    if (pastTenseLiveActionMatches(text) >= 2) {
      census.driftedBeats += 1;
      if (beat.id) census.driftedBeatIds.push(beat.id);
    }
  }
  return census;
}

/**
 * Scene-wide drift = the scene's narration convention itself is wrong (the
 * writer chose past tense), not one beat slipping: at least 3 drifted beats
 * making up at least half of the checkable narration.
 */
export function isSceneWideTenseDrift(census: SceneTenseCensus): boolean {
  return census.driftedBeats >= 3 && census.driftedBeats * 2 >= census.eligibleBeats;
}
