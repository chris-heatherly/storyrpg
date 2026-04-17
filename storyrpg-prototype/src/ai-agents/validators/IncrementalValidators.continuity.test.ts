import { describe, expect, it } from 'vitest';
import { IncrementalContinuityChecker } from './IncrementalValidators';
import type { EncounterStructure } from '../agents/EncounterArchitect';

describe('IncrementalContinuityChecker', () => {
  describe('checkConditionExpression', () => {
    it('reports forward_reference for flag not yet set', () => {
      const checker = new IncrementalContinuityChecker(['known_flag'], []);
      const issues: any[] = [];

      checker.checkConditionExpression(
        { type: 'flag', flag: 'unknown_flag', value: true },
        issues,
        'test:choice1'
      );

      expect(issues).toHaveLength(1);
      expect(issues[0].type).toBe('forward_reference');
      expect(issues[0].detail).toContain('unknown_flag');
      expect(issues[0].severity).toBe('error');
    });

    it('passes for flag in knownFlags', () => {
      const checker = new IncrementalContinuityChecker(['known_flag'], []);
      const issues: any[] = [];

      checker.checkConditionExpression(
        { type: 'flag', flag: 'known_flag', value: true },
        issues,
        'test:choice1'
      );

      expect(issues).toHaveLength(0);
    });

    it('passes for flag in setFlags', () => {
      const checker = new IncrementalContinuityChecker([], []);
      checker.trackFlagSet('dynamic_flag');
      const issues: any[] = [];

      checker.checkConditionExpression(
        { type: 'flag', flag: 'dynamic_flag', value: true },
        issues,
        'test:choice1'
      );

      expect(issues).toHaveLength(0);
    });

    it('walks and-compound conditions', () => {
      const checker = new IncrementalContinuityChecker(['flag_a'], []);
      const issues: any[] = [];

      checker.checkConditionExpression(
        {
          type: 'and',
          conditions: [
            { type: 'flag', flag: 'flag_a', value: true },
            { type: 'flag', flag: 'flag_b', value: true },
          ],
        },
        issues,
        'test:choice1'
      );

      expect(issues).toHaveLength(1);
      expect(issues[0].detail).toContain('flag_b');
    });

    it('walks or-compound conditions', () => {
      const checker = new IncrementalContinuityChecker([], []);
      const issues: any[] = [];

      checker.checkConditionExpression(
        {
          type: 'or',
          conditions: [
            { type: 'flag', flag: 'missing_a', value: true },
            { type: 'flag', flag: 'missing_b', value: false },
          ],
        },
        issues,
        'test:choice1'
      );

      expect(issues).toHaveLength(2);
    });

    it('walks not-compound condition', () => {
      const checker = new IncrementalContinuityChecker([], []);
      const issues: any[] = [];

      checker.checkConditionExpression(
        {
          type: 'not',
          condition: { type: 'flag', flag: 'negated_flag', value: true },
        },
        issues,
        'test:choice1'
      );

      expect(issues).toHaveLength(1);
      expect(issues[0].detail).toContain('negated_flag');
    });

    it('reports undefined_score for score not in knownScores', () => {
      const checker = new IncrementalContinuityChecker([], ['reputation']);
      const issues: any[] = [];

      checker.checkConditionExpression(
        { type: 'score', score: 'unknown_score', operator: '>=', value: 10 },
        issues,
        'test:choice1'
      );

      expect(issues).toHaveLength(1);
      expect(issues[0].type).toBe('undefined_score');
    });

    it('passes for score in modifiedScores', () => {
      const checker = new IncrementalContinuityChecker([], []);
      checker.trackScoreModified('dynamic_score');
      const issues: any[] = [];

      checker.checkConditionExpression(
        { type: 'score', score: 'dynamic_score', operator: '>=', value: 10 },
        issues,
        'test:choice1'
      );

      expect(issues).toHaveLength(0);
    });

    it('ignores non-flag/score/relationship condition types (attribute, etc.)', () => {
      const checker = new IncrementalContinuityChecker([], []);
      const issues: any[] = [];

      checker.checkConditionExpression(
        { type: 'attribute', attribute: 'strength', operator: '>=', value: 5 },
        issues,
        'test:choice1'
      );

      expect(issues).toHaveLength(0);
    });

    it('handles legacy single-key boolean object as flag', () => {
      const checker = new IncrementalContinuityChecker([], []);
      const issues: any[] = [];

      checker.checkConditionExpression(
        { spared_scout: true },
        issues,
        'test:choice1'
      );

      expect(issues).toHaveLength(1);
      expect(issues[0].type).toBe('forward_reference');
      expect(issues[0].detail).toContain('spared_scout');
    });
  });

  describe('checkEncounterChoiceConditions', () => {
    function makeMinimalEncounter(overrides: Partial<EncounterStructure> = {}): EncounterStructure {
      return {
        sceneId: 'scene-1',
        encounterType: 'combat',
        startingBeatId: 'beat-1',
        goalClock: { name: 'Goal', segments: 4, description: 'Win' },
        threatClock: { name: 'Threat', segments: 4, description: 'Lose' },
        stakes: { victory: 'Win', defeat: 'Lose' },
        tensionCurve: [],
        beats: [],
        storylets: {},
        ...overrides,
      } as EncounterStructure;
    }

    it('detects forward-reference in encounter choice conditions', () => {
      const checker = new IncrementalContinuityChecker(['known_flag'], []);
      const encounter = makeMinimalEncounter({
        beats: [
          {
            id: 'beat-1',
            phase: 'setup',
            name: 'Test',
            description: 'Test beat',
            setupText: 'Setup text.',
            choices: [
              {
                id: 'c1',
                text: 'Do something',
                approach: 'bold',
                outcomes: {
                  success: { tier: 'success', narrativeText: 'ok', goalTicks: 1, threatTicks: 0 },
                  complicated: { tier: 'complicated', narrativeText: 'ok', goalTicks: 0, threatTicks: 1 },
                  failure: { tier: 'failure', narrativeText: 'bad', goalTicks: 0, threatTicks: 2 },
                },
                conditions: { type: 'flag', flag: 'future_flag', value: true },
                showWhenLocked: true,
                lockedText: 'Not available.',
              },
            ],
          },
        ],
      });

      const issues = checker.checkEncounterChoiceConditions(encounter);

      expect(issues).toHaveLength(1);
      expect(issues[0].type).toBe('forward_reference');
      expect(issues[0].detail).toContain('future_flag');
    });

    it('passes when encounter choice references a known flag', () => {
      const checker = new IncrementalContinuityChecker(['already_set'], []);
      checker.trackFlagSet('already_set');
      const encounter = makeMinimalEncounter({
        beats: [
          {
            id: 'beat-1',
            phase: 'setup',
            name: 'Test',
            description: 'Test beat',
            setupText: 'Setup text.',
            choices: [
              {
                id: 'c1',
                text: 'Do something',
                approach: 'bold',
                outcomes: {
                  success: { tier: 'success', narrativeText: 'ok', goalTicks: 1, threatTicks: 0 },
                  complicated: { tier: 'complicated', narrativeText: 'ok', goalTicks: 0, threatTicks: 1 },
                  failure: { tier: 'failure', narrativeText: 'bad', goalTicks: 0, threatTicks: 2 },
                },
                conditions: { type: 'flag', flag: 'already_set', value: true },
              },
            ],
          },
        ],
      });

      const issues = checker.checkEncounterChoiceConditions(encounter);
      expect(issues).toHaveLength(0);
    });

    it('checks statBonus conditions as well', () => {
      const checker = new IncrementalContinuityChecker([], []);
      const encounter = makeMinimalEncounter({
        beats: [
          {
            id: 'beat-1',
            phase: 'setup',
            name: 'Test',
            description: 'Test beat',
            setupText: 'Setup text.',
            choices: [
              {
                id: 'c1',
                text: 'Do something',
                approach: 'bold',
                outcomes: {
                  success: { tier: 'success', narrativeText: 'ok', goalTicks: 1, threatTicks: 0 },
                  complicated: { tier: 'complicated', narrativeText: 'ok', goalTicks: 0, threatTicks: 1 },
                  failure: { tier: 'failure', narrativeText: 'bad', goalTicks: 0, threatTicks: 2 },
                },
                statBonus: {
                  condition: { type: 'flag', flag: 'missing_bonus_flag', value: true },
                  difficultyReduction: 15,
                },
              },
            ],
          },
        ],
      });

      const issues = checker.checkEncounterChoiceConditions(encounter);

      expect(issues).toHaveLength(1);
      expect(issues[0].detail).toContain('missing_bonus_flag');
    });
  });

  describe('checkScene with conditions (plural)', () => {
    it('checks ConditionExpression objects on choice.conditions', () => {
      const checker = new IncrementalContinuityChecker([], []);
      const issues = checker.checkScene(
        { sceneId: 'scene-1', sceneName: 'Test', beats: [] } as any,
        {
          beatId: 'beat-1',
          sceneId: 'scene-1',
          choices: [
            {
              id: 'c1',
              text: 'A choice',
              conditions: { type: 'flag', flag: 'unreachable', value: true },
              consequences: [],
            },
          ] as any,
        } as any
      );

      expect(issues.issues).toHaveLength(1);
      expect(issues.issues[0].type).toBe('forward_reference');
      expect(issues.issues[0].detail).toContain('unreachable');
    });
  });

  describe('relationship condition checking', () => {
    it('reports forward_reference when relationship threshold is unreachable', () => {
      const checker = new IncrementalContinuityChecker([], []);
      checker.setRelationshipBaselines([
        { id: 'bryant', initialRelationship: { trust: 0, affection: 0, respect: 0, fear: 0 } },
      ]);
      const issues: any[] = [];
      checker.checkConditionExpression(
        { type: 'relationship', npcId: 'bryant', dimension: 'respect', operator: '>', value: 10 },
        issues,
        'test'
      );
      expect(issues).toHaveLength(1);
      expect(issues[0].type).toBe('forward_reference');
      expect(issues[0].detail).toContain('bryant.respect');
      expect(issues[0].detail).toContain('max achievable: 0');
    });

    it('passes when relationship gains make threshold reachable', () => {
      const checker = new IncrementalContinuityChecker([], []);
      checker.setRelationshipBaselines([
        { id: 'bryant', initialRelationship: { trust: 0, affection: 0, respect: 5, fear: 0 } },
      ]);
      checker.trackRelationshipChange('bryant', 'respect', 10);
      const issues: any[] = [];
      checker.checkConditionExpression(
        { type: 'relationship', npcId: 'bryant', dimension: 'respect', operator: '>', value: 10 },
        issues,
        'test'
      );
      expect(issues).toHaveLength(0);
    });

    it('reports unreachable even with some gains but not enough', () => {
      const checker = new IncrementalContinuityChecker([], []);
      checker.setRelationshipBaselines([
        { id: 'npc1', initialRelationship: { trust: 0, respect: 0, affection: 0, fear: 0 } },
      ]);
      checker.trackRelationshipChange('npc1', 'trust', 3);
      const issues: any[] = [];
      checker.checkConditionExpression(
        { type: 'relationship', npcId: 'npc1', dimension: 'trust', operator: '>=', value: 10 },
        issues,
        'test'
      );
      expect(issues).toHaveLength(1);
      expect(issues[0].detail).toContain('max achievable: 3');
    });

    it('defaults baseline to 0 for unknown NPCs', () => {
      const checker = new IncrementalContinuityChecker([], []);
      const issues: any[] = [];
      checker.checkConditionExpression(
        { type: 'relationship', npcId: 'unknown', dimension: 'trust', operator: '>', value: 5 },
        issues,
        'test'
      );
      expect(issues).toHaveLength(1);
      expect(issues[0].detail).toContain('max achievable: 0');
    });

    it('does not flag < or <= conditions', () => {
      const checker = new IncrementalContinuityChecker([], []);
      checker.setRelationshipBaselines([
        { id: 'npc1', initialRelationship: { trust: 0, respect: 0, affection: 0, fear: 0 } },
      ]);
      const issues: any[] = [];
      checker.checkConditionExpression(
        { type: 'relationship', npcId: 'npc1', dimension: 'trust', operator: '<', value: 10 },
        issues,
        'test'
      );
      expect(issues).toHaveLength(0);
    });

    it('catches unreachable relationship in compound AND condition', () => {
      const checker = new IncrementalContinuityChecker(['some_flag'], []);
      checker.setRelationshipBaselines([
        { id: 'npc1', initialRelationship: { trust: 0, respect: 0, affection: 0, fear: 0 } },
      ]);
      const issues: any[] = [];
      checker.checkConditionExpression(
        {
          type: 'and',
          conditions: [
            { type: 'flag', flag: 'some_flag', value: true },
            { type: 'relationship', npcId: 'npc1', dimension: 'respect', operator: '>', value: 50 },
          ],
        },
        issues,
        'test'
      );
      expect(issues).toHaveLength(1);
      expect(issues[0].detail).toContain('npc1.respect');
    });
  });
});
