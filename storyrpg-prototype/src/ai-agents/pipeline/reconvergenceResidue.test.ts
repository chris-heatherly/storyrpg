import { describe, expect, it } from 'vitest';
import {
  attachResidueRequirements,
  buildResidueRepairDirectorNotes,
  buildResidueRequirementPromptSection,
  degradeMissingResidueIssues,
  deriveEpisodeResidueDirective,
  deriveResidueRequirements,
  hasMissingResidueFindings,
  missingResidueSceneIds,
  type ResidueBlueprintLike,
  type ResidueValidationResultLike,
} from './reconvergenceResidue';

function blueprint(): ResidueBlueprintLike {
  return {
    scenes: [
      {
        id: 's1',
        name: 'Fork',
        description: 'The fork in the road',
        leadsTo: ['s2', 's3'],
        choicePoint: {
          description: 'Take the bridge or the tunnel',
          setsTreatmentSeeds: ['treatment_seed_ep1_0'],
          setsBranchAxes: ['treatment_branch_loyalty'],
        },
      },
      { id: 's2', name: 'Bridge', description: 'Crossing the bridge', leadsTo: ['s4'] },
      { id: 's3', name: 'Tunnel', description: 'Through the tunnel', leadsTo: ['s4'] },
      { id: 's4', name: 'Gate', description: 'The city gate', leadsTo: [] },
    ],
  };
}

describe('deriveResidueRequirements', () => {
  it('derives a requirement for a scene with two distinct incoming planned paths', () => {
    const requirements = deriveResidueRequirements(blueprint());
    expect(requirements).toHaveLength(1);
    const req = requirements[0];
    expect(req.sceneId).toBe('s4');
    expect(req.reconvergedFrom.sort()).toEqual(['s2', 's3']);
    expect(req.expectedResidue).toBe('conditionalText');
    // Path summaries name each incoming scene.
    expect(req.pathSummaries.join('\n')).toContain('s2');
    expect(req.pathSummaries.join('\n')).toContain('s3');
  });

  it('does not flag single-incoming scenes', () => {
    const requirements = deriveResidueRequirements(blueprint());
    expect(requirements.map((r) => r.sceneId)).not.toContain('s2');
    expect(requirements.map((r) => r.sceneId)).not.toContain('s3');
  });

  it('collects gating flags from the incoming scenes choice points', () => {
    const bp = blueprint();
    bp.scenes[1].choicePoint = { description: 'bridge toll', setsTreatmentSeeds: ['treatment_seed_ep1_1'] };
    const requirements = deriveResidueRequirements(bp);
    expect(requirements[0].gatingFlags).toContain('treatment_seed_ep1_1');
  });

  it('skips encounter scenes (validator credits branched encounters structurally)', () => {
    const bp = blueprint();
    bp.scenes[3].isEncounter = true;
    expect(deriveResidueRequirements(bp)).toHaveLength(0);
  });

  it('merges BranchManager reconvergence-point acknowledgment + state notes', () => {
    const requirements = deriveResidueRequirements(blueprint(), {
      reconvergencePoints: [{
        sceneId: 's4',
        incomingBranches: ['path-a', 'path-b'],
        narrativeAcknowledgment: 'The guard notices how you arrived',
        stateReconciliation: [{ stateVariable: 'bridge_toll_paid', howToHandle: 'reference the toll if paid' }],
      }],
    });
    expect(requirements[0].acknowledgmentHint).toBe('The guard notices how you arrived');
    expect(requirements[0].pathSummaries.join('\n')).toContain('bridge_toll_paid');
  });

  it('creates a requirement for an analysis-declared reconvergence point even without two blueprint edges', () => {
    const bp: ResidueBlueprintLike = {
      scenes: [
        { id: 'a', leadsTo: ['b'] },
        { id: 'b', leadsTo: [] },
      ],
    };
    const requirements = deriveResidueRequirements(bp, {
      reconvergencePoints: [{ sceneId: 'b', incomingBranches: ['path-a', 'path-b'], narrativeAcknowledgment: 'ack' }],
    });
    expect(requirements).toHaveLength(1);
    expect(requirements[0].sceneId).toBe('b');
    // Real incoming scene ids are preferred; the analysis branch-path ids are
    // only the fallback when no blueprint edge is known.
    expect(requirements[0].reconvergedFrom).toEqual(['a']);
    const noEdges = deriveResidueRequirements({ scenes: [{ id: 'b', leadsTo: [] }] }, {
      reconvergencePoints: [{ sceneId: 'b', incomingBranches: ['path-a', 'path-b'] }],
    });
    expect(noEdges[0].reconvergedFrom).toEqual(['path-a', 'path-b']);
  });

  it('ignores self-loops and dangling leadsTo targets', () => {
    const bp: ResidueBlueprintLike = {
      scenes: [
        { id: 'a', leadsTo: ['a', 'missing', 'b'] },
        { id: 'b', leadsTo: [] },
      ],
    };
    expect(deriveResidueRequirements(bp)).toHaveLength(0);
  });
});

describe('attachResidueRequirements', () => {
  it('stamps the requirement onto the target scene blueprint and returns the count', () => {
    const bp = blueprint();
    const stamped = attachResidueRequirements(bp);
    expect(stamped).toBe(1);
    expect(bp.scenes[3].residueRequirement?.sceneId).toBe('s4');
    expect(bp.scenes[0].residueRequirement).toBeUndefined();
  });

  it('is idempotent', () => {
    const bp = blueprint();
    attachResidueRequirements(bp);
    const first = bp.scenes[3].residueRequirement;
    attachResidueRequirements(bp);
    expect(bp.scenes[3].residueRequirement).toEqual(first);
  });
});

describe('buildResidueRequirementPromptSection', () => {
  it('returns empty string without a requirement (prompt byte-identical)', () => {
    expect(buildResidueRequirementPromptSection(undefined)).toBe('');
  });

  it('renders a mandatory section with incoming paths and gating flags', () => {
    const bp = blueprint();
    attachResidueRequirements(bp);
    const section = buildResidueRequirementPromptSection(bp.scenes[3].residueRequirement);
    expect(section).toContain('RECONVERGENCE RESIDUE (MANDATORY');
    expect(section).toContain('s2, s3');
    expect(section).toContain('textVariant');
    // No plan-time flags on s2/s3 themselves -> falls back to state-context guidance.
    expect(section).toContain('Relevant State Context');
  });

  it('lists explicit gating flags when known', () => {
    const section = buildResidueRequirementPromptSection({
      sceneId: 's4',
      reconvergedFrom: ['s2', 's3'],
      expectedResidue: 'conditionalText',
      gatingFlags: ['took_the_bridge'],
      pathSummaries: [],
    });
    expect(section).toContain('`took_the_bridge`');
  });
});

function failingResult(extraIssues: ResidueValidationResultLike['issues'] = []): ResidueValidationResultLike {
  return {
    valid: false,
    issues: [
      {
        type: 'missing_branch_residue',
        severity: 'error',
        message: 'Reconverged branch target s4 has no conditional text, callback hook, or onShow residue to acknowledge the branch path.',
        targetSceneId: 's4',
      },
      ...extraIssues,
    ],
  };
}

describe('missing-residue result helpers', () => {
  it('extracts the offending scene ids from error findings only', () => {
    expect(missingResidueSceneIds(failingResult())).toEqual(['s4']);
    expect(hasMissingResidueFindings(failingResult())).toBe(true);
    const warningOnly: ResidueValidationResultLike = {
      valid: true,
      issues: [{ type: 'missing_branch_residue', severity: 'warning', message: 'x', targetSceneId: 's4' }],
    };
    expect(missingResidueSceneIds(warningOnly)).toEqual([]);
  });

  it('degrades residue errors to warnings and recomputes valid', () => {
    const { result, downgraded } = degradeMissingResidueIssues(failingResult());
    expect(downgraded).toHaveLength(1);
    expect(result.valid).toBe(true);
    expect(result.issues[0].severity).toBe('warning');
  });

  it('keeps non-residue errors blocking after the degrade', () => {
    const { result } = degradeMissingResidueIssues(
      failingResult([{ type: 'invalid_branch_target', severity: 'error', message: 'broken nav' }]),
    );
    expect(result.valid).toBe(false);
    expect(result.issues.find((i) => i.type === 'invalid_branch_target')?.severity).toBe('error');
  });

  it('does not mutate the input result', () => {
    const input = failingResult();
    degradeMissingResidueIssues(input);
    expect(input.valid).toBe(false);
    expect(input.issues[0].severity).toBe('error');
  });
});

describe('deriveEpisodeResidueDirective', () => {
  const scenes = [
    {
      id: 's2',
      name: 'Bridge',
      beats: [{
        id: 's2-b1',
        choices: [{
          id: 'c1',
          text: 'Pay the toll and cross',
          nextSceneId: 's4',
          consequences: [{ type: 'setFlag', flag: 'paid_toll' }, { type: 'relationship', flag: undefined }],
        }],
      }],
    },
    {
      id: 's3',
      name: 'Tunnel',
      beats: [
        { id: 's3-b1', choices: [{ id: 'c2', text: 'Slip through the dark', nextBeatId: 's3-b2', consequences: [{ type: 'setFlag', flag: 'went_dark' }] }] },
        { id: 's3-b2', nextSceneId: 's4' },
      ],
    },
    {
      id: 's3-enc',
      encounter: { id: 'enc-1', outcomes: { defeat: { nextSceneId: 's4' }, victory: { nextSceneId: 's5' } } },
    },
    { id: 's4', beats: [] },
  ];

  it('collects routing sources, real setFlag flags, and bridge-beat routes', () => {
    const directive = deriveEpisodeResidueDirective(scenes, 's4');
    expect(directive.reconvergedFrom.sort()).toEqual(['s2', 's3', 's3-enc']);
    expect(directive.gatingFlags).toContain('paid_toll');
    expect(directive.gatingFlags).toContain('went_dark');
    expect(directive.gatingFlags).toContain('encounter_enc-1_defeat');
    expect(directive.gatingFlags).not.toContain('encounter_enc-1_victory');
    expect(directive.pathSummaries.join('\n')).toContain('Pay the toll and cross');
  });

  it('builds director notes that mandate flag-gated textVariants on the flagged beat', () => {
    const directive = deriveEpisodeResidueDirective(scenes, 's4');
    const notes = buildResidueRepairDirectorNotes('s4', directive);
    expect(notes).toContain('RECONVERGENCE RESIDUE REPAIR for scene s4');
    expect(notes).toContain('textVariants');
    expect(notes).toContain('`paid_toll`');
    expect(notes).toContain('Do not invent new flags');
  });
});
