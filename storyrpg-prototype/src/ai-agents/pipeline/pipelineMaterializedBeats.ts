/**
 * Pipeline-materialized navigation beats (run 2026-07-16T03-12-37).
 *
 * Choice payoff/bridge beats are created by the PIPELINE after choice
 * authoring — their prose is LLM-authored outcome text, but SceneWriter never
 * sees them as its own. The post-choice POV/voice regeneration replaced
 * s1-1's beats wholesale with fresh SceneWriter output, silently dropping the
 * three payoff beats while the choice set kept routing to them
 * (broken_navigation at the episode contract; three repair rounds had no
 * claimant).
 *
 * Invariant: a regen swap may replace SceneWriter-authored beats, never
 * pipeline-materialized navigation beats. Deterministic code only COPIES
 * already-authored prose here — it never writes reader-facing text.
 */

interface NavigableBeat {
  id?: string;
  isChoicePayoff?: boolean;
  isChoiceBridge?: boolean;
}

export function isPipelineMaterializedBeat(beat: NavigableBeat | undefined): boolean {
  if (!beat) return false;
  if (beat.isChoicePayoff === true || beat.isChoiceBridge === true) return true;
  return typeof beat.id === 'string' && /-payoff-\d+$/.test(beat.id);
}

/**
 * Returns the revised beat list with any pipeline-materialized beats from the
 * previous version re-attached (appended in their original order) when the
 * rewrite dropped them. Ids already present in the revision are left alone.
 */
export function preservePipelineMaterializedBeats<T extends NavigableBeat>(
  previousBeats: ReadonlyArray<T> | undefined,
  revisedBeats: T[] | undefined,
): T[] {
  const revised = [...(revisedBeats ?? [])];
  const revisedIds = new Set(revised.map((beat) => beat.id).filter(Boolean));
  for (const beat of previousBeats ?? []) {
    if (!isPipelineMaterializedBeat(beat)) continue;
    if (beat.id && revisedIds.has(beat.id)) continue;
    revised.push(beat);
  }
  return revised;
}
