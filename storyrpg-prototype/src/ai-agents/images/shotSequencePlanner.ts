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
): string {
  const phaseFallbacks = PHASE_PREFERRED_DISTANCE[phase];
  const candidates = [...preferred, ...phaseFallbacks];

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
): string {
  if (recentAngles.length < 2) return preferred;
  const lastTwo = recentAngles.slice(-2);
  if (lastTwo[0] === preferred && lastTwo[1] === preferred) {
    // Three in a row would violate rules — pick alternative
    for (const angle of ANGLE_VOCABULARY) {
      if (angle !== preferred) return angle;
    }
  }
  return preferred;
}

// ============================================
// MAIN PLANNER
// ============================================

export function planShotSequence(
  enrichedBeats: EnrichedBeatInput[],
  _sceneContext: SceneContextInput,
  panelMode: PanelMode,
): ShotPlan[] {
  const totalBeats = enrichedBeats.length;
  if (totalBeats === 0) return [];

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
      assignedShot = pickNonConflicting(['ELS', 'LS'], previousShot, phase);
    } else {
      const beatPref = BEAT_TYPE_SHOT_PREFERENCE[beatType] || PHASE_PREFERRED_DISTANCE[phase];
      assignedShot = pickNonConflicting(beatPref, previousShot, phase);
    }

    // --- Angle assignment ---
    const preferredAngle = BEAT_TYPE_ANGLE_PREFERENCE[beatType] || 'eye-level';
    const assignedAngle = pickNonConflictingAngle(preferredAngle, recentAngles);

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

  return plans;
}
