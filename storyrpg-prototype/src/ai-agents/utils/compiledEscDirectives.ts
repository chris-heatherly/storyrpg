/**
 * Authored-lite ESC collapse: seed thread/twist/arc directives from compiled
 * ESC obligations instead of ThreadPlanner / TwistArchitect / CharacterArcTracker.
 *
 * Plant-function ESC obligations (`thread_setup`, `consequence_seed`,
 * `information_reveal`) are staging contracts: they are satisfied when the
 * plant scene exists on-page. They must NOT become same-episode unpaid
 * Chekhov's-gun debts on the unified obligation ledger.
 */

import type { EpisodeBlueprint } from '../agents/StoryArchitect';
import type { TwistPlan } from '../agents/TwistArchitect';
import type { CharacterArcTargets } from '../agents/CharacterArcTracker';
import type { NarrativeThread, ThreadLedger } from '../../types/narrativeThread';
import type { EpisodeSpineContract, SpineObligationKind } from '../../types/episodeSpine';
import type { ArcPressureTreatmentContract } from '../../types/scenePlan';
import { mergeIntoSeasonLedger } from '../pipeline/threadTwistPlanning';

export interface CompiledThreadTwistSeed {
  threads: NarrativeThread[];
  twistPlan?: TwistPlan;
}

/** ESC obligation kinds that mean "stage this beat on-page", not "pay off later". */
export const ESC_PLANT_STAGING_KINDS = new Set<SpineObligationKind>([
  'thread_setup',
  'consequence_seed',
  'information_reveal',
]);

export const ESC_PLANT_STAGING_TAG = 'esc-plant-staging';

/** Callback-ledger / ThreadLedger ids for ESC plant staging (after `thread:` prefix). */
export const ESC_PLANT_STAGING_THREAD_ID_RE =
  /^(?:thread:)?(?:consequence_seed|information_reveal|thread_setup)-/i;

export function normalizeEscPlantText(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, ' ');
}

export function isEscPlantStagingThread(thread: Pick<NarrativeThread, 'id' | 'tags'>): boolean {
  const tags = thread.tags ?? [];
  if (tags.includes(ESC_PLANT_STAGING_TAG)) return true;
  if (tags.includes('esc-compiled') && tags.some((tag) => ESC_PLANT_STAGING_KINDS.has(tag as SpineObligationKind))) {
    return true;
  }
  return ESC_PLANT_STAGING_THREAD_ID_RE.test(thread.id);
}

export function buildCompiledThreadTwistFromEsc(
  blueprint: EpisodeBlueprint,
  episodeNumber: number,
  spine: EpisodeSpineContract | undefined,
): CompiledThreadTwistSeed {
  const unitsById = new Map((spine?.units ?? []).map((unit) => [unit.id, unit] as const));
  const threads: NarrativeThread[] = [];
  const seenPlantTexts = new Set<string>();
  let twistPlan: TwistPlan | undefined;
  const scenes = blueprint.scenes ?? [];
  for (const scene of scenes) {
    const unit = scene.spineUnitId ? unitsById.get(scene.spineUnitId) : undefined;
    const obligations = unit?.obligations ?? [];
    for (const obligation of obligations) {
      if (ESC_PLANT_STAGING_KINDS.has(obligation.kind)) {
        const plantKey = normalizeEscPlantText(obligation.text);
        // Same plant text often arrives as both consequence_seed and
        // information_reveal — one staging debt, not two.
        if (!plantKey || seenPlantTexts.has(plantKey)) continue;
        seenPlantTexts.add(plantKey);

        const plantBeatId = `${scene.id}-plant`;
        const stagingBeatId = `${scene.id}-staging-fulfilled`;
        threads.push({
          id: obligation.id,
          kind: obligation.kind === 'information_reveal' ? 'reveal' : 'seed',
          priority: 'minor',
          label: obligation.text.slice(0, 80),
          description: obligation.text,
          introducedInEpisode: episodeNumber,
          // Plant-function ESC obligations are fulfilled by staging, not by a
          // later Chekhov payoff. Credit the same scene so obligation seeding
          // marks the ledger entry paid in-episode.
          plants: [{ sceneId: scene.id, beatId: plantBeatId, note: obligation.text.slice(0, 120) }],
          payoffs: [{
            sceneId: scene.id,
            beatId: stagingBeatId,
            note: 'ESC plant staging fulfilled on-page',
          }],
          status: 'paid_off',
          tags: ['esc-compiled', ESC_PLANT_STAGING_TAG, obligation.kind],
        });
      }
      if (obligation.kind === 'twist_reveal' && !twistPlan) {
        const sceneIndex = scenes.indexOf(scene);
        const foreshadow = sceneIndex > 0 ? scenes[sceneIndex - 1]! : scenes[0] ?? scene;
        twistPlan = {
          episodeId: blueprint.episodeId,
          headline: obligation.text.slice(0, 120),
          kind: 'revelation',
          twistSceneId: scene.id,
          twistBeatId: `${scene.id}-reveal`,
          foreshadowSceneId: foreshadow.id,
          foreshadowBeatId: `${foreshadow.id}-foreshadow`,
          rationale: `ESC-compiled twist_reveal obligation: ${obligation.text.slice(0, 200)}`,
          directives: [
            {
              sceneId: foreshadow.id,
              beatId: `${foreshadow.id}-foreshadow`,
              beatRole: 'foreshadow',
              twistKind: 'revelation',
              hint: obligation.text,
            },
            {
              sceneId: scene.id,
              beatId: `${scene.id}-reveal`,
              beatRole: 'reveal',
              twistKind: 'revelation',
              hint: obligation.text,
            },
          ],
        };
      }
    }
  }
  return { threads, twistPlan };
}

export function applyCompiledThreadTwistToLedger(
  seasonThreadLedger: ThreadLedger,
  seed: CompiledThreadTwistSeed,
  episodeNumber: number,
): void {
  if (seed.threads.length > 0) {
    mergeIntoSeasonLedger(seasonThreadLedger, { threads: seed.threads }, episodeNumber);
  }
}

export function buildCompiledArcTargetsFromPlan(args: {
  episodeId: string;
  episodeNumber: number;
  contracts?: ArcPressureTreatmentContract[];
  polarityFacets?: string[];
}): CharacterArcTargets | undefined {
  const { episodeId, episodeNumber, contracts = [], polarityFacets = [] } = args;
  const episodeContracts = contracts.filter((contract) =>
    contract.targetEpisodeNumbers.length === 0
    || contract.targetEpisodeNumbers.includes(episodeNumber),
  );
  const polarity = polarityFacets.filter(Boolean);
  if (episodeContracts.length === 0 && polarity.length === 0) return undefined;
  const headline = polarity[0]
    || episodeContracts[0]?.sourceText
    || episodeContracts[0]?.arcTitle
    || `Episode ${episodeNumber} arc pressure`;
  return {
    episodeId,
    identityTargets: [],
    relationshipTargets: [],
    milestones: [],
    arcPhaseHeadline: String(headline).slice(0, 200),
  };
}
