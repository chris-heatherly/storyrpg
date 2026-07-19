/**
 * Pre-image cliffhanger repair (adoption A7, 2026-06-11).
 *
 * Faithful port of FullStoryPipeline.repairWeakCliffhangerBeforeImages (pure
 * move). Runs after scene content + choices exist but BEFORE images, so a
 * repaired final beat still gets its visuals. Two defect classes:
 *
 *   - WEAK cliffhanger: CliffhangerValidator scores the assembled episode's
 *     ending; below 'good' (or outside the hysteresis band when
 *     GATE_CLIFFHANGER stabilization is on) → improveCliffhanger rewrite.
 *   - PATH-GATED hook (G12): the authored hook lands inside only SOME of the
 *     terminal payoff branches, so part of the audience exits the episode
 *     without the next episode's motivation. Detected structurally; the
 *     repaired hook is installed on a shared CODA beat all payoffs rewire
 *     through.
 *
 * Soft-gate semantics: never throws, never blocks — a failed repair logs a
 * warning (+ best-effort ledger record when stabilization is on) and the
 * episode ships with the original ending.
 */

import type { Episode } from '../../types';
import type { NarrativeRealizationTask } from '../../types/narrativeContract';
import type { PipelineConfig } from '../config';
import type { WorldBible } from '../agents/WorldBuilder';
import type { CharacterBible } from '../agents/CharacterDesigner';
import type { EpisodeBlueprint } from '../agents/StoryArchitect';
import type { SceneContent } from '../agents/SceneWriter';
import type { ChoiceSet } from '../agents/ChoiceAuthor';
import type { EncounterStructure } from '../agents/EncounterArchitect';
import type { PipelineEvent } from './events';
import type { FullCreativeBrief } from './FullStoryPipeline';
import type { RemediationLedgerRecord } from '../remediation/remediationLedger';
import { CliffhangerValidator } from '../validators';
import { coerceFirstPersonNarrationToSecond } from '../validators/PovClarityValidator';
import { isGateEnabled } from '../remediation/gateDefaults';
import { stabilizeByHysteresis } from '../remediation/judgeStabilizer';
import { withTimeout, PIPELINE_TIMEOUTS } from '../utils/withTimeout';
import { resolveSceneIdentityReferencePolicies } from '../utils/identityReferencePolicy';

export interface CliffhangerRepairDeps {
  sceneWriterConfig: PipelineConfig['agents']['sceneWriter'];
  emit: (event: Omit<PipelineEvent, 'timestamp'>) => void;
  recordRemediationSafe: (
    record: Omit<RemediationLedgerRecord, 'timestamp' | 'runDir'> & { timestamp?: string; runDir?: string },
  ) => Promise<void>;
  assembleEpisode: (
    brief: FullCreativeBrief,
    worldBible: WorldBible,
    characterBible: CharacterBible,
    blueprint: EpisodeBlueprint,
    sceneContents: SceneContent[],
    choiceSets: ChoiceSet[],
    imageResults?: { beatImages: Map<string, string>; sceneImages: Map<string, string> },
    encounters?: Map<string, EncounterStructure>,
  ) => Episode;
  /**
   * Canonically validate the exact scene candidate before this late pass may
   * replace prose that already passed its owning producer.
   */
  validateSceneContract?: (input: {
    scene: SceneContent;
    sceneId: string;
  }) => Promise<Array<{
    blocking: boolean;
    fingerprint?: string;
    code?: string;
    taskId?: string;
    missingEvidenceAtoms?: string[];
    matchedForbiddenAtoms?: string[];
    message?: string;
  }>>;
}

type CliffhangerContractFinding = Awaited<ReturnType<NonNullable<CliffhangerRepairDeps['validateSceneContract']>>>[number];

function cloneScene(scene: SceneContent): SceneContent {
  return JSON.parse(JSON.stringify(scene)) as SceneContent;
}

function findingKey(finding: CliffhangerContractFinding): string {
  return finding.fingerprint || [
    finding.code ?? '',
    finding.taskId ?? '',
    ...(finding.missingEvidenceAtoms ?? []),
    ...(finding.matchedForbiddenAtoms ?? []),
  ].join('::');
}

function introducedBlockingFindings(
  before: CliffhangerContractFinding[],
  after: CliffhangerContractFinding[],
): CliffhangerContractFinding[] {
  const beforeKeys = new Set(before.filter((finding) => finding.blocking).map(findingKey));
  return after.filter((finding) => finding.blocking && !beforeKeys.has(findingKey(finding)));
}

function sceneTaskConstraints(
  brief: FullCreativeBrief,
  blueprint: EpisodeBlueprint,
  sceneId: string,
): { requiredMeanings: string[]; forbiddenMeanings: string[] } {
  const graphTasks = brief.seasonPlan?.scenePlan?.narrativeContractGraph?.realizationTasks
    ?.filter((task: NarrativeRealizationTask) => task.sceneId === sceneId) ?? [];
  const blueprintTasks = blueprint.scenes.find((scene) => scene.id === sceneId)?.realizationTasks ?? [];
  const tasks = Array.from(new Map(
    [...graphTasks, ...blueprintTasks].map((task) => [task.id, task]),
  ).values());
  const requiredMeanings = new Set<string>();
  const forbiddenMeanings = new Set<string>();
  for (const task of tasks) {
    for (const atom of task.evidenceAtoms ?? []) {
      const description = atom.description?.trim();
      if (!description) continue;
      if (atom.polarity === 'forbidden') forbiddenMeanings.add(description);
      else if (atom.required !== false) requiredMeanings.add(description);
    }
  }
  const graph = brief.seasonPlan?.scenePlan?.narrativeContractGraph;
  const identityPolicies = resolveSceneIdentityReferencePolicies({
    episodeNumber: brief.episode.number,
    sceneId,
    identityScheduleContracts: graph?.identityScheduleContracts,
    lexicalArtifactContracts: graph?.lexicalArtifactContracts,
    realizationTasks: tasks,
  });
  for (const policy of identityPolicies) {
    for (const reference of policy.forbiddenReferences) {
      forbiddenMeanings.add(`Do not use the unavailable identity reference "${reference}" for ${policy.canonicalName}`);
    }
  }
  return { requiredMeanings: [...requiredMeanings], forbiddenMeanings: [...forbiddenMeanings] };
}

export async function repairWeakCliffhangerBeforeImages(
  deps: CliffhangerRepairDeps,
  brief: FullCreativeBrief,
  worldBible: WorldBible,
  characterBible: CharacterBible,
  blueprint: EpisodeBlueprint,
  sceneContents: SceneContent[],
  choiceSets: ChoiceSet[],
  encounters?: Map<string, EncounterStructure>,
): Promise<void> {
  const seasonEpisode = brief.seasonPlan?.episodes.find(e => e.episodeNumber === brief.episode.number);
  const cliffhangerPlan = seasonEpisode?.cliffhangerPlan;
  const totalEpisodes = brief.seasonPlan?.episodes.length || 1;
  if (!cliffhangerPlan || brief.episode.number >= totalEpisodes) return;

  const scenes = blueprint.scenes || [];
  const terminalBlueprint = [...scenes].reverse().find(s => !s.leadsTo || s.leadsTo.length === 0)
    || scenes[scenes.length - 1];
  if (!terminalBlueprint || terminalBlueprint.isEncounter) return;

  const finalSceneIndex = sceneContents.findIndex(sc => sc.sceneId === terminalBlueprint.id);
  const finalScene = finalSceneIndex >= 0 ? sceneContents[finalSceneIndex] : undefined;
  const finalBeat = finalScene?.beats?.[finalScene.beats.length - 1];
  if (!finalScene || !finalBeat) return;

  // G12: path-gated cliffhangers. When the episode's final choice point has no
  // successor beat, each payoff bridges straight out of the episode — and the
  // authored hook (the doormat scarf, the two DMs) lands inside ONE payoff
  // branch, so half the players end the episode without the next episode's
  // motivation. Detect terminal payoff fan-out and partial hook coverage; the
  // repaired hook then lands on a shared CODA beat all payoffs flow through.
  type BridgeBeat = (typeof finalScene.beats)[number] & {
    isChoiceBridge?: boolean; nextSceneId?: string; nextBeatId?: string;
    textVariants?: Array<{ text?: string }>;
  };
  const terminalPayoffs = (finalScene.beats || []).filter((b) => {
    const bb = b as BridgeBeat;
    return bb.isChoiceBridge && bb.nextSceneId && !bb.nextBeatId;
  }) as BridgeBeat[];
  const sharedTarget = terminalPayoffs.length >= 2
    && new Set(terminalPayoffs.map(b => b.nextSceneId)).size === 1
    ? terminalPayoffs[0].nextSceneId
    : undefined;
  const hookTokens = (cliffhangerPlan.hook || '').toLowerCase().split(/[^a-zà-žăâîșț0-9]+/).filter(t => t.length >= 4);
  const carriesHookText = (text: string): boolean => {
    if (hookTokens.length === 0) return false;
    const lower = text.toLowerCase();
    const hits = hookTokens.filter(t => lower.includes(t)).length;
    return hits / hookTokens.length >= 0.3;
  };
  const carriesHook = (b: BridgeBeat): boolean => {
    const text = [b.text, ...((b.textVariants || []).map(v => v.text))].filter(Boolean).join(' ');
    return carriesHookText(text);
  };
  const beatById = new Map((finalScene.beats || []).map((beat) => [beat.id, beat as BridgeBeat]));
  const reachableHookFrom = (beat: BridgeBeat, seen = new Set<string>()): boolean => {
    if (carriesHook(beat)) return true;
    const nextId = beat.nextBeatId;
    if (!nextId || seen.has(nextId)) return false;
    seen.add(nextId);
    const nextBeat = beatById.get(nextId);
    return nextBeat ? reachableHookFrom(nextBeat, seen) : false;
  };
  const finalSceneHasHook = carriesHookText((finalScene.beats || [])
    .map((beat) => [beat.text, ...((beat as BridgeBeat).textVariants || []).map(v => v.text)].filter(Boolean).join(' '))
    .join(' '));
  const hookCoverage = sharedTarget
    ? terminalPayoffs.filter((payoff) => reachableHookFrom(payoff) || finalSceneHasHook).length
    : 0;
  const pathGatedHook = Boolean(sharedTarget) && hookCoverage < terminalPayoffs.length;

  const episode = deps.assembleEpisode(
    brief,
    worldBible,
    characterBible,
    blueprint,
    sceneContents,
    choiceSets,
    undefined,
    encounters,
  );

  const validator = new CliffhangerValidator(deps.sceneWriterConfig);
  const analysis = validator.quickAnalyze(episode, cliffhangerPlan);

  // Cliffhanger soft-gate (default OFF; GATE_CLIFFHANGER=1). This is a NON-
  // blocking soft-gate: it only decides whether to invoke the (already
  // non-throwing) improveCliffhanger repair. Default path is unchanged —
  // repair whenever quality is not 'good'/'excellent' (heuristic score < 62).
  // With the flag ON, the score boundary is hysteresis-stabilized so a
  // borderline draw in [57, 62) is treated as a pass and NO repair fires,
  // trading a slightly more permissive gate for fewer noise-triggered LLM
  // repairs. 62 is the 'good' threshold; 5 is the hysteresis margin.
  const stabilizationOn = isGateEnabled('GATE_CLIFFHANGER');
  const qualityNeedsRepair = stabilizationOn
    ? stabilizeByHysteresis(analysis.score, 62, 5)
    : analysis.quality !== 'good' && analysis.quality !== 'excellent';
  // A hook that exists on only SOME terminal payoffs is a structural defect even
  // when the quality score passes (the analyzer read the hook on the branch it
  // sampled) — force the repair so the hook lands on the shared coda.
  const needsRepair = qualityNeedsRepair || pathGatedHook;
  if (!needsRepair) {
    deps.emit({
      type: 'debug',
      phase: 'cliffhanger_validation',
      message: `Cliffhanger passed (${analysis.quality}, ${analysis.score}/100${stabilizationOn ? ', hysteresis-stabilized' : ''})`,
    });
    return;
  }

  deps.emit({
    type: 'regeneration_triggered',
    phase: 'cliffhanger_repair',
    message: `Repairing weak ${cliffhangerPlan.storyCircleLaunchBeat || 'Story Circle'} cliffhanger (${analysis.score}/100): ${analysis.suggestions.join('; ')}`,
  });

  const taskConstraints = sceneTaskConstraints(brief, blueprint, finalScene.sceneId);
  if (!deps.validateSceneContract && (taskConstraints.requiredMeanings.length > 0 || taskConstraints.forbiddenMeanings.length > 0)) {
    deps.emit({
      type: 'warning',
      phase: 'cliffhanger_repair',
      message: `Cliffhanger repair retained the original ${finalScene.sceneId} ending because canonical task validation was unavailable.`,
    });
    return;
  }

  let baselineFindings: CliffhangerContractFinding[] = [];
  if (deps.validateSceneContract) {
    try {
      baselineFindings = await deps.validateSceneContract({ scene: finalScene, sceneId: finalScene.sceneId });
    } catch (error) {
      deps.emit({
        type: 'warning',
        phase: 'cliffhanger_repair',
        message: `Cliffhanger repair retained the original ${finalScene.sceneId} ending because baseline contract validation failed: ${error instanceof Error ? error.message : String(error)}`,
      });
      return;
    }
  }

  const installCandidate = (candidate: SceneContent, improvedText: string, explanation: string): void => {
    type CandidateBridgeBeat = (typeof candidate.beats)[number] & BridgeBeat;
    const candidateFinalBeat = candidate.beats.find((beat) => beat.id === finalBeat.id)
      ?? candidate.beats[candidate.beats.length - 1];
    if (sharedTarget) {
      const candidatePayoffs = (candidate.beats || []).filter((beat) => {
        const bridge = beat as CandidateBridgeBeat;
        return bridge.isChoiceBridge && bridge.nextSceneId === sharedTarget && !bridge.nextBeatId;
      }) as CandidateBridgeBeat[];
      const codaId = `${candidate.sceneId}-cliffhanger-coda`;
      let coda = candidate.beats.find((beat) => beat.id === codaId) as CandidateBridgeBeat | undefined;
      if (!coda) {
        coda = {
          id: codaId,
          text: improvedText,
          isChoicePoint: false,
          isChoiceBridge: true,
          nextSceneId: sharedTarget,
          visualMoment: improvedText.split(/[.!?]/)[0]?.trim(),
          emotionalRead: cliffhangerPlan.emotionalCharge,
          intensityTier: cliffhangerPlan.intensity === 'high' ? 'dominant' : 'supporting',
        } as unknown as CandidateBridgeBeat;
        candidate.beats.push(coda as never);
      } else {
        coda.text = improvedText;
      }
      for (const payoff of candidatePayoffs) {
        payoff.nextBeatId = codaId;
        payoff.nextSceneId = undefined;
        payoff.isChoiceBridge = false;
      }
    } else if (candidateFinalBeat) {
      candidateFinalBeat.text = improvedText;
      candidateFinalBeat.visualMoment = candidateFinalBeat.visualMoment || improvedText.split(/[.!?]/)[0]?.trim();
      candidateFinalBeat.emotionalRead = candidateFinalBeat.emotionalRead || cliffhangerPlan.emotionalCharge;
      candidateFinalBeat.intensityTier = cliffhangerPlan.intensity === 'high'
        ? 'dominant'
        : (candidateFinalBeat.intensityTier || 'supporting');
    }
    if (candidateFinalBeat) candidateFinalBeat.mustShowDetail = candidateFinalBeat.mustShowDetail || cliffhangerPlan.hook;
    candidate.keyMoments = Array.from(new Set([...(candidate.keyMoments || []), cliffhangerPlan.hook]));
    candidate.continuityNotes = Array.from(new Set([...(candidate.continuityNotes || []), `Cliffhanger repaired: ${explanation}`]));
  };

  let accepted: { scene: SceneContent; analysis: typeof analysis; explanation: string } | undefined;
  let retryFeedback: string | undefined;
  let attempted = 0;
  for (let attempt = 1; attempt <= 2 && !accepted; attempt += 1) {
    attempted += 1;
    let improvement;
    try {
      improvement = await withTimeout(
        validator.improveCliffhanger(episode, cliffhangerPlan, analysis, {
          ...taskConstraints,
          retryFeedback,
        }),
        PIPELINE_TIMEOUTS.llmAgent,
        `CliffhangerValidator.improveCliffhanger(${brief.episode.number}, attempt ${attempt})`,
      );
    } catch (error) {
      retryFeedback = `The repair call failed: ${error instanceof Error ? error.message : String(error)}`;
      continue;
    }
    if (!improvement.success || !improvement.data?.improvedText) {
      retryFeedback = improvement.error || 'No improved text was returned.';
      continue;
    }

    // This post-owner pass can still slip into first person. Coerce narration
    // (quoted dialogue untouched) on the candidate, never on committed prose.
    const povFix = coerceFirstPersonNarrationToSecond(improvement.data.improvedText);
    const improvedText = povFix.text;
    if (povFix.changed) {
      deps.emit({
        type: 'debug',
        phase: 'cliffhanger_repair',
        message: `Cliffhanger candidate coerced from first-person to second-person POV on ${finalScene.sceneId}.`,
      });
    }

    const candidate = cloneScene(finalScene);
    installCandidate(candidate, improvedText, improvement.data.explanation);
    const candidateSceneContents = sceneContents.map((scene, index) => index === finalSceneIndex ? candidate : scene);
    const candidateEpisode = deps.assembleEpisode(
      brief, worldBible, characterBible, blueprint, candidateSceneContents,
      choiceSets, undefined, encounters,
    );
    const candidateAnalysis = validator.quickAnalyze(candidateEpisode, cliffhangerPlan);
    const candidateStillWeak = stabilizationOn
      ? stabilizeByHysteresis(candidateAnalysis.score, 62, 5)
      : candidateAnalysis.quality !== 'good' && candidateAnalysis.quality !== 'excellent';
    if (candidateAnalysis.score < analysis.score || (qualityNeedsRepair && candidateStillWeak)) {
      retryFeedback = `Heuristic cliffhanger validation rejected the candidate (${candidateAnalysis.score}/100 versus ${analysis.score}/100 before${candidateStillWeak ? '; it remains weak' : ''}).`;
      continue;
    }

    if (deps.validateSceneContract) {
      let candidateFindings: CliffhangerContractFinding[];
      try {
        candidateFindings = await deps.validateSceneContract({ scene: candidate, sceneId: candidate.sceneId });
      } catch (error) {
        retryFeedback = `Canonical candidate validation failed: ${error instanceof Error ? error.message : String(error)}`;
        continue;
      }
      const introduced = introducedBlockingFindings(baselineFindings, candidateFindings);
      if (introduced.length > 0) {
        retryFeedback = introduced.map((finding) =>
          `- ${finding.message || `${finding.code ?? 'contract finding'} on ${finding.taskId ?? candidate.sceneId}`}`,
        ).join('\n');
        deps.emit({
          type: 'warning',
          phase: 'cliffhanger_repair',
          message: `Rejected cliffhanger candidate ${attempt}/2 for ${candidate.sceneId}: ${introduced.length} canonical blocker(s) introduced.`,
        });
        continue;
      }
    }
    accepted = { scene: candidate, analysis: candidateAnalysis, explanation: improvement.data.explanation };
  }

  if (!accepted) {
    deps.emit({
      type: 'warning',
      phase: 'cliffhanger_repair',
      message: `Cliffhanger repair retained the original ${finalScene.sceneId} ending after ${attempted} rejected candidate(s).${retryFeedback ? ` ${retryFeedback.slice(0, 360)}` : ''}`,
    });
    if (stabilizationOn) {
      await deps.recordRemediationSafe({
        rule: 'cliffhanger_stabilized', scope: 'episode', attempted,
        succeeded: false, degraded: false, blocked: false, attempts: attempted,
        storyId: (brief.story as typeof brief.story & { id?: string })?.id,
        details: `Cliffhanger repair retained original for episode ${brief.episode.number} after ${attempted} rejected candidate(s).`,
      });
    }
    return;
  }

  sceneContents[finalSceneIndex] = accepted.scene;
  const repairedAnalysis = accepted.analysis;
  if (sharedTarget) {
    deps.emit({
      type: 'debug',
      phase: 'cliffhanger_repair',
      message: `Cliffhanger coda installed transactionally on ${accepted.scene.sceneId}: ${terminalPayoffs.length} payoff path(s) rewired through ${accepted.scene.sceneId}-cliffhanger-coda (hook coverage was ${hookCoverage}/${terminalPayoffs.length}).`,
    });
  }
  deps.emit({
    type: repairedAnalysis.quality === 'missing' || repairedAnalysis.quality === 'weak' ? 'warning' : 'phase_complete',
    phase: 'cliffhanger_repair',
    message: `Cliffhanger repair result: ${repairedAnalysis.quality} (${repairedAnalysis.score}/100)`,
    data: { before: analysis, after: repairedAnalysis },
  });
  // Soft-gate observability: record the (successful) repair attempt best-effort
  // when stabilization is active. Never blocks; recordRemediationSafe swallows.
  if (stabilizationOn) {
    await deps.recordRemediationSafe({
      rule: 'cliffhanger_stabilized', scope: 'episode', attempted,
      succeeded: true, degraded: false, blocked: false, attempts: attempted,
      storyId: (brief.story as typeof brief.story & { id?: string })?.id,
      details: `Cliffhanger repaired for episode ${brief.episode.number}: ${analysis.score}/100 → ${repairedAnalysis.score}/100`,
    });
  }
}
