import type { ChoiceSet } from '../agents/ChoiceAuthor';
import type { EncounterStructure } from '../agents/EncounterArchitect';
import type { SceneContent } from '../agents/SceneWriter';
import type { SceneBlueprint } from '../agents/StoryArchitect';
import type { NarrativeRealizationOwnerStage } from '../../types/narrativeContract';
import type { ValidatorExecutionRecord } from '../../types/validation';
import { createValidatorExecutionRecord } from '../validators/validatorExecutionRecords';
import { saveEarlyDiagnostic } from '../utils/pipelineOutputWriter';
import { stableHash } from './artifacts/store';
import {
  appendDeferredRealizationRecord,
  buildDeferredRealizationRecord,
  type DeferredRealizationRecord,
} from './deferredRealization';
import { PipelineError } from './errors';
import type { PipelineEvent } from './events';
import type { RealizationTaskGateFinding } from './realizationTaskGate';

export async function finalizeSceneRealizationHandoff(input: {
  sceneBlueprint: SceneBlueprint;
  sceneContent?: SceneContent;
  choiceSet?: ChoiceSet;
  encounter?: EncounterStructure;
  episodeNumber: number;
  outputDirectory?: string;
  deferredRecords: DeferredRealizationRecord[];
  executionRecords: ValidatorExecutionRecord[];
  emit: (event: Omit<PipelineEvent, 'timestamp'>) => void;
  validate: (request: {
    sceneId: string;
    tasks?: SceneBlueprint['realizationTasks'];
    sceneContent?: unknown;
    choiceSet?: unknown;
    encounter?: unknown;
    mode: 'owner';
    currentStage?: NarrativeRealizationOwnerStage;
    candidateHash: string;
  }) => Promise<{
    findings: RealizationTaskGateFinding[];
    deferredFindings: RealizationTaskGateFinding[];
    semanticReceipt: NonNullable<ValidatorExecutionRecord['realizationReceipt']>;
  }>;
}): Promise<void> {
  const { sceneBlueprint, sceneContent, choiceSet, encounter } = input;
  const ownerStageFindings: RealizationTaskGateFinding[] = [];
  const deferredFingerprints = new Set(
    input.deferredRecords
      .filter((record) => record.sceneId === sceneBlueprint.id)
      .map((record) => record.finding.fingerprint),
  );

  for (const ownerStage of ['scene_writer', 'choice_author', 'encounter_architect'] as const) {
    const ownerTasks = (sceneBlueprint.realizationTasks ?? []).filter((task) => task.ownerStage === ownerStage);
    if (ownerTasks.length === 0) continue;
    const candidate = ownerStage === 'scene_writer' ? sceneContent : ownerStage === 'choice_author' ? choiceSet : encounter;
    if (!candidate) {
      if (ownerTasks.every((task) => !task.blocking)) continue;
      throw new PipelineError(
        `[OwnerStageNotExecuted] ${sceneBlueprint.id} has ${ownerTasks.length} blocking-capable ${ownerStage} task(s) but no owner artifact.`,
        ownerStage === 'choice_author' ? 'choices' : ownerStage === 'encounter_architect' ? 'encounters' : 'scenes',
        {
          agent: ownerStage === 'choice_author' ? 'ChoiceAuthor' : ownerStage === 'encounter_architect' ? 'EncounterArchitect' : 'SceneWriter',
          context: { sceneId: sceneBlueprint.id, taskIds: ownerTasks.map((task) => task.id) },
          failure: {
            code: 'owner_stage_not_executed',
            ownerStage,
            retryClass: ownerStage === 'choice_author' ? 'repair_choice' : ownerStage === 'encounter_architect' ? 'repair_encounter_route' : 'repair_scene_prose',
            issueCodes: ['OWNER_STAGE_NOT_EXECUTED'],
            artifactRefs: [],
            repairTarget: sceneBlueprint.id,
          },
        },
      );
    }
    const candidateHash = stableHash(candidate);
    const validation = await input.validate({
      sceneId: sceneBlueprint.id,
      tasks: ownerTasks,
      sceneContent,
      choiceSet,
      encounter,
      mode: 'owner',
      currentStage: ownerStage,
      candidateHash,
    });
    for (const finding of validation.deferredFindings) {
      appendDeferredRealizationRecord(input.deferredRecords, buildDeferredRealizationRecord({
        episodeNumber: input.episodeNumber,
        sceneId: sceneBlueprint.id,
        candidateHash,
        finding,
        tasks: ownerTasks,
        reason: 'semantic_inconclusive',
      }));
      deferredFingerprints.add(finding.fingerprint);
    }
    const findings = validation.findings.filter((finding) => !deferredFingerprints.has(finding.fingerprint));
    ownerStageFindings.push(...findings);
    input.executionRecords.push(createValidatorExecutionRecord({
      policyId: `NarrativeRealizationTask@${ownerStage}`,
      validatorId: 'NarrativeRealizationTaskGate',
      lifecycle: 'episode-contract',
      role: 'primary',
      placement: 'scene',
      mode: 'enforce',
      passed: findings.every((finding) => !finding.blocking),
      realizationReceipt: {
        sceneId: sceneBlueprint.id,
        ownerStage,
        candidateHash,
        taskIds: ownerTasks.map((task) => task.id).sort(),
        findingFingerprints: findings.map((finding) => finding.fingerprint).sort(),
        semanticVerdicts: validation.semanticReceipt.semanticVerdicts,
      },
      issues: [...findings, ...validation.deferredFindings].map((finding) => ({
        severity: deferredFingerprints.has(finding.fingerprint) ? 'warning' : finding.blocking ? 'error' : 'warning',
        code: finding.code,
        message: finding.message,
        metadata: {
          issueCode: finding.code,
          taskId: finding.taskId,
          contractId: finding.contractId,
          ownerStage: finding.ownerStage,
          sceneId: finding.sceneId,
          findingFingerprint: finding.fingerprint,
          deferredToFinalContract: deferredFingerprints.has(finding.fingerprint),
        },
      })),
    }));
  }

  const combinedHash = stableHash({ sceneContent, choiceSet, encounter });
  const regression = await input.validate({
    sceneId: sceneBlueprint.id,
    tasks: sceneBlueprint.realizationTasks,
    sceneContent,
    choiceSet,
    encounter,
    mode: 'owner',
    candidateHash: combinedHash,
  });
  for (const finding of regression.deferredFindings) {
    appendDeferredRealizationRecord(input.deferredRecords, buildDeferredRealizationRecord({
      episodeNumber: input.episodeNumber,
      sceneId: sceneBlueprint.id,
      candidateHash: combinedHash,
      finding,
      tasks: sceneBlueprint.realizationTasks ?? [],
      reason: 'semantic_inconclusive',
    }));
    deferredFingerprints.add(finding.fingerprint);
  }
  const findings = regression.findings.filter((finding) => !deferredFingerprints.has(finding.fingerprint));
  const ownerFingerprints = ownerStageFindings.map((finding) => finding.fingerprint).sort();
  const regressionFingerprints = findings.map((finding) => finding.fingerprint).sort();
  if (stableHash(ownerFingerprints) !== stableHash(regressionFingerprints)) {
    throw new PipelineError(
      `[OwnerStageCoverageMismatch] ${sceneBlueprint.id} produced different owner-stage and scene-regression realization findings.`,
      'content',
      {
        agent: 'NarrativeRealizationTaskGate',
        context: { sceneId: sceneBlueprint.id, ownerFingerprints, regressionFingerprints },
        failure: {
          code: 'owner_stage_coverage_mismatch',
          ownerStage: 'scene_content',
          retryClass: 'none',
          issueCodes: ['OWNER_STAGE_COVERAGE_MISMATCH'],
          artifactRefs: [],
          repairTarget: sceneBlueprint.id,
        },
      },
    );
  }

  const blockers = findings.filter((finding) => finding.blocking);
  const advisories = findings.filter((finding) => !finding.blocking);
  if ((sceneBlueprint.realizationTasks?.length ?? 0) > 0) {
    input.executionRecords.push(createValidatorExecutionRecord({
      policyId: 'NarrativeRealizationTask@scene-regression',
      validatorId: 'NarrativeRealizationTaskGate',
      lifecycle: 'episode-contract',
      role: 'regression-net',
      placement: 'scene',
      mode: 'audit',
      passed: blockers.length === 0,
      issues: findings.map((finding) => ({
        severity: finding.blocking ? 'error' : 'warning',
        code: finding.code,
        message: finding.message,
        metadata: {
          issueCode: finding.code,
          taskId: finding.taskId,
          contractId: finding.contractId,
          ownerStage: finding.ownerStage,
          repairHandler: sceneBlueprint.realizationTasks?.find((task) => task.id === finding.taskId)?.repairHandler,
          sceneId: finding.sceneId,
          outcomeTier: finding.outcomeTier,
          artifactPath: finding.field,
          missingEvidenceAtoms: finding.missingEvidenceAtoms,
          matchedForbiddenAtoms: finding.matchedForbiddenAtoms,
          findingFingerprint: finding.fingerprint,
        },
      })),
    }));
  }
  if (advisories.length > 0) {
    input.emit({
      type: 'warning',
      phase: 'content',
      message: `Scene ${sceneBlueprint.id} has ${advisories.length} advisory realization finding(s).`,
      data: { findings: advisories },
    });
  }
  if (blockers.length === 0) return;

  const artifactRef = `episode-${input.episodeNumber}-scene-${sceneBlueprint.id}-realization-blockers.json`;
  if (input.outputDirectory) {
    await saveEarlyDiagnostic(input.outputDirectory, artifactRef, {
      schemaVersion: 2,
      episodeNumber: input.episodeNumber,
      sceneId: sceneBlueprint.id,
      candidateHash: combinedHash,
      candidate: { sceneContent, choiceSet, encounter },
      findings: blockers,
      assignedEventIds: sceneBlueprint.assignedEventIds ?? sceneBlueprint.narrativeEventIds ?? [],
      realizationTasks: sceneBlueprint.realizationTasks ?? [],
    });
  }
  const first = blockers[0];
  throw new PipelineError(
    `[OwnerStageRealizationBlocker] ${sceneBlueprint.id} failed assigned realization task ${first.taskId}: ${first.message}`,
    first.ownerStage === 'choice_author' ? 'choices' : first.ownerStage === 'encounter_architect' ? 'encounters' : 'scenes',
    {
      agent: first.ownerStage === 'choice_author' ? 'ChoiceAuthor' : first.ownerStage === 'encounter_architect' ? 'EncounterArchitect' : 'SceneWriter',
      context: { sceneId: sceneBlueprint.id, findings: blockers, retryBudget: 2 },
      failure: {
        code: first.ownerStage === 'scene_writer' ? 'prose_realization_failed' : 'owner_realization_failed',
        ownerStage: first.ownerStage,
        retryClass: first.ownerStage === 'choice_author' ? 'repair_choice' : first.ownerStage === 'encounter_architect' ? 'repair_encounter_route' : 'repair_scene_prose',
        issueCodes: blockers.map((finding) => finding.code),
        artifactRefs: input.outputDirectory ? [artifactRef] : [],
        repairTarget: first.taskId,
      },
    },
  );
}
