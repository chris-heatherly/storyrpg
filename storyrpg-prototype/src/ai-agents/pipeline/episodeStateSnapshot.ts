/**
 * EpisodeStateSnapshot (Season Canon, Phase 4).
 *
 * The cumulative end-state carried forward so episode N+k can be generated without
 * re-running episode N's prose. It is path-aware in the only way generation can
 * be: it records the UNION of flags any choice in the episode can set (these are
 * path-conditional, not guaranteed), plus the scores it can touch, plus the open
 * promises still owed after the episode. Downstream prompts read it as "state that
 * may be carried in from prior episodes" rather than a single linear playthrough.
 *
 * Pure + structurally typed (mirrors episodePlantContext's decoupling) so it's
 * unit-testable and the runner keeps a thin call site. Persistence
 * (episode-state-snapshot.json) is the runner's job.
 */

interface SnapshotConsequence {
  type?: string;
  flag?: string;
  value?: unknown;
  score?: string;
  amount?: number;
}
interface SnapshotChoice {
  consequences?: SnapshotConsequence[];
}
interface SnapshotBeat {
  choices?: SnapshotChoice[];
}
interface SnapshotScene {
  beats?: SnapshotBeat[];
  choices?: SnapshotChoice[];
}
interface SnapshotEpisode {
  number?: number;
  scenes?: SnapshotScene[];
}

export interface EpisodeStateSnapshot {
  afterEpisode: number;
  /** Path-conditional: flags any choice in the episode can set (union). */
  flags: string[];
  /** Scores any choice in the episode can modify. */
  scores: string[];
  /** Promise ids still open (unresolved) after this episode. */
  openPromiseIds: string[];
}

function isTrackableSetFlag(c: SnapshotConsequence): c is SnapshotConsequence & { flag: string } {
  return (
    c.type === 'setFlag' &&
    typeof c.flag === 'string' &&
    c.value !== false &&
    !c.flag.startsWith('tint:') &&
    !c.flag.startsWith('route_')
  );
}

function* choicesOf(episode: SnapshotEpisode): Generator<SnapshotChoice> {
  for (const scene of episode.scenes ?? []) {
    for (const c of scene.choices ?? []) yield c;
    for (const beat of scene.beats ?? []) {
      for (const c of beat.choices ?? []) yield c;
    }
  }
}

/**
 * Build the carry-forward snapshot for an episode, accumulating onto the prior
 * snapshot's flags/scores (state is cumulative across the season) and folding in
 * the still-open promise ids. Pure — the caller supplies openPromiseIds from the
 * ledger so this module stays free of ledger coupling.
 */
export function buildEpisodeStateSnapshot(
  episode: SnapshotEpisode,
  openPromiseIds: string[],
  prior?: EpisodeStateSnapshot,
): EpisodeStateSnapshot {
  const flags = new Set<string>(prior?.flags ?? []);
  const scores = new Set<string>(prior?.scores ?? []);
  for (const choice of choicesOf(episode)) {
    for (const c of choice.consequences ?? []) {
      if (isTrackableSetFlag(c)) flags.add(c.flag);
      if (c.type === 'setScore' && typeof c.score === 'string') scores.add(c.score);
    }
  }
  return {
    afterEpisode: episode.number ?? (prior ? prior.afterEpisode + 1 : 1),
    flags: [...flags].sort(),
    scores: [...scores].sort(),
    openPromiseIds: [...new Set(openPromiseIds)].sort(),
  };
}
