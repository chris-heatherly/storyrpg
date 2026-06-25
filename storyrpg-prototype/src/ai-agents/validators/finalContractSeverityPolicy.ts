import { GATE_REGISTRY } from '../remediation/gateRegistry';
import { isGateEnabled } from '../remediation/gateDefaults';

export type FinalContractFindingClass =
  | 'runtime_contract'
  | 'authored_contract'
  | 'repairable_contract'
  | 'craft_critic'
  | 'shadow_advisory';

export type FinalContractSourceKind =
  | 'treatment'
  | 'plan'
  | 'story'
  | 'heuristic'
  | 'qa';

export interface FinalContractRepairTarget {
  episodeNumber?: number;
  sceneId?: string;
  beatId?: string;
}

export interface ResolveFinalContractSeverityInput {
  requestedSeverity: 'error' | 'warning';
  findingClass: FinalContractFindingClass;
  treatmentSourced?: boolean;
  gateId?: string;
  sourceKind?: FinalContractSourceKind;
  repairTarget?: FinalContractRepairTarget;
  hasConcreteObligation?: boolean;
}

function gateHasRepairOrException(gateId?: string): boolean {
  if (!gateId || !isGateEnabled(gateId)) return false;
  const spec = GATE_REGISTRY.find((gate) => gate.id === gateId);
  return !!spec && (!!spec.repair || !!spec.policyException);
}

function hasConcreteAuthoredObligation(input: ResolveFinalContractSeverityInput): boolean {
  if (input.hasConcreteObligation === true) return true;
  if (input.repairTarget?.sceneId || input.repairTarget?.beatId || input.repairTarget?.episodeNumber) return true;
  return input.sourceKind === 'treatment' || input.sourceKind === 'plan';
}

export function resolveFinalContractSeverity(
  input: ResolveFinalContractSeverityInput,
): 'error' | 'warning' {
  if (input.requestedSeverity !== 'error') return 'warning';

  if (input.findingClass === 'craft_critic' || input.findingClass === 'shadow_advisory') {
    return 'warning';
  }

  if (input.findingClass === 'runtime_contract') {
    return 'error';
  }

  if (input.findingClass === 'authored_contract') {
    return input.treatmentSourced && hasConcreteAuthoredObligation(input) ? 'error' : 'warning';
  }

  if (input.findingClass === 'repairable_contract') {
    return gateHasRepairOrException(input.gateId) ? 'error' : 'warning';
  }

  return 'warning';
}
