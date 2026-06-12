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
import { isGateEnabled } from '../remediation/gateDefaults';
import { stabilizeByHysteresis } from '../remediation/judgeStabilizer';
import { withTimeout, PIPELINE_TIMEOUTS } from '../utils/withTimeout';

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
  const carriesHook = (b: BridgeBeat): boolean => {
    if (hookTokens.length === 0) return false;
    const text = [b.text, ...((b.textVariants || []).map(v => v.text))].filter(Boolean).join(' ').toLowerCase();
    const hits = hookTokens.filter(t => text.includes(t)).length;
    return hits / hookTokens.length >= 0.3;
  };
  const hookCoverage = sharedTarget ? terminalPayoffs.filter(carriesHook).length : 0;
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
    message: `Repairing weak ${cliffhangerPlan.mappedStructuralRole} cliffhanger (${analysis.score}/100): ${analysis.suggestions.join('; ')}`,
  });

  const improvement = await withTimeout(
    validator.improveCliffhanger(episode, cliffhangerPlan, analysis),
    PIPELINE_TIMEOUTS.llmAgent,
    `CliffhangerValidator.improveCliffhanger(${brief.episode.number})`,
  );

  if (!improvement.success || !improvement.data?.improvedText) {
    deps.emit({
      type: 'warning',
      phase: 'cliffhanger_repair',
      message: `Cliffhanger repair failed: ${improvement.error || 'no improved text returned'}`,
    });
    // Soft-gate observability: record the (failed) repair attempt best-effort
    // when stabilization is active. Never blocks; recordRemediationSafe swallows.
    if (stabilizationOn) {
      await deps.recordRemediationSafe({
        rule: 'cliffhanger_stabilized', scope: 'episode', attempted: 1,
        succeeded: false, degraded: false, blocked: false, attempts: 1,
        storyId: (brief.story as typeof brief.story & { id?: string })?.id,
        details: `Cliffhanger repair failed for episode ${brief.episode.number} (score ${analysis.score}/100, quality ${analysis.quality})`,
      });
    }
    return;
  }

  if (sharedTarget) {
    // Shared coda: every terminal payoff now flows through one hook-bearing
    // trunk beat before leaving the episode — no path misses the cliffhanger.
    const codaId = `${finalScene.sceneId}-cliffhanger-coda`;
    let coda = (finalScene.beats || []).find(b => b.id === codaId) as BridgeBeat | undefined;
    if (!coda) {
      coda = {
        id: codaId,
        text: improvement.data.improvedText,
        isChoicePoint: false,
        isChoiceBridge: true,
        nextSceneId: sharedTarget,
        visualMoment: improvement.data.improvedText.split(/[.!?]/)[0]?.trim(),
        emotionalRead: cliffhangerPlan.emotionalCharge,
        intensityTier: cliffhangerPlan.intensity === 'high' ? 'dominant' : 'supporting',
      } as unknown as BridgeBeat;
      finalScene.beats.push(coda as never);
    } else {
      coda.text = improvement.data.improvedText;
    }
    for (const p of terminalPayoffs) {
      p.nextBeatId = codaId;
      p.nextSceneId = undefined;
      p.isChoiceBridge = false;
    }
    deps.emit({
      type: 'debug',
      phase: 'cliffhanger_repair',
      message: `Cliffhanger coda installed on ${finalScene.sceneId}: ${terminalPayoffs.length} payoff path(s) rewired through ${codaId} (hook coverage was ${hookCoverage}/${terminalPayoffs.length}).`,
    });
  } else {
    finalBeat.text = improvement.data.improvedText;
    finalBeat.visualMoment = finalBeat.visualMoment || improvement.data.improvedText.split(/[.!?]/)[0]?.trim();
    finalBeat.emotionalRead = finalBeat.emotionalRead || cliffhangerPlan.emotionalCharge;
    finalBeat.intensityTier = cliffhangerPlan.intensity === 'high' ? 'dominant' : (finalBeat.intensityTier || 'supporting');
  }
  finalBeat.mustShowDetail = finalBeat.mustShowDetail || cliffhangerPlan.hook;
  finalScene.keyMoments = Array.from(new Set([...(finalScene.keyMoments || []), cliffhangerPlan.hook]));
  finalScene.continuityNotes = Array.from(new Set([...(finalScene.continuityNotes || []), `Cliffhanger repaired: ${improvement.data.explanation}`]));

  const repairedEpisode = deps.assembleEpisode(
    brief,
    worldBible,
    characterBible,
    blueprint,
    sceneContents,
    choiceSets,
    undefined,
    encounters,
  );
  const repairedAnalysis = validator.quickAnalyze(repairedEpisode, cliffhangerPlan);
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
      rule: 'cliffhanger_stabilized', scope: 'episode', attempted: 1,
      succeeded: true, degraded: false, blocked: false, attempts: 1,
      storyId: (brief.story as typeof brief.story & { id?: string })?.id,
      details: `Cliffhanger repaired for episode ${brief.episode.number}: ${analysis.score}/100 → ${repairedAnalysis.score}/100`,
    });
  }
}
