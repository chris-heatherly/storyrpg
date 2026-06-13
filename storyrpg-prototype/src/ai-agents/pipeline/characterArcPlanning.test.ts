/**
 * Character-arc planning wiring tests (characterArcPlanning.ts).
 *
 * Covers the default-off contract (flag off → agent never invoked, mapper
 * returns undefined), the per-episode invocation flow, fail-open behavior
 * (warning emitted, generation continues), the ChoiceAuthor hint mapping
 * (direction/magnitude, caps, zero-delta drops), and the deterministic
 * observed-delta simulation (relationship means, arc-flag identity credits).
 * The agent is mocked — no LLM/network calls.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  CHARACTER_ARC_TRACKING_ENV,
  IDENTITY_FLAG_CREDIT,
  isCharacterArcTrackingEnabled,
  planEpisodeArcTargets,
  simulateEpisodeArcDeltas,
  toChoiceAuthorArcTargets,
  type CharacterArcTrackerLike,
} from './characterArcPlanning';
import type { CharacterArcTargets } from '../agents/CharacterArcTracker';
import type { CharacterBible } from '../agents/CharacterDesigner';
import type { ChoiceSet } from '../agents/ChoiceAuthor';
import type { EpisodeBlueprint } from '../agents/StoryArchitect';

function makeBlueprint(episodeId = 'episode-1'): EpisodeBlueprint {
  return {
    episodeId,
    title: 'Test Episode',
    synopsis: 'A test.',
    scenes: [
      { id: 's1-1', purpose: 'setup', description: 'Opening' },
      { id: 's1-2', purpose: 'development', description: 'Middle' },
    ],
  } as unknown as EpisodeBlueprint;
}

function makeBible(): CharacterBible {
  return {
    characters: [
      { id: 'hero', name: 'Hero', role: 'protagonist' },
      { id: 'mara', name: 'Mara', role: 'ally' },
    ],
  } as unknown as CharacterBible;
}

function makeTargets(overrides: Partial<CharacterArcTargets> = {}): CharacterArcTargets {
  return {
    episodeId: 'episode-1',
    arcPhaseHeadline: 'Test: loyalty compromised',
    identityTargets: [
      { axis: 'mercy_justice', delta: 15, rationale: 'Justice feels earned.' },
    ],
    relationshipTargets: [
      { npcId: 'mara', trustDelta: -10, trajectory: 'warm → guarded', rationale: 'Trust cracks.' },
    ],
    milestones: [],
    ...overrides,
  };
}

function mockTracker(targets: CharacterArcTargets | undefined, error?: string): CharacterArcTrackerLike {
  return { execute: vi.fn().mockResolvedValue({ success: true, data: targets, error }) };
}

const baseParams = (tracker: CharacterArcTrackerLike, emitWarning = vi.fn()) => ({
  enabled: true,
  characterArcTracker: tracker,
  episodeBlueprint: makeBlueprint(),
  characterBible: makeBible(),
  episodeIndex: 1,
  totalEpisodes: 3,
  emitWarning,
  timeoutMs: 50,
});

describe('isCharacterArcTrackingEnabled', () => {
  afterEach(() => {
    delete process.env[CHARACTER_ARC_TRACKING_ENV];
  });

  it('defaults off with no env and no config', () => {
    expect(isCharacterArcTrackingEnabled(undefined)).toBe(false);
    expect(isCharacterArcTrackingEnabled({})).toBe(false);
  });

  it('config opt-in enables', () => {
    expect(isCharacterArcTrackingEnabled({ enableCharacterArcTracking: true })).toBe(true);
  });

  it('env 1 forces on, env 0 kill-switches a config-on', () => {
    process.env[CHARACTER_ARC_TRACKING_ENV] = '1';
    expect(isCharacterArcTrackingEnabled({})).toBe(true);
    process.env[CHARACTER_ARC_TRACKING_ENV] = '0';
    expect(isCharacterArcTrackingEnabled({ enableCharacterArcTracking: true })).toBe(false);
  });
});

describe('planEpisodeArcTargets', () => {
  it('enabled:false is a guaranteed no-op (agent never invoked)', async () => {
    const tracker = mockTracker(makeTargets());
    const result = await planEpisodeArcTargets({ ...baseParams(tracker), enabled: false });
    expect(result).toEqual({});
    expect(tracker.execute).not.toHaveBeenCalled();
  });

  it('returns targets when the tracker produced at least one concrete target', async () => {
    const tracker = mockTracker(makeTargets());
    const result = await planEpisodeArcTargets(baseParams(tracker));
    expect(result.arcTargets?.identityTargets).toHaveLength(1);
    expect(tracker.execute).toHaveBeenCalledOnce();
  });

  it('treats an all-empty plan as no plan and surfaces the agent error as a warning', async () => {
    const emitWarning = vi.fn();
    const tracker = mockTracker(
      makeTargets({ identityTargets: [], relationshipTargets: [], milestones: [] }),
      'LLM parse failed',
    );
    const result = await planEpisodeArcTargets(baseParams(tracker, emitWarning));
    expect(result.arcTargets).toBeUndefined();
    expect(emitWarning).toHaveBeenCalledWith(expect.stringContaining('LLM parse failed'));
  });

  it('fails open on a thrown error', async () => {
    const emitWarning = vi.fn();
    const tracker: CharacterArcTrackerLike = {
      execute: vi.fn().mockRejectedValue(new Error('network down')),
    };
    const result = await planEpisodeArcTargets(baseParams(tracker, emitWarning));
    expect(result.arcTargets).toBeUndefined();
    expect(emitWarning).toHaveBeenCalledWith(expect.stringContaining('network down'));
  });

  it('fails open on timeout', async () => {
    const emitWarning = vi.fn();
    const tracker: CharacterArcTrackerLike = {
      execute: vi.fn().mockImplementation(() => new Promise(() => undefined)),
    };
    const result = await planEpisodeArcTargets({ ...baseParams(tracker, emitWarning), timeoutMs: 10 });
    expect(result.arcTargets).toBeUndefined();
    expect(emitWarning).toHaveBeenCalledWith(expect.stringContaining('CharacterArcTracker failed'));
  });
});

describe('toChoiceAuthorArcTargets', () => {
  it('returns undefined for no targets or all-zero deltas', () => {
    expect(toChoiceAuthorArcTargets(undefined)).toBeUndefined();
    expect(
      toChoiceAuthorArcTargets(
        makeTargets({
          identityTargets: [{ axis: 'mercy_justice', delta: 0, rationale: '' }],
          relationshipTargets: [{ npcId: 'mara', trustDelta: 0, trajectory: '', rationale: '' }],
        }),
      ),
    ).toBeUndefined();
  });

  it('maps signed deltas to direction + coarse magnitude', () => {
    const mapped = toChoiceAuthorArcTargets(
      makeTargets({
        identityTargets: [
          { axis: 'mercy_justice', delta: 8, rationale: '' },
          { axis: 'cautious_bold', delta: -18, rationale: '' },
          { axis: 'heart_head', delta: 30, rationale: '' },
        ],
        relationshipTargets: [],
      }),
    );
    expect(mapped?.identityDeltaHints).toEqual([
      { dimension: 'heart_head', direction: 'positive', magnitude: 'major' },
      { dimension: 'cautious_bold', direction: 'negative', magnitude: 'moderate' },
      { dimension: 'mercy_justice', direction: 'positive', magnitude: 'minor' },
    ]);
  });

  it('caps identity hints at 3, keeping the largest planned movement', () => {
    const mapped = toChoiceAuthorArcTargets(
      makeTargets({
        identityTargets: [
          { axis: 'mercy_justice', delta: 5, rationale: '' },
          { axis: 'cautious_bold', delta: 10, rationale: '' },
          { axis: 'heart_head', delta: 20, rationale: '' },
          { axis: 'loner_leader', delta: 30, rationale: '' },
        ],
        relationshipTargets: [],
      }),
    );
    expect(mapped?.identityDeltaHints).toHaveLength(3);
    expect(mapped?.identityDeltaHints?.map((h) => h.dimension)).not.toContain('mercy_justice');
  });

  it('expands relationship targets to one entry per specified dimension', () => {
    const mapped = toChoiceAuthorArcTargets(
      makeTargets({
        identityTargets: [],
        relationshipTargets: [
          { npcId: 'mara', trustDelta: -10, bondDelta: 8, trajectory: 'warm → guarded', rationale: 'Adversity.' },
        ],
      }),
    );
    expect(mapped?.relationshipTrajectory).toEqual([
      { npcId: 'mara', dimension: 'trust', direction: 'negative', hint: 'warm → guarded — Adversity.' },
      { npcId: 'mara', dimension: 'bond', direction: 'positive', hint: 'warm → guarded — Adversity.' },
    ]);
  });
});

describe('simulateEpisodeArcDeltas', () => {
  const makeChoiceSet = (choices: Array<{ consequences?: unknown[] }>): ChoiceSet =>
    ({ beatId: 'b1', choiceType: 'tactical', choices, overallStakes: {}, designNotes: '' }) as unknown as ChoiceSet;

  it('returns undefined when no measurable signal exists', () => {
    expect(simulateEpisodeArcDeltas([])).toBeUndefined();
    expect(
      simulateEpisodeArcDeltas([
        makeChoiceSet([{ consequences: [{ type: 'setFlag', flag: 'door_open', value: true }] }]),
      ]),
    ).toBeUndefined();
  });

  it('credits arc-driving flags once per choice point per axis (either flag-name field)', () => {
    const sets = [
      makeChoiceSet([
        { consequences: [{ type: 'setFlag', flag: 'arc:mercy_justice:positive', value: true }] },
        { consequences: [{ type: 'setFlag', name: 'arc:mercy_justice:positive', value: true }] },
      ]),
      makeChoiceSet([
        { consequences: [{ type: 'setFlag', flag: 'arc:honest_deceptive:negative', value: true }] },
      ]),
    ];
    const sim = simulateEpisodeArcDeltas(sets);
    expect(sim?.endIdentity).toEqual({
      mercy_justice: IDENTITY_FLAG_CREDIT,
      honest_deceptive: -IDENTITY_FLAG_CREDIT,
    });
  });

  it('averages relationship deltas per choice point and maps affection to bond', () => {
    const sets = [
      makeChoiceSet([
        { consequences: [{ type: 'relationship', npcId: 'mara', dimension: 'trust', change: -10 }] },
        { consequences: [] },
      ]),
      makeChoiceSet([
        { consequences: [{ type: 'relationship', npcId: 'mara', dimension: 'affection', change: 6 }] },
      ]),
    ];
    const sim = simulateEpisodeArcDeltas(sets);
    expect(sim?.relationshipDeltas).toEqual({ mara: { trust: -5, bond: 6 } });
  });

  it('ignores unmapped dimensions (fear) and non-numeric changes', () => {
    const sets = [
      makeChoiceSet([
        { consequences: [{ type: 'relationship', npcId: 'mara', dimension: 'fear', change: 9 }] },
      ]),
    ];
    expect(simulateEpisodeArcDeltas(sets)).toBeUndefined();
  });
});
