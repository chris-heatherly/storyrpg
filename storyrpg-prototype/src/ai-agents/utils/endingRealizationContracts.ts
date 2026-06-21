import type { SeasonPlan } from '../../types/seasonPlan';
import type { StoryEndingTarget } from '../../types/sourceAnalysis';
import type {
  BranchConsequenceRealizationContract,
  EndingRealizationContract,
  EndingRealizationContractKind,
  EndingRealizationTarget,
  MechanicPressureContract,
  MechanicPressureDomain,
  PlannedScene,
} from '../../types/scenePlan';
import { inferMechanicPressureDomains } from './branchConsequenceContracts';
import {
  treatmentFieldCloseMatch,
  treatmentFieldTokens,
} from './treatmentFieldContracts';

const KIND_TARGETS: Record<EndingRealizationContractKind, EndingRealizationTarget[]> = {
  ending_identity: ['resolved_ending', 'ending_route'],
  ending_summary: ['resolved_ending', 'final_prose'],
  ending_emotional_register: ['resolved_ending', 'final_prose'],
  ending_theme_payoff: ['resolved_ending', 'mechanic_pressure', 'final_prose'],
  ending_state_driver: ['resolved_ending', 'season_flag', 'choice_moment', 'mechanic_pressure', 'ending_route', 'final_prose'],
  ending_target_condition: ['resolved_ending', 'season_flag', 'condition', 'choice_moment', 'mechanic_pressure', 'ending_route'],
  ending_choice_pattern: ['choice_moment', 'mechanic_pressure', 'ending_route', 'final_prose'],
  ending_final_line: ['final_prose'],
};

function slug(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 58) || 'ending';
}

function dedupe<T>(values: T[]): T[] {
  return Array.from(new Set(values));
}

function contract(input: {
  ending: StoryEndingTarget;
  kind: EndingRealizationContractKind;
  fieldName: string;
  sourceText: string | undefined;
  totalEpisodes: number;
  treatmentSourced?: boolean;
  branchContracts?: BranchConsequenceRealizationContract[];
}): EndingRealizationContract | undefined {
  const sourceText = input.sourceText?.trim();
  if (!sourceText) return undefined;
  const stateDomains = inferMechanicPressureDomains(sourceText);
  const linked = (input.branchContracts ?? [])
    .filter((branch) =>
      treatmentFieldCloseMatch(sourceText, branch.sourceText, 0.22)
      || branch.stateDomains.some((domain) => stateDomains.includes(domain))
    )
    .map((branch) => branch.id);
  return {
    id: `ending-realization-${slug(input.ending.id)}-${input.kind}-${slug(sourceText)}`,
    source: input.treatmentSourced ? 'treatment' : 'analysis_fallback',
    endingId: input.ending.id,
    endingName: input.ending.name,
    fieldName: input.fieldName,
    sourceText,
    contractKind: input.kind,
    requiredRealization: KIND_TARGETS[input.kind],
    targetEpisodeNumbers: [Math.max(1, input.totalEpisodes || 1)],
    targetSceneIds: [],
    targetEndingIds: [input.ending.id],
    stateDomains,
    linkedContractIds: dedupe(linked),
    blockingLevel: input.treatmentSourced ? (input.kind === 'ending_emotional_register' ? 'structural' : 'treatment') : 'warning',
  };
}

export function buildEndingRealizationContracts(input: {
  endings?: StoryEndingTarget[];
  totalEpisodes: number;
  treatmentSourced?: boolean;
  branchContracts?: BranchConsequenceRealizationContract[];
}): EndingRealizationContract[] {
  const out: EndingRealizationContract[] = [];
  for (const ending of input.endings ?? []) {
    const maybe = [
      contract({ ending, kind: 'ending_identity', fieldName: 'Name', sourceText: ending.name, totalEpisodes: input.totalEpisodes, treatmentSourced: input.treatmentSourced, branchContracts: input.branchContracts }),
      contract({ ending, kind: 'ending_summary', fieldName: 'Summary', sourceText: ending.summary, totalEpisodes: input.totalEpisodes, treatmentSourced: input.treatmentSourced, branchContracts: input.branchContracts }),
      contract({ ending, kind: 'ending_emotional_register', fieldName: 'Emotional register', sourceText: ending.emotionalRegister, totalEpisodes: input.totalEpisodes, treatmentSourced: input.treatmentSourced, branchContracts: input.branchContracts }),
      contract({ ending, kind: 'ending_theme_payoff', fieldName: 'Theme payoff', sourceText: ending.themePayoff, totalEpisodes: input.totalEpisodes, treatmentSourced: input.treatmentSourced, branchContracts: input.branchContracts }),
      ...(ending.stateDrivers ?? []).map((driver, index) => contract({ ending, kind: 'ending_state_driver', fieldName: `State driver ${index + 1}`, sourceText: `${driver.type}: ${driver.label} ${driver.details ?? ''}`, totalEpisodes: input.totalEpisodes, treatmentSourced: input.treatmentSourced, branchContracts: input.branchContracts })),
      ...(ending.targetConditions ?? []).map((condition, index) => contract({ ending, kind: 'ending_target_condition', fieldName: `Target condition ${index + 1}`, sourceText: condition, totalEpisodes: input.totalEpisodes, treatmentSourced: input.treatmentSourced, branchContracts: input.branchContracts })),
      contract({ ending, kind: 'ending_choice_pattern', fieldName: 'What repeated choice pattern this ending pays off', sourceText: ending.repeatedChoicePattern, totalEpisodes: input.totalEpisodes, treatmentSourced: input.treatmentSourced, branchContracts: input.branchContracts }),
      contract({ ending, kind: 'ending_final_line', fieldName: 'Final voiceover line', sourceText: ending.finalVoiceoverLine, totalEpisodes: input.totalEpisodes, treatmentSourced: input.treatmentSourced, branchContracts: input.branchContracts }),
    ];
    out.push(...maybe.filter(Boolean) as EndingRealizationContract[]);
  }
  return out;
}

function sceneText(scene: PlannedScene): string {
  return [
    scene.title,
    scene.dramaticPurpose,
    scene.stakes,
    scene.turnContract?.centralTurn,
    scene.turnContract?.afterState,
    scene.encounter?.description,
    ...(scene.requiredBeats ?? []).map((beat) => `${beat.sourceTurn} ${beat.mustDepict}`),
    ...(scene.mechanicPressure ?? []).map((pressure) => pressure.storyPressure),
    ...(scene.branchConsequenceContracts ?? []).map((contract) => contract.sourceText),
  ].filter(Boolean).join(' ');
}

function bestScenes(contract: EndingRealizationContract, scenes: PlannedScene[]): PlannedScene[] {
  const finalEpisode = Math.max(...contract.targetEpisodeNumbers);
  const pool = scenes.filter((scene) => scene.episodeNumber === finalEpisode);
  const candidates = pool.length > 0 ? pool : scenes;
  const scored = candidates
    .map((scene) => ({
      scene,
      score: (treatmentFieldCloseMatch(contract.sourceText, sceneText(scene), endingRealizationMatchThreshold(contract)) ? 1 : 0)
        + (scene.narrativeRole === 'release' ? 0.35 : 0)
        + (scene.hasChoice && (contract.requiredRealization.includes('finale_choice') || contract.requiredRealization.includes('condition')) ? 0.35 : 0)
        + ((scene.branchConsequenceContracts ?? []).some((branch) => contract.linkedContractIds.includes(branch.id)) ? 0.4 : 0),
    }))
    .sort((a, b) => b.score - a.score || b.scene.order - a.scene.order);
  const lexical = scored.filter((item) => item.score >= 1).map((item) => item.scene);
  if (lexical.length > 0) return lexical.slice(0, 2);
  const release = [...candidates].reverse().find((scene) => scene.narrativeRole === 'release');
  const choice = [...candidates].reverse().find((scene) => scene.hasChoice);
  return [choice ?? release ?? candidates[candidates.length - 1]].filter(Boolean) as PlannedScene[];
}

function makePressure(contract: EndingRealizationContract, scene: PlannedScene): MechanicPressureContract | undefined {
  if (!contract.requiredRealization.includes('mechanic_pressure')) return undefined;
  const domain: MechanicPressureDomain = contract.stateDomains[0] ?? 'route';
  return {
    id: `${contract.id}-pressure`,
    source: contract.source === 'treatment' ? 'treatment' : 'planner',
    domain,
    mechanicRef: { flag: contract.id, routeId: contract.endingId },
    function: contract.contractKind === 'ending_target_condition' ? 'gate' : 'payoff',
    storyPressure: contract.sourceText,
    evidenceRequired: ['Tie this ending driver to prior choices, branch residue, target conditions, or finale agency.'],
    visibleResidue: ['show the changed end state, route consequence, emotional register, or theme payoff on-page'],
    allowedPayoffs: ['finale choice, ending route condition, ending prose, route-specific final state, or callback'],
    blockedPayoffs: ['unearned transformation, outside rescue, ending prose unsupported by route mechanics, or generic ending swap'],
    originatingSceneId: scene.id,
  };
}

export function assignEndingRealizationContractsToScenes(
  plan: Pick<SeasonPlan, 'endingRealizationContracts' | 'resolvedEndings' | 'totalEpisodes' | 'branchConsequenceContracts'>,
  scenes: PlannedScene[],
): EndingRealizationContract[] {
  const contracts = (plan.endingRealizationContracts ?? []).length > 0
    ? plan.endingRealizationContracts ?? []
    : buildEndingRealizationContracts({
      endings: plan.resolvedEndings,
      totalEpisodes: plan.totalEpisodes,
      treatmentSourced: plan.resolvedEndings?.some((ending) => ending.sourceConfidence === 'explicit'),
      branchContracts: plan.branchConsequenceContracts,
    });
  for (const contract of contracts) {
    const targets = bestScenes(contract, scenes);
    contract.targetSceneIds = dedupe([...contract.targetSceneIds, ...targets.map((scene) => scene.id)]);
    for (const scene of targets) {
      if (!(scene.endingRealizationContracts ?? []).some((candidate) => candidate.id === contract.id)) {
        scene.endingRealizationContracts = [...(scene.endingRealizationContracts ?? []), contract];
      }
      const pressure = makePressure(contract, scene);
      if (pressure && !(scene.mechanicPressure ?? []).some((candidate) => candidate.id === pressure.id)) {
        scene.mechanicPressure = [...(scene.mechanicPressure ?? []), pressure];
      }
    }
  }
  return contracts;
}

export function endingRealizationMatchThreshold(contract: EndingRealizationContract): number {
  const tokenCount = treatmentFieldTokens(contract.sourceText).length;
  if (contract.contractKind === 'ending_identity') return 0.45;
  if (contract.contractKind === 'ending_emotional_register') return tokenCount <= 3 ? 0.45 : 0.25;
  if (tokenCount <= 3) return 0.5;
  if (tokenCount <= 8) return 0.34;
  return 0.24;
}
