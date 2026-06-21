import { describe, expect, it } from 'vitest';
import { SkillCoverageValidator, type SkillCoverageInput } from './SkillCoverageValidator';

describe('SkillCoverageValidator', () => {
  it('accepts a season that spreads stat checks across skills, attributes, and episodes', () => {
    const validator = new SkillCoverageValidator();
    const input: SkillCoverageInput = {
      choices: [
        // Episode 1: three distinct focus skills
        { id: 'e1-c1', text: 'Talk them down', episodeNumber: 1,
          statCheck: { skillWeights: { persuasion: 1.0 }, difficulty: 40 } },
        { id: 'e1-c2', text: 'Climb the wall', episodeNumber: 1,
          statCheck: { skillWeights: { athletics: 1.0 }, difficulty: 40 } },
        { id: 'e1-c3', text: 'Slip past the guard', episodeNumber: 1,
          statCheck: { skillWeights: { stealth: 1.0 }, difficulty: 40 } },
        // Episode 2: three more distinct focus skills
        { id: 'e2-c1', text: 'Search the records', episodeNumber: 2,
          statCheck: { skillWeights: { investigation: 1.0 }, difficulty: 40 } },
        { id: 'e2-c2', text: 'Loom over the witness', episodeNumber: 2,
          statCheck: { skillWeights: { intimidation: 1.0 }, difficulty: 40 } },
        { id: 'e2-c3', text: 'Forage for supplies', episodeNumber: 2,
          statCheck: { skillWeights: { survival: 1.0 }, difficulty: 40 } },
      ],
    };

    const result = validator.validate(input);

    expect(result.valid).toBe(true);
    expect(result.metrics.checkedStatChecks).toBe(6);
    expect(result.metrics.coveredSkills).toBe(6);
    expect(result.metrics.coveredAttributes).toBe(6);
    expect(result.metrics.dominantSkillShare).toBeLessThanOrEqual(0.3);
    // A balanced season should produce no warning-severity issues and a perfect score.
    expect(result.issues.filter((issue) => issue.severity === 'warning')).toHaveLength(0);
    expect(result.score).toBe(100);
  });

  it('warns when one skill dominates and attribute coverage is too narrow', () => {
    const validator = new SkillCoverageValidator();
    const input: SkillCoverageInput = {
      choices: [
        { id: 'c1', text: 'Sweet-talk the broker',
          statCheck: { skillWeights: { persuasion: 1.0 }, difficulty: 40 } },
        { id: 'c2', text: 'Charm the gatekeeper',
          statCheck: { skillWeights: { persuasion: 1.0 }, difficulty: 45 } },
        { id: 'c3', text: 'Win over the crowd',
          statCheck: { skillWeights: { persuasion: 1.0 }, difficulty: 50 } },
      ],
    };

    const result = validator.validate(input);

    expect(result.metrics.checkedStatChecks).toBe(3);
    expect(result.metrics.coveredSkills).toBe(1);
    expect(result.metrics.dominantSkill).toBe('persuasion');
    expect(result.metrics.dominantSkillShare).toBeCloseTo(1.0);

    const messages = result.issues.map((issue) => issue.message).join('\n');
    // Narrow attribute geometry (persuasion only touches charm/empathy/wit).
    expect(result.metrics.coveredAttributes).toBeLessThan(5);
    expect(messages).toContain('attributes receive meaningful exercise');
    // One skill carrying all of the stat-check weight should be flagged.
    expect(messages).toContain('100% of stat-check weight');

    const warnings = result.issues.filter((issue) => issue.severity === 'warning');
    expect(warnings.length).toBeGreaterThanOrEqual(2);
    // Two warnings -> score capped below 100.
    expect(result.score).toBe(100 - warnings.length * 7);
  });

  it('includes encounter primarySkill slots in season skill dominance diagnostics', () => {
    const validator = new SkillCoverageValidator();
    const input: SkillCoverageInput = {
      choices: [
        { id: 'c1', text: 'Talk them down', statCheck: { skillWeights: { persuasion: 1 }, difficulty: 40 } },
        { id: 'c2', text: 'Search the records', statCheck: { skillWeights: { investigation: 1 }, difficulty: 40 } },
      ],
      encounters: [{
        phases: [{
          beats: Array.from({ length: 6 }, (_, index) => ({
            id: `enc-${index}`,
            choices: [{ id: `enc-choice-${index}`, primarySkill: 'perception' }],
          })),
        }],
      }],
    };

    const result = validator.validate(input);

    expect(result.metrics.checkedStatChecks).toBe(8);
    expect(result.metrics.dominantSkill).toBe('perception');
    expect(result.metrics.dominantSkillShare).toBeCloseTo(6 / 8);
    expect(result.issues.map((issue) => issue.message).join('\n')).toContain('perception');
  });

  it('suppresses skill-focus warnings when genre-narrow focus is allowed', () => {
    const validator = new SkillCoverageValidator();
    const input: SkillCoverageInput = {
      choices: [
        { id: 'c1', text: 'Sweet-talk the broker',
          statCheck: { skillWeights: { persuasion: 1.0 }, difficulty: 40 } },
        { id: 'c2', text: 'Charm the gatekeeper',
          statCheck: { skillWeights: { persuasion: 1.0 }, difficulty: 45 } },
      ],
      allowGenreNarrowSkillFocus: true,
    };

    const result = validator.validate(input);

    const messages = result.issues.map((issue) => issue.message).join('\n');
    // The dominant-skill warning is suppressed under genre-narrow focus.
    expect(messages).not.toContain('stat-check weight');
  });
});
