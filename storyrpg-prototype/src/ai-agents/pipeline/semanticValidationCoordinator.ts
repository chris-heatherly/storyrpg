import type { Story } from '../../types/story';
import type {
  NarrativeEvidenceAtom,
  NarrativeEvidenceExcerpt,
  NarrativeRealizationOwnerStage,
  NarrativeRealizationTask,
} from '../../types/narrativeContract';
import type { ValidatorExecutionRecord } from '../../types/validation';
import type {
  SemanticRealizationClaim,
  SemanticRealizationJudgeFailureKind,
  SemanticRealizationJudgeLike,
  SemanticRealizationJudgeVerdict,
  SemanticRealizationVerdict,
} from '../agents/SemanticRealizationJudge';
import { stableHash } from './artifacts/store';
import { isGateEnabled } from '../remediation/gateDefaults';
import {
  collectNarrativeTaskEvidenceTextGroups,
  evaluateDeterministicRealizationTaskVerdicts,
  realizationTaskFindingFingerprint,
  type RealizationTaskGateFinding,
} from './realizationTaskGate';
import { isSemanticNarrativeAtom } from './realizationVerificationAuthority';
import {
  evaluateTaskSatisfaction,
  semanticAtomsNeededForTask,
  type NarrativeAtomVerdict,
} from './realizationTaskSatisfaction';

type SemanticReceiptVerdict = NonNullable<
  NonNullable<ValidatorExecutionRecord['realizationReceipt']>['semanticVerdicts']
>[number];

type ClaimOutcome = 'pass' | 'content_miss' | 'inconclusive' | 'judge_unavailable';

type JudgeExecutionStatus = 'decided' | SemanticRealizationJudgeFailureKind;

interface ClaimSample {
  verdict: SemanticRealizationJudgeVerdict;
  responseHash: string;
  executionStatus: JudgeExecutionStatus;
}

interface ClaimConsensus {
  claim: SemanticRealizationClaim;
  outcome: ClaimOutcome;
  verdict: SemanticRealizationVerdict;
  verdictRecord: SemanticRealizationJudgeVerdict;
  responseHashes: string[];
  sampleCount: number;
  executionStatus: JudgeExecutionStatus | 'inconclusive';
  samples: ClaimSample[];
}

export interface SemanticValidationResult {
  findings: RealizationTaskGateFinding[];
  receipt: NonNullable<ValidatorExecutionRecord['realizationReceipt']>;
}

const semanticConsensusCache = new Map<string, ClaimConsensus>();
const semanticEvidenceReceiptCache = new Map<string, ClaimConsensus>();

export function clearSemanticValidationCache(): void {
  semanticConsensusCache.clear();
  semanticEvidenceReceiptCache.clear();
}

function outcomeFor(verdict: SemanticRealizationVerdict, atom: NarrativeEvidenceAtom): ClaimOutcome {
  if (verdict === 'uncertain') return 'inconclusive';
  const propositionPresent = verdict === 'fulfilled' || verdict === 'partial';
  if (atom.polarity === 'forbidden') return propositionPresent ? 'content_miss' : 'pass';
  return verdict === 'fulfilled' ? 'pass' : 'content_miss';
}

function outcomeForSample(sample: ClaimSample, atom: NarrativeEvidenceAtom): ClaimOutcome {
  return sample.executionStatus === 'decided'
    ? outcomeFor(sample.verdict.verdict, atom)
    : 'judge_unavailable';
}

function validJudgeVerdict(
  claim: SemanticRealizationClaim,
  verdict: SemanticRealizationJudgeVerdict | undefined,
): SemanticRealizationJudgeVerdict {
  if (!verdict) {
    return { id: claim.id, verdict: 'uncertain', evidenceRefs: [], evidenceQuotes: [], missingCriteria: claim.criteria, rationale: 'Judge returned no verdict.' };
  }
  const excerptById = new Map(claim.excerpts.map((excerpt) => [excerpt.id, excerpt]));
  const refsValid = verdict.evidenceRefs.every((ref) => excerptById.has(ref));
  const evidenceQuotes = verdict.evidenceRefs
    .map((ref) => excerptById.get(ref)?.text.slice(0, 320))
    .filter((quote): quote is string => Boolean(quote));
  if (verdict.verdict === 'fulfilled'
    && (verdict.evidenceRefs.length === 0 || !refsValid)) {
    return {
      ...verdict,
      verdict: 'uncertain',
      evidenceRefs: [],
      evidenceQuotes: [],
      missingCriteria: claim.criteria,
      rationale: 'Fulfilled verdict lacked a valid addressable evidence citation.',
    };
  }
  if (!refsValid) {
    return { ...verdict, evidenceRefs: [], evidenceQuotes: [] };
  }
  return { ...verdict, evidenceQuotes };
}

async function judgeBatch(
  judge: SemanticRealizationJudgeLike,
  claims: SemanticRealizationClaim[],
): Promise<Map<string, ClaimSample>> {
  if (claims.length === 0) return new Map();
  if (claims.length > 3) {
    const merged = new Map<string, ClaimSample>();
    for (let index = 0; index < claims.length; index += 3) {
      for (const [id, sample] of await judgeBatch(judge, claims.slice(index, index + 3))) merged.set(id, sample);
    }
    return merged;
  }
  const result = await judge.execute(claims);
  if (!result.success && claims.length > 1) {
    const merged = new Map<string, ClaimSample>();
    for (const claim of claims) {
      for (const [id, sample] of await judgeBatch(judge, [claim])) merged.set(id, sample);
    }
    return merged;
  }
  const byId = new Map(result.data?.verdicts.map((verdict) => [verdict.id, verdict]) ?? []);
  const responseHash = stableHash(result.rawResponse ?? result.data ?? result.error ?? 'judge-unavailable');
  return new Map(claims.map((claim) => [claim.id, {
    verdict: validJudgeVerdict(claim, result.success ? byId.get(claim.id) : undefined),
    responseHash,
    executionStatus: result.success ? 'decided' : (result.failureKind ?? 'policy_error'),
  }]));
}

function majorityConsensus(
  claim: SemanticRealizationClaim,
  atom: NarrativeEvidenceAtom,
  samples: ClaimSample[],
): ClaimConsensus {
  const outcomes = samples.map((sample) => outcomeForSample(sample, atom));
  const adjudicatedOutcome = outcomes.at(-1);
  if (samples.length >= 3 && (adjudicatedOutcome === 'pass' || adjudicatedOutcome === 'content_miss')) {
    const adjudicated = samples.at(-1)!;
    return {
      claim,
      outcome: adjudicatedOutcome,
      verdict: adjudicated.verdict.verdict,
      verdictRecord: adjudicated.verdict,
      responseHashes: samples.map((sample) => sample.responseHash),
      sampleCount: samples.length,
      executionStatus: 'decided',
      samples,
    };
  }
  if (samples.length >= 3) {
    const adjudicated = samples.at(-1)!;
    return {
      claim,
      outcome: adjudicatedOutcome === 'judge_unavailable' ? 'judge_unavailable' : 'inconclusive',
      verdict: 'uncertain',
      verdictRecord: adjudicated.verdict,
      responseHashes: samples.map((sample) => sample.responseHash),
      sampleCount: samples.length,
      executionStatus: adjudicated.executionStatus === 'decided'
        ? 'inconclusive'
        : adjudicated.executionStatus,
      samples,
    };
  }
  for (const outcome of ['pass', 'content_miss'] as const) {
    if (outcomes.filter((candidate) => candidate === outcome).length < 2) continue;
    const winningIndex = outcomes.findIndex((candidate) => candidate === outcome);
    const winning = samples[winningIndex];
    return {
      claim,
      outcome,
      verdict: winning.verdict.verdict,
      verdictRecord: winning.verdict,
      responseHashes: samples.map((sample) => sample.responseHash),
      sampleCount: samples.length,
      executionStatus: 'decided',
      samples,
    };
  }
  const last = samples.at(-1)?.verdict ?? {
    id: claim.id,
    verdict: 'uncertain' as const,
    evidenceRefs: [],
    evidenceQuotes: [],
    missingCriteria: claim.criteria,
    rationale: 'No stable semantic consensus.',
  };
  return {
    claim,
    outcome: outcomes.some((outcome) => outcome === 'judge_unavailable') ? 'judge_unavailable' : 'inconclusive',
    verdict: 'uncertain',
    verdictRecord: last,
    responseHashes: samples.map((sample) => sample.responseHash),
    sampleCount: samples.length,
    executionStatus: samples.find((sample) => sample.executionStatus !== 'decided')?.executionStatus ?? 'inconclusive',
    samples,
  };
}

function claimSemanticCacheKey(identity: ReturnType<SemanticRealizationJudgeLike['identity']>, claim: SemanticRealizationClaim): string {
  return stableHash({
    identity,
    claim: {
      id: claim.id,
      taskId: claim.taskId,
      atomId: claim.atomId,
      proposition: claim.proposition,
      criteria: claim.criteria,
      polarity: claim.polarity,
      participantIds: claim.participantIds,
      prerequisiteAtomIds: claim.prerequisiteAtomIds,
      semanticRole: claim.semanticRole,
      temporalSlot: claim.temporalSlot,
      stagedLocation: claim.stagedLocation,
      referencedLocations: claim.referencedLocations,
      narrativeVoice: claim.narrativeVoice,
    },
  });
}

function reusableEvidenceConsensus(claim: SemanticRealizationClaim, cached: ClaimConsensus | undefined): ClaimConsensus | undefined {
  if (!cached || cached.outcome !== 'pass' || cached.verdictRecord.evidenceRefs.length === 0) return undefined;
  const currentById = new Map(claim.excerpts.map((excerpt) => [excerpt.id, excerpt]));
  const priorById = new Map(cached.claim.excerpts.map((excerpt) => [excerpt.id, excerpt]));
  const unchanged = cached.verdictRecord.evidenceRefs.every((ref) => {
    const current = currentById.get(ref);
    const prior = priorById.get(ref);
    return Boolean(current && prior && current.textHash === prior.textHash);
  });
  return unchanged ? { ...cached, claim } : undefined;
}

async function evaluateClaims(
  judge: SemanticRealizationJudgeLike,
  claims: SemanticRealizationClaim[],
  atomsByClaimId: Map<string, NarrativeEvidenceAtom>,
): Promise<ClaimConsensus[]> {
  const identity = judge.identity();
  const resolved = new Map<string, ClaimConsensus>();
  const pending: SemanticRealizationClaim[] = [];
  const cacheKeys = new Map<string, string>();
  const evidenceCacheKeys = new Map<string, string>();
  for (const claim of claims) {
    const cacheKey = stableHash({ identity, claim });
    cacheKeys.set(claim.id, cacheKey);
    const evidenceCacheKey = claimSemanticCacheKey(identity, claim);
    evidenceCacheKeys.set(claim.id, evidenceCacheKey);
    const cached = semanticConsensusCache.get(cacheKey);
    const evidenceCached = reusableEvidenceConsensus(claim, semanticEvidenceReceiptCache.get(evidenceCacheKey));
    if (cached) resolved.set(claim.id, cached);
    else if (evidenceCached) resolved.set(claim.id, evidenceCached);
    else pending.push(claim);
  }
  if (pending.length === 0) return claims.map((claim) => resolved.get(claim.id)!);

  const first = await judgeBatch(judge, pending);
  const samples = new Map<string, ClaimSample[]>();
  for (const claim of pending) samples.set(claim.id, [first.get(claim.id)!]);

  const needsSecond = pending.filter((claim) => {
    const atom = atomsByClaimId.get(claim.id)!;
    return outcomeForSample(first.get(claim.id)!, atom) !== 'pass';
  });
  const second = await judgeBatch(judge, needsSecond);
  for (const claim of needsSecond) samples.get(claim.id)!.push(second.get(claim.id)!);

  const needsThird = needsSecond.filter((claim) => {
    const atom = atomsByClaimId.get(claim.id)!;
    const outcomes = samples.get(claim.id)!.map((sample) => outcomeForSample(sample, atom));
    return outcomes.length < 2
      || outcomes[0] !== outcomes[1]
      || outcomes.some((outcome) => outcome === 'inconclusive')
      // Two temperature-zero samples can repeat the same correlated reading.
      // Confirm every negative content verdict with the claim-focused prompt
      // before spending an authored repair attempt.
      || outcomes.every((outcome) => outcome === 'content_miss');
  });
  for (const claim of needsThird) {
    const priorSamples = samples.get(claim.id)!;
    const result = judge.adjudicate
      ? await judge.adjudicate(claim, priorSamples.map((sample) => sample.verdict))
      : await judge.execute([claim]);
    const byId = new Map(result.data?.verdicts.map((verdict) => [verdict.id, verdict]) ?? []);
    samples.get(claim.id)!.push({
      verdict: validJudgeVerdict(claim, result.success ? byId.get(claim.id) : undefined),
      responseHash: stableHash(result.rawResponse ?? result.data ?? result.error ?? 'judge-unavailable'),
      executionStatus: result.success ? 'decided' : (result.failureKind ?? 'policy_error'),
    });
  }

  for (const claim of pending) {
    const atom = atomsByClaimId.get(claim.id)!;
    const claimSamples = samples.get(claim.id)!;
    const consensus = claimSamples.length === 1
      ? {
          claim,
          outcome: outcomeForSample(claimSamples[0], atom),
          verdict: claimSamples[0].verdict.verdict,
          verdictRecord: claimSamples[0].verdict,
          responseHashes: [claimSamples[0].responseHash],
          sampleCount: 1,
          executionStatus: claimSamples[0].executionStatus,
          samples: claimSamples,
        } satisfies ClaimConsensus
      : majorityConsensus(claim, atom, claimSamples);
    if (consensus.outcome === 'pass'
      || consensus.outcome === 'content_miss'
      || consensus.outcome === 'inconclusive'
      || consensus.outcome === 'judge_unavailable') {
      semanticConsensusCache.set(cacheKeys.get(claim.id)!, consensus);
      // Evidence-receipt reuse stays pass-only (reusableEvidenceConsensus); infra
      // outcomes are cached by full claim identity so snapshot replay stays stable.
      if (consensus.outcome === 'pass' || consensus.outcome === 'content_miss') {
        semanticEvidenceReceiptCache.set(evidenceCacheKeys.get(claim.id)!, consensus);
      }
    }
    resolved.set(claim.id, consensus);
  }
  return claims.map((claim) => resolved.get(claim.id)!);
}

function targetRouteKey(task: NarrativeRealizationTask, groupIndex: number): string | undefined {
  if (task.target.scope === 'route_path' || task.target.scope === 'route_terminal') return task.target.outcomeTier;
  if (task.target.scope === 'any_route') return task.target.outcomeTiers[groupIndex];
  return undefined;
}

function buildTaskClaims(input: {
  sceneId: string;
  task: NarrativeRealizationTask;
  sceneContent?: unknown;
  choiceSet?: unknown;
  encounter?: unknown;
}): Array<{ claim: SemanticRealizationClaim; atom: NarrativeEvidenceAtom; groupKey: string }> {
  const groups = collectNarrativeTaskEvidenceTextGroups(input);
  const effectiveGroups = groups.length > 0
    ? groups
    : [{ groupKey: `${input.task.target.scope}:1`, texts: [], entries: [] }];
  return effectiveGroups.flatMap((group, groupIndex) => {
    const routeKey = targetRouteKey(input.task, groupIndex);
    const occurrenceByText = new Map<string, number>();
    const excerpts: NarrativeEvidenceExcerpt[] = group.entries.flatMap((entry) => {
      const spans = entry.text
        .split(/(?<=[.!?])\s+/)
        .map((text) => text.trim())
        .filter(Boolean)
        .flatMap((text) => text.length <= 1200
          ? [text]
          : Array.from({ length: Math.ceil(text.length / 1200) }, (_, index) => text.slice(index * 1200, (index + 1) * 1200)));
      return spans.map((text) => {
        const textHash = stableHash(text);
        const occurrenceKey = `${entry.surface}:${textHash}`;
        const occurrence = (occurrenceByText.get(occurrenceKey) ?? 0) + 1;
        occurrenceByText.set(occurrenceKey, occurrence);
        return {
          id: `${input.task.id}:${group.groupKey}:${entry.surface}:${textHash.slice(0, 16)}:${occurrence}`,
          taskId: input.task.id,
          sceneId: input.sceneId,
          ownerStage: input.task.ownerStage,
          surface: entry.surface,
          groupKey: group.groupKey,
          routeKey,
          outcomeTier: routeKey,
          text,
          textHash,
        };
      });
    });
    return input.task.evidenceAtoms.filter(isSemanticNarrativeAtom).map((atom) => ({
      groupKey: group.groupKey,
      atom,
      claim: {
        id: `${input.task.id}::${atom.id}::${group.groupKey}`,
        taskId: input.task.id,
        atomId: atom.id,
        proposition: atom.description,
        // Atom descriptions are projected from canonical semantic propositions.
        // Treat them as the sole judge criterion so legacy checkpoint criteria
        // cannot strengthen or otherwise drift from the authored proposition.
        criteria: [atom.description],
        polarity: atom.polarity === 'forbidden' ? 'forbidden' : 'required',
        participantIds: [...(atom.participantIds ?? atom.subjectIds ?? [])],
        prerequisiteAtomIds: [...(atom.prerequisiteAtomIds ?? [])],
        semanticRole: atom.semanticRole,
        temporalSlot: atom.temporalSlot,
        stagedLocation: atom.stagedLocation,
        referencedLocations: [...(atom.referencedLocations ?? [])],
        narrativeVoice: 'second_person',
        excerpts,
      },
    }));
  });
}

function receiptDisposition(consensus: ClaimConsensus): SemanticReceiptVerdict['disposition'] {
  if (consensus.outcome === 'inconclusive' || consensus.outcome === 'judge_unavailable') return 'inconclusive';
  if (consensus.verdict === 'partial') return 'partial';
  return consensus.verdict === 'fulfilled' ? 'confirmed' : 'refuted';
}

/**
 * Owner-receipt continuity (W3.2, first live proof run 2026-07-16T03-12-37).
 *
 * The owner stage judged "Kylie is rescued by a handsome stranger" FULFILLED
 * with eleven evidence refs; minutes later the final regression judged the
 * SAME prose missing and killed the run — because assembly injects extra
 * reader-facing strings into the encounter, the final excerpt set differs,
 * the consensus cache misses, and a fresh judge call re-rolls a verdict the
 * owner already confirmed.
 *
 * A positive atom the owner judge confirmed against excerpt set E stays
 * confirmed at final regression when E is a SUBSET of the final excerpts:
 * added text cannot un-fulfill a positive meaning. Forbidden atoms are never
 * honored (added text CAN introduce a forbidden meaning). In-process only —
 * every resume re-runs owner validation at rehydration before the final
 * contract, so the registry is warm exactly when it matters; an empty
 * registry degrades to judging as before.
 */
const ownerFulfilledAtomReceipts = new Map<string, Array<Set<string>>>();
const OWNER_RECEIPT_CAP = 5000;

function ownerReceiptKey(taskId: string, atomId: string): string {
  return `${taskId}::${atomId}`;
}

function recordOwnerFulfilledAtomReceipt(taskId: string, atomId: string, excerptTextHashes: string[]): void {
  if (ownerFulfilledAtomReceipts.size >= OWNER_RECEIPT_CAP) return;
  const key = ownerReceiptKey(taskId, atomId);
  const receipts = ownerFulfilledAtomReceipts.get(key) ?? [];
  receipts.push(new Set(excerptTextHashes));
  ownerFulfilledAtomReceipts.set(key, receipts);
}

function hasFulfilledOwnerReceipt(taskId: string, atomId: string, finalExcerptTextHashes: Set<string>): boolean {
  const receipts = ownerFulfilledAtomReceipts.get(ownerReceiptKey(taskId, atomId)) ?? [];
  return receipts.some((ownerHashes) => {
    if (ownerHashes.size === 0) return false;
    for (const hash of ownerHashes) {
      if (!finalExcerptTextHashes.has(hash)) return false;
    }
    return true;
  });
}

/** Test hook: receipts are process-scoped state. */
export function clearOwnerAtomReceiptsForTest(): void {
  ownerFulfilledAtomReceipts.clear();
}

export async function validateSemanticRealizationTasks(input: {
  sceneId: string;
  tasks?: NarrativeRealizationTask[];
  sceneContent?: unknown;
  choiceSet?: unknown;
  encounter?: unknown;
  mode?: 'owner' | 'final_regression';
  currentStage?: NarrativeRealizationOwnerStage;
  candidateHash?: string;
  judge: SemanticRealizationJudgeLike;
}): Promise<SemanticValidationResult> {
  const tasks = (input.tasks ?? []).filter((task) =>
    (input.mode ?? 'owner') !== 'owner' || !input.currentStage || task.ownerStage === input.currentStage,
  );
  const deterministicVerdicts = evaluateDeterministicRealizationTaskVerdicts(input);
  const built = tasks.flatMap((task) => buildTaskClaims({ ...input, task }))
    .filter((item) => {
      const task = tasks.find((candidate) => candidate.id === item.claim.taskId);
      if (!task) return false;
      return semanticAtomsNeededForTask(task, item.groupKey, deterministicVerdicts).has(item.atom.id);
    });
  const atomsByClaimId = new Map(built.map(({ claim, atom }) => [claim.id, atom]));
  // W3.2 receipt continuity: at final regression, positive atoms the owner
  // judge confirmed against a SUBSET of these excerpts are honored, not
  // re-judged. Forbidden atoms always re-judge (added text can introduce a
  // forbidden meaning; it cannot un-fulfill a positive one).
  const honorReceipts = input.mode === 'final_regression' && isGateEnabled('GATE_SEMANTIC_RECEIPT_CONTINUITY');
  const honored: Array<{ taskId: string; atomId: string; groupKey: string }> = [];
  let toJudge = built;
  if (honorReceipts) {
    toJudge = [];
    for (const item of built) {
      const finalHashes = new Set(item.claim.excerpts.map((excerpt) => excerpt.textHash));
      if (item.atom.polarity !== 'forbidden' && hasFulfilledOwnerReceipt(item.claim.taskId, item.atom.id, finalHashes)) {
        honored.push({
          taskId: item.claim.taskId,
          atomId: item.atom.id,
          groupKey: item.claim.id.split('::').at(-1) ?? 'owner:1',
        });
      } else {
        toJudge.push(item);
      }
    }
    if (honored.length > 0) {
      console.info(`[SemanticValidation] Honoring ${honored.length} owner-stage receipt(s) at final regression for ${input.sceneId} (owner excerpts ⊆ final excerpts).`);
    }
  }
  const consensus = await evaluateClaims(input.judge, toJudge.map(({ claim }) => claim), atomsByClaimId);
  if ((input.mode ?? 'owner') === 'owner') {
    for (const item of consensus) {
      if (item.outcome !== 'pass') continue;
      const atom = atomsByClaimId.get(item.claim.id);
      if (!atom || atom.polarity === 'forbidden') continue;
      recordOwnerFulfilledAtomReceipt(
        item.claim.taskId,
        item.claim.atomId,
        item.claim.excerpts.map((excerpt) => excerpt.textHash),
      );
    }
  }
  const semanticVerdictsByTaskAndGroup = new Map<string, NarrativeAtomVerdict[]>();
  for (const entry of honored) {
    const key = `${entry.taskId}::${entry.groupKey}`;
    semanticVerdictsByTaskAndGroup.set(key, [...(semanticVerdictsByTaskAndGroup.get(key) ?? []), {
      taskId: entry.taskId,
      atomId: entry.atomId,
      groupKey: entry.groupKey,
      authority: 'semantic_judge',
      outcome: 'pass',
    }]);
  }
  for (const item of consensus) {
    const groupKey = item.claim.id.split('::').at(-1) ?? 'owner:1';
    const key = `${item.claim.taskId}::${groupKey}`;
    const outcome: NarrativeAtomVerdict['outcome'] = item.outcome === 'pass'
      ? 'pass'
      : item.outcome === 'content_miss'
        ? 'miss'
        : item.outcome === 'judge_unavailable'
          ? 'unavailable'
          : 'inconclusive';
    semanticVerdictsByTaskAndGroup.set(key, [...(semanticVerdictsByTaskAndGroup.get(key) ?? []), {
      taskId: item.claim.taskId,
      atomId: item.claim.atomId,
      groupKey,
      authority: 'semantic_judge',
      outcome,
    }]);
  }

  const findings: RealizationTaskGateFinding[] = [];
  const taskEvaluations: NonNullable<ValidatorExecutionRecord['realizationReceipt']>['taskEvaluations'] = [];
  for (const task of tasks) {
    const collectedGroupKeys = collectNarrativeTaskEvidenceTextGroups({ ...input, task }).map((group) => group.groupKey);
    const groupKeys = collectedGroupKeys.length > 0 ? collectedGroupKeys : [`${task.target.scope}:1`];
    const groups = groupKeys.map((groupKey) => {
      const verdicts = [
        ...deterministicVerdicts.filter((verdict) => verdict.taskId === task.id && verdict.groupKey === groupKey),
        ...(semanticVerdictsByTaskAndGroup.get(`${task.id}::${groupKey}`) ?? []),
      ];
      return { groupKey, verdicts, satisfaction: evaluateTaskSatisfaction(task, verdicts) };
    });
    taskEvaluations.push(...groups.map((group) => ({ taskId: task.id, groupKey: group.groupKey, ...group.satisfaction })));
    const relevantGroups = task.target.scope === 'any_route' && groups.some((group) => group.satisfaction.status === 'satisfied')
      ? groups.filter((group) => group.satisfaction.status === 'satisfied')
      : groups;
    const inconclusive = [...new Set(relevantGroups.flatMap((group) => group.satisfaction.inconclusiveAtomIds))];
    const unavailable = [...new Set(relevantGroups.flatMap((group) => group.satisfaction.unavailableAtomIds))];
    if (unavailable.length > 0) {
      findings.push({
        code: 'SEMANTIC_VALIDATION_UNAVAILABLE', taskId: task.id, contractId: task.contractId,
        sceneId: input.sceneId, ownerStage: task.ownerStage, blocking: true,
        field: task.artifactPath ?? 'scene',
        message: `Semantic validation infrastructure was unavailable for ${unavailable.join(', ')}.`,
        missingEvidenceAtoms: unavailable,
        fingerprint: realizationTaskFindingFingerprint({ code: 'SEMANTIC_VALIDATION_UNAVAILABLE', taskId: task.id, sceneId: input.sceneId, evidenceAtomIds: unavailable }),
      });
      continue;
    }
    if (inconclusive.length > 0) {
      findings.push({
        code: 'SEMANTIC_VALIDATION_INCONCLUSIVE', taskId: task.id, contractId: task.contractId,
        sceneId: input.sceneId, ownerStage: task.ownerStage, blocking: true,
        field: task.artifactPath ?? 'scene',
        message: `Semantic validation could not reach a stable evidence-backed verdict for ${inconclusive.join(', ')}.`,
        missingEvidenceAtoms: inconclusive,
        fingerprint: realizationTaskFindingFingerprint({ code: 'SEMANTIC_VALIDATION_INCONCLUSIVE', taskId: task.id, sceneId: input.sceneId, evidenceAtomIds: inconclusive }),
      });
      continue;
    }
    const bestGroup = [...groups].sort((left, right) => left.satisfaction.missingAtomIds.length - right.satisfaction.missingAtomIds.length)[0];
    const missing = task.target.scope === 'any_route'
      ? (groups.some((group) => group.satisfaction.status === 'satisfied') ? [] : bestGroup?.satisfaction.missingAtomIds ?? [])
      : task.target.scope === 'all_options' || task.target.scope === 'all_choice_outcomes'
        ? [...new Set(groups.flatMap((group) => group.satisfaction.missingAtomIds))]
        : bestGroup?.satisfaction.missingAtomIds ?? [];
    const forbidden = missing.filter((atomId) => task.evidenceAtoms.find((atom) => atom.id === atomId)?.polarity === 'forbidden');
    const positiveMissing = missing.filter((atomId) => !forbidden.includes(atomId));
    if (positiveMissing.length > 0) {
      const semanticFailure = positiveMissing.some((atomId) => task.evidenceAtoms.find((atom) => atom.id === atomId)?.verificationAuthority === 'semantic_judge');
      findings.push({
        code: semanticFailure ? 'SEMANTIC_REALIZATION_MISSING' : 'OWNER_REALIZATION_MISSING', taskId: task.id, contractId: task.contractId,
        sceneId: input.sceneId, ownerStage: task.ownerStage, blocking: task.blocking,
        field: task.artifactPath ?? 'scene',
        message: `Canonical realization validation confirms that task ${task.id} is missing: ${positiveMissing.join(', ')}.`,
        missingEvidenceAtoms: positiveMissing,
        fingerprint: realizationTaskFindingFingerprint({ code: semanticFailure ? 'SEMANTIC_REALIZATION_MISSING' : 'OWNER_REALIZATION_MISSING', taskId: task.id, sceneId: input.sceneId, evidenceAtomIds: positiveMissing }),
      });
    }
    if (forbidden.length > 0) {
      const semanticFailure = forbidden.some((atomId) => task.evidenceAtoms.find((atom) => atom.id === atomId)?.verificationAuthority === 'semantic_judge');
      findings.push({
        code: semanticFailure ? 'SEMANTIC_FORBIDDEN_EVIDENCE_PRESENT' : 'OWNER_FORBIDDEN_EVIDENCE_PRESENT', taskId: task.id, contractId: task.contractId,
        sceneId: input.sceneId, ownerStage: task.ownerStage, blocking: task.blocking,
        field: task.artifactPath ?? 'scene',
        message: `Canonical realization validation confirms forbidden evidence for task ${task.id}: ${forbidden.join(', ')}.`,
        matchedForbiddenAtoms: forbidden,
        fingerprint: realizationTaskFindingFingerprint({ code: semanticFailure ? 'SEMANTIC_FORBIDDEN_EVIDENCE_PRESENT' : 'OWNER_FORBIDDEN_EVIDENCE_PRESENT', taskId: task.id, sceneId: input.sceneId, evidenceAtomIds: forbidden }),
      });
    }
  }

  const identity = input.judge.identity();
  const semanticVerdicts: SemanticReceiptVerdict[] = consensus.map((item) => ({
    taskId: item.claim.taskId,
    atomId: item.claim.atomId,
    groupKey: item.claim.id.split('::').at(-1) ?? 'owner:1',
    disposition: receiptDisposition(item),
    verdict: item.verdict,
    evidenceRefs: item.verdictRecord.evidenceRefs,
    evidenceQuotes: item.verdictRecord.evidenceQuotes,
    missingCriteria: item.verdictRecord.missingCriteria,
    judgePolicyVersion: identity.policyVersion,
    judgeProvider: identity.provider,
    judgeModel: identity.model,
    judgeResponseHash: stableHash(item.responseHashes),
    sampleCount: item.sampleCount,
    executionStatus: item.executionStatus,
    samples: item.samples.map((sample) => ({
      verdict: sample.verdict.verdict,
      evidenceRefs: sample.verdict.evidenceRefs,
      evidenceQuotes: sample.verdict.evidenceQuotes,
      missingCriteria: sample.verdict.missingCriteria,
      responseHash: sample.responseHash,
      executionStatus: sample.executionStatus,
    })),
    evidenceHashes: item.verdictRecord.evidenceRefs.map((ref) => item.claim.excerpts.find((excerpt) => excerpt.id === ref)?.textHash).filter((hash): hash is string => Boolean(hash)),
  }));
  return {
    findings,
    receipt: {
      sceneId: input.sceneId,
      ownerStage: input.currentStage ?? tasks[0]?.ownerStage ?? 'scene_writer',
      candidateHash: input.candidateHash ?? stableHash({
        sceneContent: input.sceneContent,
        choiceSet: input.choiceSet,
        encounter: input.encounter,
      }),
      taskIds: tasks.map((task) => task.id).sort(),
      findingFingerprints: findings.map((finding) => finding.fingerprint).sort(),
      atomVerdicts: [...deterministicVerdicts, ...[...semanticVerdictsByTaskAndGroup.values()].flat()],
      taskEvaluations,
      semanticVerdicts,
    },
  };
}

export async function validateStorySemanticRealization(input: {
  story: Story;
  tasks?: NarrativeRealizationTask[];
  judge: SemanticRealizationJudgeLike;
}): Promise<SemanticValidationResult[]> {
  const results: SemanticValidationResult[] = [];
  for (const episode of input.story.episodes ?? []) {
    for (const scene of episode.scenes ?? []) {
      for (const ownerStage of ['scene_writer', 'choice_author', 'encounter_architect'] as const) {
        const tasks = (input.tasks ?? []).filter((task) => task.sceneId === scene.id && task.ownerStage === ownerStage);
        if (!tasks.some((task) => task.evidenceAtoms.some(isSemanticNarrativeAtom))) continue;
        results.push(await validateSemanticRealizationTasks({
          sceneId: scene.id,
          tasks,
          sceneContent: scene,
          encounter: scene.encounter,
          mode: 'final_regression',
          currentStage: ownerStage,
          candidateHash: stableHash(ownerStage === 'encounter_architect' ? scene.encounter : scene),
          judge: input.judge,
        }));
      }
    }
  }
  return results;
}
