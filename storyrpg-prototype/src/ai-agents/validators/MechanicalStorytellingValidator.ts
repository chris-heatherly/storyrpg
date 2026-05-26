import type { Choice } from '../../types';
import { BaseValidator, type ValidationIssue, type ValidationResult } from './BaseValidator';

export interface MechanicalStorytellingInput {
  storyNpcs?: Array<{ id: string }>;
  sceneNpcIdsBySceneId?: Record<string, string[]>;
  choices: Array<Choice & { sceneId?: string; beatId?: string }>;
}

export interface MechanicalStorytellingMetrics {
  totalChoices: number;
  meaningfulChoices: number;
  choicesWithStoryVerb: number;
  choicesWithAffordanceSource: number;
  choicesWithWitnessReactions: number;
  statChecksWithPlayableFailure: number;
  invalidWitnessReferences: number;
}

export interface MechanicalStorytellingResult extends ValidationResult {
  metrics: MechanicalStorytellingMetrics;
}

const PLAYABLE_FAILURE_TERMS = [
  'debt',
  'suspicion',
  'injury',
  'injured',
  'exposed',
  'exposure',
  'leverage',
  'obligation',
  'trust',
  'alarm',
  'cost',
  'caught',
  'marked',
  'consequence',
  'complication',
  'escape',
  'slip out',
  'harder',
  'worse',
  'loses',
  'lose',
];

const PLAYABLE_FAILURE_RESIDUE_KINDS = new Set([
  'later_text_variant',
  'relationship_behavior',
  'encounter_complication',
  'recap_summary',
]);

export class MechanicalStorytellingValidator extends BaseValidator {
  constructor() {
    super('MechanicalStorytellingValidator');
  }

  validate(input: MechanicalStorytellingInput): MechanicalStorytellingResult {
    const issues: ValidationIssue[] = [];
    const storyNpcIds = new Set((input.storyNpcs || []).map((npc) => npc.id));
    let meaningfulChoices = 0;
    let choicesWithStoryVerb = 0;
    let choicesWithAffordanceSource = 0;
    let choicesWithWitnessReactions = 0;
    let statChecksWithPlayableFailure = 0;
    let invalidWitnessReferences = 0;

    for (const choice of input.choices) {
      const location = [choice.sceneId, choice.beatId, choice.id].filter(Boolean).join(':') || choice.id;
      const isFlavor = choice.choiceIntent === 'flavor' || choice.choiceType === 'expression';
      const isMeaningful = !isFlavor;

      if (choice.storyVerb?.trim()) choicesWithStoryVerb++;
      if (choice.affordanceSource) choicesWithAffordanceSource++;
      if ((choice.witnessReactions?.length ?? 0) > 0) choicesWithWitnessReactions++;

      if (isMeaningful) {
        meaningfulChoices++;

        if (!hasReactiveSurface(choice)) {
          issues.push(this.error(
            `Meaningful choice "${choice.id}" has no visible reactive surface.`,
            location,
            'Add residueHints, memorableMoment, witnessReactions, conditions, consequences, delayedConsequences, reactionText, outcomeTexts, tintFlag, or route impact.',
          ));
        }

        if (!choice.storyVerb?.trim()) {
          issues.push(this.info(
            `Meaningful choice "${choice.id}" has no storyVerb metadata.`,
            location,
            'Set storyVerb when a genre/source-specific action verb fits the choice.',
          ));
        }
      }

      if (hasGate(choice) && !choice.affordanceSource && !canInferAffordance(choice)) {
        issues.push(this.info(
          `Gated choice "${choice.id}" has no affordanceSource.`,
          location,
          'Set affordanceSource to identity, relationship, tag, item, skill, flag, or callback.',
        ));
      }

      for (const reaction of choice.witnessReactions || []) {
        const reactionLocation = reaction.npcId ? `${location}:${reaction.npcId}` : location;
        if (!reaction.npcId || (storyNpcIds.size > 0 && !storyNpcIds.has(reaction.npcId))) {
          invalidWitnessReferences++;
          issues.push(this.error(
            `Witness reaction on choice "${choice.id}" references unknown NPC "${reaction.npcId || '(missing)'}".`,
            reactionLocation,
            'Use an npcId from story.npcs or remove the witness reaction.',
          ));
          continue;
        }

        if (!reaction.reactionText?.trim()) {
          issues.push(this.warning(
            `Witness reaction on choice "${choice.id}" has empty reactionText.`,
            reactionLocation,
            'Add fiction-first prose describing how the NPC interprets the choice.',
          ));
        }

        const sceneNpcIds = choice.sceneId ? input.sceneNpcIdsBySceneId?.[choice.sceneId] : undefined;
        if (sceneNpcIds && !sceneNpcIds.includes(reaction.npcId)) {
          issues.push(this.warning(
            `Witness reaction NPC "${reaction.npcId}" is not listed in scene "${choice.sceneId}".`,
            reactionLocation,
            'Prefer witnesses who are present in the scene, or update scene charactersInvolved if they are meant to observe it.',
          ));
        }
      }

      if (choice.statCheck) {
        if (hasPlayableFailure(choice)) {
          statChecksWithPlayableFailure++;
        } else {
          issues.push(this.warning(
            `Stat-check choice "${choice.id}" has no playable failure signal.`,
            location,
            'Add failureResidue, durable/delayed consequences, route impact, a memorableMoment, or failure prose with a concrete complication.',
          ));
        }
      }
    }

    const errors = issues.filter((issue) => issue.severity === 'error').length;
    const warnings = issues.filter((issue) => issue.severity === 'warning').length;
    const score = Math.max(0, 100 - errors * 25 - warnings * 7);

    return {
      valid: errors === 0,
      score,
      issues,
      suggestions: issues.map((issue) => issue.suggestion).filter((value): value is string => Boolean(value)),
      metrics: {
        totalChoices: input.choices.length,
        meaningfulChoices,
        choicesWithStoryVerb,
        choicesWithAffordanceSource,
        choicesWithWitnessReactions,
        statChecksWithPlayableFailure,
        invalidWitnessReferences,
      },
    };
  }
}

function hasReactiveSurface(choice: Choice): boolean {
  return Boolean(
    choice.nextSceneId
      || choice.tintFlag
      || choice.reactionText
      || choice.outcomeTexts
      || choice.conditions
      || choice.affordanceSource
      || choice.memorableMoment
      || (choice.statCheck?.modifiers && choice.statCheck.modifiers.length > 0)
      || (choice.residueHints && choice.residueHints.length > 0)
      || (choice.witnessReactions && choice.witnessReactions.length > 0)
      || (choice.consequences && choice.consequences.length > 0)
      || (choice.delayedConsequences && choice.delayedConsequences.length > 0),
  );
}

function hasGate(choice: Choice): boolean {
  return Boolean(choice.conditions || choice.showWhenLocked || choice.lockedText);
}

function canInferAffordance(choice: Choice): boolean {
  if (!choice.conditions) return false;
  return Boolean(conditionAffordanceType(choice.conditions));
}

function conditionAffordanceType(condition: NonNullable<Choice['conditions']>): string | undefined {
  switch (condition.type) {
    case 'identity':
    case 'relationship':
    case 'tag':
    case 'item':
    case 'skill':
    case 'attribute':
    case 'flag':
    case 'score':
      return condition.type;
    case 'and':
    case 'or':
      return condition.conditions.map(conditionAffordanceType).find(Boolean);
    case 'not':
      return conditionAffordanceType(condition.condition);
    default:
      return undefined;
  }
}

function hasPlayableFailure(choice: Choice): boolean {
  if (choice.failureResidue?.description?.trim()) return true;
  if (choice.nextSceneId || choice.memorableMoment) return true;
  if ((choice.statCheck?.modifiers?.length ?? 0) > 0) return true;
  if ((choice.consequences?.length ?? 0) > 0 || (choice.delayedConsequences?.length ?? 0) > 0) return true;
  if ((choice.residueHints || []).some((hint) => PLAYABLE_FAILURE_RESIDUE_KINDS.has(hint.kind))) return true;

  const failureText = choice.outcomeTexts?.failure?.toLowerCase() || '';
  return PLAYABLE_FAILURE_TERMS.some((term) => failureText.includes(term));
}
