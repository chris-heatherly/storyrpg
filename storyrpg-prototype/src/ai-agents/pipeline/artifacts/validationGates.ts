import type { ArtifactKind } from './types';
import {
  artifactGateDefinitions as registryArtifactGateDefinitions,
  artifactGatesForKind as registryArtifactGatesForKind,
  blockingArtifactGatesForKind as registryBlockingArtifactGatesForKind,
} from '../../validators/validatorRegistry';
import type { ArtifactGateDefinition } from '../../validators/validatorRegistry';

export type { ArtifactGateDefinition, ArtifactGateTier } from '../../validators/validatorRegistry';

export const ARTIFACT_GATE_REGISTRY: ArtifactGateDefinition[] = registryArtifactGateDefinitions();

export function gatesForArtifact(kind: ArtifactKind): ArtifactGateDefinition[] {
  return registryArtifactGatesForKind(kind);
}

export function blockingGatesForArtifact(kind: ArtifactKind): ArtifactGateDefinition[] {
  return registryBlockingArtifactGatesForKind(kind);
}

export function validatorNamesForArtifact(kind: ArtifactKind): string[] {
  return Array.from(new Set(gatesForArtifact(kind).flatMap((gate) => gate.validators))).sort();
}
