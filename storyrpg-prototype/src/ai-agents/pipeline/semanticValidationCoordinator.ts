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
import {
  collectNarrativeTaskEvidenceTextGroups,
  realizationTaskFindingFingerprint,
  type RealizationTaskGateFinding,
} from './realizationTaskGate';
import { isSemanticNarrativeAtom } from './realizationVerificationAuthority';

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
      || outcomes.some((outcome) => outcome === 'inconclusive');
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
    if (consensus.outcome === 'pass' || consensus.outcome === 'content_miss') {
      semanticConsensusCache.set(cacheKeys.get(claim.id)!, consensus);
      semanticEvidenceReceiptCache.set(evidenceCacheKeys.get(claim.id)!, consensus);
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
        criteria: atom.semanticCriteria?.length ? [...atom.semanticCriteria] : [atom.description],
        polarity: atom.polarity === 'forbidden' ? 'forbidden' : 'required',
        participantIds: [...(atom.participantIds ?? atom.subjectIds ?? [])],
        prerequisiteAtomIds: [...(atom.prerequisiteAtomIds ?? [])],
        semanticRole: atom.semanticRole,
        temporalSlot: atom.temporalSlot,
        stagedLocation: atom.stagedLocation,
        referencedLocations: [...(atom.referencedLocations ?? [])],
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

function semanticGroupFailure(
  task: NarrativeRealizationTask,
  groupConsensus: ClaimConsensus[],
): { missing: string[]; forbidden: string[]; inconclusive: string[]; unavailable: string[] } {
  const byAtomId = new Map(groupConsensus.map((consensus) => [consensus.claim.atomId, consensus]));
  const semanticAtoms = task.evidenceAtoms.filter(isSemanticNarrativeAtom);
  const positive = semanticAtoms.filter((atom) => atom.polarity !== 'forbidden');
  const forbidden = semanticAtoms.filter((atom) => atom.polarity === 'forbidden');
  const aggregate = (
    atoms: NarrativeEvidenceAtom[],
    requirement: 'all' | 'any' | 'minimum',
    minimumEvidenceHits?: number,
  ) => {
    const needed = requirement === 'any'
      ? 1
      : requirement === 'minimum'
        ? Math.max(1, minimumEvidenceHits ?? 1)
        : atoms.length;
    const passed = atoms.filter((atom) => byAtomId.get(atom.id)?.outcome === 'pass');
    const inconclusiveAtoms = atoms.filter((atom) => byAtomId.get(atom.id)?.outcome === 'inconclusive');
    const unavailableAtoms = atoms.filter((atom) => byAtomId.get(atom.id)?.outcome === 'judge_unavailable');
    const misses = atoms.filter((atom) => byAtomId.get(atom.id)?.outcome === 'content_miss');
    if (passed.length >= needed) return { missing: [], inconclusive: [], unavailable: [] };
    if (passed.length + inconclusiveAtoms.length + unavailableAtoms.length < needed) {
      return { missing: misses.map((atom) => atom.id), inconclusive: [], unavailable: [] };
    }
    return {
      missing: [],
      inconclusive: inconclusiveAtoms.map((atom) => atom.id),
      unavailable: unavailableAtoms.map((atom) => atom.id),
    };
  };
  const requiredPositive = task.minimumEvidenceHits != null
    ? positive
    : positive.filter((atom) => atom.required);
  const base = aggregate(
    requiredPositive,
    task.minimumEvidenceHits != null ? 'minimum' : 'all',
    task.minimumEvidenceHits,
  );
  const missing = [...base.missing];
  const inconclusive = [...base.inconclusive];
  const unavailable = [...base.unavailable];
  for (const group of task.evidenceGroups ?? []) {
    const atoms = group.atomIds
      .map((atomId) => semanticAtoms.find((atom) => atom.id === atomId))
      .filter((atom): atom is NarrativeEvidenceAtom => Boolean(atom && atom.polarity !== 'forbidden'));
    if (atoms.length === 0) continue;
    const result = aggregate(atoms, group.requirement, group.minimumEvidenceHits);
    missing.push(...result.missing);
    inconclusive.push(...result.inconclusive);
    unavailable.push(...result.unavailable);
  }
  const stableFailure = missing.length > 0
    || forbidden.some((atom) => byAtomId.get(atom.id)?.outcome === 'content_miss');
  return {
    missing: [...new Set(missing)],
    forbidden: forbidden.filter((atom) => byAtomId.get(atom.id)?.outcome === 'content_miss').map((atom) => atom.id),
    inconclusive: stableFailure ? [] : [...new Set([
      ...inconclusive,
      ...forbidden.filter((atom) => byAtomId.get(atom.id)?.outcome === 'inconclusive').map((atom) => atom.id),
    ])],
    unavailable: stableFailure ? [] : [...new Set([
      ...unavailable,
      ...forbidden.filter((atom) => byAtomId.get(atom.id)?.outcome === 'judge_unavailable').map((atom) => atom.id),
    ])],
  };
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
    task.evidenceAtoms.some(isSemanticNarrativeAtom)
    && ((input.mode ?? 'owner') !== 'owner' || !input.currentStage || task.ownerStage === input.currentStage),
  );
  const built = tasks.flatMap((task) => buildTaskClaims({ ...input, task }));
  const atomsByClaimId = new Map(built.map(({ claim, atom }) => [claim.id, atom]));
  const consensus = await evaluateClaims(input.judge, built.map(({ claim }) => claim), atomsByClaimId);
  const consensusByTaskAndGroup = new Map<string, ClaimConsensus[]>();
  for (const item of consensus) {
    const key = `${item.claim.taskId}::${item.claim.id.split('::').at(-1)}`;
    consensusByTaskAndGroup.set(key, [...(consensusByTaskAndGroup.get(key) ?? []), item]);
  }

  const findings: RealizationTaskGateFinding[] = [];
  for (const task of tasks) {
    const groups = [...consensusByTaskAndGroup.entries()]
      .filter(([key]) => key.startsWith(`${task.id}::`))
      .map(([key, values]) => ({ groupKey: key.slice(task.id.length + 2), values, failure: semanticGroupFailure(task, values) }));
    const inconclusive = [...new Set(groups.flatMap((group) => group.failure.inconclusive))];
    const unavailable = [...new Set(groups.flatMap((group) => group.failure.unavailable))];
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
    const bestGroup = [...groups].sort((left, right) => left.failure.missing.length - right.failure.missing.length)[0];
    const missing = task.target.scope === 'any_route'
      ? (groups.some((group) => group.failure.missing.length === 0) ? [] : bestGroup?.failure.missing ?? [])
      : task.target.scope === 'all_options' || task.target.scope === 'all_choice_outcomes'
        ? [...new Set(groups.flatMap((group) => group.failure.missing))]
        : bestGroup?.failure.missing ?? [];
    const forbidden = [...new Set(groups.flatMap((group) => group.failure.forbidden))];
    if (missing.length > 0) {
      findings.push({
        code: 'SEMANTIC_REALIZATION_MISSING', taskId: task.id, contractId: task.contractId,
        sceneId: input.sceneId, ownerStage: task.ownerStage, blocking: task.blocking,
        field: task.artifactPath ?? 'scene',
        message: `Meaning-aware validation confirms that task ${task.id} is missing: ${missing.join(', ')}.`,
        missingEvidenceAtoms: missing,
        fingerprint: realizationTaskFindingFingerprint({ code: 'SEMANTIC_REALIZATION_MISSING', taskId: task.id, sceneId: input.sceneId, evidenceAtomIds: missing }),
      });
    }
    if (forbidden.length > 0) {
      findings.push({
        code: 'SEMANTIC_FORBIDDEN_EVIDENCE_PRESENT', taskId: task.id, contractId: task.contractId,
        sceneId: input.sceneId, ownerStage: task.ownerStage, blocking: task.blocking,
        field: task.artifactPath ?? 'scene',
        message: `Meaning-aware validation confirms forbidden evidence for task ${task.id}: ${forbidden.join(', ')}.`,
        matchedForbiddenAtoms: forbidden,
        fingerprint: realizationTaskFindingFingerprint({ code: 'SEMANTIC_FORBIDDEN_EVIDENCE_PRESENT', taskId: task.id, sceneId: input.sceneId, evidenceAtomIds: forbidden }),
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
