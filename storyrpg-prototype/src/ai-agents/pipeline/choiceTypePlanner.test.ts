import { describe, expect, it } from 'vitest';
import {
  allocateChoiceTypeCounts,
  assignChoiceTypes,
  planSkillRotation,
  DEFAULT_CHOICE_TYPE_TARGET,
  type ChoiceType,
} from './choiceTypePlanner';

describe('allocateChoiceTypeCounts', () => {
  it('always sums to n (largest-remainder)', () => {
    for (const n of [0, 1, 3, 4, 7, 10, 13]) {
      const counts = allocateChoiceTypeCounts(n);
      const sum = counts.expression + counts.relationship + counts.strategic + counts.dilemma;
      expect(sum).toBe(n);
    }
  });

  it('roughly matches the target proportions at scale', () => {
    const counts = allocateChoiceTypeCounts(100);
    expect(counts.expression).toBe(35);
    expect(counts.relationship).toBe(30);
    expect(counts.strategic).toBe(20);
    expect(counts.dilemma).toBe(15);
  });
});

describe('assignChoiceTypes', () => {
  const scenes = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ id: `scene-${i}`, choicePoint: { type: 'dilemma' as ChoiceType } }));

  it('introduces expression and relationship choices (fixes the 0%/0% skew)', () => {
    const s = scenes(4); // the Endsong shape: 4 choice points, all dilemma/strategic
    assignChoiceTypes(s);
    const types = s.map((x) => x.choicePoint!.type);
    // 4 points at 35/30/20/15 → expression 1, relationship 1, strategic 1, dilemma 1
    expect(types).toContain('expression');
    expect(types).toContain('relationship');
  });

  it('never assigns expression to a branching choice point', () => {
    const s = [
      { id: 'a', choicePoint: { type: 'dilemma' as ChoiceType, branches: true } },
      { id: 'b', choicePoint: { type: 'dilemma' as ChoiceType } },
      { id: 'c', choicePoint: { type: 'dilemma' as ChoiceType } },
    ];
    assignChoiceTypes(s);
    const branching = s.find((x) => x.choicePoint!.branches)!;
    expect(branching.choicePoint!.type).not.toBe('expression');
  });

  it('skips encounters and scenes without a choice point', () => {
    const s: any[] = [
      { id: 'enc', isEncounter: true, choicePoint: { type: 'dilemma' } },
      { id: 'plain' },
      { id: 'cp', choicePoint: { type: 'dilemma' } },
    ];
    const assignments = assignChoiceTypes(s);
    expect(assignments.map((a) => a.sceneId)).toEqual(['cp']);
  });

  it('is a no-op shape when there are no choice points', () => {
    expect(assignChoiceTypes([{ id: 'x' }])).toEqual([]);
  });

  it('guarantees at least one dilemma at >=3 choice points (fixes the 0%-dilemma finding)', () => {
    const s = scenes(3); // largest-remainder alone would give 0 dilemma
    assignChoiceTypes(s);
    const types = s.map((x) => x.choicePoint!.type);
    expect(types).toContain('dilemma');
  });

  it('A3: the dilemma guarantee does NOT zero strategic at small N (steals from the largest type)', () => {
    const s = scenes(3); // allocation → expr1/rel1/strat1/dilemma0; guarantee must not take strategic
    assignChoiceTypes(s);
    const types = s.map((x) => x.choicePoint!.type);
    expect(types).toContain('dilemma');
    expect(types).toContain('strategic'); // preserved — donor was expression/relationship, not strategic
  });

  it('routes the guaranteed dilemma onto a branching choice point when present', () => {
    const s = [
      { id: 'a', choicePoint: { type: 'strategic' as ChoiceType } },
      { id: 'b', choicePoint: { type: 'strategic' as ChoiceType } },
      { id: 'bottleneck', choicePoint: { type: 'strategic' as ChoiceType, branches: true } },
    ];
    assignChoiceTypes(s);
    // dilemma exists and is not on an expression (branching can't be expression)
    const all = s.map((x) => x.choicePoint!.type);
    expect(all).toContain('dilemma');
  });

  it('does not force a dilemma for a tiny (<3) episode', () => {
    const s = scenes(2);
    assignChoiceTypes(s);
    // 2 slots at 35/30/... → expression + relationship; dilemma not forced
    expect(s.map((x) => x.choicePoint!.type)).not.toContain('dilemma');
  });
});

describe('planSkillRotation', () => {
  it('spreads skills round-robin and does not let one dominate', () => {
    const s: Array<{ id: string; choicePoint: { type: ChoiceType; primarySkill?: string } }> =
      Array.from({ length: 6 }, (_, i) => ({ id: `s${i}`, choicePoint: { type: 'strategic' as ChoiceType } }));
    planSkillRotation(s, ['persuasion', 'investigation', 'athletics']);
    const used = s.map((x) => x.choicePoint!.primarySkill);
    const counts = used.reduce<Record<string, number>>((m, k) => ((m[k!] = (m[k!] || 0) + 1), m), {});
    // 6 choice points / 3 skills → 2 each, none dominates
    expect(Math.max(...Object.values(counts))).toBeLessThanOrEqual(2);
  });

  it('respects an already-assigned skill', () => {
    const s = [
      { id: 'a', choicePoint: { type: 'strategic' as ChoiceType, primarySkill: 'lockpicking' } },
      { id: 'b', choicePoint: { type: 'strategic' as ChoiceType } },
    ];
    planSkillRotation(s, ['persuasion', 'athletics']);
    expect(s[0].choicePoint!.primarySkill).toBe('lockpicking');
    expect(s[1].choicePoint!.primarySkill).toBeDefined();
  });
});
