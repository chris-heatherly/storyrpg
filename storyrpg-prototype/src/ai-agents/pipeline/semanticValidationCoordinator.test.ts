import { beforeEach, describe, expect, it } from 'vitest';
import type {
  SemanticRealizationClaim,
  SemanticRealizationJudgeLike,
  SemanticRealizationJudgeOutput,
  SemanticRealizationJudgeVerdict,
} from '../agents/SemanticRealizationJudge';
import type { AgentResponse } from '../agents/BaseAgent';
import type { NarrativeRealizationTask } from '../../types/narrativeContract';
import {
  clearSemanticValidationCache,
  validateSemanticRealizationTasks,
} from './semanticValidationCoordinator';
import { validateOwnerRealizationTasks } from './realizationTaskGate';

class FakeJudge implements SemanticRealizationJudgeLike {
  calls = 0;

  constructor(private readonly decide: (claim: SemanticRealizationClaim) => SemanticRealizationJudgeVerdict) {}

  identity() {
    return { policyVersion: 'test-v1', provider: 'test', model: 'test-judge' };
  }

  async execute(claims: SemanticRealizationClaim[]): Promise<AgentResponse<SemanticRealizationJudgeOutput>> {
    this.calls += 1;
    return { success: true, data: { verdicts: claims.map(this.decide) } };
  }
}

function task(overrides: Partial<NarrativeRealizationTask> = {}): NarrativeRealizationTask {
  return {
    id: 'task:dusk-club',
    contractId: 'event:dusk-club',
    canonicalEventId: 'event:dusk-club',
    episodeNumber: 1,
    ownerStage: 'scene_writer',
    repairHandler: 'scene_prose',
    sceneId: 's1',
    evidenceAtoms: [{
      id: 'atom:formation',
      description: 'The group forms the Dusk Club on-page.',
      acceptedPatterns: ['form the Dusk Club'],
      kind: 'semantic',
      verificationAuthority: 'semantic_judge',
      semanticRole: 'relationship_change',
      required: true,
    }],
    target: { scope: 'owner', surfaces: ['beat_text'] },
    sourceContractIds: ['treatment:dusk-club'],
    blocking: true,
    ...overrides,
  };
}

function verdict(
  claim: SemanticRealizationClaim,
  value: SemanticRealizationJudgeVerdict['verdict'],
  quote?: string,
): SemanticRealizationJudgeVerdict {
  return {
    id: claim.id,
    verdict: value,
    evidenceRefs: quote ? [claim.excerpts[0].id] : [],
    evidenceQuotes: quote ? [quote] : [],
    missingCriteria: value === 'fulfilled' ? [] : claim.criteria,
    rationale: value,
  };
}

describe('semanticValidationCoordinator', () => {
  beforeEach(() => clearSemanticValidationCache());

  it('accepts a clear paraphrase without requiring validator vocabulary', async () => {
    const prose = 'They lift chipped glasses. “To us,” Mika says, and the Dusk Club is born.';
    const judge = new FakeJudge((claim) => verdict(claim, 'fulfilled', 'Dusk Club is born'));
    const canonicalTask = task();

    expect(validateOwnerRealizationTasks({
      sceneId: 's1', tasks: [canonicalTask], sceneContent: { beats: [{ text: prose }] },
    })).toEqual([]);
    const result = await validateSemanticRealizationTasks({
      sceneId: 's1', tasks: [canonicalTask], sceneContent: { beats: [{ text: prose }] }, judge,
    });

    expect(result.findings).toEqual([]);
    expect(result.receipt.semanticVerdicts?.[0]).toMatchObject({
      disposition: 'confirmed', verdict: 'fulfilled', sampleCount: 1,
    });
  });

  it('requires two negative samples before confirming a missing meaning', async () => {
    const judge = new FakeJudge((claim) => verdict(claim, 'not_fulfilled'));
    const result = await validateSemanticRealizationTasks({
      sceneId: 's1', tasks: [task()],
      sceneContent: { beats: [{ text: 'Everyone leaves separately without naming a group.' }] },
      judge,
    });

    expect(judge.calls).toBe(2);
    expect(result.findings[0]).toMatchObject({
      code: 'SEMANTIC_REALIZATION_MISSING',
      missingEvidenceAtoms: ['atom:formation'],
    });
    expect(result.receipt.semanticVerdicts?.[0]?.sampleCount).toBe(2);
  });

  it('treats an invented evidence quote as validation infrastructure uncertainty', async () => {
    const judge = new FakeJudge((claim) => verdict(claim, 'fulfilled', 'a quote that is not present'));
    const result = await validateSemanticRealizationTasks({
      sceneId: 's1', tasks: [task()], sceneContent: { beats: [{ text: 'They sit in silence.' }] }, judge,
    });

    expect(result.findings[0]?.code).toBe('SEMANTIC_VALIDATION_INCONCLUSIVE');
    expect(result.receipt.semanticVerdicts?.[0]).toMatchObject({
      disposition: 'inconclusive', verdict: 'uncertain', sampleCount: 2,
    });
  });

  it('does not combine partial semantic evidence from sibling routes', async () => {
    const routeTask = task({
      id: 'task:route',
      ownerStage: 'encounter_architect',
      repairHandler: 'encounter_route',
      evidenceAtoms: [
        { id: 'atom:rescue', description: 'She rescues the child.', acceptedPatterns: ['rescues the child'], kind: 'route', verificationAuthority: 'semantic_judge', required: true },
        { id: 'atom:departure', description: 'She vanishes into the rain.', acceptedPatterns: ['vanishes into the rain'], kind: 'route', verificationAuthority: 'semantic_judge', required: true },
      ],
      target: { scope: 'any_route', outcomeTiers: ['victory', 'defeat'], surfaces: ['encounter_outcome'] },
    });
    const judge = new FakeJudge((claim) => {
      const prose = claim.excerpts.map((excerpt) => excerpt.text).join(' ');
      const keyword = claim.atomId === 'atom:rescue' ? 'rescues the child' : 'vanishes into the rain';
      return prose.includes(keyword) ? verdict(claim, 'fulfilled', keyword) : verdict(claim, 'not_fulfilled');
    });
    const result = await validateSemanticRealizationTasks({
      sceneId: 's1', tasks: [routeTask], judge,
      encounter: {
        outcomes: {
          victory: { outcomeText: 'She rescues the child.' },
          defeat: { outcomeText: 'She vanishes into the rain.' },
        },
      },
    });

    expect(result.findings[0]?.code).toBe('SEMANTIC_REALIZATION_MISSING');
    expect(result.findings[0]?.missingEvidenceAtoms).toHaveLength(1);
  });

  it('reuses a hash-bound consensus for unchanged evidence', async () => {
    const judge = new FakeJudge((claim) => verdict(claim, 'fulfilled', 'Dusk Club is born'));
    const input = {
      sceneId: 's1', tasks: [task()],
      sceneContent: { beats: [{ text: 'The Dusk Club is born.' }] },
      judge,
    };
    await validateSemanticRealizationTasks(input);
    await validateSemanticRealizationTasks(input);

    expect(judge.calls).toBe(1);
  });
});
