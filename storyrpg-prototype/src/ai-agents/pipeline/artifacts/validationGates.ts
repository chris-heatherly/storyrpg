import type { ArtifactKind } from './types';

export type ArtifactGateTier = 'blocking' | 'advisory';

export interface ArtifactGateDefinition {
  id: string;
  artifactKind: ArtifactKind;
  tier: ArtifactGateTier;
  validators: string[];
  contract: string;
}

export const ARTIFACT_GATE_REGISTRY: ArtifactGateDefinition[] = [
  {
    id: 'source-analysis-source-contract',
    artifactKind: 'source-analysis',
    tier: 'blocking',
    validators: [
      'AuthoredEpisodeConformanceValidator',
      'SevenPointAnchorConformanceValidator',
      'TreatmentFidelityValidator',
      'quoteRecallValidator',
      'SignatureDevicePresenceValidator',
    ],
    contract: 'Preserve source identity, authored episode order, required beats, quote anchors, signature devices, and seven-point anchors.',
  },
  {
    id: 'season-plan-structure-contract',
    artifactKind: 'season-plan',
    tier: 'blocking',
    validators: [
      'SevenPointCoverageValidator',
      'SeasonPromiseValidator',
      'SeasonBudgetValidator',
      'ArcPressureArchitectureValidator',
      'InformationLedgerScheduleValidator',
      'ConsequenceBudgetValidator',
    ],
    contract: 'Preserve season spine, promise architecture, arc pressure, episode dependencies, information schedule, and consequence budget.',
  },
  {
    id: 'character-bible-npc-contract',
    artifactKind: 'character-bible',
    tier: 'blocking',
    validators: [
      'CharacterArchitectureValidator',
      'NPCDepthValidator',
      'CharacterIntroductionValidator',
    ],
    contract: 'Preserve valid NPC identities, character architecture, role/voice consistency, introductions, and relationship trajectory readiness.',
  },
  {
    id: 'character-arc-contract',
    artifactKind: 'character-arc-plan',
    tier: 'blocking',
    validators: [
      'ArcDeltaValidator',
      'CharacterArcTracker',
    ],
    contract: 'Preserve protagonist identity deltas, NPC relationship trajectories, milestone targets, and per-episode required movement.',
  },
  {
    id: 'npc-payoff-contract',
    artifactKind: 'npc-payoff-ledger',
    tier: 'blocking',
    validators: [
      'NPCDepthValidator',
      'ReferencedEventPresenceValidator',
      'SetupPayoffValidator',
    ],
    contract: 'Track NPC-specific promises, relationship consequences, debts, secrets, tells, reversals, reconciliations, and payoffs.',
  },
  {
    id: 'thread-callback-contract',
    artifactKind: 'thread-ledger',
    tier: 'blocking',
    validators: [
      'SetupPayoffValidator',
      'CallbackCoverageValidator',
      'CallbackOpportunitiesValidator',
    ],
    contract: 'Preserve setup/payoff coupling, callback due episodes, plants, payoffs, abandoned hooks, and overdue hooks.',
  },
  {
    id: 'information-ledger-contract',
    artifactKind: 'information-ledger',
    tier: 'blocking',
    validators: [
      'InformationLedgerValidator',
      'InformationLedgerScheduleValidator',
    ],
    contract: 'Preserve clues, mysteries, withheld knowledge, reveal/payoff schedule, audience knowledge state, and related flags.',
  },
  {
    id: 'episode-blueprint-contract',
    artifactKind: 'episode-blueprint',
    tier: 'blocking',
    validators: [
      'DramaticStructureValidator',
      'EpisodePressureArchitectureValidator',
      'RequiredBeatRealizationValidator',
      'EncounterAnchorContentValidator',
      'TreatmentFidelityValidator',
    ],
    contract: 'Preserve structural role, central conflict, arc movement, NPC payoffs, due callbacks, reveals, encounter purpose, and treatment beats.',
  },
  {
    id: 'scene-plan-contract',
    artifactKind: 'scene-plan',
    tier: 'blocking',
    validators: [
      'SceneGraphBranchValidator',
      'SceneTurnContractValidator',
      'SceneSpineValidator',
      'SceneTransitionContinuityValidator',
      'ArcPressureArchitectureValidator',
      'TreatmentSeedOnPageValidator',
    ],
    contract: 'Preserve scene-first graph reachability, bottlenecks, reconvergence, turn contracts, pressure architecture, and setup/payoff placement.',
  },
  {
    id: 'branch-plan-contract',
    artifactKind: 'branch-plan',
    tier: 'blocking',
    validators: [
      'DivergenceValidator',
      'BranchMechanicalDivergenceValidator',
      'SceneGraphBranchValidator',
      'ConvergenceLedgerValidator',
      'EndingReachabilityValidator',
    ],
    contract: 'Preserve branch-and-bottleneck topology, no expression branching, reconvergence, branch residue, and cross-episode branch axes.',
  },
  {
    id: 'choice-consequence-contract',
    artifactKind: 'choice-consequence-plan',
    tier: 'blocking',
    validators: [
      'ChoiceDensityValidator',
      'ChoiceDistributionValidator',
      'ChoiceImpactValidator',
      'ChoiceTypePlanConformanceValidator',
      'ConsequenceBudgetValidator',
      'FlagContractValidator',
      'SkillSurfaceValidator',
      'StatCheckBalanceValidator',
      'MechanicsLeakageValidator',
    ],
    contract: 'Preserve choice density/distribution, five-factor impact, stakes triangle, consequence tiering, flag contracts, skill surfaces, and fiction-first mechanics.',
  },
  {
    id: 'encounter-plan-contract',
    artifactKind: 'encounter-plan',
    tier: 'blocking',
    validators: [
      'EncounterAnchorContentValidator',
      'EncounterQualityValidator',
      'EncounterSetPieceDepthValidator',
      'BranchMechanicalDivergenceValidator',
      'OutcomeTextQualityValidator',
    ],
    contract: 'Preserve encounter conflict manifestation, depth, clocks, NPC states, escalation, partial-victory cost, storylets, and playable failure.',
  },
  {
    id: 'runtime-episode-contract',
    artifactKind: 'runtime-episode',
    tier: 'blocking',
    validators: [
      'StructuralValidator',
      'FinalStoryContractValidator',
      'MechanicsLeakageValidator',
      'SceneGraphBranchValidator',
      'ArcDeltaValidator',
      'SetupPayoffValidator',
      'TreatmentFidelityValidator',
      'storyPathAnalyzer',
    ],
    contract: 'Preserve playable runtime Episode shape, valid targets, terminal routing, no unresolved templates, no mechanics leakage, arc movement, and path traversal.',
  },
  {
    id: 'story-package-contract',
    artifactKind: 'story-package',
    tier: 'blocking',
    validators: [
      'decodeStory',
      'storyAssetWalker',
      'FinalStoryContractValidator',
      'validate-assets',
      'check-reader-boundary',
    ],
    contract: 'Preserve package decode, asset resolution, manifest integrity, reader safety, and playable exported content.',
  },
];

export function gatesForArtifact(kind: ArtifactKind): ArtifactGateDefinition[] {
  return ARTIFACT_GATE_REGISTRY.filter((gate) => gate.artifactKind === kind);
}

export function blockingGatesForArtifact(kind: ArtifactKind): ArtifactGateDefinition[] {
  return gatesForArtifact(kind).filter((gate) => gate.tier === 'blocking');
}

export function validatorNamesForArtifact(kind: ArtifactKind): string[] {
  return Array.from(new Set(gatesForArtifact(kind).flatMap((gate) => gate.validators))).sort();
}
