import type { InformationLedgerEntry, SeasonPlan } from '../../types/seasonPlan';
import { BaseValidator, ValidationIssue, ValidationResult } from './BaseValidator';

export interface InformationLedgerOptions {
  episodeStructureMode?: 'standard' | 'sceneEpisodes';
}

export interface InformationLedgerMetrics {
  entryCount: number;
  mysteryCount: number;
  boxQuestionCount: number;
  closesCount: number;
  opensCount: number;
}

export interface InformationLedgerResult extends ValidationResult {
  metrics: InformationLedgerMetrics;
}

const EMPTY_PLACEHOLDER = /\b(tbd|none|n\/a|unknown|placeholder|not specified)\b/i;
const VALID_KNOWLEDGE_STATES = new Set(['shared', 'withheld', 'selective']);
const VALID_TENSION_MODES = new Set(['suspense', 'mystery', 'dramatic_irony', 'surprise', 'revelation', 'foreshadowing']);
const VALID_HOLDERS = new Set(['player', 'protagonist', 'ally', 'antagonist', 'world']);

function hasText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && !EMPTY_PLACEHOLDER.test(value);
}

function arrayOrEmpty<T>(value: T[] | undefined): T[] {
  return Array.isArray(value) ? value : [];
}

export class InformationLedgerValidator extends BaseValidator {
  constructor() {
    super('InformationLedgerValidator');
  }

  validate(
    plan: Pick<SeasonPlan, 'informationLedger' | 'episodes' | 'totalEpisodes'>,
    options: InformationLedgerOptions = {},
  ): InformationLedgerResult {
    const issues: ValidationIssue[] = [];
    const entries = arrayOrEmpty(plan.informationLedger);
    const metrics: InformationLedgerMetrics = {
      entryCount: entries.length,
      mysteryCount: entries.filter((entry) => entry.tensionMode === 'mystery').length,
      boxQuestionCount: entries.filter((entry) => entry.isBoxQuestion).length,
      closesCount: entries.reduce((count, entry) => count + arrayOrEmpty(entry.closesQuestionIds).length, 0),
      opensCount: entries.reduce((count, entry) => count + arrayOrEmpty(entry.opensQuestionIds).length, 0),
    };

    if (entries.length === 0) {
      issues.push(this.error(
        'Information ledger is missing.',
        'season.informationLedger',
        'Add at least one entry for central pressure, major question, threat, reveal, or payoff.',
      ));
      return this.result(issues, metrics);
    }

    if (metrics.mysteryCount > 3 || metrics.boxQuestionCount > 3) {
      issues.push(this.error(
        `Season has ${Math.max(metrics.mysteryCount, metrics.boxQuestionCount)} mystery/box-question entries; hard cap is 3.`,
        'season.informationLedger',
        'Convert excess mysteries into suspense, dramatic irony, foreshadowing, or revelation entries with clearer player knowledge.',
      ));
    }

    for (const entry of entries) {
      this.validateEntry(entry, plan.totalEpisodes, options, issues);
    }

    if (metrics.opensCount > metrics.closesCount) {
      issues.push(this.error(
        `Season information ledger opens ${metrics.opensCount} question(s) but closes only ${metrics.closesCount}.`,
        'season.informationLedger',
        'Each season must close more major questions than it opens, on net.',
      ));
    }

    return this.result(issues, metrics);
  }

  private validateEntry(
    entry: InformationLedgerEntry,
    totalEpisodes: number,
    options: InformationLedgerOptions,
    issues: ValidationIssue[],
  ): void {
    const location = `season.informationLedger.${entry.id || entry.label || 'unknown'}`;
    if (!hasText(entry.id)) issues.push(this.error('Information ledger entry is missing id.', `${location}.id`));
    if (!hasText(entry.label)) issues.push(this.error('Information ledger entry is missing label.', `${location}.label`));
    if (!hasText(entry.description)) issues.push(this.error(`Information ledger entry "${entry.id}" is missing description.`, `${location}.description`));
    if (!VALID_KNOWLEDGE_STATES.has(entry.audienceKnowledgeState)) {
      issues.push(this.error(`Information ledger entry "${entry.id}" has invalid audienceKnowledgeState.`, `${location}.audienceKnowledgeState`));
    }
    if (!VALID_TENSION_MODES.has(entry.tensionMode)) {
      issues.push(this.error(`Information ledger entry "${entry.id}" has invalid tensionMode.`, `${location}.tensionMode`));
    }
    if (!Array.isArray(entry.knownBy) || entry.knownBy.length === 0 || entry.knownBy.some((holder) => !VALID_HOLDERS.has(holder))) {
      issues.push(this.error(`Information ledger entry "${entry.id}" must declare valid knownBy holders.`, `${location}.knownBy`));
    }
    if (entry.withheldFrom?.some((holder) => !VALID_HOLDERS.has(holder))) {
      issues.push(this.error(`Information ledger entry "${entry.id}" has invalid withheldFrom holders.`, `${location}.withheldFrom`));
    }
    if (entry.audienceKnowledgeState === 'withheld' && entry.knownBy.includes('player')) {
      issues.push(this.error(
        `Information ledger entry "${entry.id}" is withheld but knownBy includes player.`,
        `${location}.knownBy`,
      ));
    }
    if ((entry.tensionMode === 'mystery' || entry.isBoxQuestion) && !entry.plannedRevealEpisode && !entry.plannedPayoffEpisode) {
      issues.push(this.error(
        `Mystery/box question "${entry.id}" needs plannedRevealEpisode or plannedPayoffEpisode before introduction.`,
        location,
      ));
    }
    if (!hasText(entry.payoffPlan)) {
      issues.push(this.error(`Information ledger entry "${entry.id}" is missing payoffPlan.`, `${location}.payoffPlan`));
    }
    this.validateAuthoredMetadata(entry, location, issues);
    this.validateEpisodeNumbers(entry, totalEpisodes, location, issues);
    this.validateRunway(entry, totalEpisodes, options, location, issues);
  }

  private validateAuthoredMetadata(
    entry: InformationLedgerEntry,
    location: string,
    issues: ValidationIssue[],
  ): void {
    const authored = Boolean(entry.sourceText || entry.authoredId || entry.factualAtoms?.length || entry.setupTouchDetails?.length);
    if (!authored) return;
    if (entry.authoredId && entry.authoredId !== entry.id) {
      issues.push(this.error(
        `Authored information ledger entry "${entry.authoredId}" was renamed to "${entry.id}".`,
        `${location}.id`,
        'Preserve authored INFO ids so setup/reveal/payoff schedules and question references stay traceable.',
      ));
    }
    if (!Array.isArray(entry.factualAtoms) || entry.factualAtoms.length === 0) {
      issues.push(this.error(
        `Authored information ledger entry "${entry.id}" has no factual atoms for reveal/payoff validation.`,
        `${location}.factualAtoms`,
        'Split the authored "what it is" and payoff plan into one or more concrete facts the writer and final validator can track.',
      ));
    }
    if (entry.plannedRevealEpisode && entry.plannedPayoffEpisode && entry.plannedPayoffEpisode < entry.plannedRevealEpisode) {
      issues.push(this.error(
        `Authored information ledger entry "${entry.id}" pays off before it reveals.`,
        `${location}.plannedPayoffEpisode`,
        'Schedule information payoffs after the reveal, or make the earlier beat an explicit setup touch instead.',
      ));
    }
    const knownNames = entry.namedKnowledge?.knownByNames ?? [];
    if (knownNames.length > 0 && (!Array.isArray(entry.knownBy) || entry.knownBy.length === 0)) {
      issues.push(this.error(
        `Authored information ledger entry "${entry.id}" has named knowers but no holder mapping.`,
        `${location}.knownBy`,
        'Map named knowers into the broad holder categories used by the generator.',
      ));
    }
  }

  private validateEpisodeNumbers(
    entry: InformationLedgerEntry,
    totalEpisodes: number,
    location: string,
    issues: ValidationIssue[],
  ): void {
    if (entry.introducedEpisode < 1 || entry.introducedEpisode > totalEpisodes) {
      issues.push(this.error(`Information ledger entry "${entry.id}" introducedEpisode is outside the season.`, `${location}.introducedEpisode`));
    }
    for (const field of ['plannedRevealEpisode', 'plannedPayoffEpisode'] as const) {
      const value = entry[field];
      if (value === undefined) continue;
      if (value < entry.introducedEpisode || value > totalEpisodes) {
        issues.push(this.error(`Information ledger entry "${entry.id}" ${field} is outside the valid range.`, `${location}.${field}`));
      }
    }
    for (const episode of entry.setupTouchEpisodes || []) {
      if (episode < entry.introducedEpisode || episode > totalEpisodes) {
        issues.push(this.error(`Information ledger entry "${entry.id}" has setupTouchEpisode outside the valid range.`, `${location}.setupTouchEpisodes`));
      }
    }
  }

  private validateRunway(
    entry: InformationLedgerEntry,
    totalEpisodes: number,
    options: InformationLedgerOptions,
    location: string,
    issues: ValidationIssue[],
  ): void {
    const payoffEpisode = entry.plannedPayoffEpisode || entry.plannedRevealEpisode;
    if (!payoffEpisode) return;
    if (!Array.isArray(entry.setupTouchEpisodes) || entry.setupTouchEpisodes.length === 0) {
      issues.push(this.error(
        `Information ledger entry "${entry.id}" needs setupTouchEpisodes before payoff.`,
        `${location}.setupTouchEpisodes`,
      ));
      return;
    }
    const earliestTouch = Math.min(...entry.setupTouchEpisodes);
    const runway = payoffEpisode - earliestTouch;
    const shortSeason = totalEpisodes < (options.episodeStructureMode === 'sceneEpisodes' ? 6 : 4);
    if (shortSeason) return;
    if (options.episodeStructureMode === 'sceneEpisodes') {
      if (runway < 5 || runway > 8) {
        issues.push(this.error(
          `Information payoff "${entry.id}" has ${runway} sceneEpisode(s) of runway; required runway is 5-8 sceneEpisodes.`,
          `${location}.setupTouchEpisodes`,
        ));
      }
    } else if (runway < 3 || runway > 4) {
      issues.push(this.error(
        `Information payoff "${entry.id}" has ${runway} episode(s) of runway; required runway is 3-4 regular episodes.`,
        `${location}.setupTouchEpisodes`,
      ));
    }
  }

  private result(
    issues: ValidationIssue[],
    metrics: InformationLedgerMetrics,
  ): InformationLedgerResult {
    const errorCount = issues.filter((issue) => issue.severity === 'error').length;
    const warningCount = issues.filter((issue) => issue.severity === 'warning').length;
    return {
      valid: errorCount === 0,
      score: Math.max(0, 100 - errorCount * 20 - warningCount * 5),
      issues,
      suggestions: [],
      metrics,
    };
  }
}
