/**
 * Character-arc planning wiring (WS0, AGENT_ARCHITECTURE_PLAN_2026-06-12).
 *
 * CharacterArcTracker was fully built and exported but nothing in the pipeline
 * ever invoked it: ChoiceAuthor's `arcTargets` input was always undefined and
 * the narrative-diagnostics `arc_delta` check skipped every run with
 * "No CharacterArcTracker targets were available." This module is the seam
 * that runs the agent once per episode — after the StoryArchitect blueprint is
 * finalized (and after thread/twist planning), before any scene prose — and
 * maps its targets onto ChoiceAuthor's input shape and the ArcDeltaValidator's
 * observed-delta inputs.
 *
 * All logic lives here rather than in FullStoryPipeline (monolith ratchet); the
 * pipeline calls a small seam. The module mirrors threadTwistPlanning.ts — the
 * proven pattern for adopting a built-but-unwired agent.
 *
 * Default-off contract: gated by `STORYRPG_CHARACTER_ARC_TRACKING` (env) /
 * `generation.enableCharacterArcTracking` (config). With the flag off the
 * pipeline never constructs the agent, the per-episode targets map stays
 * empty, and the ChoiceAuthor mapper returns `undefined` — behavior is
 * byte-identical to before.
 *
 * The agent is fail-open: any failure here (throw, timeout, empty output)
 * logs a pipeline warning and generation continues WITHOUT arc targets — it
 * never aborts the run.
 */

import type { AgentResponse } from '../agents/BaseAgent';
import type {
  CharacterArcTargets,
  CharacterArcTrackerInput,
} from '../agents/CharacterArcTracker';
import type { ChoiceAuthorInput, ChoiceSet } from '../agents/ChoiceAuthor';
import type { CharacterBible } from '../agents/CharacterDesigner';
import type { EpisodeBlueprint } from '../agents/StoryArchitect';
import type { GenerationSettingsConfig } from '../config';
import type { IdentityProfile } from '../../types';
import type {
  CharacterArchitecture,
  StoryAnchors,
  StoryCircleRoleAssignment,
  StoryCircleStructure,
} from '../../types/sourceAnalysis';
import { withTimeout, PIPELINE_TIMEOUTS } from '../utils/withTimeout';

// ========================================
// Feature flag
// ========================================

export const CHARACTER_ARC_TRACKING_ENV = 'STORYRPG_CHARACTER_ARC_TRACKING';

/**
 * Whether character-arc tracking is on. Resolution mirrors the gate-registry
 * convention (gateDefaults.isGateEnabled): env `'1'` forces on, env `'0'`
 * forces off (kill-switch), otherwise the config field decides — and the
 * config default is OFF pending a live validation run.
 */
export function isCharacterArcTrackingEnabled(generation?: GenerationSettingsConfig): boolean {
  const env = typeof process !== 'undefined' ? process.env[CHARACTER_ARC_TRACKING_ENV] : undefined;
  if (env === '1') return true;
  if (env === '0') return false;
  return generation?.enableCharacterArcTracking === true;
}

// ========================================
// Agent seam (interface so tests can mock without LLM calls)
// ========================================

export interface CharacterArcTrackerLike {
  execute(input: CharacterArcTrackerInput): Promise<AgentResponse<CharacterArcTargets>>;
}

export interface PlanEpisodeArcTargetsParams {
  /** Resolved feature flag — when false this is a guaranteed no-op. */
  enabled: boolean;
  characterArcTracker: CharacterArcTrackerLike;
  episodeBlueprint: EpisodeBlueprint;
  characterBible: CharacterBible;
  /** The season arc plan blob the prompt reasons over (SeasonPlan today). */
  seasonArcPlan?: object;
  episodeIndex: number;
  totalEpisodes: number;
  seasonAnchors?: StoryAnchors;
  seasonStoryCircle?: StoryCircleStructure;
  episodeStoryCircleRole?: StoryCircleRoleAssignment[];
  characterArchitecture?: CharacterArchitecture;
  /** Fail-open reporter — wired to `this.emit({ type: 'warning', … })`. */
  emitWarning: (message: string) => void;
  /** Override for tests; defaults to the shared per-agent LLM budget. */
  timeoutMs?: number;
}

export interface EpisodeArcTargetsResult {
  /** Present only when the tracker produced at least one concrete target. */
  arcTargets?: CharacterArcTargets;
}

/**
 * Run CharacterArcTracker for one episode. The call is wrapped in the same
 * withTimeout(PIPELINE_TIMEOUTS.llmAgent) budget neighboring agent calls use,
 * and it fails OPEN: on error/timeout/empty output we warn and return without
 * targets so generation continues unchanged.
 */
export async function planEpisodeArcTargets(
  params: PlanEpisodeArcTargetsParams,
): Promise<EpisodeArcTargetsResult> {
  if (!params.enabled) return {};
  const timeoutMs = params.timeoutMs ?? PIPELINE_TIMEOUTS.llmAgent;
  const episodeId = params.episodeBlueprint.episodeId;

  try {
    const res = await withTimeout(
      params.characterArcTracker.execute({
        episodeBlueprint: params.episodeBlueprint,
        characterBible: params.characterBible,
        seasonArcPlan: params.seasonArcPlan,
        episodeIndex: params.episodeIndex,
        totalEpisodes: params.totalEpisodes,
        seasonAnchors: params.seasonAnchors,
        seasonStoryCircle: params.seasonStoryCircle,
        episodeStoryCircleRole: params.episodeStoryCircleRole,
        characterArchitecture: params.characterArchitecture,
      }),
      timeoutMs,
      `CharacterArcTracker.execute(${episodeId})`,
    );
    const targets = res.success ? res.data : undefined;
    // The agent fails open internally (success:true + empty targets + error) —
    // treat an all-empty plan the same as no plan so downstream stays undefined.
    if (
      targets &&
      (targets.identityTargets.length > 0 ||
        targets.relationshipTargets.length > 0 ||
        targets.milestones.length > 0)
    ) {
      return { arcTargets: targets };
    }
    if (res.error) {
      params.emitWarning(
        `CharacterArcTracker produced no targets for ${episodeId} (continuing without arc tracking): ${res.error}`,
      );
    }
  } catch (err) {
    params.emitWarning(
      `CharacterArcTracker failed for ${episodeId} (continuing without arc tracking): ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  return {};
}

// ========================================
// Mapping onto ChoiceAuthor's input shape
// ========================================

/** Keep prompts tight: at most this many hints of each kind per episode. */
const MAX_IDENTITY_HINTS = 3;
const MAX_RELATIONSHIP_HINTS = 4;

type ChoiceAuthorArcTargets = NonNullable<ChoiceAuthorInput['arcTargets']>;

function deltaMagnitude(delta: number): 'minor' | 'moderate' | 'major' {
  const abs = Math.abs(delta);
  if (abs <= 10) return 'minor';
  if (abs <= 25) return 'moderate';
  return 'major';
}

/**
 * CharacterArcTargets -> ChoiceAuthorInput.arcTargets. Signed numeric deltas
 * become direction + coarse magnitude (ChoiceAuthor designs consequences, it
 * doesn't do arithmetic). Zero-delta targets are dropped; both lists are
 * capped, largest planned movement first. Returns undefined when nothing
 * remains so the ChoiceAuthor prompt is unchanged.
 */
export function toChoiceAuthorArcTargets(
  targets: CharacterArcTargets | undefined,
): ChoiceAuthorArcTargets | undefined {
  if (!targets) return undefined;

  const identityDeltaHints = targets.identityTargets
    .filter((t) => t.delta !== 0)
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
    .slice(0, MAX_IDENTITY_HINTS)
    .map((t) => ({
      dimension: String(t.axis),
      direction: t.delta > 0 ? ('positive' as const) : ('negative' as const),
      magnitude: deltaMagnitude(t.delta),
    }));

  const relationshipTrajectory: ChoiceAuthorArcTargets['relationshipTrajectory'] = [];
  for (const r of targets.relationshipTargets) {
    const dims: Array<{ dimension: string; delta: number | undefined }> = [
      { dimension: 'trust', delta: r.trustDelta },
      { dimension: 'respect', delta: r.respectDelta },
      { dimension: 'bond', delta: r.bondDelta },
    ];
    for (const { dimension, delta } of dims) {
      if (delta === undefined || delta === 0) continue;
      relationshipTrajectory.push({
        npcId: r.npcId,
        dimension,
        direction: delta > 0 ? 'positive' : 'negative',
        hint: [r.trajectory, r.rationale].filter(Boolean).join(' — '),
      });
    }
  }
  relationshipTrajectory.splice(MAX_RELATIONSHIP_HINTS);

  if (identityDeltaHints.length === 0 && relationshipTrajectory.length === 0) return undefined;
  return {
    identityDeltaHints: identityDeltaHints.length > 0 ? identityDeltaHints : undefined,
    relationshipTrajectory: relationshipTrajectory.length > 0 ? relationshipTrajectory : undefined,
  };
}

// ========================================
// Simulated observed deltas for ArcDeltaValidator (plan-time, deterministic)
// ========================================

/**
 * Identity movement is authored as arc-driving flags (`arc:<axis>:<direction>`
 * — see the ChoiceAuthor arc prompt section), not numeric consequences, so a
 * plan-time check can only measure whether the episode OFFERS the planned
 * movement. Each choice point that offers an arc flag for an axis credits this
 * many points in the flagged direction. With the tracker's preferred 2-3
 * targeted choice points per axis this clears ArcDeltaValidator's ≥50%-of-
 * planned-magnitude bar for typical targets; a single token gesture does not.
 */
export const IDENTITY_FLAG_CREDIT = 8;

export interface SimulatedEpisodeArcDeltas {
  /** Feed as `endIdentity` with an empty `startIdentity`. */
  endIdentity: Partial<IdentityProfile>;
  relationshipDeltas: Record<string, { trust?: number; respect?: number; bond?: number }>;
}

const ARC_FLAG_PATTERN = /^arc:([a-z_]+):(positive|negative)$/;

/** Consequence-dimension -> ArcDeltaValidator dimension (`affection` ≈ bond). */
const RELATIONSHIP_DIMENSION_MAP: Record<string, 'trust' | 'respect' | 'bond' | undefined> = {
  trust: 'trust',
  respect: 'respect',
  affection: 'bond',
};

/**
 * Best-effort path-independent observation of the episode's arc movement from
 * the authored choice sets (the player walks ONE option per choice point, so
 * summing every option would overcount):
 *
 *   - Relationship deltas: per choice point, the MEAN of each npc/dimension's
 *     numeric `RelationshipChange` consequences across options — the expected
 *     drift of an unbiased player — summed over choice points.
 *   - Identity: per choice point, ±IDENTITY_FLAG_CREDIT per axis when ANY
 *     option sets an `arc:<axis>:<direction>` flag (availability, not path).
 *
 * Returns undefined when the choice sets contain no measurable signal, so the
 * arc_delta check reports cleanly against absent observations.
 */
export function simulateEpisodeArcDeltas(
  choiceSets: ChoiceSet[],
): SimulatedEpisodeArcDeltas | undefined {
  const endIdentity: Record<string, number> = {};
  const relationshipDeltas: Record<string, { trust?: number; respect?: number; bond?: number }> = {};
  let sawSignal = false;

  for (const set of choiceSets ?? []) {
    const options = set.choices ?? [];
    if (options.length === 0) continue;

    // Identity: direction credited once per choice point per axis.
    const axisDirections = new Map<string, number>();
    // Relationships: sum per npc/dimension across options, then divide.
    const relSums = new Map<string, number>();

    for (const choice of options) {
      for (const c of choice.consequences ?? []) {
        if (c.type === 'setFlag') {
          // The prompt's ideal shape is `{ type: "setFlag", name: ... }`; the
          // canonical type uses `flag`. Accept both.
          const flagName = (c as { flag?: string; name?: string }).flag
            ?? (c as { flag?: string; name?: string }).name;
          const match = typeof flagName === 'string' ? ARC_FLAG_PATTERN.exec(flagName) : null;
          if (match && c.value !== false) {
            axisDirections.set(match[1], match[2] === 'positive' ? 1 : -1);
          }
        } else if (c.type === 'relationship' && typeof c.change === 'number') {
          const dimension = RELATIONSHIP_DIMENSION_MAP[c.dimension];
          if (!dimension) continue;
          const key = `${c.npcId}::${dimension}`;
          relSums.set(key, (relSums.get(key) ?? 0) + c.change);
        }
      }
    }

    for (const [axis, direction] of axisDirections) {
      endIdentity[axis] = (endIdentity[axis] ?? 0) + direction * IDENTITY_FLAG_CREDIT;
      sawSignal = true;
    }
    for (const [key, sum] of relSums) {
      const [npcId, dimension] = key.split('::') as [string, 'trust' | 'respect' | 'bond'];
      const mean = sum / options.length;
      const entry = (relationshipDeltas[npcId] ??= {});
      entry[dimension] = (entry[dimension] ?? 0) + mean;
      sawSignal = true;
    }
  }

  if (!sawSignal) return undefined;
  return {
    endIdentity: endIdentity as Partial<IdentityProfile>,
    relationshipDeltas,
  };
}
