import { describe, it, expect } from 'vitest';
import { buildGrowthTemplates, type GrowthCurveEntry } from './growthConsequenceBuilder';

function baseCurve(overrides: Partial<GrowthCurveEntry> = {}): GrowthCurveEntry {
  return {
    episodeNumber: 1,
    focusSkills: ['persuasion', 'perception'],
    developmentScene: 'training-montage',
    mentorshipOpportunity: null,
    ...overrides,
  };
}

describe('buildGrowthTemplates', () => {
  it('produces one skill option per focus skill', () => {
    const { skillOptions } = buildGrowthTemplates(baseCurve(), 1, 10);
    expect(skillOptions).toHaveLength(2);
    expect(skillOptions.map((s) => s.skill)).toEqual(['persuasion', 'perception']);
  });

  it('ramps skill growth from 5 at episode 1 toward 8 at the finale', () => {
    const first = buildGrowthTemplates(baseCurve(), 1, 10).skillOptions[0].change;
    const last = buildGrowthTemplates(baseCurve({ episodeNumber: 10 }), 10, 10).skillOptions[0].change;
    expect(first).toBe(5);
    expect(last).toBe(8);
  });

  it('clamps to episode-1 growth when there is only one episode', () => {
    const { skillOptions } = buildGrowthTemplates(baseCurve(), 1, 1);
    expect(skillOptions[0].change).toBe(5);
  });

  it('returns an empty skill option list when focusSkills is empty', () => {
    const { skillOptions } = buildGrowthTemplates(baseCurve({ focusSkills: [] }), 3, 10);
    expect(skillOptions).toEqual([]);
  });

  it('omits mentorship when no mentorship opportunity is defined', () => {
    const { mentorship } = buildGrowthTemplates(baseCurve(), 1, 10);
    expect(mentorship).toBeUndefined();
  });

  it('builds a relationship-gated mentorship template when one is provided', () => {
    const curve = baseCurve({
      mentorshipOpportunity: {
        npcId: 'mentor-1',
        npcName: 'Valyn',
        requiredRelationship: { dimension: 'trust', threshold: 40 },
        attribute: 'wit',
        narrativeHook: 'Late-night planning session',
      },
    });
    const { mentorship } = buildGrowthTemplates(curve, 5, 10);
    expect(mentorship).toBeDefined();
    expect(mentorship!.attribute).toBe('wit');
    expect(mentorship!.npcId).toBe('mentor-1');
    expect(mentorship!.change).toBe(4);
    expect(mentorship!.condition).toEqual({
      type: 'relationship',
      npcId: 'mentor-1',
      dimension: 'trust',
      operator: '>=',
      value: 40,
    });
  });

  it('ramps mentorship attribute growth from 3 at episode 1 toward 5 at the finale', () => {
    const curve = baseCurve({
      mentorshipOpportunity: {
        npcId: 'mentor-1',
        npcName: 'Valyn',
        requiredRelationship: { dimension: 'trust', threshold: 20 },
        attribute: 'courage',
        narrativeHook: 'Training',
      },
    });
    const first = buildGrowthTemplates(curve, 1, 10).mentorship!.change;
    const last = buildGrowthTemplates(curve, 10, 10).mentorship!.change;
    expect(first).toBe(3);
    expect(last).toBe(5);
  });
});
