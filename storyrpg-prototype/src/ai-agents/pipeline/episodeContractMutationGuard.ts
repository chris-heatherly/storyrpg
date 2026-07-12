import type { EpisodeBlueprint } from '../agents/StoryArchitect';
import type { EpisodeEventPlan } from '../../types/narrativeContract';
import { stableHash } from './artifacts/store';

export interface EpisodeContractMutationSnapshot {
  episodeNumber: number;
  sceneOrder: string[];
  eventOwners: Record<string, string>;
  sourceGraphHash: string;
  planVersion: number;
  hash: string;
}

export interface EpisodeContractMutationIssue {
  code: 'scene_order_changed' | 'event_owner_changed' | 'plan_revision_changed';
  message: string;
}

/** Capture only immutable contract surfaces, excluding prose and mutable craft metadata. */
export function captureEpisodeContractSurface(
  blueprint: Pick<EpisodeBlueprint, 'scenes'>,
  plan: EpisodeEventPlan,
): EpisodeContractMutationSnapshot {
  const eventOwners: Record<string, string> = {};
  for (const assignment of plan.assignments) eventOwners[assignment.eventId] = assignment.sceneId;
  const surface = {
    episodeNumber: plan.episodeNumber,
    sceneOrder: (blueprint.scenes ?? []).map((scene) => scene.id),
    eventOwners,
    sourceGraphHash: plan.sourceGraphHash,
    planVersion: plan.version,
  };
  return { ...surface, hash: stableHash(surface) };
}

export function diffEpisodeContractSurface(
  before: EpisodeContractMutationSnapshot,
  after: EpisodeContractMutationSnapshot,
): EpisodeContractMutationIssue[] {
  const issues: EpisodeContractMutationIssue[] = [];
  if (before.sourceGraphHash !== after.sourceGraphHash || before.planVersion !== after.planVersion) {
    issues.push({
      code: 'plan_revision_changed',
      message: `Episode ${before.episodeNumber} canonical plan revision changed after commit.`,
    });
  }
  if (before.sceneOrder.join('|') !== after.sceneOrder.join('|')) {
    issues.push({
      code: 'scene_order_changed',
      message: `Episode ${before.episodeNumber} canonical scene order changed after commit.`,
    });
  }
  const eventIds = new Set([...Object.keys(before.eventOwners), ...Object.keys(after.eventOwners)]);
  for (const eventId of eventIds) {
    if (before.eventOwners[eventId] === after.eventOwners[eventId]) continue;
    issues.push({
      code: 'event_owner_changed',
      message: `Canonical event "${eventId}" changed owner after commit (${before.eventOwners[eventId] || 'unassigned'} -> ${after.eventOwners[eventId] || 'unassigned'}).`,
    });
  }
  return issues;
}
