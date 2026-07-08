/**
 * LLM turn-contract repair handler for the final-contract repair loop.
 *
 * SceneTurnRealizationValidator blocks any planner-source turn contract whose
 * `centralTurn` is still `isGenericScenePlannerText` ("generic planner central
 * turn"). That defect is blueprint METADATA, not prose — the scene-prose repair
 * handler explicitly skips it (see appendSceneTurnFallback) because no prose
 * rewrite can change the contract the validator reads. Historically that made
 * the finding unrepairable: the loop exhausted and the whole run aborted at
 * 100% (bite-me 2026-07-07, s1-7).
 *
 * This handler repairs the CORRECT surface: for each flagged scene it makes one
 * focused LLM call that reads the scene's already-written prose and states the
 * central turn that prose ALREADY dramatizes, then replaces the scaffold
 * `turnContract.centralTurn`/`turnEvent` on the assembled story scene
 * (`scene.turnContract` shadows the planned contract in the validator's
 * `contractFor`). The authored turn is accepted only when it is concrete
 * (not scaffold, not question-shaped) AND predicted to clear the validator's
 * follow-up depiction check (`momentDepicted` against the same prose the
 * validator scores) — a failed re-author keeps the scaffold, so the gate still
 * blocks and the run is never worse than before.
 *
 * Architecture-time counterpart: `StoryArchitect.reauthorGenericPlannerTurns`
 * fixes the same defect at minute ~3, before any prose exists. This handler is
 * the net for scaffolds that slip through (both gated by
 * GATE_SCENE_TURN_REAUTHOR).
 */

import type { Scene } from '../../types';
import type { Story } from '../../types/story';
import { isGenericScenePlannerText, isQuestionShapedTurnText } from '../utils/sceneContractBuilders';
import { collectReaderFacingTexts } from '../validators/encounterTextSurfaces';
import { PIPELINE_TIMEOUTS, withTimeout } from '../utils/withTimeout';
import type { ContractRepairHandler } from './finalContractRepair';
import { momentDepicted } from './realizationScoring';

/** The single capability this handler needs — StoryArchitect implements it structurally. */
export interface SceneTurnReauthorAgent {
  reauthorSceneTurn(ctx: {
    sceneId: string;
    sceneName?: string;
    role?: string;
    location?: string;
    description?: string;
    episodeSynopsis?: string;
    prose?: string;
  }): Promise<string | null>;
}

const GENERIC_PLANNER_TURN_FINDING_RE = /generic planner central turn/i;
const SCENE_ID_FROM_MESSAGE_RE = /Scene "([^"]+)"/;

/**
 * Mirror of the validator's sceneProse(): the prose surface the authored turn
 * will be scored against, so the predicted-clear check here matches the real
 * re-validation.
 */
function sceneProseFor(scene: Scene): string {
  const beatText = (scene.beats ?? []).map((beat) => [
    beat.text,
    beat.visualMoment,
    beat.primaryAction,
    beat.emotionalRead,
    beat.relationshipDynamic,
    beat.dramaticIntent?.statusBefore,
    beat.dramaticIntent?.visibleTurn,
    beat.dramaticIntent?.statusAfter,
    beat.sequenceIntent?.startState,
    beat.sequenceIntent?.turningPoint,
    beat.sequenceIntent?.endState,
    ...(beat.textVariants || []).map((variant) => variant.text),
  ].filter(Boolean).join(' '));
  return [scene.name, ...beatText, ...collectReaderFacingTexts(scene)].filter(Boolean).join(' ');
}

interface RepairTarget {
  scene: Scene;
  episodeNumber: number;
}

export function collectGenericTurnScenes(
  story: Story,
  blockingIssues: Array<{ validator?: string; message?: string; sceneId?: string }>,
): RepairTarget[] {
  const flaggedSceneIds = new Set<string>();
  for (const issue of blockingIssues) {
    if (issue.validator !== 'SceneTurnRealizationValidator') continue;
    if (!GENERIC_PLANNER_TURN_FINDING_RE.test(issue.message || '')) continue;
    const sceneId = issue.sceneId || SCENE_ID_FROM_MESSAGE_RE.exec(issue.message || '')?.[1];
    if (sceneId) flaggedSceneIds.add(sceneId);
  }
  if (flaggedSceneIds.size === 0) return [];

  const targets: RepairTarget[] = [];
  for (const episode of story.episodes ?? []) {
    for (const scene of episode.scenes ?? []) {
      if (scene.id && flaggedSceneIds.has(scene.id)) {
        targets.push({ scene, episodeNumber: episode.number });
      }
    }
  }
  return targets;
}

export interface SceneTurnContractRepairOptions {
  /** Provides the re-author agent (a StoryArchitect built from config). Null disables the handler for the round. */
  architect: () => SceneTurnReauthorAgent | null;
  emit?: (message: string) => void;
  /** Scenes re-authored per round cap (default 4) so a pathological report can't fan out unbounded LLM spend. */
  maxScenesPerRound?: number;
}

/**
 * Build the ContractRepairHandler. Plugs into runFinalContractRepair alongside
 * the deterministic + scene-prose handlers; the loop re-validates after each
 * round, so a successful re-author clears the generic-turn finding on the next
 * validation pass.
 */
export function buildSceneTurnContractRepairHandler(opts: SceneTurnContractRepairOptions): ContractRepairHandler {
  // Persists across repair rounds (built once per enforcement): a scene whose
  // re-author already failed is retried only when no fresh scenes remain.
  const attempted = new Set<string>();
  return async ({ story, blockingIssues }) => {
    const all = collectGenericTurnScenes(story as Story, blockingIssues);
    if (all.length === 0) return { story, changed: false };

    const fresh = all.filter((t) => !attempted.has(t.scene.id));
    const batch = (fresh.length ? fresh : all).slice(0, opts.maxScenesPerRound ?? 4);

    const architect = opts.architect();
    if (!architect) {
      opts.emit?.('Turn-contract repair skipped: no re-author agent available.');
      return { story, changed: false };
    }

    let repaired = 0;
    let calls = 0;
    for (const target of batch) {
      const { scene, episodeNumber } = target;
      attempted.add(scene.id);
      const prose = sceneProseFor(scene);
      if (!prose.trim()) {
        opts.emit?.(`Turn-contract repair for "${scene.id}": scene has no prose to derive a turn from — scaffold kept.`);
        continue;
      }
      try {
        const authored = await withTimeout(
          architect.reauthorSceneTurn({
            sceneId: scene.id,
            sceneName: scene.name,
            prose,
          }),
          PIPELINE_TIMEOUTS.llmAgent,
          `StoryArchitect.reauthorSceneTurn(${scene.id})`,
        );
        calls += 1;
        if (!authored || isGenericScenePlannerText(authored) || isQuestionShapedTurnText(authored)) {
          opts.emit?.(`Turn-contract repair for "${scene.id}": re-author produced no usable concrete turn — scaffold kept.`);
          continue;
        }
        // Predicted-clear: the validator's next check scores the turn against
        // this same prose. Accepting a turn the prose does not depict would
        // trade one blocking finding for another.
        if (!momentDepicted('RequiredBeatRealizationValidator', authored, prose)) {
          opts.emit?.(`Turn-contract repair for "${scene.id}": authored turn is not depicted by the scene prose — scaffold kept: "${authored}"`);
          continue;
        }
        const existing = scene.turnContract;
        scene.turnContract = {
          turnId: existing?.turnId || `${scene.id}-turn`,
          source: existing?.source || 'planner',
          centralTurn: authored,
          turnEvent: authored,
          beforeState: existing?.beforeState || '',
          afterState: existing?.afterState || '',
          handoff: existing?.handoff || '',
        };
        repaired += 1;
        opts.emit?.(`Turn-contract repair: episode ${episodeNumber} scene "${scene.id}" turn re-authored from its prose: "${authored}"`);
      } catch (err) {
        opts.emit?.(`Turn-contract repair for "${scene.id}" failed (scaffold kept): ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    if (repaired === 0) {
      if (calls > 0) {
        opts.emit?.(`Turn-contract repair made ${calls} re-author call(s) but none produced a usable turn (${batch.length} scaffold scene(s) remain).`);
      }
      return { story, changed: false };
    }
    return {
      story,
      changed: true,
      record: {
        rule: 'final_contract_scene_turn_contract',
        scope: 'scene',
        attempted: batch.length,
        succeeded: repaired === batch.length,
        degraded: repaired < batch.length,
        blocked: false,
        attempts: calls,
        details: `Re-authored ${repaired} generic planner turn contract(s) from scene prose`,
      },
    };
  };
}
