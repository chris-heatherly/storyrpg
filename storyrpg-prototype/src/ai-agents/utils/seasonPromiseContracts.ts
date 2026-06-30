import type { SeasonPlan, SeasonPromiseArchitecture } from '../../types/seasonPlan';
import type { TreatmentSeasonGuidance } from '../../types/sourceAnalysis';
import type {
  MechanicPressureContract,
  MechanicPressureDomain,
  PlannedScene,
  SeasonPromiseRealizationContract,
  SeasonPromiseRealizationKind,
  SeasonPromiseRealizationTarget,
} from '../../types/scenePlan';
import {
  treatmentFieldCloseMatch,
  treatmentFieldTokens,
} from './treatmentFieldContracts';

const KIND_PREFIX: Record<SeasonPromiseRealizationKind, string> = {
  genre_progression: 'genre-progression',
  tone_progression: 'tone-progression',
  high_concept_pitch: 'high-concept-pitch',
  logline_engine: 'logline-engine',
  core_fantasy: 'core-fantasy',
  audience_promise: 'audience-promise',
  premise_promise: 'premise-promise',
  theme_question: 'theme-question',
  inaction_pressure: 'inaction-pressure',
  season_dramatic_question: 'season-dramatic-question',
  central_pressure: 'central-pressure',
  player_promise: 'player-promise',
  emotional_promise: 'emotional-promise',
  fresh_variation_plan: 'fresh-variation-plan',
  typical_episode_engine: 'typical-episode-engine',
  season_resolution_obligation: 'season-resolution-obligation',
  future_open_thread: 'future-open-thread',
};

const KIND_REALIZATION: Record<SeasonPromiseRealizationKind, SeasonPromiseRealizationTarget[]> = {
  genre_progression: ['metadata', 'episode_plan', 'scene_turn', 'encounter', 'final_prose'],
  tone_progression: ['metadata', 'episode_plan', 'scene_turn', 'final_prose'],
  high_concept_pitch: ['metadata', 'episode_plan', 'scene_turn', 'choice', 'encounter', 'episode_ending', 'final_prose'],
  logline_engine: ['episode_plan', 'scene_turn', 'choice', 'mechanic_pressure', 'final_prose'],
  core_fantasy: ['episode_plan', 'scene_turn', 'choice', 'final_prose'],
  audience_promise: ['episode_plan', 'scene_turn', 'encounter', 'episode_ending', 'final_prose'],
  premise_promise: ['episode_plan', 'scene_turn', 'choice', 'mechanic_pressure', 'final_prose'],
  theme_question: ['scene_turn', 'choice', 'encounter', 'mechanic_pressure', 'final_prose'],
  inaction_pressure: ['scene_turn', 'choice', 'encounter', 'consequence_chain', 'mechanic_pressure', 'final_prose'],
  season_dramatic_question: ['episode_plan', 'scene_turn', 'choice', 'encounter', 'episode_ending', 'final_prose'],
  central_pressure: ['episode_plan', 'scene_turn', 'encounter', 'consequence_chain', 'mechanic_pressure', 'final_prose'],
  player_promise: ['episode_plan', 'scene_turn', 'choice', 'consequence_chain', 'mechanic_pressure', 'final_prose'],
  emotional_promise: ['episode_plan', 'scene_turn', 'encounter', 'episode_ending', 'final_prose'],
  fresh_variation_plan: ['episode_plan', 'scene_turn', 'encounter', 'choice', 'episode_ending', 'final_prose'],
  typical_episode_engine: ['episode_plan', 'scene_turn', 'choice', 'encounter', 'information_ledger', 'consequence_chain', 'final_prose'],
  season_resolution_obligation: ['episode_plan', 'episode_ending', 'consequence_chain', 'mechanic_pressure', 'final_prose'],
  future_open_thread: ['episode_plan', 'information_ledger', 'cliffhanger', 'next_episode_plan', 'mechanic_pressure', 'final_prose'],
};

const PROGRESSION_RE = /\b(graduate|darken|darkens|darker|by\s+midseason|midseason|back\s+half|finale|final\s+three|early\s+episodes|first\s+\w+\s+episodes|episodes?\s*\d|escalat|turns?\s+into|becomes?)\b/i;

function slug(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 52) || 'promise';
}

function hasText(value: string | undefined): value is string {
  return Boolean(value?.trim());
}

function targetEpisodesFor(kind: SeasonPromiseRealizationKind, text: string, totalEpisodes: number): number[] {
  const max = Math.max(1, totalEpisodes || 1);
  const first = 1;
  const second = Math.min(2, max);
  const midpoint = Math.max(1, Math.ceil(max / 2));
  const finale = max;
  const early = Array.from(new Set([first, second].filter((n) => n <= max)));
  const bands = Array.from(new Set([first, midpoint, finale].filter((n) => n >= 1 && n <= max)));
  const postPilot = max > 1 ? Array.from({ length: max - 1 }, (_unused, index) => index + 2) : [first];

  switch (kind) {
    case 'genre_progression':
    case 'tone_progression':
      return PROGRESSION_RE.test(text) ? bands : early;
    case 'audience_promise':
      return bands;
    case 'high_concept_pitch':
    case 'core_fantasy':
    case 'premise_promise':
    case 'logline_engine':
      return Array.from(new Set([...early, midpoint].filter((n) => n <= max)));
    case 'theme_question':
    case 'inaction_pressure':
    case 'season_dramatic_question':
    case 'central_pressure':
    case 'player_promise':
    case 'emotional_promise':
      return bands;
    case 'fresh_variation_plan':
      return bands;
    case 'typical_episode_engine':
      return postPilot;
    case 'season_resolution_obligation':
    case 'future_open_thread':
      return [finale];
    default:
      return early;
  }
}

function makeContract(
  kind: SeasonPromiseRealizationKind,
  sourceText: string | undefined,
  totalEpisodes: number,
  index: number,
  blockingLevel: SeasonPromiseRealizationContract['blockingLevel'],
): SeasonPromiseRealizationContract | undefined {
  const text = sourceText?.trim();
  if (!text) return undefined;
  return {
    id: `season-${KIND_PREFIX[kind]}-${index + 1}-${slug(text)}`,
    sourceText: text,
    contractKind: kind,
    requiredRealization: KIND_REALIZATION[kind],
    targetEpisodeNumbers: targetEpisodesFor(kind, text, totalEpisodes),
    targetSceneIds: [],
    blockingLevel,
  };
}

function push(
  out: SeasonPromiseRealizationContract[],
  kind: SeasonPromiseRealizationKind,
  text: string | undefined,
  totalEpisodes: number,
  blockingLevel: SeasonPromiseRealizationContract['blockingLevel'],
): void {
  const contract = makeContract(kind, text, totalEpisodes, out.length, blockingLevel);
  if (contract) out.push(contract);
}

function architectureFallbacks(architecture?: SeasonPromiseArchitecture): Partial<Record<SeasonPromiseRealizationKind, string>> {
  if (!architecture) return {};
  return {
    logline_engine: [
      architecture.seasonDramaticQuestion,
      architecture.centralPressure?.description,
    ].filter(Boolean).join(' '),
    core_fantasy: architecture.seasonPromise?.playerExperiencePromise,
    audience_promise: [
      architecture.seasonPromise?.emotionalPromise,
      ...(architecture.seasonPromise?.variationPlan ?? []),
    ].filter(Boolean).join(' '),
    premise_promise: architecture.seasonPromise?.premisePromise,
    theme_question: architecture.seasonDramaticQuestion,
    inaction_pressure: [
      architecture.centralPressure?.description,
      architecture.centralPressure?.pressuresLieBy,
    ].filter(Boolean).join(' '),
    season_dramatic_question: architecture.seasonDramaticQuestion,
    central_pressure: [
      architecture.centralPressure?.description,
      architecture.centralPressure?.pressuresLieBy,
    ].filter(Boolean).join(' '),
    player_promise: architecture.seasonPromise?.playerExperiencePromise,
    emotional_promise: architecture.seasonPromise?.emotionalPromise,
    fresh_variation_plan: (architecture.seasonPromise?.variationPlan ?? []).join(' '),
    season_resolution_obligation: [
      architecture.seasonCompleteness?.resolvedQuestion,
      architecture.seasonCompleteness?.resolvedStakes,
      architecture.seasonCompleteness?.characterStateChange,
    ].filter(Boolean).join(' '),
    future_open_thread: architecture.seasonCompleteness?.openFuturePressure,
  };
}

export function buildSeasonPromiseContracts(input: {
  guidance?: TreatmentSeasonGuidance;
  architecture?: SeasonPromiseArchitecture;
  totalEpisodes: number;
  treatmentSourced?: boolean;
}): SeasonPromiseRealizationContract[] {
  const out: SeasonPromiseRealizationContract[] = [];
  const guidance = input.guidance;
  const level: SeasonPromiseRealizationContract['blockingLevel'] = input.treatmentSourced ? 'treatment' : 'warning';
  push(out, 'genre_progression', guidance?.genre, input.totalEpisodes, level);
  push(out, 'tone_progression', guidance?.tone, input.totalEpisodes, level);
  push(out, 'high_concept_pitch', guidance?.highConceptPitch, input.totalEpisodes, level);
  push(out, 'logline_engine', guidance?.logline, input.totalEpisodes, level);
  push(out, 'core_fantasy', guidance?.coreFantasy, input.totalEpisodes, level);
  push(out, 'audience_promise', guidance?.audiencePromise, input.totalEpisodes, level);
  push(out, 'premise_promise', guidance?.premisePromise, input.totalEpisodes, level);
  push(out, 'theme_question', guidance?.themeQuestion, input.totalEpisodes, level);
  push(out, 'inaction_pressure', guidance?.inactionPressure, input.totalEpisodes, level);
  push(out, 'season_dramatic_question', guidance?.seasonDramaticQuestion, input.totalEpisodes, level);
  push(out, 'central_pressure', guidance?.centralPressure, input.totalEpisodes, level);
  push(out, 'player_promise', guidance?.playerPromise, input.totalEpisodes, level);
  push(out, 'emotional_promise', guidance?.emotionalPromise, input.totalEpisodes, level);
  push(out, 'fresh_variation_plan', guidance?.freshVariationPlan, input.totalEpisodes, level);
  push(out, 'typical_episode_engine', guidance?.typicalEpisodeDeliverables, input.totalEpisodes, level);
  push(out, 'season_resolution_obligation', guidance?.seasonMustResolve, input.totalEpisodes, level);
  push(out, 'future_open_thread', guidance?.futureOpenThreads, input.totalEpisodes, level);

  const hasExplicitTopLevel = out.length > 0;
  if (!hasExplicitTopLevel) {
    const fallbacks = architectureFallbacks(input.architecture);
    for (const kind of [
      'logline_engine',
      'high_concept_pitch',
      'core_fantasy',
      'audience_promise',
      'premise_promise',
      'theme_question',
      'inaction_pressure',
      'season_dramatic_question',
      'central_pressure',
      'player_promise',
      'emotional_promise',
      'fresh_variation_plan',
      'season_resolution_obligation',
      'future_open_thread',
    ] as const) {
      push(out, kind, fallbacks[kind], input.totalEpisodes, 'warning');
    }
  }

  return out;
}

export function buildSeasonPromiseContractsForPlan(
  plan: Pick<SeasonPlan, 'seasonPromiseContracts' | 'seasonPromiseArchitecture' | 'totalEpisodes'> & {
    treatmentSeasonGuidance?: TreatmentSeasonGuidance;
  },
): SeasonPromiseRealizationContract[] {
  if ((plan.seasonPromiseContracts ?? []).length > 0) return plan.seasonPromiseContracts ?? [];
  return buildSeasonPromiseContracts({
    guidance: plan.treatmentSeasonGuidance,
    architecture: plan.seasonPromiseArchitecture,
    totalEpisodes: plan.totalEpisodes,
    treatmentSourced: Boolean(plan.treatmentSeasonGuidance),
  });
}

function sceneText(scene: PlannedScene): string {
  return [
    scene.title,
    scene.dramaticPurpose,
    scene.stakes,
    scene.turnContract?.centralTurn,
    scene.turnContract?.turnEvent,
    scene.turnContract?.afterState,
    scene.signatureMoment,
    scene.encounter?.description,
    scene.encounter?.centralConflict,
    ...(scene.mechanicPressure ?? []).map((contract) => contract.storyPressure),
    ...(scene.authoredTreatmentFields ?? []).map((contract) => contract.sourceText),
  ].filter(Boolean).join(' ');
}

function scoreScene(contract: SeasonPromiseRealizationContract, scene: PlannedScene): number {
  const tokens = treatmentFieldTokens(contract.sourceText);
  if (tokens.length === 0) return 0;
  let score = treatmentFieldCloseMatch(contract.sourceText, sceneText(scene), 0.2) ? 1 : 0;
  if (contract.contractKind === 'theme_question' && scene.hasChoice) score += 0.35;
  if (contract.contractKind === 'inaction_pressure' && (scene.kind === 'encounter' || scene.hasChoice)) score += 0.35;
  if (contract.contractKind === 'season_dramatic_question' && (scene.hasChoice || scene.kind === 'encounter')) score += 0.3;
  if (contract.contractKind === 'central_pressure' && (scene.kind === 'encounter' || scene.hasChoice)) score += 0.35;
  if (contract.contractKind === 'player_promise' && scene.hasChoice) score += 0.35;
  if (contract.contractKind === 'typical_episode_engine' && (scene.kind === 'encounter' || scene.hasChoice)) score += 0.25;
  if ((contract.contractKind === 'genre_progression' || contract.contractKind === 'tone_progression') && scene.kind === 'encounter') score += 0.2;
  if ((contract.contractKind === 'high_concept_pitch' || contract.contractKind === 'core_fantasy' || contract.contractKind === 'premise_promise' || contract.contractKind === 'logline_engine') && scene.order <= 1) score += 0.25;
  if (
    (contract.contractKind === 'audience_promise'
      || contract.contractKind === 'emotional_promise'
      || contract.contractKind === 'fresh_variation_plan'
      || contract.contractKind === 'season_resolution_obligation'
      || contract.contractKind === 'future_open_thread')
    && scene.narrativeRole === 'release'
  ) score += 0.2;
  return score;
}

function bestSceneFor(contract: SeasonPromiseRealizationContract, scenes: PlannedScene[]): PlannedScene | undefined {
  if (scenes.length === 0) return undefined;
  const sorted = [...scenes].sort((a, b) => a.order - b.order);
  const scored = sorted
    .map((scene) => ({ scene, score: scoreScene(contract, scene) }))
    .sort((a, b) => b.score - a.score);
  if (scored[0]?.score > 0) return scored[0].scene;
  const encounter = sorted.find((scene) => scene.kind === 'encounter');
  const choice = sorted.find((scene) => scene.hasChoice);
  const release = [...sorted].reverse().find((scene) => scene.narrativeRole === 'release');
  switch (contract.contractKind) {
    case 'theme_question':
    case 'inaction_pressure':
    case 'season_dramatic_question':
    case 'central_pressure':
    case 'player_promise':
    case 'typical_episode_engine':
      return encounter ?? choice ?? sorted[0];
    case 'audience_promise':
    case 'emotional_promise':
    case 'fresh_variation_plan':
      return encounter ?? release ?? choice ?? sorted[0];
    case 'season_resolution_obligation':
    case 'future_open_thread':
      return release ?? encounter ?? choice ?? sorted[sorted.length - 1];
    case 'genre_progression':
    case 'tone_progression':
      return encounter ?? sorted.find((scene) => scene.narrativeRole !== 'release') ?? sorted[0];
    case 'logline_engine':
    case 'high_concept_pitch':
    case 'core_fantasy':
    case 'premise_promise':
      return sorted.find((scene) => scene.order === 0) ?? sorted[0];
    default:
      return sorted[0];
  }
}

function domainFor(contract: SeasonPromiseRealizationContract): MechanicPressureDomain {
  if (contract.contractKind === 'inaction_pressure') return 'route';
  if (contract.contractKind === 'theme_question' || contract.contractKind === 'season_dramatic_question') return 'identity';
  if (contract.contractKind === 'central_pressure') return 'encounter';
  if (contract.contractKind === 'player_promise') return 'route';
  if (contract.contractKind === 'future_open_thread') return 'information';
  if (contract.contractKind === 'season_resolution_obligation') return 'flag';
  if (contract.contractKind === 'high_concept_pitch' || contract.contractKind === 'logline_engine' || contract.contractKind === 'premise_promise' || contract.contractKind === 'typical_episode_engine') return 'flag';
  if (contract.contractKind === 'core_fantasy') return 'reputation';
  return 'identity';
}

function addMechanicPressure(scene: PlannedScene, contract: SeasonPromiseRealizationContract): void {
  if (!contract.requiredRealization.includes('mechanic_pressure')) return;
  const pressure: MechanicPressureContract = {
    id: `${contract.id}-mechanic-pressure`,
    source: contract.blockingLevel === 'treatment' ? 'treatment' : 'planner',
    domain: domainFor(contract),
    mechanicRef: { flag: contract.id },
    function: contract.contractKind === 'inaction_pressure' ? 'intensify' : 'plant',
    storyPressure: contract.sourceText,
    evidenceRequired: ['Stage the top-level season promise as a fictional event, choice pressure, cost, or changed permission.'],
    visibleResidue: ['show changed behavior, narrowed options, altered tone, access, relationship posture, or forward pressure'],
    allowedPayoffs: contract.requiredRealization,
    blockedPayoffs: ['metadata-only promise fulfillment', 'explanatory sentence without staged evidence'],
    originatingSceneId: scene.id,
  };
  const existing = scene.mechanicPressure ?? [];
  if (!existing.some((candidate) => candidate.id === pressure.id)) {
    scene.mechanicPressure = [...existing, pressure];
  }
}

export function assignSeasonPromiseContractsToScenes(
  plan: Pick<SeasonPlan, 'seasonPromiseContracts' | 'totalEpisodes'>,
  scenes: PlannedScene[],
): SeasonPromiseRealizationContract[] {
  const contracts = plan.seasonPromiseContracts ?? [];
  for (const contract of contracts) {
    const targetIds = new Set(contract.targetSceneIds ?? []);
    for (const episodeNumber of contract.targetEpisodeNumbers ?? []) {
      const episodeScenes = scenes.filter((scene) => scene.episodeNumber === episodeNumber);
      const target = bestSceneFor(contract, episodeScenes);
      if (!target) continue;
      targetIds.add(target.id);
      const existing = target.seasonPromiseContracts ?? [];
      if (!existing.some((candidate) => candidate.id === contract.id)) {
        target.seasonPromiseContracts = [...existing, contract];
      }
      addMechanicPressure(target, contract);
    }
    contract.targetSceneIds = Array.from(targetIds);
  }
  return contracts;
}

export function seasonPromiseMatchThreshold(contract: SeasonPromiseRealizationContract): number {
  const tokenCount = treatmentFieldTokens(contract.sourceText).length;
  if (contract.contractKind === 'genre_progression' || contract.contractKind === 'tone_progression') {
    return PROGRESSION_RE.test(contract.sourceText) ? 0.2 : 0.35;
  }
  if (tokenCount <= 3) return 0.45;
  if (
    contract.contractKind === 'theme_question'
    || contract.contractKind === 'inaction_pressure'
    || contract.contractKind === 'season_dramatic_question'
    || contract.contractKind === 'central_pressure'
    || contract.contractKind === 'high_concept_pitch'
    || contract.contractKind === 'player_promise'
    || contract.contractKind === 'typical_episode_engine'
    || contract.contractKind === 'season_resolution_obligation'
    || contract.contractKind === 'future_open_thread'
  ) return 0.2;
  return 0.25;
}

export function seasonPromiseHasProgressionLanguage(sourceText: string | undefined): boolean {
  return Boolean(sourceText && PROGRESSION_RE.test(sourceText));
}
