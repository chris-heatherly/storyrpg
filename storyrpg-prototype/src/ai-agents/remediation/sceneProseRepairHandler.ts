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
 * Scope: prose-realization findings on scenes that carry rewritable prose — the
 * classes where "rewrite this scene's prose to dramatize the named moment" is
 * the fix (RequiredBeatRealization, SignatureDevicePresence). This includes
 * ENCOUNTER scenes: their prose lives in `encounter.phases[].beats` /
 * `encounter.storylets[].beats`, not `scene.beats`, so those beats are flattened
 * for SceneCritic and the rewrite merged back to the surface it came from (a
 * signature device staged inside a `treatment-enc-*` encounter is the common
 * case — see mergeRewrittenEncounterBeatsIntoStory). The generation-time
 * no-boilerplate regen catches TEMPLATE encounter prose; it does not catch
 * fluent-but-unfaithful prose that summarized a staged signature away, which is
 * why this backstop must cover encounters. Purely structural classes (e.g.
 * AuthoredEpisodeConformance) remain out of scope (StructuralValidator.autoFix).
 */

import type { Story } from '../../types/story';
import type { SceneCritic } from '../agents/SceneCritic';
import type { SceneContent } from '../agents/SceneWriter';
import { mergeRewrittenBeatsIntoStory, mergeRewrittenEncounterBeatsIntoStory } from '../pipeline/continuityRepair';
import { PIPELINE_TIMEOUTS, withTimeout } from '../utils/withTimeout';
import type { ContractRepairHandler, ContractRepairReport } from './finalContractRepair';
import { missingMomentTokens, momentDepicted, requiredMomentFromMessage } from './realizationScoring';

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
  // EncounterAnchorContentValidator names a concrete authored moment (central conflict /
  // required beat) the encounter prose failed to dramatize, and carries the encounter
  // sceneId — exactly the shape this handler repairs. The handler already rewrites encounter
  // prose (gatherEncounterProseBeats + mergeRewrittenEncounterBeatsIntoStory), so an
  // encounter-anchor miss now becomes a bounded scene-prose repair instead of a hard abort
  // (bite-me-g18). This retires the GATE_ENCOUNTER_ANCHOR_CONTENT policyException.
  'EncounterAnchorContentValidator',
]);

type RepairableIssue = ContractRepairReport['blockingIssues'][number];

/**
 * Pick the blocking issues this handler can act on and group them by scene.
 * Caps at `maxScenes` scenes per round so a pathological report can't fan out
 * into unbounded LLM spend in one round. Scenes NOT yet attempted in earlier
 * rounds come first — without this, a stubborn scene from round 1 re-claims
 * its slot every round and starves scenes that never got a first attempt
 * (bite-me-g13 14-36-20: s3-1 was never repaired while treatment-enc-1-1 was
 * attempted twice).
 */
export function selectSceneProseRepairs(
  blockingIssues: RepairableIssue[],
  maxScenes = 4,
  attemptedScenes?: ReadonlySet<string>,
): Map<string, RepairableIssue[]> {
  const all = new Map<string, RepairableIssue[]>();
  for (const issue of blockingIssues ?? []) {
    if (!issue?.validator || !SCENE_PROSE_REPAIRABLE_VALIDATORS.has(issue.validator)) continue;
    if (!issue.sceneId) continue;
    const existing = all.get(issue.sceneId);
    if (existing) existing.push(issue);
    else all.set(issue.sceneId, [issue]);
  }
  const ordered = [...all.keys()].sort((a, b) => {
    const aAttempted = attemptedScenes?.has(a) ? 1 : 0;
    const bAttempted = attemptedScenes?.has(b) ? 1 : 0;
    return aAttempted - bAttempted; // stable: insertion order within each tier
  });
  const groups = new Map<string, RepairableIssue[]>();
  for (const sceneId of ordered.slice(0, maxScenes)) groups.set(sceneId, all.get(sceneId)!);
  return groups;
}

/**
 * Director notes for the SceneCritic rewrite, built from the findings. When the
 * scene's current prose is provided, each finding gets a NON-NEGOTIABLE
 * checklist: the full authored moment plus the exact content words the prose
 * does not yet carry. The validator that re-checks this scene is a keyword-
 * overlap heuristic, so a rewrite that paraphrases away the proper nouns
 * ("the park" for "Cișmigiu") will NOT clear the gate even if it reads well —
 * the notes say so explicitly. (bite-me-g13 14-36-20: the critic dramatized
 * one anchor of a two-anchor signature and the scene kept failing.)
 */
export function buildSceneRepairDirectorNotes(issues: RepairableIssue[], sceneProseText?: string): string {
  const lines: string[] = [
    'The final-story contract flagged this scene. Fix EVERY issue below by rewriting the scene\'s beat prose — dramatize each named moment ON-PAGE with concrete action, dialogue, and sensory detail. Do not summarize, allude to, or skip the staged moment.',
  ];
  for (const issue of issues) {
    lines.push(`- ${issue.message ?? 'unspecified finding'}${issue.suggestion ? ` (fix: ${issue.suggestion})` : ''}`);
    if (sceneProseText !== undefined) {
      const moment = requiredMomentFromMessage(issue.message);
      if (moment) {
        const missing = missingMomentTokens(issue.validator, moment, sceneProseText);
        if (missing.length > 0) {
          lines.push(
            `  NON-NEGOTIABLE: dramatize EVERY part of that authored moment, not just one piece of it. ` +
            `These content words from the authored moment are still absent from the scene and MUST appear ` +
            `in the rewritten prose (verbatim or inflected — keep proper nouns like place names exactly): ` +
            missing.join(', '),
          );
        }
      }
    }
  }
  lines.push(
    'Keep beat ids, choice points, speakers, and established plot intact. Weave the missing moment into the existing beats (extend or rewrite beat text/textVariants); never contradict events already on the page.',
  );
  return lines.join('\n');
}

interface EncounterProseBeat {
  id?: string;
  text?: string;
  setupText?: string;
  escalationText?: string;
}
interface RepairableStoryScene {
  id?: string;
  name?: string;
  beats?: Array<{ id?: string; text?: string }>;
  encounter?: {
    phases?: Array<{ beats?: EncounterProseBeat[] }>;
    storylets?: Array<{ beats?: EncounterProseBeat[] }> | Record<string, { beats?: EncounterProseBeat[] }>;
  };
}

/**
 * Flatten an encounter scene's prose beats into the flat `{id, text}` shape
 * SceneCritic rewrites. Encounter prose lives in `encounter.phases[].beats`
 * (text in `setupText`) and `encounter.storylets[].beats` (text in `text`),
 * NOT `scene.beats`. Each surfaced beat keeps its real id so the rewrite merges
 * straight back via mergeRewrittenEncounterBeatsIntoStory. Only beats that
 * actually carry prose are surfaced (an empty bridge/choice beat has nothing to
 * rewrite). This is what lets a SignatureDevicePresence finding on a
 * `treatment-enc-*` scene be repaired instead of skipped.
 */
function gatherEncounterProseBeats(scene: RepairableStoryScene): Array<{ id?: string; text?: string }> {
  const enc = scene.encounter;
  if (!enc) return [];
  const out: Array<{ id?: string; text?: string }> = [];
  const collect = (beats: EncounterProseBeat[] | undefined): void => {
    for (const b of beats || []) {
      const prose = [b.text, b.setupText, b.escalationText].filter(Boolean).join(' ').trim();
      if (prose) out.push({ id: b.id, text: prose });
    }
  };
  for (const phase of enc.phases || []) collect(phase.beats);
  const storylets = Array.isArray(enc.storylets) ? enc.storylets : Object.values(enc.storylets ?? {});
  for (const storylet of storylets) collect(storylet?.beats);
  return out;
}

/**
 * The repairable prose beats for a scene: the flat scene beats when present,
 * otherwise the encounter's phase/storylet prose beats. Empty only when the
 * scene genuinely has no rewritable prose anywhere.
 */
function repairableBeatsFor(scene: RepairableStoryScene): Array<{ id?: string; text?: string }> {
  if (scene.beats?.length) return scene.beats;
  return gatherEncounterProseBeats(scene);
}

/**
 * The scene's prose as the realization validators scan it (scene name + flat
 * beat text/variants + encounter phase/storylet text/setupText/escalationText/
 * variants) — the haystack for predicting whether a finding will clear.
 */
function sceneProseForScoring(scene: RepairableStoryScene): string {
  type ProseBeat = EncounterProseBeat & { textVariants?: Array<{ text?: string }> };
  const parts: string[] = [scene.name ?? ''];
  const collect = (beats: ProseBeat[] | undefined): void => {
    for (const b of beats || []) {
      parts.push(b.text ?? '', b.setupText ?? '', b.escalationText ?? '');
      for (const variant of b.textVariants || []) parts.push(variant?.text ?? '');
    }
  };
  collect(scene.beats as ProseBeat[] | undefined);
  const enc = scene.encounter;
  if (enc) {
    for (const phase of enc.phases || []) collect(phase.beats as ProseBeat[] | undefined);
    const storylets = Array.isArray(enc.storylets) ? enc.storylets : Object.values(enc.storylets ?? {});
    for (const storylet of storylets) collect(storylet?.beats as ProseBeat[] | undefined);
  }
  return parts.filter(Boolean).join(' ');
}

/** Predict the re-validation: does the scene's prose now depict every flagged moment? */
function allMomentsDepicted(scene: RepairableStoryScene, issues: RepairableIssue[]): boolean {
  const prose = sceneProseForScoring(scene);
  return issues.every((issue) => {
    const moment = requiredMomentFromMessage(issue.message);
    // No extractable moment → can't predict; treat as cleared (the loop's full
    // re-validation is still the source of truth).
    return !moment || momentDepicted(issue.validator, moment, prose);
  });
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
function adaptSceneForCritic(
  scene: RepairableStoryScene,
  beats: Array<{ id?: string; text?: string }>,
): SceneContent {
  return {
    sceneId: scene.id ?? '',
    sceneName: scene.name ?? scene.id ?? '',
    beats,
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
  // Persists across repair rounds (the handler is built once per contract
  // enforcement), so later rounds prioritize scenes never attempted yet.
  const attemptedScenes = new Set<string>();
  return async ({ story, blockingIssues }) => {
    const groups = selectSceneProseRepairs(blockingIssues, opts.maxScenesPerRound ?? 4, attemptedScenes);
    if (groups.size === 0) return { story, changed: false };

    const critic = opts.critic();
    if (!critic) {
      opts.emit?.('Scene-prose contract repair skipped: no SceneCritic available.');
      return { story, changed: false };
    }

    let totalMerged = 0;
    let criticCalls = 0;
    const repairedScenes: string[] = [];
    const clearedScenes: string[] = [];
    for (const [sceneId, issues] of groups) {
      const scene = findStoryScene(story, sceneId, issues[0]?.episodeNumber);
      const initialBeats = scene ? repairableBeatsFor(scene) : [];
      if (!scene || initialBeats.length === 0) {
        opts.emit?.(`Scene-prose contract repair: scene ${sceneId} not found or has no rewritable prose; skipping.`);
        continue;
      }
      attemptedScenes.add(sceneId);
      // Encounter scenes carry prose in encounter.phases/storylets, not
      // scene.beats — merge the rewrite back to the surface it came from.
      const isEncounterScene = !scene.beats?.length;
      try {
        // Up to two critic passes per scene per round: the first works from a
        // checklist of the moment's still-missing content words; if the merged
        // result STILL would not clear the validator's keyword check (mirrored
        // locally — no LLM cost), one immediate retry runs with the freshly
        // recomputed missing-word list. Without this, a partial dramatization
        // burned an entire repair round before re-validation caught it.
        let sceneMerged = 0;
        let predictedClear = false;
        for (let attempt = 1; attempt <= 2 && !predictedClear; attempt++) {
          const beats = repairableBeatsFor(scene); // re-read: attempt 2 sees attempt 1's merge
          const critique = await withTimeout(
            critic.execute({
              scene: adaptSceneForCritic(scene, beats),
              directorNotes: buildSceneRepairDirectorNotes(issues, sceneProseForScoring(scene)),
            }),
            PIPELINE_TIMEOUTS.llmAgent,
            `SceneCritic.contractRepair(${sceneId}#${attempt})`,
          );
          criticCalls += 1;
          if (critique.success && critique.data) {
            // Surface rewrites that matched NO beat (drifted ids) — otherwise the
            // repair looks like it ran while the gate keeps failing, with no signal.
            const warnUnmatched = (ids: string[]) => opts.emit?.(
              `Scene-prose contract repair: ${ids.length} rewritten beat(s) [${ids.join(', ')}] in ${sceneId} matched no beat ` +
              `(drifted beat ids) — those rewrites were NOT applied.`,
            );
            sceneMerged += isEncounterScene
              ? mergeRewrittenEncounterBeatsIntoStory(story as never, sceneId, critique.data.rewrittenBeats as never, warnUnmatched)
              : mergeRewrittenBeatsIntoStory(story as never, sceneId, critique.data.rewrittenBeats as never, warnUnmatched);
          }
          predictedClear = allMomentsDepicted(scene, issues);
          if (!predictedClear && attempt === 1) {
            opts.emit?.(`Scene-prose contract repair: ${sceneId} still missing authored content after rewrite — retrying with the remaining checklist.`);
          }
        }
        if (sceneMerged > 0) {
          totalMerged += sceneMerged;
          repairedScenes.push(sceneId);
          if (predictedClear) clearedScenes.push(sceneId);
          opts.emit?.(
            `Scene-prose contract repair: rewrote ${sceneMerged} beat(s) in ${sceneId} for ${issues.length} blocking finding(s)` +
            ` (${predictedClear ? 'now depicts every flagged moment' : 'authored content STILL incomplete after retry'}).`,
          );
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
        succeeded: clearedScenes.length === groups.size,
        degraded: clearedScenes.length < groups.size,
        blocked: false,
        attempts: criticCalls,
        details: `Rewrote ${totalMerged} beat(s) across ${repairedScenes.join(', ')}; ${clearedScenes.length}/${groups.size} scene(s) predicted to clear`,
      },
    };
  };
}
