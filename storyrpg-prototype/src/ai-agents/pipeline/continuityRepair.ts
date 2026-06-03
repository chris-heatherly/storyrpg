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

/** Finding types whose fix is a localized prose re-author grounded in canon. */
const REPAIRABLE_TYPES = new Set(['state_conflict', 'impossible_knowledge', 'contradiction']);

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
