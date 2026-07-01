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
const LOCATION_RE = /\b(?:at|in|inside|outside|on|near|through|to|from)\s+(?:the\s+|a\s+|an\s+)?([A-Z][A-Za-z0-9'’-]*(?:\s+[A-Z][A-Za-z0-9'’-]*){0,3}|[a-z][a-z0-9'’-]*(?:\s+[a-z][a-z0-9'’-]*){0,2}\s+(?:bar|club|park|station|apartment|archive|venue|hotel|house|garden|market|office|studio|library|bookshop|bookstore|rooftop|courtyard))/g;

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

function cueOverlap(atom: TreatmentEventAtom, scene: PlannedScene): boolean {
  const atomCues = new Set(atom.eventCues ?? []);
  if (atomCues.size === 0) return false;
  const cues = sceneCues(scene);
  return [...atomCues].some((cue) => cues.has(cue as StoryEventCue));
}

function locationHints(value: string): string[] {
  const out = new Set<string>();
  for (const match of value.matchAll(LOCATION_RE)) {
    const location = cleanText(match[1]).replace(/^(?:the|a|an)\s+/i, '');
    if (location.length >= 3) out.add(normalize(location));
  }
  return [...out];
}

function sceneHasLocation(scene: PlannedScene, atom: TreatmentEventAtom): boolean {
  const sceneLocations = [
    ...(scene.locations ?? []),
    ...locationHints(sceneText(scene)),
  ].map(normalize).filter(Boolean);
  const atomLocations = [
    ...(atom.requiredLocations ?? []),
    ...locationHints(atom.eventText),
  ].map(normalize).filter(Boolean);
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
  const first = [...episodeScenes].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))[0];
  return first?.id === scene.id;
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
  return episodeScenes
    .map((scene) => ({ scene, score: scoreSceneForAtom(atom, scene, sourceScene, episodeScenes) }))
    .sort((a, b) => b.score - a.score || a.scene.order - b.scene.order)[0]?.scene ?? sourceScene;
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
    const texts = contract.eventAtoms?.length ? contract.eventAtoms : [contract.sourceText];
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

function addContext(scene: PlannedScene, atom: TreatmentEventAtom): void {
  scene.sourceContextIds = pushUnique(scene.sourceContextIds, [atom.id], (value) => value);
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

function addPrimaryAtom(scene: PlannedScene, atom: TreatmentEventAtom): void {
  scene.treatmentAtomIds = pushUnique(scene.treatmentAtomIds, [atom.id], (value) => value);
  if (atom.chronologyKey) {
    scene.ownedChronologyKeys = pushUnique(scene.ownedChronologyKeys, [atom.chronologyKey], (value) => value);
  }
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
  const episodeScenes = episodeScenesInput.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  if (episodeScenes.length === 0) return;
  const episodeNumber = options.episodeNumber ?? episodeScenes[0].episodeNumber;
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
      const playable = atoms.find((atom) => atom.ownershipIntent === 'must_stage');
      if (beat.tier === 'coldopen' && !isOpeningScene(scene, episodeScenes)) {
        const target = playable ? bestSceneForAtom(playable, scene, episodeScenes) : episodeScenes[0];
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
    addPrimaryAtom(target, atom);
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
      result.routedObligations.push({
        id: sourceContractId,
        fromSceneId: scene.id,
        toSceneId: target.id,
        reason: 'Playable treatment fact matched a different scene owner than its source binding.',
      });
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
  for (const scene of scenesInput) {
    if (options.episodeNumber && scene.episodeNumber !== options.episodeNumber) continue;
    byEpisode.set(scene.episodeNumber, [...(byEpisode.get(scene.episodeNumber) ?? []), scene]);
  }
  for (const [episodeNumber, scenes] of byEpisode) {
    finalizeEpisode(scenes, { ...options, episodeNumber }, result);
  }
  return result;
}
