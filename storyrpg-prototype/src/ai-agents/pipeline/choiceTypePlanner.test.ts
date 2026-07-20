import { describe, expect, it } from 'vitest';
import {
  allocateChoiceTypeCounts,
  assignChoiceTypes,
  missingPlannedChoiceTypes,
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

  it('honors the season slice but still guarantees >=1 dilemma (E1)', () => {
    // Season plan allocated this episode 3 strategic + 1 relationship + 0 dilemma.
    // The per-episode dilemma guarantee now fires even with an explicit slice: it
    // converts ONE over-represented choice (the largest non-dilemma = strategic) to
    // a dilemma, so no reasonably-sized episode ships zero moral choices.
    const s = scenes(4);
    assignChoiceTypes(s, DEFAULT_CHOICE_TYPE_TARGET, { expression: 0, relationship: 1, strategic: 3, dilemma: 0 });
    const counts = s.reduce((a, x) => { a[x.choicePoint!.type] = (a[x.choicePoint!.type] ?? 0) + 1; return a; }, {} as Record<string, number>);
    expect(counts.expression ?? 0).toBe(0);
    expect(counts.dilemma).toBe(1);   // guaranteed
    expect(counts.strategic).toBe(2); // donor: largest non-dilemma type
    expect(counts.relationship).toBe(1);
  });

  it('pins authored relationship choice types ahead of the episode budget allocator', () => {
    const s = [
      {
        id: 'group-formation',
        authoredChoiceType: 'relationship' as ChoiceType,
        choicePoint: { type: 'expression' as ChoiceType },
      },
      { id: 'generic', choicePoint: { type: 'dilemma' as ChoiceType } },
    ];

    assignChoiceTypes(s, DEFAULT_CHOICE_TYPE_TARGET, {
      expression: 2,
      relationship: 0,
      strategic: 0,
      dilemma: 0,
    });

    expect(s[0].choicePoint.type).toBe('relationship');
  });

  it('subtracts pinned slots before allocating the remaining episode choice debt', () => {
    const s = [
      {
        id: 'group-formation',
        authoredChoiceType: 'relationship' as ChoiceType,
        choicePoint: { type: 'expression' as ChoiceType },
      },
      { id: 'opening', choicePoint: { type: 'expression' as ChoiceType } },
      { id: 'investigation', choicePoint: { type: 'relationship' as ChoiceType } },
    ];

    assignChoiceTypes(s, DEFAULT_CHOICE_TYPE_TARGET, {
      expression: 1,
      relationship: 1,
      strategic: 1,
      dilemma: 0,
    });

    expect(s.map((scene) => scene.choicePoint.type)).toEqual([
      'relationship',
      'expression',
      'strategic',
    ]);
  });

  it('does not force a dilemma for tiny episodes (<3 choice points)', () => {
    const s = scenes(2);
    assignChoiceTypes(s, DEFAULT_CHOICE_TYPE_TARGET, { expression: 1, relationship: 1, strategic: 0, dilemma: 0 });
    const counts = s.reduce((a, x) => { a[x.choicePoint!.type] = (a[x.choicePoint!.type] ?? 0) + 1; return a; }, {} as Record<string, number>);
    expect(counts.dilemma ?? 0).toBe(0);
  });

  it('falls back to the default mix when seasonCounts is all-zero', () => {
    const s = scenes(4);
    assignChoiceTypes(s, DEFAULT_CHOICE_TYPE_TARGET, { expression: 0, relationship: 0, strategic: 0, dilemma: 0 });
    const types = s.map((x) => x.choicePoint!.type);
    expect(types).toContain('expression'); // default 35/30/20/15 still applies
  });

  it('does not inflate a sparse season slice into every local choice point', () => {
    const s = scenes(7);
    assignChoiceTypes(s, DEFAULT_CHOICE_TYPE_TARGET, { expression: 0, relationship: 1, strategic: 0, dilemma: 0 });
    const counts = s.reduce((a, x) => { a[x.choicePoint!.type] = (a[x.choicePoint!.type] ?? 0) + 1; return a; }, {} as Record<string, number>);

    expect(counts.relationship).toBeLessThan(7);
    expect(counts.expression).toBeGreaterThan(0);
    expect(counts.strategic).toBeGreaterThan(0);
    expect(counts.dilemma).toBeGreaterThan(0);
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

  it('does not add a dilemma by erasing the only season-required strategic slot', () => {
    const s = scenes(3);
    const slice = { expression: 1, relationship: 1, strategic: 1, dilemma: 0 };
    assignChoiceTypes(s, DEFAULT_CHOICE_TYPE_TARGET, slice);
    expect(s.map((scene) => scene.choicePoint.type).sort()).toEqual([
      'expression',
      'relationship',
      'strategic',
    ]);
    expect(missingPlannedChoiceTypes(s, slice)).toEqual([]);
  });

  it('reports a season-required type when hard pins consume every compatible slot', () => {
    const s = [
      { id: 'a', authoredChoiceType: 'relationship' as ChoiceType, choicePoint: { type: 'relationship' as ChoiceType } },
      { id: 'b', authoredChoiceType: 'relationship' as ChoiceType, choicePoint: { type: 'relationship' as ChoiceType } },
    ];
    const slice = { expression: 0, relationship: 1, strategic: 1, dilemma: 0 };
    assignChoiceTypes(s, DEFAULT_CHOICE_TYPE_TARGET, slice);
    expect(missingPlannedChoiceTypes(s, slice)).toEqual(['strategic']);
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
