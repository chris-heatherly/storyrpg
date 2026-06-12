/**
 * LLM scene-prose repair handler for the final-contract repair loop — the
 * "surgical scene repair" seam from the 2026-06-11 failure-cycle audit.
 *
 * The final contract names the exact episode + scene for each blocking issue
 * ("Authored required beat is missing from the final prose of episode 2 scene
 * s2-1: …"). Historically those findings hard-aborted the run AFTER every
 * episode had been generated — the most expensive failure mode in the corpus
 * (20 runs died at the final contract, median 73 minutes each, all work lost).
 *
 * This handler converts those aborts into bounded per-scene repair: group the
 * repairable blocking issues by scene, hand each scene to SceneCritic with the
 * finding's message + suggestion as director notes, merge the rewritten beats
 * back into the assembled story, and let the repair loop RE-VALIDATE. The run
 * aborts only when repair rounds exhaust with the issue still present.
 *
 * Scope: prose-realization findings on scenes that carry beats — the classes
 * where "rewrite this scene's prose to dramatize the named moment" is the fix
 * (RequiredBeatRealization, SignatureDevicePresence). Structural/encounter
 * classes are handled elsewhere (StructuralValidator.autoFix; the encounter
 * no-boilerplate regen at generation time).
 */

import type { Story } from '../../types/story';
import type { SceneCritic } from '../agents/SceneCritic';
import type { SceneContent } from '../agents/SceneWriter';
import { mergeRewrittenBeatsIntoStory } from '../pipeline/continuityRepair';
import { PIPELINE_TIMEOUTS, withTimeout } from '../utils/withTimeout';
import type { ContractRepairHandler, ContractRepairReport } from './finalContractRepair';

/**
 * Validators whose blocking findings are fixable by a localized scene-prose
 * re-author. Both name a concrete authored moment the prose failed to
 * dramatize, and both carry the sceneId. (Other treatment-fidelity validators
 * — e.g. AuthoredEpisodeConformance, an episode-list mismatch — are NOT prose
 * problems and must not be "repaired" by rewriting prose.)
 */
const SCENE_PROSE_REPAIRABLE_VALIDATORS = new Set([
  'RequiredBeatRealizationValidator',
  'SignatureDevicePresenceValidator',
]);

type RepairableIssue = ContractRepairReport['blockingIssues'][number];

/**
 * Pick the blocking issues this handler can act on and group them by scene.
 * Caps at `maxScenes` scenes per round (insertion order) so a pathological
 * report can't fan out into unbounded LLM spend in one round.
 */
export function selectSceneProseRepairs(
  blockingIssues: RepairableIssue[],
  maxScenes = 4,
): Map<string, RepairableIssue[]> {
  const groups = new Map<string, RepairableIssue[]>();
  for (const issue of blockingIssues ?? []) {
    if (!issue?.validator || !SCENE_PROSE_REPAIRABLE_VALIDATORS.has(issue.validator)) continue;
    if (!issue.sceneId) continue;
    const existing = groups.get(issue.sceneId);
    if (existing) {
      existing.push(issue);
    } else if (groups.size < maxScenes) {
      groups.set(issue.sceneId, [issue]);
    }
  }
  return groups;
}

/** Director notes for the SceneCritic rewrite, built from the findings. */
export function buildSceneRepairDirectorNotes(issues: RepairableIssue[]): string {
  const lines: string[] = [
    'The final-story contract flagged this scene. Fix EVERY issue below by rewriting the scene\'s beat prose — dramatize each named moment ON-PAGE with concrete action, dialogue, and sensory detail. Do not summarize, allude to, or skip the staged moment.',
  ];
  for (const issue of issues) {
    lines.push(`- ${issue.message ?? 'unspecified finding'}${issue.suggestion ? ` (fix: ${issue.suggestion})` : ''}`);
  }
  lines.push(
    'Keep beat ids, choice points, speakers, and established plot intact. Weave the missing moment into the existing beats (extend or rewrite beat text/textVariants); never contradict events already on the page.',
  );
  return lines.join('\n');
}

interface RepairableStoryScene {
  id?: string;
  name?: string;
  beats?: Array<{ id?: string; text?: string }>;
}

/** Find a scene by id across the assembled story's episodes. */
function findStoryScene(story: Story, sceneId: string, episodeNumber?: number): RepairableStoryScene | undefined {
  for (const episode of (story as { episodes?: Array<{ number?: number; scenes?: RepairableStoryScene[] }> }).episodes ?? []) {
    if (episodeNumber !== undefined && episode.number !== undefined && episode.number !== episodeNumber) continue;
    for (const scene of episode.scenes ?? []) {
      if (scene.id === sceneId) return scene;
    }
  }
  return undefined;
}

/** Adapt an assembled-story scene to the SceneContent shape SceneCritic reads. */
function adaptSceneForCritic(scene: RepairableStoryScene): SceneContent {
  return {
    sceneId: scene.id ?? '',
    sceneName: scene.name ?? scene.id ?? '',
    beats: scene.beats ?? [],
    moodProgression: [],
    charactersInvolved: [],
    keyMoments: [],
    continuityNotes: [],
  } as unknown as SceneContent;
}

export interface SceneProseRepairOptions {
  /**
   * Provides the SceneCritic to rewrite with (the run's critic, or a one-off
   * the caller constructs from the scene-writer config). Returning null
   * disables the handler for the round (changed: false).
   */
  critic: () => SceneCritic | null;
  /** Optional progress sink (goes to the pipeline event stream). */
  emit?: (message: string) => void;
  /** Scenes repaired per round cap (default 4). */
  maxScenesPerRound?: number;
}

/**
 * Build the ContractRepairHandler. Plugs into runFinalContractRepair alongside
 * the deterministic handlers; the loop re-validates after each round, so a
 * successful rewrite clears the finding on the next validation pass.
 */
export function buildSceneProseRepairHandler(opts: SceneProseRepairOptions): ContractRepairHandler {
  return async ({ story, blockingIssues }) => {
    const groups = selectSceneProseRepairs(blockingIssues, opts.maxScenesPerRound ?? 4);
    if (groups.size === 0) return { story, changed: false };

    const critic = opts.critic();
    if (!critic) {
      opts.emit?.('Scene-prose contract repair skipped: no SceneCritic available.');
      return { story, changed: false };
    }

    let totalMerged = 0;
    const repairedScenes: string[] = [];
    for (const [sceneId, issues] of groups) {
      const scene = findStoryScene(story, sceneId, issues[0]?.episodeNumber);
      if (!scene || !scene.beats?.length) {
        opts.emit?.(`Scene-prose contract repair: scene ${sceneId} not found or has no beats; skipping.`);
        continue;
      }
      try {
        const critique = await withTimeout(
          critic.execute({
            scene: adaptSceneForCritic(scene),
            directorNotes: buildSceneRepairDirectorNotes(issues),
          }),
          PIPELINE_TIMEOUTS.llmAgent,
          `SceneCritic.contractRepair(${sceneId})`,
        );
        if (critique.success && critique.data) {
          const merged = mergeRewrittenBeatsIntoStory(
            story as never,
            sceneId,
            critique.data.rewrittenBeats as never,
          );
          if (merged > 0) {
            totalMerged += merged;
            repairedScenes.push(sceneId);
            opts.emit?.(`Scene-prose contract repair: rewrote ${merged} beat(s) in ${sceneId} for ${issues.length} blocking finding(s).`);
          }
        }
      } catch (err) {
        opts.emit?.(`Scene-prose contract repair for ${sceneId} failed (keeping original): ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    if (totalMerged === 0) return { story, changed: false };
    return {
      story,
      changed: true,
      record: {
        rule: 'final_contract_scene_prose',
        scope: 'scene',
        attempted: groups.size,
        succeeded: true,
        degraded: repairedScenes.length < groups.size,
        blocked: false,
        attempts: 1,
        details: `Rewrote ${totalMerged} beat(s) across ${repairedScenes.join(', ')} from contract findings`,
      },
    };
  };
}
