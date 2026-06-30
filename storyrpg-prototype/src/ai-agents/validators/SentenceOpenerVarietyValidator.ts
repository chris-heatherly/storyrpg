import type { Story } from '../../types';
import { BaseValidator, type ValidationIssue, type ValidationResult } from './BaseValidator';
import {
  analyzeStory,
  MONOTONY_RUN_THRESHOLD,
  type MonotonyPassage,
} from '../utils/sentenceOpenerStats';

/**
 * Sentence-opener variety (post-G10 prose-craft gate).
 *
 * The reader plays in second person, so "You …" openers are expected. The defect
 * is MONOTONY — stacking consecutive subject-first second-person declaratives
 * ("You save the file. You don't know where. You just know …"), which flattens
 * the prose. G10 measured 39% second-person openers in Bite Me (43% in
 * post-choice `outcomeTexts`), heavily concentrated in a handful of passages.
 *
 * This validator flags any single authored passage — a beat's `text`, or one
 * success/partial/failure `outcomeTexts` tier — whose sentences include a run of
 * {@link MONOTONY_RUN_THRESHOLD}+ consecutive second-person openers. It is the
 * deterministic backstop behind the ChoiceAuthor/SceneWriter prompt guidance;
 * the prompts are the real fix, this catches the residual tail.
 *
 * Advisory by default; escalated to blocking when GATE_SENTENCE_OPENER_VARIETY
 * is on (wired in FinalStoryContractValidator, same as OutcomeTextQuality).
 */

export interface SentenceOpenerVarietyInput {
  story: Story;
}

export class SentenceOpenerVarietyValidator extends BaseValidator {
  constructor() {
    super('SentenceOpenerVarietyValidator');
  }

  validate(input: SentenceOpenerVarietyInput): ValidationResult {
    const stats = analyzeStory(input.story);
    const issues: ValidationIssue[] = stats.monotonyPassages.map((p) => this.toIssue(p));

    // All findings are warnings here; FinalStoryContract decides blocking via the gate.
    const warnings = issues.length;
    const score = Math.max(0, 100 - warnings * 4);
    return {
      valid: true,
      score,
      issues,
      suggestions: issues.map((i) => i.suggestion).filter((s): s is string => Boolean(s)),
    };
  }

  private toIssue(p: MonotonyPassage): ValidationIssue {
    const unit = p.bucket === 'beat' ? 'beat' : 'outcome tier';
    const location = p.sceneId && typeof p.episodeNumber === 'number'
      ? `sentenceOpener:ep${p.episodeNumber}:${p.sceneId}:${p.where}`
      : p.where;
    return this.warning(
      `${p.bucket === 'beat' ? 'Beat' : 'Choice'} "${p.where}" opens ${p.longestRun} consecutive sentences with "You…" — monotonous second-person cadence: "${p.excerpt}${p.excerpt.length >= 90 ? '…' : ''}".`,
      location,
      `Vary openers across this ${unit}: lead some sentences with the object, a dependent clause, a sensory beat, an NPC, or environment-as-subject. Keep second person, break the "You X. You Y." run (threshold: ${MONOTONY_RUN_THRESHOLD} in a row).`,
    );
  }
}
