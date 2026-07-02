import type {
  PlannedScene,
  RequiredBeat,
  SceneConstructionObligation,
} from '../../types/scenePlan';
import type { StoryCircleBeat, StoryCircleRoleAssignment } from '../../types/sourceAnalysis';
import type { TreatmentEventAtom } from '../../types/treatmentEvent';
import { detectPrimaryStoryEventCues, type StoryEventCue } from '../remediation/storyEventCues';
import { atomizeTreatmentText } from './treatmentEventAtomizer';
import { attachColdOpenProfiles } from './coldOpenProfile';
import { uniqueMajorLocationCues } from './sceneLocationCues';

export interface TreatmentAtomSceneAssignment {
  atomId: string;
  sceneId: string;
  ownershipKind: 'primary' | 'supporting' | 'context';
  sourceContractIds: string[];
  reason: string;
}

export interface RoutedTreatmentObligation {
  id: string;
  fromSceneId?: string;
  toSceneId?: string;
  reason: string;
}

export interface EpisodeSceneOwnershipDiagnostic {
  severity: 'error' | 'warning';
  episodeNumber?: number;
  sceneId?: string;
  atomIds?: string[];
  sourceContractIds?: string[];
  reason: string;
}

export interface EpisodeSceneOwnershipResult<T extends PlannedScene = PlannedScene> {
  scenes: T[];
  assignments: TreatmentAtomSceneAssignment[];
  routedObligations: RoutedTreatmentObligation[];
  diagnostics: EpisodeSceneOwnershipDiagnostic[];
}

export interface FinalizeEpisodeSceneOwnershipOptions {
  episodeNumber?: number;
  storyCircleRole?: StoryCircleRoleAssignment[];
}

interface AtomSource {
  atom: TreatmentEventAtom;
  scene: PlannedScene;
  sourceContractId: string;
  sourceKind: 'requiredBeat' | 'authoredTreatmentField' | 'storyCircle';
  requiredBeat?: RequiredBeat;
}

const STORY_CIRCLE_ORDER: StoryCircleBeat[] = ['you', 'need', 'go', 'search', 'find', 'take', 'return', 'change'];

// Idempotency mark. finalizeEpisode is DESTRUCTIVE — it clears derived ownership
// (clearStaleOwnership) and drains routed requiredBeats/contracts off their source
// scenes. Re-running over already-finalized scenes therefore LOSES routed atoms:
// clearStaleOwnership wipes the derived ownership on the target while the source
// contract that would re-derive it has already been drained, so the fact exists
// nowhere (the C2 data-loss bug). The pipeline calls finalize 2-3x on the same
// in-memory scene graph (StoryArchitect, ContentGenerationPhase, resume wrapper),
// so the guard lives INSIDE the function to protect every call site.
//
// A Symbol keeps the mark off JSON.stringify (no checkpoint/golden churn) and out
// of the enumerable scene shape. It is intentionally absent after a checkpoint
// reload (fresh object graph), where a single re-finalize is correct and safe.
const OWNERSHIP_FINALIZED_VERSION = 'episode-scene-ownership-v2';
const OWNERSHIP_FINALIZED = Symbol.for('storyrpg.episodeSceneOwnershipFinalized');

function markEpisodeFinalized(scene: PlannedScene): void {
  Object.defineProperty(scene, OWNERSHIP_FINALIZED, {
    value: OWNERSHIP_FINALIZED_VERSION,
    enumerable: false,
    writable: true,
    configurable: true,
  });
}

function isEpisodeFinalized(scene: PlannedScene): boolean {
  return (scene as { [OWNERSHIP_FINALIZED]?: string })[OWNERSHIP_FINALIZED] === OWNERSHIP_FINALIZED_VERSION;
}

function cleanText(value: unknown): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function normalize(value: unknown): string {
  return cleanText(value)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokens(value: unknown): string[] {
  return normalize(value).split(' ').filter((token) => token.length >= 4);
}

function tokenOverlap(left: unknown, right: unknown): number {
  const leftTokens = Array.from(new Set(tokens(left)));
  const rightTokens = Array.from(new Set(tokens(right)));
  if (leftTokens.length === 0 || rightTokens.length === 0) return 0;
  const rightSet = new Set(rightTokens);
  const hits = leftTokens.filter((token) =>
    rightSet.has(token) || rightTokens.some((candidate) => candidate.startsWith(token) || token.startsWith(candidate)),
  );
  return hits.length / leftTokens.length;
}

function unique<T>(items: T[]): T[] {
  return Array.from(new Set(items));
}

function beatText(beat: RequiredBeat): string {
  return cleanText(beat.mustDepict || beat.sourceTurn);
}

function pushUnique<T>(target: T[] | undefined, values: T[], keyOf: (value: T) => string): T[] | undefined {
  if (values.length === 0) return target;
  const out = [...(target ?? [])];
  const seen = new Set(out.map(keyOf));
  for (const value of values) {
    const key = keyOf(value);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

function sceneText(scene: PlannedScene): string {
  return [
    scene.id,
    scene.title,
    scene.dramaticPurpose,
    scene.stakes,
    scene.locations?.join(' '),
    scene.timeOfDay,
    scene.timeJump,
    scene.encounter?.description,
    scene.encounter?.centralConflict,
    scene.turnContract?.centralTurn,
    scene.turnContract?.turnEvent,
    ...(scene.requiredBeats ?? []).map(beatText),
  ].map(cleanText).filter(Boolean).join(' ');
}

function sceneCues(scene: PlannedScene): Set<StoryEventCue> {
  return detectPrimaryStoryEventCues(sceneText(scene));
}

/**
 * Cues from fields that are scene-DISTINCT by construction (turn text, title,
 * encounter body). Unlike dramaticPurpose/stakes, these never carry copied
 * episode-wide boilerplate, so a cue here means THIS scene stages the event.
 */
function sceneCoreCues(scene: PlannedScene): Set<StoryEventCue> {
  return detectPrimaryStoryEventCues([
    scene.id,
    scene.title,
    scene.locations?.join(' '),
    scene.encounter?.description,
    scene.encounter?.centralConflict,
    scene.turnContract?.centralTurn,
    scene.turnContract?.turnEvent,
  ].map(cleanText).filter(Boolean).join(' '));
}

function scenePrimaryCues(scene: PlannedScene): Set<StoryEventCue> {
  return detectPrimaryStoryEventCues([
    scene.id,
    scene.title,
    scene.dramaticPurpose,
    scene.stakes,
    scene.locations?.join(' '),
    scene.encounter?.description,
    scene.encounter?.centralConflict,
    scene.turnContract?.centralTurn,
    scene.turnContract?.turnEvent,
  ].map(cleanText).filter(Boolean).join(' '));
}

function cueOverlap(atom: TreatmentEventAtom, scene: PlannedScene): boolean {
  const atomCues = new Set(atom.eventCues ?? []);
  if (atomCues.size === 0) return false;
  const cues = sceneCues(scene);
  return [...atomCues].some((cue) => cues.has(cue as StoryEventCue));
}

function sceneHasLocation(scene: PlannedScene, atom: TreatmentEventAtom): boolean {
  const sceneLocations = uniqueMajorLocationCues([scene.locations ?? [], sceneText(scene)]);
  const atomLocations = uniqueMajorLocationCues([atom.requiredLocations ?? [], atom.eventText]);
  if (sceneLocations.length === 0 || atomLocations.length === 0) return false;
  return atomLocations.some((location) =>
    sceneLocations.some((candidate) => candidate === location || candidate.includes(location) || location.includes(candidate)),
  );
}

function sceneHasEntity(scene: PlannedScene, atom: TreatmentEventAtom): boolean {
  const sceneEntities = (scene.npcsInvolved ?? []).map(normalize).filter(Boolean);
  if (sceneEntities.length === 0 || atom.requiredEntities.length === 0) return false;
  return atom.requiredEntities.map(normalize).some((entity) =>
    sceneEntities.some((candidate) => candidate === entity || candidate.includes(entity) || entity.includes(candidate)),
  );
}

function isOpeningScene(scene: PlannedScene, episodeScenes: PlannedScene[]): boolean {
  if (scene.coldOpenProfile) return true;
  const first = [...episodeScenes].sort((a, b) => sceneOrder(a) - sceneOrder(b) || a.id.localeCompare(b.id))[0];
  return first?.id === scene.id;
}

function sceneOrder(scene: Pick<PlannedScene, 'id'> & Partial<Pick<PlannedScene, 'order'>>): number {
  return typeof scene.order === 'number' && Number.isFinite(scene.order) ? scene.order : Number.MAX_SAFE_INTEGER;
}

function sceneStoryCircleRank(scene: PlannedScene): number {
  const beat = scene.storyCircleBeatContracts?.[0]?.beat;
  const index = beat ? STORY_CIRCLE_ORDER.indexOf(beat) : -1;
  return index >= 0 ? index : 999;
}

function scoreSceneForAtom(atom: TreatmentEventAtom, scene: PlannedScene, sourceScene: PlannedScene, episodeScenes: PlannedScene[]): number {
  let score = scene.id === sourceScene.id ? 1 : 0;
  if (cueOverlap(atom, scene)) score += 5;
  if (sceneHasLocation(scene, atom)) score += 3;
  if (sceneHasEntity(scene, atom)) score += 1.5;
  if (atom.sceneKindHint === 'encounter' && (scene.kind === 'encounter' || scene.encounter)) score += 8;
  if (atom.sceneKindHint === 'encounter' && scene.kind !== 'encounter' && !scene.encounter) score -= 5;
  if (atom.eventCues?.includes('arrival') && isOpeningScene(scene, episodeScenes)) score += 2;
  if (atom.timeCue && normalize(scene.timeOfDay || scene.timeJump).includes(normalize(atom.timeCue))) score += 2;
  score += Math.max(tokenOverlap(atom.eventText, sceneText(scene)), tokenOverlap(sceneText(scene), atom.eventText)) * 4;
  const rank = sceneStoryCircleRank(scene);
  if (rank !== 999) score += Math.max(0, 1 - rank / 16);
  return score;
}

function bestSceneForAtom(atom: TreatmentEventAtom, sourceScene: PlannedScene, episodeScenes: PlannedScene[]): PlannedScene {
  if (atom.sceneKindHint === 'encounter' || atom.eventCues?.includes('threatEncounter')) {
    // Two-tier ownership: a scene whose scene-distinct core text (turn, title,
    // encounter body) stages the threat beats any scene that merely mentions it
    // in dramaticPurpose/stakes — the deterministic skeleton copies the whole
    // episode synopsis into those fields on EVERY standard scene, and with the
    // earliest-scene tie-break the setup cold-open was winning attack atoms it
    // never dramatizes (bite-me 2026-07-02T18-19-29). The broad tier remains as
    // a fallback for scenes that only describe the threat in their purpose.
    const coreThreatOwners = episodeScenes.filter((scene) => sceneCoreCues(scene).has('threatEncounter'));
    const concreteThreatOwners = coreThreatOwners.length > 0
      ? coreThreatOwners
      : episodeScenes.filter((scene) => scenePrimaryCues(scene).has('threatEncounter'));
    if (concreteThreatOwners.length > 0) {
      return concreteThreatOwners
        .map((scene) => ({ scene, score: scoreSceneForAtom(atom, scene, sourceScene, episodeScenes) }))
        .sort((a, b) => b.score - a.score || sceneOrder(a.scene) - sceneOrder(b.scene))[0]?.scene ?? sourceScene;
    }
  }
  return episodeScenes
    .map((scene) => ({ scene, score: scoreSceneForAtom(atom, scene, sourceScene, episodeScenes) }))
    .sort((a, b) => b.score - a.score || sceneOrder(a.scene) - sceneOrder(b.scene))[0]?.scene ?? sourceScene;
}

function atomSourcesForScene(scene: PlannedScene): AtomSource[] {
  const sources: AtomSource[] = [];
  for (const beat of scene.requiredBeats ?? []) {
    const atoms = atomizeTreatmentText({
      episodeNumber: scene.episodeNumber,
      text: beatText(beat),
      sourceSection: `requiredBeat:${beat.id}`,
      idPrefix: `${scene.id}-${beat.id}`,
    });
    for (const atom of atoms) {
      sources.push({ atom, scene, sourceContractId: beat.id, sourceKind: 'requiredBeat', requiredBeat: beat });
    }
  }
  for (const field of scene.authoredTreatmentFields ?? []) {
    const atoms = atomizeTreatmentText({
      episodeNumber: scene.episodeNumber,
      text: field.sourceText,
      sourceSection: `authoredTreatmentField:${field.id}`,
      idPrefix: `${scene.id}-${field.id}`,
    });
    for (const atom of atoms) {
      sources.push({ atom, scene, sourceContractId: field.id, sourceKind: 'authoredTreatmentField' });
    }
  }
  for (const contract of scene.storyCircleBeatContracts ?? []) {
    const texts = (contract.eventAtoms?.length ? contract.eventAtoms : [contract.sourceText])
      .filter((text): text is string => Boolean(text?.trim()));
    texts.forEach((text, index) => {
      const atoms = atomizeTreatmentText({
        episodeNumber: scene.episodeNumber,
        text,
        sourceSection: `storyCircle:${contract.id}`,
        idPrefix: `${scene.id}-${contract.id}-${index + 1}`,
      });
      for (const atom of atoms) {
        sources.push({ atom, scene, sourceContractId: contract.id, sourceKind: 'storyCircle' });
      }
    });
  }
  return sources;
}

function addAtomPayload(scene: PlannedScene, atom: TreatmentEventAtom): void {
  scene.nonCopyableContext = pushUnique(
    scene.nonCopyableContext,
    [{
      id: atom.id,
      sourceText: atom.sourceText,
      eventText: atom.eventText,
      sourceSection: atom.sourceSection,
    }],
    (value) => value.id,
  );
}

function addContext(scene: PlannedScene, atom: TreatmentEventAtom): void {
  scene.sourceContextIds = pushUnique(scene.sourceContextIds, [atom.id], (value) => value);
  addAtomPayload(scene, atom);
}

function addPrimaryAtom(scene: PlannedScene, atom: TreatmentEventAtom): void {
  scene.treatmentAtomIds = pushUnique(scene.treatmentAtomIds, [atom.id], (value) => value);
  addAtomPayload(scene, atom);
  if (atom.chronologyKey) {
    scene.ownedChronologyKeys = pushUnique(scene.ownedChronologyKeys, [atom.chronologyKey], (value) => value);
  }
}

function encounterStakesFromAtom(atom: TreatmentEventAtom, scene: PlannedScene): string {
  const pressure = cleanText(atom.eventText || atom.sourceText || scene.turnContract?.centralTurn || scene.dramaticPurpose);
  if (!pressure) return 'The outcome changes the protagonist\'s immediate safety, trust, and ability to choose the next step.';
  return `The outcome of this encounter changes the protagonist's immediate safety, trust, and ability to choose the next step: ${pressure}`;
}

function encounterBuildupFromAtom(atom: TreatmentEventAtom, scene: PlannedScene): string {
  const turn = cleanText(scene.turnContract?.centralTurn || scene.dramaticPurpose || atom.eventText);
  return turn
    ? `Earlier scene pressure makes this encounter personal by setting up: ${turn}`
    : 'Earlier scene pressure makes this encounter personal rather than only tactical.';
}

function encounterBeatPlanFromAtom(atom: TreatmentEventAtom, scene: PlannedScene): string[] {
  const event = cleanText(atom.eventText || atom.sourceText || scene.turnContract?.turnEvent || scene.dramaticPurpose);
  const stakes = encounterStakesFromAtom(atom, scene);
  return Array.from(new Set([
    `Opening pressure: ${event || 'The encounter event forces an immediate response.'}`,
    `Escalation: ${stakes}`,
    'Decision point: the protagonist must choose how to respond under pressure.',
  ]));
}

function ensureEncounterCapable(scene: PlannedScene, atom: TreatmentEventAtom): void {
  if (atom.sceneKindHint !== 'encounter' && !atom.eventCues?.includes('threatEncounter')) return;
  const blueprintLike = scene as PlannedScene & {
    isEncounter?: boolean;
    encounterDescription?: string;
    encounterCentralConflict?: string;
    encounterStakes?: string;
    encounterBuildup?: string;
    encounterDifficulty?: 'easy' | 'moderate' | 'hard' | 'extreme';
    encounterRelevantSkills?: string[];
    encounterBeatPlan?: string[];
  };
  const beatPlan = blueprintLike.encounterBeatPlan?.filter((beat) => cleanText(beat)).length
    ? blueprintLike.encounterBeatPlan
    : encounterBeatPlanFromAtom(atom, scene);
  scene.kind = 'encounter';
  blueprintLike.isEncounter = true;
  blueprintLike.encounterDescription = blueprintLike.encounterDescription || atom.eventText;
  blueprintLike.encounterCentralConflict = blueprintLike.encounterCentralConflict || atom.eventText;
  blueprintLike.encounterStakes = blueprintLike.encounterStakes || encounterStakesFromAtom(atom, scene);
  blueprintLike.encounterBuildup = blueprintLike.encounterBuildup || encounterBuildupFromAtom(atom, scene);
  blueprintLike.encounterDifficulty = blueprintLike.encounterDifficulty ?? 'moderate';
  blueprintLike.encounterRelevantSkills = blueprintLike.encounterRelevantSkills?.length
    ? blueprintLike.encounterRelevantSkills
    : ['notice', 'composure'];
  blueprintLike.encounterBeatPlan = beatPlan;
  // A threatEncounter cue can be a nightmare, an argument, or a physical
  // confrontation — default to the neutral 'dramatic' type rather than 'combat'
  // so we don't mis-restructure non-combat scenes, and derive skills from the
  // scene's own plan before falling back. isBranchPoint defaults to FALSE: a
  // synthesized encounter whose choices don't fan out >=2 would otherwise
  // manufacture its own GATE_BRANCH_FANOUT abort — let branch planning decide.
  const coercedSkills = scene.encounter?.relevantSkills?.length
    ? scene.encounter.relevantSkills
    : (blueprintLike.encounterRelevantSkills?.length
        ? blueprintLike.encounterRelevantSkills
        : ['notice', 'composure']);
  scene.encounter = {
    type: scene.encounter?.type ?? 'dramatic',
    difficulty: scene.encounter?.difficulty ?? 'moderate',
    relevantSkills: coercedSkills,
    description: scene.encounter?.description || atom.eventText,
    centralConflict: scene.encounter?.centralConflict || atom.eventText,
    storyCircleTarget: scene.encounter?.storyCircleTarget,
    storyCircleTargetRationale: scene.encounter?.storyCircleTargetRationale,
    storyCircleTargetEvidence: scene.encounter?.storyCircleTargetEvidence,
    aftermathConsequence: scene.encounter?.aftermathConsequence,
    isBranchPoint: scene.encounter?.isBranchPoint ?? false,
    branchOutcomes: scene.encounter?.branchOutcomes,
    requiredBeats: pushUnique(scene.encounter?.requiredBeats, [{
      id: `${atom.id}-encounter`,
      sourceTurn: atom.sourceText,
      mustDepict: atom.eventText,
      tier: 'authored',
    }], (beat) => beat.id),
  };
}

function addConstructionObligation(scene: PlannedScene, atom: TreatmentEventAtom, sourceContractId: string): void {
  const profile = scene.sceneConstructionProfile;
  if (!profile || atom.ownershipIntent !== 'must_stage') return;
  const obligation: SceneConstructionObligation = {
    source: 'treatmentAtom',
    id: atom.id,
    slot: 'must_stage',
    text: atom.eventText,
    reason: 'Primary treatment event atom assigned by the episode scene ownership compiler.',
    hardUnits: 1,
    softUnits: 0,
  };
  if (!profile.obligations.some((item) => item.id === obligation.id)) {
    profile.obligations = [...profile.obligations, obligation];
    profile.sourceContractIds = unique([...profile.sourceContractIds, atom.id, sourceContractId]);
  }
}

function retierForTarget(beat: RequiredBeat, target: PlannedScene, episodeScenes: PlannedScene[]): RequiredBeat {
  if (beat.tier !== 'coldopen' || isOpeningScene(target, episodeScenes)) return beat;
  return {
    ...beat,
    tier: 'authored',
  };
}

function pushRequiredBeat(scene: PlannedScene, beat: RequiredBeat): void {
  scene.requiredBeats = pushUnique(scene.requiredBeats, [beat], (value) => value.id);
}

function clearStaleOwnership(scene: PlannedScene): void {
  scene.treatmentAtomIds = undefined;
  scene.ownedChronologyKeys = undefined;
  scene.sourceContextIds = undefined;
  scene.nonCopyableContext = undefined;
}

function applyStoryCircleSpine(scenes: PlannedScene[], options: FinalizeEpisodeSceneOwnershipOptions): void {
  const roleBeats = unique((options.storyCircleRole ?? []).map((role) => role.beat).filter(Boolean));
  if (roleBeats.length === 0 || scenes.some((scene) => scene.storyCircleBeatContracts?.length)) return;
  const opening = scenes[0];
  if (!opening) return;
  for (const beat of roleBeats.slice(0, 2)) {
    opening.storyCircleBeatContracts = pushUnique(opening.storyCircleBeatContracts, [{
      id: `episode-scene-ownership:${opening.episodeNumber}:${beat}`,
      beat,
      sourceText: opening.dramaticPurpose,
      targetEpisodeNumber: opening.episodeNumber,
      requiredRealization: ['scene_turn', 'final_prose'],
      eventAtoms: [opening.dramaticPurpose],
      targetSceneIds: [opening.id],
      blockingLevel: 'structural',
    }], (contract) => contract.id);
  }
}

function finalizeEpisode<T extends PlannedScene>(
  episodeScenesInput: T[],
  options: FinalizeEpisodeSceneOwnershipOptions,
  result: EpisodeSceneOwnershipResult<T>,
): void {
  const episodeScenes = episodeScenesInput.sort((a, b) => sceneOrder(a) - sceneOrder(b) || a.id.localeCompare(b.id));
  if (episodeScenes.length === 0) return;
  const episodeNumber = options.episodeNumber ?? episodeScenes[0].episodeNumber;

  // Idempotency: if this exact scene graph was already finalized in-memory this
  // run, re-running would destroy routed ownership (see OWNERSHIP_FINALIZED). Skip
  // the destructive body and only re-emit the terminal diagnostic so a re-check
  // still surfaces a missing cold-open.
  if (episodeScenes.every(isEpisodeFinalized)) {
    const alreadyOpening = episodeScenes[0];
    if (alreadyOpening && !alreadyOpening.coldOpenProfile) {
      result.diagnostics.push({
        severity: 'error',
        episodeNumber,
        sceneId: alreadyOpening.id,
        reason: 'Opening scene has no coldOpenProfile after ownership finalization; Story Circle role is not represented on-page.',
      });
    }
    return;
  }

  applyStoryCircleSpine(episodeScenes, options);
  attachColdOpenProfiles(episodeScenes, { episodeNumber, storyCircleRole: options.storyCircleRole });
  episodeScenes.forEach(clearStaleOwnership);

  const additions = new Map<string, RequiredBeat[]>();
  for (const scene of episodeScenes) {
    const kept: RequiredBeat[] = [];
    for (const beat of scene.requiredBeats ?? []) {
      const atoms = atomizeTreatmentText({
        episodeNumber: scene.episodeNumber,
        text: beatText(beat),
        sourceSection: `requiredBeat:${beat.id}`,
        idPrefix: `${scene.id}-${beat.id}`,
      });
      if (beat.tier === 'coldopen' && !isOpeningScene(scene, episodeScenes)) {
        const target = episodeScenes[0];
        additions.set(target.id, [...(additions.get(target.id) ?? []), retierForTarget(beat, target, episodeScenes)]);
        atoms
          .filter((atom) => atom.ownershipIntent === 'may_support')
          .forEach((atom) => addContext(scene, atom));
        result.routedObligations.push({
          id: beat.id,
          fromSceneId: scene.id,
          toSceneId: target.id,
          reason: 'Non-opening scene cannot own a cold-open beat; routed to the best scene owner and retained only as context here.',
        });
        continue;
      }
      kept.push(beat);
    }
    scene.requiredBeats = kept.length ? kept : undefined;
  }

  for (const scene of episodeScenes) {
    for (const beat of additions.get(scene.id) ?? []) pushRequiredBeat(scene, beat);
  }

  const allAtomSources = episodeScenes.flatMap(atomSourcesForScene);
  const routedRequiredBeatIdsByScene = new Map<string, Set<string>>();
  const routedStoryCircleIdsByScene = new Map<string, Set<string>>();
  const routedTreatmentFieldIdsByScene = new Map<string, Set<string>>();
  for (const source of allAtomSources) {
    const { atom, scene, sourceContractId } = source;
    if (atom.ownershipIntent !== 'must_stage') {
      if (atom.ownershipIntent === 'may_support') addContext(scene, atom);
      result.assignments.push({
        atomId: atom.id,
        sceneId: scene.id,
        ownershipKind: 'context',
        sourceContractIds: [sourceContractId],
        reason: 'Treatment atom is non-playable support or ledger-only context.',
      });
      continue;
    }
    const target = bestSceneForAtom(atom, scene, episodeScenes);
    ensureEncounterCapable(target, atom);
    addPrimaryAtom(target, atom);
    // NOTE (audit 1.3/H12): a routed NON-encounter target would hold the fact only
    // in treatmentAtomIds, escaping RequiredBeatRealization enforcement. Verified
    // that this is unreachable under the current atomizer+scoring: a standard atom
    // has empty requiredLocations/entities and no cues, so it gets no target-side
    // score while the source scene always wins tokenOverlap (its sceneText includes
    // its own requiredBeat) plus the +1 self bonus. Cross-scene routing therefore
    // only happens to ENCOUNTER owners, which ensureEncounterCapable already binds
    // via encounter.requiredBeats. Revisit if scoring gives standard atoms a
    // target-side signal.
    if (target.id !== scene.id) addContext(scene, atom);
    addConstructionObligation(target, atom, sourceContractId);
    result.assignments.push({
      atomId: atom.id,
      sceneId: target.id,
      ownershipKind: 'primary',
      sourceContractIds: [sourceContractId],
      reason: target.id === scene.id
        ? 'Treatment atom already belongs to the scene that carries its source contract.'
        : 'Treatment atom was routed to the scene whose cue/location/kind best matches the playable event.',
    });
    if (target.id !== scene.id) {
      if (source.sourceKind === 'requiredBeat') {
        const ids = routedRequiredBeatIdsByScene.get(scene.id) ?? new Set<string>();
        ids.add(sourceContractId);
        routedRequiredBeatIdsByScene.set(scene.id, ids);
      } else if (source.sourceKind === 'storyCircle') {
        const ids = routedStoryCircleIdsByScene.get(scene.id) ?? new Set<string>();
        ids.add(sourceContractId);
        routedStoryCircleIdsByScene.set(scene.id, ids);
      } else if (source.sourceKind === 'authoredTreatmentField') {
        const ids = routedTreatmentFieldIdsByScene.get(scene.id) ?? new Set<string>();
        ids.add(sourceContractId);
        routedTreatmentFieldIdsByScene.set(scene.id, ids);
      }
      result.routedObligations.push({
        id: sourceContractId,
        fromSceneId: scene.id,
        toSceneId: target.id,
        reason: 'Playable treatment fact matched a different scene owner than its source binding.',
      });
    }
  }

  for (const scene of episodeScenes) {
    const routedRequired = routedRequiredBeatIdsByScene.get(scene.id);
    if (routedRequired?.size) {
      scene.requiredBeats = (scene.requiredBeats ?? []).filter((beat) => !routedRequired.has(beat.id));
      if (scene.requiredBeats.length === 0) scene.requiredBeats = undefined;
    }
    const routedStoryCircle = routedStoryCircleIdsByScene.get(scene.id);
    if (routedStoryCircle?.size) {
      scene.storyCircleBeatContracts = (scene.storyCircleBeatContracts ?? []).filter((contract) => !routedStoryCircle.has(contract.id));
      if (scene.storyCircleBeatContracts.length === 0) scene.storyCircleBeatContracts = undefined;
    }
    const routedTreatmentFields = routedTreatmentFieldIdsByScene.get(scene.id);
    if (routedTreatmentFields?.size) {
      scene.authoredTreatmentFields = (scene.authoredTreatmentFields ?? []).filter((field) => !routedTreatmentFields.has(field.id));
      if (scene.authoredTreatmentFields.length === 0) scene.authoredTreatmentFields = undefined;
    }
  }

  const opening = episodeScenes[0];
  if (!opening.coldOpenProfile) {
    result.diagnostics.push({
      severity: 'error',
      episodeNumber,
      sceneId: opening.id,
      reason: 'Opening scene has no coldOpenProfile after ownership finalization; Story Circle role is not represented on-page.',
    });
  }

  // Mark the finalized graph so a later in-memory re-finalize is a no-op instead
  // of a destructive re-derivation (C2). See OWNERSHIP_FINALIZED.
  episodeScenes.forEach(markEpisodeFinalized);
}

export function finalizeEpisodeSceneOwnership<T extends PlannedScene>(
  scenesInput: T[],
  options: FinalizeEpisodeSceneOwnershipOptions = {},
): EpisodeSceneOwnershipResult<T> {
  const result: EpisodeSceneOwnershipResult<T> = {
    scenes: scenesInput,
    assignments: [],
    routedObligations: [],
    diagnostics: [],
  };
  const byEpisode = new Map<number, T[]>();
  scenesInput.forEach((scene, index) => {
    const blueprintLike = scene as T & { episodeNumber?: number; order?: number };
    const episodeNumber = blueprintLike.episodeNumber ?? options.episodeNumber;
    if (!episodeNumber) return;
    if (options.episodeNumber && episodeNumber !== options.episodeNumber) return;
    if (blueprintLike.episodeNumber == null) blueprintLike.episodeNumber = episodeNumber;
    if (blueprintLike.order == null) blueprintLike.order = index;
    byEpisode.set(episodeNumber, [...(byEpisode.get(episodeNumber) ?? []), scene]);
  });
  for (const [episodeNumber, scenes] of byEpisode) {
    finalizeEpisode(scenes, { ...options, episodeNumber }, result);
  }
  return result;
}
