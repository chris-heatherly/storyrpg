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

  it('judges the canonical proposition instead of stronger legacy criteria', async () => {
    const seenClaims: SemanticRealizationClaim[] = [];
    const judge = new FakeJudge((claim) => {
      seenClaims.push(claim);
      return verdict(claim, 'fulfilled', 'offers you the spare key');
    });
    const canonicalTask = task({
      evidenceAtoms: [{
        id: 'atom:befriends',
        description: 'The shopkeeper befriends the traveler.',
        acceptedPatterns: ['befriends the traveler'],
        kind: 'semantic',
        verificationAuthority: 'semantic_judge',
        semanticRole: 'relationship_change',
        semanticCriteria: ['The shopkeeper and traveler are established close friends.'],
        required: true,
      }],
    });

    const result = await validateSemanticRealizationTasks({
      sceneId: 's1',
      tasks: [canonicalTask],
      sceneContent: { beats: [{ text: 'The shopkeeper offers you the spare key and asks you to come back tomorrow.' }] },
      judge,
    });

    expect(result.findings).toEqual([]);
    expect(seenClaims[0]).toMatchObject({
      proposition: 'The shopkeeper befriends the traveler.',
      criteria: ['The shopkeeper befriends the traveler.'],
    });
  });

  it('requires two negative samples before confirming a missing meaning', async () => {
    const judge = new FakeJudge((claim) => verdict(claim, 'not_fulfilled'));
    const result = await validateSemanticRealizationTasks({
      sceneId: 's1', tasks: [task()],
      sceneContent: { beats: [{ text: 'Everyone leaves separately without naming a group.' }] },
      judge,
    });

    expect(judge.calls).toBe(3);
    expect(result.findings[0]).toMatchObject({
      code: 'SEMANTIC_REALIZATION_MISSING',
      missingEvidenceAtoms: ['atom:formation'],
    });
    expect(result.receipt.semanticVerdicts?.[0]?.sampleCount).toBe(3);
  });

  it('requires focused adjudication before trusting correlated negative samples', async () => {
    let executeCalls = 0;
    let adjudicationCalls = 0;
    const judge: SemanticRealizationJudgeLike = {
      identity: () => ({ policyVersion: 'test-v2', provider: 'test', model: 'test-judge' }),
      execute: async (claims) => {
        executeCalls += 1;
        return { success: true, data: { verdicts: claims.map((claim) => verdict(claim, 'contradicted', 'A, this is B.')) } };
      },
      adjudicate: async (claim) => {
        adjudicationCalls += 1;
        return { success: true, data: { verdicts: [verdict(claim, 'fulfilled', 'A, this is B.')] } };
      },
    };

    const result = await validateSemanticRealizationTasks({
      sceneId: 's1',
      tasks: [task({
        evidenceAtoms: [{
          id: 'atom:introduction',
          description: 'The host introduces B to A.',
          acceptedPatterns: ['introduces B to A'],
          kind: 'semantic',
          verificationAuthority: 'semantic_judge',
          semanticRole: 'introduction',
          required: true,
        }],
      })],
      sceneContent: { beats: [{ text: 'The host gestures. "A, this is B."' }] },
      judge,
    });

    expect(executeCalls).toBe(2);
    expect(adjudicationCalls).toBe(1);
    expect(result.findings).toEqual([]);
    expect(result.receipt.semanticVerdicts?.[0]).toMatchObject({
      disposition: 'confirmed',
      verdict: 'fulfilled',
      sampleCount: 3,
    });
  });

  it('does not convert unavailable negative adjudication into a content miss', async () => {
    const judge: SemanticRealizationJudgeLike = {
      identity: () => ({ policyVersion: 'test-v2', provider: 'test', model: 'test-judge' }),
      execute: async (claims) => ({
        success: true,
        data: { verdicts: claims.map((claim) => verdict(claim, 'not_fulfilled')) },
      }),
      adjudicate: async () => ({
        success: false,
        error: 'provider timeout',
        failureKind: 'provider_unavailable',
      }),
    };

    const result = await validateSemanticRealizationTasks({
      sceneId: 's1',
      tasks: [task()],
      sceneContent: { beats: [{ text: 'Everyone leaves separately.' }] },
      judge,
    });

    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toMatchObject({
      code: 'SEMANTIC_VALIDATION_UNAVAILABLE',
      missingEvidenceAtoms: ['atom:formation'],
    });
    expect(result.receipt.semanticVerdicts?.[0]).toMatchObject({
      disposition: 'inconclusive',
      sampleCount: 3,
      executionStatus: 'provider_unavailable',
    });
  });

  it('derives evidence quotes from valid addressable citations', async () => {
    const judge = new FakeJudge((claim) => verdict(claim, 'fulfilled', 'a quote that is not present'));
    const result = await validateSemanticRealizationTasks({
      sceneId: 's1', tasks: [task()], sceneContent: { beats: [{ text: 'They sit in silence.' }] }, judge,
    });

    expect(result.findings).toEqual([]);
    expect(result.receipt.semanticVerdicts?.[0]).toMatchObject({
      disposition: 'confirmed', verdict: 'fulfilled', sampleCount: 1,
      evidenceQuotes: ['They sit in silence.'],
    });
  });

  it('does not let unused uncertain alternatives block a satisfied threshold contract', async () => {
    const thresholdTask = task({
      id: 'task:premise:role',
      minimumEvidenceHits: 2,
      evidenceAtoms: [
        { id: 'atom:writer', description: 'Kylie is a writer.', acceptedPatterns: ['writer'], kind: 'semantic', verificationAuthority: 'semantic_judge', required: true },
        { id: 'atom:arrival', description: 'Kylie has newly arrived.', acceptedPatterns: ['arrived'], kind: 'semantic', verificationAuthority: 'semantic_judge', required: true },
        { id: 'atom:background', description: 'Kylie has Romanian ancestry.', acceptedPatterns: ['Romanian ancestry'], kind: 'semantic', verificationAuthority: 'semantic_judge', required: true },
      ],
    });
    const judge = new FakeJudge((claim) => claim.atomId === 'atom:background'
      ? verdict(claim, 'uncertain')
      : verdict(claim, 'fulfilled', claim.atomId === 'atom:writer' ? 'writer' : 'arrived'));

    const result = await validateSemanticRealizationTasks({
      sceneId: 's1',
      tasks: [thresholdTask],
      sceneContent: { beats: [{ text: 'The newly arrived writer studies the room.' }] },
      judge,
    });

    expect(result.findings).toEqual([]);
    expect(result.receipt.semanticVerdicts?.find((item) => item.atomId === 'atom:background')).toMatchObject({
      disposition: 'inconclusive',
      sampleCount: 3,
    });
  });

  it('aggregates mixed literal and semantic alternatives once and skips an unnecessary judge call', async () => {
    const identityTask = task({
      id: 'task:premise:canonical-identity',
      canonicalEventId: undefined,
      minimumEvidenceHits: 1,
      evidenceAtoms: [
        {
          id: 'atom:name', description: 'The protagonist is named Kylie Marinescu.',
          acceptedPatterns: ['Kylie Marinescu'], kind: 'semantic', verificationAuthority: 'literal', required: true,
        },
        {
          id: 'atom:pronouns', description: 'The protagonist uses she/her pronouns.',
          acceptedPatterns: ['she/her'], kind: 'semantic', verificationAuthority: 'semantic_judge', required: false,
        },
      ],
    });
    const judge = new FakeJudge((claim) => verdict(claim, 'not_fulfilled'));

    const result = await validateSemanticRealizationTasks({
      sceneId: 's1', tasks: [identityTask],
      sceneContent: { beats: [{ text: 'In this city, you are simply Kylie Marinescu.' }] }, judge,
    });

    expect(result.findings).toEqual([]);
    expect(judge.calls).toBe(0);
    expect(result.receipt.atomVerdicts).toContainEqual(expect.objectContaining({
      atomId: 'atom:name', authority: 'literal', outcome: 'pass',
    }));
    expect(result.receipt.semanticVerdicts).toEqual([]);
  });

  it('lets focused adjudication resolve two inconclusive samples', async () => {
    let executeCalls = 0;
    let adjudicationCalls = 0;
    const judge: SemanticRealizationJudgeLike = {
      identity: () => ({ policyVersion: 'test-v2', provider: 'test', model: 'test-judge' }),
      execute: async (claims) => {
        executeCalls += 1;
        return { success: true, data: { verdicts: claims.map((claim) => verdict(claim, 'uncertain')) } };
      },
      adjudicate: async (claim) => {
        adjudicationCalls += 1;
        return { success: true, data: { verdicts: [verdict(claim, 'fulfilled', 'Dusk Club is born')] } };
      },
    };

    const result = await validateSemanticRealizationTasks({
      sceneId: 's1',
      tasks: [task()],
      sceneContent: { beats: [{ text: 'With a toast, the Dusk Club is born.' }] },
      judge,
    });

    expect(executeCalls).toBe(2);
    expect(adjudicationCalls).toBe(1);
    expect(result.findings).toEqual([]);
    expect(result.receipt.semanticVerdicts?.[0]).toMatchObject({
      disposition: 'confirmed',
      verdict: 'fulfilled',
      sampleCount: 3,
      executionStatus: 'decided',
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

  it('reuses a positive receipt when unrelated evidence changes', async () => {
    const judge = new FakeJudge((claim) => verdict(claim, 'fulfilled', 'Dusk Club is born'));
    await validateSemanticRealizationTasks({
      sceneId: 's1', tasks: [task()],
      sceneContent: { beats: [{ text: 'The Dusk Club is born.' }] },
      judge,
    });
    await validateSemanticRealizationTasks({
      sceneId: 's1', tasks: [task()],
      sceneContent: { beats: [{ text: 'An unrelated arrival happens outside.' }, { text: 'The Dusk Club is born.' }] },
      judge,
    });

    expect(judge.calls).toBe(1);
  });

  it('classifies provider failure separately from missing content', async () => {
    const judge: SemanticRealizationJudgeLike = {
      identity: () => ({ policyVersion: 'test-v1', provider: 'test', model: 'test-judge' }),
      execute: async () => ({
        success: false,
        error: 'provider timeout',
        failureKind: 'provider_unavailable',
      }),
    };
    const result = await validateSemanticRealizationTasks({
      sceneId: 's1', tasks: [task()],
      sceneContent: { beats: [{ text: 'The Dusk Club is born.' }] },
      judge,
    });

    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toMatchObject({
      code: 'SEMANTIC_VALIDATION_UNAVAILABLE',
      missingEvidenceAtoms: ['atom:formation'],
    });
    expect(result.receipt.semanticVerdicts?.[0]).toMatchObject({
      disposition: 'inconclusive',
      executionStatus: 'provider_unavailable',
    });
  });
});
