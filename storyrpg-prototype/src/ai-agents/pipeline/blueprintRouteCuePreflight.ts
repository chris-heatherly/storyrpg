import type { EpisodeBlueprint, SceneBlueprint } from '../agents/StoryArchitect';
import {
  detectStoryEventCues,
  isQuestionShapedAnchor,
  STORY_EVENT_CUE_ORDER,
  type StoryEventCue,
} from '../remediation/storyEventCues';
import { isGenericPlannerTurnScaffold } from '../utils/sceneContractBuilders';

type RouteCue = Extract<
  StoryEventCue,
  'arrival' | 'venueDoor' | 'objectHandoff' | 'socialMeet' | 'threatEncounter' | 'lateNightWriting' | 'antagonistContact' | 'blogAftermath'
>;

export interface BlueprintRouteCueIssue {
  type: 'route_chronology_violation' | 'route_duplicate_event' | 'helper_owns_prerequisite_event';
  sceneId: string;
  message: string;
}

interface CueHit {
  cue: RouteCue;
  order: number;
  sceneId: string;
}

const DUPLICATE_SENSITIVE_CUES = new Set<RouteCue>([
  'venueDoor',
  'objectHandoff',
  'threatEncounter',
  // The hidden watcher's first contact is a one-time reveal (bite-me
  // 2026-07-03 planned it into three scenes; keep in sync with
  // RouteContinuityValidator + sceneEventOwnership twins).
  'antagonistContact',
  'blogAftermath',
]);

const RECAP_MARKERS = /\b(?:after|aftermath|earlier|remember|recap|blog|post|comments|viral|told|story about|turns?.{0,80}into)\b/i;
const PUBLIC_AFTERMARKERS = /\b(?:readership|reads?|viral|views?|comments?|dashboard|profile|public pressure|public signal|attention spike|audience growth)\b/i;
const BLOG_DRAFT_MARKERS = /\b(?:[234]\s*a\.?\s*m\.?|[234]\s*am|late night|unable to sleep|draft|blank page|publish button|publishes|published|codename)\b|(?:\b(?:writes?|writing|drafts?)\b.{0,100}\b(?:blog|post|column|newsletter|site|account|feed|journal|diary|publication|dispatch|public account|public story|anonymous story|anonymous post|codename|title)\b)|(?:\b(?:blog|post|column|newsletter|site|account|feed|journal|diary|publication|dispatch|public account|public story|anonymous story|anonymous post|codename|title)\b.{0,100}\b(?:writes?|writing|drafts?)\b)/i;
const THREAT_PREREQUISITE_MARKERS = /\b(?:attack|attacked|attacker|ambush|terror|rescue|rescued|rescuer|saved|saves|threat|knife|scream|rough hands|grabbed|pinned)\b/i;
const LIVE_THREAT_ACTION_MARKERS = /\b(?:attack|attacked|attacker|ambush|knife|scream|rough hands|grab(?:s|bed)?|pinned|corners?|lunges?|chases?|fight back|don'?t scream)\b/i;

function isConstructionActive(slot: string | undefined): boolean {
  return slot === 'primary_turn' || slot === 'must_stage' || slot === 'must_support';
}

function activeConstructionIds(scene: SceneBlueprint, source: string): Set<string> | undefined {
  const obligations = scene.sceneConstructionProfile?.obligations;
  if (!obligations) return undefined;
  return new Set(obligations
    .filter((item) => item.source === source && item.id && isConstructionActive(item.slot))
    .map((item) => item.id));
}

function visibleRequiredBeats(scene: SceneBlueprint): NonNullable<SceneBlueprint['requiredBeats']> {
  const activeIds = activeConstructionIds(scene, 'requiredBeat');
  return (scene.requiredBeats ?? []).filter((beat) => {
    if (activeIds) return activeIds.has(beat.id);
    return beat.tier !== 'seed' && beat.tier !== 'connective';
  });
}

function visibleKeyBeats(scene: SceneBlueprint): string[] {
  const activeIds = activeConstructionIds(scene, 'keyBeat');
  if (!activeIds) return scene.keyBeats ?? [];
  return (scene.keyBeats ?? []).filter((_, index) => activeIds.has(`keyBeat:${index}`));
}

/**
 * Reduce a planning field to its staging-relevant text before cue detection.
 * Question-shaped text asks — it never stages an event (a release scene whose
 * every field was the episode question "Can Kylie start over … and write under
 * her own name…?" plus a "The blog, …" anchor summary read as a staged
 * lateNightWriting and hard-aborted the run, bite-me 2026-07-07 s1-7). Planner
 * scaffold turns are whole-episode summaries and must not confer cues either
 * (same rule sceneEventOwnership already applies).
 */
function cueDetectionText(value: string | undefined): string {
  const text = (value ?? '').trim();
  if (!text) return '';
  if (isQuestionShapedAnchor(text)) return '';
  if (isGenericPlannerTurnScaffold(text)) return '';
  // Strip interrogative sentences; keep declarative remainder.
  return text
    .split(/(?<=[.!?])\s+/)
    .filter((sentence) => !/\?\s*$/.test(sentence.trim()))
    .join(' ')
    .trim();
}

function sceneCueFields(scene: SceneBlueprint): string[] {
  return [
    scene.id,
    scene.name,
    scene.description,
    scene.location,
    scene.timeOfDay,
    scene.narrativeFunction,
    scene.dramaticPurpose,
    scene.signatureMoment,
    scene.turnContract?.centralTurn,
    scene.choicePoint?.description,
    ...(scene.choicePoint?.optionHints ?? []),
    ...visibleKeyBeats(scene),
    ...visibleRequiredBeats(scene).map((beat) => beat.mustDepict),
  ]
    .map((value) => cueDetectionText(typeof value === 'string' ? value : undefined))
    .filter((value) => value.length > 0);
}

function cueHits(scene: SceneBlueprint): CueHit[] {
  // Detect per field, then union: an action verb in one field must not pair
  // with an object noun in a different field (cross-field conflation is how
  // "write" in a scene name + "blog" in narrativeFunction became a staged
  // writing event).
  const fields = sceneCueFields(scene);
  const joined = fields.join('\n');
  const isPublicRecap = RECAP_MARKERS.test(joined) && PUBLIC_AFTERMARKERS.test(joined);
  const cues = new Set<StoryEventCue>();
  for (const field of fields) {
    for (const cue of detectStoryEventCues(field)) cues.add(cue);
  }
  const hits: CueHit[] = [];
  for (const cue of cues) {
    const order = STORY_EVENT_CUE_ORDER[cue];
    if (typeof order !== 'number') continue;
    if (cue !== 'blogAftermath' && isPublicRecap) continue;
    hits.push({ cue: cue as RouteCue, order, sceneId: scene.id });
  }
  return hits.sort((a, b) => a.order - b.order);
}

function isPublicAftermathScene(scene: SceneBlueprint): boolean {
  const origin = scene.planningOrigin;
  if (origin?.kind === 'binder_split' && (origin.splitKind === 'viral_aftermath' || origin.splitKind === 'public_blog_aftermath')) {
    return true;
  }
  if (/blog-aftermath|public.*aftermath|viral.*aftermath/i.test(scene.id)) return true;
  return cueHits(scene).some((hit) => hit.cue === 'blogAftermath');
}

function prerequisiteOwnershipCues(value: string | undefined): RouteCue[] {
  const text = value ?? '';
  const cues = detectStoryEventCues(text);
  const isPublicAftermathSummary = !BLOG_DRAFT_MARKERS.test(text)
    && (PUBLIC_AFTERMARKERS.test(text) || cues.has('blogAftermath'));
  const out = new Set<RouteCue>();
  if (BLOG_DRAFT_MARKERS.test(text) || cues.has('lateNightWriting')) out.add('lateNightWriting');
  if (
    cues.has('threatEncounter')
    || (THREAT_PREREQUISITE_MARKERS.test(text) && (!isPublicAftermathSummary || LIVE_THREAT_ACTION_MARKERS.test(text)))
  ) out.add('threatEncounter');
  if (cues.has('roadBreakdown')) out.add('threatEncounter');
  return Array.from(out);
}

function validatePublicAftermathOwnership(blueprint: EpisodeBlueprint): BlueprintRouteCueIssue[] {
  const issues: BlueprintRouteCueIssue[] = [];
  for (const scene of blueprint.scenes ?? []) {
    if (!isPublicAftermathScene(scene)) continue;
    const ownershipChecks = [
      ...visibleRequiredBeats(scene).map((beat) => ({
        id: beat.id,
        text: [beat.mustDepict, beat.sourceTurn].filter(Boolean).join(' '),
      })),
      {
        id: `${scene.id}:turnContract`,
        text: [scene.turnContract?.centralTurn, scene.turnContract?.turnEvent].filter(Boolean).join(' '),
      },
    ];
    for (const check of ownershipChecks) {
      const cues = prerequisiteOwnershipCues(check.text);
      if (cues.length === 0) continue;
      issues.push({
        type: 'helper_owns_prerequisite_event',
        sceneId: scene.id,
        message: `Public aftermath scene "${scene.id}" owns prerequisite ${cues.join('/')} beat "${check.id}" instead of referencing it as prior context.`,
      });
      break;
    }
  }
  return issues;
}

function enumerateRoutes(blueprint: EpisodeBlueprint): string[][] {
  const sceneMap = new Map((blueprint.scenes ?? []).map((scene) => [scene.id, scene]));
  const start = blueprint.startingSceneId || blueprint.scenes?.[0]?.id;
  if (!start || !sceneMap.has(start)) return [];

  const routes: string[][] = [];
  const maxDepth = Math.max((blueprint.scenes ?? []).length + 3, 8);
  const queue: Array<{ sceneId: string; path: string[] }> = [{ sceneId: start, path: [] }];
  while (queue.length > 0 && routes.length < 64) {
    const { sceneId, path } = queue.shift()!;
    if (path.includes(sceneId)) {
      routes.push([...path, sceneId]);
      continue;
    }

    const nextPath = [...path, sceneId];
    if (nextPath.length > maxDepth) {
      routes.push(nextPath);
      continue;
    }

    const scene = sceneMap.get(sceneId);
    const targets = (scene?.leadsTo ?? []).filter((target) => sceneMap.has(target));
    if (targets.length === 0) {
      routes.push(nextPath);
      continue;
    }
    for (const target of targets.slice(0, 6)) {
      queue.push({ sceneId: target, path: nextPath });
    }
  }
  return routes;
}

function appendUnique<T>(target: T[] | undefined, source: T[] | undefined, keyOf: (value: T) => string): T[] | undefined {
  if (!source?.length) return target;
  const out = [...(target ?? [])];
  const seen = new Set(out.map(keyOf));
  for (const value of source) {
    const key = keyOf(value);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

function mergeSceneObligations(target: SceneBlueprint, source: SceneBlueprint): void {
  target.keyBeats = appendUnique(target.keyBeats, source.keyBeats, (value) => value) ?? target.keyBeats;
  target.requiredBeats = appendUnique(target.requiredBeats, source.requiredBeats, (value) => value.id) ?? target.requiredBeats;
  target.treatmentAtomIds = appendUnique(target.treatmentAtomIds, source.treatmentAtomIds, (value) => value) ?? target.treatmentAtomIds;
  target.ownedChronologyKeys = appendUnique(target.ownedChronologyKeys, source.ownedChronologyKeys, (value) => value) ?? target.ownedChronologyKeys;
  target.sourceContextIds = appendUnique(target.sourceContextIds, source.sourceContextIds, (value) => value) ?? target.sourceContextIds;
  target.authoredTreatmentFields = appendUnique(target.authoredTreatmentFields, source.authoredTreatmentFields, (value) => value.id) ?? target.authoredTreatmentFields;
  target.storyCircleBeatContracts = appendUnique(target.storyCircleBeatContracts, source.storyCircleBeatContracts, (value) => value.id) ?? target.storyCircleBeatContracts;
  target.arcPressureContracts = appendUnique(target.arcPressureContracts, source.arcPressureContracts, (value) => value.id) ?? target.arcPressureContracts;
  target.branchConsequenceContracts = appendUnique(target.branchConsequenceContracts, source.branchConsequenceContracts, (value) => value.id) ?? target.branchConsequenceContracts;
  target.endingRealizationContracts = appendUnique(target.endingRealizationContracts, source.endingRealizationContracts, (value) => value.id) ?? target.endingRealizationContracts;
  target.characterTreatmentContracts = appendUnique(target.characterTreatmentContracts, source.characterTreatmentContracts, (value) => value.id) ?? target.characterTreatmentContracts;
  target.worldTreatmentContracts = appendUnique(target.worldTreatmentContracts, source.worldTreatmentContracts, (value) => value.id) ?? target.worldTreatmentContracts;
  target.seasonPromiseContracts = appendUnique(target.seasonPromiseContracts, source.seasonPromiseContracts, (value) => value.id) ?? target.seasonPromiseContracts;
  target.residueObligationIds = appendUnique(target.residueObligationIds, source.residueObligationIds, (value) => value) ?? target.residueObligationIds;
}

function replaceTarget(scene: SceneBlueprint, from: string, to: string[]): void {
  const next = new Set<string>();
  for (const target of scene.leadsTo ?? []) {
    if (target === from) {
      for (const replacement of to) next.add(replacement);
    } else {
      next.add(target);
    }
  }
  scene.leadsTo = Array.from(next);
}

function isCanonicalSceneLock(scene: SceneBlueprint): boolean {
  return Boolean(
    scene.narrativeEventPlanVersion != null
    || (scene.narrativeEventIds?.length ?? 0) > 0
    || (scene.sceneEventOwnership?.ownedEvents?.length ?? 0) > 0
    || (scene.requiredBeats ?? []).some((beat) => beat.tier === 'authored' || beat.tier === 'signature')
    || scene.planningOrigin
    || scene.isEncounter,
  );
}

export function mergeDuplicatePublicAftermathScenes(blueprint: EpisodeBlueprint): number {
  const firstByCue = new Map<RouteCue, SceneBlueprint>();
  const toRemove = new Set<string>();
  for (const scene of blueprint.scenes ?? []) {
    if (toRemove.has(scene.id)) continue;
    const cues = new Set(cueHits(scene).map((hit) => hit.cue));
    if (!cues.has('blogAftermath')) continue;
    const first = firstByCue.get('blogAftermath');
    if (!first) {
      firstByCue.set('blogAftermath', scene);
      continue;
    }
    if (scene.choicePoint || isCanonicalSceneLock(scene)) continue;
    mergeSceneObligations(first, scene);
    const replacements = (scene.leadsTo ?? []).filter((target) => target !== scene.id);
    for (const candidate of blueprint.scenes ?? []) replaceTarget(candidate, scene.id, replacements);
    toRemove.add(scene.id);
  }
  if (toRemove.size === 0) return 0;
  blueprint.scenes = (blueprint.scenes ?? []).filter((scene) => !toRemove.has(scene.id));
  blueprint.bottleneckScenes = (blueprint.bottleneckScenes ?? []).filter((sceneId) => !toRemove.has(sceneId));
  return toRemove.size;
}

/**
 * Route-order hits for a scene, cross-checked against the scene's event
 * OWNERSHIP profile when one is attached. The field-level detector here is
 * intentionally loose; ownership (sceneEventOwnership) is the conservative,
 * contract-level source of truth for what a scene actually stages. A cue the
 * scene does not own is a reference — SceneWriter is prompted NOT to stage it
 * and the final-contract RouteContinuityValidator checks the real prose — so
 * blocking generation on it is a false positive (bite-me 2026-07-07 s1-7:
 * a release scene that owned nothing was aborted for "staging" the blog
 * writing it merely referenced). Scenes without a profile keep the old
 * field-level behavior.
 */
function ownershipAwareCueHits(scene: SceneBlueprint): CueHit[] {
  const hits = cueHits(scene);
  const owned = (scene as { sceneEventOwnership?: { ownedEvents?: Array<{ cue?: string }> } }).sceneEventOwnership?.ownedEvents;
  if (!owned) return hits;
  const ownedCues = new Set(owned.map((event) => event.cue).filter(Boolean));
  return hits.filter((hit) => ownedCues.has(hit.cue));
}

export function validateBlueprintRouteCueOrder(blueprint: EpisodeBlueprint): BlueprintRouteCueIssue[] {
  const sceneMap = new Map((blueprint.scenes ?? []).map((scene) => [scene.id, scene]));
  const issues: BlueprintRouteCueIssue[] = validatePublicAftermathOwnership(blueprint);
  for (const route of enumerateRoutes(blueprint)) {
    const routeHits = route.flatMap((sceneId) => {
      const scene = sceneMap.get(sceneId);
      return scene ? ownershipAwareCueHits(scene) : [];
    });

    for (let index = 1; index < routeHits.length; index += 1) {
      const previous = routeHits[index - 1];
      const current = routeHits[index];
      if (current.order >= previous.order) continue;
      issues.push({
        type: 'route_chronology_violation',
        sceneId: current.sceneId,
        message: `Blueprint route ${route.join(' -> ')} stages ${current.cue} after ${previous.cue}.`,
      });
      break;
    }

    const firstByCue = new Map<RouteCue, CueHit>();
    for (const hit of routeHits) {
      if (!DUPLICATE_SENSITIVE_CUES.has(hit.cue)) continue;
      const first = firstByCue.get(hit.cue);
      if (!first) {
        firstByCue.set(hit.cue, hit);
        continue;
      }
      if (first.sceneId === hit.sceneId) continue;
      issues.push({
        type: 'route_duplicate_event',
        sceneId: hit.sceneId,
        message: `Blueprint route ${route.join(' -> ')} stages ${hit.cue} in both "${first.sceneId}" and "${hit.sceneId}".`,
      });
      break;
    }
  }
  return issues;
}
