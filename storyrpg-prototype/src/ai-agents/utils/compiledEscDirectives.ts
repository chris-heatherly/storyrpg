/**
 * Authored-lite ESC collapse: seed thread/twist/arc directives from compiled
 * ESC obligations instead of ThreadPlanner / TwistArchitect / CharacterArcTracker.
 */

import type { EpisodeBlueprint } from '../agents/StoryArchitect';
import type { TwistPlan } from '../agents/TwistArchitect';
import type { CharacterArcTargets } from '../agents/CharacterArcTracker';
import type { NarrativeThread, ThreadLedger } from '../../types/narrativeThread';
import type { EpisodeSpineContract } from '../../types/episodeSpine';
import type { ArcPressureTreatmentContract } from '../../types/scenePlan';
import { mergeIntoSeasonLedger } from '../pipeline/threadTwistPlanning';

export interface CompiledThreadTwistSeed {
  threads: NarrativeThread[];
  twistPlan?: TwistPlan;
}

export function buildCompiledThreadTwistFromEsc(
  blueprint: EpisodeBlueprint,
  episodeNumber: number,
  spine: EpisodeSpineContract | undefined,
): CompiledThreadTwistSeed {
  const unitsById = new Map((spine?.units ?? []).map((unit) => [unit.id, unit] as const));
  const threads: NarrativeThread[] = [];
  let twistPlan: TwistPlan | undefined;
  const scenes = blueprint.scenes ?? [];
  for (const scene of scenes) {
    const unit = scene.spineUnitId ? unitsById.get(scene.spineUnitId) : undefined;
    const obligations = unit?.obligations ?? [];
    for (const obligation of obligations) {
      if (
        obligation.kind === 'thread_setup'
        || obligation.kind === 'consequence_seed'
        || obligation.kind === 'information_reveal'
      ) {
        threads.push({
          id: obligation.id,
          kind: obligation.kind === 'information_reveal' ? 'reveal' : 'seed',
          priority: 'minor',
          label: obligation.text.slice(0, 80),
          description: obligation.text,
          introducedInEpisode: episodeNumber,
          plants: [{ sceneId: scene.id, beatId: `${scene.id}-plant`, note: obligation.text.slice(0, 120) }],
          payoffs: [],
          status: 'planned',
          tags: ['esc-compiled', obligation.kind],
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
