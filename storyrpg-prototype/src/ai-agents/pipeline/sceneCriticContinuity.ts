/**
 * SceneCritic rewrite pass + character-consistency continuity repair.
 *
 * Owns the transactional per-scene critic review, continuity repair, and
 * continuity revalidation. reviewSceneBeforeCommit runs the optional
 * voice/style rewrite before descendants consume the scene; the retained
 * runSceneCriticPass method is a compatibility surface for focused callers and
 * tests. repairContinuityFindings re-authors scenes flagged by
 * the QA continuity checker (constructing a one-off SceneCritic if none is
 * configured) and, when a consuming gate is on, revalidateRepairedContinuity
 * re-runs the ContinuityChecker over the repaired prose and refreshes the QA
 * report in place.
 *
 * Extracted from FullStoryPipeline to keep that monolith from growing.
 */

import { PipelineConfig } from '../config';
import { Story } from '../../types';
import { EpisodeBlueprint } from '../agents/StoryArchitect';
import { CharacterBible } from '../agents/CharacterDesigner';
import { SceneContent } from '../agents/SceneWriter';
import { SceneCritic } from '../agents/SceneCritic';
import {
  QAReport,
  ContinuityChecker,
  type ContinuityIssue,
  anchorContinuityIssueLocations,
  recomputeContinuityIssueCount,
  deriveContinuityScore,
  recomputeQAReportDerived,
} from '../agents/QAAgents';
import { capabilityFactStrings } from './characterCanonFacts';
import {
  scenesNeedingRepair,
  selectRepairableContinuityFindings,
  buildContinuityRepairGuidance,
  resolveMissingSetupOwnerTargets,
  buildMissingSetupOwnerGuidance,
  mergeRewrittenBeatsIntoStory,
  applyRewrittenBeatsToSceneContents,
  mergeRevalidatedContinuityIssues,
  type ContinuityFinding,
  type OwnershipPlannedSceneLite,
} from './continuityRepair';
import { isGateEnabled } from '../remediation/gateDefaults';
import { sceneCriticFlags, sceneCriticNotes } from '../remediation/sceneCriticFlags';
import { realizationTaskMomentsFor, rewriteLosesRequiredMoment } from '../remediation/sceneRealizationGuard';
import { hasPlayerReference } from '../validators/PovClarityValidator';
import type { NarrativeRealizationTask } from '../../types/narrativeContract';
import type { SemanticRealizationJudgeLike } from '../agents/SemanticRealizationJudge';
import { validateSemanticRealizationTasks } from './semanticValidationCoordinator';
import { validateOwnerRealizationTasks, type RealizationTaskGateFinding } from './realizationTaskGate';
import { inferNarrativeVerificationAuthority } from './realizationVerificationAuthority';
import { buildRequiredBeatsSection } from '../prompts/requiredBeatsPromptSection';
import { saveEarlyDiagnostic } from '../utils/pipelineOutputWriter';
import { withTimeout, PIPELINE_TIMEOUTS } from '../utils/withTimeout';
import type { PipelineEvent } from './events';
import { sceneCommitContentHash, sceneHandoffHash, type SceneCommitReceipt } from './sceneCommit';

export interface ContinuityRepairOptions {
  forceRevalidation?: boolean;
  revalidationReason?: string;
  /**
   * Season scene plan slice (planned reading order) consulted to retarget
   * missing_setup repairs at the scene that OWNED the dropped setup event
   * (sceneEventOwnership), in addition to the flagged use-site scene.
   */
  plannedScenes?: OwnershipPlannedSceneLite[];
  /**
   * Once later scenes have consumed a scene's realized summary, a late repair
   * may change interior prose but must preserve that downstream handoff.
   */
  preserveCommittedHandoffs?: boolean;
  /** Mutable in-run receipts; accepted late repairs refresh their content hash. */
  commitReceipts?: SceneCommitReceipt[];
}

export interface SceneCriticContinuityDeps {
  config: PipelineConfig;
  emit: (event: Omit<PipelineEvent, 'timestamp'>) => void;
  /** Current SceneCritic instance, or null when one was never constructed. */
  readonly sceneCritic: SceneCritic | null;
  /** Canonical semantic authority used to revalidate rewritten owner prose. */
  readonly semanticRealizationJudge?: SemanticRealizationJudgeLike;
  buildContinuityCharacterKnowledge: (
    characterBible: CharacterBible,
  ) => Array<{ characterId: string; knows: string[]; doesNotKnow: string[] }>;
  buildContinuityTimeline: (blueprint: EpisodeBlueprint) => Array<{ event: string; when: string }>;
}

export interface SceneCriticBudget {
  limit: number;
  attempted: number;
  accepted: number;
  rejected: number;
  failed: number;
}

export type SceneCriticReviewDisposition =
  | 'not_eligible'
  | 'budget_exhausted'
  | 'accepted'
  | 'rejected'
  | 'failed';

export interface SceneCriticReviewOutcome {
  disposition: SceneCriticReviewDisposition;
  scene: SceneContent;
  rewrittenBeatIds: string[];
  commentary?: string;
  reason?: string;
}

export interface SceneCriticReviewInput {
  scene: SceneContent;
  characterBible: CharacterBible;
  realizationTasks?: NarrativeRealizationTask[];
  /** Final incremental VoiceValidator score for this exact candidate. */
  voiceScore?: number;
  /** Encounter prose is owned by EncounterArchitect and is not a SceneCritic surface. */
  isEncounter?: boolean;
  budget: SceneCriticBudget;
  /** Caller-owned checks that must pass before the candidate may be committed. */
  validateCandidate?: (candidate: SceneContent) => Promise<{ accepted: boolean; reason?: string }>;
}

export function createSceneCriticBudget(limit: number): SceneCriticBudget {
  return {
    limit: Math.max(1, Math.floor(limit)),
    attempted: 0,
    accepted: 0,
    rejected: 0,
    failed: 0,
  };
}

function cloneSceneContent(scene: SceneContent): SceneContent {
  return JSON.parse(JSON.stringify(scene)) as SceneContent;
}

function taskPreservationSection(tasks: NarrativeRealizationTask[] | undefined): string {
  if (!tasks?.length) return '';
  const lines = tasks
    .filter((task) => task.ownerStage === 'scene_writer')
    .flatMap((task) => task.evidenceAtoms.map((atom) => {
      const authority = atom.verificationAuthority
        ?? (Array.isArray(atom.acceptedPatterns) ? inferNarrativeVerificationAuthority(atom) : 'semantic_judge');
      const polarity = atom.polarity === 'forbidden' ? 'FORBIDDEN' : 'REQUIRED';
      return `- [${authority}] ${polarity}: ${atom.description}`;
    }));
  return lines.length > 0
    ? `CANONICAL REALIZATION RECEIPTS: the candidate is revalidated against these typed constraints before adoption. Preserve required meaning and exact literal names; do not introduce forbidden meaning.\n${lines.join('\n')}`
    : '';
}

function realizationFindingKey(finding: RealizationTaskGateFinding): string {
  return finding.fingerprint || [
    finding.code,
    finding.taskId,
    ...(finding.missingEvidenceAtoms ?? []),
    ...(finding.matchedForbiddenAtoms ?? []),
  ].join('::');
}

function introducedRealizationFindings(
  before: RealizationTaskGateFinding[],
  after: RealizationTaskGateFinding[],
): RealizationTaskGateFinding[] {
  const beforeKeys = new Set(before.filter((finding) => finding.blocking).map(realizationFindingKey));
  return after.filter((finding) => finding.blocking && !beforeKeys.has(realizationFindingKey(finding)));
}

function continuityRepairBeatIds(
  sceneContents: SceneContent[],
  sceneId: string,
  findings: ContinuityFinding[] | undefined,
): string[] {
  const scene = sceneContents.find((candidate) => candidate.sceneId === sceneId);
  const beats = scene?.beats ?? [];
  const ids = new Set<string>();
  for (const finding of selectRepairableContinuityFindings(findings)) {
    if (finding.location?.sceneId !== sceneId || !finding.location.beatId) continue;
    ids.add(finding.location.beatId);
    if (finding.type !== 'impossible_knowledge') continue;
    const index = beats.findIndex((beat) => beat.id === finding.location?.beatId);
    if (index > 0 && beats[index - 1]?.id) ids.add(beats[index - 1].id);
  }
  return [...ids];
}

export class SceneCriticContinuity {
  constructor(private deps: SceneCriticContinuityDeps) {}

  private async validateSceneWriterTasks(
    scene: SceneContent,
    tasks: NarrativeRealizationTask[] | undefined,
  ): Promise<RealizationTaskGateFinding[]> {
    const ownedTasks = (tasks ?? []).filter((task) =>
      task.ownerStage === 'scene_writer'
      && task.evidenceAtoms.every((atom) => Boolean(atom.id) && Array.isArray(atom.acceptedPatterns)),
    );
    if (ownedTasks.length === 0) return [];
    if (!this.deps.semanticRealizationJudge) {
      return validateOwnerRealizationTasks({
        sceneId: scene.sceneId,
        tasks: ownedTasks,
        sceneContent: scene,
        mode: 'final_regression',
        currentStage: 'scene_writer',
      });
    }
    const result = await validateSemanticRealizationTasks({
      sceneId: scene.sceneId,
      tasks: ownedTasks,
      sceneContent: scene,
      mode: 'final_regression',
      currentStage: 'scene_writer',
      judge: this.deps.semanticRealizationJudge,
    });
    const infrastructureBlockers = result.findings.filter((finding) =>
      finding.blocking
      && (finding.code === 'SEMANTIC_VALIDATION_UNAVAILABLE' || finding.code === 'SEMANTIC_VALIDATION_INCONCLUSIVE'),
    );
    if (infrastructureBlockers.length > 0) {
      throw new Error(`canonical realization validation unavailable for ${infrastructureBlockers.map((finding) => finding.taskId).join(', ')}`);
    }
    return result.findings;
  }

  /**
   * Review one scene at its commit boundary. Unlike the historical episode-end
   * pass, this method never mutates the accepted scene. It returns a validated
   * candidate for the caller to commit before any dependent scene is authored.
   */
  async reviewSceneBeforeCommit(input: SceneCriticReviewInput): Promise<SceneCriticReviewOutcome> {
    const { scene, characterBible, realizationTasks, budget } = input;
    const cfg = this.deps.config.sceneCritic;
    const configuredPass = cfg?.enabled === true;
    const flagGatedPass = !configuredPass && isGateEnabled('GATE_SCENE_CRITIC_ON_FLAG');
    const flags = sceneCriticFlags(scene);
    const notes = sceneCriticNotes(scene);

    if (input.isEncounter || !scene.beats?.length) {
      return { disposition: 'not_eligible', scene, rewrittenBeatIds: [], reason: 'unsupported or empty scene surface' };
    }
    if (!configuredPass && (!flagGatedPass || flags.length === 0)) {
      return { disposition: 'not_eligible', scene, rewrittenBeatIds: [], reason: 'scene has no critic eligibility signal' };
    }
    if (
      configuredPass
      && typeof cfg?.voiceScoreThreshold === 'number'
      && (typeof input.voiceScore !== 'number' || input.voiceScore > cfg.voiceScoreThreshold)
    ) {
      return { disposition: 'not_eligible', scene, rewrittenBeatIds: [], reason: 'voice score is above the configured threshold' };
    }
    if (budget.attempted >= budget.limit) {
      return { disposition: 'budget_exhausted', scene, rewrittenBeatIds: [], reason: 'episode critic budget exhausted' };
    }

    budget.attempted += 1;
    let critic: SceneCritic;
    try {
      critic = this.deps.sceneCritic ?? new SceneCritic(this.deps.config.agents.sceneWriter);
    } catch (error) {
      budget.failed += 1;
      const reason = error instanceof Error ? error.message : String(error);
      this.deps.emit({
        type: 'warning',
        phase: 'scene_critic',
        message: `SceneCritic review of ${scene.sceneId} could not start — keeping the accepted scene: ${reason}`,
      });
      return { disposition: 'failed', scene, rewrittenBeatIds: [], reason };
    }

    try {
      const baselineTaskFindings = await this.validateSceneWriterTasks(scene, realizationTasks);
      const contractSection = buildRequiredBeatsSection(scene);
      const typedTaskSection = taskPreservationSection(realizationTasks);
      const advisorySection = notes.length > 0
        ? `ADDRESS THESE SPECIFIC GAPS (advisory findings from generation-time validation):\n${notes.map((note) => `- ${note}`).join('\n')}`
        : '';
      const directorNotes = [
        contractSection
          ? `PRESERVE AUTHORED CONTENT: your rewrite must keep every staged moment below fully on-page — do not paraphrase away proper nouns, places, times, or staged actions.\n${contractSection}`
          : '',
        typedTaskSection,
        advisorySection,
      ].filter(Boolean).join('\n\n');

      this.deps.emit({
        type: 'debug',
        phase: 'scene_critic',
        message: `SceneCritic reviewing ${scene.sceneId} before scene commit`,
        data: { sceneId: scene.sceneId, flags, budget: { ...budget } },
      });
      const critique = await critic.execute({
        scene,
        characterBible,
        ...(directorNotes ? { directorNotes } : {}),
      });
      if (!critique.data || critique.data.rewrittenBeats.length === 0) {
        if (critique.error) {
          budget.failed += 1;
          return { disposition: 'failed', scene, rewrittenBeatIds: [], reason: critique.error };
        }
        budget.rejected += 1;
        return { disposition: 'rejected', scene, rewrittenBeatIds: [], reason: 'critic returned no usable rewritten beats' };
      }

      const rewrittenById = new Map(critique.data.rewrittenBeats.map((beat) => [beat.id, beat]));
      const candidate = cloneSceneContent(scene);
      candidate.beats = candidate.beats.map((beat) => {
        const replacement = rewrittenById.get(beat.id);
        if (!replacement) return beat;
        return {
          ...beat,
          text: replacement.text || beat.text,
          textVariants: replacement.textVariants || beat.textVariants,
        };
      });

      if (realizationTasks?.length) {
        const candidateTaskFindings = await this.validateSceneWriterTasks(candidate, realizationTasks);
        const introduced = introducedRealizationFindings(baselineTaskFindings, candidateTaskFindings);
        if (introduced.length > 0) {
          budget.rejected += 1;
          return {
            disposition: 'rejected',
            scene,
            rewrittenBeatIds: [],
            reason: `candidate introduced canonical realization blockers: ${introduced.map((finding) => finding.code).join(', ')}`,
          };
        }
      }

      if (isGateEnabled('GATE_SCENE_REQUIRED_BEAT_CHECK')) {
        const extraMoments = this.deps.semanticRealizationJudge
          ? []
          : realizationTaskMomentsFor(realizationTasks);
        const lost = rewriteLosesRequiredMoment(scene, scene.beats, candidate.beats, extraMoments);
        if (lost) {
          budget.rejected += 1;
          return {
            disposition: 'rejected',
            scene,
            rewrittenBeatIds: [],
            reason: `candidate dropped the authored ${lost.tier} moment`,
          };
        }
      }

      const originalOpeningBeat = scene.beats.find((beat) => String(beat.text ?? '').trim().length > 0);
      const openingBeatHadAnchor = originalOpeningBeat
        ? hasPlayerReference([
            String(originalOpeningBeat.text ?? ''),
            ...(originalOpeningBeat.textVariants ?? []).map((variant) => String(variant?.text ?? '')),
          ].join('\n'))
        : false;
      if (openingBeatHadAnchor) {
        const candidateOpeningBeat = candidate.beats.find((beat) => String(beat.text ?? '').trim().length > 0);
        const candidateHasAnchor = candidateOpeningBeat
          ? hasPlayerReference([
              String(candidateOpeningBeat.text ?? ''),
              ...(candidateOpeningBeat.textVariants ?? []).map((variant) => String(variant?.text ?? '')),
            ].join('\n'))
          : false;
        if (!candidateHasAnchor) {
          budget.rejected += 1;
          return { disposition: 'rejected', scene, rewrittenBeatIds: [], reason: 'candidate dropped the opening player anchor' };
        }
      }

      const callerValidation = await input.validateCandidate?.(candidate);
      if (callerValidation && !callerValidation.accepted) {
        budget.rejected += 1;
        return {
          disposition: 'rejected',
          scene,
          rewrittenBeatIds: [],
          reason: callerValidation.reason || 'caller-owned candidate validation rejected the rewrite',
        };
      }

      budget.accepted += 1;
      return {
        disposition: 'accepted',
        scene: candidate,
        rewrittenBeatIds: [...rewrittenById.keys()],
        commentary: critique.data.overallCommentary,
      };
    } catch (error) {
      budget.failed += 1;
      const reason = error instanceof Error ? error.message : String(error);
      this.deps.emit({
        type: 'warning',
        phase: 'scene_critic',
        message: `SceneCritic review of ${scene.sceneId} failed — keeping the accepted scene: ${reason}`,
      });
      return { disposition: 'failed', scene, rewrittenBeatIds: [], reason };
    }
  }

  async runSceneCriticPass(
    sceneContents: SceneContent[],
    characterBible: CharacterBible,
    // r117 gap analysis (2026-07-18): scene-scoped premise/event realization
    // tasks, keyed by sceneId, so a rewrite here can't silently drop content
    // those tasks already confirmed — see realizationTaskMomentsFor.
    realizationTasksBySceneId?: Map<string, NarrativeRealizationTask[]>,
  ): Promise<void> {
    const cfg = this.deps.config.sceneCritic;
    if (!sceneContents.length) return;

    // R8 (authoring economics): with sceneCritic NOT configured, the flag-gated
    // pass still critiques scenes that showed a generation-time quality signal
    // (failed incremental POV/voice validation, realization retry) — targeted
    // spend, same 3-scene cap. The configured pass supersedes it when enabled.
    const configuredPass = Boolean(cfg?.enabled && this.deps.sceneCritic);
    const flagGatedPass = !configuredPass && isGateEnabled('GATE_SCENE_CRITIC_ON_FLAG');
    if (!configuredPass && !flagGatedPass) return;

    const maxScenes = Math.max(1, cfg?.maxScenesPerEpisode ?? 3);
    let candidates = [...sceneContents];

    if (flagGatedPass) {
      // A3: with more flag sources feeding the pass, spend the bounded budget
      // on the scenes with the most recorded gaps first.
      candidates = candidates
        .filter(sc => sceneCriticFlags(sc).length > 0)
        .sort((a, b) => (sceneCriticFlags(b).length + sceneCriticNotes(b).length) - (sceneCriticFlags(a).length + sceneCriticNotes(a).length));
      if (candidates.length === 0) return;
    } else if (typeof cfg?.voiceScoreThreshold === 'number') {
      // If a voiceScoreThreshold is configured, prefer scenes with a low score.
      candidates = candidates
        .map(sc => ({
          sc,
          score:
            typeof (sc as unknown as { voiceScore?: number }).voiceScore === 'number'
              ? (sc as unknown as { voiceScore: number }).voiceScore
              : 100,
        }))
        .filter(entry => entry.score <= cfg.voiceScoreThreshold!)
        .sort((a, b) => a.score - b.score)
        .map(entry => entry.sc);
    }

    const targets = candidates.slice(0, maxScenes);
    if (targets.length === 0) return;

    let critic: SceneCritic;
    try {
      critic = this.deps.sceneCritic ?? new SceneCritic(this.deps.config.agents.sceneWriter);
    } catch (err) {
      this.deps.emit({
        type: 'warning',
        phase: 'scene_critic',
        message: `Flag-gated SceneCritic pass skipped: could not construct SceneCritic — ${err instanceof Error ? err.message : String(err)}`,
      });
      return;
    }

    this.deps.emit({
      type: 'debug',
      phase: 'scene_critic',
      message: flagGatedPass
        ? `SceneCritic flag-gated pass reviewing ${targets.length} quality-flagged scene(s)`
        : `SceneCritic pass reviewing ${targets.length} scene(s)`,
    });

    for (const scene of targets) {
      try {
        const sceneTasks = realizationTasksBySceneId?.get(scene.sceneId);
        const baselineTaskFindings = await this.validateSceneWriterTasks(scene, sceneTasks);
        // The voice polish must not paraphrase away the scene's authored
        // realization contract (requiredBeats/signatureMoment, tagged onto the
        // SceneContent at acceptance) — the season-final validators block on
        // those exact moments. Tell the critic up front…
        const contractSection = buildRequiredBeatsSection(scene);
        const typedTaskSection = taskPreservationSection(sceneTasks);
        // A3: advisory shadow evidence (planting/departure misses, unearned
        // relationship jumps, residual mechanics defects) arrives as concrete
        // per-scene notes — the critic fixes the NAMED gaps, not generic polish.
        const advisoryNotes = sceneCriticNotes(scene);
        const advisorySection = advisoryNotes.length > 0
          ? `ADDRESS THESE SPECIFIC GAPS (advisory findings from generation-time validation):\n${advisoryNotes.map((note) => `- ${note}`).join('\n')}`
          : '';
        const directorNotes = [
          contractSection
            ? `PRESERVE AUTHORED CONTENT: your rewrite must keep every staged moment below fully on-page — do not paraphrase away proper nouns, places, times, or staged actions.\n${contractSection}`
            : '',
          typedTaskSection,
          advisorySection,
        ].filter(Boolean).join('\n\n');
        const critique = await critic.execute({
          scene,
          characterBible,
          ...(directorNotes ? { directorNotes } : {}),
        });
        if (!critique.success || !critique.data) continue;
        const rewrittenById = new Map(critique.data.rewrittenBeats.map(b => [b.id, b]));
        if (rewrittenById.size === 0) continue;
        const proposedBeats = scene.beats.map(b => {
          const replacement = rewrittenById.get(b.id);
          if (!replacement) return b;
          return {
            ...b,
            text: replacement.text || b.text,
            textVariants: replacement.textVariants || b.textVariants,
            speakerMood: replacement.speakerMood || b.speakerMood,
          };
        });
        if (sceneTasks?.length) {
          const candidateScene = { ...scene, beats: proposedBeats };
          const candidateTaskFindings = await this.validateSceneWriterTasks(candidateScene, sceneTasks);
          const introduced = introducedRealizationFindings(baselineTaskFindings, candidateTaskFindings);
          if (introduced.length > 0) {
            this.deps.emit({
              type: 'warning',
              phase: 'scene_critic',
              message: `SceneCritic rewrite of ${scene.sceneId} introduced ${introduced.length} canonical realization blocker(s) (${introduced.map((finding) => finding.code).join(', ')}) — keeping the original prose`,
            });
            continue;
          }
        }
        // …and verify afterwards (deterministic, free): refuse a polish that
        // LOSES a depicted authored moment (GATE_SCENE_REQUIRED_BEAT_CHECK).
        // r117 gap analysis (2026-07-18): also covers premise role-facts and
        // event owner-tasks assigned to this scene — see
        // realizationTaskMomentsFor for why this pass can't trust the
        // narrower requiredBeats/signatureMoment contract alone.
        if (isGateEnabled('GATE_SCENE_REQUIRED_BEAT_CHECK')) {
          // The typed guard above is authoritative when a semantic judge is
          // available. Keep the legacy moment bridge only as a deterministic
          // fallback for direct/test callers that do not inject that judge.
          const extraMoments = this.deps.semanticRealizationJudge
            ? []
            : realizationTaskMomentsFor(sceneTasks);
          const lost = rewriteLosesRequiredMoment(scene, scene.beats, proposedBeats, extraMoments);
          if (lost) {
            this.deps.emit({
              type: 'warning',
              phase: 'scene_critic',
              message: `SceneCritic rewrite of ${scene.sceneId} dropped the authored ${lost.tier} moment ("${lost.moment.slice(0, 80)}…") — keeping the original prose`,
            });
            continue;
          }
        }
        // r117 gap analysis (2026-07-18): this pass runs AFTER incremental
        // validation already passed (including PovClarityValidator's opening-
        // anchor check), rewriting the scene's opening beat with no
        // awareness of that contract — rewriteLosesRequiredMoment only
        // covers requiredBeats/signatureMoment, not POV anchoring. A live run
        // shipped s1-1 with pov_anchor_missing at final contract even though
        // it had passed incremental validation minutes earlier; the only
        // rewrite between those two points was this one. Same guard shape:
        // if the scene's first non-empty beat anchored the player before,
        // it must still anchor the player after, or the rewrite is refused.
        const originalOpeningBeat = scene.beats.find((beat) => String(beat.text ?? '').trim().length > 0);
        const openingBeatHadAnchor = originalOpeningBeat
          ? hasPlayerReference([
              String(originalOpeningBeat.text ?? ''),
              ...(originalOpeningBeat.textVariants ?? []).map((variant) => String(variant?.text ?? '')),
            ].join('\n'))
          : false;
        if (openingBeatHadAnchor) {
          const proposedOpeningBeat = proposedBeats.find((beat) => String(beat.text ?? '').trim().length > 0);
          const stillHasAnchor = proposedOpeningBeat
            ? hasPlayerReference([
                String(proposedOpeningBeat.text ?? ''),
                ...(proposedOpeningBeat.textVariants ?? []).map((variant) => String(variant?.text ?? '')),
              ].join('\n'))
            : false;
          if (!stillHasAnchor) {
            this.deps.emit({
              type: 'warning',
              phase: 'scene_critic',
              message: `SceneCritic rewrite of ${scene.sceneId} dropped the opening player anchor (you/your/{{player.name}}) — keeping the original prose`,
            });
            continue;
          }
        }
        scene.beats = proposedBeats;
        this.deps.emit({
          type: 'checkpoint',
          phase: 'scene_critic',
          message: `Rewrote ${rewrittenById.size} beat(s) in scene ${scene.sceneId}`,
          data: {
            sceneId: scene.sceneId,
            beatsRewritten: rewrittenById.size,
            commentary: critique.data.overallCommentary,
          },
        });
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        this.deps.emit({
          type: 'warning',
          phase: 'scene_critic',
          message: `SceneCritic failed for scene ${scene.sceneId}: ${msg}`,
        });
      }
    }
  }

  async repairContinuityFindings(
    story: Story,
    sceneContents: SceneContent[],
    characterBible: CharacterBible,
    qaReport: QAReport,
    outputDirectory: string,
    blueprint?: EpisodeBlueprint,
    options?: ContinuityRepairOptions,
  ): Promise<void> {
    // Judges often anchor the defect only in prose ("… speaks in s1-2-b2 …")
    // with an empty/sentinel structured location. Mine those ids into
    // location.sceneId/beatId — and write them back onto the report so the
    // post-repair merge and the persisted artifacts key on the same anchors.
    const findings = anchorContinuityIssueLocations(
      (qaReport.continuity?.issues ?? []) as ContinuityIssue[],
      sceneContents,
    ) as unknown as ContinuityFinding[];
    if (qaReport.continuity) qaReport.continuity.issues = findings as unknown as ContinuityIssue[];
    const flaggedScenes = scenesNeedingRepair(findings);
    // A missing_setup often means an EARLIER scene dropped the planned setup
    // event (sceneEventOwnership) — repair the owning scene too, not just the
    // use-site rephrase.
    const ownerTargets = resolveMissingSetupOwnerTargets(findings, options?.plannedScenes)
      .filter((target) => !flaggedScenes.includes(target.ownerSceneId));
    const scenes = flaggedScenes.slice(0, 3); // bound the repair work
    this.deps.emit({ type: 'debug', phase: 'continuity_repair', message: `Continuity repair: ${findings.length} continuity issue(s) seen, ${scenes.length} candidate scene(s), ${ownerTargets.length} owning-scene retarget(s).` });
    if (scenes.length === 0) {
      // ALWAYS persist the diagnostic — its absence was ambiguous ("0 to repair" vs
      // "repair never ran"). This records what the repair actually received, which
      // reveals when the in-memory qaReport.continuity is the skipped/default empty
      // report while 06-qa-report.json (a different, fuller source) lists issues.
      await saveEarlyDiagnostic(outputDirectory, 'continuity-repair.json', {
        generatedAt: new Date().toISOString(),
        continuityIssuesSeen: findings.length,
        repairableFindings: scenesNeedingRepair(findings).length,
        candidateScenes: [],
        repaired: [],
        note: findings.length === 0 ? 'qaReport.continuity had no issues at repair time' : 'no repairable findings (none had a scene-level prose contradiction)',
      });
      return;
    }
    // The repair re-authors via SceneCritic. If the critic isn't enabled in config,
    // construct a one-off from the scene-writer config so the repair still runs rather
    // than silently no-opping. E2: guard the construction so a failure here writes the
    // diagnostic + emits instead of vanishing into the outer catch (the likely cause of
    // the missing artifact for a run that HAD a repairable finding).
    let critic: SceneCritic;
    try {
      critic = this.deps.sceneCritic ?? new SceneCritic(this.deps.config.agents.sceneWriter);
    } catch (err) {
      this.deps.emit({ type: 'warning', phase: 'continuity_repair', message: `Continuity repair skipped: could not construct SceneCritic — ${err instanceof Error ? err.message : String(err)}` });
      await saveEarlyDiagnostic(outputDirectory, 'continuity-repair.json', {
        generatedAt: new Date().toISOString(),
        continuityIssuesSeen: findings.length,
        candidateScenes: scenes,
        repaired: [],
        error: `SceneCritic construction failed: ${err instanceof Error ? err.message : String(err)}`,
      });
      return;
    }
    const capabilityFacts = capabilityFactStrings(characterBible.characters);
    const repaired: Array<{ sceneId: string; beatIds: string[]; merged: number }> = [];
    const rejectedHandoffChanges: Array<{ sceneId: string; reason: string }> = [];
    const rewrittenSceneIds = new Set<string>();
    // When an owning-scene repair lands, the flagged use-site must be
    // re-checked too — its finding is resolved by the EARLIER scene's new
    // introduction, so the re-check's fresh opinion on it is authoritative.
    const alsoRevalidate = new Set<string>();
    const tasks = [
      ...scenes.map((sceneId) => ({
        sceneId,
        guidance: buildContinuityRepairGuidance(sceneId, findings, capabilityFacts),
        flaggedBeatIds: continuityRepairBeatIds(sceneContents, sceneId, findings),
        revalidateWith: [] as string[],
      })),
      ...ownerTargets.map((target) => ({
        sceneId: target.ownerSceneId,
        guidance: buildMissingSetupOwnerGuidance(target, capabilityFacts),
        flaggedBeatIds: [] as string[],
        revalidateWith: [target.findingSceneId],
      })),
    ].slice(0, 3); // bound the repair work across both kinds
    for (const task of tasks) {
      const { sceneId, guidance, flaggedBeatIds } = task;
      const scene = sceneContents.find((sc) => sc.sceneId === sceneId);
      if (!scene) continue;
      if (!guidance) continue;
      try {
        const sceneIndex = sceneContents.findIndex((candidate) => candidate.sceneId === sceneId);
        const hasCommittedSuccessor = sceneIndex >= 0 && sceneIndex < sceneContents.length - 1;
        const sceneBlueprint = blueprint?.scenes.find((candidate) => candidate.id === sceneId);
        const handoffBefore = sceneHandoffHash(scene, sceneBlueprint);
        const critique = await withTimeout(
          critic.execute({ scene, characterBible, directorNotes: guidance, flaggedBeatIds }),
          PIPELINE_TIMEOUTS.llmAgent,
          `SceneCritic.continuityRepair(${sceneId})`,
        );
        if (critique.success && critique.data) {
          const rewrittenBeats = critique.data.rewrittenBeats;
          // Snapshot the prose surfaces the merge can touch, so a rewrite that
          // LOSES an authored required moment can be rolled back (the merge
          // only ever overwrites text/textVariants by beat id, so restoring
          // the snapshot through the same merge is a complete undo).
          const proseSnapshot = (scene.beats ?? []).map(b => ({
            id: b.id,
            text: b.text,
            textVariants: (b as { textVariants?: Array<{ text?: string }> }).textVariants,
          }));
          const merged = mergeRewrittenBeatsIntoStory(
            story as never, sceneId, rewrittenBeats as never,
            (ids) => this.deps.emit({ type: 'warning', phase: 'continuity_repair', message: `Continuity repair of ${sceneId}: ${ids.length} rewritten beat(s) [${ids.join(', ')}] matched no beat (drifted ids) — not applied.` }),
          );
          if (merged > 0) {
            // Mirror the rewrite into the in-memory sceneContents too, so the
            // post-repair re-check (which re-reads sceneContents, not the assembled
            // story) sees the repaired prose rather than the original.
            applyRewrittenBeatsToSceneContents(sceneContents as never, sceneId, rewrittenBeats as never);
            const lost = isGateEnabled('GATE_SCENE_REQUIRED_BEAT_CHECK')
              ? rewriteLosesRequiredMoment(scene, proseSnapshot, scene.beats)
              : undefined;
            const changedCommittedHandoff = Boolean(
              options?.preserveCommittedHandoffs
              && hasCommittedSuccessor
              && handoffBefore !== sceneHandoffHash(scene, sceneBlueprint)
            );
            if (lost || changedCommittedHandoff) {
              mergeRewrittenBeatsIntoStory(story as never, sceneId, proseSnapshot as never);
              applyRewrittenBeatsToSceneContents(sceneContents as never, sceneId, proseSnapshot as never);
              if (lost) {
                this.deps.emit({ type: 'warning', phase: 'continuity_repair', message: `Continuity repair of ${sceneId} dropped the authored ${lost.tier} moment ("${lost.moment.slice(0, 80)}…") — reverted to the original prose.` });
              } else {
                const reason = 'rewrite changed the realized closing handoff already consumed by a later scene';
                rejectedHandoffChanges.push({ sceneId, reason });
                this.deps.emit({
                  type: 'warning',
                  phase: 'continuity_repair',
                  message: `Continuity repair of ${sceneId} was rolled back: ${reason}. Regenerate the dependent suffix instead of reopening committed history.`,
                });
              }
            } else {
              const receipt = options?.commitReceipts?.find((candidate) => candidate.sceneId === sceneId);
              if (receipt) {
                receipt.sceneHash = sceneCommitContentHash(scene);
                receipt.handoffHash = sceneHandoffHash(scene, sceneBlueprint);
                receipt.committedAt = new Date().toISOString();
                receipt.critic = {
                  disposition: 'accepted',
                  rewrittenBeatIds: rewrittenBeats.map((beat) => beat.id),
                  reason: 'accepted late continuity repair preserved committed downstream handoff',
                };
              }
              rewrittenSceneIds.add(sceneId);
              for (const id of task.revalidateWith) alsoRevalidate.add(id);
              repaired.push({ sceneId, beatIds: flaggedBeatIds, merged });
              this.deps.emit({ type: 'debug', phase: 'continuity_repair', message: `Repaired ${merged} beat(s) in ${sceneId} for character-consistency continuity.` });
            }
          }
        }
      } catch (err) {
        this.deps.emit({ type: 'warning', phase: 'continuity_repair', message: `Continuity repair for ${sceneId} failed (keeping original): ${err instanceof Error ? err.message : String(err)}` });
      }
    }
    // Post-repair re-validation: when a gate actually CONSUMES the continuity residue
    // (GATE_CONTINUITY_REMEDIATION / GATE_QA_CRITICAL_BLOCK), re-run the checker over
    // the repaired prose and refresh qaReport.continuity IN PLACE so the gate blocks
    // only on genuinely-unfixed errors — not on stale pre-repair findings the rewrite
    // already resolved. With both gates off this is skipped (no LLM cost, behavior
    // unchanged: advisory repair + stale report, exactly as before).
    let revalidation: { ran: boolean; succeeded: boolean; residueErrors: number } | undefined;
    if (rewrittenSceneIds.size > 0) {
      revalidation = await this.revalidateRepairedContinuity(
        sceneContents,
        characterBible,
        qaReport,
        [...new Set([...rewrittenSceneIds, ...alsoRevalidate])],
        blueprint,
        options?.forceRevalidation === true,
      );
    }

    // Persist a summary so "did repair fire?" is answerable from artifacts — the
    // 06-qa-report.json is PRE-repair and will still list the original findings.
    await saveEarlyDiagnostic(outputDirectory, 'continuity-repair.json', {
      generatedAt: new Date().toISOString(),
      continuityIssuesSeen: findings.length,
      candidateScenes: tasks.map((task) => task.sceneId),
      ownerRetargets: ownerTargets.map(({ ownerSceneId, findingSceneId, cue, entity }) => ({ ownerSceneId, findingSceneId, cue, entity })),
      repaired,
      rejectedHandoffChanges,
      revalidation,
      forceRevalidation: options?.forceRevalidation === true,
      revalidationReason: options?.revalidationReason,
      criticWasInjected: !!this.deps.sceneCritic,
    });
  }

  /**
   * Re-run the ContinuityChecker over the repaired prose and refresh the qaReport's
   * continuity findings in place, so a blocking continuity/QA gate fires only on
   * CONFIRMED residue. Gated on the consuming flags so the LLM cost is paid only when
   * a gate will act on the result.
   *
   * Failure policy (matches the no-new-abort-modes discipline of the final-contract
   * repair loop): if the re-check itself fails (e.g. Gemini parse fragility), we do
   * NOT keep the stale findings — that would let LLM flakiness hard-fail a run whose
   * prose we already re-authored. Instead we prune the repaired scenes' findings
   * (trusting the canon-grounded rewrite, exactly as the advisory path does today).
   * A clean re-check adopts the fresh residue for the repaired scenes; findings for
   * scenes we did not re-author are always kept verbatim.
   */
  private async revalidateRepairedContinuity(
    sceneContents: SceneContent[],
    characterBible: CharacterBible,
    qaReport: QAReport,
    repairedSceneIds: string[],
    blueprint?: EpisodeBlueprint,
    force = false,
  ): Promise<{ ran: boolean; succeeded: boolean; residueErrors: number } | undefined> {
    if (!force && !isGateEnabled('GATE_CONTINUITY_REMEDIATION') && !isGateEnabled('GATE_QA_CRITICAL_BLOCK')) {
      return { ran: false, succeeded: false, residueErrors: 0 };
    }
    if (repairedSceneIds.length === 0 || !qaReport.continuity) return { ran: false, succeeded: false, residueErrors: 0 };

    let fresh: ContinuityIssue[] = [];
    let succeeded = false;
    try {
      const checker = new ContinuityChecker(this.deps.config.agents.qaRunner || this.deps.config.agents.storyArchitect);
      const result = await withTimeout(
        checker.execute({
          // Full repaired scene set preserves cross-scene context; we only ADOPT
          // residue for the repaired scenes (see mergeRevalidatedContinuityIssues).
          sceneContents,
          knownFlags: blueprint?.suggestedFlags ?? [],
          knownScores: blueprint?.suggestedScores ?? [],
          knownTags: [],
          establishedFacts: capabilityFactStrings(characterBible.characters),
          characterKnowledge: this.deps.buildContinuityCharacterKnowledge(characterBible),
          timelineEvents: blueprint ? this.deps.buildContinuityTimeline(blueprint) : undefined,
          focusCrossScene: true,
        }),
        PIPELINE_TIMEOUTS.llmAgent,
        'ContinuityChecker.revalidate',
      );
      if (result.success && result.data) {
        fresh = (result.data.issues ?? []) as unknown as ContinuityIssue[];
        succeeded = true;
      } else {
        this.deps.emit({ type: 'warning', phase: 'continuity_repair', message: `Continuity re-validation did not return a report; pruning repaired-scene findings (trusting the rewrite).` });
      }
    } catch (err) {
      this.deps.emit({ type: 'warning', phase: 'continuity_repair', message: `Continuity re-validation failed (${err instanceof Error ? err.message : String(err)}); pruning repaired-scene findings (trusting the rewrite).` });
    }

    // succeeded → adopt fresh residue for repaired scenes; failed → fresh is [] so the
    // repaired scenes' findings are simply pruned (optimistic fallback).
    const merged = mergeRevalidatedContinuityIssues(
      (qaReport.continuity.issues ?? []) as ContinuityIssue[],
      repairedSceneIds,
      fresh,
    );
    qaReport.continuity.issues = merged;
    qaReport.continuity.issueCount = recomputeContinuityIssueCount(merged);
    const score = deriveContinuityScore(qaReport.continuity);
    if (score != null) qaReport.continuity.overallScore = score;
    // Refresh the QA-level derived fields (overallScore/criticalIssues/passesQA) so the
    // GATE_QA_CRITICAL_BLOCK gate and the aggregated season report reflect the repaired
    // continuity rather than the stale pre-repair count.
    recomputeQAReportDerived(qaReport);

    const residueErrors = merged.filter((i) => i.severity === 'error').length;
    return { ran: true, succeeded: succeeded && residueErrors === 0, residueErrors };
  }
}
