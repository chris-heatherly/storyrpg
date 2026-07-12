import type { RequiredBeat, SceneEventOwnershipProfile, SceneTurnContract } from '../../types/scenePlan';
import type { RelationshipPacingContract } from '../../types/scenePlan';
import { uniqueMajorLocationCues } from '../utils/sceneLocationCues';

export type ArchitectureConflictCode =
  | 'PLAN_RELATIONSHIP_STAGE_CONTRADICTION'
  | 'PLAN_MULTI_LOCATION_SCENE'
  | 'PLAN_READER_TEXT_SOURCE_LEAK'
  | 'PLAN_UNREALIZABLE_EVENT_SURFACE'
  | 'PLAN_MILESTONE_STAGE_CONFLICT'
  | 'PLAN_DUPLICATE_SCENE_TURN'
  | 'PLAN_SCENE_ORDER_DRIFT';

export interface ArchitectureConflict {
  code: ArchitectureConflictCode;
  sceneId: string;
  message: string;
  evidence: string[];
  repairInstruction: string;
}

interface ArchitectureSceneLike {
  id: string;
  episodeNumber?: number;
  name?: string;
  title?: string;
  location?: string;
  locations?: string[];
  kind?: string;
  isEncounter?: boolean;
  description?: string;
  dramaticPurpose?: string;
  requiredBeats?: RequiredBeat[];
  sceneEventOwnership?: SceneEventOwnershipProfile;
  turnContract?: SceneTurnContract;
  relationshipPacing?: RelationshipPacingContract[];
  canonicalEvidenceRequirements?: Array<{
    eventId: string;
    acceptedPatterns: string[];
    requiredSurface?: string;
  }>;
  narrativeEventIds?: string[];
  realizedEventIds?: string[];
  narrativeEventPlanVersion?: number;
  timeOfDay?: string;
  timeJumpFromPrevious?: string;
  sequenceIntent?: { objective?: string; activity?: string; turningPoint?: string };
  keyBeats?: string[];
  encounter?: {
    description?: string;
    sourceSynopsis?: string;
    authoredAnchor?: string;
  };
  choicePoint?: { description?: string };
}

function clean(value: unknown): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

const DUPLICATE_STOPWORDS = new Set([
  'a', 'an', 'and', 'at', 'be', 'by', 'for', 'from', 'in', 'into', 'is', 'of', 'on', 'or',
  'that', 'the', 'their', 'then', 'this', 'to', 'with', 'you', 'your', 'scene', 'moment',
  'people', 'thing', 'something', 'somewhere',
]);

function duplicateTokens(value: string): Set<string> {
  return new Set(value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .split(/\s+/)
    .map((word) => word.replace(/(?:ing|ed|es|s)$/i, ''))
    .filter((word) => word.length >= 4 && !DUPLICATE_STOPWORDS.has(word)));
}

function jaccard(left: Set<string>, right: Set<string>): number {
  if (left.size === 0 || right.size === 0) return 0;
  let intersection = 0;
  for (const token of left) if (right.has(token)) intersection += 1;
  return intersection / (left.size + right.size - intersection);
}

function planningFingerprint(scene: ArchitectureSceneLike): Set<string> {
  const ownership = scene.sceneEventOwnership?.ownedEvents ?? [];
  const turn = scene.turnContract;
  return duplicateTokens([
    scene.name,
    scene.title,
    scene.description,
    scene.location,
    ...(scene.locations ?? []),
    scene.timeOfDay,
    scene.timeJumpFromPrevious,
    turn?.centralTurn,
    turn?.turnEvent,
    scene.sequenceIntent?.objective,
    scene.sequenceIntent?.activity,
    scene.sequenceIntent?.turningPoint,
    ...(scene.keyBeats ?? []),
    ...(scene.requiredBeats ?? []).map((beat) => beat.mustDepict || beat.sourceTurn),
    ...ownership.map((event) => event.text),
  ].filter(Boolean).join(' '));
}

function sceneEventIds(scene: ArchitectureSceneLike): Set<string> {
  return new Set([
    ...(scene.narrativeEventIds ?? []),
    ...(scene.realizedEventIds ?? []),
    ...(scene.sceneEventOwnership?.ownedEvents ?? []).map((event) => event.eventContractId ?? event.key),
  ].filter(Boolean));
}

function duplicateSceneTurnConflicts(scenes: ArchitectureSceneLike[]): ArchitectureConflict[] {
  // Legacy/from-scratch architecture has no canonical event identity. Its
  // scenes may intentionally share broad location/turn vocabulary, so the
  // semantic detector is only authoritative when the canonical plan has been
  // projected onto at least one scene in this episode.
  if (!scenes.some((scene) => scene.sceneEventOwnership || scene.narrativeEventPlanVersion != null)) return [];
  const conflicts: ArchitectureConflict[] = [];
  for (let index = 0; index < scenes.length; index += 1) {
    const left = scenes[index];
    const leftEvents = sceneEventIds(left);
    const leftFingerprint = planningFingerprint(left);
    for (let next = index + 1; next < scenes.length; next += 1) {
      const right = scenes[next];
      if (left.episodeNumber != null && right.episodeNumber != null && left.episodeNumber !== right.episodeNumber) continue;
      const canonicalProjection = Boolean(
        left.sceneEventOwnership || right.sceneEventOwnership
        || left.narrativeEventPlanVersion != null || right.narrativeEventPlanVersion != null,
      );
      if (!canonicalProjection) continue;
      const rightEvents = sceneEventIds(right);
      const sharedEvents = [...leftEvents].filter((eventId) => rightEvents.has(eventId));
      const similarity = jaccard(leftFingerprint, planningFingerprint(right));
      // Lexical overlap is only a fallback for legacy projections. Keep it
      // deliberately high: adjacent scenes often share location, characters,
      // and aftermath vocabulary without restaging the same turn. Canonical
      // event identity remains the authoritative duplicate signal.
      if (sharedEvents.length === 0 && similarity < 0.9) continue;
      conflicts.push({
        code: 'PLAN_DUPLICATE_SCENE_TURN',
        sceneId: right.id,
        message: `Scene "${right.id}" duplicates the planned dramatic turn of scene "${left.id}"${sharedEvents.length > 0 ? ` through event(s) ${sharedEvents.join(', ')}` : ''}.`,
        evidence: [
          `first=${left.id}`,
          `second=${right.id}`,
          `similarity=${similarity.toFixed(3)}`,
          `sharedEvents=${sharedEvents.join(', ') || 'none'}`,
        ],
        repairInstruction: 'Assign each scene a distinct canonical primary turn. Restore the later scene\'s locked event and forbidden-restage context before invoking SceneWriter; do not solve a duplicate by deleting an authored scene.',
      });
    }
  }
  return conflicts;
}

function planningText(scene: ArchitectureSceneLike): string[] {
  return [
    scene.name,
    scene.title,
    scene.description,
    scene.dramaticPurpose,
    scene.choicePoint?.description,
    scene.turnContract?.centralTurn,
    scene.turnContract?.turnEvent,
    ...(scene.requiredBeats ?? []).map((beat) => beat.mustDepict || beat.sourceTurn),
  ].map(clean).filter(Boolean);
}

function blockedLabelPattern(label: string): RegExp {
  const escaped = label.trim().toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (escaped === 'friend' || escaped === 'friends') {
    // "befriends" is an authored action that can initiate a spark; it is not
    // the settled relationship label this gate is protecting. Only match
    // explicit state/identity language.
    return /\b(?:become|becomes|became|becoming|are|is|remain|remains|declared?|call(?:s|ed)?)\s+friend(?:s)?\b|\b(?:best friend|trusted friend|friend group|friends now)\b/i;
  }
  return new RegExp(`\\b${escaped}\\b`, 'i');
}

function isNegatedMention(text: string, label: string): boolean {
  const match = blockedLabelPattern(label).exec(text);
  if (!match || match.index === undefined) return false;
  const prefix = text.slice(0, match.index);
  return /(?:not|never|no|not yet|could become|might become)\s+(?:your|our|my|a|an|the)?\s*$/i.test(prefix);
}

function relationshipConflicts(scene: ArchitectureSceneLike): ArchitectureConflict[] {
  const texts = planningText(scene);
  const conflicts: ArchitectureConflict[] = [];
  for (const contract of scene.relationshipPacing ?? []) {
    for (const label of contract.blockedLabels ?? []) {
      const hit = texts.find((text) => blockedLabelPattern(label).test(text) && !isNegatedMention(text, label));
      if (!hit) continue;
      conflicts.push({
        code: 'PLAN_RELATIONSHIP_STAGE_CONTRADICTION',
        sceneId: scene.id,
        message: `Scene ${scene.id} planning text uses blocked relationship label "${label}" while the contract permits only ${contract.targetStage}.`,
        evidence: [hit, `blocked=${label}`, `targetStage=${contract.targetStage}`],
        repairInstruction: `Rewrite the planning title/description as a provisional ${contract.allowedLabels.slice(0, 3).join(', ') || contract.targetStage} turn, or advance the relationship contract explicitly. Do not leave both instructions active.`,
      });
    }
  }
  return conflicts;
}

function milestoneConflicts(scene: ArchitectureSceneLike): ArchitectureConflict[] {
  const conflicts: ArchitectureConflict[] = [];
  for (const contract of scene.relationshipPacing ?? []) {
    const milestone = contract.milestone;
    if (!milestone || milestone.targetStage === contract.targetStage) continue;
    conflicts.push({
      code: 'PLAN_MILESTONE_STAGE_CONFLICT',
      sceneId: scene.id,
      message: `Scene ${scene.id} milestone targets ${milestone.targetStage}, but its active relationship contract targets ${contract.targetStage}.`,
      evidence: [`milestone=${milestone.targetStage}`, `contract=${contract.targetStage}`, milestone.sourceText],
      repairInstruction: 'Choose one canonical target stage and project it to both the milestone and relationship pacing contract before prose generation.',
    });
  }
  return conflicts;
}

function spatialConflicts(scene: ArchitectureSceneLike): ArchitectureConflict[] {
  if (scene.kind === 'encounter' || scene.isEncounter) return [];
  // Location choreography is authoritative only after the canonical scene
  // projection has attached an ownership profile. Raw StoryArchitect output
  // can contain illustrative planning prose (and characterization fixtures do
  // intentionally), so treating those phrases as a hard scene split here
  // would create a new architecture false positive instead of protecting the
  // committed episode plan.
  if (
    !scene.sceneEventOwnership
    || scene.sceneEventOwnership.episodeNumber == null
    || scene.sceneEventOwnership.sceneId !== scene.id
    || scene.sceneEventOwnership.sourceContractIds.length === 0
  ) return [];
  // Only explicit scene location declarations are authoritative at this
  // boundary. Required-beat/source text may mention a downstream venue as a
  // setup or invitation; treating every noun in that text as physical staging
  // would reject valid cross-scene introductions before prose exists.
  const cues = Array.from(new Set([
    ...uniqueMajorLocationCues([scene.location, ...(scene.locations ?? [])]),
  ]));
  if (cues.length <= 1) return [];
  return [{
    code: 'PLAN_MULTI_LOCATION_SCENE',
    sceneId: scene.id,
    message: `Scene ${scene.id} plans meaningful action across ${cues.length} major locations: ${cues.join(', ')}.`,
    evidence: cues,
    repairInstruction: 'Split the scene at the declared location handoff or mark the second location as context-only. A source-text mention of a downstream venue does not stage that venue.',
  }];
}

function sourceLeakConflicts(scene: ArchitectureSceneLike): ArchitectureConflict[] {
  const description = clean(scene.encounter?.description);
  const sourceSynopsis = clean(scene.encounter?.sourceSynopsis);
  if (!description || !sourceSynopsis || description !== sourceSynopsis) return [];
  return [{
    code: 'PLAN_READER_TEXT_SOURCE_LEAK',
    sceneId: scene.id,
    message: `Encounter ${scene.id} uses its treatment source synopsis as the authored encounter description.`,
    evidence: [description],
    repairInstruction: 'Keep the synopsis in sourceSynopsis/authoring context and require a separate concrete reader-facing encounter description.',
  }];
}

function evidenceSurfaceConflicts(scene: ArchitectureSceneLike): ArchitectureConflict[] {
  const conflicts: ArchitectureConflict[] = [];
  for (const requirement of scene.canonicalEvidenceRequirements ?? []) {
    if (requirement.acceptedPatterns.length > 0 && requirement.requiredSurface) continue;
    conflicts.push({
      code: 'PLAN_UNREALIZABLE_EVENT_SURFACE',
      sceneId: scene.id,
      message: `Event ${requirement.eventId} has no complete evidence pattern/surface contract in scene ${scene.id}.`,
      evidence: [JSON.stringify(requirement)],
      repairInstruction: 'Compile at least one accepted evidence atom and one required realization surface before invoking the content agent.',
    });
  }
  return conflicts;
}

export function validateEpisodeArchitectureContract(scenes: ArchitectureSceneLike[]): ArchitectureConflict[] {
  return scenes
    .flatMap((scene) => [
      ...relationshipConflicts(scene),
      ...milestoneConflicts(scene),
      ...spatialConflicts(scene),
      ...sourceLeakConflicts(scene),
      ...evidenceSurfaceConflicts(scene),
    ])
    .concat(duplicateSceneTurnConflicts(scenes))
    .sort((a, b) => a.sceneId.localeCompare(b.sceneId) || a.code.localeCompare(b.code) || a.message.localeCompare(b.message));
}

/**
 * The locked EpisodeEventPlan is the transaction boundary for scene topology.
 * StoryArchitect may elaborate scene metadata, but it cannot silently omit an
 * authored scene and leave the old plan current for downstream assembly.
 */
export function validateCanonicalEpisodeSceneOrder(
  scenes: Array<{ id: string }>,
  lockedPlan?: { sceneOrder?: string[] },
): ArchitectureConflict[] {
  const expected = lockedPlan?.sceneOrder ?? [];
  if (expected.length === 0) return [];
  const actual = scenes.map((scene) => scene.id);
  if (expected.length === actual.length && expected.every((id, index) => id === actual[index])) return [];
  const missing = expected.filter((id) => !actual.includes(id));
  const extra = actual.filter((id) => !expected.includes(id));
  return [{
    code: 'PLAN_SCENE_ORDER_DRIFT',
    sceneId: missing[0] ?? extra[0] ?? actual[0] ?? 'episode',
    message: `Episode blueprint scene order diverges from the locked EpisodeEventPlan. Expected [${expected.join(', ')}], received [${actual.join(', ')}].`,
    evidence: [
      `missing=${missing.join(', ') || 'none'}`,
      `extra=${extra.join(', ') || 'none'}`,
    ],
    repairInstruction: 'Restore every locked scene and its chronological position before content generation. Do not delete or silently rebind an authored event owner; recompile the episode plan if the source plan itself changed.',
  }];
}
