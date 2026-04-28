/**
 * Narrative Thread Types
 *
 * A "thread" is any seed / promise / clue / revelation that spans multiple
 * beats or scenes. Threads let us enforce setup/payoff coupling so the
 * story doesn't plant ideas that go nowhere (Chekhov's gun) or pay off
 * things that were never planted (deus ex machina).
 *
 * Thread ledgers are authored by the ThreadPlanner agent from the
 * StoryArchitect blueprint and consumed by SceneWriter (for beat metadata)
 * and the SetupPayoffValidator (for post-hoc verification).
 */

export type ThreadKind =
  /** A small, concrete clue the audience can spot later. */
  | 'seed'
  /** A specific, explicit clue that should reward attentive players. */
  | 'clue'
  /** A stakes-level commitment (e.g., "they WILL come for me"). */
  | 'promise'
  /** A revelation that reframes earlier events. */
  | 'reveal';

export type ThreadPriority = 'major' | 'minor';

export type ThreadStatus =
  /** Thread declared but no plant or payoff has been attached. */
  | 'planned'
  /** Thread has been planted in at least one beat. */
  | 'planted'
  /** Thread has at least one payoff beat that references it. */
  | 'paid_off'
  /** Thread was planted but never paid off; structural violation. */
  | 'dangling'
  /** Thread was paid off without any planting beats; structural violation. */
  | 'unplanted';

export interface ThreadPlant {
  /** Scene that plants this thread. */
  sceneId: string;
  /** Beat that plants it (must reside in `sceneId`). */
  beatId: string;
  /** Short description of the plant (e.g. "Marta's limp"). */
  note?: string;
}

export interface ThreadPayoff {
  sceneId: string;
  beatId: string;
  note?: string;
  /**
   * Optional reframe text — when the payoff recontextualizes the plant
   * rather than simply confirming it (useful for revelation threads).
   */
  reframe?: string;
}

export interface NarrativeThread {
  /** Stable id (slug-like). */
  id: string;
  kind: ThreadKind;
  priority: ThreadPriority;
  /** Short human-readable label. */
  label: string;
  /** Longer description of what this thread is about. */
  description: string;
  /**
   * Optional episode scoping. If omitted the thread is season-wide.
   * `expectedPaidOffByEpisode` can be enforced by SetupPayoffValidator.
   */
  introducedInEpisode?: number;
  expectedPaidOffByEpisode?: number;
  /** Beats that plant this thread. */
  plants: ThreadPlant[];
  /** Beats that pay off this thread. */
  payoffs: ThreadPayoff[];
  /** Derived status — may be refreshed by validators. */
  status: ThreadStatus;
  /** Optional tags to group threads (e.g., "mystery", "relationship", "arc"). */
  tags?: string[];
}

export interface ThreadLedger {
  /** Canonical set of threads, keyed by id. */
  threads: NarrativeThread[];
  /** Author notes about how the threads interlock. */
  designNotes?: string;
}
