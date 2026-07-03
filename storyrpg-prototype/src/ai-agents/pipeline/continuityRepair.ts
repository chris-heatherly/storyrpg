/**
 * Continuity repair selection + guidance (Season Canon, Phase B).
 *
 * The ContinuityChecker emits structured findings (state_conflict /
 * impossible_knowledge / ...). The character-consistency class (a scholar doing
 * "blade-work") is best PREVENTED by grounding the writer in capability canon, but
 * when one slips through we want a scoped, canon-grounded re-author rather than a
 * blanket regen. This pure module picks the findings worth repairing and builds the
 * grounding guidance to hand to the re-author; the LLM call + apply stays a thin
 * call site in the pipeline (regen-verified).
 *
 * Pure + unit-testable.
 */

import { findUnconsumed } from './reliabilityGuards';

export interface ContinuityFinding {
  severity: 'error' | 'warning' | 'suggestion';
  type: 'contradiction' | 'impossible_knowledge' | 'timeline_error' | 'state_conflict' | 'missing_setup';
  location?: { sceneId?: string; beatId?: string; choiceId?: string };
  description?: string;
  suggestedFix?: string;
}

/**
 * A SceneCritic rewrite is applied by matching `beat.id`. A rewrite whose id
 * matches NO target beat (the scene drifted/renamed its beat ids after the
 * critique) is silently dropped — the repair looks like it ran but changed
 * nothing, so the final-contract gate keeps failing with no signal. Surface those
 * unmatched rewrite ids to the optional callback so the caller can warn. No-op
 * when every rewrite matched (the clean path) or no callback is supplied.
 */
function reportUnmatchedRewrites(
  rewrittenBeats: MergeableBeat[],
  consumedBeatIds: ReadonlySet<string>,
  onUnmatched?: (unmatchedRewriteIds: string[]) => void,
): void {
  if (!onUnmatched) return;
  const unmatched = findUnconsumed(rewrittenBeats, consumedBeatIds, (b) => b.id).map((b) => b.id as string);
  if (unmatched.length > 0) onUnmatched(unmatched);
}

/**
 * Finding types whose fix is a localized prose re-author grounded in canon.
 * `timeline_error` (e.g. an observation placed in the wrong scene relative to the
 * timeline) is scene-anchored and carries a concrete suggestedFix, so it is repaired
 * the same way — re-authoring the flagged beat to honor the corrected sequence.
 * `missing_setup` is the same shape when it points at a scene: the judge's
 * suggestedFix is a same-scene rephrase ("introduce her as 'a friend' before
 * naming her") — bite-me 2026-07-02T23-54-38 aborted a QA-91 episode on one
 * missing_setup error the repair pass classified as unrepairable and never
 * attempted. Findings whose real fix lives in an earlier scene simply fail the
 * re-check and the gate still holds.
 */
const REPAIRABLE_TYPES = new Set(['state_conflict', 'impossible_knowledge', 'contradiction', 'timeline_error', 'missing_setup']);

/**
 * Pick repairable continuity findings: blocking-ish (error) defects of a prose
 * contradiction type that point at a concrete scene. Deduped by scene+description.
 */
export function selectRepairableContinuityFindings(findings: ContinuityFinding[] | undefined): ContinuityFinding[] {
  const out: ContinuityFinding[] = [];
  const seen = new Set<string>();
  for (const f of findings ?? []) {
    if (f.severity !== 'error') continue;
    if (!REPAIRABLE_TYPES.has(f.type)) continue;
    if (!f.location?.sceneId) continue;
    const key = `${f.location.sceneId}::${f.description ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(f);
  }
  return out;
}

/** Scenes (ids) that have at least one repairable continuity finding. */
export function scenesNeedingRepair(findings: ContinuityFinding[] | undefined): string[] {
  return [...new Set(selectRepairableContinuityFindings(findings).map((f) => f.location!.sceneId!))];
}

/**
 * Build the grounding guidance injected into a re-author for a scene: the specific
 * contradictions to fix plus the capability canon facts to respect. Returns '' when
 * there is nothing to repair for the scene.
 */
export function buildContinuityRepairGuidance(
  sceneId: string,
  findings: ContinuityFinding[] | undefined,
  capabilityFacts: string[],
): string {
  const forScene = selectRepairableContinuityFindings(findings).filter((f) => f.location?.sceneId === sceneId);
  if (forScene.length === 0) return '';
  const lines: string[] = ['Fix these continuity contradictions (do not introduce new ones):'];
  for (const f of forScene) {
    lines.push(`- ${f.description ?? f.type}${f.suggestedFix ? ` (suggested: ${f.suggestedFix})` : ''}`);
  }
  if (capabilityFacts.length > 0) {
    lines.push('Respect this established canon — do not contradict it:');
    for (const fact of capabilityFacts) lines.push(`- ${fact}`);
  }
  return lines.join('\n');
}

interface MergeableBeat {
  id?: string;
  text?: string;
  textVariants?: unknown;
}
/**
 * Encounter prose beats carry their text in different fields than flat scene
 * beats: PHASE beats use `setupText`/`setupTextVariants`, STORYLET beats use
 * `text`/`textVariants`. The merge must write back to the SAME field the beat
 * reads from, or a rewrite into `text` would be invisible on a phase beat.
 */
interface MergeableEncounterBeat extends MergeableBeat {
  setupText?: string;
  setupTextVariants?: unknown;
}
interface MergeableEncounter {
  phases?: Array<{ beats?: MergeableEncounterBeat[] }>;
  storylets?: Array<{ beats?: MergeableEncounterBeat[] }> | Record<string, { beats?: MergeableEncounterBeat[] }>;
}
interface MergeableScene {
  id?: string;
  beats?: MergeableBeat[];
  encounter?: MergeableEncounter;
}
interface MergeableStory {
  episodes?: Array<{ scenes?: MergeableScene[] }>;
}

/** Scene-content shape for the re-validation merge (keyed on sceneId, unlike story scenes which key on id). */
interface MergeableSceneContent {
  sceneId?: string;
  beats?: MergeableBeat[];
}

/**
 * Apply SceneCritic-rewritten beats to the in-memory SceneContent list (the input
 * the ContinuityChecker re-reads), matching by beat id and replacing ONLY prose.
 * The sibling of {@link mergeRewrittenBeatsIntoStory} for the re-validation path —
 * the checker re-reads sceneContents, not the assembled story, so both must carry
 * the repaired prose for the post-repair re-check to see the fix. Returns the
 * number of beats updated. Pure (mutates in place). Unit-testable.
 */
export function applyRewrittenBeatsToSceneContents(
  sceneContents: MergeableSceneContent[] | undefined,
  sceneId: string,
  rewrittenBeats: MergeableBeat[] | undefined,
  onUnmatched?: (unmatchedRewriteIds: string[]) => void,
): number {
  if (!rewrittenBeats?.length) return 0;
  const byId = new Map(rewrittenBeats.filter((b) => b.id).map((b) => [b.id as string, b]));
  const consumed = new Set<string>();
  let merged = 0;
  for (const scene of sceneContents ?? []) {
    if (scene.sceneId !== sceneId) continue;
    for (const beat of scene.beats ?? []) {
      const rewrite = beat.id ? byId.get(beat.id) : undefined;
      if (!rewrite) continue;
      if (typeof rewrite.text === 'string' && rewrite.text.trim()) beat.text = rewrite.text;
      if (rewrite.textVariants !== undefined) beat.textVariants = rewrite.textVariants;
      consumed.add(beat.id as string);
      merged += 1;
    }
  }
  reportUnmatchedRewrites(rewrittenBeats, consumed, onUnmatched);
  return merged;
}

/**
 * Refresh a continuity issue list with the result of a post-repair re-check.
 *
 * For every scene we actually re-authored AND re-validated, the FRESH findings are
 * authoritative — so drop the original findings for those scenes and adopt the
 * re-check's residue for them. Findings for scenes we did NOT re-validate are kept
 * verbatim (we hold no fresh opinion on them). This is what lets a blocking gate
 * fire only on genuinely-unfixed continuity errors instead of on stale pre-repair
 * findings. Conservative: a second-opinion finding in an UN-repaired scene is NOT
 * adopted (we never manufacture new blocking issues from the re-check). Pure.
 */
export function mergeRevalidatedContinuityIssues<T extends { location?: { sceneId?: string } }>(
  original: T[] | undefined,
  revalidatedSceneIds: Iterable<string>,
  freshIssues: T[] | undefined,
): T[] {
  const revalidated = new Set(revalidatedSceneIds);
  const kept = (original ?? []).filter(
    (issue) => !(issue.location?.sceneId && revalidated.has(issue.location.sceneId)),
  );
  const adopted = (freshIssues ?? []).filter(
    (issue) => issue.location?.sceneId != null && revalidated.has(issue.location.sceneId),
  );
  return [...kept, ...adopted];
}

/**
 * Merge SceneCritic-rewritten beats back into an already-assembled story, matching
 * by beat id and replacing ONLY prose (`text` and, when provided, `textVariants`).
 * Ids, navigation, choice points, and visual fields are never touched. Returns the
 * number of beats updated. Pure (mutates the passed story in place, like the rest
 * of the assembly path) — unit-testable.
 */
export function mergeRewrittenBeatsIntoStory(
  story: MergeableStory,
  sceneId: string,
  rewrittenBeats: MergeableBeat[] | undefined,
  onUnmatched?: (unmatchedRewriteIds: string[]) => void,
): number {
  if (!rewrittenBeats?.length) return 0;
  const byId = new Map(rewrittenBeats.filter((b) => b.id).map((b) => [b.id as string, b]));
  const consumed = new Set<string>();
  let merged = 0;
  for (const episode of story.episodes ?? []) {
    for (const scene of episode.scenes ?? []) {
      if (scene.id !== sceneId) continue;
      for (const beat of scene.beats ?? []) {
        const rewrite = beat.id ? byId.get(beat.id) : undefined;
        if (!rewrite) continue;
        if (typeof rewrite.text === 'string' && rewrite.text.trim()) beat.text = rewrite.text;
        if (rewrite.textVariants !== undefined) beat.textVariants = rewrite.textVariants;
        consumed.add(beat.id as string);
        merged += 1;
      }
    }
  }
  reportUnmatchedRewrites(rewrittenBeats, consumed, onUnmatched);
  return merged;
}

/**
 * Encounter-scene counterpart to {@link mergeRewrittenBeatsIntoStory}. Encounter
 * prose lives in `encounter.phases[].beats` and `encounter.storylets[].beats`,
 * not `scene.beats`, so a SignatureDevicePresence/RequiredBeatRealization repair
 * on a `treatment-enc-*` scene has to merge there. Each rewritten beat is matched
 * by id and written back to the field that beat actually uses for prose — `text`
 * for storylet beats, `setupText` for phase beats (and the matching `*Variants`).
 * Returns the number of encounter beats updated. Mutates in place; unit-testable.
 */
export function mergeRewrittenEncounterBeatsIntoStory(
  story: MergeableStory,
  sceneId: string,
  rewrittenBeats: MergeableBeat[] | undefined,
  onUnmatched?: (unmatchedRewriteIds: string[]) => void,
): number {
  if (!rewrittenBeats?.length) return 0;
  const byId = new Map(rewrittenBeats.filter((b) => b.id).map((b) => [b.id as string, b]));
  const consumed = new Set<string>();
  let merged = 0;
  const applyToBeat = (beat: MergeableEncounterBeat): void => {
    const rewrite = beat.id ? byId.get(beat.id) : undefined;
    if (!rewrite || typeof rewrite.text !== 'string' || !rewrite.text.trim()) return;
    // Write back to whichever field the beat reads its prose from. A phase beat
    // with prose in `setupText` (and an empty/absent `text`) must NOT have the
    // rewrite dropped into `text` where nothing renders it.
    const usesSetupText =
      (beat.text === undefined || beat.text === '') &&
      typeof beat.setupText === 'string' && beat.setupText.length > 0;
    if (usesSetupText) {
      beat.setupText = rewrite.text;
      if (rewrite.textVariants !== undefined) beat.setupTextVariants = rewrite.textVariants;
    } else {
      beat.text = rewrite.text;
      if (rewrite.textVariants !== undefined) beat.textVariants = rewrite.textVariants;
    }
    consumed.add(beat.id as string);
    merged += 1;
  };
  for (const episode of story.episodes ?? []) {
    for (const scene of episode.scenes ?? []) {
      if (scene.id !== sceneId || !scene.encounter) continue;
      for (const phase of scene.encounter.phases ?? []) {
        for (const beat of phase.beats ?? []) applyToBeat(beat);
      }
      const storylets = Array.isArray(scene.encounter.storylets)
        ? scene.encounter.storylets
        : Object.values(scene.encounter.storylets ?? {});
      for (const storylet of storylets) {
        for (const beat of storylet?.beats ?? []) applyToBeat(beat);
      }
    }
  }
  reportUnmatchedRewrites(rewrittenBeats, consumed, onUnmatched);
  return merged;
}
