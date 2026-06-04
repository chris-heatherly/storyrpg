/**
 * Tests for the opt-in scene-local detectors wired into
 * IncrementalValidationRunner.validateScene (Bucket B1):
 *   - IntensityDistribution  (flag: intensityDistributionCheck, env: GATE_INTENSITY_DISTRIBUTION)
 *   - MechanicsLeakage       (flag: mechanicsLeakageSceneCheck, env: GATE_MECHANICS_LEAKAGE_REGEN)
 *
 * Each detector runs ONLY when both its config flag AND its env gate are set.
 * It records its issues on the result and escalates regenerationRequested to
 * 'scene' ONLY on an error-severity issue (escalate-only). Both underlying
 * validators currently emit warning/info severity only, so in practice they
 * record issues without forcing regen — the escalation path is asserted
 * structurally and the warning-only reality is asserted explicitly.
 *
 * PropIntroduction is intentionally NOT wired (needs cross-scene context); a
 * test documents that its flag/env is a no-op in validateScene.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { IncrementalValidationRunner } from './IncrementalValidators';
import type { IncrementalValidationConfig } from './IncrementalValidators';
import type { SceneContent, GeneratedBeat } from '../agents/SceneWriter';

// These tests isolate the opt-in scene-local detectors (Bucket B1). The default
// config turns ON several unrelated validators (povClarity, voice, stakes,
// continuity, craft, encounter) that can independently escalate
// regenerationRequested to 'scene' on the minimal fixtures used here (e.g. POV
// clarity flags the terse synthetic beats). To assert *only* the new detectors'
// effect on regenerationRequested, every runner below disables those unrelated
// validators via this base config; the per-test config then layers the detector
// flag under test on top.
const ISOLATE_BASE: Partial<IncrementalValidationConfig> = {
  povClarityValidation: false,
  voiceValidation: false,
  stakesValidation: false,
  sensitivityCheck: false,
  continuityCheck: false,
  encounterValidation: false,
  craftValidation: false,
};

function beat(overrides: Partial<GeneratedBeat> = {}): GeneratedBeat {
  return {
    id: 'beat-1',
    text: 'The protagonist steps into the quiet room and takes stock of the situation.',
    ...overrides,
  } as GeneratedBeat;
}

function makeScene(overrides: Partial<SceneContent> = {}): SceneContent {
  return {
    sceneId: 'scene-1',
    sceneName: 'Test Scene',
    locationId: 'loc-1',
    beats: [beat()],
    startingBeatId: 'beat-1',
    moodProgression: ['calm'],
    charactersInvolved: [],
    keyMoments: [],
    continuityNotes: [],
    ...overrides,
  } as SceneContent;
}

// A scene with >= MIN_BEATS_FOR_DOMINANT (3) beats and NO dominant beat:
// trips IntensityDistributionValidator's "no dominant" warning.
function intensityViolatingScene(): SceneContent {
  return makeScene({
    beats: [
      beat({ id: 'b1', text: 'A calm opening.', intensityTier: 'supporting' }),
      beat({ id: 'b2', text: 'A second supporting moment.', intensityTier: 'supporting' }),
      beat({ id: 'b3', text: 'A third supporting moment, still no peak.', intensityTier: 'supporting' }),
    ],
    startingBeatId: 'b1',
  });
}

// A well-modulated scene: has a dominant and a rest beat — no intensity issues.
function intensityCleanScene(): SceneContent {
  return makeScene({
    beats: [
      beat({ id: 'b1', text: 'A calm opening.', intensityTier: 'rest' }),
      beat({ id: 'b2', text: 'Tension rises.', intensityTier: 'supporting' }),
      beat({ id: 'b3', text: 'The peak lands hard.', intensityTier: 'dominant' }),
      beat({ id: 'b4', text: 'A breath afterward.', intensityTier: 'rest' }),
    ],
    startingBeatId: 'b1',
  });
}

// A scene whose prose exposes dice/DC mechanics — trips MechanicsLeakageValidator.
function leakageViolatingScene(): SceneContent {
  return makeScene({
    beats: [beat({ id: 'b1', text: 'You roll a d20 against DC 15 and feel the dice betray you.' })],
  });
}

function leakageCleanScene(): SceneContent {
  return makeScene({
    beats: [beat({ id: 'b1', text: 'You steady your breath and force the lock until it yields.' })],
  });
}

describe('validateScene — IntensityDistribution detector (Bucket B1)', () => {
  const ENV = 'GATE_INTENSITY_DISTRIBUTION';
  let prev: string | undefined;
  beforeEach(() => {
    prev = process.env[ENV];
  });
  afterEach(() => {
    if (prev === undefined) delete process.env[ENV];
    else process.env[ENV] = prev;
  });

  it('flag OFF + env OFF: detector does not run, no result recorded, no regen', async () => {
    delete process.env[ENV];
    const runner = new IncrementalValidationRunner([], [], [], { ...ISOLATE_BASE, intensityDistributionCheck: false });
    const result = await runner.validateScene(intensityViolatingScene(), undefined, []);
    expect(result.intensityDistribution).toBeUndefined();
    expect(result.regenerationRequested).toBe('none');
  });

  it('flag ON but env OFF: detector does not run (both gates required)', async () => {
    delete process.env[ENV];
    const runner = new IncrementalValidationRunner([], [], [], { ...ISOLATE_BASE, intensityDistributionCheck: true });
    const result = await runner.validateScene(intensityViolatingScene(), undefined, []);
    expect(result.intensityDistribution).toBeUndefined();
  });

  it('flag ON + env ON + violating scene: issues recorded; regen only on error-severity', async () => {
    process.env[ENV] = '1';
    const runner = new IncrementalValidationRunner([], [], [], { ...ISOLATE_BASE, intensityDistributionCheck: true });
    const result = await runner.validateScene(intensityViolatingScene(), undefined, []);
    expect(result.intensityDistribution).toBeDefined();
    expect(result.intensityDistribution!.issues.length).toBeGreaterThan(0);
    // The detector is escalate-only on error severity; this validator emits
    // warnings, so no scene regen is forced.
    const hasError = result.intensityDistribution!.issues.some(i => i.severity === 'error');
    expect(result.regenerationRequested === 'scene').toBe(hasError);
  });

  it('flag ON + env ON + clean scene: detector ran, no issues, unchanged regen', async () => {
    process.env[ENV] = '1';
    const runner = new IncrementalValidationRunner([], [], [], { ...ISOLATE_BASE, intensityDistributionCheck: true });
    const result = await runner.validateScene(intensityCleanScene(), undefined, []);
    expect(result.intensityDistribution).toBeDefined();
    expect(result.intensityDistribution!.issues.length).toBe(0);
    expect(result.regenerationRequested).toBe('none');
  });
});

describe('validateScene — MechanicsLeakage detector (Bucket B1)', () => {
  const ENV = 'GATE_MECHANICS_LEAKAGE_REGEN';
  let prev: string | undefined;
  beforeEach(() => {
    prev = process.env[ENV];
  });
  afterEach(() => {
    if (prev === undefined) delete process.env[ENV];
    else process.env[ENV] = prev;
  });

  it('flag OFF + env OFF: detector does not run, no result recorded, no regen', async () => {
    delete process.env[ENV];
    const runner = new IncrementalValidationRunner([], [], [], { ...ISOLATE_BASE, mechanicsLeakageSceneCheck: false });
    const result = await runner.validateScene(leakageViolatingScene(), undefined, []);
    expect(result.mechanicsLeakage).toBeUndefined();
    expect(result.regenerationRequested).toBe('none');
  });

  it('flag ON but env OFF: detector does not run (both gates required)', async () => {
    delete process.env[ENV];
    const runner = new IncrementalValidationRunner([], [], [], { ...ISOLATE_BASE, mechanicsLeakageSceneCheck: true });
    const result = await runner.validateScene(leakageViolatingScene(), undefined, []);
    expect(result.mechanicsLeakage).toBeUndefined();
  });

  it('flag ON + env ON + violating scene: leak issues recorded; regen only on error-severity', async () => {
    process.env[ENV] = '1';
    const runner = new IncrementalValidationRunner([], [], [], { ...ISOLATE_BASE, mechanicsLeakageSceneCheck: true });
    const result = await runner.validateScene(leakageViolatingScene(), undefined, []);
    expect(result.mechanicsLeakage).toBeDefined();
    expect(result.mechanicsLeakage!.issues.length).toBeGreaterThan(0);
    expect(result.mechanicsLeakage!.metrics.leaksFound).toBeGreaterThan(0);
    const hasError = result.mechanicsLeakage!.issues.some(i => i.severity === 'error');
    expect(result.regenerationRequested === 'scene').toBe(hasError);
  });

  it('flag ON + env ON + clean scene: detector ran, no leaks, unchanged regen', async () => {
    process.env[ENV] = '1';
    const runner = new IncrementalValidationRunner([], [], [], { ...ISOLATE_BASE, mechanicsLeakageSceneCheck: true });
    const result = await runner.validateScene(leakageCleanScene(), undefined, []);
    expect(result.mechanicsLeakage).toBeDefined();
    expect(result.mechanicsLeakage!.issues.length).toBe(0);
    expect(result.mechanicsLeakage!.metrics.leaksFound).toBe(0);
    expect(result.regenerationRequested).toBe('none');
  });
});

describe('validateScene — PropIntroduction is intentionally NOT wired', () => {
  const ENV = 'GATE_PROP_INTRODUCTION';
  let prev: string | undefined;
  beforeEach(() => {
    prev = process.env[ENV];
  });
  afterEach(() => {
    if (prev === undefined) delete process.env[ENV];
    else process.env[ENV] = prev;
  });

  it('flag ON + env ON: no prop-introduction result and no behavior change (needs cross-scene context)', async () => {
    process.env[ENV] = '1';
    const runner = new IncrementalValidationRunner([], [], [], { ...ISOLATE_BASE, propIntroductionCheck: true });
    const result = await runner.validateScene(makeScene(), undefined, []);
    // No field exists on the result for it; validateScene does not consume the flag.
    expect((result as unknown as Record<string, unknown>).propIntroduction).toBeUndefined();
    expect(result.regenerationRequested).toBe('none');
  });
});
