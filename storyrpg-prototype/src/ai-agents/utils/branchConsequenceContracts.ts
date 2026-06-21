import type { SeasonPlan } from '../../types/seasonPlan';
import type {
  BranchConsequenceContractKind,
  BranchConsequenceRealizationContract,
  BranchConsequenceRealizationTarget,
  MechanicPressureContract,
  MechanicPressureDomain,
  PlannedScene,
} from '../../types/scenePlan';
import type { StoryEndingTarget, TreatmentBranchGuidance } from '../../types/sourceAnalysis';
import {
  treatmentFieldCloseMatch,
  treatmentFieldTokens,
} from './treatmentFieldContracts';

const KIND_TARGETS: Record<BranchConsequenceContractKind, BranchConsequenceRealizationTarget[]> = {
  branch_origin_choice: ['choice', 'season_flag', 'mechanic_pressure', 'final_prose'],
  branch_path_state: ['season_flag', 'mechanic_pressure', 'text_variant', 'final_prose'],
  branch_later_payoff: ['consequence_chain', 'mechanic_pressure', 'scene_turn', 'final_prose'],
  branch_reconvergence_residue: ['consequence_chain', 'text_variant', 'mechanic_pressure', 'final_prose'],
  branch_state_change: ['season_flag', 'mechanic_pressure', 'final_prose'],
  branch_ending_eligibility: ['season_flag', 'ending_target', 'mechanic_pressure', 'final_prose'],
};

function slug(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 58) || 'branch';
}

function dedupe<T>(values: T[]): T[] {
  return Array.from(new Set(values));
}

export function inferMechanicPressureDomains(text: string | undefined): MechanicPressureDomain[] {
  const value = text ?? '';
  const domains: MechanicPressureDomain[] = [];
  const add = (domain: MechanicPressureDomain) => {
    if (!domains.includes(domain)) domains.push(domain);
  };
  if (/\b(friend|trust|loyal|forgiv|betray|love|relationship|mika|stela|radu|victor)\b/i.test(value)) add('relationship');
  if (/\b(voice|self|identity|name|author|consort|owned|humanity|mortal|monster|truth|lie)\b/i.test(value)) add('identity');
  if (/\b(access|threshold|apartment|sanctuary|ward|route|door|key|club|enter|cross)\b/i.test(value)) add('resource');
  if (/\b(quartz|card|letter|scarf|rose|wine|item|gift|object|inventory)\b/i.test(value)) add('item');
  if (/\b(secret|know|learn|reveal|confess|warning|clue|information|blog|post|readership|letter)\b/i.test(value)) add('information');
  if (/\b(reputation|public|blog|readers?|brand|column|byline|fame)\b/i.test(value)) add('reputation');
  if (/\b(route|ending|eligibility|consort|witness|wife|path)\b/i.test(value)) add('route');
  if (/\b(flag|state)\b/i.test(value)) add('flag');
  return domains.length > 0 ? domains : ['flag'];
}

function targetEndingIds(text: string, endings: StoryEndingTarget[]): string[] {
  return endings
    .filter((ending) => {
      const haystack = [
        ending.id,
        ending.name,
        ending.summary,
        ending.themePayoff,
        ending.targetConditions.join(' '),
        ending.stateDrivers.map((driver) => `${driver.label} ${driver.details ?? ''}`).join(' '),
      ].join(' ');
      return treatmentFieldCloseMatch(text, haystack, 0.22)
        || treatmentFieldCloseMatch(ending.name, text, 0.35);
    })
    .map((ending) => ending.id);
}

function contract(input: {
  branch: TreatmentBranchGuidance;
  kind: BranchConsequenceContractKind;
  fieldName: string;
  sourceText: string | undefined;
  targetEpisodeNumbers: number[];
  endings: StoryEndingTarget[];
  treatmentSourced?: boolean;
}): BranchConsequenceRealizationContract | undefined {
  const sourceText = input.sourceText?.trim();
  if (!sourceText) return undefined;
  const stateDomains = inferMechanicPressureDomains(sourceText);
  const endingIds = input.kind === 'branch_ending_eligibility'
    ? targetEndingIds(sourceText, input.endings)
    : [];
  return {
    id: `branch-consequence-${slug(input.branch.id)}-${input.kind}-${slug(sourceText)}`,
    source: input.treatmentSourced ? 'treatment' : 'analysis_fallback',
    branchId: input.branch.id,
    branchName: input.branch.name,
    fieldName: input.fieldName,
    sourceText,
    contractKind: input.kind,
    requiredRealization: KIND_TARGETS[input.kind],
    targetEpisodeNumbers: dedupe(input.targetEpisodeNumbers.filter(Number.isFinite)).sort((a, b) => a - b),
    targetSceneIds: [],
    targetEndingIds: endingIds,
    stateDomains,
    linkedContractIds: [],
    blockingLevel: input.treatmentSourced ? 'treatment' : 'warning',
  };
}

export function buildBranchConsequenceContracts(input: {
  branches?: TreatmentBranchGuidance[];
  endings?: StoryEndingTarget[];
  totalEpisodes: number;
  treatmentSourced?: boolean;
}): BranchConsequenceRealizationContract[] {
  const out: BranchConsequenceRealizationContract[] = [];
  const endings = input.endings ?? [];
  const total = Math.max(1, input.totalEpisodes || 1);
  for (const branch of input.branches ?? []) {
    const origin = Math.max(1, branch.originEpisode ?? 1);
    const reconvergence = branch.reconvergenceEpisode ?? Math.min(total, origin + 2);
    const laterEpisodes = dedupe([
      ...((branch.laterEpisodeChange ? branch.laterEpisodeChange.match(/\b(?:Episode|Ep\.?|E)\s*(\d+)/gi) ?? [] : [])
        .map((value) => Number(value.match(/\d+/)?.[0]))
        .filter(Number.isFinite)),
      reconvergence,
    ]).filter((episode) => episode >= 1 && episode <= total);

    const maybe = [
      contract({ branch, kind: 'branch_origin_choice', fieldName: 'What creates it', sourceText: branch.createdBy || branch.summary, targetEpisodeNumbers: [origin], endings, treatmentSourced: input.treatmentSourced }),
      contract({ branch, kind: 'branch_later_payoff', fieldName: 'How it changes a later episode', sourceText: branch.laterEpisodeChange, targetEpisodeNumbers: laterEpisodes.length ? laterEpisodes : [reconvergence], endings, treatmentSourced: input.treatmentSourced }),
      contract({ branch, kind: 'branch_reconvergence_residue', fieldName: 'What residue remains after reconvergence', sourceText: branch.reconvergenceResidue, targetEpisodeNumbers: [reconvergence], endings, treatmentSourced: input.treatmentSourced }),
      ...(branch.stateChanges ?? []).map((state, index) => contract({ branch, kind: /\bending|eligibility|consort|witness|wife\b/i.test(state) ? 'branch_ending_eligibility' : 'branch_state_change', fieldName: `What state it changes ${index + 1}`, sourceText: state, targetEpisodeNumbers: [origin, reconvergence], endings, treatmentSourced: input.treatmentSourced })),
      ...(branch.pathVariants ?? []).map((variant) => contract({ branch, kind: 'branch_path_state', fieldName: `Path ${variant.label}`, sourceText: [variant.conditionText, variant.resultText, ...(variant.stateChanges ?? [])].filter(Boolean).join(' '), targetEpisodeNumbers: [origin, reconvergence], endings, treatmentSourced: input.treatmentSourced })),
    ];
    out.push(...maybe.filter(Boolean) as BranchConsequenceRealizationContract[]);
  }
  return out;
}

function sceneText(scene: PlannedScene): string {
  return [
    scene.title,
    scene.dramaticPurpose,
    scene.stakes,
    scene.turnContract?.centralTurn,
    scene.encounter?.description,
    scene.encounter?.centralConflict,
    ...(scene.requiredBeats ?? []).map((beat) => `${beat.sourceTurn} ${beat.mustDepict}`),
    ...(scene.mechanicPressure ?? []).map((pressure) => pressure.storyPressure),
  ].filter(Boolean).join(' ');
}

function bestScenes(contract: BranchConsequenceRealizationContract, scenes: PlannedScene[]): PlannedScene[] {
  const targetEpisodes = new Set(contract.targetEpisodeNumbers);
  const candidates = scenes.filter((scene) => targetEpisodes.has(scene.episodeNumber));
  const pool = candidates.length > 0 ? candidates : scenes;
  const scored = pool
    .map((scene) => ({
      scene,
      score: (treatmentFieldCloseMatch(contract.sourceText, sceneText(scene), branchConsequenceMatchThreshold(contract)) ? 1 : 0)
        + (scene.hasChoice && contract.requiredRealization.includes('choice') ? 0.35 : 0)
        + (scene.narrativeRole === 'payoff' && contract.contractKind.includes('payoff') ? 0.3 : 0)
        + (scene.narrativeRole === 'release' && contract.contractKind.includes('reconvergence') ? 0.35 : 0)
        + ((scene.mechanicPressure ?? []).length > 0 ? 0.2 : 0),
    }))
    .sort((a, b) => b.score - a.score || a.scene.episodeNumber - b.scene.episodeNumber || a.scene.order - b.scene.order);
  const lexical = scored.filter((item) => item.score >= 1).map((item) => item.scene);
  if (lexical.length > 0) return lexical.slice(0, 3);
  const choice = pool.find((scene) => scene.hasChoice);
  const payoff = [...pool].reverse().find((scene) => scene.narrativeRole === 'payoff' || scene.narrativeRole === 'release');
  if (contract.contractKind === 'branch_origin_choice') return [choice ?? pool[0]].filter(Boolean) as PlannedScene[];
  return [payoff ?? choice ?? pool[pool.length - 1]].filter(Boolean) as PlannedScene[];
}

function makeMechanicPressure(contract: BranchConsequenceRealizationContract, scene: PlannedScene): MechanicPressureContract {
  const domain = contract.stateDomains[0] ?? 'flag';
  return {
    id: `${contract.id}-pressure`,
    source: contract.source === 'treatment' ? 'treatment' : 'planner',
    domain,
    mechanicRef: { flag: contract.id, routeId: contract.branchId },
    function: contract.contractKind === 'branch_origin_choice' ? 'plant'
      : contract.contractKind === 'branch_path_state' || contract.contractKind === 'branch_state_change' ? 'intensify'
        : 'payoff',
    storyPressure: contract.sourceText,
    evidenceRequired: ['Stage the authored branch state as an on-page choice/event, not a generic route label.'],
    visibleResidue: ['show changed access, resource, relationship, information, route, reputation, identity, or ending eligibility'],
    allowedPayoffs: ['conditional prose, text variant, branch route, choice wording, consequence chain, ending condition, or finale route state'],
    blockedPayoffs: ['cosmetic reconvergence, all paths targeting all endings, metadata-only branch state, or payoff without origin pressure'],
    originatingSceneId: scene.id,
  };
}

export function assignBranchConsequenceContractsToScenes(
  plan: Pick<SeasonPlan, 'branchConsequenceContracts' | 'resolvedEndings' | 'totalEpisodes'> & {
    treatmentBranches?: TreatmentBranchGuidance[];
  },
  scenes: PlannedScene[],
): BranchConsequenceRealizationContract[] {
  const contracts = (plan.branchConsequenceContracts ?? []).length > 0
    ? plan.branchConsequenceContracts ?? []
    : buildBranchConsequenceContracts({
      branches: plan.treatmentBranches,
      endings: plan.resolvedEndings,
      totalEpisodes: plan.totalEpisodes,
      treatmentSourced: Boolean(plan.treatmentBranches?.length),
    });
  for (const contract of contracts) {
    const targets = bestScenes(contract, scenes);
    contract.targetSceneIds = dedupe([...contract.targetSceneIds, ...targets.map((scene) => scene.id)]);
    for (const scene of targets) {
      if (!(scene.branchConsequenceContracts ?? []).some((candidate) => candidate.id === contract.id)) {
        scene.branchConsequenceContracts = [...(scene.branchConsequenceContracts ?? []), contract];
      }
      if (contract.requiredRealization.includes('mechanic_pressure')) {
        const pressure = makeMechanicPressure(contract, scene);
        if (!(scene.mechanicPressure ?? []).some((candidate) => candidate.id === pressure.id)) {
          scene.mechanicPressure = [...(scene.mechanicPressure ?? []), pressure];
        }
      }
    }
  }
  return contracts;
}

export function branchConsequenceMatchThreshold(contract: BranchConsequenceRealizationContract): number {
  const tokenCount = treatmentFieldTokens(contract.sourceText).length;
  if (contract.contractKind === 'branch_state_change' || contract.contractKind === 'branch_ending_eligibility') return tokenCount <= 4 ? 0.45 : 0.24;
  if (tokenCount <= 3) return 0.5;
  if (tokenCount <= 8) return 0.34;
  return 0.24;
}
