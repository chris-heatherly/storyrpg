/**
 * Info-reveal scene assignment (Step 1 of the info-ledger-fidelity pipeline).
 *
 * The authored INFO ledger declares each fact's `plannedRevealEpisode` but NOT which
 * SCENE within that episode reveals it. This pure module makes that choice
 * deterministically so the rest of the pipeline can act on it:
 *   - SceneWriter is told to dramatize the reveal in the chosen scene (Step 2);
 *   - emitSceneInfoReveals stamps the detectable `info_<id>_reveal` flag there (Step 3);
 *   - InformationLedgerScheduleValidator confirms flag + prose (Step 4).
 *
 * Selection favors a scene that already talks about the fact (content-word overlap
 * with the entry's label/description), then a reveal/turn-flavored scene, then a later
 * scene (reveals land late). Fully deterministic — no randomness, no wall-clock.
 */

export interface RevealAssignableScene {
  id: string;
  isEncounter?: boolean;
  narrativeFunction?: string;
  narrativeRole?: string;
  dramaticPurpose?: string;
  dramaticQuestion?: string;
  setsUp?: string[];
  paysOff?: string[];
  keyBeats?: string[];
}

export interface RevealAssignableEntry {
  id: string;
  label?: string;
  description?: string;
  plannedRevealEpisode?: number;
  plannedPayoffEpisode?: number;
}

/** Scene roles/functions that read as the natural home for a reveal. */
const REVEAL_ROLE = /(reveal|revelation|turn|midpoint|climax|pinch|confront|disclos|expose|discover)/i;

/** Arc-reframe summaries are delivered across an arc, not as a discrete scene reveal. */
const ARC_REFRAME_ID = /^info-arc-\d+-reframe$/i;

const STOPWORDS = new Set([
  'the', 'and', 'that', 'this', 'with', 'from', 'into', 'their', 'they', 'them', 'have',
  'has', 'had', 'will', 'would', 'about', 'what', 'when', 'where', 'which', 'while',
  'because', 'after', 'before', 'over', 'under', 'then', 'than', 'your', 'you', 'her',
  'his', 'him', 'she', 'who', 'whom', 'whose', 'for', 'are', 'was', 'were', 'been',
  'scene', 'episode', 'reveal', 'reveals', 'reader', 'player', 'story',
]);

/** Distinctive content words (length ≥ 4, not a stopword), lowercased. */
function contentTokens(text: string): Set<string> {
  const out = new Set<string>();
  for (const raw of String(text || '').toLowerCase().split(/[^a-z0-9]+/)) {
    if (raw.length >= 4 && !STOPWORDS.has(raw)) out.add(raw);
  }
  return out;
}

function sceneText(scene: RevealAssignableScene): string {
  return [
    scene.narrativeFunction,
    scene.dramaticPurpose,
    scene.dramaticQuestion,
    scene.narrativeRole,
    ...(scene.setsUp ?? []),
    ...(scene.paysOff ?? []),
    ...(scene.keyBeats ?? []),
  ]
    .filter(Boolean)
    .join(' ');
}

/** Pick the best scene in an episode to host a given reveal. Deterministic. */
function pickScene(
  scenes: RevealAssignableScene[],
  entry: RevealAssignableEntry,
): RevealAssignableScene | undefined {
  const want = contentTokens(`${entry.label ?? ''} ${entry.description ?? ''}`);
  let best: RevealAssignableScene | undefined;
  let bestScore = -Infinity;
  scenes.forEach((scene, index) => {
    const sceneTokens = contentTokens(sceneText(scene));
    let overlap = 0;
    for (const t of want) if (sceneTokens.has(t)) overlap += 1;
    let score = overlap * 3;
    if (REVEAL_ROLE.test(`${scene.narrativeRole ?? ''} ${scene.narrativeFunction ?? ''} ${scene.dramaticPurpose ?? ''}`)) {
      score += 2;
    }
    if (scene.isEncounter) score -= 1; // a discrete reveal prefers a prose scene, but encounters are allowed
    score += index * 0.01; // tie-break: later scene wins (reveals land late)
    if (score > bestScore) {
      bestScore = score;
      best = scene;
    }
  });
  return best;
}

/**
 * Assign each ledger entry whose reveal episode is `episodeNumber` to the best scene in
 * `scenes`. Returns a map of sceneId → assigned info ids (only scenes that received an
 * assignment appear). Arc-reframe summaries are skipped (no discrete reveal). Pure.
 */
export function assignInfoRevealsToScenes(
  scenes: RevealAssignableScene[],
  entries: RevealAssignableEntry[] | undefined,
  episodeNumber: number,
): Map<string, string[]> {
  const result = new Map<string, string[]>();
  if (!Array.isArray(entries) || entries.length === 0 || scenes.length === 0) return result;

  for (const entry of entries) {
    if (!entry?.id || ARC_REFRAME_ID.test(entry.id)) continue;
    const revealEp = entry.plannedRevealEpisode ?? entry.plannedPayoffEpisode;
    if (revealEp !== episodeNumber) continue;
    const scene = pickScene(scenes, entry);
    if (!scene) continue;
    const list = result.get(scene.id) ?? [];
    if (!list.includes(entry.id)) list.push(entry.id);
    result.set(scene.id, list);
  }
  return result;
}
