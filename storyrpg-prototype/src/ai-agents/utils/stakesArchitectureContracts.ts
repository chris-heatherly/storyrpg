import type { SeasonPlan } from '../../types/seasonPlan';
import type { TreatmentSeasonGuidance } from '../../types/sourceAnalysis';
import type {
  MechanicPressureContract,
  MechanicPressureDomain,
  PlannedScene,
  StakesArchitectureContract,
  StakesArchitectureContractKind,
  StakesArchitectureRealizationTarget,
} from '../../types/scenePlan';
import {
  treatmentFieldCloseMatch,
  treatmentFieldTokens,
} from './treatmentFieldContracts';

const KIND_PREFIX: Record<StakesArchitectureContractKind, string> = {
  material_stake: 'material-stake',
  relational_stake: 'relational-stake',
  identity_stake: 'identity-stake',
  existential_stake: 'existential-stake',
  stakes_escalation_step: 'stakes-escalation-step',
  personal_stakes_prerequisite: 'personal-stakes-prerequisite',
  emotional_stakes_anchor: 'emotional-stakes-anchor',
};

const KIND_REALIZATION: Record<StakesArchitectureContractKind, StakesArchitectureRealizationTarget[]> = {
  material_stake: ['stakes_layer', 'scene_turn', 'choice', 'mechanic_pressure', 'information_ledger', 'final_prose'],
  relational_stake: ['stakes_layer', 'scene_turn', 'choice', 'relationship_pacing', 'mechanic_pressure', 'final_prose'],
  identity_stake: ['stakes_layer', 'scene_turn', 'choice', 'character_treatment', 'mechanic_pressure', 'episode_ending', 'final_prose'],
  existential_stake: ['stakes_layer', 'scene_turn', 'choice', 'mechanic_pressure', 'episode_ending', 'final_prose'],
  stakes_escalation_step: ['stakes_layer', 'scene_turn', 'choice', 'mechanic_pressure', 'episode_ending', 'final_prose'],
  personal_stakes_prerequisite: ['stakes_layer', 'scene_turn', 'mechanic_pressure', 'final_prose'],
  emotional_stakes_anchor: ['scene_turn', 'mechanic_pressure', 'world_location', 'information_ledger', 'final_prose'],
};

const LOAD_BEARING_RE = /\b(blog|readership|byline|income|apartment|sanctuary|brand|deal|column|spreadsheet|victims?|letter|friendship|trust|freedom|contract|choose|choice|voice|owned|consort|humanity|life|death|dying|legacy|line|judgment|hunter|moon|finale|ending|eligibility|route|ward|quartz|scarf|chain|name|circle|access|safe|protect|betray|confession|forgive|survive|weaponized)\b/i;
const DECORATIVE_RE = /\b(mood|vibe|texture|color|fashion|lighting|beautiful|glamour|glamorous|cocktail|cobblestone)\b/i;

function slug(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 54) || 'stake';
}

function dedupe(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function nonempty(values: string[] | undefined): string[] {
  return dedupe(values ?? []);
}

function layerFor(kind: StakesArchitectureContractKind): StakesArchitectureContract['stakeLayer'] {
  if (kind === 'material_stake') return 'material';
  if (kind === 'relational_stake') return 'relational';
  if (kind === 'identity_stake') return 'identity';
  if (kind === 'existential_stake') return 'existential';
  return undefined;
}

function targetEpisodesFor(kind: StakesArchitectureContractKind, totalEpisodes: number, index = 0): number[] {
  const max = Math.max(1, totalEpisodes || 1);
  const first = 1;
  const second = Math.min(2, max);
  const midpoint = Math.max(1, Math.ceil(max / 2));
  const late = Math.max(1, Math.ceil(max * 0.75));
  const finale = max;
  switch (kind) {
    case 'material_stake':
    case 'relational_stake':
      return dedupe([first, midpoint, finale].filter((n) => n <= max).map(String)).map(Number);
    case 'identity_stake':
      return dedupe([second, midpoint, finale].filter((n) => n <= max).map(String)).map(Number);
    case 'existential_stake':
      return dedupe([late, finale].filter((n) => n <= max).map(String)).map(Number);
    case 'stakes_escalation_step': {
      const ep = Math.min(max, Math.max(1, Math.round(1 + index * Math.max(1, (max - 1) / 7))));
      return [ep];
    }
    case 'personal_stakes_prerequisite':
      return [first];
    case 'emotional_stakes_anchor':
      return dedupe([first, midpoint].filter((n) => n <= max).map(String)).map(Number);
    default:
      return [first];
  }
}

function blockingLevelFor(
  text: string,
  kind: StakesArchitectureContractKind,
  treatmentSourced: boolean | undefined,
): StakesArchitectureContract['blockingLevel'] {
  if (!treatmentSourced) return 'warning';
  if (kind === 'emotional_stakes_anchor' && DECORATIVE_RE.test(text) && !LOAD_BEARING_RE.test(text)) return 'warning';
  if (kind === 'stakes_escalation_step' || kind === 'personal_stakes_prerequisite') return 'structural';
  return LOAD_BEARING_RE.test(text) ? 'treatment' : 'structural';
}

function makeContract(input: {
  kind: StakesArchitectureContractKind;
  fieldName: string;
  sourceText: string | undefined;
  totalEpisodes: number;
  treatmentSourced?: boolean;
  index: number;
}): StakesArchitectureContract | undefined {
  const text = input.sourceText?.trim();
  if (!text) return undefined;
  return {
    id: `stakes-${KIND_PREFIX[input.kind]}-${input.index + 1}-${slug(text)}`,
    source: input.treatmentSourced ? 'treatment' : 'analysis_fallback',
    fieldName: input.fieldName,
    sourceText: text,
    contractKind: input.kind,
    stakeLayer: layerFor(input.kind),
    requiredRealization: KIND_REALIZATION[input.kind],
    targetEpisodeNumbers: targetEpisodesFor(input.kind, input.totalEpisodes, input.index),
    targetSceneIds: [],
    prerequisiteContractIds: [],
    linkedContractIds: [],
    blockingLevel: blockingLevelFor(text, input.kind, input.treatmentSourced),
  };
}

function push(
  out: StakesArchitectureContract[],
  kind: StakesArchitectureContractKind,
  fieldName: string,
  values: string[] | undefined,
  totalEpisodes: number,
  treatmentSourced?: boolean,
): void {
  for (const value of nonempty(values)) {
    const contract = makeContract({ kind, fieldName, sourceText: value, totalEpisodes, treatmentSourced, index: out.length });
    if (contract) out.push(contract);
  }
}

function fallbackFromRaw(raw: string | undefined): string[] {
  if (!raw?.trim()) return [];
  return raw
    .split(/\n+/)
    .map((line) => line.replace(/^-\s+/, '').replace(/\*\*/g, '').trim())
    .filter((line) => /stakes?|sanctuary|friend|identity|life|death|voice|blog|ending|payoff|protect|survive/i.test(line));
}

function assignPrerequisites(contracts: StakesArchitectureContract[]): void {
  const personal = contracts.filter((contract) =>
    contract.contractKind === 'material_stake'
    || contract.contractKind === 'relational_stake'
    || contract.contractKind === 'identity_stake'
    || contract.contractKind === 'personal_stakes_prerequisite'
  );
  const prerequisiteIds = personal.slice(0, 6).map((contract) => contract.id);
  for (const contract of contracts) {
    if (contract.contractKind === 'existential_stake' || contract.contractKind === 'stakes_escalation_step') {
      contract.prerequisiteContractIds = prerequisiteIds.filter((id) => id !== contract.id);
    }
  }
}

export function buildStakesArchitectureContracts(input: {
  guidance?: TreatmentSeasonGuidance;
  totalEpisodes: number;
  treatmentSourced?: boolean;
}): StakesArchitectureContract[] {
  const out: StakesArchitectureContract[] = [];
  const guidance = input.guidance?.stakesArchitectureGuidance;
  push(out, 'material_stake', 'Primary material stakes', guidance?.primaryMaterialStakes, input.totalEpisodes, input.treatmentSourced);
  push(out, 'relational_stake', 'Primary relational stakes', guidance?.primaryRelationalStakes, input.totalEpisodes, input.treatmentSourced);
  push(out, 'identity_stake', 'Primary identity stakes', guidance?.primaryIdentityStakes, input.totalEpisodes, input.treatmentSourced);
  push(out, 'existential_stake', 'Primary existential stakes', guidance?.primaryExistentialStakes, input.totalEpisodes, input.treatmentSourced);
  push(out, 'stakes_escalation_step', 'How stakes escalate gradually', guidance?.escalationLadder, input.totalEpisodes, input.treatmentSourced);
  if (guidance?.personalBeforeLarger?.trim()) {
    push(out, 'personal_stakes_prerequisite', 'How personal stakes are established before larger stakes', [guidance.personalBeforeLarger], input.totalEpisodes, input.treatmentSourced);
  }
  push(out, 'emotional_stakes_anchor', 'Which relationships/places/promises make the stakes emotionally legible', guidance?.emotionalLegibilityAnchors, input.totalEpisodes, input.treatmentSourced);

  if (out.length === 0) {
    push(out, 'stakes_escalation_step', 'Stakes Architecture', fallbackFromRaw(input.guidance?.stakesArchitecture), input.totalEpisodes, input.treatmentSourced);
  }

  assignPrerequisites(out);
  return out;
}

export function buildStakesArchitectureContractsForPlan(
  plan: Pick<SeasonPlan, 'stakesArchitectureContracts' | 'totalEpisodes'> & {
    treatmentSeasonGuidance?: TreatmentSeasonGuidance;
  },
): StakesArchitectureContract[] {
  if ((plan.stakesArchitectureContracts ?? []).length > 0) return plan.stakesArchitectureContracts ?? [];
  return buildStakesArchitectureContracts({
    guidance: plan.treatmentSeasonGuidance,
    totalEpisodes: plan.totalEpisodes,
    treatmentSourced: Boolean(plan.treatmentSeasonGuidance?.stakesArchitecture || plan.treatmentSeasonGuidance?.stakesArchitectureGuidance),
  });
}

function sceneText(scene: PlannedScene): string {
  return [
    scene.title,
    scene.dramaticPurpose,
    scene.stakes,
    scene.turnContract?.centralTurn,
    scene.turnContract?.beforeState,
    scene.turnContract?.turnEvent,
    scene.turnContract?.afterState,
    scene.signatureMoment,
    scene.encounter?.description,
    scene.encounter?.centralConflict,
    ...(scene.locations ?? []),
    ...(scene.requiredBeats ?? []).map((beat) => `${beat.sourceTurn} ${beat.mustDepict}`),
    ...(scene.mechanicPressure ?? []).map((pressure) => [
      pressure.storyPressure,
      ...(pressure.evidenceRequired ?? []),
      ...(pressure.visibleResidue ?? []),
      ...(pressure.allowedPayoffs ?? []),
    ].join(' ')),
    ...(scene.relationshipPacing ?? []).map((rel) => `${rel.npcId ?? rel.groupId ?? ''} ${rel.requiredEvidence.join(' ')}`),
    ...(scene.worldTreatmentContracts ?? []).map((contract) => contract.sourceText),
    ...(scene.characterTreatmentContracts ?? []).map((contract) => contract.sourceText),
    ...(scene.seasonPromiseContracts ?? []).map((contract) => contract.sourceText),
  ].filter(Boolean).join(' ');
}

function scoreScene(contract: StakesArchitectureContract, scene: PlannedScene): number {
  let score = treatmentFieldCloseMatch(contract.sourceText, sceneText(scene), stakesArchitectureMatchThreshold(contract)) ? 1 : 0;
  if (contract.targetEpisodeNumbers.includes(scene.episodeNumber)) score += 0.25;
  if (contract.contractKind === 'relational_stake' && ((scene.relationshipPacing ?? []).length > 0 || scene.hasChoice)) score += 0.35;
  if (contract.contractKind === 'identity_stake' && (scene.hasChoice || Boolean(scene.turnContract))) score += 0.3;
  if (contract.contractKind === 'existential_stake' && (scene.narrativeRole === 'payoff' || scene.narrativeRole === 'release' || scene.kind === 'encounter')) score += 0.35;
  if (contract.contractKind === 'material_stake' && ((scene.mechanicPressure ?? []).length > 0 || (scene.locations ?? []).length > 0)) score += 0.25;
  if (contract.contractKind === 'emotional_stakes_anchor' && ((scene.worldTreatmentContracts ?? []).length > 0 || (scene.mechanicPressure ?? []).length > 0)) score += 0.25;
  if (contract.contractKind === 'stakes_escalation_step' && (scene.kind === 'encounter' || scene.narrativeRole === 'turn' || scene.narrativeRole === 'payoff')) score += 0.25;
  return score;
}

function bestScenesForContract(contract: StakesArchitectureContract, scenes: PlannedScene[]): PlannedScene[] {
  const targetEpisodes = new Set(contract.targetEpisodeNumbers);
  const inEpisode = scenes.filter((scene) => targetEpisodes.has(scene.episodeNumber));
  const candidates = inEpisode.length > 0 ? inEpisode : scenes;
  const scored = candidates
    .map((scene) => ({ scene, score: scoreScene(contract, scene) }))
    .sort((a, b) => b.score - a.score || a.scene.episodeNumber - b.scene.episodeNumber || a.scene.order - b.scene.order);
  const lexical = scored.filter((item) => item.score >= 1).map((item) => item.scene);
  if (lexical.length > 0) return lexical.slice(0, contract.contractKind === 'emotional_stakes_anchor' ? 2 : 3);
  const encounter = candidates.find((scene) => scene.kind === 'encounter');
  const choice = candidates.find((scene) => scene.hasChoice);
  const release = [...candidates].reverse().find((scene) => scene.narrativeRole === 'release');
  switch (contract.contractKind) {
    case 'relational_stake':
    case 'identity_stake':
      return [choice ?? encounter ?? candidates[0]].filter(Boolean) as PlannedScene[];
    case 'existential_stake':
      return [release ?? encounter ?? candidates[candidates.length - 1]].filter(Boolean) as PlannedScene[];
    case 'stakes_escalation_step':
      return [encounter ?? choice ?? candidates[Math.max(0, candidates.length - 1)]].filter(Boolean) as PlannedScene[];
    default:
      return [choice ?? candidates[0]].filter(Boolean) as PlannedScene[];
  }
}

function pressureDomain(contract: StakesArchitectureContract): MechanicPressureDomain {
  switch (contract.contractKind) {
    case 'relational_stake':
      return 'relationship';
    case 'identity_stake':
    case 'existential_stake':
      return 'identity';
    case 'material_stake':
      if (/\b(blog|readership|brand|column|reputation|byline)\b/i.test(contract.sourceText)) return 'reputation';
      if (/\b(apartment|sanctuary|access|key|ward)\b/i.test(contract.sourceText)) return 'resource';
      if (/\b(letter|spreadsheet|victim|truth|clue)\b/i.test(contract.sourceText)) return 'information';
      return 'resource';
    case 'emotional_stakes_anchor':
      if (/\b(quartz|scarf|chain|card|key|rose|circle)\b/i.test(contract.sourceText)) return 'item';
      return 'information';
    case 'stakes_escalation_step':
    case 'personal_stakes_prerequisite':
    default:
      return 'flag';
  }
}

function pressureFunction(contract: StakesArchitectureContract): MechanicPressureContract['function'] {
  switch (contract.contractKind) {
    case 'existential_stake':
      return 'payoff';
    case 'stakes_escalation_step':
      return 'intensify';
    case 'personal_stakes_prerequisite':
      return 'plant';
    case 'emotional_stakes_anchor':
      return 'plant';
    default:
      return 'intensify';
  }
}

function existingPressureCovers(scene: PlannedScene, contract: StakesArchitectureContract): boolean {
  const existing = scene.mechanicPressure ?? [];
  return existing.some((pressure) => {
    const text = [
      pressure.id,
      pressure.storyPressure,
      ...(pressure.evidenceRequired ?? []),
      ...(pressure.visibleResidue ?? []),
      ...(pressure.allowedPayoffs ?? []),
    ].join(' ');
    return treatmentFieldCloseMatch(contract.sourceText, text, 0.28);
  });
}

function makeMechanicPressure(contract: StakesArchitectureContract, scene: PlannedScene): MechanicPressureContract | undefined {
  if (!contract.requiredRealization.includes('mechanic_pressure')) return undefined;
  if (existingPressureCovers(scene, contract)) return undefined;
  return {
    id: `${contract.id}-pressure`,
    source: contract.source === 'treatment' ? 'treatment' : 'planner',
    domain: pressureDomain(contract),
    mechanicRef: { flag: contract.id },
    function: pressureFunction(contract),
    storyPressure: contract.sourceText,
    evidenceRequired: ['Stage this authored stake as a visible cost, desire, threat, relationship pressure, identity pressure, access state, resource, clue, or promise.'],
    visibleResidue: ['show changed behavior, relationship posture, access, reputation, information, resource pressure, or future permission'],
    allowedPayoffs: ['choice pressure, branch residue, encounter stakes, episode ending state, route permission, callback, or final consequence'],
    blockedPayoffs: ['metadata-only stakes, abstract summary, existential payoff before personal grounding, or payoff without planted pressure'],
    originatingSceneId: scene.id,
    requiredBeforeSpend: contract.prerequisiteContractIds.map((id) => ({ domain: 'flag', description: `Prior stakes prerequisite ${id} must be planted before this stake is fully spent.` })),
  };
}

function linkedContractIdsFor(scene: PlannedScene, contract: StakesArchitectureContract): string[] {
  const linked: string[] = [];
  for (const candidate of [
    ...(scene.worldTreatmentContracts ?? []),
    ...(scene.characterTreatmentContracts ?? []),
    ...(scene.seasonPromiseContracts ?? []),
  ]) {
    if (treatmentFieldCloseMatch(contract.sourceText, candidate.sourceText, 0.28)) linked.push(candidate.id);
  }
  for (const pressure of scene.mechanicPressure ?? []) {
    if (treatmentFieldCloseMatch(contract.sourceText, pressure.storyPressure, 0.28)) linked.push(pressure.id);
  }
  return dedupe(linked);
}

export function assignStakesArchitectureContractsToScenes(
  plan: Pick<SeasonPlan, 'stakesArchitectureContracts' | 'totalEpisodes'> & {
    treatmentSeasonGuidance?: TreatmentSeasonGuidance;
  },
  scenes: PlannedScene[],
): StakesArchitectureContract[] {
  const contracts = buildStakesArchitectureContractsForPlan(plan);
  for (const contract of contracts) {
    const targets = bestScenesForContract(contract, scenes);
    contract.targetSceneIds = dedupe([...contract.targetSceneIds, ...targets.map((scene) => scene.id)]);
    for (const scene of targets) {
      const linked = linkedContractIdsFor(scene, contract);
      contract.linkedContractIds = dedupe([...contract.linkedContractIds, ...linked]);
      const existing = scene.stakesArchitectureContracts ?? [];
      if (!existing.some((candidate) => candidate.id === contract.id)) {
        scene.stakesArchitectureContracts = [...existing, contract];
      }
      const pressure = makeMechanicPressure(contract, scene);
      if (pressure) {
        const existingPressure = scene.mechanicPressure ?? [];
        if (!existingPressure.some((candidate) => candidate.id === pressure.id)) {
          scene.mechanicPressure = [...existingPressure, pressure];
        }
      }
    }
  }
  return contracts;
}

export function stakesArchitectureMatchThreshold(contract: StakesArchitectureContract): number {
  const tokenCount = treatmentFieldTokens(contract.sourceText).length;
  if (contract.contractKind === 'emotional_stakes_anchor') return tokenCount <= 4 ? 0.4 : 0.24;
  if (contract.contractKind === 'stakes_escalation_step') return tokenCount <= 6 ? 0.35 : 0.22;
  if (tokenCount <= 2) return 0.7;
  if (tokenCount <= 5) return 0.4;
  return 0.25;
}
