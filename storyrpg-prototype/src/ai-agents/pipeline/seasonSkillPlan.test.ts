import { describe, it, expect } from 'vitest';
import { buildSeasonSkillPlan, skillsForEpisode, CANON_SKILLS, validateSeasonSkillPlan } from './seasonSkillPlan';

describe('seasonSkillPlan', () => {
  it('exposes all eight canonical skills', () => {
    expect(CANON_SKILLS).toHaveLength(8);
    expect(CANON_SKILLS).toContain('perception');
    expect(CANON_SKILLS).toContain('survival');
  });

  it('gives each episode a full, rotated priority list whose union covers all skills', () => {
    const plan = buildSeasonSkillPlan([1, 2, 3]);
    for (const ep of [1, 2, 3]) {
      const skills = skillsForEpisode(plan, ep);
      expect(skills).toHaveLength(CANON_SKILLS.length);
      expect(new Set(skills).size).toBe(CANON_SKILLS.length);
    }
    // Consecutive episodes lead with different skills.
    expect(skillsForEpisode(plan, 1)[0]).not.toBe(skillsForEpisode(plan, 2)[0]);
    const union = new Set([1, 2, 3].flatMap((ep) => skillsForEpisode(plan, ep).slice(0, 3)));
    expect(union.size).toBeGreaterThanOrEqual(6);
  });

  it('is deterministic and returns [] for unplanned episodes', () => {
    expect(buildSeasonSkillPlan([1, 2])).toEqual(buildSeasonSkillPlan([1, 2]));
    expect(skillsForEpisode(buildSeasonSkillPlan([1]), 9)).toEqual([]);
    expect(skillsForEpisode(undefined, 1)).toEqual([]);
  });

  describe('validateSeasonSkillPlan (L1 season coverage guard)', () => {
    it('passes the rotation built by buildSeasonSkillPlan across season lengths', () => {
      for (const len of [3, 6, 8, 10]) {
        const eps = Array.from({ length: len }, (_, i) => i + 1);
        const check = validateSeasonSkillPlan(buildSeasonSkillPlan(eps));
        expect(check.valid).toBe(true);
        expect(check.issues).toEqual([]);
      }
    });

    it('covers all 8 lead skills for a full 8-episode season and rotates leads', () => {
      const check = validateSeasonSkillPlan(buildSeasonSkillPlan([1, 2, 3, 4, 5, 6, 7, 8]));
      expect(check.coveredSkills).toBe(8);
    });

    it('flags a hand-built plan that repeats a consecutive lead skill', () => {
      const check = validateSeasonSkillPlan({
        episodeSkills: { 1: ['perception', 'wit'], 2: ['perception', 'charm'], 3: ['survival'] },
      });
      expect(check.valid).toBe(false);
      expect(check.issues.join('\n')).toMatch(/consecutive lead skill/i);
    });
  });
});
