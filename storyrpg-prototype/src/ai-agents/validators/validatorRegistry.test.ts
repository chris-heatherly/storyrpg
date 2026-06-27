import { describe, it, expect } from 'vitest';
import {
  ARTIFACT_CONTRACT_REGISTRY,
  ARTIFACT_VALIDATOR_OWNERSHIP,
  VALIDATOR_REGISTRY,
  artifactGateDefinitions,
  blockingValidators,
  remediationRoute,
  validateValidatorOwnershipRegistry,
  validatorForGate,
  validatorNamesForArtifact,
  validatorsForLifecycle,
  type ValidatorRegistryEntry,
  type ValidatorLifecycle,
  type ValidatorRemediation,
  type ValidatorStage,
  type ValidatorTier,
} from './validatorRegistry';

const STAGES: ValidatorStage[] = ['season', 'architecture', 'phase', 'quick', 'full', 'diagnostic', 'artifact-contract', 'final'];
const TIERS: ValidatorTier[] = ['blocking', 'advisory', 'autofix'];
const LIFECYCLES: ValidatorLifecycle[] = [
  'source-analysis',
  'season-plan',
  'episode-architecture',
  'phase-validation',
  'quick-validation',
  'full-qa',
  'narrative-diagnostics',
  'plan-fidelity',
  'episode-contract',
  'final-contract',
  'artifact-package',
];
const REMEDIATIONS: ValidatorRemediation[] = [
  'autofix',
  'regen-scene',
  'regen-choices',
  'regen-encounter',
  'regen-episode',
  'plan-time',
  'none',
];

// S1 — blocking validators that do NOT yet declare a remediation route. The
// invariant test below tolerates these so it lands green today; remove names as
// each blocking gate gets a route, then delete this allowlist to tighten the rule.
const BLOCKING_WITHOUT_REMEDIATION_ALLOWLIST: ReadonlySet<string> = new Set([
  'StoryCircleCoverageValidator',
  'FinalStoryContractValidator',
  'EncounterQualityValidator',
  'PromiseLedgerValidators',
  'CanonConsistencyValidator',
]);

describe('validatorRegistry (B4 dispatch map)', () => {
  it('every entry has a known stage and tier', () => {
    for (const e of VALIDATOR_REGISTRY) {
      expect(STAGES).toContain(e.stage);
      expect(TIERS).toContain(e.tier);
      expect(e.validator).toBeTruthy();
      expect(e.dispatchedFrom).toBeTruthy();
    }
  });

  it('has no duplicate (validator, stage) pairs', () => {
    const seen = new Set<string>();
    for (const e of VALIDATOR_REGISTRY) {
      const key = `${e.validator}@${e.stage}`;
      expect(seen.has(key), `duplicate ${key}`).toBe(false);
      seen.add(key);
    }
  });

  it('the architecture-stage craft validators are advisory (B1 tiering)', () => {
    const arch = VALIDATOR_REGISTRY.filter((e) => e.stage === 'architecture');
    expect(arch.length).toBeGreaterThanOrEqual(5);
    expect(arch.every((e) => e.tier === 'advisory')).toBe(true);
  });

  it('the final story contract is the blocking gate', () => {
    expect(blockingValidators()).toContain('FinalStoryContractValidator');
  });

  it('does not list the removed dead SeasonValidator', () => {
    expect(VALIDATOR_REGISTRY.some((e) => e.validator === 'SeasonValidator')).toBe(false);
  });

  it('accepts optional remediation metadata fields (S1)', () => {
    const entry: ValidatorRegistryEntry = {
      validator: 'ExampleValidator',
      stage: 'final',
      tier: 'blocking',
      dispatchedFrom: 'test',
      remediation: 'regen-scene',
      rolloutFlag: 'gating.example',
      maxRemediationAttempts: 2,
    };
    expect(REMEDIATIONS).toContain(entry.remediation);
    expect(entry.rolloutFlag).toBe('gating.example');
    expect(entry.maxRemediationAttempts).toBe(2);
  });

  it('any declared remediation/maxRemediationAttempts is well-formed', () => {
    for (const e of VALIDATOR_REGISTRY) {
      if (e.remediation !== undefined) {
        expect(REMEDIATIONS).toContain(e.remediation);
      }
      if (e.maxRemediationAttempts !== undefined) {
        expect(Number.isInteger(e.maxRemediationAttempts)).toBe(true);
        expect(e.maxRemediationAttempts).toBeGreaterThan(0);
      }
    }
  });

  it('normalizes legacy stages into executable lifecycle ownership', () => {
    for (const lifecycle of LIFECYCLES) {
      const entries = validatorsForLifecycle(lifecycle);
      for (const entry of entries) {
        expect(entry.lifecycle).toBe(lifecycle);
        expect(entry.role).toBeTruthy();
      }
    }

    expect(validatorsForLifecycle('season-plan').map((e) => e.validator)).toContain('StoryCircleCoverageValidator');
    expect(validatorsForLifecycle('quick-validation').map((e) => e.validator)).toContain('ChoiceDensityValidator');
    expect(validatorsForLifecycle('final-contract').map((e) => e.validator)).toContain('FinalStoryContractValidator');
  });

  it('keeps rollout flags tied to registered gate policy', () => {
    expect(validateValidatorOwnershipRegistry()).toEqual([]);
    expect(validatorForGate('GATE_CHOICE_DISTRIBUTION')?.validator).toBe('ChoiceDistributionValidator');
    expect(validatorForGate('GATE_STORY_CIRCLE_ANCHOR_CONFORMANCE')?.validator).toBe('StoryCircleAnchorConformanceValidator');
    expect(validatorForGate('GATE_REQUIRED_BEAT_REALIZATION')?.validator).toBe('RequiredBeatRealizationValidator');
    expect(validatorForGate('GATE_ENCOUNTER_SETPIECE_DEPTH')?.validator).toBe('EncounterSetPieceDepthValidator');
  });

  it('owns artifact validator membership without changing artifact contract lists', () => {
    expect(validatorNamesForArtifact('source-analysis')).toEqual([
      'AuthoredEpisodeConformanceValidator',
      'StoryCircleAnchorConformanceValidator',
      'TreatmentFidelityValidator',
      'quoteRecallValidator',
      'SignatureDevicePresenceValidator',
    ]);
    expect(validatorNamesForArtifact('runtime-episode')).toEqual([
      'StructuralValidator',
      'FinalStoryContractValidator',
      'MechanicsLeakageValidator',
      'SceneGraphBranchValidator',
      'ArcDeltaValidator',
      'SetupPayoffValidator',
      'TreatmentFidelityValidator',
      'storyPathAnalyzer',
    ]);
  });

  it('keeps artifact contract blocking separate from runtime validator blocking', () => {
    const runtimeBlocking = blockingValidators();
    expect(artifactGateDefinitions().find((gate) => gate.artifactKind === 'choice-consequence-plan')).toMatchObject({
      tier: 'blocking',
      validators: expect.arrayContaining(['ChoiceDensityValidator']),
    });
    expect(artifactGateDefinitions().find((gate) => gate.artifactKind === 'thread-ledger')).toMatchObject({
      tier: 'blocking',
      validators: expect.arrayContaining(['SetupPayoffValidator']),
    });
    expect(artifactGateDefinitions().find((gate) => gate.artifactKind === 'character-arc-plan')).toMatchObject({
      tier: 'blocking',
      validators: expect.arrayContaining(['ArcDeltaValidator']),
    });
    expect(runtimeBlocking).not.toContain('ChoiceDensityValidator');
    expect(runtimeBlocking).not.toContain('SetupPayoffValidator');
    expect(runtimeBlocking).not.toContain('ArcDeltaValidator');
  });

  it('reports artifact contract drift without mutating production metadata', () => {
    const sourceContract = ARTIFACT_CONTRACT_REGISTRY.find((entry) => entry.artifactKind === 'source-analysis');
    expect(sourceContract).toBeDefined();

    expect(validateValidatorOwnershipRegistry({
      artifactContractRegistry: [
        ...ARTIFACT_CONTRACT_REGISTRY,
        { ...sourceContract! },
      ],
    })).toEqual(expect.arrayContaining([
      expect.objectContaining({ validator: sourceContract!.id, problem: 'duplicate artifact contract id' }),
      expect.objectContaining({ validator: 'source-analysis', problem: 'artifact kind has 2 artifact contract entries' }),
    ]));

    expect(validateValidatorOwnershipRegistry({
      artifactContractRegistry: ARTIFACT_CONTRACT_REGISTRY.filter((entry) => entry.artifactKind !== 'runtime-episode'),
    })).toEqual(expect.arrayContaining([
      expect.objectContaining({
        validator: 'runtime-episode',
        problem: 'artifact ownership kind has no artifact contract entry',
      }),
    ]));

    expect(validateValidatorOwnershipRegistry({
      artifactValidatorOwnership: [
        ...ARTIFACT_VALIDATOR_OWNERSHIP,
        { validator: 'SetupPayoffValidator', artifactKinds: ['thread-ledger'], role: 'primary' },
      ],
    })).toEqual(expect.arrayContaining([
      expect.objectContaining({
        validator: 'SetupPayoffValidator',
        problem: 'duplicate artifact ownership entry for thread-ledger',
      }),
    ]));

    expect(validateValidatorOwnershipRegistry({
      artifactContractRegistry: ARTIFACT_CONTRACT_REGISTRY.map((entry) =>
        entry.artifactKind === 'story-package'
          ? { ...entry, tier: 'unknown', contract: '' } as unknown as typeof entry
          : entry
      ),
    })).toEqual(expect.arrayContaining([
      expect.objectContaining({ validator: 'story-package-contract', problem: 'artifact contract has unknown tier unknown' }),
      expect.objectContaining({ validator: 'story-package-contract', problem: 'artifact contract text is empty' }),
    ]));
  });

  it('remediationRoute resolves declared routes and undefined otherwise', () => {
    const withRoute = VALIDATOR_REGISTRY.find((e) => e.remediation !== undefined);
    if (withRoute) {
      expect(remediationRoute(withRoute.validator)).toBe(withRoute.remediation);
    }
    expect(remediationRoute('NoSuchValidator')).toBeUndefined();
  });

  // S1 scaffold: blocking validators SHOULD declare a remediation route. This
  // passes today by allowing undefined for pre-existing blocking entries (see the
  // allowlist above); shrink the allowlist to enforce the requirement validator by
  // validator. Entries NOT in the allowlist are already held to the rule.
  it('every blocking entry declares a remediation route (allowlisted exceptions)', () => {
    for (const e of VALIDATOR_REGISTRY) {
      if (e.tier !== 'blocking') continue;
      if (e.remediation !== undefined) continue;
      expect(
        BLOCKING_WITHOUT_REMEDIATION_ALLOWLIST.has(e.validator),
        `blocking validator ${e.validator} has no remediation route and is not allowlisted`,
      ).toBe(true);
    }
  });
});
