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

type ClaimOutcome = 'pass' | 'content_miss' | 'inconclusive';

interface ClaimConsensus {
  claim: SemanticRealizationClaim;
  outcome: ClaimOutcome;
  verdict: SemanticRealizationVerdict;
  verdictRecord: SemanticRealizationJudgeVerdict;
  responseHashes: string[];
  sampleCount: number;
}

export interface SemanticValidationResult {
  findings: RealizationTaskGateFinding[];
  receipt: NonNullable<ValidatorExecutionRecord['realizationReceipt']>;
}

const semanticConsensusCache = new Map<string, ClaimConsensus>();

export function clearSemanticValidationCache(): void {
  semanticConsensusCache.clear();
}

function outcomeFor(verdict: SemanticRealizationVerdict, atom: NarrativeEvidenceAtom): ClaimOutcome {
  if (verdict === 'uncertain') return 'inconclusive';
  const propositionPresent = verdict === 'fulfilled' || verdict === 'partial';
  if (atom.polarity === 'forbidden') return propositionPresent ? 'content_miss' : 'pass';
  return verdict === 'fulfilled' ? 'pass' : 'content_miss';
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
  const quotesValid = verdict.evidenceQuotes.every((quote) =>
    verdict.evidenceRefs.some((ref) => excerptById.get(ref)?.text.includes(quote)),
  );
  if (verdict.verdict === 'fulfilled'
    && (verdict.evidenceRefs.length === 0 || verdict.evidenceQuotes.length === 0 || !refsValid || !quotesValid)) {
    return {
      ...verdict,
      verdict: 'uncertain',
      missingCriteria: claim.criteria,
      rationale: 'Fulfilled verdict lacked a valid exact evidence quote.',
    };
  }
  if (!refsValid || !quotesValid) {
    return { ...verdict, evidenceRefs: [], evidenceQuotes: [] };
  }
  return verdict;
}

async function judgeBatch(
  judge: SemanticRealizationJudgeLike,
  claims: SemanticRealizationClaim[],
): Promise<Map<string, { verdict: SemanticRealizationJudgeVerdict; responseHash: string }>> {
  if (claims.length === 0) return new Map();
  const result = await judge.execute(claims);
  const byId = new Map(result.data?.verdicts.map((verdict) => [verdict.id, verdict]) ?? []);
  const responseHash = stableHash(result.rawResponse ?? result.data ?? result.error ?? 'judge-unavailable');
  return new Map(claims.map((claim) => [claim.id, {
    verdict: validJudgeVerdict(claim, result.success ? byId.get(claim.id) : undefined),
    responseHash,
  }]));
}

function majorityConsensus(
  claim: SemanticRealizationClaim,
  atom: NarrativeEvidenceAtom,
  samples: Array<{ verdict: SemanticRealizationJudgeVerdict; responseHash: string }>,
): ClaimConsensus {
  const outcomes = samples.map((sample) => outcomeFor(sample.verdict.verdict, atom));
  for (const outcome of ['pass', 'content_miss', 'inconclusive'] as const) {
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
    outcome: 'inconclusive',
    verdict: 'uncertain',
    verdictRecord: last,
    responseHashes: samples.map((sample) => sample.responseHash),
    sampleCount: samples.length,
  };
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
  for (const claim of claims) {
    const cacheKey = stableHash({ identity, claim });
    cacheKeys.set(claim.id, cacheKey);
    const cached = semanticConsensusCache.get(cacheKey);
    if (cached) resolved.set(claim.id, cached);
    else pending.push(claim);
  }
  if (pending.length === 0) return claims.map((claim) => resolved.get(claim.id)!);

  const first = await judgeBatch(judge, pending);
  const samples = new Map<string, Array<{ verdict: SemanticRealizationJudgeVerdict; responseHash: string }>>();
  for (const claim of pending) samples.set(claim.id, [first.get(claim.id)!]);

  const needsSecond = pending.filter((claim) => {
    const atom = atomsByClaimId.get(claim.id)!;
    return outcomeFor(first.get(claim.id)!.verdict.verdict, atom) !== 'pass';
  });
  const second = await judgeBatch(judge, needsSecond);
  for (const claim of needsSecond) samples.get(claim.id)!.push(second.get(claim.id)!);

  const needsThird = needsSecond.filter((claim) => {
    const atom = atomsByClaimId.get(claim.id)!;
    const outcomes = samples.get(claim.id)!.map((sample) => outcomeFor(sample.verdict.verdict, atom));
    return outcomes.length < 2 || outcomes[0] !== outcomes[1];
  });
  const third = await judgeBatch(judge, needsThird);
  for (const claim of needsThird) samples.get(claim.id)!.push(third.get(claim.id)!);

  for (const claim of pending) {
    const atom = atomsByClaimId.get(claim.id)!;
    const claimSamples = samples.get(claim.id)!;
    const consensus = claimSamples.length === 1
      ? {
          claim,
          outcome: outcomeFor(claimSamples[0].verdict.verdict, atom),
          verdict: claimSamples[0].verdict.verdict,
          verdictRecord: claimSamples[0].verdict,
          responseHashes: [claimSamples[0].responseHash],
          sampleCount: 1,
        } satisfies ClaimConsensus
      : majorityConsensus(claim, atom, claimSamples);
    semanticConsensusCache.set(cacheKeys.get(claim.id)!, consensus);
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
    const excerpts: NarrativeEvidenceExcerpt[] = group.entries.map((entry, excerptIndex) => ({
      id: `${input.task.id}:${group.groupKey}:excerpt:${excerptIndex + 1}`,
      taskId: input.task.id,
      sceneId: input.sceneId,
      ownerStage: input.task.ownerStage,
      surface: entry.surface,
      groupKey: group.groupKey,
      routeKey,
      outcomeTier: routeKey,
      text: entry.text.slice(0, 6000),
      textHash: stableHash(entry.text),
    }));
    return input.task.evidenceAtoms.filter(isSemanticNarrativeAtom).map((atom) => ({
      groupKey: group.groupKey,
      atom,
      claim: {
        id: `${input.task.id}::${atom.id}::${group.groupKey}`,
        taskId: input.task.id,
        atomId: atom.id,
        proposition: atom.description,
        criteria: atom.semanticCriteria?.length
          ? [...atom.semanticCriteria]
          : [...new Set([atom.sourceText, ...atom.acceptedPatterns].filter((value): value is string => Boolean(value)))],
        polarity: atom.polarity === 'forbidden' ? 'forbidden' : 'required',
        participantIds: [...(atom.participantIds ?? atom.subjectIds ?? [])],
        prerequisiteAtomIds: [...(atom.prerequisiteAtomIds ?? [])],
        excerpts,
      },
    }));
  });
}

function receiptDisposition(consensus: ClaimConsensus): SemanticReceiptVerdict['disposition'] {
  if (consensus.outcome === 'inconclusive') return 'inconclusive';
  if (consensus.verdict === 'partial') return 'partial';
  return consensus.verdict === 'fulfilled' ? 'confirmed' : 'refuted';
}

function semanticGroupFailure(
  task: NarrativeRealizationTask,
  groupConsensus: ClaimConsensus[],
): { missing: string[]; forbidden: string[]; inconclusive: string[] } {
  const byAtomId = new Map(groupConsensus.map((consensus) => [consensus.claim.atomId, consensus]));
  const semanticAtoms = task.evidenceAtoms.filter(isSemanticNarrativeAtom);
  const positive = semanticAtoms.filter((atom) => atom.polarity !== 'forbidden');
  const forbidden = semanticAtoms.filter((atom) => atom.polarity === 'forbidden');
  const inconclusive = semanticAtoms
    .filter((atom) => byAtomId.get(atom.id)?.outcome === 'inconclusive')
    .map((atom) => atom.id);
  const passedPositive = new Set(positive
    .filter((atom) => byAtomId.get(atom.id)?.outcome === 'pass')
    .map((atom) => atom.id));
  const missing = task.minimumEvidenceHits != null
    ? (passedPositive.size >= task.minimumEvidenceHits ? [] : positive.filter((atom) => !passedPositive.has(atom.id)).map((atom) => atom.id))
    : positive.filter((atom) => atom.required && byAtomId.get(atom.id)?.outcome === 'content_miss').map((atom) => atom.id);
  for (const group of task.evidenceGroups ?? []) {
    const atoms = group.atomIds
      .map((atomId) => semanticAtoms.find((atom) => atom.id === atomId))
      .filter((atom): atom is NarrativeEvidenceAtom => Boolean(atom && atom.polarity !== 'forbidden'));
    if (atoms.length === 0) continue;
    const passed = atoms.filter((atom) => passedPositive.has(atom.id));
    const needed = group.minimumEvidenceHits ?? (group.requirement === 'all' ? atoms.length : 1);
    if ((group.requirement === 'any' ? passed.length >= 1 : passed.length >= needed)) continue;
    missing.push(...atoms.filter((atom) => !passedPositive.has(atom.id)).map((atom) => atom.id));
  }
  return {
    missing: [...new Set(missing)],
    forbidden: forbidden.filter((atom) => byAtomId.get(atom.id)?.outcome === 'content_miss').map((atom) => atom.id),
    inconclusive: [...new Set(inconclusive)],
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
