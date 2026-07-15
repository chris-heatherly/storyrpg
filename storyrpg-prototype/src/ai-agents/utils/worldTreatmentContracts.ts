import type { SeasonPlan } from '../../types/seasonPlan';
import type {
  MechanicPressureContract,
  MechanicPressureDomain,
  PlannedScene,
  WorldTreatmentFieldKind,
  WorldTreatmentRealizationContract,
  WorldTreatmentRealizationTarget,
} from '../../types/scenePlan';
import type { WorldLocationTreatmentGuidance, WorldLocationTreatmentLocationGuidance } from '../../types/sourceAnalysis';
import {
  treatmentFieldCloseMatch,
  treatmentFieldTokens,
} from './treatmentFieldContracts';

const KIND_PREFIX: Record<WorldTreatmentFieldKind, string> = {
  world_premise: 'world-premise',
  time_period: 'time-period',
  supernatural_rule: 'supernatural-rule',
  dramatic_rule: 'dramatic-rule',
  faction_power: 'faction-power',
  taboo_or_cost: 'taboo-or-cost',
  scarcity: 'scarcity',
  sacred_object: 'sacred-object',
  danger_zone: 'danger-zone',
  location_identity: 'location-identity',
  location_purpose: 'location-purpose',
  location_mood: 'location-mood',
  location_history: 'location-history',
  location_choice_pressure: 'location-choice-pressure',
};

const KIND_REALIZATION: Record<WorldTreatmentFieldKind, WorldTreatmentRealizationTarget[]> = {
  world_premise: ['world_bible', 'season_plan', 'scene_turn', 'final_prose'],
  time_period: ['world_bible', 'season_plan'],
  supernatural_rule: ['world_bible', 'information_ledger', 'mechanic_pressure', 'final_prose'],
  dramatic_rule: ['world_bible', 'choice', 'mechanic_pressure', 'final_prose'],
  faction_power: ['world_bible', 'season_plan', 'mechanic_pressure', 'final_prose'],
  taboo_or_cost: ['world_bible', 'mechanic_pressure', 'final_prose'],
  scarcity: ['world_bible', 'mechanic_pressure', 'final_prose'],
  sacred_object: ['world_bible', 'mechanic_pressure', 'information_ledger', 'final_prose'],
  danger_zone: ['world_bible', 'scene_turn', 'encounter', 'mechanic_pressure', 'final_prose'],
  location_identity: ['world_bible', 'location_introduction', 'final_prose'],
  location_purpose: ['world_bible', 'scene_turn', 'mechanic_pressure', 'final_prose'],
  location_mood: ['world_bible', 'final_prose'],
  location_history: ['world_bible', 'information_ledger', 'mechanic_pressure', 'final_prose'],
  location_choice_pressure: ['world_bible', 'choice', 'mechanic_pressure', 'final_prose'],
};

const LOAD_BEARING_RE = /\b(rule|cannot|must|only|unless|requires?|depends?|contract|invitation|threshold|ward|consent|full[-\s]?moon|bite|turns?|kills?|breaks?|photograph|screen|camera|weapon|danger|forbidden|scarce|sacred|cost|choice|access|key|route|ending|finale|reveal|secret|letter|safe|sanctuary|coven|pack|clan|faction|power|hunt|kill|strigoi|vampire|werewolf|pricolici|succub|incub|magic|ritual|salt|circle|blood|water|sunlight|mirror)\b/i;

function slug(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 54) || 'world-field';
}

function dedupe(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function normalize(value: string | undefined): string {
  return (value ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function targetEpisodes(totalEpisodes: number, firstEpisode = 1): number[] {
  const max = Math.max(1, totalEpisodes || 1);
  const first = Math.max(1, Math.min(max, firstEpisode || 1));
  const midpoint = Math.max(first, Math.min(max, Math.ceil(max / 2)));
  const finale = max;
  return dedupe([first, midpoint, finale].map(String)).map(Number);
}

function targetEpisodesForKind(kind: WorldTreatmentFieldKind, totalEpisodes: number, firstEpisode = 1): number[] {
  const max = Math.max(1, totalEpisodes || 1);
  const first = Math.max(1, Math.min(max, firstEpisode || 1));
  switch (kind) {
    case 'time_period':
    case 'world_premise':
    case 'location_identity':
    case 'location_purpose':
    case 'location_mood':
      return [first];
    case 'location_history':
    case 'location_choice_pressure':
    case 'danger_zone':
    case 'sacred_object':
      return targetEpisodes(totalEpisodes, first);
    default:
      return targetEpisodes(totalEpisodes, 1);
  }
}

function matchLocation(
  location: WorldLocationTreatmentLocationGuidance,
  keyLocations: Array<{ id: string; name: string; firstAppearance?: number }>,
): { id?: string; name: string; firstAppearance: number } {
  const locNorm = normalize(location.name);
  const match = keyLocations.find((candidate) => {
    const candidateNorm = normalize(candidate.name);
    return candidateNorm === locNorm || candidateNorm.includes(locNorm) || locNorm.includes(candidateNorm);
  });
  return {
    id: match?.id,
    name: match?.name ?? location.name,
    firstAppearance: match?.firstAppearance ?? 1,
  };
}

function pressureDomain(kind: WorldTreatmentFieldKind): MechanicPressureDomain {
  switch (kind) {
    case 'supernatural_rule':
    case 'dramatic_rule':
    case 'location_choice_pressure':
      return 'flag';
    case 'sacred_object':
      return 'item';
    case 'faction_power':
      return 'reputation';
    case 'location_history':
      return 'information';
    case 'location_purpose':
    case 'danger_zone':
    case 'taboo_or_cost':
    case 'scarcity':
      return 'resource';
    default:
      return 'information';
  }
}

function pressureFunction(kind: WorldTreatmentFieldKind): MechanicPressureContract['function'] {
  switch (kind) {
    case 'location_choice_pressure':
    case 'dramatic_rule':
      return 'gate';
    case 'supernatural_rule':
    case 'location_history':
      return 'plant';
    case 'danger_zone':
    case 'taboo_or_cost':
    case 'scarcity':
      return 'complicate';
    default:
      return 'intensify';
  }
}

function makeMechanicPressure(contract: WorldTreatmentRealizationContract): MechanicPressureContract | undefined {
  if (!contract.requiredRealization.includes('mechanic_pressure')) return undefined;
  return {
    id: `${contract.id}-pressure`,
    source: contract.source === 'treatment' ? 'treatment' : 'planner',
    domain: pressureDomain(contract.contractKind),
    mechanicRef: contract.locationId
      ? { routeId: contract.locationId, infoId: contract.id }
      : { infoId: contract.id },
    function: pressureFunction(contract.contractKind),
    storyPressure: contract.sourceText,
    evidenceRequired: [`Stage the authored ${contract.fieldName} as behavior, access, danger, reveal pressure, or changed permission.`],
    visibleResidue: ['reader-facing consequence, changed access, risk, clue, NPC posture, or choice pressure'],
    allowedPayoffs: ['choice affordance, encounter complication, information reveal, route access, sanctuary/safety change, or visible scene-state shift'],
    blockedPayoffs: ['contradicting the authored rule, using the location as generic backdrop, or claiming a payoff without planted pressure'],
    originatingSceneId: contract.targetSceneIds[0],
  };
}

function makeContract(input: {
  source: WorldTreatmentRealizationContract['source'];
  fieldName: string;
  sourceText: string | undefined;
  contractKind: WorldTreatmentFieldKind;
  totalEpisodes: number;
  index: number;
  blockingLevel: WorldTreatmentRealizationContract['blockingLevel'];
  locationId?: string;
  locationName?: string;
  firstAppearance?: number;
}): WorldTreatmentRealizationContract | undefined {
  const text = input.sourceText?.trim();
  if (!text) return undefined;
  return {
    id: `world-${input.locationId || slug(input.locationName || input.fieldName)}-${KIND_PREFIX[input.contractKind]}-${input.index + 1}-${slug(text)}`,
    source: input.source,
    fieldName: input.fieldName,
    sourceText: text,
    contractKind: input.contractKind,
    requiredRealization: KIND_REALIZATION[input.contractKind],
    targetEpisodeNumbers: targetEpisodesForKind(input.contractKind, input.totalEpisodes, input.firstAppearance),
    targetSceneIds: [],
    locationId: input.locationId,
    locationName: input.locationName,
    blockingLevel: input.blockingLevel,
  };
}

function push(out: WorldTreatmentRealizationContract[], input: Omit<Parameters<typeof makeContract>[0], 'index'>): void {
  const contract = makeContract({ ...input, index: out.length });
  if (contract) out.push(contract);
}

function splitCostClauses(values: string[] | undefined): string[] {
  return dedupe((values ?? []).flatMap((value) =>
    value
      .split(/\s*(?=\b(?:Forbidden|Scarce|Dangerous|Sacred|Expensive|Humiliating|Socially costly)\s+[—-])/i)
      .map((part) => part.replace(/\.$/, '').trim())
  ));
}

function kindForCost(value: string): WorldTreatmentFieldKind {
  if (/^\s*scarce\b/i.test(value)) return 'scarcity';
  if (/^\s*sacred\b/i.test(value)) return 'sacred_object';
  if (/^\s*dangerous\b/i.test(value)) return 'danger_zone';
  return 'taboo_or_cost';
}

function explicitContracts(input: {
  guidance?: WorldLocationTreatmentGuidance;
  keyLocations?: Array<{ id: string; name: string; importance?: string; firstAppearance?: number; description?: string }>;
  setting?: { worldDetails?: string; timePeriod?: string; location?: string };
  totalEpisodes: number;
  treatmentSourced?: boolean;
}): WorldTreatmentRealizationContract[] {
  const guidance = input.guidance;
  if (!guidance) return [];
  const out: WorldTreatmentRealizationContract[] = [];
  const treatmentLevel: WorldTreatmentRealizationContract['blockingLevel'] = input.treatmentSourced ? 'treatment' : 'warning';
  const structuralLevel: WorldTreatmentRealizationContract['blockingLevel'] = input.treatmentSourced ? 'structural' : 'warning';
  const base = { source: 'treatment' as const, totalEpisodes: input.totalEpisodes };

  push(out, { ...base, fieldName: 'World premise', sourceText: guidance.worldPremise, contractKind: 'world_premise', blockingLevel: 'warning' });
  push(out, { ...base, fieldName: 'Time period', sourceText: guidance.timePeriod, contractKind: 'time_period', blockingLevel: 'warning' });
  for (const rule of guidance.supernaturalRules ?? []) {
    push(out, { ...base, fieldName: 'Technology/magic/supernatural rules', sourceText: rule, contractKind: 'supernatural_rule', blockingLevel: LOAD_BEARING_RE.test(rule) ? treatmentLevel : 'warning' });
  }
  for (const faction of guidance.powerStructures ?? []) {
    push(out, { ...base, fieldName: 'Power structures', sourceText: faction, contractKind: 'faction_power', blockingLevel: LOAD_BEARING_RE.test(faction) ? structuralLevel : 'warning' });
  }
  for (const rule of guidance.dramaticRules ?? []) {
    push(out, { ...base, fieldName: 'Rules that create drama', sourceText: rule, contractKind: 'dramatic_rule', blockingLevel: treatmentLevel });
  }
  for (const cost of splitCostClauses(guidance.costsAndTaboos)) {
    push(out, { ...base, fieldName: 'Forbidden/scarce/dangerous/sacred/costly', sourceText: cost, contractKind: kindForCost(cost), blockingLevel: LOAD_BEARING_RE.test(cost) ? structuralLevel : 'warning' });
  }
  for (const location of guidance.keyLocations ?? []) {
    const matched = matchLocation(location, input.keyLocations ?? []);
    const locationBase = {
      ...base,
      locationId: matched.id,
      locationName: matched.name,
      firstAppearance: matched.firstAppearance,
    };
    push(out, { ...locationBase, fieldName: 'Key location', sourceText: location.sourceText, contractKind: 'location_identity', blockingLevel: structuralLevel });
    push(out, { ...locationBase, fieldName: 'Location purpose', sourceText: location.purpose, contractKind: 'location_purpose', blockingLevel: structuralLevel });
    push(out, { ...locationBase, fieldName: 'Location mood', sourceText: location.mood, contractKind: 'location_mood', blockingLevel: 'warning' });
    push(out, { ...locationBase, fieldName: 'Location history', sourceText: location.history, contractKind: 'location_history', blockingLevel: location.history && LOAD_BEARING_RE.test(location.history) ? structuralLevel : 'warning' });
    push(out, { ...locationBase, fieldName: 'Location choice pressure', sourceText: location.choicePressure, contractKind: 'location_choice_pressure', blockingLevel: treatmentLevel });
  }
  return out;
}

function fallbackContracts(input: {
  keyLocations?: Array<{ id: string; name: string; importance?: string; firstAppearance?: number; description?: string }>;
  setting?: { worldDetails?: string; timePeriod?: string; location?: string };
  totalEpisodes: number;
}): WorldTreatmentRealizationContract[] {
  const out: WorldTreatmentRealizationContract[] = [];
  const base = {
    source: 'analysis_fallback' as const,
    totalEpisodes: input.totalEpisodes,
    blockingLevel: 'warning' as const,
  };
  push(out, { ...base, fieldName: 'World premise', sourceText: input.setting?.worldDetails, contractKind: 'world_premise' });
  push(out, { ...base, fieldName: 'Time period', sourceText: input.setting?.timePeriod, contractKind: 'time_period' });
  for (const location of input.keyLocations ?? []) {
    push(out, {
      ...base,
      fieldName: 'Key location',
      sourceText: `${location.name}: ${location.description ?? ''}`,
      contractKind: 'location_identity',
      locationId: location.id,
      locationName: location.name,
      firstAppearance: location.firstAppearance,
    });
  }
  return out;
}

export function buildWorldTreatmentContracts(input: {
  guidance?: WorldLocationTreatmentGuidance;
  keyLocations?: Array<{ id: string; name: string; importance?: string; firstAppearance?: number; description?: string }>;
  setting?: { worldDetails?: string; timePeriod?: string; location?: string };
  totalEpisodes: number;
  treatmentSourced?: boolean;
}): WorldTreatmentRealizationContract[] {
  const explicit = explicitContracts(input);
  if (explicit.length > 0) return explicit;
  return fallbackContracts(input);
}

export function buildWorldTreatmentContractsForPlan(
  plan: Pick<SeasonPlan, 'worldTreatmentContracts' | 'locationIntroductions' | 'totalEpisodes'> & {
    treatmentSeasonGuidance?: { worldLocationGuidance?: WorldLocationTreatmentGuidance };
  },
): WorldTreatmentRealizationContract[] {
  if ((plan.worldTreatmentContracts ?? []).length > 0) return plan.worldTreatmentContracts ?? [];
  return buildWorldTreatmentContracts({
    guidance: plan.treatmentSeasonGuidance?.worldLocationGuidance,
    keyLocations: (plan.locationIntroductions ?? []).map((loc) => ({
      id: loc.locationId,
      name: loc.locationName,
      firstAppearance: loc.introducedInEpisode,
    })),
    totalEpisodes: plan.totalEpisodes,
    treatmentSourced: Boolean(plan.treatmentSeasonGuidance?.worldLocationGuidance),
  });
}

function sceneText(scene: PlannedScene): string {
  return [
    scene.title,
    scene.dramaticPurpose,
    scene.stakes,
    scene.turnContract?.centralTurn,
    scene.turnContract?.turnEvent,
    scene.turnContract?.handoff,
    scene.encounter?.description,
    scene.encounter?.centralConflict,
    scene.encounter?.aftermathConsequence,
    scene.signatureMoment,
    ...(scene.locations ?? []),
    ...(scene.requiredBeats ?? []).map((beat) => `${beat.sourceTurn} ${beat.mustDepict}`),
    ...(scene.mechanicPressure ?? []).map((pressure) => [
      pressure.storyPressure,
      ...(pressure.evidenceRequired ?? []),
      ...(pressure.visibleResidue ?? []),
      ...(pressure.allowedPayoffs ?? []),
    ].join(' ')),
  ].filter(Boolean).join(' ');
}

function sceneMatchesLocation(scene: PlannedScene, contract: WorldTreatmentRealizationContract): boolean {
  if (!contract.locationId && !contract.locationName) return false;
  const locations = scene.locations ?? [];
  if (contract.locationId && locations.includes(contract.locationId)) return true;
  const contractName = normalize(contract.locationName);
  return locations.some((loc) => {
    const locName = normalize(loc);
    return locName === contractName || locName.includes(contractName) || contractName.includes(locName);
  });
}

function bestScenesForContract(contract: WorldTreatmentRealizationContract, scenes: PlannedScene[]): PlannedScene[] {
  const targetEpisodes = new Set(contract.targetEpisodeNumbers);
  const inEpisode = scenes.filter((scene) => targetEpisodes.has(scene.episodeNumber));
  const candidates = inEpisode.length > 0 ? inEpisode : scenes;
  if (contract.locationId || contract.locationName) {
    const locationMatches = candidates.filter((scene) => sceneMatchesLocation(scene, contract));
    if (locationMatches.length > 0) return locationMatches.slice(0, contract.contractKind === 'location_mood' ? 1 : 3);
  }
  const scored = candidates
    .map((scene) => ({ scene, score: treatmentFieldTokens(contract.sourceText).length > 0 && treatmentFieldCloseMatch(contract.sourceText, sceneText(scene), 0.24) ? 1 : 0 }))
    .sort((a, b) => b.score - a.score || a.scene.order - b.scene.order);
  const lexical = scored.filter((item) => item.score > 0).map((item) => item.scene);
  if (lexical.length > 0) return lexical.slice(0, 2);

  if (contract.contractKind === 'danger_zone') {
    const encounter = candidates.find((scene) => scene.kind === 'encounter' || Boolean(scene.encounter));
    if (encounter) return [encounter];
  }
  if (contract.contractKind === 'location_choice_pressure' || contract.contractKind === 'dramatic_rule') {
    const choice = candidates.find((scene) => scene.hasChoice);
    if (choice) return [choice];
  }
  return candidates.slice(0, 1);
}

export function assignWorldTreatmentContractsToScenes(
  plan: Pick<SeasonPlan, 'worldTreatmentContracts' | 'locationIntroductions' | 'totalEpisodes'> & {
    treatmentSeasonGuidance?: { worldLocationGuidance?: WorldLocationTreatmentGuidance };
  },
  scenes: PlannedScene[],
): WorldTreatmentRealizationContract[] {
  const contracts = buildWorldTreatmentContractsForPlan(plan);
  const contractIds = new Set(contracts.map((contract) => contract.id));

  // Scene locations can be normalized after the first plan projection. Make
  // reassignment transactional and idempotent so a contract cannot remain on
  // the scene that used to own its location while its canonical target points
  // somewhere else.
  for (const scene of scenes) {
    scene.worldTreatmentContracts = (scene.worldTreatmentContracts ?? [])
      .filter((contract) => !contractIds.has(contract.id));
    scene.mechanicPressure = (scene.mechanicPressure ?? [])
      .filter((pressure) => !(
        pressure.mechanicRef?.infoId
        && contractIds.has(pressure.mechanicRef.infoId)
      ));
  }

  for (const contract of contracts) {
    const targets = bestScenesForContract(contract, scenes);
    contract.targetSceneIds = targets.map((scene) => scene.id);
    for (const scene of targets) {
      const existing = scene.worldTreatmentContracts ?? [];
      if (!existing.some((item) => item.id === contract.id)) {
        scene.worldTreatmentContracts = [...existing, contract];
      }
      const pressure = makeMechanicPressure(contract);
      if (pressure) {
        const existingPressure = scene.mechanicPressure ?? [];
        if (!existingPressure.some((item) => item.id === pressure.id)) {
          scene.mechanicPressure = [...existingPressure, { ...pressure, originatingSceneId: scene.id }];
        }
      }
    }
  }
  return contracts;
}

export function worldTreatmentMatchThreshold(contract: WorldTreatmentRealizationContract): number {
  const tokenCount = treatmentFieldTokens(contract.sourceText).length;
  if (contract.contractKind === 'time_period') return 0.8;
  if (contract.contractKind === 'location_mood') return 0.22;
  if (contract.contractKind === 'location_identity') return 0.25;
  if (tokenCount <= 2) return 0.7;
  if (tokenCount <= 5) return 0.4;
  return 0.25;
}
