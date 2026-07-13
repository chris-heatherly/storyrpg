/**
 * Episode Spine Contract (ESC)
 *
 * Canonical structural artifact for treatment-sourced episodes. Season plan and
 * blueprint are projections of this spine — LLMs fill prose only; they must not
 * rewrite unit order, prerequisites, locations, or encounter profiles.
 */

import type { StoryCircleBeat, StoryCircleStructure } from './sourceAnalysis';
import type { SeasonArc } from './seasonPlan';

/** Atomic story unit — one location, one primary turn, one dramatic function. */
export type SpineUnitKind =
  | 'arrival'
  | 'explore'
  | 'meet'
  | 'test'
  | 'bond'
  | 'transition'
  | 'set_piece'
  | 'threshold'
  | 'late_night_writing'
  | 'aftermath'
  | 'development';

export type EncounterSpineProfile = 'tactical' | 'staged_rescue' | 'social_test';

export type SpineBehavioralIntentKind = 'social_test' | 'threat' | 'seduction' | 'evaluation';
export type SpineBehavioralIntentSlot = 'actor' | 'target' | 'mechanism' | 'observable_response' | 'state_change';

export type SpineRealizationIntent =
  | { kind: 'concrete_event'; eventText: string }
  | {
      kind: 'behavioral_intent';
      intentKind: SpineBehavioralIntentKind;
      intentText: string;
      requiredSlots: SpineBehavioralIntentSlot[];
      relation?: 'prerequisite' | 'supporting';
    }
  | { kind: 'identity_constraint'; factText: string }
  | { kind: 'context_only'; contextText: string };

/** Compiled obligation kinds absorbed into ESC so later LLM planners need not reinvent them. */
export type SpineObligationKind =
  | 'information_reveal'
  | 'consequence_seed'
  | 'choice_pressure'
  | 'signature_device'
  | 'arc_pressure'
  | 'thread_setup'
  | 'twist_reveal';

export interface SpineUnitObligation {
  id: string;
  kind: SpineObligationKind;
  /** Treatment / ledger text this unit must realize or plant. */
  text: string;
}

export interface EpisodeSpineUnit {
  /** Stable id within the episode (e.g. `ep1-u3`). */
  id: string;
  /** Ordered position in the episode spine (0-based). */
  order: number;
  /** Reader-facing turn text this unit must realize. */
  text: string;
  kind: SpineUnitKind;
  /** Typed realization semantics; raw source text is never assumed to be depiction evidence. */
  realizationIntent?: SpineRealizationIntent;
  /** Non-owning authored pressure that must be concretized inside this unit's scene. */
  supportingIntents?: SpineRealizationIntent[];
  /** Exactly one canonical location label from the episode location list. */
  locationId?: string;
  /** Story Circle beat(s) this unit advances within the episode. */
  storyCircleFacets: StoryCircleBeat[];
  /** Arc polarity pressure this unit should manifest (from treatment arcs). */
  polarityFacet?: string;
  /** Unit ids that must precede this unit in playback order. */
  prerequisites: string[];
  /** When kind is set_piece, how EncounterArchitect should stage play. */
  encounterProfile?: EncounterSpineProfile;
  /** Maps to PlannedScene.kind when projected. */
  sceneKind: 'standard' | 'encounter';
  /**
   * Treatment obligations bound to this unit at compile time (reveals, seeds,
   * choice pressures, arc pressure). Downstream agents consume these; they must
   * not invent competing structural obligations.
   */
  obligations?: SpineUnitObligation[];
}

export interface EpisodeSpineContract {
  episodeNumber: number;
  /** Treatment source fingerprint for cache invalidation. */
  sourceHash: string;
  /** Episode Story Circle role beats (from season plan). */
  episodeStoryCircleBeats: StoryCircleBeat[];
  /** Slice of season storyCircle text for active beats. */
  episodeCircle?: Partial<StoryCircleStructure>;
  /** Arc polarity strings carried from treatment (protagonist + key NPC pressure). */
  polarityFacets: string[];
  /** Ordered atomic units — the canonical spine. */
  units: EpisodeSpineUnit[];
}

export interface SeasonSpineContract {
  episodeSpines: Record<number, EpisodeSpineContract>;
}

export interface CompileEpisodeSpineContext {
  seasonStoryCircle?: StoryCircleStructure;
  seasonArcs?: SeasonArc[];
}
