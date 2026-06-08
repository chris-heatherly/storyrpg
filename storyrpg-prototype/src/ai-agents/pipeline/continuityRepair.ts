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

export interface ContinuityFinding {
  severity: 'error' | 'warning' | 'suggestion';
  type: 'contradiction' | 'impossible_knowledge' | 'timeline_error' | 'state_conflict' | 'missing_setup';
  location?: { sceneId?: string; beatId?: string; choiceId?: string };
  description?: string;
  suggestedFix?: string;
}

/**
 * Finding types whose fix is a localized prose re-author grounded in canon.
 * `timeline_error` (e.g. an observation placed in the wrong scene relative to the
 * timeline) is scene-anchored and carries a concrete suggestedFix, so it is repaired
 * the same way — re-authoring the flagged beat to honor the corrected sequence.
 */
const REPAIRABLE_TYPES = new Set(['state_conflict', 'impossible_knowledge', 'contradiction', 'timeline_error']);

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
interface MergeableScene {
  id?: string;
  beats?: MergeableBeat[];
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
): number {
  if (!rewrittenBeats?.length) return 0;
  const byId = new Map(rewrittenBeats.filter((b) => b.id).map((b) => [b.id as string, b]));
  let merged = 0;
  for (const scene of sceneContents ?? []) {
    if (scene.sceneId !== sceneId) continue;
    for (const beat of scene.beats ?? []) {
      const rewrite = beat.id ? byId.get(beat.id) : undefined;
      if (!rewrite) continue;
      if (typeof rewrite.text === 'string' && rewrite.text.trim()) beat.text = rewrite.text;
      if (rewrite.textVariants !== undefined) beat.textVariants = rewrite.textVariants;
      merged += 1;
    }
  }
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
): number {
  if (!rewrittenBeats?.length) return 0;
  const byId = new Map(rewrittenBeats.filter((b) => b.id).map((b) => [b.id as string, b]));
  let merged = 0;
  for (const episode of story.episodes ?? []) {
    for (const scene of episode.scenes ?? []) {
      if (scene.id !== sceneId) continue;
      for (const beat of scene.beats ?? []) {
        const rewrite = beat.id ? byId.get(beat.id) : undefined;
        if (!rewrite) continue;
        if (typeof rewrite.text === 'string' && rewrite.text.trim()) beat.text = rewrite.text;
        if (rewrite.textVariants !== undefined) beat.textVariants = rewrite.textVariants;
        merged += 1;
      }
    }
  }
  return merged;
}
