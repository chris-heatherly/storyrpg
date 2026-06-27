import { describe, expect, it } from 'vitest';
import { ARTIFACT_GATE_REGISTRY, blockingGatesForArtifact, gatesForArtifact, validatorNamesForArtifact } from './validationGates';
import { artifactGateDefinitions as registryArtifactGateDefinitions } from '../../validators/validatorRegistry';

describe('artifact validation gate registry', () => {
  it('is a compatibility facade over validator registry artifact definitions', () => {
    expect(ARTIFACT_GATE_REGISTRY).toEqual(registryArtifactGateDefinitions());
  });

  it('derives validator lists from ownership metadata without changing contract coverage', () => {
    expect(Object.fromEntries(ARTIFACT_GATE_REGISTRY.map((gate) => [gate.artifactKind, gate.validators]))).toEqual({
      'source-analysis': [
        'AuthoredEpisodeConformanceValidator',
        'StoryCircleAnchorConformanceValidator',
        'TreatmentFidelityValidator',
        'quoteRecallValidator',
        'SignatureDevicePresenceValidator',
      ],
      'season-plan': [
        'StoryCircleCoverageValidator',
        'SeasonPromiseValidator',
        'SeasonBudgetValidator',
        'ArcPressureArchitectureValidator',
        'InformationLedgerScheduleValidator',
        'ConsequenceBudgetValidator',
      ],
      'character-bible': [
        'CharacterArchitectureValidator',
        'NPCDepthValidator',
        'CharacterIntroductionValidator',
      ],
      'character-arc-plan': [
        'ArcDeltaValidator',
        'CharacterArcTracker',
      ],
      'npc-payoff-ledger': [
        'NPCDepthValidator',
        'ReferencedEventPresenceValidator',
        'SetupPayoffValidator',
      ],
      'thread-ledger': [
        'SetupPayoffValidator',
        'CallbackCoverageValidator',
        'CallbackOpportunitiesValidator',
      ],
      'information-ledger': [
        'InformationLedgerValidator',
        'InformationLedgerScheduleValidator',
      ],
      'episode-blueprint': [
        'DramaticStructureValidator',
        'EpisodePressureArchitectureValidator',
        'RequiredBeatRealizationValidator',
        'EncounterAnchorContentValidator',
        'TreatmentFidelityValidator',
      ],
      'scene-plan': [
        'SceneGraphBranchValidator',
        'SceneTurnContractValidator',
        'SceneSpineValidator',
        'SceneTransitionContinuityValidator',
        'ArcPressureArchitectureValidator',
        'TreatmentSeedOnPageValidator',
      ],
      'branch-plan': [
        'DivergenceValidator',
        'BranchMechanicalDivergenceValidator',
        'SceneGraphBranchValidator',
        'ConvergenceLedgerValidator',
        'EndingReachabilityValidator',
      ],
      'choice-consequence-plan': [
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
      'encounter-plan': [
        'EncounterAnchorContentValidator',
        'EncounterQualityValidator',
        'EncounterSetPieceDepthValidator',
        'BranchMechanicalDivergenceValidator',
        'OutcomeTextQualityValidator',
      ],
      'runtime-episode': [
        'StructuralValidator',
        'FinalStoryContractValidator',
        'MechanicsLeakageValidator',
        'SceneGraphBranchValidator',
        'ArcDeltaValidator',
        'SetupPayoffValidator',
        'TreatmentFidelityValidator',
        'storyPathAnalyzer',
      ],
      'story-package': [
        'decodeStory',
        'storyAssetWalker',
        'FinalStoryContractValidator',
        'validate-assets',
        'check-reader-boundary',
      ],
    });
  });

  it('maps runtime episodes to playback, branching, arc, payoff, and treatment gates', () => {
    const validators = validatorNamesForArtifact('runtime-episode');

    expect(validators).toEqual(expect.arrayContaining([
      'StructuralValidator',
      'SceneGraphBranchValidator',
      'ArcDeltaValidator',
      'SetupPayoffValidator',
      'TreatmentFidelityValidator',
      'MechanicsLeakageValidator',
    ]));
    expect(blockingGatesForArtifact('runtime-episode')).toHaveLength(1);
  });

  it('keeps NPC payoff, information, and character arc contracts first-class', () => {
    expect(gatesForArtifact('npc-payoff-ledger')[0]?.validators).toEqual(expect.arrayContaining(['SetupPayoffValidator']));
    expect(gatesForArtifact('information-ledger')[0]?.validators).toEqual(expect.arrayContaining(['InformationLedgerValidator']));
    expect(gatesForArtifact('character-arc-plan')[0]?.validators).toEqual(expect.arrayContaining(['ArcDeltaValidator']));
  });

  it('keeps every registered gate tied to a concrete contract and validator list', () => {
    expect(ARTIFACT_GATE_REGISTRY.length).toBeGreaterThan(10);
    for (const gate of ARTIFACT_GATE_REGISTRY) {
      expect(gate.id).toBeTruthy();
      expect(gate.contract.length).toBeGreaterThan(20);
      expect(gate.validators.length).toBeGreaterThan(0);
      expect(gate.tier).toBe('blocking');
    }
  });
});
