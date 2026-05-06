import type { StructuralRole } from '../../types/sourceAnalysis';
import { isActionHeavyGenre } from '../prompts/storytellingPrinciples';
import type { SceneContent } from '../agents/SceneWriter';
import { BaseValidator, ValidationIssue } from './BaseValidator';

export interface SceneCraftOptions {
  genre?: string;
  dialogueHeavy?: boolean;
  isFinalScene?: boolean;
  isFinale?: boolean;
  episodeStructuralRole?: StructuralRole[];
}

export interface SceneCraftResult {
  passed: boolean;
  issues: ValidationIssue[];
}

const ACTION_OR_CONSEQUENCE_TERMS = /\b(grab\w*|pull\w*|push\w*|run\w*|race\w*|step\w*|turn\w*|reach\w*|strike\w*|block\w*|hid\w*|hide\w*|open\w*|clos\w*|lift\w*|drop\w*|break\w*|save\w*|reveal\w*|learn\w*|discover\w*|accus\w*|refus\w*|choos\w*|chose\w*|decid\w*|promis\w*|betray\w*|escap\w*|los\w*|lost|cost\w*|risk\w*|threat\w*|danger\w*|pressure|evidence|secret\w*|trust|leverage|wound\w*|blood|fall\w*|fell|burn\w*|crack\w*|shatter\w*)\b/i;
const PHYSICAL_DANGER_TERMS = /\b(fight\w*|attack\w*|strike\w*|weapon\w*|blade\w*|gun\w*|fire|explosion\w*|wound\w*|blood|chas\w*|fall\w*|fell|trap\w*|collapse\w*|danger\w*|surviv\w*|escap\w*|pursu\w*|ambush\w*|impact\w*|bruis\w*|shov\w*|punch\w*|kick\w*|slash\w*|stab\w*)\b/i;
const PHYSICAL_BUSINESS_TERMS = /\b(walk\w*|pac\w*|pack\w*|cook\w*|train\w*|repair\w*|writ\w*|sort\w*|clean\w*|climb\w*|search\w*|carr\w*|draw\w*|paint\w*|sharpen\w*|stitch\w*|prepar\w*|driv\w*|row\w*|dig\w*|unlock\w*|hid\w*|hide\w*|run\w*|reach\w*|lift\w*|set|fold\w*|pour\w*|open\w*|clos\w*)\b/i;
const DIALOGUE_MARKERS = /["“”']|^\s*[A-Z][^.!?]{1,40}:/m;
const FORWARD_PRESSURE_TERMS = /\b(question|choice|decide|must|before|until|but|however|reveals?|arrives?|vanishes|missing|returns?|promise|threat|danger|betray|secret|cost|next|legacy|future|changed|saved|redeemed|improved)\b|[?]/i;
const LEGACY_TERMS = /\b(saved|redeemed|restored|healed|changed|improved|future|legacy|tomorrow|afterward|cost|identity|remember|new life|new world)\b/i;

export class SceneCraftValidator extends BaseValidator {
  constructor() {
    super('SceneCraftValidator');
  }

  validateScene(scene: SceneContent, options: SceneCraftOptions = {}): SceneCraftResult {
    const issues: ValidationIssue[] = [];
    const beats = scene.beats || [];

    if (!scene.sceneTakeaways || scene.sceneTakeaways.length === 0) {
      issues.push(this.warning(
        'Scene is missing sceneTakeaways',
        scene.sceneId,
        'Add 1-4 takeaways naming what the player learns, feels, or understands.'
      ));
    }

    if (!scene.keyMoments || scene.keyMoments.length === 0) {
      issues.push(this.warning(
        'Scene is missing keyMoments',
        scene.sceneId,
        'Name the emotional or narrative payoff the beat sequence builds toward.'
      ));
    }

    const nonRestBeats = beats.filter((beat) => beat.intensityTier !== 'rest');
    const hasConcreteAction = nonRestBeats.some((beat) => {
      const text = [
        beat.text,
        beat.primaryAction,
        beat.visualMoment,
        beat.mustShowDetail,
        beat.relationshipDynamic,
      ].filter(Boolean).join(' ');
      return ACTION_OR_CONSEQUENCE_TERMS.test(text);
    });

    if (nonRestBeats.length > 0 && !hasConcreteAction) {
      issues.push(this.warning(
        'Non-rest scene lacks concrete action, complication, conflict, or visible consequence',
        scene.sceneId,
        'Give at least one supporting/dominant beat a specific action, reveal, cost, threat, or leverage shift.'
      ));
    }

    const sceneText = beats.map((beat) => beat.text || '').join('\n');
    if ((options.dialogueHeavy || DIALOGUE_MARKERS.test(sceneText)) && !PHYSICAL_BUSINESS_TERMS.test(sceneText)) {
      issues.push(this.warning(
        'Dialogue-heavy scene reads like a static meeting',
        scene.sceneId,
        'Give the conversation fitting physical business or situational pressure.'
      ));
    }

    if (options.isFinalScene && beats.length > 0) {
      const finalBeat = beats[beats.length - 1];
      const finalText = finalBeat.text || '';
      const isResolution = options.isFinale || options.episodeStructuralRole?.includes('resolution');
      const hasForwardPressure = FORWARD_PRESSURE_TERMS.test(finalText);
      const hasLegacy = LEGACY_TERMS.test(finalText);

      if (isResolution && !hasLegacy) {
        issues.push(this.warning(
          'Finale/resolution ending lacks aftermath or legacy',
          finalBeat.id,
          'After the climax, show what was saved, redeemed, or improved, then the protagonist future, cost, identity change, or legacy.'
        ));
      } else if (!isResolution && !hasForwardPressure) {
        issues.push(this.warning(
          'Final scene beat lacks forward pressure',
          finalBeat.id,
          'Acknowledge the immediate consequence, then open a specific next pressure, reveal, choice, or question.'
        ));
      }
    }

    return { passed: issues.length === 0, issues };
  }

  validateEpisodeScenes(
    scenes: SceneContent[],
    options: { genre?: string; betweenIncitingAndClimax?: boolean } = {}
  ): SceneCraftResult {
    const issues: ValidationIssue[] = [];
    if (!isActionHeavyGenre(options.genre) || !options.betweenIncitingAndClimax) {
      return { passed: true, issues };
    }

    const text = scenes
      .flatMap((scene) => scene.beats || [])
      .map((beat) => [
        beat.text,
        beat.primaryAction,
        beat.visualMoment,
        beat.mustShowDetail,
      ].filter(Boolean).join(' '))
      .join('\n');

    if (!PHYSICAL_DANGER_TERMS.test(text)) {
      issues.push(this.warning(
        'Action-heavy episode lacks serious physical danger or direct conflict',
        undefined,
        'Between the inciting incident and climax, include a genre-appropriate action sequence or direct physical threat without adding graphic detail.'
      ));
    }

    return { passed: issues.length === 0, issues };
  }
}
