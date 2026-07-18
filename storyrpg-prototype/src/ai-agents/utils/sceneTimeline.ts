/**
 * Diegetic scene timeline — plan-time time-of-day / location continuity.
 *
 * The 2026-06-09 storytelling-quality audit found the pipeline had NO model of
 * story time: `TimingMetadata` tracks reading time only, the image-planning
 * time-of-day heuristic runs post-hoc and never reaches SceneWriter, and the
 * only spatial continuity signal is `continueInLocation` (same-location
 * dual-entry prevention). The shipped result: bite-me-g10 s1-3 ends in a
 * bookshop in the afternoon and s1-4 opens "Four in the morning and you are
 * still in your coat" on a rooftop — ~8 unexplained hours with no transition
 * prose, because nothing told the writer the time or place had moved.
 *
 * This module is the single source of truth for the new timeline machinery:
 *
 *  - {@link SceneTimeOfDay} — the canonical time-of-day vocabulary carried on
 *    `SceneBlueprint.timeOfDay` (LLM-assigned at plan time, normalized here).
 *  - {@link assignBlueprintTimeline} — deterministic backfill run on every
 *    blueprint (invented OR elaborated from planned scenes): keeps a valid
 *    LLM-assigned time, else infers from scene text, else inherits from the
 *    previous scene; then derives `timeJumpFromPrevious` for every scene so the
 *    writer is always told whether the scene is continuous or a jump.
 *  - {@link buildSceneTimelineHandoff} — the per-scene handoff block passed to
 *    SceneWriter/EncounterArchitect: where/when the PREVIOUS scene was, and
 *    whether time/place changed (which makes a transition acknowledgment
 *    REQUIRED in the prompt). Unlike `buildContinueInLocation`, this does NOT
 *    skip encounter scenes — encounters sit exactly where the audited hard
 *    cuts happened, so the handoff must cross the encounter seam.
 *  - {@link sceneTimelineMetaForScene} — the metadata persisted onto the final
 *    `Scene.timeline` at assembly so post-hoc validators
 *    (SceneTransitionContinuityValidator) and audits can read the PLANNED
 *    time/place instead of re-guessing from prose.
 *
 * Everything here is generator-internal and fiction-first safe: none of these
 * strings are player-facing prose; they steer and verify the prose.
 *
 * Pure and deterministic — no LLM, no wall-clock, no randomness.
 */

export type SceneTimeOfDay =
  | 'dawn'
  | 'morning'
  | 'midday'
  | 'afternoon'
  | 'dusk'
  | 'evening'
  | 'night';

export const SCENE_TIMES_OF_DAY: readonly SceneTimeOfDay[] = [
  'dawn', 'morning', 'midday', 'afternoon', 'dusk', 'evening', 'night',
];

/** Synonyms the LLM (or a treatment) may emit, mapped to the canonical vocabulary. */
const TIME_OF_DAY_SYNONYMS: Record<string, SceneTimeOfDay> = {
  sunrise: 'dawn',
  daybreak: 'dawn',
  'first light': 'dawn',
  noon: 'midday',
  lunchtime: 'midday',
  day: 'midday',
  daytime: 'midday',
  sunset: 'dusk',
  sundown: 'dusk',
  twilight: 'dusk',
  dinner: 'evening',
  midnight: 'night',
  'late night': 'night',
  nighttime: 'night',
};

/** Normalize an LLM/treatment-supplied time-of-day to the canonical vocabulary. */
export function normalizeTimeOfDay(value: unknown): SceneTimeOfDay | undefined {
  if (typeof value !== 'string') return undefined;
  const v = value.toLowerCase().trim();
  if ((SCENE_TIMES_OF_DAY as readonly string[]).includes(v)) return v as SceneTimeOfDay;
  return TIME_OF_DAY_SYNONYMS[v];
}

/**
 * Keyword patterns for inferring time-of-day from planning text (scene name,
 * description, key beats). Checked in order; the FIRST match wins, so the more
 * specific bands (dawn/dusk/night) come before the broad ones. Word-bounded so
 * "knight"/"nightmare"/"midwife" cannot match.
 */
const TIME_INFERENCE_PATTERNS: Array<[SceneTimeOfDay, RegExp]> = [
  ['dawn', /\b(dawn|sunrise|daybreak|first light)\b/i],
  ['dusk', /\b(dusk|sunset|sundown|twilight)\b/i],
  ['night', /\b(night|midnight|moonlit|moonlight|after dark|small hours|[1-4]\s?a\.?m\.?)\b/i],
  ['morning', /\b(morning|breakfast)\b/i],
  ['midday', /\b(midday|noon|lunch)\b/i],
  ['afternoon', /\b(afternoon)\b/i],
  ['evening', /\b(evening|supper|dinner)\b/i],
];

/** Infer a time-of-day from planning text, or undefined when nothing matches. */
export function inferTimeOfDayFromText(text: string | undefined): SceneTimeOfDay | undefined {
  if (!text) return undefined;
  for (const [tod, pattern] of TIME_INFERENCE_PATTERNS) {
    if (pattern.test(text)) return tod;
  }
  return undefined;
}

/** Maps an explicit clock hour (24h) to the canonical time-of-day bucket. */
function timeOfDayForHour(hour: number): SceneTimeOfDay {
  if (hour >= 5 && hour < 7) return 'dawn';
  if (hour >= 7 && hour < 12) return 'morning';
  if (hour === 12) return 'midday';
  if (hour >= 13 && hour < 17) return 'afternoon';
  if (hour >= 17 && hour < 19) return 'dusk';
  if (hour >= 19 && hour < 22) return 'evening';
  return 'night'; // 22:00–04:59
}

const EXPLICIT_CLOCK_TIME_RE = /\b(midnight|noon)\b|\b(1[0-2]|[1-9])(?::[0-5]\d)?\s?([ap])\.?m\.?\b/i;

/**
 * Infer a time-of-day from an EXPLICIT numeric clock mention only ("4 AM",
 * "11:30 p.m.", "midnight", "noon") — deliberately narrower than
 * {@link inferTimeOfDayFromText}'s atmospheric word patterns (morning,
 * evening, dusk, ...), which can describe a memory, a mood, or a different
 * moment than the scene's actual current clock time. A stated clock time is
 * (almost always) the author asserting the diegetic present, so it is the
 * one signal safe to trust as an AUTHORITATIVE override of planned metadata,
 * not just an advisory hint.
 */
export function inferExplicitClockTimeFromText(text: string | undefined): SceneTimeOfDay | undefined {
  if (!text) return undefined;
  const match = EXPLICIT_CLOCK_TIME_RE.exec(text);
  if (!match) return undefined;
  if (match[1]) return match[1].toLowerCase() === 'midnight' ? 'night' : 'midday';
  const hour12 = Number(match[2]);
  const isPm = match[3].toLowerCase() === 'p';
  const hour24 = isPm ? (hour12 === 12 ? 12 : hour12 + 12) : (hour12 === 12 ? 0 : hour12);
  return timeOfDayForHour(hour24);
}

/**
 * Minimal structural view of a blueprint scene — keeps this util free of an
 * import on StoryArchitect (which imports the {@link SceneTimeOfDay} type from
 * here). `SceneBlueprint` satisfies it structurally.
 */
export interface TimelineScene {
  id: string;
  name: string;
  description?: string;
  location: string;
  keyBeats?: string[];
  isEncounter?: boolean;
  timeOfDay?: SceneTimeOfDay;
  timeJumpFromPrevious?: string;
}

const normLoc = (s: string | undefined): string =>
  String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** True when the two location strings name the same place (normalized match). */
export function sameLocation(a: string | undefined, b: string | undefined): boolean {
  const na = normLoc(a);
  const nb = normLoc(b);
  return na.length > 0 && na === nb;
}

/**
 * Human-readable label for a location value that may be a raw blueprint id
 * ("loc-valescu-club" → "Valescu Club"). Raw ids leaked into timeline text and
 * scene names (bite-me 2026-07-03) and, once transition text became player
 * visible, into prose. Identity comparisons ({@link sameLocation}) must keep
 * using the RAW value — this is display-only.
 */
export function prettifyLocationLabel(location: string | undefined): string {
  const raw = String(location || '').trim();
  if (!/^loc[-_][a-z0-9_-]+$/i.test(raw)) return raw;
  return raw
    .replace(/^loc[-_]/i, '')
    .split(/[-_]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/** Replace raw location-id tokens embedded in free text ("… at loc-valescu-club"). */
export function prettifyEmbeddedLocationIds(text: string | undefined): string {
  return String(text || '').replace(/\bloc[-_][a-z0-9_-]+\b/gi, (token) => prettifyLocationLabel(token));
}

/** Agent-facing description of the gap between two adjacent scenes. */
function describeJump(prev: TimelineScene, scene: TimelineScene): string {
  const samePlace = sameLocation(prev.location, scene.location);
  const timeKnown = Boolean(prev.timeOfDay && scene.timeOfDay);
  const sameTime = !timeKnown || prev.timeOfDay === scene.timeOfDay;
  if (samePlace && sameTime) {
    return 'continuous — directly follows the previous scene in the same place';
  }
  const parts: string[] = [];
  if (!sameTime) parts.push(`time passes (${prev.timeOfDay} → ${scene.timeOfDay})`);
  if (!samePlace) {
    parts.push(`the protagonist moves from ${prettifyLocationLabel(prev.location)} to ${prettifyLocationLabel(scene.location)}`);
  }
  if (parts.length === 0) {
    // Same time band but at least one side's location is blank — treat as continuous.
    return 'continuous — directly follows the previous scene';
  }
  return parts.join('; ');
}

/**
 * Fill `timeOfDay` and `timeJumpFromPrevious` for every scene of a blueprint,
 * in planned reading order (the scenes array — the same order convention
 * `buildContinueInLocation` uses). Per scene:
 *
 *  1. a valid LLM/plan-assigned `timeOfDay` is kept (normalized);
 *  2. else it is inferred from the scene's name/description/keyBeats;
 *  3. else it is inherited from the previous scene (time persists until
 *     something says otherwise);
 *  4. nothing is fabricated — when no scene ever names a time, `timeOfDay`
 *     stays undefined and the handoff falls back to location-only.
 *
 * `timeJumpFromPrevious` keeps an existing (LLM-authored) value; otherwise it
 * is derived from the location/time deltas. Idempotent.
 */
export function assignBlueprintTimeline(scenes: TimelineScene[]): void {
  let prev: TimelineScene | undefined;
  for (const scene of scenes) {
    const assigned = normalizeTimeOfDay(scene.timeOfDay);
    const inferred = assigned
      ?? inferTimeOfDayFromText([scene.name, scene.description || '', ...(scene.keyBeats || [])].join(' '));
    scene.timeOfDay = inferred ?? prev?.timeOfDay;
    if (prev && !String(scene.timeJumpFromPrevious || '').trim()) {
      scene.timeJumpFromPrevious = describeJump(prev, scene);
    }
    prev = scene;
  }
}

/** The previous-scene handoff block passed to SceneWriter / EncounterArchitect. */
export interface SceneTimelineHandoff {
  /** This scene's planned time-of-day (if known). */
  timeOfDay?: SceneTimeOfDay;
  /** Planned gap between the previous scene and this one. */
  timeJumpFromPrevious?: string;
  /** Where/when the immediately preceding scene took place. */
  previous?: {
    sceneName: string;
    location: string;
    timeOfDay?: SceneTimeOfDay;
    isEncounter?: boolean;
  };
  /** True when this scene's planned location differs from the previous scene's. */
  locationChanged: boolean;
  /** True when both scenes have a known time-of-day and they differ. */
  timeChanged: boolean;
}

/**
 * Build the handoff block for one scene. Returns undefined for the first scene
 * (nothing to hand off) and for scenes not present in the blueprint order.
 * Deliberately includes encounter predecessors (fix for the encounter-seam hard
 * cuts) — the writer must know the time/place even when the previous "scene"
 * was an encounter scaffold.
 */
export function buildSceneTimelineHandoff(
  scenes: TimelineScene[],
  scene: TimelineScene,
): SceneTimelineHandoff | undefined {
  const idx = scenes.findIndex((s) => s.id === scene.id);
  if (idx <= 0) return undefined;
  return buildSceneTimelineHandoffFrom(scenes[idx - 1], scene);
}

/**
 * Build the handoff block for a scene against an EXPLICIT predecessor —
 * used by the realized-context threading (pipeline/realizedContext.ts) to
 * hand off from the scene-graph predecessor instead of blueprint array order.
 * Same output shape and semantics as {@link buildSceneTimelineHandoff}.
 */
export function buildSceneTimelineHandoffFrom(
  prev: TimelineScene,
  scene: TimelineScene,
): SceneTimelineHandoff {
  const locationChanged = !sameLocation(prev.location, scene.location)
    && normLoc(prev.location).length > 0
    && normLoc(scene.location).length > 0;
  const timeChanged = Boolean(
    prev.timeOfDay && scene.timeOfDay && prev.timeOfDay !== scene.timeOfDay,
  );
  return {
    timeOfDay: scene.timeOfDay,
    timeJumpFromPrevious: scene.timeJumpFromPrevious,
    previous: {
      sceneName: prev.name,
      location: prev.location,
      timeOfDay: prev.timeOfDay,
      isEncounter: prev.isEncounter,
    },
    locationChanged,
    timeChanged,
  };
}

/** Timeline metadata persisted onto the assembled `Scene.timeline`. */
export interface SceneTimelineMeta {
  location?: string;
  timeOfDay?: SceneTimeOfDay;
  timeJumpFromPrevious?: string;
  /** The writer's transition phrase for this scene's opening, when authored. */
  transitionIn?: string;
}

/**
 * The timeline metadata to persist on the final assembled Scene, so validators
 * and audits can compare PLANNED time/place against the generated prose.
 * Returns undefined when there is nothing worth persisting.
 *
 * `authoredProseText` (r115 gap analysis, 2026-07-18): planned `timeOfDay` is
 * assigned at blueprint time, before SceneWriter has written a word — a run
 * shipped a scene tagged `timeOfDay: "dusk"` whose beat text explicitly reads
 * "the blue twilight of 4 AM". When the authored prose states an explicit
 * clock time that disagrees with the plan, the prose wins: it is what the
 * reader actually sees, and stale metadata can silently contaminate
 * downstream continuity checks and image generation. Only an EXPLICIT clock
 * mention overrides — see {@link inferExplicitClockTimeFromText}.
 */
export function sceneTimelineMetaForScene(
  scene: TimelineScene,
  transitionIn?: string,
  authoredProseText?: string,
): SceneTimelineMeta | undefined {
  const meta: SceneTimelineMeta = {};
  if (String(scene.location || '').trim()) meta.location = scene.location;
  if (scene.timeOfDay) meta.timeOfDay = scene.timeOfDay;
  const explicitClockTime = inferExplicitClockTimeFromText(authoredProseText);
  if (explicitClockTime && explicitClockTime !== meta.timeOfDay) meta.timeOfDay = explicitClockTime;
  if (String(scene.timeJumpFromPrevious || '').trim()) meta.timeJumpFromPrevious = scene.timeJumpFromPrevious;
  if (String(transitionIn || '').trim()) meta.transitionIn = transitionIn;
  return Object.keys(meta).length > 0 ? meta : undefined;
}
