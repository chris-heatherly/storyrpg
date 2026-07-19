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
  clearOwnerAtomReceiptsForTest,
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

describe('causal-restage memory/aftermath bypass (r115 gap analysis, 2026-07-18)', () => {
  function restageTask(): NarrativeRealizationTask {
    return task({
      id: 'task:event:park-restage:causal-restage',
      evidenceAtoms: [{
        id: 'event:park-restage:source-restaged-after-consequence',
        description: 'This consequence scene must not actively perform the already-completed causal event "you are attacked in the park" as a new action. Memory, aftermath, or reference is allowed.',
        acceptedPatterns: [],
        kind: 'semantic',
        verificationAuthority: 'semantic_judge',
        polarity: 'forbidden',
        required: true,
      }],
    });
  }

  it('never invokes the judge when every excerpt is memory-framed', async () => {
    const judge = new FakeJudge((claim) => verdict(claim, 'fulfilled', 'plays on a loop'));
    const prose = 'The memory of the park plays on a loop behind your eyes, too sharp and vivid for the dark.';

    const result = await validateSemanticRealizationTasks({
      sceneId: 's1-6', tasks: [restageTask()], sceneContent: { beats: [{ text: prose }] }, judge,
    });

    expect(judge.calls).toBe(0);
    expect(result.findings).toEqual([]);
  });

  it('still judges when the excerpt is NOT memory/aftermath-framed', async () => {
    const judge = new FakeJudge((claim) => verdict(claim, 'fulfilled', 'you are attacked'));
    const prose = 'A rough hand grabs your shoulder in the park, spinning you around.';

    const result = await validateSemanticRealizationTasks({
      sceneId: 's1-6', tasks: [restageTask()], sceneContent: { beats: [{ text: prose }] }, judge,
    });

    expect(judge.calls).toBeGreaterThan(0);
    expect(result.findings[0]).toMatchObject({ code: 'SEMANTIC_FORBIDDEN_EVIDENCE_PRESENT' });
  });

  it('does not bypass a forbidden atom outside the causal-restage class, even with memory framing', async () => {
    const judge = new FakeJudge((claim) => verdict(claim, 'fulfilled', 'plays on a loop'));
    const unrelatedForbidden = task({
      evidenceAtoms: [{
        id: 'reveal:1:forbidden:1',
        description: 'The rescue is staged.',
        acceptedPatterns: [],
        kind: 'semantic',
        verificationAuthority: 'semantic_judge',
        polarity: 'forbidden',
        required: true,
      }],
    });
    const prose = 'The memory of that night plays on a loop: my father will be pleased, the bait worked.';

    await validateSemanticRealizationTasks({
      sceneId: 's1', tasks: [unrelatedForbidden], sceneContent: { beats: [{ text: prose }] }, judge,
    });

    expect(judge.calls).toBeGreaterThan(0);
  });
});

describe('introduction-ritual prefilter', () => {
  it('does not spend an LLM judgment on ordinary later-scene character presence', async () => {
    const judge = new FakeJudge((claim) => verdict(claim, 'fulfilled', 'Mika lifts her glass'));
    const reintroductionTask = task({
      id: 'task:first-appearance:char-mika:reintroduction:s1-4',
      evidenceAtoms: [{
        id: 'atom:first-appearance:char-mika:reintroduction:s1-4',
        description: 'This scene must not present Mika as if Kylie is meeting or being introduced to her for the first time.',
        acceptedPatterns: [],
        kind: 'semantic',
        verificationAuthority: 'semantic_judge',
        polarity: 'forbidden',
        required: true,
      }],
    });

    const result = await validateSemanticRealizationTasks({
      sceneId: 's1-4',
      tasks: [reintroductionTask],
      sceneContent: { beats: [{ text: 'Mika lifts her glass and continues the story she started at the bookshop.' }] },
      judge,
    });

    expect(judge.calls).toBe(0);
    expect(result.findings).toEqual([]);
    expect(result.receipt.taskEvaluations?.[0]).toMatchObject({
      taskId: reintroductionTask.id,
      status: 'satisfied',
    });
  });
});

describe('reveal-timing enforcement (F1.1)', () => {
  const revealTask = () => task({
    id: 'task:reveal:1:staged-rescue:s1-final',
    contractId: 'reveal:1:staged-rescue',
    canonicalEventId: undefined,
    enforcementPhase: 'final_regression',
    evidenceAtoms: [{
      id: 'reveal:1:forbidden:1:s1-final',
      description: 'The rescue or attack is revealed as staged, arranged, or bait.',
      acceptedPatterns: [],
      kind: 'semantic',
      verificationAuthority: 'semantic_judge',
      polarity: 'forbidden',
      required: true,
    }],
  });

  it('flags the archived bait-message class as forbidden meaning present', async () => {
    // The exact defect that shipped in bite-me_2026-07-15T18-38-14: the final
    // beat confirmed the staged rescue seven episodes early through a passing
    // contract, because nothing modeled forbidden meanings with a time bound.
    const judge: SemanticRealizationJudgeLike = {
      identity: () => ({ policyVersion: 'test-v2', provider: 'test', model: 'test-judge' }),
      execute: async (claims) => ({
        success: true,
        data: { verdicts: claims.map((claim) => verdict(claim, 'fulfilled', 'The bait worked perfectly.')) },
      }),
    };
    const result = await validateSemanticRealizationTasks({
      sceneId: 's1-final',
      tasks: [revealTask()],
      sceneContent: { beats: [{ text: "It's Mr. Midnight. 'My father will be pleased. The bait worked perfectly. Welcome to the Dusk Club.'" }] },
      judge,
    });
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toMatchObject({
      blocking: true,
      matchedForbiddenAtoms: ['reveal:1:forbidden:1:s1-final'],
    });
  });

  it('passes a cliffhanger that deepens mystery without confirming the secret', async () => {
    const judge: SemanticRealizationJudgeLike = {
      identity: () => ({ policyVersion: 'test-v2', provider: 'test', model: 'test-judge' }),
      execute: async (claims) => ({
        success: true,
        data: { verdicts: claims.map((claim) => verdict(claim, 'not_fulfilled', '')) },
      }),
    };
    const result = await validateSemanticRealizationTasks({
      sceneId: 's1-final',
      tasks: [revealTask()],
      sceneContent: { beats: [{ text: 'Your phone buzzes: an unknown number, a single line — "Welcome to the night, Kylie." You never gave him your name.' }] },
      judge,
    });
    expect(result.findings).toEqual([]);
  });
});

describe('evidence-safe forbidden judgments', () => {
  const endingTask = () => task({
    id: 'task:escalation-budget:ep1',
    evidenceAtoms: [{
      id: 'escalation-budget:ep1:ending-displaced',
      description: 'A new threat must not displace the protagonist-owned emotional ending.',
      acceptedPatterns: [],
      kind: 'semantic',
      verificationAuthority: 'semantic_judge',
      polarity: 'forbidden',
      required: true,
    }],
  });

  it('does not turn an evidence-free proposition-present verdict into a content blocker', async () => {
    const judge = new FakeJudge((claim) => verdict(claim, 'partial'));

    const result = await validateSemanticRealizationTasks({
      sceneId: 's1-final',
      tasks: [endingTask()],
      sceneContent: { beats: [{ text: 'You close the laptop and decide the unanswered question can wait until morning.' }] },
      judge,
    });

    expect(result.findings.some((finding) => finding.code === 'SEMANTIC_FORBIDDEN_EVIDENCE_PRESENT')).toBe(false);
    expect(result.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'SEMANTIC_VALIDATION_INCONCLUSIVE' }),
    ]));
  });

  it('does not let a lone adjudication create a content miss against non-blocking samples', async () => {
    let executeCalls = 0;
    const judge: SemanticRealizationJudgeLike = {
      identity: () => ({ policyVersion: 'test-v3', provider: 'test', model: 'test-judge' }),
      execute: async (claims) => {
        executeCalls += 1;
        return {
          success: true,
          data: { verdicts: claims.map((claim) => verdict(claim, executeCalls === 1 ? 'uncertain' : 'not_fulfilled')) },
        };
      },
      adjudicate: async (claim) => ({
        success: true,
        data: { verdicts: [verdict(claim, 'fulfilled', claim.excerpts[0].text)] },
      }),
    };

    const result = await validateSemanticRealizationTasks({
      sceneId: 's1-final',
      tasks: [endingTask()],
      sceneContent: { beats: [{ text: 'You close the laptop and keep the final decision for yourself.' }] },
      judge,
    });

    expect(result.findings.some((finding) => finding.code === 'SEMANTIC_FORBIDDEN_EVIDENCE_PRESENT')).toBe(false);
    expect(result.receipt.semanticVerdicts?.[0]).toMatchObject({
      disposition: 'inconclusive',
      sampleCount: 3,
    });
  });

  it('judges ending ownership from chronological terminal beats, not an earlier warning', async () => {
    const claims: SemanticRealizationClaim[] = [];
    const judge = new FakeJudge((claim) => {
      claims.push(claim);
      return verdict(claim, 'not_fulfilled');
    });

    const result = await validateSemanticRealizationTasks({
      sceneId: 's1-final',
      tasks: [endingTask()],
      sceneContent: { beats: [
        { id: 'b1', text: 'A warning arrives: other things are watching from the dark.' },
        { id: 'b2', text: 'You cross the empty club and lock the door.' },
        { id: 'b3', text: 'You publish the piece under your own name.' },
        { id: 'b4', text: 'Mika reads it, then raises her glass to your decision.' },
        { id: 'b5', text: 'You close the laptop and let the unanswered question wait until morning.' },
      ] },
      judge,
    });

    expect(result.findings).toEqual([]);
    expect(claims[0].excerpts.map((excerpt) => excerpt.text).join(' ')).not.toContain('other things are watching');
    expect(claims[0].excerpts.map((excerpt) => excerpt.text).join(' ')).toContain('You publish the piece');
    expect(claims[0].criteria).toHaveLength(3);
    expect(claims[0].criteria[2]).toContain('warning, question, or future pressure');
  });
});

describe('owner-receipt continuity at final regression (W3.2)', () => {
  beforeEach(() => {
    clearSemanticValidationCache();
    clearOwnerAtomReceiptsForTest();
  });

  const ownerProse = 'A tall stranger steps from the fog and hauls the assailant off you.';

  it('honors a confirmed owner receipt when assembly only ADDED excerpts (run 2026-07-16T03-12-37)', async () => {
    const rescueTask = task({
      id: 'task:event:rescue:owner-event',
      evidenceAtoms: [{
        id: 'atom:rescue',
        description: 'Kylie is rescued by a handsome stranger.',
        acceptedPatterns: [],
        kind: 'semantic',
        verificationAuthority: 'semantic_judge',
        required: true,
      }],
    });
    const ownerJudge = new FakeJudge((claim) => verdict(claim, 'fulfilled', 'hauls the assailant off you'));
    const ownerResult = await validateSemanticRealizationTasks({
      sceneId: 'enc-1', tasks: [rescueTask], sceneContent: { beats: [{ text: ownerProse }] }, judge: ownerJudge,
    });
    expect(ownerResult.findings).toEqual([]);

    // Final regression sees the SAME prose plus assembly-injected summary text;
    // this judge would flip the verdict — it must never be asked.
    const flippyJudge = new FakeJudge((claim) => verdict(claim, 'not_fulfilled'));
    const finalResult = await validateSemanticRealizationTasks({
      sceneId: 'enc-1',
      tasks: [rescueTask],
      sceneContent: { beats: [{ text: ownerProse }, { text: 'You survive the attack and reach your doorstep safely.' }] },
      mode: 'final_regression',
      currentStage: 'scene_writer',
      judge: flippyJudge,
    });
    expect(finalResult.findings).toEqual([]);
    expect(flippyJudge.calls).toBe(0);
  });

  it('re-judges when the owner-confirmed excerpts are no longer all present', async () => {
    const rescueTask = task({
      id: 'task:event:rescue:owner-event',
      evidenceAtoms: [{
        id: 'atom:rescue',
        description: 'Kylie is rescued by a handsome stranger.',
        acceptedPatterns: [],
        kind: 'semantic',
        verificationAuthority: 'semantic_judge',
        required: true,
      }],
    });
    const ownerJudge = new FakeJudge((claim) => verdict(claim, 'fulfilled', 'hauls the assailant off you'));
    await validateSemanticRealizationTasks({
      sceneId: 'enc-1', tasks: [rescueTask], sceneContent: { beats: [{ text: ownerProse }] }, judge: ownerJudge,
    });

    const finalJudge = new FakeJudge((claim) => verdict(claim, 'not_fulfilled'));
    const finalResult = await validateSemanticRealizationTasks({
      sceneId: 'enc-1',
      tasks: [rescueTask],
      sceneContent: { beats: [{ text: 'A quiet walk home with no incident at all.' }] },
      mode: 'final_regression',
      currentStage: 'scene_writer',
      judge: finalJudge,
    });
    expect(finalJudge.calls).toBeGreaterThan(0);
    expect(finalResult.findings.map((finding) => finding.code)).toContain('SEMANTIC_REALIZATION_MISSING');
  });

  it('never honors receipts for forbidden atoms — added text can introduce a leak', async () => {
    const forbiddenTask = task({
      id: 'task:reveal:secret:s1',
      evidenceAtoms: [{
        id: 'atom:secret',
        description: 'Victor is a vampire.',
        acceptedPatterns: [],
        kind: 'semantic',
        polarity: 'forbidden',
        verificationAuthority: 'semantic_judge',
        required: true,
      }],
    });
    const cleanJudge = new FakeJudge((claim) => verdict(claim, 'not_fulfilled'));
    await validateSemanticRealizationTasks({
      sceneId: 's1', tasks: [forbiddenTask], sceneContent: { beats: [{ text: ownerProse }] }, judge: cleanJudge,
    });

    const finalJudge = new FakeJudge((claim) => verdict(claim, 'not_fulfilled'));
    await validateSemanticRealizationTasks({
      sceneId: 's1',
      tasks: [forbiddenTask],
      sceneContent: { beats: [{ text: ownerProse }, { text: 'New assembly text.' }] },
      mode: 'final_regression',
      currentStage: 'scene_writer',
      judge: finalJudge,
    });
    expect(finalJudge.calls).toBeGreaterThan(0);
  });
});

describe('scoped fresh samples on instrument-failure retry (r120/r121 timeout root cause)', () => {
  // The global clearSemanticValidationCache() on judge instrument failure made
  // every later repair-round revalidation re-judge ALL tasks (~100 serialized
  // calls, 3.5-4 min per pass) — and with ~1 flaky call per 100, each pass
  // re-triggered the wipe. forceFreshTaskIds re-samples ONLY the failed tasks;
  // every other task's consensus stays cached.
  it('re-judges only the forced tasks; untouched tasks reuse cached consensus', async () => {
    clearSemanticValidationCache();
    clearOwnerAtomReceiptsForTest();
    const sceneContent = { beats: [{ id: 'b1', text: 'The three friends form the Dusk Club over champagne.' }] };
    const taskA = task();
    const taskB = task({
      id: 'task:toast',
      contractId: 'event:toast',
      canonicalEventId: 'event:toast',
      evidenceAtoms: [{
        id: 'atom:toast',
        description: 'The group toasts on-page.',
        acceptedPatterns: ['toast'],
        kind: 'semantic',
        verificationAuthority: 'semantic_judge',
        semanticRole: 'relationship_change',
        required: true,
      }],
    });

    const judge = new FakeJudge((claim) => verdict(claim, 'fulfilled', 'form the Dusk Club'));
    await validateSemanticRealizationTasks({
      sceneId: 's1', tasks: [taskA, taskB], sceneContent, mode: 'final_regression', currentStage: 'scene_writer', judge,
    });
    const callsAfterFirst = judge.calls;
    expect(callsAfterFirst).toBeGreaterThan(0);

    // Second pass, forcing fresh samples for taskB only: taskA must be a pure
    // cache hit (no new judge executions beyond taskB's).
    const judgeCallsBefore = judge.calls;
    await validateSemanticRealizationTasks({
      sceneId: 's1', tasks: [taskA, taskB], sceneContent, mode: 'final_regression', currentStage: 'scene_writer', judge,
      forceFreshTaskIds: new Set(['task:toast']),
    });
    // Exactly one batch executes: taskB's single claim. taskA resolved from
    // cache before batching, so it contributes zero pending claims.
    const forcedPassCalls = judge.calls - judgeCallsBefore;
    expect(forcedPassCalls).toBe(1);

    // Third pass with NO forcing: everything cached, zero judge calls.
    const judgeCallsBeforeThird = judge.calls;
    await validateSemanticRealizationTasks({
      sceneId: 's1', tasks: [taskA, taskB], sceneContent, mode: 'final_regression', currentStage: 'scene_writer', judge,
    });
    expect(judge.calls).toBe(judgeCallsBeforeThird);
  });
});
