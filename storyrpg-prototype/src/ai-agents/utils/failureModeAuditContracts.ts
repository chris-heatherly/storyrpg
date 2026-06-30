import type { SeasonPlan } from '../../types/seasonPlan';
import type { TreatmentSeasonGuidance } from '../../types/sourceAnalysis';
import type {
  FailureModeAuditCode,
  FailureModeAuditContract,
  FailureModeAuditContractKind,
  FailureModeAuditRealizationTarget,
  MechanicPressureContract,
  MechanicPressureDomain,
  PlannedScene,
} from '../../types/scenePlan';
import { inferMechanicPressureDomains } from './branchConsequenceContracts';
import {
  treatmentFieldCloseMatch,
  treatmentFieldTokens,
} from './treatmentFieldContracts';

type FailureModeAuditRow = NonNullable<TreatmentSeasonGuidance['failureModeAuditGuidance']>['rows'][number];

const KIND_TARGETS: Record<FailureModeAuditContractKind, FailureModeAuditRealizationTarget[]> = {
  avoidance_claim: ['season_plan', 'scene_turn', 'mechanic_pressure', 'final_prose'],
  watch_item: ['season_plan', 'scene_turn', 'mechanic_pressure', 'final_prose'],
  mitigation: ['season_plan', 'scene_turn', 'mechanic_pressure', 'setup_payoff', 'final_prose'],
  setup_payoff_claim: ['setup_payoff', 'information_ledger', 'mechanic_pressure', 'final_prose'],
  agency_claim: ['choice', 'scene_turn', 'ending_route', 'mechanic_pressure', 'final_prose'],
  causality_claim: ['scene_turn', 'mechanic_pressure', 'setup_payoff', 'final_prose'],
  theme_rhyme_claim: ['season_promise', 'scene_turn', 'arc_pressure', 'mechanic_pressure', 'final_prose'],
  episode_state_change_claim: ['scene_turn', 'mechanic_pressure', 'final_prose'],
  arc_state_change_claim: ['arc_pressure', 'scene_turn', 'mechanic_pressure', 'final_prose'],
  reveal_fair_play_claim: ['information_ledger', 'setup_payoff', 'scene_turn', 'mechanic_pressure', 'final_prose'],
};

const LOAD_BEARING_RE = /\b(Ep(?:isode)?\.?\s*\d+|E\d+|choice|chooses?|accept|refuse|drink|publish|confront|climax|reveal|payoff|pays?\s+off|setup|seed|plant|foreshadow|answer|question|arc|ending|finale|state|changes?|residue|blog|voice|friend|trust|relationship|apartment|sanctuary|ward|contract|confess|betray|humanity|life|death|legacy|line|twist|mitigated|because|driven by|flows from)\b/i;

function slug(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 58) || 'failure-mode';
}

function dedupe<T>(values: T[]): T[] {
  return Array.from(new Set(values));
}

function episodeMentions(text: string): number[] {
  const out: number[] = [];
  for (const match of text.matchAll(/\b(?:Episode|Ep\.?|E)\s*(\d+)/gi)) {
    const episode = Number(match[1]);
    if (Number.isFinite(episode)) out.push(episode);
  }
  return dedupe(out);
}

function defaultEpisodesFor(code: FailureModeAuditCode, totalEpisodes: number): number[] {
  const total = Math.max(1, totalEpisodes || 1);
  const midpoint = Math.max(1, Math.ceil(total / 2));
  const finale = total;
  switch (code) {
    case 'escalation_trap':
      return dedupe([1, Math.min(3, total), midpoint]);
    case 'passive_protagonist':
    case 'snowglobe_arc':
      return [finale];
    case 'reset_disease':
    case 'theme_drift':
      return Array.from({ length: total }, (_, index) => index + 1);
    case 'mystery_box_collapse':
    case 'shaggy_dog':
    case 'cheating_twist':
    case 'telegraphed_twist':
      return dedupe([1, midpoint, finale]);
    default:
      return dedupe([midpoint, finale]);
  }
}

function kindFor(row: Pick<FailureModeAuditRow, 'code' | 'status' | 'sourceText'>): FailureModeAuditContractKind {
  if (row.status === 'watch_item') return 'watch_item';
  if (/\bmitigated by\b|\bbecause\b|\bdriven by\b|\bflows from\b/i.test(row.sourceText)) return 'mitigation';
  if (row.code === 'shaggy_dog') return 'setup_payoff_claim';
  if (row.code === 'passive_protagonist') return 'agency_claim';
  if (row.code === 'reset_disease') return 'episode_state_change_claim';
  if (row.code === 'snowglobe_arc') return 'arc_state_change_claim';
  if (row.code === 'theme_drift' || row.code === 'inverted_thematic_rhyme') return 'theme_rhyme_claim';
  if (row.code === 'convenient_coincidence' || row.code === 'unmotivated_escalation') return 'causality_claim';
  if (row.code === 'cheating_twist' || row.code === 'telegraphed_twist' || /\b(reveal|foreshadow|plant|setup)\b/i.test(row.sourceText)) return 'reveal_fair_play_claim';
  return 'avoidance_claim';
}

function blockingLevelFor(row: FailureModeAuditRow, treatmentSourced?: boolean): FailureModeAuditContract['blockingLevel'] {
  if (!treatmentSourced) return 'warning';
  if (row.status === 'watch_item') return 'structural';
  return LOAD_BEARING_RE.test(row.sourceText) ? 'treatment' : 'warning';
}

function targetEpisodes(row: FailureModeAuditRow, totalEpisodes: number): number[] {
  const mentioned = dedupe([
    ...(row.episodeMentions ?? []),
    ...episodeMentions(row.sourceText),
  ]).filter((episode) => episode >= 1 && episode <= Math.max(1, totalEpisodes || 1));
  return mentioned.length > 0 ? mentioned : defaultEpisodesFor(row.code, totalEpisodes);
}

function linkContracts(sourceText: string, contractGroups: Array<Array<{ id: string; sourceText?: string }> | undefined>): string[] {
  return dedupe(contractGroups
    .flatMap((group) => group ?? [])
    .filter((contract) => contract.sourceText && treatmentFieldCloseMatch(sourceText, contract.sourceText, 0.22))
    .map((contract) => contract.id));
}

function makeContract(input: {
  row: FailureModeAuditRow;
  kind: FailureModeAuditContractKind;
  sourceText: string;
  totalEpisodes: number;
  treatmentSourced?: boolean;
  linkedContractIds: string[];
  suffix?: string;
}): FailureModeAuditContract | undefined {
  const sourceText = input.sourceText.trim();
  if (!sourceText) return undefined;
  return {
    id: `failure-mode-${input.row.code}-${input.kind}-${slug(input.suffix || sourceText)}`,
    source: input.treatmentSourced ? 'treatment' : 'analysis_fallback',
    code: input.row.code,
    label: input.row.label,
    status: input.row.status,
    sourceText,
    contractKind: input.kind,
    requiredRealization: KIND_TARGETS[input.kind],
    targetEpisodeNumbers: targetEpisodes(input.row, input.totalEpisodes),
    targetSceneIds: [],
    linkedContractIds: input.linkedContractIds,
    blockingLevel: blockingLevelFor(input.row, input.treatmentSourced),
  };
}

function subclaims(row: FailureModeAuditRow): Array<{ kind: FailureModeAuditContractKind; sourceText: string; suffix: string }> {
  const out: Array<{ kind: FailureModeAuditContractKind; sourceText: string; suffix: string }> = [];
  if (row.mitigationText?.trim()) {
    out.push({ kind: 'mitigation', sourceText: row.mitigationText, suffix: 'mitigation' });
  }
  if (/\b(setup|seed|plant|pays?\s+off|becomes|foreshadow|reveal)\b/i.test(row.sourceText)) {
    out.push({ kind: row.code === 'cheating_twist' || row.code === 'telegraphed_twist' ? 'reveal_fair_play_claim' : 'setup_payoff_claim', sourceText: row.sourceText, suffix: 'setup-payoff' });
  }
  if (/\b(chooses?|choice|confront|publish|refuse|accept|speech|claim|make[s]? the speech|instrument)\b/i.test(row.sourceText)) {
    out.push({ kind: 'agency_claim', sourceText: row.sourceText, suffix: 'agency' });
  }
  if (/\b(every episode|end-state|irreversible|residue|materially changed|none returns|no episode restores)\b/i.test(row.sourceText)) {
    out.push({ kind: row.code === 'snowglobe_arc' ? 'arc_state_change_claim' : 'episode_state_change_claim', sourceText: row.sourceText, suffix: 'state-change' });
  }
  if (/\b(theme|rhyme|A lanes?|B lanes?|pressure lanes?|same question)\b/i.test(row.sourceText)) {
    out.push({ kind: 'theme_rhyme_claim', sourceText: row.sourceText, suffix: 'theme-rhyme' });
  }
  if (/\b(coincidence|because|authored in-world|deliberate|flows from|not random|not authorial fiat)\b/i.test(row.sourceText)) {
    out.push({ kind: 'causality_claim', sourceText: row.sourceText, suffix: 'causality' });
  }
  return out;
}

export function buildFailureModeAuditContracts(input: {
  guidance?: TreatmentSeasonGuidance;
  totalEpisodes: number;
  treatmentSourced?: boolean;
  linkedContracts?: Array<Array<{ id: string; sourceText?: string }> | undefined>;
}): FailureModeAuditContract[] {
  const rows = input.guidance?.failureModeAuditGuidance?.rows ?? [];
  const out: FailureModeAuditContract[] = [];
  for (const row of rows) {
    const linkedContractIds = linkContracts(row.sourceText, input.linkedContracts ?? []);
    const base = makeContract({
      row,
      kind: kindFor(row),
      sourceText: row.sourceText,
      totalEpisodes: input.totalEpisodes,
      treatmentSourced: input.treatmentSourced,
      linkedContractIds,
    });
    if (base) out.push(base);
    for (const subclaim of subclaims(row)) {
      const contract = makeContract({
        row,
        kind: subclaim.kind,
        sourceText: subclaim.sourceText,
        totalEpisodes: input.totalEpisodes,
        treatmentSourced: input.treatmentSourced,
        linkedContractIds,
        suffix: subclaim.suffix,
      });
      if (contract && !out.some((candidate) => candidate.id === contract.id)) out.push(contract);
    }
  }
  return out;
}

function sceneText(scene: PlannedScene): string {
  return [
    scene.title,
    scene.dramaticPurpose,
    scene.stakes,
    scene.turnContract?.centralTurn,
    scene.turnContract?.turnEvent,
    scene.turnContract?.afterState,
    scene.encounter?.description,
    scene.encounter?.centralConflict,
    ...(scene.requiredBeats ?? []).map((beat) => `${beat.sourceTurn} ${beat.mustDepict}`),
    ...(scene.mechanicPressure ?? []).map((pressure) => pressure.storyPressure),
    ...(scene.stakesArchitectureContracts ?? []).map((contract) => contract.sourceText),
    ...(scene.arcPressureContracts ?? []).map((contract) => contract.sourceText),
    ...(scene.branchConsequenceContracts ?? []).map((contract) => contract.sourceText),
    ...(scene.endingRealizationContracts ?? []).map((contract) => contract.sourceText),
  ].filter(Boolean).join(' ');
}

function bestScenes(contract: FailureModeAuditContract, scenes: PlannedScene[]): PlannedScene[] {
  const targetEpisodes = new Set(contract.targetEpisodeNumbers);
  const candidates = scenes.filter((scene) => targetEpisodes.has(scene.episodeNumber));
  const pool = candidates.length > 0 ? candidates : scenes;
  const scored = pool
    .map((scene) => ({
      scene,
      score: (treatmentFieldCloseMatch(contract.sourceText, sceneText(scene), failureModeAuditMatchThreshold(contract)) ? 1 : 0)
        + (scene.hasChoice && (contract.requiredRealization.includes('choice') || contract.contractKind === 'agency_claim') ? 0.35 : 0)
        + (scene.narrativeRole === 'payoff' && (contract.requiredRealization.includes('setup_payoff') || contract.contractKind.includes('claim')) ? 0.25 : 0)
        + (scene.narrativeRole === 'release' && (contract.contractKind === 'episode_state_change_claim' || contract.contractKind === 'arc_state_change_claim') ? 0.3 : 0)
        + ((scene.mechanicPressure ?? []).length > 0 ? 0.15 : 0),
    }))
    .sort((a, b) => b.score - a.score || a.scene.episodeNumber - b.scene.episodeNumber || a.scene.order - b.scene.order);
  const lexical = scored.filter((item) => item.score >= 1).map((item) => item.scene);
  if (lexical.length > 0) return lexical.slice(0, 3);
  const choice = pool.find((scene) => scene.hasChoice);
  const payoff = [...pool].reverse().find((scene) => scene.narrativeRole === 'payoff' || scene.narrativeRole === 'release');
  if (contract.contractKind === 'agency_claim') return [choice ?? payoff ?? pool[0]].filter(Boolean) as PlannedScene[];
  return [payoff ?? choice ?? pool[pool.length - 1]].filter(Boolean) as PlannedScene[];
}

function makeMechanicPressure(contract: FailureModeAuditContract, scene: PlannedScene): MechanicPressureContract {
  const domains = inferMechanicPressureDomains(contract.sourceText);
  const domain: MechanicPressureDomain = domains[0] ?? 'flag';
  return {
    id: `${contract.id}-pressure`,
    source: contract.source === 'treatment' ? 'treatment' : 'planner',
    domain,
    mechanicRef: { flag: contract.id },
    function: contract.contractKind === 'mitigation' || contract.contractKind === 'causality_claim' ? 'plant' : 'payoff',
    storyPressure: contract.sourceText,
    evidenceRequired: ['Stage the authored failure-mode mitigation as concrete story cause/effect, not as a QA label.'],
    visibleResidue: ['show agency, setup/payoff, causal mitigation, state change, fair-play clue, or thematic rhyme on-page'],
    allowedPayoffs: ['scene turn, choice pressure, information movement, route condition, setup/payoff, or ending state'],
    blockedPayoffs: ['metadata-only avoidance claim, explanatory sentence, outside rescue, unplanted reveal, or reset to opening state'],
    originatingSceneId: scene.id,
  };
}

export function assignFailureModeAuditContractsToScenes(
  plan: Pick<SeasonPlan, 'failureModeAuditContracts' | 'totalEpisodes'> & {
    treatmentSeasonGuidance?: TreatmentSeasonGuidance;
  },
  scenes: PlannedScene[],
): FailureModeAuditContract[] {
  const contracts = (plan.failureModeAuditContracts ?? []).length > 0
    ? plan.failureModeAuditContracts ?? []
    : buildFailureModeAuditContracts({
      guidance: plan.treatmentSeasonGuidance,
      totalEpisodes: plan.totalEpisodes,
      treatmentSourced: Boolean(plan.treatmentSeasonGuidance?.failureModeAuditGuidance),
    });
  for (const contract of contracts) {
    const targets = bestScenes(contract, scenes);
    contract.targetSceneIds = dedupe([...contract.targetSceneIds, ...targets.map((scene) => scene.id)]);
    for (const scene of targets) {
      if (!(scene.failureModeAuditContracts ?? []).some((candidate) => candidate.id === contract.id)) {
        scene.failureModeAuditContracts = [...(scene.failureModeAuditContracts ?? []), contract];
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

export function failureModeAuditMatchThreshold(contract: FailureModeAuditContract): number {
  const tokenCount = treatmentFieldTokens(contract.sourceText).length;
  if (contract.contractKind === 'watch_item' || contract.contractKind === 'mitigation') return tokenCount <= 8 ? 0.32 : 0.22;
  if (tokenCount <= 4) return 0.45;
  if (tokenCount <= 10) return 0.32;
  return 0.22;
}
