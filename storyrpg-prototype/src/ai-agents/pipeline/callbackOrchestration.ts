/**
 * Callback orchestration
 *
 * The pipeline-level glue around the `CallbackLedger`: harvesting hooks/payoffs
 * from a just-generated episode and shaping unresolved hooks for agent prompts.
 *
 * Extracted from FullStoryPipeline (which is slated for decomposition) so the
 * callback set->payoff lifecycle lives in one focused, unit-testable module.
 * These functions are pure with respect to pipeline state — they take the
 * ledger explicitly and touch no `this` — so the pipeline keeps only thin
 * delegating wrappers.
 */

import type { Choice } from '../../types/choice';
import type { TextVariant } from '../../types/content';
import type { CallbackLedger } from './callbackLedger';

/** A single unresolved hook, shaped for a SceneWriter/ChoiceAuthor prompt. */
export interface UnresolvedCallbackForPrompt {
  id: string;
  sourceEpisode: number;
  summary: string;
  flags: string[];
  conditionKeys?: string[];
  impactFactors?: string[];
  consequenceTier?: string;
}

/** Minimal beat shape the harvest pass reads. */
export interface HarvestBeat {
  id?: string;
  callbackHookIds?: string[];
  textVariants?: TextVariant[];
  choices?: Array<{ id: string; memorableMoment?: { id: string; summary: string; flags?: string[] } }>;
}

/** Minimal scene-content shape the harvest pass reads. */
export interface HarvestSceneContent {
  sceneId: string;
  beats: HarvestBeat[];
}

/** Minimal choice-set shape the harvest pass reads. */
export interface HarvestChoiceSet {
  sceneId?: string;
  beatId?: string;
  choices: Array<{ id: string; memorableMoment?: { id: string; summary: string; flags?: string[] }; consequences?: unknown[] }>;
}

export interface HarvestEpisodeCallbacksParams {
  episodeNumber: number;
  sceneContents: HarvestSceneContent[];
  choiceSets: HarvestChoiceSet[];
}

/**
 * Shape the unresolved callback hooks for SceneWriter/ChoiceAuthor prompts.
 * Returns `undefined` when there are no hooks, so the prompt section is
 * skipped cleanly.
 */
export function getUnresolvedCallbacksForPrompt(
  ledger: CallbackLedger,
  episodeNumber: number | undefined,
): UnresolvedCallbackForPrompt[] | undefined {
  // 1.1: previously episode 1 was skipped entirely, so first-episode (and
  // single-episode) hooks could never be injected and so never paid off. Allow
  // episode 1; `unresolvedFor` still gates on each hook's payoff window, so no
  // hook is offered before it exists.
  if (!episodeNumber || episodeNumber < 1) return undefined;
  const hooks = ledger.unresolvedFor(episodeNumber);
  if (hooks.length === 0) return undefined;
  return hooks.map((hook) => ({
    id: hook.id,
    sourceEpisode: hook.sourceEpisode,
    summary: hook.summary,
    flags: hook.flags,
    conditionKeys: hook.conditionKeys,
    impactFactors: hook.impactFactors,
    consequenceTier: hook.consequenceTier,
  }));
}

/**
 * Harvest callback state from a just-generated episode: seed new hooks from
 * `memorableMoment` choice fields, and record payoffs for any TextVariants
 * that reference an existing hook id.
 */
export function harvestEpisodeCallbacks(
  ledger: CallbackLedger,
  params: HarvestEpisodeCallbacksParams,
): { newHooks: number; payoffs: number } {
  let newHooks = 0;
  let payoffs = 0;

  for (const choiceSet of params.choiceSets) {
    const sceneId = choiceSet.sceneId || '';
    for (const choice of choiceSet.choices || []) {
      const typedChoice = choice as unknown as Choice;
      if (choice.memorableMoment?.id) {
        const added = ledger.recordChoice({
          choice: typedChoice,
          episode: params.episodeNumber,
          sceneId,
        });
        if (added) newHooks += 1;
      }
      // 1.1: seed a hook for every trackable flag the choice sets, not just
      // memorableMoment-tagged choices, so ordinary set-flags enter the
      // inject -> payoff loop instead of shipping unread.
      for (const flag of ledger.trackableFlagsOf(typedChoice)) {
        const added = ledger.recordFlagSet({
          choice: typedChoice,
          flag,
          episode: params.episodeNumber,
          sceneId,
        });
        if (added) newHooks += 1;
      }
    }
  }

  for (const scene of params.sceneContents) {
    for (const beat of scene.beats || []) {
      if (beat.choices) {
        for (const choice of beat.choices) {
          if (choice.memorableMoment?.id) {
            const added = ledger.recordChoice({
              choice: choice as unknown as Choice,
              episode: params.episodeNumber,
              sceneId: scene.sceneId,
            });
            if (added) newHooks += 1;
          }
        }
      }
      if (beat.textVariants) {
        const matched = ledger.recordPayoffsFromVariants(beat.textVariants);
        payoffs += matched.length;
        if (matched.length > 0) {
          const hookIds = new Set(beat.callbackHookIds || []);
          for (const hookId of matched) hookIds.add(hookId);
          beat.callbackHookIds = Array.from(hookIds);
        }
      }
    }
  }

  return { newHooks, payoffs };
}
