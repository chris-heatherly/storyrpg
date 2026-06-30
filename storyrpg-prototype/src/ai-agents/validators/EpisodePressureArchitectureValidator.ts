import type {
  BPlotMode,
  CPlotFunction,
  CPlotTargetPayoff,
  DramaticStructureAudit,
  EpisodeBlueprint,
  EpisodeTurnType,
  SceneBlueprint,
} from '../agents/StoryArchitect';
import { BaseValidator, ValidationIssue, ValidationResult } from './BaseValidator';

export interface EpisodePressureArchitectureOptions {
  isFinale?: boolean;
  targetSceneCount?: number;
}

export interface EpisodePressureArchitectureMetrics {
  majorTurnCount: number;
  turnsWithType: number;
  turnsWithTurnOut: number;
  hasAPlot: boolean;
  hasBPlot: boolean;
  hasCPlot: boolean;
}

export interface EpisodePressureArchitectureResult extends ValidationResult {
  metrics: EpisodePressureArchitectureMetrics;
}

const EMPTY_PLACEHOLDER = /\b(tbd|none|n\/a|unknown|placeholder|not specified)\b/i;
const VALID_TURN_TYPES = new Set<EpisodeTurnType>([
  'reversal',
  'revelation',
  'escalation',
  'choice',
  'cost',
  'payoff',
]);
const VALID_B_PLOT_MODES = new Set<BPlotMode>([
  'scene',
  'underlay',
  'offscreen_pressure',
]);
const VALID_C_PLOT_FUNCTIONS = new Set<CPlotFunction>([
  'future_seed',
  'callback',
  'world_pressure',
  'tonal_counterweight',
]);
const VALID_C_PLOT_TARGETS = new Set<CPlotTargetPayoff>([
  'later_scene',
  'later_episode',
  'later_arc',
  'season',
]);

const OPENING_PRESSURE = /\b(pressure|threat|danger|risk|cost|want|need|fear|question|choice|choose|decide|reveal|secret|blood|locked|sealed|urgent|must|promise|accus\w*|betray\w*|trust|relationship|identity|help|refus\w*|confront\w*|reach\w*)\b|[?]/i;
const TURN_PRESSURE = /\b(reversal|reveal|reveals|revelation|escalat\w*|choice|chooses|cost|payoff|turn|but|therefore|because|discovers?|loses?|gains?|betray\w*|threat\w*|risk|pressure|consequence|changes?|forces?)\b/i;
const FLAT_TRANSITION = /\b(next|then|after that|later|continues|moves on|goes to|arrives at|travels to)\b/i;
const RELATIONSHIP_OR_IDENTITY = /\b(relationship|trust|affection|respect|fear|ally|friend|family|lover|mentor|rival|betray\w*|secret|loyal\w*|identity|selfhood|reputation|belonging|wound|debt|promise|vow)\b/i;

function hasText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && !EMPTY_PLACEHOLDER.test(value);
}

function arrayOrEmpty<T>(value: T[] | undefined): T[] {
  return Array.isArray(value) ? value : [];
}

function textFrom(values: unknown[]): string {
  return values
    .filter((value): value is string => hasText(value))
    .join(' ');
}

function sceneHaystack(scene: SceneBlueprint | undefined): string {
  if (!scene) return '';
  return textFrom([
    scene.name,
    scene.description,
    scene.dramaticQuestion,
    scene.wantVsNeed,
    scene.conflictEngine,
    scene.narrativeFunction,
    scene.personalStake,
    scene.themePressure,
    scene.encounterBuildup,
    scene.encounterDescription,
    scene.encounterStakes,
    scene.dramaticStructure?.question,
    scene.dramaticStructure?.turn,
    scene.dramaticStructure?.pressurePeak,
    scene.dramaticStructure?.changedState,
    scene.sequenceIntent?.objective,
    scene.sequenceIntent?.obstacle,
    scene.sequenceIntent?.turningPoint,
    scene.sequenceIntent?.endState,
    scene.choicePoint?.description,
    scene.choicePoint?.themeAnswer,
    scene.choicePoint?.stakes?.want,
    scene.choicePoint?.stakes?.cost,
    scene.choicePoint?.stakes?.identity,
    ...(scene.keyBeats || []),
  ]);
}

function firstScene(blueprint: EpisodeBlueprint): SceneBlueprint | undefined {
  return blueprint.scenes.find((scene) => scene.id === blueprint.startingSceneId) || blueprint.scenes[0];
}

function isFinale(blueprint: EpisodeBlueprint, options: EpisodePressureArchitectureOptions): boolean {
  return Boolean(
    options.isFinale ||
    blueprint.storyCircleRole?.some((role) => role.beat === 'return' || role.beat === 'change'),
  );
}

function hasTurnOut(turn: DramaticStructureAudit['majorTurns'][number]): boolean {
  return hasText(turn.closesQuestion) || hasText(turn.opensQuestion) || hasText(turn.memorableImageOrLine);
}

function turnLooksFlat(turn: DramaticStructureAudit['majorTurns'][number]): boolean {
  if (turn.turnType && VALID_TURN_TYPES.has(turn.turnType) && hasTurnOut(turn)) return false;
  const text = textFrom([
    turn.description,
    turn.closesQuestion,
    turn.opensQuestion,
    turn.memorableImageOrLine,
  ]);
  if (!hasText(text)) return true;
  return FLAT_TRANSITION.test(text) && !TURN_PRESSURE.test(text);
}

function likelyNeedsBPlot(
  blueprint: EpisodeBlueprint,
  options: EpisodePressureArchitectureOptions,
): boolean {
  if ((options.targetSceneCount || blueprint.scenes.length) < 5 && blueprint.scenes.length < 5) return false;

  const sceneText = blueprint.scenes.map(sceneHaystack).join(' ');
  const hasRelationshipChoice = blueprint.scenes.some((scene) =>
    scene.choicePoint?.type === 'relationship' ||
    scene.choicePoint?.consequenceDomain === 'relationship' ||
    hasText(scene.stakesLayers?.relational) ||
    hasText(scene.stakesLayers?.identity)
  );
  return hasRelationshipChoice || RELATIONSHIP_OR_IDENTITY.test(sceneText);
}

export class EpisodePressureArchitectureValidator extends BaseValidator {
  constructor() {
    super('EpisodePressureArchitectureValidator');
  }

  validate(
    blueprint: EpisodeBlueprint,
    options: EpisodePressureArchitectureOptions = {},
  ): EpisodePressureArchitectureResult {
    const issues: ValidationIssue[] = [];
    const audit = blueprint.dramaticAudit;
    const turns = arrayOrEmpty(audit?.majorTurns);
    const lanes = audit?.episodePressureLanes;
    const aPlot = lanes?.aPlot;
    const bPlot = lanes?.bPlot;
    const cPlot = lanes?.cPlot;
    const finale = isFinale(blueprint, options);
    const opening = audit?.openingPromise;
    const first = firstScene(blueprint);
    const firstText = sceneHaystack(first);

    const metrics: EpisodePressureArchitectureMetrics = {
      majorTurnCount: turns.length,
      turnsWithType: turns.filter((turn) => turn.turnType && VALID_TURN_TYPES.has(turn.turnType)).length,
      turnsWithTurnOut: turns.filter(hasTurnOut).length,
      hasAPlot: Boolean(aPlot),
      hasBPlot: Boolean(bPlot),
      hasCPlot: Boolean(cPlot),
    };

    if (!audit) {
      issues.push(this.error(
        'Episode is missing dramaticAudit for episode pressure architecture.',
        blueprint.episodeId,
        'Add episodeQuestion, openingPromise, episodePressureLanes, episodeEndStateDelta, majorTurns, and nextEpisodePressure.',
      ));
      return this.result(issues, metrics);
    }

    if (!hasText(audit.episodeQuestion)) {
      issues.push(this.error('dramaticAudit.episodeQuestion is missing.', blueprint.episodeId));
    }
    if (!hasText(audit.episodeQuestionSetup)) {
      issues.push(this.error(
        'dramaticAudit.episodeQuestionSetup is missing.',
        blueprint.episodeId,
        'State how the opening scene poses/promises the episode question.',
      ));
    }
    if (!hasText(audit.episodeQuestionAnswer)) {
      issues.push(this.error(
        'dramaticAudit.episodeQuestionAnswer is missing.',
        blueprint.episodeId,
        'State how the climax, encounter, major choice, or final turn answers, complicates, or reframes the episode question.',
      ));
    }

    if (!opening || !hasText(opening.hook) || !hasText(opening.episodePromise) || !hasText(opening.activePressure)) {
      issues.push(this.error(
        'dramaticAudit.openingPromise is incomplete.',
        blueprint.episodeId,
        'Add hook, episodePromise, and activePressure.',
      ));
    }

    if (opening && first && !OPENING_PRESSURE.test(firstText)) {
      issues.push(this.warning(
        'Opening scene weakly supports the openingPromise.',
        first.id,
        'The first scene should quickly establish hook, episode promise, active pressure, and optional stakes.',
      ));
    }

    if (!aPlot || !hasText(aPlot.externalPressure) || !hasText(aPlot.climaxIntersection)) {
      issues.push(this.error(
        'dramaticAudit.episodePressureLanes.aPlot is incomplete.',
        blueprint.episodeId,
        'Add externalPressure and climaxIntersection for the episode A-plot.',
      ));
    }

    if (bPlot) {
      if (!bPlot.mode || !VALID_B_PLOT_MODES.has(bPlot.mode)) {
        issues.push(this.error(
          'B-plot mode is missing or invalid.',
          blueprint.episodeId,
          'Use mode: scene, underlay, or offscreen_pressure.',
        ));
      }
      if (!hasText(bPlot.relationshipOrIdentityPressure)) {
        issues.push(this.error(
          'B-plot relationshipOrIdentityPressure is missing.',
          blueprint.episodeId,
          'State the protagonist-facing relationship or identity pressure.',
        ));
      }
      if (arrayOrEmpty(bPlot.protagonistVisibleSignals).length === 0) {
        issues.push(this.error(
          'B-plot has no protagonist-visible signals.',
          blueprint.episodeId,
          'List behavior, clues, withholding, changed trust, rumor, delayed reveal, or choice consequences the protagonist can notice.',
        ));
      }
      if (!hasText(bPlot.climaxIntersection)) {
        issues.push(this.error(
          'B-plot climaxIntersection is missing.',
          blueprint.episodeId,
          'State how the relationship/identity pressure intersects or resonates with the A-plot at the climax or major choice.',
        ));
      }
      if (bPlot.mode === 'scene' && arrayOrEmpty(bPlot.scenesOrEpisodes).length === 0) {
        issues.push(this.error(
          'B-plot scene mode needs scenesOrEpisodes.',
          blueprint.episodeId,
          'Reference the protagonist-facing scene carrying the B-plot pressure.',
        ));
      }
    } else if (likelyNeedsBPlot(blueprint, options)) {
      issues.push(this.warning(
        'Episode appears relationship/identity-heavy but has no B-plot pressure lane.',
        blueprint.episodeId,
        'Add a protagonist-facing B-plot lane when secondary character pressure should intersect the A-plot.',
      ));
    }

    if (cPlot) {
      if (!cPlot.function || !VALID_C_PLOT_FUNCTIONS.has(cPlot.function)) {
        issues.push(this.error(
          'C-plot function is missing or invalid.',
          blueprint.episodeId,
          'Use function: future_seed, callback, world_pressure, or tonal_counterweight.',
        ));
      }
      if (!hasText(cPlot.seed) || !hasText(cPlot.visiblePlant) || !hasText(cPlot.payoffPlan)) {
        issues.push(this.error(
          'C-plot seed is incomplete.',
          blueprint.episodeId,
          'C-plots are future-pressure seeds and need seed, visiblePlant, and payoffPlan.',
        ));
      }
      if (cPlot.targetPayoff && !VALID_C_PLOT_TARGETS.has(cPlot.targetPayoff)) {
        issues.push(this.warning(
          'C-plot targetPayoff is not recognized.',
          blueprint.episodeId,
          'Use later_scene, later_episode, later_arc, or season.',
        ));
      }
      if (!hasText(cPlot.targetPayoff)) {
        issues.push(this.warning(
          'C-plot has no targetPayoff.',
          blueprint.episodeId,
          'Name whether the seed pays off in a later scene, episode, arc, or season.',
        ));
      }
    }

    if (!hasText(audit.episodeEndStateDelta)) {
      issues.push(this.error(
        'dramaticAudit.episodeEndStateDelta is missing.',
        blueprint.episodeId,
        'State what is different by episode end: identity, relationship, leverage, knowledge, danger, reputation, access, resource, future option, or emotional footing.',
      ));
    }

    if (!finale && !hasText(audit.nextEpisodePressure)) {
      issues.push(this.warning(
        'Non-finale episode is missing nextEpisodePressure.',
        blueprint.episodeId,
        'Name the pressure that carries forward through consequence, choice residue, reveal, relationship rupture, new danger, promise, C-plot seed, or unresolved cost.',
      ));
    }

    for (const turn of turns) {
      if (!turn.turnType || !VALID_TURN_TYPES.has(turn.turnType)) {
        issues.push(this.error(
          `Major turn ${turn.id || '(missing-id)'} is missing a meaningful turnType.`,
          turn.id,
          'Use reversal, revelation, escalation, choice, cost, or payoff.',
        ));
      }
      if (turnLooksFlat(turn)) {
        issues.push(this.error(
          `Major turn ${turn.id || '(missing-id)'} reads like a flat transition.`,
          turn.id,
          'Make the turn reverse, reveal, escalate, force choice, create cost, or pay off setup.',
        ));
      }
      if (!hasTurnOut(turn)) {
        issues.push(this.warning(
          `Major turn ${turn.id || '(missing-id)'} lacks turn-out detail.`,
          turn.id,
          'Add closesQuestion, opensQuestion, or memorableImageOrLine so the turn lands like an act-out without requiring literal acts.',
        ));
      }
    }

    return this.result(issues, metrics);
  }

  private result(
    issues: ValidationIssue[],
    metrics: EpisodePressureArchitectureMetrics,
  ): EpisodePressureArchitectureResult {
    const errors = issues.filter((issue) => issue.severity === 'error').length;
    const warnings = issues.filter((issue) => issue.severity === 'warning').length;
    const score = Math.max(0, 100 - errors * 12 - warnings * 5);
    return {
      valid: errors === 0,
      score,
      issues,
      suggestions: issues.map((issue) => issue.suggestion).filter((suggestion): suggestion is string => Boolean(suggestion)),
      metrics,
    };
  }
}
