import type { SeasonEpisode } from '../../types/seasonPlan';
import type { TreatmentEpisodeGuidance } from '../../types/sourceAnalysis';
import type {
  AuthoredTreatmentFieldContract,
  AuthoredTreatmentFieldKind,
  AuthoredTreatmentFieldRealization,
  MechanicPressureContract,
  MechanicPressureDomain,
  PlannedScene,
} from '../../types/scenePlan';

type EpisodeGuidanceRef = {
  episodeNumber: number;
  treatmentGuidance?: TreatmentEpisodeGuidance;
};

const KIND_REALIZATION: Record<AuthoredTreatmentFieldKind, AuthoredTreatmentFieldRealization[]> = {
  pressure_lane: ['scene_turn', 'mechanic_pressure', 'final_prose'],
  encounter_anchor: ['encounter', 'final_prose'],
  encounter_conflict: ['encounter', 'scene_turn', 'final_prose'],
  stakes_layer: ['scene_turn', 'choice', 'encounter', 'final_prose'],
  theme_angle: ['scene_turn', 'choice', 'final_prose'],
  lie_pressure: ['scene_turn', 'mechanic_pressure', 'final_prose'],
  encounter_buildup: ['scene_turn', 'encounter', 'final_prose'],
  major_choice_pressure: ['choice', 'consequence', 'final_prose'],
  alternative_path: ['choice', 'consequence', 'mechanic_pressure', 'final_prose'],
  information_movement: ['information_ledger', 'mechanic_pressure', 'final_prose'],
  consequence_seed: ['consequence', 'mechanic_pressure', 'final_prose'],
  ending_turnout: ['episode_ending', 'mechanic_pressure', 'final_prose'],
  resolved_episode_tension: ['episode_ending', 'final_prose'],
  cliffhanger_hook: ['cliffhanger', 'final_prose'],
  cliffhanger_question: ['cliffhanger', 'next_episode_plan', 'final_prose'],
  next_episode_pressure: ['cliffhanger', 'next_episode_plan', 'mechanic_pressure'],
  cliffhanger_setup: ['scene_turn', 'cliffhanger', 'final_prose'],
  cliffhanger_type: ['cliffhanger', 'episode_ending'],
  emotional_charge: ['episode_ending', 'cliffhanger', 'final_prose'],
  end_state_change: ['episode_ending', 'mechanic_pressure', 'final_prose'],
};

const FIELD_KIND_PREFIX: Record<AuthoredTreatmentFieldKind, string> = {
  pressure_lane: 'pressure-lane',
  encounter_anchor: 'encounter-anchor',
  encounter_conflict: 'encounter-conflict',
  stakes_layer: 'stakes-layer',
  theme_angle: 'theme-angle',
  lie_pressure: 'lie-pressure',
  encounter_buildup: 'encounter-buildup',
  major_choice_pressure: 'major-choice-pressure',
  alternative_path: 'alternative-path',
  information_movement: 'information-movement',
  consequence_seed: 'consequence-seed',
  ending_turnout: 'ending-turnout',
  resolved_episode_tension: 'resolved-episode-tension',
  cliffhanger_hook: 'cliffhanger-hook',
  cliffhanger_question: 'cliffhanger-question',
  next_episode_pressure: 'next-episode-pressure',
  cliffhanger_setup: 'cliffhanger-setup',
  cliffhanger_type: 'cliffhanger-type',
  emotional_charge: 'emotional-charge',
  end_state_change: 'end-state-change',
};

const STOPWORDS = new Set([
  'about', 'after', 'again', 'against', 'also', 'and', 'because', 'become', 'before',
  'being', 'between', 'choice', 'during', 'episode', 'from', 'have', 'into', 'keeps',
  'later', 'leave', 'leaves', 'major', 'make', 'makes', 'must', 'opens', 'paths',
  'player', 'pressure', 'scene', 'should', 'that', 'their', 'them', 'then', 'there',
  'this', 'through', 'when', 'where', 'with', 'without',
]);

function slug(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'field';
}

export function normalizeTreatmentFieldText(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function treatmentFieldTokens(value: string | undefined): string[] {
  if (!value) return [];
  return normalizeTreatmentFieldText(value)
    .split(' ')
    .filter((token) => token.length >= 4 && !STOPWORDS.has(token));
}

function tokenOverlapScore(needle: string, haystack: string): number {
  const needed = [...new Set(treatmentFieldTokens(needle))];
  if (needed.length === 0) return 0;
  const hayTokens = [...new Set(treatmentFieldTokens(haystack))];
  const haySet = new Set(hayTokens);
  const hits = needed.filter((token) => {
    if (haySet.has(token)) return true;
    return hayTokens.some((hay) => hay.startsWith(token) || token.startsWith(hay));
  }).length;
  return hits / needed.length;
}

export function treatmentFieldCloseMatch(
  needle: string | undefined,
  haystack: string,
  minScore = 0.3,
): boolean {
  if (!needle?.trim()) return true;
  const normalizedNeedle = normalizeTreatmentFieldText(needle);
  if (normalizedNeedle.length === 0) return true;
  const normalizedHaystack = normalizeTreatmentFieldText(haystack);
  if (normalizedHaystack.includes(normalizedNeedle)) return true;
  return tokenOverlapScore(needle, haystack) >= minScore;
}

function makeContract(
  episodeNumber: number,
  fieldName: string,
  sourceText: string | undefined,
  contractKind: AuthoredTreatmentFieldKind,
  index: number,
): AuthoredTreatmentFieldContract | undefined {
  const text = sourceText?.trim();
  if (!text) return undefined;
  return {
    id: `ep${episodeNumber}-${FIELD_KIND_PREFIX[contractKind]}-${index + 1}-${slug(text)}`,
    episodeNumber,
    fieldName,
    sourceText: text,
    contractKind,
    requiredRealization: KIND_REALIZATION[contractKind],
    targetSceneIds: [],
    blockingLevel: 'treatment',
  };
}

function pushScalar(
  out: AuthoredTreatmentFieldContract[],
  episodeNumber: number,
  fieldName: string,
  value: string | undefined,
  kind: AuthoredTreatmentFieldKind,
): void {
  const contract = makeContract(episodeNumber, fieldName, value, kind, out.length);
  if (contract) out.push(contract);
}

function pushList(
  out: AuthoredTreatmentFieldContract[],
  episodeNumber: number,
  fieldName: string,
  values: string[] | undefined,
  kind: AuthoredTreatmentFieldKind,
): void {
  for (const value of values ?? []) {
    const contract = makeContract(episodeNumber, fieldName, value, kind, out.length);
    if (contract) out.push(contract);
  }
}

export function buildTreatmentFieldContractsForGuidance(
  episodeNumber: number,
  guidance: TreatmentEpisodeGuidance | undefined,
): AuthoredTreatmentFieldContract[] {
  if (!guidance) return [];
  const out: AuthoredTreatmentFieldContract[] = [];
  pushScalar(out, episodeNumber, 'A pressure lane', guidance.aPressure, 'pressure_lane');
  pushScalar(out, episodeNumber, 'B pressure lane', guidance.bPressure, 'pressure_lane');
  pushScalar(out, episodeNumber, 'C pressure lane/seed', guidance.cSeed, 'pressure_lane');
  pushList(out, episodeNumber, 'Encounter anchor', guidance.encounterAnchors, 'encounter_anchor');
  pushScalar(out, episodeNumber, 'How the encounter manifests the central conflict', guidance.encounterCentralConflict, 'encounter_conflict');
  pushList(out, episodeNumber, 'Stakes layers present in the major scene/encounter', guidance.stakesLayers, 'stakes_layer');
  pushScalar(out, episodeNumber, 'Theme angle', guidance.themePressure, 'theme_angle');
  pushScalar(out, episodeNumber, 'Lie pressure', guidance.liePressure, 'lie_pressure');
  pushScalar(out, episodeNumber, 'Encounter buildup', guidance.encounterBuildup, 'encounter_buildup');
  pushList(out, episodeNumber, 'Major choice pressure', guidance.majorChoicePressures, 'major_choice_pressure');
  pushList(out, episodeNumber, 'Alternative paths', guidance.alternativePaths, 'alternative_path');
  pushScalar(out, episodeNumber, 'Information movement', guidance.informationMovement, 'information_movement');
  pushList(out, episodeNumber, 'Consequence seeds', guidance.consequenceSeeds, 'consequence_seed');
  pushScalar(out, episodeNumber, 'Ending turnout', guidance.endingTurnout, 'ending_turnout');
  pushScalar(out, episodeNumber, 'Resolved episode tension', guidance.resolvedEpisodeTension, 'resolved_episode_tension');
  pushScalar(out, episodeNumber, 'Cliffhanger hook', guidance.cliffhangerHook, 'cliffhanger_hook');
  pushScalar(out, episodeNumber, 'Cliffhanger question', guidance.cliffhangerQuestion, 'cliffhanger_question');
  pushScalar(out, episodeNumber, 'Next episode pressure', guidance.nextEpisodePressure, 'next_episode_pressure');
  pushScalar(out, episodeNumber, 'Cliffhanger setup', guidance.cliffhangerSetup, 'cliffhanger_setup');
  pushScalar(out, episodeNumber, 'Cliffhanger type', guidance.cliffhangerType, 'cliffhanger_type');
  pushScalar(out, episodeNumber, 'Emotional charge', guidance.emotionalCharge, 'emotional_charge');
  pushScalar(out, episodeNumber, 'End-state change', guidance.endStateChange, 'end_state_change');
  return out;
}

export function buildAuthoredTreatmentFieldContracts(
  episodes: EpisodeGuidanceRef[],
): AuthoredTreatmentFieldContract[] {
  return episodes.flatMap((episode) =>
    buildTreatmentFieldContractsForGuidance(episode.episodeNumber, episode.treatmentGuidance)
  );
}

function sceneMatchText(scene: PlannedScene): string {
  return [
    scene.title,
    scene.dramaticPurpose,
    scene.stakes,
    scene.turnContract?.centralTurn,
    scene.turnContract?.turnEvent,
    scene.turnContract?.handoff,
    scene.signatureMoment,
    scene.encounter?.description,
    scene.encounter?.centralConflict,
    scene.encounter?.aftermathConsequence,
    ...(scene.requiredBeats ?? []).map((beat) => `${beat.sourceTurn} ${beat.mustDepict}`),
    ...(scene.mechanicPressure ?? []).map((contract) => [
      contract.storyPressure,
      ...(contract.evidenceRequired ?? []),
      ...(contract.visibleResidue ?? []),
      ...(contract.allowedPayoffs ?? []),
    ].join(' ')),
  ].filter(Boolean).join(' ');
}

function bestSceneFor(contract: AuthoredTreatmentFieldContract, scenes: PlannedScene[]): PlannedScene | undefined {
  if (scenes.length === 0) return undefined;
  const sorted = [...scenes].sort((a, b) => a.order - b.order);
  const encounter = sorted.find((scene) => scene.kind === 'encounter');
  const choice = sorted.find((scene) => scene.hasChoice);
  const release = [...sorted].reverse().find((scene) => scene.narrativeRole === 'release') ?? sorted[sorted.length - 1];
  const content = sorted.find((scene) => scene.narrativeRole !== 'release') ?? sorted[0];
  const scored = sorted
    .map((scene) => ({ scene, score: tokenOverlapScore(contract.sourceText, sceneMatchText(scene)) }))
    .sort((a, b) => b.score - a.score);
  const lexical = scored[0]?.score >= 0.25 ? scored[0].scene : undefined;

  switch (contract.contractKind) {
    case 'encounter_anchor':
    case 'encounter_conflict':
    case 'encounter_buildup':
      return lexical ?? encounter ?? content;
    case 'major_choice_pressure':
    case 'alternative_path':
      return lexical ?? choice ?? content;
    case 'information_movement':
    case 'consequence_seed':
      return lexical ?? content;
    case 'ending_turnout':
    case 'resolved_episode_tension':
    case 'cliffhanger_hook':
    case 'cliffhanger_question':
    case 'next_episode_pressure':
    case 'cliffhanger_setup':
    case 'cliffhanger_type':
    case 'emotional_charge':
    case 'end_state_change':
      return lexical ?? release;
    default:
      return lexical ?? content;
  }
}

function domainForContract(kind: AuthoredTreatmentFieldKind, sourceText: string): MechanicPressureDomain {
  if (kind === 'information_movement') return 'information';
  if (kind === 'alternative_path' || kind === 'next_episode_pressure') return 'route';
  if (kind === 'encounter_conflict' || kind === 'encounter_anchor' || kind === 'encounter_buildup') return 'encounter';
  if (kind === 'consequence_seed' || kind === 'ending_turnout' || kind === 'end_state_change') {
    if (/\b(key|card|door|threshold|access|permission|resource|ward|sanctuary|money|weapon|tool|gift)\b/i.test(sourceText)) return 'resource';
    if (/\b(secret|learn|know|reveal|information|clue|question|answer|lie|truth)\b/i.test(sourceText)) return 'information';
    if (/\b(friend|trust|ally|love|relationship|family|bond|betray)\b/i.test(sourceText)) return 'relationship';
    return 'flag';
  }
  if (kind === 'lie_pressure' || kind === 'theme_angle' || kind === 'stakes_layer' || kind === 'pressure_lane') return 'identity';
  return 'flag';
}

function pressureFunctionForContract(kind: AuthoredTreatmentFieldKind): MechanicPressureContract['function'] {
  if (kind === 'ending_turnout' || kind === 'resolved_episode_tension' || kind === 'end_state_change') return 'resolve';
  if (kind === 'major_choice_pressure' || kind === 'alternative_path' || kind === 'next_episode_pressure') return 'gate';
  if (kind === 'cliffhanger_hook' || kind === 'cliffhanger_question') return 'complicate';
  if (kind === 'consequence_seed' || kind === 'information_movement') return 'plant';
  return 'intensify';
}

function addMechanicPressureArtifact(scene: PlannedScene, contract: AuthoredTreatmentFieldContract): void {
  const domain = domainForContract(contract.contractKind, contract.sourceText);
  const pressure: MechanicPressureContract = {
    id: `${contract.id}-mechanic-pressure`,
    source: 'treatment',
    domain,
    mechanicRef: domain === 'information'
      ? { infoId: contract.id }
      : domain === 'route'
      ? { routeId: contract.id }
      : domain === 'item' || domain === 'resource'
      ? { flag: contract.id }
      : {},
    function: pressureFunctionForContract(contract.contractKind),
    storyPressure: contract.sourceText,
    evidenceRequired: [`Dramatize treatment field: ${contract.fieldName}`],
    visibleResidue: ['show changed behavior, access, information, risk, posture, outcome, or forward pressure'],
    allowedPayoffs: contract.requiredRealization,
    blockedPayoffs: ['payoffs unsupported by this authored treatment field'],
    originatingSceneId: scene.id,
    payoffWindow: contract.contractKind === 'next_episode_pressure' ? { minEpisode: contract.episodeNumber + 1 } : undefined,
  };
  const existing = scene.mechanicPressure ?? [];
  if (!existing.some((candidate) => candidate.id === pressure.id)) {
    scene.mechanicPressure = [...existing, pressure];
  }
}

export function assignTreatmentFieldContractsToScenes(
  ep: Pick<SeasonEpisode, 'episodeNumber' | 'treatmentGuidance'>,
  scenes: PlannedScene[],
): AuthoredTreatmentFieldContract[] {
  const contracts = buildTreatmentFieldContractsForGuidance(ep.episodeNumber, ep.treatmentGuidance);
  for (const contract of contracts) {
    const target = bestSceneFor(contract, scenes);
    if (!target) continue;
    contract.targetSceneIds = [target.id];
    const existing = target.authoredTreatmentFields ?? [];
    if (!existing.some((candidate) => candidate.id === contract.id)) {
      target.authoredTreatmentFields = [...existing, contract];
    }
    if (
      contract.requiredRealization.includes('mechanic_pressure')
      || contract.requiredRealization.includes('information_ledger')
      || contract.requiredRealization.includes('consequence')
    ) {
      addMechanicPressureArtifact(target, contract);
    }
  }
  return contracts;
}
