/**
 * Callback Opportunities Validator
 *
 * Checks that prior player choices are acknowledged/echoed in later content.
 * This ensures choices feel meaningful - the story should reference and
 * respond to decisions the player has made.
 *
 * Checks for:
 * - Flag references in text variants
 * - Conditional content based on prior choices
 * - NPC dialogue that acknowledges relationships
 * - Consequences that reference prior actions
 */

import {
  ValidationIssue,
  ValidationConfig,
} from '../../types/validation';
import { Consequence, ReminderPlan } from '../../types';

export interface CallbackInput {
  // Scenes with their beats
  scenes: Array<{
    id: string;
    beats: Array<{
      id: string;
      text: string;
      textVariants?: Array<{
        condition: unknown;
        text: string;
      }>;
      speaker?: string;
    }>;
  }>;

  // Choices that have been made (with their consequences)
  choices: Array<{
    id: string;
    sceneId: string;
    text: string;
    consequences?: Consequence[];
    reminderPlan?: ReminderPlan;
  }>;

  // Known flags that could be referenced
  knownFlags?: string[];

  // Known scores that could be referenced
  knownScores?: string[];
}

export interface CallbackValidationResult {
  passed: boolean;
  callbackScore: number; // 0-100
  issues: ValidationIssue[];
  metrics: {
    totalChoices: number;
    choicesWithCallbacks: number;
    flagsSet: number;
    flagsReferenced: number;
    textVariantsCount: number;
    conditionalContentCount: number;
    choicesWithReminderPlans: number;
  };
}

export class CallbackOpportunitiesValidator {
  private config: { enabled: boolean; level: 'error' | 'warning' | 'suggestion' };

  constructor(config?: Partial<{ enabled: boolean; level: 'error' | 'warning' | 'suggestion' }>) {
    this.config = {
      enabled: true,
      level: 'suggestion',
      ...config,
    };
  }

  /**
   * Validate callback opportunities in the content
   */
  async validate(input: CallbackInput): Promise<CallbackValidationResult> {
    const issues: ValidationIssue[] = [];

    // Extract all flags set by choices
    const flagsSet = new Set<string>();
    const scoresSet = new Set<string>();
    const tagsSet = new Set<string>();
    const relationshipsChanged = new Set<string>();

    for (const choice of input.choices) {
      if (choice.consequences) {
        for (const consequence of choice.consequences) {
          if (consequence.type === 'setFlag') {
            flagsSet.add(consequence.flag);
          }
          if (consequence.type === 'changeScore') {
            scoresSet.add(consequence.score);
          }
          if (consequence.type === 'setScore') {
            scoresSet.add(consequence.score);
          }
          if (consequence.type === 'addTag') {
            tagsSet.add(consequence.tag);
          }
          if (consequence.type === 'relationship') {
            relationshipsChanged.add(consequence.npcId);
          }
        }
      }
    }

    // Add known flags/scores
    if (input.knownFlags) {
      input.knownFlags.forEach(f => flagsSet.add(f));
    }
    if (input.knownScores) {
      input.knownScores.forEach(s => scoresSet.add(s));
    }

    // Count text variants and conditional content
    let textVariantsCount = 0;
    let conditionalContentCount = 0;
    const flagsReferenced = new Set<string>();

    for (const scene of input.scenes) {
      for (const beat of scene.beats) {
        // Check for text variants
        if (beat.textVariants && beat.textVariants.length > 0) {
          textVariantsCount += beat.textVariants.length;
          conditionalContentCount++;

          // Try to extract flag references from conditions
          for (const variant of beat.textVariants) {
            const conditionStr = JSON.stringify(variant.condition);
            for (const flag of flagsSet) {
              if (conditionStr.includes(flag)) {
                flagsReferenced.add(flag);
              }
            }
          }
        }
      }
    }

    // Calculate how many choices have any form of callback
    let choicesWithCallbacks = 0;
    let choicesWithReminderPlans = 0;
    for (const choice of input.choices) {
      if (choice.reminderPlan?.immediate || choice.reminderPlan?.shortTerm) {
        choicesWithReminderPlans++;
      }
      if (choice.consequences) {
        const hasFlag = choice.consequences.some(c => c.type === 'setFlag');
        const hasScore = choice.consequences.some(c => c.type === 'changeScore' || c.type === 'setScore');
        const hasTag = choice.consequences.some(c => c.type === 'addTag');
        const hasRelationship = choice.consequences.some(c => c.type === 'relationship');

        if (hasFlag || hasScore || hasTag || hasRelationship) {
          choicesWithCallbacks++;
        }
      }
    }

    // Generate issues based on findings
    const totalChoices = input.choices.length;

    // Issue: No text variants at all
    if (textVariantsCount === 0 && totalChoices > 0) {
      issues.push({
        category: 'callback_opportunities',
        level: this.config.level,
        message: 'No text variants found - consider adding conditional text that acknowledges player choices',
        location: {},
        suggestion: 'Add textVariants to beats that can reference flags set by earlier choices',
      });
    }

    // Issue: Flags set but never referenced
    const unreferencedFlags = Array.from(flagsSet).filter(f => !flagsReferenced.has(f));
    if (unreferencedFlags.length > 0 && flagsSet.size > 0) {
      issues.push({
        category: 'callback_opportunities',
        level: this.config.level,
        message: `${unreferencedFlags.length} flags set but never referenced in text variants: ${unreferencedFlags.slice(0, 3).join(', ')}${unreferencedFlags.length > 3 ? '...' : ''}`,
        location: {},
        suggestion: 'Add text variants that check these flags to acknowledge player choices',
      });
    }

    // Issue: Many choices but few have consequences
    if (totalChoices > 2 && choicesWithCallbacks < totalChoices * 0.5) {
      issues.push({
        category: 'callback_opportunities',
        level: this.config.level,
        message: `Only ${choicesWithCallbacks}/${totalChoices} choices set flags or modify state - choices may feel inconsequential`,
        location: {},
        suggestion: 'Ensure most choices have consequences that can be referenced later',
      });
    }

    if (totalChoices > 0 && choicesWithReminderPlans < Math.ceil(totalChoices * 0.5)) {
      issues.push({
        category: 'callback_opportunities',
        level: this.config.level,
        message: `Only ${choicesWithReminderPlans}/${totalChoices} choices include reminder plans - choices may not stay legible after the moment passes`,
        location: {},
        suggestion: 'Add reminderPlan metadata so the story can echo major choices immediately and within the next scene or two',
      });
    }

    // Calculate callback score
    let score = 50; // Base score

    // Bonus for text variants
    if (textVariantsCount > 0) {
      score += Math.min(20, textVariantsCount * 5);
    }

    // Bonus for flag usage
    if (flagsSet.size > 0) {
      const referenceRate = flagsReferenced.size / flagsSet.size;
      score += Math.round(referenceRate * 20);
    }

    // Bonus for choices with consequences
    if (totalChoices > 0) {
      const consequenceRate = choicesWithCallbacks / totalChoices;
      score += Math.round(consequenceRate * 10);
      const reminderRate = choicesWithReminderPlans / totalChoices;
      score += Math.round(reminderRate * 10);
    }

    score = Math.max(0, Math.min(100, score));

    const passed = issues.filter(i => i.level === 'error').length === 0;

    return {
      passed,
      callbackScore: score,
      issues,
      metrics: {
        totalChoices,
        choicesWithCallbacks,
        flagsSet: flagsSet.size,
        flagsReferenced: flagsReferenced.size,
        textVariantsCount,
        conditionalContentCount,
        choicesWithReminderPlans,
      },
    };
  }
}
