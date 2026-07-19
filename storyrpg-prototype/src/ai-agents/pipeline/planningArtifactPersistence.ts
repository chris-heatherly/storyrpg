import type { BranchAnalysis } from '../agents/BranchManager';
import type { ChoiceSet } from '../agents/ChoiceAuthor';
import type { EncounterStructure } from '../agents/EncounterArchitect';
import type { SceneContent } from '../agents/SceneWriter';
import type { EpisodeBlueprint } from '../agents/StoryArchitect';
import type { SeasonPlan } from '../../types/seasonPlan';
import type { SourceMaterialAnalysis } from '../../types/sourceAnalysis';
import type {
  QualityCouncilReport,
  StoryCouncilCandidateArtifactSet,
  StoryCouncilCandidateDecision,
} from '../quality-council/types';
import type { ArtifactRef } from './artifacts';
import type { RunArtifactRuntime } from './phases/RunArtifactPhase';

export interface ArtifactPersistenceEvent {
  type: 'debug';
  phase: string;
  message: string;
}

type EmitArtifactEvent = (event: ArtifactPersistenceEvent) => void;

export async function persistPlanningArtifacts(params: {
  artifactRuntime: RunArtifactRuntime;
  sourceAnalysis: SourceMaterialAnalysis;
  seasonPlan?: SeasonPlan;
  emit: EmitArtifactEvent;
}): Promise<ArtifactRef[]> {
  const { artifactRuntime, sourceAnalysis, seasonPlan, emit } = params;
  const savedKinds = ['source analysis'];
  const sourceAnalysisArtifact = await artifactRuntime.saveArtifact({
    kind: 'source-analysis',
    payload: sourceAnalysis,
    status: 'valid',
    makeCurrent: false,
    provenance: { phase: 'source_analysis', agent: 'SourceMaterialAnalyzer' },
  });
  const sourceAnalysisRef = artifactRuntime.refFor(sourceAnalysisArtifact);
  const upstream = [sourceAnalysisRef];
  const planningRefs = [sourceAnalysisRef];

  if (sourceAnalysis.sourceCanon) {
    const sourceCanonArtifact = await artifactRuntime.saveArtifact({
      kind: 'source-canon',
      payload: sourceAnalysis.sourceCanon,
      status: 'valid',
      makeCurrent: false,
      upstream,
      provenance: { phase: 'source_analysis', agent: 'SourceMaterialAnalyzer' },
    });
    const sourceCanonRef = artifactRuntime.refFor(sourceCanonArtifact);
    upstream.push(sourceCanonRef);
    planningRefs.push(sourceCanonRef);
    savedKinds.push('source canon');
  }

  if (seasonPlan) {
    const seasonPlanArtifact = await artifactRuntime.saveArtifact({
      kind: 'season-plan',
      payload: seasonPlan,
      status: 'valid',
      makeCurrent: false,
      upstream,
      provenance: { phase: 'season_planning', agent: 'SeasonPlannerAgent' },
    });
    const seasonPlanRef = artifactRuntime.refFor(seasonPlanArtifact);
    planningRefs.push(seasonPlanRef);
    savedKinds.push('season plan');
    const graph = seasonPlan.scenePlan?.narrativeContractGraph;
    if (graph) {
      const graphArtifact = await artifactRuntime.saveArtifact({
        kind: 'narrative-contract-graph',
        payload: graph,
        status: 'valid',
        makeCurrent: false,
        upstream: [seasonPlanRef],
        provenance: { phase: 'season_planning', agent: 'NarrativeContractCompiler' },
        validation: {
          passed: graph.validation.passed,
          gate: 'NarrativeContractGraphGate',
          issues: graph.validation.issues.map((issue) => ({
            validator: 'NarrativeContractGraphValidator',
            severity: issue.severity,
            message: issue.message,
            code: issue.code,
          })),
        },
      });
      const graphRef = artifactRuntime.refFor(graphArtifact);
      planningRefs.push(graphRef);
      const realizationLedgerArtifact = await artifactRuntime.saveArtifact({
        kind: 'narrative-realization-ledger',
        payload: { version: 1, storyId: graph.storyId, graphSourceHash: graph.sourceHash, records: [] },
        status: 'valid',
        makeCurrent: false,
        upstream: [graphRef],
        provenance: { phase: 'season_planning', agent: 'NarrativeContractCompiler' },
      });
      planningRefs.push(artifactRuntime.refFor(realizationLedgerArtifact));
      savedKinds.push('narrative contract graph', 'narrative realization ledger');
    }
  }

  await artifactRuntime.commitCurrentSet(planningRefs);
  emit({
    type: 'debug',
    phase: 'artifacts',
    message: `Saved revisioned planning artifacts for ${savedKinds.join(', ')}.`,
  });
  return planningRefs;
}

export async function persistEpisodePlanningArtifacts(params: {
  artifactRuntime: RunArtifactRuntime;
  episodeNumber: number;
  blueprint?: EpisodeBlueprint;
  branchAnalysis?: BranchAnalysis | null;
  sceneContents?: SceneContent[];
  choiceSets?: ChoiceSet[];
  encounters?: Map<string, EncounterStructure>;
  storyCouncilCandidateSet?: StoryCouncilCandidateArtifactSet;
  storyCouncilDecision?: StoryCouncilCandidateDecision;
  emit: EmitArtifactEvent;
}): Promise<ArtifactRef[]> {
  const {
    artifactRuntime,
    episodeNumber,
    blueprint,
    branchAnalysis,
    sceneContents,
    choiceSets,
    encounters,
    storyCouncilCandidateSet,
    storyCouncilDecision,
    emit,
  } = params;
  const globalUpstream = artifactRuntime.getGlobalUpstreamRefs();
  const refs: ArtifactRef[] = [];

  let councilCandidateSetRef: ArtifactRef | undefined;
  if (storyCouncilCandidateSet) {
    const artifact = await artifactRuntime.saveArtifact({
      kind: 'story-council-candidate-set',
      episodeNumber,
      payload: storyCouncilCandidateSet,
      status: 'valid',
      makeCurrent: false,
      upstream: globalUpstream,
      provenance: { phase: `episode_${episodeNumber}_story_council`, agent: 'StoryArchitectSwarm' },
    });
    councilCandidateSetRef = artifactRuntime.refFor(artifact);
    refs.push(councilCandidateSetRef);
  }

  let councilDecisionRef: ArtifactRef | undefined;
  if (storyCouncilDecision) {
    const artifact = await artifactRuntime.saveArtifact({
      kind: 'story-council-decision',
      episodeNumber,
      payload: storyCouncilDecision,
      // Infrastructure degradation is part of the evidence payload, not an
      // invalid artifact state; committing it must never turn an advisory
      // council outage into a generation blocker.
      status: 'valid',
      makeCurrent: false,
      upstream: councilCandidateSetRef ? [councilCandidateSetRef] : globalUpstream,
      provenance: { phase: `episode_${episodeNumber}_story_council`, agent: 'CandidateComparisonAgent' },
      validation: {
        passed: true,
        gate: 'StoryCouncilEvidenceGate',
        issues: storyCouncilDecision.infrastructureErrors.map((message) => ({
          validator: 'StoryCouncilInfrastructure',
          severity: 'warning' as const,
          message,
          code: 'story_council_infrastructure',
        })),
      },
    });
    councilDecisionRef = artifactRuntime.refFor(artifact);
    refs.push(councilDecisionRef);
  }

  let episodeBlueprintRef: ArtifactRef | undefined;
  if (blueprint) {
    const artifact = await artifactRuntime.saveArtifact({
      kind: 'episode-blueprint', episodeNumber, payload: blueprint, status: 'valid', makeCurrent: false,
      upstream: councilDecisionRef ? [councilDecisionRef] : globalUpstream,
      provenance: { phase: `episode_${episodeNumber}_architecture`, agent: 'StoryArchitect' },
    });
    episodeBlueprintRef = artifactRuntime.refFor(artifact);
    refs.push(episodeBlueprintRef);
  }

  let branchPlanRef: ArtifactRef | undefined;
  if (branchAnalysis) {
    const artifact = await artifactRuntime.saveArtifact({
      kind: 'branch-plan', episodeNumber, payload: branchAnalysis, status: 'valid', makeCurrent: false,
      upstream: episodeBlueprintRef ? [episodeBlueprintRef] : globalUpstream,
      provenance: { phase: `episode_${episodeNumber}_branch_analysis`, agent: 'BranchManager' },
    });
    branchPlanRef = artifactRuntime.refFor(artifact);
    refs.push(branchPlanRef);
  }

  let scenePlanRef: ArtifactRef | undefined;
  if (blueprint || sceneContents) {
    const artifact = await artifactRuntime.saveArtifact({
      kind: 'scene-plan',
      episodeNumber,
      payload: {
        episodeNumber,
        eventPlan: blueprint?.episodeEventPlan,
        blueprintScenes: blueprint?.scenes ?? [],
        authoredScenes: sceneContents ?? [],
      },
      status: 'valid',
      makeCurrent: false,
      upstream: [
        ...(episodeBlueprintRef ? [episodeBlueprintRef] : globalUpstream),
        ...(branchPlanRef ? [branchPlanRef] : []),
      ],
      provenance: { phase: `episode_${episodeNumber}_content`, agent: 'SceneWriter' },
    });
    scenePlanRef = artifactRuntime.refFor(artifact);
    refs.push(scenePlanRef);
  }

  if (choiceSets) {
    const artifact = await artifactRuntime.saveArtifact({
      kind: 'choice-consequence-plan', episodeNumber, payload: { episodeNumber, choiceSets }, status: 'valid', makeCurrent: false,
      upstream: [
        ...(scenePlanRef ? [scenePlanRef] : episodeBlueprintRef ? [episodeBlueprintRef] : globalUpstream),
        ...(branchPlanRef ? [branchPlanRef] : []),
      ],
      provenance: { phase: `episode_${episodeNumber}_content`, agent: 'ChoiceAuthor' },
    });
    refs.push(artifactRuntime.refFor(artifact));
  }

  if (encounters) {
    const artifact = await artifactRuntime.saveArtifact({
      kind: 'encounter-plan',
      episodeNumber,
      payload: { episodeNumber, encounters: Array.from(encounters.entries()).map(([id, encounter]) => ({ id, encounter })) },
      status: 'valid',
      makeCurrent: false,
      upstream: scenePlanRef ? [scenePlanRef] : episodeBlueprintRef ? [episodeBlueprintRef] : globalUpstream,
      provenance: { phase: `episode_${episodeNumber}_content`, agent: 'EncounterArchitect' },
    });
    refs.push(artifactRuntime.refFor(artifact));
  }

  if (refs.length > 0) {
    await artifactRuntime.commitCurrentSet(refs);
    emit({
      type: 'debug',
      phase: `episode_${episodeNumber}_artifacts`,
      message: `Saved ${refs.length} revisioned episode planning artifact(s).`,
    });
  }
  return refs;
}

export async function persistStoryCouncilHoldoutArtifact(params: {
  artifactRuntime: RunArtifactRuntime;
  report?: QualityCouncilReport;
  emit: EmitArtifactEvent;
}): Promise<ArtifactRef | undefined> {
  const { artifactRuntime, report, emit } = params;
  if (!report) return undefined;
  const holdouts = report.checkpoints.filter((checkpoint) =>
    checkpoint.checkpoint === 'route-playtest' || checkpoint.checkpoint === 'final',
  );
  if (holdouts.length === 0) return undefined;
  const artifact = await artifactRuntime.saveArtifact({
    kind: 'story-council-holdout',
    payload: {
      version: 1,
      mode: report.mode,
      checkpoints: holdouts,
      infrastructureFailures: report.summary.infrastructureFailures,
    },
    status: 'valid',
    makeCurrent: false,
    upstream: artifactRuntime.getGlobalUpstreamRefs(),
    provenance: { phase: 'story_council_holdout', agent: 'StoryCouncilHoldouts' },
  });
  const ref = artifactRuntime.refFor(artifact);
  await artifactRuntime.commitCurrentSet([ref]);
  emit({
    type: 'debug',
    phase: 'story_council',
    message: `Saved ${holdouts.length} revisioned Story Council holdout checkpoint(s).`,
  });
  return ref;
}
