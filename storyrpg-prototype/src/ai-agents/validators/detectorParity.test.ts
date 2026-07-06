/**
 * Detector parity locks (R7 — one detector per defect class across stages).
 *
 * A defect class must be detected by the SAME code at every pipeline stage
 * that checks it, otherwise "passed at scene time" does not predict "passes
 * the final contract" and the defect surfaces only after full generation
 * (24 min + full image spend per abort).
 *
 * 1. Tense drift: the scene-time gate (ContentGenerationPhase,
 *    GATE_SCENE_TENSE_CHECK) and the final contract
 *    (NarrativeFailureModeValidator.detectTenseDrift) must both run
 *    `detectBeatTenseDrift` from utils/proseTense over the same beat surface
 *    and flag the identical beats.
 * 2. Realization presence threshold: `PRESENCE_MIN_SCORE` is defined once in
 *    remediation/realizationEvaluator and imported by
 *    SignatureDevicePresenceValidator — no duplicated literal (source-scan
 *    assertion, matching the deterministicProseNeverShips.test.ts convention).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { detectBeatTenseDrift } from '../utils/proseTense';
import { NarrativeFailureModeValidator } from './NarrativeFailureModeValidator';
import type { SceneContent } from '../agents/SceneWriter';
import { PRESENCE_MIN_SCORE } from '../remediation/realizationEvaluator';

function scene(sceneId: string, texts: string[]): SceneContent {
  return {
    sceneId,
    sceneName: sceneId,
    beats: texts.map((text, index) => ({ id: `${sceneId}-b${index + 1}`, text })),
    startingBeatId: `${sceneId}-b1`,
    moodProgression: [],
    charactersInvolved: [],
    keyMoments: [],
    continuityNotes: [],
  };
}

/**
 * Fixture beats exercising every branch of the detector: clean present tense,
 * blocking past-tense live action (>= 3 subject+past-verb pairs), sub-threshold
 * drift (2 pairs), marker-excused memory prose, and dialogue-only past tense.
 */
const FIXTURE_BEATS = [
  // Present-tense live action — must never flag.
  'You step into the archive. The dust settles around your boots as the door seals behind you.',
  // Blocking drift: >= 3 past-tense live-action pairs, no past-event marker.
  "Your glass clicked against theirs. Just as you took a sip, you felt it. He didn't blink.",
  // Sub-threshold drift: 2 pairs — below the per-beat blocking threshold.
  'You reached for the ledger. She held the lamp higher, and the room stays silent.',
  // Past-event marker: past tense is legitimate memory/backstory.
  'Years ago, you felt the same cold pressure and heard the same slow knock outside the door.',
  // Past tense confined to quoted dialogue — narration stays present.
  'He takes your hand. His skin is cool. "What you saw tonight is best forgotten," he says.',
];

describe('detector parity: tense drift (scene-time vs final contract)', () => {
  it('flags the identical beats through the scene-time and final-time call paths', () => {
    const fixtureScene = scene('s1-1', FIXTURE_BEATS);

    // Scene-time call path (ContentGenerationPhase, GATE_SCENE_TENSE_CHECK).
    const sceneTimeFlagged = detectBeatTenseDrift(fixtureScene.beats).map((drift) => drift.beatId);

    // Final-contract call path (NarrativeFailureModeValidator.detectTenseDrift).
    const result = new NarrativeFailureModeValidator().validate({ sceneContents: [fixtureScene] });
    const finalTimeFlagged = result.issues
      .filter((issue) => issue.code === 'tense_drift')
      .map((issue) => issue.location?.split('.').pop());

    expect(sceneTimeFlagged).toEqual(finalTimeFlagged);
    // The fixture's blocking beat (and only it) must be flagged by both.
    expect(sceneTimeFlagged).toEqual(['s1-1-b2']);
  });

  it('final contract emits tense_drift as a blocking error for the shared detection', () => {
    const result = new NarrativeFailureModeValidator().validate({
      sceneContents: [scene('s2-1', [FIXTURE_BEATS[1]])],
    });
    const drift = result.issues.filter((issue) => issue.code === 'tense_drift');
    expect(drift).toHaveLength(1);
    expect(drift[0].severity).toBe('error');
  });

  it('both stages import the shared detector and neither re-implements per-beat matching', () => {
    const validatorSource = readFileSync(join(__dirname, 'NarrativeFailureModeValidator.ts'), 'utf8');
    const phaseSource = readFileSync(join(__dirname, '../pipeline/phases/ContentGenerationPhase.ts'), 'utf8');

    expect(validatorSource).toMatch(/import \{[^}]*detectBeatTenseDrift[^}]*\} from '\.\.\/utils\/proseTense'/);
    expect(phaseSource).toMatch(/import \{[^}]*detectBeatTenseDrift[^}]*\} from '\.\.\/\.\.\/utils\/proseTense'/);

    // No local re-implementation of the per-beat regex scan in the validator:
    // the raw pattern and its match-count threshold live only in proseTense.
    expect(validatorSource).not.toMatch(/PAST_TENSE_LIVE_ACTION/);
    expect(validatorSource).not.toMatch(/matches\.length\s*<\s*3/);
  });
});

describe('detector parity: realization presence threshold', () => {
  it('SignatureDevicePresenceValidator imports PRESENCE_MIN_SCORE from realizationEvaluator', () => {
    const source = readFileSync(join(__dirname, 'SignatureDevicePresenceValidator.ts'), 'utf8');
    expect(source).toMatch(/import \{[^}]*PRESENCE_MIN_SCORE[^}]*\} from '\.\.\/remediation\/realizationEvaluator'/);
    // No duplicated literal: the validator must not define its own constant.
    expect(source).not.toMatch(/const PRESENCE_MIN_SCORE\s*=/);
  });

  it('realizationEvaluator is the single definition site of the threshold', () => {
    const source = readFileSync(join(__dirname, '../remediation/realizationEvaluator.ts'), 'utf8');
    expect(source).toMatch(/export const PRESENCE_MIN_SCORE = 0\.5/);
    expect(PRESENCE_MIN_SCORE).toBe(0.5);
  });
});
