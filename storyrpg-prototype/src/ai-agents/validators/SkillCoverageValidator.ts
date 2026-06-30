import type { Choice } from '../../types';
import { SKILL_DEFINITIONS } from '../../constants/pipeline';
import { normalizeStatCheck } from '../../engine/resolutionEngine';
import { BaseValidator, type ValidationIssue, type ValidationResult } from './BaseValidator';

export interface SkillCoverageInput {
  choices: Array<Choice & { episodeNumber?: number; sceneId?: string; beatId?: string }>;
  encounters?: unknown[];
  allowGenreNarrowSkillFocus?: boolean;
}

export interface SkillCoverageResult extends ValidationResult {
  metrics: {
    checkedStatChecks: number;
    coveredSkills: number;
    coveredAttributes: number;
    dominantSkill?: string;
    dominantSkillShare: number;
  };
}

export class SkillCoverageValidator extends BaseValidator {
  constructor() {
    super('SkillCoverageValidator');
  }

  validate(input: SkillCoverageInput): SkillCoverageResult {
    const issues: ValidationIssue[] = [];
    const skillExercise: Record<string, number> = {};
    const attrExercise: Record<string, number> = {
      charm: 0,
      wit: 0,
      courage: 0,
      empathy: 0,
      resolve: 0,
      resourcefulness: 0,
    };
    const episodeSkills = new Map<number, Set<string>>();
    let checkedStatChecks = 0;
    let totalWeight = 0;

    const noteSkill = (skill: string, weight: number, episodeNumber?: number): void => {
      const normalizedSkill = skill.toLowerCase();
      skillExercise[normalizedSkill] = (skillExercise[normalizedSkill] ?? 0) + weight;
      totalWeight += weight;

      if (episodeNumber != null) {
        const set = episodeSkills.get(episodeNumber) ?? new Set<string>();
        set.add(normalizedSkill);
        episodeSkills.set(episodeNumber, set);
      }

      const def = SKILL_DEFINITIONS[normalizedSkill];
      if (!def) return;
      for (const [attr, attrWeight] of Object.entries(def.attributeWeights)) {
        attrExercise[attr] = (attrExercise[attr] ?? 0) + weight * (attrWeight ?? 0);
      }
    };

    for (const choice of input.choices) {
      if (!choice.statCheck) continue;
      checkedStatChecks++;
      const normalized = normalizeStatCheck(choice.statCheck);

      for (const [skill, weight] of Object.entries(normalized.skillWeights)) {
        noteSkill(skill, weight, choice.episodeNumber);
      }
    }

    const seen = new Set<object>();
    const walkEncounter = (node: unknown, episodeNumber?: number): void => {
      if (!node || typeof node !== 'object' || seen.has(node)) return;
      seen.add(node as object);
      if (Array.isArray(node)) {
        for (const item of node) walkEncounter(item, episodeNumber);
        return;
      }
      const obj = node as Record<string, unknown>;
      if (typeof obj.primarySkill === 'string' && obj.primarySkill.trim().length > 0) {
        checkedStatChecks++;
        noteSkill(obj.primarySkill, 1, episodeNumber);
      }
      for (const value of Object.values(obj)) if (value && typeof value === 'object') walkEncounter(value, episodeNumber);
    };
    for (const encounter of input.encounters || []) {
      const episodeNumber = (encounter as { episodeNumber?: unknown })?.episodeNumber;
      walkEncounter(encounter, typeof episodeNumber === 'number' ? episodeNumber : undefined);
    }

    const coveredSkills = Object.keys(skillExercise).filter((skill) => skillExercise[skill] > 0).length;
    const coveredAttributes = Object.values(attrExercise).filter((weight) => totalWeight > 0 && weight / totalWeight >= 0.08).length;
    const [dominantSkill, dominantWeight = 0] = Object.entries(skillExercise).sort((a, b) => b[1] - a[1])[0] ?? [];
    const dominantSkillShare = totalWeight > 0 ? dominantWeight / totalWeight : 0;

    if (checkedStatChecks > 0 && coveredAttributes < 5) {
      issues.push(this.warning(
        `Only ${coveredAttributes}/6 attributes receive meaningful exercise.`,
        undefined,
        'Vary challenge geometry so at least five core attributes matter across the season.',
      ));
    }

    if (checkedStatChecks >= 6 && coveredSkills < 6 && !input.allowGenreNarrowSkillFocus) {
      issues.push(this.warning(
        `Only ${coveredSkills}/8 canonical skills appear in stat checks.`,
        undefined,
        'Use at least six skills across a season unless the genre has a strong reason to narrow focus.',
      ));
    }

    if (dominantSkill && dominantSkillShare > 0.30 && !input.allowGenreNarrowSkillFocus) {
      issues.push(this.warning(
        `Skill "${dominantSkill}" carries ${(dominantSkillShare * 100).toFixed(0)}% of stat-check weight.`,
        undefined,
        'Avoid making one skill the obvious best path; rotate approaches and mixed skillWeights.',
      ));
    }

    for (const [episodeNumber, skills] of episodeSkills) {
      if (skills.size > 0 && (skills.size < 2 || skills.size > 4)) {
        issues.push(this.info(
          `Episode ${episodeNumber} uses ${skills.size} focus skill(s).`,
          undefined,
          'Aim for 2-4 focus skills per episode so the episode has identity without testing everything.',
        ));
      }
    }

    const warnings = issues.filter((issue) => issue.severity === 'warning').length;
    return {
      valid: true,
      score: Math.max(0, 100 - warnings * 7),
      issues,
      suggestions: issues.map((issue) => issue.suggestion).filter((value): value is string => Boolean(value)),
      metrics: {
        checkedStatChecks,
        coveredSkills,
        coveredAttributes,
        dominantSkill,
        dominantSkillShare,
      },
    };
  }
}
