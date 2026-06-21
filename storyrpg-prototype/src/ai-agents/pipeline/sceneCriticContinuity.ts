/**
 * SceneCritic rewrite pass + character-consistency continuity repair.
 *
 * Faithful port of FullStoryPipeline.runSceneCriticPass,
 * repairContinuityFindings, and revalidateRepairedContinuity (pure move).
 * runSceneCriticPass runs the optional voice/style rewrite over the
 * lowest-scoring scenes; repairContinuityFindings re-authors scenes flagged by
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
  recomputeContinuityIssueCount,
  deriveContinuityScore,
  recomputeQAReportDerived,
} from '../agents/QAAgents';
import { capabilityFactStrings } from './characterCanonFacts';
import {
  scenesNeedingRepair,
  selectRepairableContinuityFindings,
  buildContinuityRepairGuidance,
  mergeRewrittenBeatsIntoStory,
  applyRewrittenBeatsToSceneContents,
  mergeRevalidatedContinuityIssues,
  type ContinuityFinding,
} from './continuityRepair';
import { isGateEnabled } from '../remediation/gateDefaults';
import { rewriteLosesRequiredMoment } from '../remediation/sceneRealizationGuard';
import { buildRequiredBeatsSection } from '../prompts/requiredBeatsPromptSection';
import { saveEarlyDiagnostic } from '../utils/pipelineOutputWriter';
import { withTimeout, PIPELINE_TIMEOUTS } from '../utils/withTimeout';
import type { PipelineEvent } from './events';

export interface SceneCriticContinuityDeps {
  config: PipelineConfig;
  emit: (event: Omit<PipelineEvent, 'timestamp'>) => void;
  /** Current SceneCritic instance, or null when one was never constructed. */
  readonly sceneCritic: SceneCritic | null;
  buildContinuityCharacterKnowledge: (
    characterBible: CharacterBible,
  ) => Array<{ characterId: string; knows: string[]; doesNotKnow: string[] }>;
  buildContinuityTimeline: (blueprint: EpisodeBlueprint) => Array<{ event: string; when: string }>;
}

export class SceneCriticContinuity {
  constructor(private deps: SceneCriticContinuityDeps) {}

  async runSceneCriticPass(
    sceneContents: SceneContent[],
    characterBible: CharacterBible,
  ): Promise<void> {
    const cfg = this.deps.config.sceneCritic;
    if (!cfg?.enabled || !this.deps.sceneCritic) return;
    if (!sceneContents.length) return;

    const maxScenes = Math.max(1, cfg.maxScenesPerEpisode ?? 3);
    const candidates = [...sceneContents];

    // If a voiceScoreThreshold is configured, prefer scenes with a low score.
    if (typeof cfg.voiceScoreThreshold === 'number') {
      const scored = candidates
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
      candidates.length = 0;
      candidates.push(...scored);
    }

    const targets = candidates.slice(0, maxScenes);
    if (targets.length === 0) return;

    this.deps.emit({
      type: 'debug',
      phase: 'scene_critic',
      message: `SceneCritic pass reviewing ${targets.length} scene(s)`,
    });

    for (const scene of targets) {
      try {
        // The voice polish must not paraphrase away the scene's authored
        // realization contract (requiredBeats/signatureMoment, tagged onto the
        // SceneContent at acceptance) — the season-final validators block on
        // those exact moments. Tell the critic up front…
        const contractSection = buildRequiredBeatsSection(scene);
        const critique = await this.deps.sceneCritic.execute({
          scene,
          characterBible,
          ...(contractSection
            ? {
                directorNotes:
                  `PRESERVE AUTHORED CONTENT: your rewrite must keep every staged moment below fully on-page — do not paraphrase away proper nouns, places, times, or staged actions.\n${contractSection}`,
              }
            : {}),
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
        // …and verify afterwards (deterministic, free): refuse a polish that
        // LOSES a depicted authored moment (GATE_SCENE_REQUIRED_BEAT_CHECK).
        if (isGateEnabled('GATE_SCENE_REQUIRED_BEAT_CHECK')) {
          const lost = rewriteLosesRequiredMoment(scene, scene.beats, proposedBeats);
          if (lost) {
            this.deps.emit({
              type: 'warning',
              phase: 'scene_critic',
              message: `SceneCritic rewrite of ${scene.sceneId} dropped the authored ${lost.tier} moment ("${lost.moment.slice(0, 80)}…") — keeping the original prose`,
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
    options?: { forceRevalidation?: boolean; revalidationReason?: string },
  ): Promise<void> {
    const findings = (qaReport.continuity?.issues ?? []) as unknown as ContinuityFinding[];
    const scenes = scenesNeedingRepair(findings).slice(0, 3); // bound the repair work
    this.deps.emit({ type: 'debug', phase: 'continuity_repair', message: `Continuity repair: ${findings.length} continuity issue(s) seen, ${scenes.length} candidate scene(s).` });
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
    const rewrittenSceneIds = new Set<string>();
    for (const sceneId of scenes) {
      const scene = sceneContents.find((sc) => sc.sceneId === sceneId);
      if (!scene) continue;
      const guidance = buildContinuityRepairGuidance(sceneId, findings, capabilityFacts);
      if (!guidance) continue;
      const flaggedBeatIds = selectRepairableContinuityFindings(findings)
        .filter((f) => f.location?.sceneId === sceneId && f.location?.beatId)
        .map((f) => f.location!.beatId!);
      try {
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
            if (lost) {
              mergeRewrittenBeatsIntoStory(story as never, sceneId, proseSnapshot as never);
              applyRewrittenBeatsToSceneContents(sceneContents as never, sceneId, proseSnapshot as never);
              this.deps.emit({ type: 'warning', phase: 'continuity_repair', message: `Continuity repair of ${sceneId} dropped the authored ${lost.tier} moment ("${lost.moment.slice(0, 80)}…") — reverted to the original prose.` });
            } else {
              rewrittenSceneIds.add(sceneId);
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
        [...rewrittenSceneIds],
        blueprint,
        options?.forceRevalidation === true,
      );
    }

    // Persist a summary so "did repair fire?" is answerable from artifacts — the
    // 06-qa-report.json is PRE-repair and will still list the original findings.
    await saveEarlyDiagnostic(outputDirectory, 'continuity-repair.json', {
      generatedAt: new Date().toISOString(),
      continuityIssuesSeen: findings.length,
      candidateScenes: scenes,
      repaired,
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

    return { ran: true, succeeded, residueErrors: merged.filter((i) => i.severity === 'error').length };
  }
}
