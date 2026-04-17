/**
 * Shot Sequence Planner
 *
 * Runs once per scene BEFORE any image generation to produce a shot plan for
 * every beat. This is the first time SEQUENCE_VARIETY_RULES are enforced in
 * code rather than existing only as prompt text.
 *
 * The planner is universal — it governs all beat images regardless of panel
 * mode. When panelMode is 'single', every beat still gets its shot type and
 * angle assigned from the plan.
 */

import {
  analyzeBeatCinematically,
  type BeatType,
} from '../agents/image-team/CinematicBeatAnalyzer';

// ============================================
// PUBLIC TYPES
// ============================================

export type IntensityTier = 'dominant' | 'supporting' | 'rest';
export type PanelMode = 'single' | 'special-beats' | 'all-beats';

export interface ShotPlan {
  beatId: string;
  assignedShotType: string;
  assignedAngle: string;
  intensityTier: IntensityTier;
  isPanelBeat: boolean;
  panelCount?: number;
  panelShotSequence?: string[];
}

export interface EnrichedBeatInput {
  id: string;
  text: string;
  shotType?: 'establishing' | 'character' | 'action';
  isClimaxBeat?: boolean;
  isKeyStoryBeat?: boolean;
  isChoicePayoff?: boolean;
  emotionalRead?: string;
  relationshipDynamic?: string;
  primaryAction?: string;
  intensityTier?: IntensityTier;
}

export interface SceneContextInput {
  genre: string;
  tone: string;
  mood?: string;
  /**
   * B7: Coverage profile biases the shot-type mix toward a genre/tone-appropriate
   * distribution. When omitted, the planner uses its built-in phase defaults.
   */
  coverageProfile?: CoverageProfile;
}

export type CoverageProfilePreset =
  | 'balanced'
  | 'intimate'
  | 'dialogue'
  | 'action'
  | 'atmospheric'
  | 'suspense';

export interface CoverageProfile {
  /**
   * Named preset. When set, other fields layer on top as overrides. Unknown
   * preset ids fall back to 'balanced'.
   */
  preset?: CoverageProfilePreset;
  /**
   * Bias list prepended to phase-default candidates. First matching shot that
   * doesn't conflict with the previous shot wins. Use this to pull the mix
   * toward specific distances (e.g. ['MCU', 'CU'] for intimate coverage).
   */
  preferredShotBias?: string[];
  /**
   * Optional angle bias prepended to the beat-type default. Handy for
   * atmospheric ("birds-eye", "high angle") or noir ("low angle") genres.
   */
  preferredAngleBias?: string[];
}

const COVERAGE_PROFILE_PRESETS: Record<CoverageProfilePreset, CoverageProfile> = {
  balanced: {},
  intimate: { preferredShotBias: ['MCU', 'CU', 'MS'] },
  dialogue: { preferredShotBias: ['MCU', 'MS', 'CU'] },
  action: { preferredShotBias: ['MLS', 'MS', 'LS'], preferredAngleBias: ['low angle', 'dutch angle'] },
  atmospheric: { preferredShotBias: ['ELS', 'LS', 'MLS'], preferredAngleBias: ['high angle', 'birds-eye'] },
  suspense: { preferredShotBias: ['MS', 'MCU', 'LS'], preferredAngleBias: ['low angle', 'dutch angle'] },
};

function resolveCoverageProfile(profile?: CoverageProfile): CoverageProfile {
  if (!profile) return {};
  const preset = profile.preset ? COVERAGE_PROFILE_PRESETS[profile.preset] || {} : {};
  return {
    preset: profile.preset,
    preferredShotBias: profile.preferredShotBias || preset.preferredShotBias,
    preferredAngleBias: profile.preferredAngleBias || preset.preferredAngleBias,
  };
}

// ============================================
// SHOT TYPE VOCABULARY (ordered by distance)
// ============================================

const SHOT_DISTANCE_ORDER = ['ELS', 'LS', 'MLS', 'MS', 'MCU', 'CU', 'ECU'];

const ANGLE_VOCABULARY = [
  'eye-level',
  'low angle',
  'high angle',
  'dutch angle',
  'birds-eye',
  'worms-eye',
];

// ============================================
// SCENE ARC PHASE MAPPING
// ============================================

type ScenePhase = 'opening' | 'development' | 'climax' | 'resolution';

function getScenePhase(beatIndex: number, totalBeats: number): ScenePhase {
  const ratio = beatIndex / Math.max(totalBeats - 1, 1);
  if (ratio <= 0.15) return 'opening';
  if (ratio <= 0.70) return 'development';
  if (ratio <= 0.90) return 'climax';
  return 'resolution';
}

const PHASE_PREFERRED_DISTANCE: Record<ScenePhase, string[]> = {
  opening: ['LS', 'MLS', 'ELS'],
  development: ['MS', 'MLS', 'MCU'],
  climax: ['CU', 'MCU', 'ECU', 'MS'],
  resolution: ['MS', 'MLS', 'LS'],
};

// ============================================
// BEAT TYPE → RECOMMENDED SHOT MAPPINGS
// ============================================

const BEAT_TYPE_SHOT_PREFERENCE: Partial<Record<BeatType, string[]>> = {
  confrontation: ['MS', 'MCU', 'MLS'],
  revelation: ['CU', 'MCU'],
  realization: ['CU', 'MCU'],
  intimacy: ['MCU', 'CU', 'MS'],
  action: ['MLS', 'MS', 'LS'],
  decision: ['MCU', 'CU'],
  threat: ['MLS', 'LS', 'MS'],
  comfort: ['MCU', 'MS'],
  betrayal: ['CU', 'MCU', 'MS'],
  triumph: ['MLS', 'LS', 'MS'],
  defeat: ['MS', 'CU', 'MLS'],
  defiance: ['MS', 'MLS'],
  submission: ['MS', 'MLS'],
  reunion: ['MLS', 'MS'],
  departure: ['MLS', 'LS', 'MS'],
  transition: ['MS', 'MLS'],
  atmosphere: ['ELS', 'LS', 'MLS'],
};

const BEAT_TYPE_ANGLE_PREFERENCE: Partial<Record<BeatType, string>> = {
  confrontation: 'low angle',
  triumph: 'low angle',
  defiance: 'low angle',
  defeat: 'high angle',
  submission: 'high angle',
  threat: 'low angle',
  action: 'low angle',
  intimacy: 'eye-level',
  comfort: 'eye-level',
  atmosphere: 'eye-level',
};

// ============================================
// INTENSITY TIERING
// ============================================

const DOMINANT_BEAT_TYPES: BeatType[] = [
  'confrontation', 'action', 'betrayal', 'triumph', 'defeat',
];

function assignIntensityTier(
  beat: EnrichedBeatInput,
  beatIndex: number,
  totalBeats: number,
  prevTier?: IntensityTier,
  beatType?: BeatType,
): IntensityTier {
  if (beat.intensityTier) return beat.intensityTier;

  if (beat.isClimaxBeat) return 'dominant';
  if (beat.isKeyStoryBeat) return 'dominant';
  if (beatType && DOMINANT_BEAT_TYPES.includes(beatType)) return 'dominant';

  if (beat.shotType === 'establishing') return 'rest';
  if (beatType === 'transition' || beatType === 'atmosphere') return 'rest';
  if (prevTier === 'dominant') return 'rest';

  if (beatIndex === 0 && totalBeats > 3) return 'supporting';

  return 'supporting';
}

// ============================================
// PANEL DECISIONS
// ============================================

const PANEL_ELIGIBLE_BEAT_TYPES: BeatType[] = [
  'confrontation', 'action', 'betrayal', 'triumph', 'defeat',
  'revelation', 'defiance',
];

function decidePanelCount(beatType: BeatType, isClimaxBeat: boolean): number {
  if (isClimaxBeat) return 4;
  switch (beatType) {
    case 'confrontation':
    case 'revelation':
    case 'betrayal':
      return 3;
    case 'action':
    case 'triumph':
    case 'defeat':
    case 'defiance':
      return 2;
    default:
      return 2;
  }
}

function buildPanelShotSequence(panelCount: number, heroShot: string): string[] {
  const heroIdx = SHOT_DISTANCE_ORDER.indexOf(heroShot);
  if (heroIdx === -1) return Array(panelCount).fill(heroShot);

  if (panelCount === 2) {
    const tighter = SHOT_DISTANCE_ORDER[Math.min(heroIdx + 1, SHOT_DISTANCE_ORDER.length - 1)];
    return [heroShot, tighter];
  }
  if (panelCount === 3) {
    const wider = SHOT_DISTANCE_ORDER[Math.max(heroIdx - 1, 0)];
    const tighter = SHOT_DISTANCE_ORDER[Math.min(heroIdx + 1, SHOT_DISTANCE_ORDER.length - 1)];
    return [wider, heroShot, tighter];
  }
  // 4 panels: progressive tightening
  const shots: string[] = [];
  const start = Math.max(heroIdx - 1, 0);
  for (let i = 0; i < 4; i++) {
    const idx = Math.min(start + i, SHOT_DISTANCE_ORDER.length - 1);
    shots.push(SHOT_DISTANCE_ORDER[idx]);
  }
  return shots;
}

// ============================================
// VARIETY ENFORCEMENT
// ============================================

function pickNonConflicting(
  preferred: string[],
  previousShot: string | null,
  phase: ScenePhase,
  profileBias?: string[],
): string {
  const phaseFallbacks = PHASE_PREFERRED_DISTANCE[phase];
  // B7: Coverage profile bias nudges the mix toward genre-appropriate
  // distances without overriding beat-specific needs. Beat preference still
  // wins because it's the first slice of `preferred`.
  const candidates = profileBias
    ? [...preferred, ...profileBias, ...phaseFallbacks]
    : [...preferred, ...phaseFallbacks];

  for (const shot of candidates) {
    if (shot !== previousShot) return shot;
  }
  // Last resort: walk the full distance list
  for (const shot of SHOT_DISTANCE_ORDER) {
    if (shot !== previousShot) return shot;
  }
  return preferred[0] || 'MS';
}

function pickNonConflictingAngle(
  preferred: string,
  recentAngles: string[],
  profileBias?: string[],
): string {
  // B7: If a coverage-profile angle bias is supplied and the beat's default
  // angle would otherwise be 'eye-level' (the BEAT_TYPE_ANGLE_PREFERENCE
  // fallback), use the profile's first bias angle instead.
  const effective = (preferred === 'eye-level' && profileBias && profileBias.length > 0)
    ? profileBias[0]
    : preferred;
  if (recentAngles.length < 2) return effective;
  const lastTwo = recentAngles.slice(-2);
  if (lastTwo[0] === effective && lastTwo[1] === effective) {
    const altPool = profileBias ? [...profileBias, ...ANGLE_VOCABULARY] : ANGLE_VOCABULARY;
    for (const angle of altPool) {
      if (angle !== effective) return angle;
    }
  }
  return effective;
}

// ============================================
// MAIN PLANNER
// ============================================

export function planShotSequence(
  enrichedBeats: EnrichedBeatInput[],
  sceneContext: SceneContextInput,
  panelMode: PanelMode,
): ShotPlan[] {
  const totalBeats = enrichedBeats.length;
  if (totalBeats === 0) return [];

  const profile = resolveCoverageProfile(sceneContext.coverageProfile);

  const plans: ShotPlan[] = [];
  let previousShot: string | null = null;
  const recentAngles: string[] = [];
  let prevTier: IntensityTier | undefined;

  for (let i = 0; i < totalBeats; i++) {
    const beat = enrichedBeats[i];
    const phase = getScenePhase(i, totalBeats);

    const analysis = analyzeBeatCinematically(
      beat.text,
      beat.emotionalRead,
      beat.relationshipDynamic,
    );
    const beatType = analysis.beatType;

    const intensityTier = assignIntensityTier(beat, i, totalBeats, prevTier, beatType);

    // --- Shot type assignment ---
    let assignedShot: string;
    if (beat.shotType === 'establishing') {
      assignedShot = pickNonConflicting(['ELS', 'LS'], previousShot, phase, profile.preferredShotBias);
    } else {
      const beatPref = BEAT_TYPE_SHOT_PREFERENCE[beatType] || PHASE_PREFERRED_DISTANCE[phase];
      assignedShot = pickNonConflicting(beatPref, previousShot, phase, profile.preferredShotBias);
    }

    // --- Angle assignment ---
    const preferredAngle = BEAT_TYPE_ANGLE_PREFERENCE[beatType] || 'eye-level';
    const assignedAngle = pickNonConflictingAngle(preferredAngle, recentAngles, profile.preferredAngleBias);

    // --- Panel decision ---
    let isPanelBeat = false;
    let panelCount: number | undefined;
    let panelShotSequence: string[] | undefined;

    if (panelMode === 'all-beats' && beat.shotType !== 'establishing') {
      isPanelBeat = true;
    } else if (panelMode === 'special-beats') {
      isPanelBeat = intensityTier === 'dominant' && PANEL_ELIGIBLE_BEAT_TYPES.includes(beatType);
    }

    if (isPanelBeat) {
      panelCount = decidePanelCount(beatType, beat.isClimaxBeat === true);
      panelShotSequence = buildPanelShotSequence(panelCount, assignedShot);
    }

    plans.push({
      beatId: beat.id,
      assignedShotType: assignedShot,
      assignedAngle,
      intensityTier,
      isPanelBeat,
      panelCount,
      panelShotSequence,
    });

    previousShot = assignedShot;
    recentAngles.push(assignedAngle);
    if (recentAngles.length > 3) recentAngles.shift();
    prevTier = intensityTier;
  }

  // B2: Apply scene-level grammar rules AFTER the beat-local variety pass.
  // The per-beat planner gets each choice locally optimal, but it can't see
  // the scene silhouette until the whole plan exists. Grammar rules check
  // opening/closing shots, intensity distribution, and climax placement.
  return applySceneGrammarPass(plans, enrichedBeats);
}

/**
 * B2: Scene-level sequence grammar pass.
 *
 * Reasons over the full shot plan for a scene and nudges entries that
 * violate high-level grammar rules. This is NOT a hard validator — it only
 * rewrites individual entries when a rewrite is both safe (no conflict with
 * the previous/next beat) and high-confidence (the rule is clear-cut).
 *
 * Rules applied:
 *   R1. Scenes with 4+ beats should open with ELS/LS/MLS unless beat 1 is
 *       itself a close-up moment (e.g. an emotional reaction opener).
 *   R2. No scene should have 100% `dominant` tier — everything being a peak
 *       means nothing is. Demote beats adjacent to the climax to `supporting`
 *       when we detect this pattern.
 *   R3. Two-beat scenes should use contrasting shot distances so the pair
 *       reads as a beat + response rather than a duplicate.
 *
 * When no rules trigger, the original plan is returned unchanged.
 */
function applySceneGrammarPass(
  plans: ShotPlan[],
  beats: EnrichedBeatInput[],
): ShotPlan[] {
  if (plans.length === 0) return plans;
  const result = plans.map((p) => ({ ...p }));

  // R1: Scene opener should establish context when the scene is long enough.
  if (result.length >= 4) {
    const opener = result[0];
    const openerBeat = beats[0];
    const openerIsClose = opener.assignedShotType === 'CU' || opener.assignedShotType === 'MCU';
    const beatCallsForClose = openerBeat?.shotType === 'character' &&
      /\b(tear|sob|gasp|stare|whispers?|reaches? out)\b/i.test(openerBeat.text || '');
    if (openerIsClose && !beatCallsForClose) {
      // Nudge opener wider, swap with the next beat if we'd otherwise collide.
      const preferred = 'LS';
      if (result[1]?.assignedShotType !== preferred) {
        opener.assignedShotType = preferred;
      } else {
        opener.assignedShotType = 'MLS';
      }
    }
  }

  // R2: demote neighbors of a true climax so the peak reads as a peak.
  const climaxIdx = beats.findIndex((b) => b.isClimaxBeat === true);
  if (climaxIdx >= 0) {
    const allDominant = result.every((p) => p.intensityTier === 'dominant');
    if (allDominant) {
      for (let i = 0; i < result.length; i++) {
        if (i === climaxIdx) continue;
        // Alternate supporting / rest so the arc has texture.
        result[i].intensityTier = (i === climaxIdx - 1 || i === climaxIdx + 1)
          ? 'supporting'
          : 'rest';
      }
    }
  }

  // R3: Two-beat scenes need contrast. If both got the same distance, push
  // the second one a notch tighter or wider.
  if (result.length === 2 && result[0].assignedShotType === result[1].assignedShotType) {
    const idx = SHOT_DISTANCE_ORDER.indexOf(result[0].assignedShotType);
    if (idx >= 0) {
      const tighter = SHOT_DISTANCE_ORDER[Math.min(idx + 1, SHOT_DISTANCE_ORDER.length - 1)];
      const wider = SHOT_DISTANCE_ORDER[Math.max(idx - 1, 0)];
      // Prefer tighter for a reaction-beat feel, unless we'd fall off the end.
      result[1].assignedShotType = tighter !== result[0].assignedShotType ? tighter : wider;
    }
  }

  return result;
}
