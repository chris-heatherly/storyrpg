import { describe, expect, it } from 'vitest';

import {
  buildEncounterSlotManifest,
  collectMissingSlotsFromManifest,
  encounterSituationKey,
  encounterOutcomeIdentifier,
  encounterSetupIdentifier,
  encounterSituationIdentifier,
  ENCOUNTER_TREE_MAX_DEPTH,
} from './encounterSlotManifest';

describe('encounterSlotManifest', () => {
  it('keeps the default tree depth capped for storyboard encounter image budgets', () => {
    expect(ENCOUNTER_TREE_MAX_DEPTH).toBeLessThanOrEqual(3);
  });

  it('builds stable identifiers matching pipeline conventions', () => {
    // Branch separators are encoded before sanitization to keep nested paths unique.
    expect(encounterSetupIdentifier('EP1::scene-2', 'beat-a')).toBe('encounter-EP1scene-2-beat-a-setup');
    expect(encounterOutcomeIdentifier('EP1::scene-2', 'beat-a', 'c1', 'success')).toBe(
      'encounter-EP1scene-2-beat-a-c1-success'
    );
    expect(encounterSituationIdentifier('EP1::scene-2', 'beat-a', 'c1::failure', 'success')).toBe(
      'encounter-EP1scene-2-situation-beat-a-c1-path-failure-success'
    );
  });

  it('builds beat-qualified situation keys to avoid cross-beat collisions', () => {
    expect(encounterSituationKey('beat-a', 'c1', 'success')).toBe('beat-a::c1::success::situation');
    expect(encounterSituationKey('beat-b', 'c1', 'success')).not.toBe(encounterSituationKey('beat-a', 'c1', 'success'));
  });

  it('orders setup then DFS outcome/situation slots', () => {
    const manifest = buildEncounterSlotManifest(
      {
        beats: [
          {
            id: 'b1',
            choices: [
              {
                id: 'c1',
                outcomes: {
                  success: {
                    nextSituation: {
                      choices: [{ id: 'c2', outcomes: { failure: {} } }],
                    },
                  },
                },
              },
            ],
          },
        ],
      },
      'scene-x',
      'EP1::scene-x',
      ENCOUNTER_TREE_MAX_DEPTH
    );

    const kinds = manifest.slots.map((s) => s.kind);
    expect(kinds[0]).toBe('setup');
    expect(kinds.slice(1)).toEqual(['outcome', 'situation', 'outcome']);
  });

  it('stops emitting slots past max tree depth and records truncation', () => {
    const deep: any = { id: 'leaf', outcomes: { success: {} } };
    for (let i = 0; i < 20; i++) {
      deep.outcomes.success = {
        nextSituation: {
          choices: [{ id: `c-${i}`, outcomes: { success: { nextSituation: { choices: [deep] } } } }],
        },
      };
    }

    const manifest = buildEncounterSlotManifest(
      {
        beats: [{ id: 'b1', choices: [{ id: 'root', outcomes: { success: { nextSituation: { choices: [deep] } } } }] }],
      },
      'scene-x',
      'EP1::scene-x',
      ENCOUNTER_TREE_MAX_DEPTH
    );

    expect(manifest.truncatedPaths.length).toBeGreaterThan(0);
    const outcomeCount = manifest.slots.filter((s) => s.kind === 'outcome').length;
    expect(outcomeCount).toBeLessThan(50);
  });

  it('collectMissingSlotsFromManifest matches map wiring', () => {
    const manifest = buildEncounterSlotManifest(
      {
        beats: [
          {
            id: 'b1',
            choices: [{ id: 'c1', outcomes: { success: {}, complicated: { outcomeImage: 'x' } } }],
          },
        ],
      },
      'scene-x',
      'EP1::scene-x'
    );

    const setup = new Map<string, string>([['b1', 'http://setup']]);
    const outcome = new Map<string, { success?: string; complicated?: string; failure?: string }>([
      ['c1', { success: 'http://ok', complicated: 'http://c' }],
    ]);

    expect(collectMissingSlotsFromManifest(manifest, setup, outcome)).toEqual([]);
    setup.delete('b1');
    const missing = collectMissingSlotsFromManifest(manifest, setup, outcome);
    expect(missing.some((m) => m.includes('setup:scene-x::b1'))).toBe(true);
  });

  it('requires beat-qualified situation keys for missing-slot coverage', () => {
    const manifest = buildEncounterSlotManifest(
      {
        beats: [
          {
            id: 'b1',
            choices: [{ id: 'c1', outcomes: { success: { nextSituation: { choices: [{ id: 'c2', outcomes: { failure: {} } }] } } } }],
          },
          {
            id: 'b2',
            choices: [{ id: 'c1', outcomes: { success: { nextSituation: { choices: [{ id: 'c2', outcomes: { failure: {} } }] } } } }],
          },
        ],
      },
      'scene-x',
      'EP1::scene-x'
    );

    const setup = new Map<string, string>([
      ['b1', 'http://setup-b1'],
      ['b2', 'http://setup-b2'],
      [encounterSituationKey('b1', 'c1', 'success'), 'http://situation-b1'],
    ]);
    const outcome = new Map<string, { success?: string; complicated?: string; failure?: string }>([
      ['c1', { success: 'http://ok' }],
      ['c1::success::c2', { failure: 'http://deep' }],
    ]);

    const missing = collectMissingSlotsFromManifest(manifest, setup, outcome);
    expect(missing).toContain(`situation:scene-x::${encounterSituationKey('b2', 'c1', 'success')}`);
    expect(missing).not.toContain(`situation:scene-x::${encounterSituationKey('b1', 'c1', 'success')}`);
  });
});
