import type { Beat, Choice, Scene } from '../../types';
import { BaseValidator, type ValidationIssue, type ValidationResult } from './BaseValidator';

export interface SkillSurfaceScene extends Pick<Scene, 'id' | 'name'> {
  beats: Array<Pick<Beat, 'id' | 'text' | 'skillInsights' | 'choices'>>;
  encounterDifficulty?: number;
  encounter?: unknown;
}

export interface SkillSurfaceInput {
  scenes: SkillSurfaceScene[];
  choices?: Array<Choice & { sceneId?: string; beatId?: string }>;
}

export interface SkillSurfaceResult extends ValidationResult {
  metrics: {
    scenesChecked: number;
    scenesWithSkillSurface: number;
    passiveInsights: number;
    preparedAdvantages: number;
  };
}

const MECHANICS_LEAK_RE = /\b(?:stat|skill check|DC|difficulty class|threshold|roll|modifier|bonus|success chance|failure chance|percentage|level requirement|build)\b|(?:\+|-)\s?\d+/i;
const USABLE_FICTION_RE = /\b(?:door|window|tool|clue|blood|mark|scar|voice|hand|eyes|breath|exit|weapon|lever|wire|lock|promise|lie|fear|anger|trust|debt|trail|shadow|smell|sound|pattern|gap|guard|crowd|rain|mud|glass|paper|letter|key|map|wound|cost|danger|safe|route)\b/i;

export class SkillSurfaceValidator extends BaseValidator {
  constructor() {
    super('SkillSurfaceValidator');
  }

  validate(input: SkillSurfaceInput): SkillSurfaceResult {
    const issues: ValidationIssue[] = [];
    let scenesWithSkillSurface = 0;
    let passiveInsights = 0;
    let preparedAdvantages = 0;

    const choices = input.choices ?? input.scenes.flatMap((scene) =>
      scene.beats.flatMap((beat) => (beat.choices ?? []).map((choice) => ({ ...choice, sceneId: scene.id, beatId: beat.id })))
    );
    const choicesByScene = new Map<string, Array<Choice & { sceneId?: string; beatId?: string }>>();
    for (const choice of choices) {
      if (!choice.sceneId) continue;
      choicesByScene.set(choice.sceneId, [...(choicesByScene.get(choice.sceneId) ?? []), choice]);
    }

    for (const scene of input.scenes) {
      const sceneChoices = choicesByScene.get(scene.id) ?? [];
      const sceneInsights = scene.beats.flatMap((beat) =>
        (beat.skillInsights ?? []).map((insight) => ({ insight, beatId: beat.id }))
      );
      const scenePreparedAdvantages = sceneChoices.filter((choice) => (choice.statCheck?.modifiers?.length ?? 0) > 0);
      const hardChoiceCount = sceneChoices.filter((choice) => (choice.statCheck?.difficulty ?? 0) > 60).length;
      const isImportant = Boolean(scene.encounter) || sceneChoices.some((choice) => choice.choiceType && choice.choiceType !== 'expression');
      const isHard = hardChoiceCount > 0 || (scene.encounterDifficulty ?? 0) > 60;
      const surfaces = sceneInsights.length + scenePreparedAdvantages.length + sceneChoices.filter(hasOutcomeTexture).length;

      passiveInsights += sceneInsights.length;
      preparedAdvantages += scenePreparedAdvantages.length;
      if (surfaces > 0) scenesWithSkillSurface++;

      if (isImportant && surfaces < 1) {
        issues.push(this.warning(
          `Important scene "${scene.name ?? scene.id}" has no skill surface.`,
          `scene:${scene.id}`,
          'Add a passive insight, prepared advantage, outcome texture, or branch residue.',
        ));
      }

      if (isHard && surfaces < 2) {
        issues.push(this.warning(
          `Hard scene "${scene.name ?? scene.id}" has fewer than two skill surfaces.`,
          `scene:${scene.id}`,
          'Pair hard checks with passive setup, prepared advantage, and playable outcome residue.',
        ));
      }

      for (const { insight, beatId } of sceneInsights) {
        const location = `${scene.id}:${beatId}:${insight.id}`;
        if (MECHANICS_LEAK_RE.test(insight.text)) {
          issues.push(this.error(
            `Passive insight "${insight.id}" leaks mechanics.`,
            location,
            'Rewrite the insight as plain prose with no stats, thresholds, bonuses, rolls, or percentages.',
          ));
        }
        if (!USABLE_FICTION_RE.test(insight.text)) {
          issues.push(this.warning(
            `Passive insight "${insight.id}" may not reveal usable fiction.`,
            location,
            'Tie insight text to danger, opportunity, emotional subtext, contradiction, environment, social leverage, or hidden cost.',
          ));
        }
      }

      for (const choice of scenePreparedAdvantages) {
        for (const modifier of choice.statCheck?.modifiers ?? []) {
          if (modifier.hint && MECHANICS_LEAK_RE.test(modifier.hint)) {
            issues.push(this.error(
              `Prepared advantage "${modifier.id}" leaks mechanics in hint text.`,
              [choice.sceneId, choice.beatId, choice.id].filter(Boolean).join(':'),
              'Describe the leverage fictionally, not as a bonus, modifier, threshold, or chance.',
            ));
          }
        }
      }
    }

    const errors = issues.filter((issue) => issue.severity === 'error').length;
    const warnings = issues.filter((issue) => issue.severity === 'warning').length;
    return {
      valid: errors === 0,
      score: Math.max(0, 100 - errors * 25 - warnings * 7),
      issues,
      suggestions: issues.map((issue) => issue.suggestion).filter((value): value is string => Boolean(value)),
      metrics: {
        scenesChecked: input.scenes.length,
        scenesWithSkillSurface,
        passiveInsights,
        preparedAdvantages,
      },
    };
  }
}

function hasOutcomeTexture(choice: Choice): boolean {
  return Boolean(
    choice.failureResidue?.description
      || choice.outcomeTexts
      || (choice.residueHints?.length ?? 0) > 0
      || (choice.delayedConsequences?.length ?? 0) > 0
      || choice.memorableMoment
      || choice.nextSceneId
  );
}
