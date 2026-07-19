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
import { isUnsafeCoverageMetadataText } from '../utils/coverageMetadataHygiene';

export interface ContinuityFinding {
  severity: 'error' | 'warning' | 'suggestion';
  type: 'contradiction' | 'impossible_knowledge' | 'timeline_error' | 'state_conflict' | 'missing_setup';
  location?: { sceneId?: string; beatId?: string; choiceId?: string };
  description?: string;
  conflictsWith?: string;
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
    if (f.type === 'impossible_knowledge') {
      lines.push(
        '  NON-NEGOTIABLE: make the missing knowledge causally available before the flagged use. '
        + 'Rewrite the flagged beat and, when necessary, the immediately preceding beat so the character asks, '
        + 'is told, or witnesses the name/fact before using it. Do not merely repeat the name in the flagged line; '
        + 'preserve the existing event and relationship stage.',
      );
    }
  }
  if (capabilityFacts.length > 0) {
    lines.push('Respect this established canon — do not contradict it:');
    for (const fact of capabilityFacts) lines.push(`- ${fact}`);
  }
  return lines.join('\n');
}

/**
 * Planned-scene slice consulted for owning-scene retargeting — shaped after
 * SeasonScenePlan.scenes[] (ordered by planned reading order), which is where
 * `sceneEventOwnership` carries the treatment's event plan.
 */
export interface OwnershipPlannedSceneLite {
  id?: string;
  sceneEventOwnership?: { ownedEvents?: Array<{ cue?: string; text?: string }> };
}

export interface MissingSetupOwnerTarget {
  /** Earlier scene that OWNED the dropped setup event — repair adds the introduction here. */
  ownerSceneId: string;
  /** Scene the judge flagged (first on-page use of the unintroduced element) — re-check it after the owner repair. */
  findingSceneId: string;
  cue?: string;
  eventText: string;
  /** The unintroduced entity that linked the finding to the owned event. */
  entity: string;
  finding: ContinuityFinding;
}

/** Capitalized words common in judge prose that are never the missing entity. */
const ENTITY_STOPWORDS = new Set([
  'The', 'A', 'An', 'In', 'On', 'At', 'It', 'Its', 'No', 'Yes', 'She', 'He', 'They', 'Her', 'His', 'Their',
  'This', 'That', 'These', 'Those', 'But', 'And', 'While', 'However', 'Before', 'After', 'When', 'Where',
  'Scene', 'Beat', 'Episode', 'Reader', 'Player', 'Introduce', 'Add', 'Ensure', 'Knows', 'First', 'Second',
]);

function mentionsEntity(text: string, entity: string): boolean {
  const escaped = entity.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\b${escaped}\\b`, 'i').test(text);
}

/**
 * Names of the entity the finding says was used before being introduced.
 * Structured character ids in the finding text (`char-mika-dragan` → mika,
 * dragan) are the strongest signal; otherwise fall back to capitalized tokens
 * from the description minus judge-prose stopwords.
 */
function missingEntityCandidates(finding: ContinuityFinding): string[] {
  const text = [finding.description, finding.conflictsWith, finding.suggestedFix].filter(Boolean).join(' ');
  const fromCharIds = new Set<string>();
  for (const match of text.matchAll(/\bchar-([a-z0-9-]+)\b/gi)) {
    for (const part of match[1].split('-')) {
      if (part.length >= 3) fromCharIds.add(part);
    }
  }
  if (fromCharIds.size > 0) return [...fromCharIds];
  const fromProse = new Set<string>();
  for (const match of (finding.description ?? '').matchAll(/\b[A-Z][a-z]{2,}\b/g)) {
    if (!ENTITY_STOPWORDS.has(match[0])) fromProse.add(match[0]);
  }
  return [...fromProse];
}

/**
 * For each repairable `missing_setup` finding, find the scene that should have
 * SUPPLIED the missing setup: the closest earlier planned scene whose
 * sceneEventOwnership owns an event naming the unintroduced entity. bite-me
 * 2026-07-02T23-54-38: "Mika … speaks in s1-2-b2 [unintroduced]" while planned
 * scene s1-1 owned the socialMeet cue "…forms the Dusk Club with Mika and
 * Stela…" that was never depicted — the introduction belongs in s1-1, not in a
 * same-scene rephrase alone. Pure; returns [] when no ownership plan is
 * available or nothing links.
 */
export function resolveMissingSetupOwnerTargets(
  findings: ContinuityFinding[] | undefined,
  plannedScenes: OwnershipPlannedSceneLite[] | undefined,
): MissingSetupOwnerTarget[] {
  const scenes = plannedScenes ?? [];
  if (scenes.length === 0) return [];
  const out: MissingSetupOwnerTarget[] = [];
  const seen = new Set<string>();
  for (const finding of selectRepairableContinuityFindings(findings)) {
    if (finding.type !== 'missing_setup') continue;
    const findingSceneId = finding.location!.sceneId!;
    const useIdx = scenes.findIndex((scene) => scene.id === findingSceneId);
    if (useIdx <= 0) continue; // scene not in the plan, or nothing precedes it
    const entities = missingEntityCandidates(finding);
    if (entities.length === 0) continue;
    for (let i = useIdx - 1; i >= 0; i -= 1) {
      const scene = scenes[i];
      if (!scene.id) continue;
      const event = (scene.sceneEventOwnership?.ownedEvents ?? []).find((owned) =>
        typeof owned.text === 'string' && entities.some((entity) => mentionsEntity(owned.text!, entity)),
      );
      if (!event) continue;
      const entity = entities.find((candidate) => mentionsEntity(event.text ?? '', candidate))!;
      const key = `${scene.id}::${findingSceneId}`;
      if (!seen.has(key)) {
        seen.add(key);
        out.push({
          ownerSceneId: scene.id,
          findingSceneId,
          cue: event.cue,
          eventText: event.text ?? '',
          entity,
          finding,
        });
      }
      break; // closest preceding owner wins
    }
  }
  return out;
}

/**
 * Grounding guidance for re-authoring the OWNING scene of a dropped setup
 * event: stage the introduction here, on-page, so the later use-site reads as
 * set up. The sibling of {@link buildContinuityRepairGuidance}, which handles
 * same-scene repairs of the flagged scene itself.
 */
export function buildMissingSetupOwnerGuidance(
  target: MissingSetupOwnerTarget,
  capabilityFacts: string[],
): string {
  const displayEntity = target.entity.charAt(0).toUpperCase() + target.entity.slice(1);
  const lines: string[] = [
    `This scene owned a planned story event that never made it on-page${target.cue ? ` (cue: ${target.cue})` : ''}:`,
    `- ${target.eventText}`,
    `A later scene (${target.findingSceneId}) uses ${displayEntity} without any prior on-page introduction:`,
    `- ${target.finding.description ?? 'missing setup'}${target.finding.suggestedFix ? ` (suggested: ${target.finding.suggestedFix})` : ''}`,
    `Rework this scene's existing beats so the introduction of ${displayEntity} happens HERE, in reader-facing prose. Keep every other staged moment intact.`,
  ];
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
  visualMoment?: string;
  primaryAction?: string;
}

/** When beat.text was rewritten but visual metadata still holds treatment synopsis, re-derive from text. */
function syncUnsafeVisualMetadataFromText(beat: MergeableBeat): void {
  const text = typeof beat.text === 'string' ? beat.text.trim() : '';
  if (!text || isUnsafeCoverageMetadataText(text)) return;
  const sentence = text.split(/(?<=[.!?])\s+/)[0]?.trim() || text;
  if (typeof beat.visualMoment === 'string' && isUnsafeCoverageMetadataText(beat.visualMoment)) {
    beat.visualMoment = sentence;
  }
  if (typeof beat.primaryAction === 'string' && isUnsafeCoverageMetadataText(beat.primaryAction)) {
    beat.primaryAction = sentence;
  }
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
 * by beat id and replacing prose (`text` and, when provided, `textVariants`).
 * When a rewrite clears text but visualMoment/primaryAction still hold treatment
 * synopsis (RouteContinuity unsafe_fallback_prose), re-derive those fields from
 * the new text so metadata cannot re-trigger the same gate.
 * Ids, navigation, and choice points are never touched. Returns the
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
        syncUnsafeVisualMetadataFromText(beat);
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
  // Assembly copies storylet beat prose verbatim into sibling encounter fields
  // (outcomes[tier].outcomeText, cost.immediateEffect, visualContract fields,
  // ...). A rewrite that only touches the beat leaves those copies carrying
  // the OLD text — which made forbidden-wording findings unclearable by their
  // own repair route (batch r129, 2026-07-19: "The Mountain" survived in six
  // copied fields after every beat rewrite). Track before→after pairs and
  // propagate to exact-match copies across the encounter after the merge.
  const rewrittenTextByOriginal = new Map<string, string>();
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
      if (beat.setupText && beat.setupText !== rewrite.text) rewrittenTextByOriginal.set(beat.setupText, rewrite.text);
      beat.setupText = rewrite.text;
      if (rewrite.textVariants !== undefined) beat.setupTextVariants = rewrite.textVariants;
    } else {
      if (typeof beat.text === 'string' && beat.text && beat.text !== rewrite.text) rewrittenTextByOriginal.set(beat.text, rewrite.text);
      beat.text = rewrite.text;
      if (rewrite.textVariants !== undefined) beat.textVariants = rewrite.textVariants;
    }
    consumed.add(beat.id as string);
    merged += 1;
  };
  const propagateExactCopies = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const item of node) propagateExactCopies(item);
      return;
    }
    if (!node || typeof node !== 'object') return;
    const record = node as Record<string, unknown>;
    for (const key of Object.keys(record)) {
      const value = record[key];
      if (typeof value === 'string') {
        const replacement = rewrittenTextByOriginal.get(value);
        if (replacement !== undefined) record[key] = replacement;
      } else {
        propagateExactCopies(value);
      }
    }
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
      // Exact-full-string matches only — this is bookkeeping (keeping copies
      // consistent with their rewritten source), never new prose authorship.
      if (rewrittenTextByOriginal.size > 0) propagateExactCopies(scene.encounter);
    }
  }
  reportUnmatchedRewrites(rewrittenBeats, consumed, onUnmatched);
  return merged;
}
