import { describe, expect, it } from 'vitest';
import type { Story } from '../../types/story';
import { applyCraftAutofix } from './applyCraftAutofix';

const ALL_GATES = new Set([
  'GATE_STAT_CHECK_BALANCE',
  'GATE_CHOICE_IMPACT',
  'GATE_NPC_DEPTH',
  'GATE_ARC_DELTA',
  'GATE_MECHANICS_LEAKAGE',
]);

const allOn = (flag: string) => ALL_GATES.has(flag);
const allOff = (_flag: string) => false;

/**
 * Build a fixture that simultaneously violates all five craft repairs:
 *   - StatCheckBalance: a choice whose stat-check difficulty (10) is below the
 *     [35, 80] band → 1 fix.
 *   - ChoiceImpact: that same choice has neither `impactFactors` nor
 *     `consequenceTier`; `statCheck` makes `process` derivable and
 *     `consequenceTier` is always derivable → 2 fixes.
 *   - NPCDepth: a core NPC with no relationship dimensions → 1 fix.
 *   - ArcEndpointPresence: an NPC declaring only `arc.startState` → 1 fix.
 *   - MechanicsLeakage: a beat whose text ends with an isolated stat-delta
 *     token ("Trust +10") → 1 fix.
 * Aggregated expected fixedCount = 1 + 2 + 1 + 1 + 1 = 6.
 */
function buildMultiViolationStory(): Story {
  return {
    id: 'story-1',
    title: 'Fixture',
    genre: 'drama',
    synopsis: '',
    coverImage: '',
    initialState: {
      attributes: {} as Story['initialState']['attributes'],
      skills: {} as Story['initialState']['skills'],
      tags: [],
      inventory: [],
    },
    npcs: [
      // core NPC missing all relationship dimensions → NPCDepth fix.
      {
        id: 'npc-core',
        name: 'Mara',
        description: 'A trusted ally.',
        tier: 'core',
      },
      // single-endpoint arc → ArcEndpointPresence fix.
      {
        id: 'npc-arc',
        name: 'Sel',
        description: 'A drifting acquaintance.',
        tier: 'background',
        relationshipDimensions: ['trust'],
        arc: { startState: 'guarded' },
      },
    ],
    episodes: [
      {
        id: 'ep-1',
        number: 1,
        title: 'Episode',
        synopsis: '',
        coverImage: '' as never,
        startingSceneId: 'scene-1',
        scenes: [
          {
            id: 'scene-1',
            name: 'Scene',
            startingBeatId: 'beat-1',
            beats: [
              {
                id: 'beat-1',
                // trailing isolated stat-delta token → MechanicsLeakage fix.
                text: 'She nods toward the door. Trust +10',
                choices: [
                  {
                    id: 'choice-1',
                    text: 'Step through.',
                    // below-band difficulty → StatCheckBalance fix;
                    // statCheck presence + no impact metadata → ChoiceImpact x2.
                    statCheck: { difficulty: 10 },
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  } as Story;
}

describe('applyCraftAutofix', () => {
  it('is a complete no-op when all gates are off', () => {
    const story = buildMultiViolationStory();
    const before = JSON.stringify(story);

    const result = applyCraftAutofix(story, allOff);

    expect(result.fixedCount).toBe(0);
    expect(result.records).toEqual([]);
    expect(JSON.stringify(story)).toBe(before);
  });

  it('aggregates fixedCount and records across all repairs when all gates are on', () => {
    const story = buildMultiViolationStory();

    const result = applyCraftAutofix(story, allOn);

    // 1 (statCheck) + 2 (choiceImpact) + 1 (npcDepth) + 1 (arc) + 1 (leakage)
    expect(result.fixedCount).toBe(6);
    expect(result.records).toHaveLength(6);

    // fixedCount and record count stay in lockstep.
    expect(result.records).toHaveLength(result.fixedCount);

    // The concatenated record stream covers every repair's rule name.
    const rules = new Set(result.records.map((r) => r.rule));
    expect(rules).toEqual(
      new Set([
        'StatCheckBalance',
        'ChoiceImpact',
        'NPCDepth',
        'ArcEndpointPresence',
        'MechanicsLeakage',
      ]),
    );

    // Every record is an autofix-scoped success.
    for (const record of result.records) {
      expect(record.scope).toBe('autofix');
      expect(record.succeeded).toBe(true);
    }
  });

  it('re-running after a successful pass yields no further fixes (idempotent)', () => {
    const story = buildMultiViolationStory();
    applyCraftAutofix(story, allOn);

    const second = applyCraftAutofix(story, allOn);

    expect(second.fixedCount).toBe(0);
    expect(second.records).toEqual([]);
  });
});
