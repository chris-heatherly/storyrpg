/**
 * Branch-aware scene display numbering (for ContinuityChecker timeline labels).
 *
 * Scenes are authored with ids like `scene-1`, `scene-2`, `scene-3a`, `scene-3b`,
 * `scene-4`, where `3a`/`3b` are mutually-exclusive branch alternatives at the same
 * point in the timeline. Labeling them by raw array index (`Scene ${idx+1}`) made
 * the parallel branches look sequential ("Scene 3" / "Scene 4") and pushed the
 * bottleneck to "Scene 5" — which the continuity LLM then flagged as a timeline
 * error. This derives the intended display number from the id so branch
 * alternatives SHARE a number and the bottleneck stays correctly numbered.
 *
 * Pure + unit-testable.
 */

/** Parse the leading integer group of a `scene-<N><suffix>` id (e.g. `scene-3a` -> 3). */
function parseSceneOrdinal(sceneId: string): number | undefined {
  const m = /^scene-(\d+)/i.exec(sceneId);
  return m ? parseInt(m[1], 10) : undefined;
}

export interface SceneTimelineLabel {
  sceneId: string;
  /** The display number shared by branch alternatives at the same point. */
  displayNumber: number;
  /** "Scene 3" or, for a branched point, "Scene 3 (Path A)". */
  label: string;
}

/**
 * Assign branch-aware "Scene N" labels across an ordered scene-id list. Scenes
 * whose ids share a numeric ordinal (scene-3a/scene-3b) get the same display
 * number with a Path A/B/... suffix; ids that don't parse fall back to a counter
 * that advances per distinct group in first-appearance order.
 */
export function buildSceneTimelineLabels(sceneIds: string[]): SceneTimelineLabel[] {
  // Map each distinct ordinal (or unparseable id) to a stable display number in
  // first-appearance order, so a missing/odd id doesn't desync the rest.
  const groupKeyOf = (id: string): string => {
    const ord = parseSceneOrdinal(id);
    return ord != null ? `ord:${ord}` : `id:${id}`;
  };
  const order: string[] = [];
  const membersByGroup = new Map<string, string[]>();
  for (const id of sceneIds) {
    const key = groupKeyOf(id);
    if (!membersByGroup.has(key)) {
      membersByGroup.set(key, []);
      order.push(key);
    }
    membersByGroup.get(key)!.push(id);
  }
  const displayByGroup = new Map<string, number>();
  order.forEach((key, i) => displayByGroup.set(key, i + 1));

  return sceneIds.map((id) => {
    const key = groupKeyOf(id);
    const displayNumber = displayByGroup.get(key)!;
    const members = membersByGroup.get(key)!;
    let label = `Scene ${displayNumber}`;
    if (members.length > 1) {
      const pathIdx = members.indexOf(id);
      label += ` (Path ${String.fromCharCode(65 + pathIdx)})`;
    }
    return { sceneId: id, displayNumber, label };
  });
}
