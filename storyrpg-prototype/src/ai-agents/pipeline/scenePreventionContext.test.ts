import { describe, expect, it } from 'vitest';
import { buildPriorEncounterOutcomes, buildContinueInLocation } from './scenePreventionContext';

// Light identity sanitizer for tests (the pipeline passes its reader-facing one).
const passthru = (name: string | undefined, fallback: string) => name || fallback;

describe('buildPriorEncounterOutcomes (W4 prevention)', () => {
  const blueprint = {
    scenes: [
      { id: 'enc-1', name: 'The Wall Breach', isEncounter: true, leadsTo: ['s3-5'], encounterStakes: 'Hold the breach or lose the wall' },
      { id: 's3-5', name: 'Battlements at Midnight', leadsTo: ['s3-6'] },
    ],
  } as any;

  it('surfaces outcome flags for a scene an encounter routes into', () => {
    const post = buildPriorEncounterOutcomes(blueprint, blueprint.scenes[1], passthru)!;
    expect(post).toHaveLength(1);
    expect(post[0].encounterId).toBe('enc-1');
    expect(post[0].encounterName).toBe('The Wall Breach');
    const flags = post[0].outcomeFlags.map((o) => o.flag);
    expect(flags).toContain('encounter_enc-1_partialVictory');
    expect(flags).toContain('encounter_enc-1_defeat');
  });

  it('returns undefined for a scene with no incoming encounter', () => {
    expect(buildPriorEncounterOutcomes(blueprint, blueprint.scenes[0], passthru)).toBeUndefined();
  });
});

describe('buildContinueInLocation (B1 prevention)', () => {
  const blueprint = {
    scenes: [
      { id: 's3-2', name: "Thorne's Challenge", location: "Commander's Hall, Fort Dawnwatch" },
      { id: 's3-3', name: 'Darian Positions Himself', location: "Commander's Hall, Fort Dawnwatch" },
      { id: 's3-4', name: 'The Yard', location: 'The Training Yard' },
    ],
  } as any;

  it('flags a same-location continuation (not a fresh arrival)', () => {
    expect(buildContinueInLocation(blueprint, blueprint.scenes[1])).toBe("Commander's Hall, Fort Dawnwatch");
  });

  it('returns undefined for a different location', () => {
    expect(buildContinueInLocation(blueprint, blueprint.scenes[2])).toBeUndefined();
  });

  it('returns undefined for the first scene (no predecessor)', () => {
    expect(buildContinueInLocation(blueprint, blueprint.scenes[0])).toBeUndefined();
  });

  it('does not flag continuation across an encounter', () => {
    const bp = { scenes: [
      { id: 'a', location: 'Hall', isEncounter: true },
      { id: 'b', location: 'Hall' },
    ] } as any;
    expect(buildContinueInLocation(bp, bp.scenes[1])).toBeUndefined();
  });
});
