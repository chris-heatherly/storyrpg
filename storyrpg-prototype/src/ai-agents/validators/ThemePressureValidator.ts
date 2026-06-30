import type { EpisodeBlueprint, SceneBlueprint } from '../agents/StoryArchitect';
import { BaseValidator, ValidationIssue, ValidationResult } from './BaseValidator';

export interface ThemePressureMetrics {
  majorSceneCount: number;
  majorScenesWithThemePressure: number;
  majorChoiceCount: number;
  majorChoicesWithThemeAnswer: number;
}

export interface ThemePressureValidationResult extends ValidationResult {
  metrics: ThemePressureMetrics;
}

const EMPTY_PLACEHOLDER = /\b(tbd|none|n\/a|unknown|placeholder|not specified)\b/i;
const QUESTION_START = /^(what|why|when|how|who|which|can|will|would|should|must|do|does|did|is|are)\b/i;
const EXTERNAL_RESOLUTION = /\b(coincidence|coincidentally|prophecy|prophec|destiny|fate|deus ex|rescued by|saves them without|villain decides|antagonist decides|external rescue|outside force|randomly|by chance)\b/i;
const PLAYER_ACTION = /\b(player|protagonist|choice|chooses|choose|decision|decides|act|acts|action|refusal|refuses|sacrifice|risks|commit|commits|reveals|hides|protects|betrays|trusts|confronts|accepts|rejects|identity|cost)\b/i;
const THEME_PRESSURE = /\b(choice|cost|identity|relationship|trust|betray|loyal|truth|power|freedom|family|belonging|grief|love|duty|selfhood|sacrifice|promise|vow|guilt|forgive|mercy|justice|home|reputation|future|change|refuse|protect|reveal|hide|answer|question|pressure|complicate|payoff|setup)\b/i;

function hasText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && !EMPTY_PLACEHOLDER.test(value);
}

function arrayOrEmpty<T>(value: T[] | undefined): T[] {
  return Array.isArray(value) ? value : [];
}

function normalize(value: unknown): string {
  return hasText(value) ? value.trim() : '';
}

function sceneLabel(scene: SceneBlueprint): string {
  return `${scene.id || '(missing-id)'}${scene.name ? ` (${scene.name})` : ''}`;
}

function getThemeQuestion(blueprint: EpisodeBlueprint): string {
  const auditQuestion = normalize(blueprint.dramaticAudit?.themeQuestion);
  if (auditQuestion) return auditQuestion;
  return arrayOrEmpty(blueprint.themes).find((theme) => isThemeQuestion(theme)) || '';
}

function isThemeQuestion(value: unknown): value is string {
  if (!hasText(value)) return false;
  const text = value.trim();
  const words = text.split(/\s+/).filter(Boolean);
  return text.includes('?') && words.length >= 5 && QUESTION_START.test(text);
}

function sceneHaystack(scene: SceneBlueprint): string {
  return [
    scene.description,
    scene.narrativeFunction,
    scene.dramaticQuestion,
    scene.wantVsNeed,
    scene.conflictEngine,
    scene.personalStake,
    scene.themePressure,
    scene.encounterBuildup,
    scene.encounterDescription,
    scene.encounterStakes,
    ...(scene.keyBeats || []),
    scene.dramaticStructure?.question,
    scene.dramaticStructure?.turn,
    scene.dramaticStructure?.pressurePeak,
    scene.dramaticStructure?.changedState,
    ...(scene.residue || []).map((residue) => residue.description),
  ].filter(Boolean).join(' ');
}

function isMajorScene(scene: SceneBlueprint, isFinalScene: boolean): boolean {
  return Boolean(
    scene.isEncounter ||
    scene.choicePoint?.branches ||
    scene.choicePoint?.type === 'dilemma' ||
    isFinalScene ||
    /climax|confront|reveal|betray|choice|decision|crisis|turn|peak|payoff/i.test(sceneHaystack(scene)),
  );
}

function directThemeStatement(themeQuestion: string, text: string): boolean {
  if (!themeQuestion || !text) return false;
  const normalizedQuestion = themeQuestion.toLowerCase().replace(/\s+/g, ' ').trim();
  const normalizedText = text.toLowerCase().replace(/\s+/g, ' ').trim();
  return normalizedText.includes(normalizedQuestion);
}

export class ThemePressureValidator extends BaseValidator {
  constructor() {
    super('ThemePressureValidator');
  }

  validate(blueprint: EpisodeBlueprint): ThemePressureValidationResult {
    const issues: ValidationIssue[] = [];
    const scenes = arrayOrEmpty(blueprint.scenes);
    const themeQuestion = getThemeQuestion(blueprint);

    const metrics: ThemePressureMetrics = {
      majorSceneCount: 0,
      majorScenesWithThemePressure: 0,
      majorChoiceCount: 0,
      majorChoicesWithThemeAnswer: 0,
    };

    if (!themeQuestion) {
      issues.push(this.error(
        'Theme must be stated as a playable question, not a noun.',
        blueprint.episodeId,
        'Add dramaticAudit.themeQuestion, for example: "What do you owe family when loyalty costs your selfhood?"',
      ));
    } else if (!isThemeQuestion(themeQuestion)) {
      issues.push(this.error(
        `Theme question is not a usable question: "${themeQuestion}".`,
        blueprint.episodeId,
        'Use a specific question with dramatic pressure, not a noun or label.',
      ));
    }

    const audit = blueprint.dramaticAudit;
    if (!hasText(audit?.themeAngle)) {
      issues.push(this.error(
        'dramaticAudit.themeAngle is missing.',
        blueprint.episodeId,
        'Name the specific angle this episode takes on the theme question.',
      ));
    }

    if (!hasText(audit?.themeChoicePressure)) {
      issues.push(this.error(
        'dramaticAudit.themeChoicePressure is missing.',
        blueprint.episodeId,
        'State how protagonist/player choices can answer, complicate, refuse, or distort the theme question.',
      ));
    } else if (!PLAYER_ACTION.test(audit.themeChoicePressure)) {
      issues.push(this.error(
        'dramaticAudit.themeChoicePressure does not make the theme answerable by protagonist/player action.',
        blueprint.episodeId,
        'Tie the theme pressure to player choice, protagonist action, refusal, sacrifice, commitment, or identity.',
      ));
    }

    if (audit?.themePressure && EXTERNAL_RESOLUTION.test(audit.themePressure)) {
      issues.push(this.error(
        'dramaticAudit.themePressure appears to resolve theme through external events.',
        blueprint.episodeId,
        'Theme pressure should be answered by protagonist/player choices, not coincidence, prophecy, outside rescue, or villain-only action.',
      ));
    }

    for (const scene of scenes) {
      const isFinalScene = (scene.leadsTo || []).length === 0 || scene === scenes[scenes.length - 1];
      const major = isMajorScene(scene, isFinalScene);
      if (major) {
        metrics.majorSceneCount += 1;
        if (hasText(scene.themePressure)) {
          metrics.majorScenesWithThemePressure += 1;
        } else {
          issues.push(this.error(
            `Major scene ${sceneLabel(scene)} is missing themePressure.`,
            scene.id,
            'State how this scene presses, complicates, sets up, or pays off the theme question.',
          ));
        }
      }

      if (scene.themePressure && !THEME_PRESSURE.test(scene.themePressure)) {
        issues.push(this.warning(
          `Scene ${sceneLabel(scene)} has vague themePressure.`,
          scene.id,
          'Ground theme pressure in choice, cost, identity, relationship, information, or consequence.',
        ));
      }

      if (themeQuestion && directThemeStatement(themeQuestion, sceneHaystack(scene))) {
        issues.push(this.error(
          `Scene ${sceneLabel(scene)} states the theme question directly.`,
          scene.id,
          'Keep theme in subtext: let characters argue values and make choices without announcing the theme question.',
        ));
      }

      const choice = scene.choicePoint;
      if (choice && (choice.branches || choice.type === 'dilemma')) {
        metrics.majorChoiceCount += 1;
        if (hasText(choice.themeAnswer)) {
          metrics.majorChoicesWithThemeAnswer += 1;
        } else {
          issues.push(this.error(
            `Major choice in scene ${sceneLabel(scene)} is missing themeAnswer.`,
            scene.id,
            'State how the choice answers, complicates, refuses, or distorts the theme question.',
          ));
        }

        const choiceText = [
          choice.themeAnswer,
          choice.description,
          choice.stakes?.want,
          choice.stakes?.cost,
          choice.stakes?.identity,
        ].filter(Boolean).join(' ');
        if (choiceText && EXTERNAL_RESOLUTION.test(choiceText)) {
          issues.push(this.error(
            `Major choice in scene ${sceneLabel(scene)} leans on external theme resolution.`,
            scene.id,
            'Make the theme answer come from protagonist/player action, cost, refusal, sacrifice, or identity.',
          ));
        }
      }
    }

    const errors = issues.filter((issue) => issue.severity === 'error').length;
    const warnings = issues.filter((issue) => issue.severity === 'warning').length;
    const score = Math.max(0, 100 - errors * 15 - warnings * 5);

    return {
      valid: errors === 0,
      score,
      issues,
      suggestions: issues.map((issue) => issue.suggestion).filter((suggestion): suggestion is string => Boolean(suggestion)),
      metrics,
    };
  }
}
