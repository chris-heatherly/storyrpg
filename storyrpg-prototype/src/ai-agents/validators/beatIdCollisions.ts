/**
 * Cross-scene beat-ID collision detection.
 *
 * Each scene's beats are authored/numbered independently (beat-1, beat-2,
 * beat-2b, ...), so the same id — or a hierarchical prefix of it — can appear in
 * two different scenes (the Endsong audit: scene-1 `beat-2b` vs scene-2b
 * `beat-2b-1/2/3`). The reader engine resolves beats PER SCENE by exact id
 * (`findBeat(scene, beatId)`), and image slots are scene-scoped
 * (`story-beat:<sceneId>::<beatId>`), so this is not a reader runtime bug — but
 * it is a real hazard for any save format, analytics, or tooling that resolves
 * beat ids globally or by prefix, which is why the contract treats it as a
 * blocking structural error and the StructuralValidator namespaces colliding
 * scenes at autofix time.
 *
 * Pure + dependency-free so both validators can share one implementation.
 */

export interface BeatIdCollision {
  sceneId: string;
  beatId: string;
  otherSceneId: string;
  otherBeatId: string;
  /** 'exact' = identical ids; 'prefix' = one id is a hierarchical prefix of the other (`a` + '-' …). */
  kind: 'exact' | 'prefix';
}

interface MinimalEpisode {
  scenes?: Array<{ id: string; beats?: Array<{ id?: string }> }>;
}

/**
 * Return every cross-scene beat-id collision in an episode. Two ids collide
 * when they are identical, or when one is a hierarchical prefix of the other
 * (`a` and `a-1`). Collisions within a single scene are ignored (the engine
 * resolves those locally and they're caught by uniqueness checks elsewhere).
 */
export function findBeatIdCollisions(episode: MinimalEpisode): BeatIdCollision[] {
  const entries: Array<{ sceneId: string; beatId: string }> = [];
  for (const scene of episode.scenes || []) {
    for (const beat of scene.beats || []) {
      if (beat?.id) entries.push({ sceneId: scene.id, beatId: beat.id });
    }
  }

  const collisions: BeatIdCollision[] = [];
  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      const a = entries[i];
      const b = entries[j];
      if (a.sceneId === b.sceneId) continue;
      let kind: BeatIdCollision['kind'] | null = null;
      if (a.beatId === b.beatId) kind = 'exact';
      else if (b.beatId.startsWith(`${a.beatId}-`) || a.beatId.startsWith(`${b.beatId}-`)) kind = 'prefix';
      if (kind) {
        collisions.push({ sceneId: a.sceneId, beatId: a.beatId, otherSceneId: b.sceneId, otherBeatId: b.beatId, kind });
      }
    }
  }
  return collisions;
}

/** The set of scene ids involved in any collision (for targeted namespacing). */
export function collidingSceneIds(episode: MinimalEpisode): Set<string> {
  const ids = new Set<string>();
  for (const c of findBeatIdCollisions(episode)) {
    ids.add(c.sceneId);
    ids.add(c.otherSceneId);
  }
  return ids;
}
