import type {
  DramaticTurnDriver,
  EpisodeBlueprint,
  InformationOwner,
  ResidueType,
  SceneBlueprint,
} from '../agents/StoryArchitect';
import type { StakesLayers } from '../../types';
import { BaseValidator, ValidationIssue, ValidationResult } from './BaseValidator';

export interface DramaticStructureValidationOptions {
  requireSceneLevelMetadata?: boolean;
  protagonistAgencyTarget?: number;
}

export interface DramaticStructureMetrics {
  sceneCount: number;
  transitionCount: number;
  causalTransitionCount: number;
  residueSceneCount: number;
  majorTurnCount: number;
  protagonistDrivenTurnCount: number;
  protagonistAgencyRatio: number;
  scenesWithStakeLayers: number;
}

export interface DramaticStructureValidationResult extends ValidationResult {
  metrics: DramaticStructureMetrics;
}

const VALID_CONNECTORS = new Set(['therefore', 'but']);
const PROTAGONIST_DRIVEN_DRIVERS = new Set<DramaticTurnDriver>(['protagonist', 'player_choice']);
const VALID_INFORMATION_OWNERS = new Set<InformationOwner>([
  'player',
  'audience',
  'protagonist',
  'ally',
  'antagonist',
  'world',
]);
const VALID_RESIDUE_TYPES = new Set<ResidueType>([
  'information',
  'relationship',
  'identity',
  'resource',
  'danger',
  'promise',
  'wound',
  'reputation',
  'access',
]);
const STAKES_LAYER_KEYS: Array<keyof StakesLayers> = ['material', 'relational', 'identity', 'existential'];

const ABSTRACT_STAKES = /\b(everything|the world|the realm|the kingdom|the city|all hope|fate|destiny|survival|stakes are high|danger grows)\b/i;
const PERSONAL_STAKES = /\b(friend|family|sibling|parent|child|lover|ally|mentor|home|name|reputation|trust|promise|vow|identity|future|memory|belonging|freedom|dignity|relationship|bond|wound|secret|debt|cost|lose|loss|save|protect|betray|exile|access)\b/i;
const STAKES_LADDER_TERMS = /\b(risk|cost|costs|lose|loses|loss|lost|danger|threat|pressure|leverage|narrow|narrows|option|choice|consequence|worse|harder|turn|turns|reveal|reveals|expose|exposes|trust|reputation|identity|resource|debt|wound|damage|peak|climax)\b/i;
const EMPTY_PLACEHOLDER = /\b(tbd|none|n\/a|unknown|placeholder|not specified)\b/i;

function hasText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && !EMPTY_PLACEHOLDER.test(value);
}

function hasPersonalStake(value: unknown): boolean {
  if (!hasText(value)) return false;
  const text = value.trim();
  if (ABSTRACT_STAKES.test(text) && !PERSONAL_STAKES.test(text)) return false;
  return true;
}

function filledStakeLayers(layers: StakesLayers | undefined): Array<keyof StakesLayers> {
  if (!layers) return [];
  return STAKES_LAYER_KEYS.filter((key) => hasText(layers[key]));
}

function hasRelationalOrIdentityLayer(layers: StakesLayers | undefined): boolean {
  return hasText(layers?.relational) || hasText(layers?.identity);
}

function hasPersonallyGroundedExistentialLayer(layers: StakesLayers | undefined, personalStake: unknown): boolean {
  if (!hasText(layers?.existential)) return true;
  return PERSONAL_STAKES.test(layers.existential) || hasPersonalStake(personalStake);
}

function hasExistentialLayer(layers: StakesLayers | undefined): boolean {
  return hasText(layers?.existential);
}

function hasNonExistentialLayer(layers: StakesLayers | undefined): boolean {
  return hasText(layers?.material) || hasText(layers?.relational) || hasText(layers?.identity);
}

function arrayOrEmpty<T>(value: T[] | undefined): T[] {
  return Array.isArray(value) ? value : [];
}

function sceneLabel(scene: SceneBlueprint): string {
  return `${scene.id || '(missing-id)'}${scene.name ? ` (${scene.name})` : ''}`;
}

function sceneHaystack(scene: SceneBlueprint): string {
  return [
    scene.description,
    scene.narrativeFunction,
    scene.dramaticQuestion,
    scene.wantVsNeed,
    scene.conflictEngine,
    scene.personalStake,
    scene.encounterBuildup,
    scene.encounterDescription,
    scene.encounterStakes,
    ...(scene.keyBeats || []),
    scene.dramaticStructure?.question,
    scene.dramaticStructure?.turn,
    scene.dramaticStructure?.pressurePeak,
    scene.dramaticStructure?.changedState,
    ...(scene.residue || []).map((residue) => `${residue.type} ${residue.description}`),
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

function normalizeConnector(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function hasStakesLadder(scene: SceneBlueprint): boolean {
  const keyBeats = arrayOrEmpty(scene.keyBeats);
  if (keyBeats.length < 2) return false;
  const ladderText = [
    ...keyBeats,
    scene.dramaticStructure?.turn,
    scene.dramaticStructure?.pressurePeak,
    scene.dramaticStructure?.changedState,
  ].filter(Boolean).join(' ');
  return STAKES_LADDER_TERMS.test(ladderText);
}

export class DramaticStructureValidator extends BaseValidator {
  constructor() {
    super('DramaticStructureValidator');
  }

  validate(
    blueprint: EpisodeBlueprint,
    options: DramaticStructureValidationOptions = {},
  ): DramaticStructureValidationResult {
    const issues: ValidationIssue[] = [];
    const scenes = arrayOrEmpty(blueprint.scenes);
    const sceneIds = new Set(scenes.map((scene) => scene.id));
    const target = options.protagonistAgencyTarget ?? 0.6;
    const requireSceneLevelMetadata = options.requireSceneLevelMetadata !== false;

    const metrics: DramaticStructureMetrics = {
      sceneCount: scenes.length,
      transitionCount: 0,
      causalTransitionCount: 0,
      residueSceneCount: 0,
      majorTurnCount: blueprint.dramaticAudit?.majorTurns?.length || 0,
      protagonistDrivenTurnCount: 0,
      protagonistAgencyRatio: 1,
      scenesWithStakeLayers: 0,
    };

    this.validateEpisodeAudit(blueprint, issues);
    this.validateAgency(blueprint, issues, metrics, target);

    scenes.forEach((scene, index) => {
      const isFinalScene = (scene.leadsTo || []).length === 0 || index === scenes.length - 1;
      if (filledStakeLayers(scene.stakesLayers).length > 0) {
        metrics.scenesWithStakeLayers += 1;
      }
      if (requireSceneLevelMetadata) {
        this.validateSceneStructure(scene, issues);
        if (isMajorScene(scene, isFinalScene) && !hasPersonalStake(scene.personalStake)) {
          issues.push(this.error(
            `Scene ${sceneLabel(scene)} lacks a concrete personal stake.`,
            scene.id,
            'Name the specific person, bond, promise, identity, reputation, home, future, or irreversible cost at risk.',
          ));
        }
        this.validateSceneStakeLayers(scene, issues, isFinalScene);
      }

      const residue = arrayOrEmpty(scene.residue);
      if (residue.length > 0) metrics.residueSceneCount += 1;
      this.validateResidue(scene, issues, isFinalScene);
      this.validateTransitions(scene, sceneIds, issues, metrics);
    });

    this.validateExistentialEscalation(scenes, issues);

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

  private validateEpisodeAudit(blueprint: EpisodeBlueprint, issues: ValidationIssue[]): void {
    const audit = blueprint.dramaticAudit;
    if (!audit) {
      issues.push(this.error(
        'Episode is missing dramaticAudit for P1-P8 editorial validation.',
        blueprint.episodeId,
        'Add episodeQuestion, themePressure, personalStake, majorTurns, and informationPlan.',
      ));
      return;
    }

    if (!hasText(audit.episodeQuestion)) {
      issues.push(this.error('dramaticAudit.episodeQuestion is missing.', blueprint.episodeId));
    }
    if (!hasText(audit.themePressure)) {
      issues.push(this.error(
        'dramaticAudit.themePressure is missing.',
        blueprint.episodeId,
        'State how this episode tests the theme through conflict, choice, cost, relationship, information, or identity.',
      ));
    }
    if (!hasPersonalStake(audit.personalStake)) {
      issues.push(this.error(
        'dramaticAudit.personalStake is missing or abstract.',
        blueprint.episodeId,
        'Ground the episode stake in a specific person, bond, promise, identity, reputation, home, future, or irreversible cost.',
      ));
    }
    const auditLayerCount = filledStakeLayers(audit.stakesLayers).length;
    if (auditLayerCount === 0) {
      issues.push(this.error(
        'dramaticAudit.stakesLayers is missing.',
        blueprint.episodeId,
        'Name the episode stakes layers: material, relational, identity, and/or existential.',
      ));
    }
    if (!hasPersonallyGroundedExistentialLayer(audit.stakesLayers, audit.personalStake)) {
      issues.push(this.error(
        'dramaticAudit existential stakes are not personally grounded.',
        blueprint.episodeId,
        'Tie existential stakes to a concrete person, home, future, freedom, identity, or irreversible loss.',
      ));
    }
    if (hasExistentialLayer(audit.stakesLayers) && auditLayerCount < 3) {
      issues.push(this.error(
        'dramaticAudit existential stakes need at least three stacked stakes layers.',
        blueprint.episodeId,
        'Earn existential pressure by stacking it with material, relational, and/or identity stakes.',
      ));
    }

    const informationPlan = arrayOrEmpty(audit.informationPlan);
    if (informationPlan.length === 0) {
      issues.push(this.error(
        'dramaticAudit.informationPlan is empty.',
        blueprint.episodeId,
        'Declare the major clues, secrets, threats, or open questions, who knows them, when they reveal, and how they pay off.',
      ));
    }

    informationPlan.forEach((item, index) => {
      const location = `${blueprint.episodeId}:informationPlan[${index}]`;
      if (!hasText(item.item) || !hasText(item.revealTiming) || !hasText(item.payoff)) {
        issues.push(this.error(
          'Information plan item is incomplete.',
          location,
          'Each information item needs item, revealTiming, payoff, and knownBy.',
        ));
      }
      const owners = arrayOrEmpty(item.knownBy);
      if (owners.length === 0 || owners.some((owner) => !VALID_INFORMATION_OWNERS.has(owner))) {
        issues.push(this.error(
          'Information plan item has missing or invalid knownBy ownership.',
          location,
          'Use knownBy entries from player, audience, protagonist, ally, antagonist, or world.',
        ));
      }
    });
  }

  private validateAgency(
    blueprint: EpisodeBlueprint,
    issues: ValidationIssue[],
    metrics: DramaticStructureMetrics,
    target: number,
  ): void {
    const turns = arrayOrEmpty(blueprint.dramaticAudit?.majorTurns);
    if (turns.length === 0) {
      issues.push(this.error(
        'dramaticAudit.majorTurns is empty.',
        blueprint.episodeId,
        'List 3-7 major episode turns and who drives or reshapes each turn.',
      ));
      metrics.protagonistAgencyRatio = 0;
      return;
    }

    metrics.protagonistDrivenTurnCount = turns.filter((turn) =>
      PROTAGONIST_DRIVEN_DRIVERS.has(turn.driver) || hasText(turn.protagonistInfluence)
    ).length;
    metrics.protagonistAgencyRatio = metrics.protagonistDrivenTurnCount / turns.length;

    if (metrics.protagonistAgencyRatio < target) {
      issues.push(this.warning(
        `Only ${Math.round(metrics.protagonistAgencyRatio * 100)}% of major turns are protagonist/player-driven; target is ${Math.round(target * 100)}%.`,
        blueprint.episodeId,
        'Revise external turns so protagonist/player choices, failures, relationships, preparation, or discoveries cause the next consequence.',
      ));
    }

    turns.forEach((turn, index) => {
      const location = `${blueprint.episodeId}:majorTurns[${index}]`;
      if (!hasText(turn.id) || !hasText(turn.description)) {
        issues.push(this.error('Major turn is missing id or description.', location));
      }
      if (!turn.driver) {
        issues.push(this.error('Major turn is missing driver.', location));
      }
      if (!PROTAGONIST_DRIVEN_DRIVERS.has(turn.driver) && !hasText(turn.protagonistInfluence)) {
        issues.push(this.warning(
          `Major turn "${turn.id || index}" is externally driven without protagonist influence.`,
          location,
          'Explain how the protagonist/player meaningfully reshapes this external pressure.',
        ));
      }
    });
  }

  private validateSceneStructure(
    scene: SceneBlueprint,
    issues: ValidationIssue[],
  ): void {
    const structure = scene.dramaticStructure;
    if (!structure) {
      issues.push(this.error(
        `Scene ${sceneLabel(scene)} is missing dramaticStructure.`,
        scene.id,
        'Add question, turn, pressurePeak, and changedState.',
      ));
      return;
    }

    for (const field of ['question', 'turn', 'pressurePeak', 'changedState'] as const) {
      if (!hasText(structure[field])) {
        issues.push(this.error(
          `Scene ${sceneLabel(scene)} dramaticStructure.${field} is missing.`,
          scene.id,
          'Every scene needs question, turn, pressure peak, and changed state.',
        ));
      }
    }
  }

  private validateSceneStakeLayers(scene: SceneBlueprint, issues: ValidationIssue[], isFinalScene: boolean): void {
    const layers = filledStakeLayers(scene.stakesLayers);
    const major = isMajorScene(scene, isFinalScene);

    if (major && layers.length < 3) {
      issues.push(this.error(
        `Scene ${sceneLabel(scene)} needs at least three stakes layers.`,
        scene.id,
        'Major scenes, encounters, dilemmas, and climaxes should name at least three of material, relational, identity, or existential stakes.',
      ));
    }

    if (major && !hasStakesLadder(scene)) {
      issues.push(this.error(
        `Scene ${sceneLabel(scene)} is missing a stakes ladder in keyBeats.`,
        scene.id,
        'Key beats should raise risk, reveal cost, narrow options, shift leverage, or deepen consequence until the pressure peak.',
      ));
    }

    const climaxOrDilemma = scene.choicePoint?.type === 'dilemma' ||
      /climax|confront|final|decisive|all-in|all in|choice decides/i.test(sceneHaystack(scene));
    if (climaxOrDilemma && !hasRelationalOrIdentityLayer(scene.stakesLayers)) {
      issues.push(this.error(
        `Scene ${sceneLabel(scene)} needs relational or identity stakes.`,
        scene.id,
        'Dilemmas and climaxes must pressure a relationship or identity, not only material/external outcomes.',
      ));
    }

    if (!hasPersonallyGroundedExistentialLayer(scene.stakesLayers, scene.personalStake)) {
      issues.push(this.error(
        `Scene ${sceneLabel(scene)} has existential stakes that are not personally grounded.`,
        scene.id,
        'Tie existential stakes to a concrete person, home, future, freedom, identity, or irreversible loss.',
      ));
    }
    if (hasExistentialLayer(scene.stakesLayers) && layers.length < 3) {
      issues.push(this.error(
        `Scene ${sceneLabel(scene)} promotes stakes to existential before enough layers are established.`,
        scene.id,
        'Do not promote material stakes to existential without at least two supporting personal, relational, material, or identity layers.',
      ));
    }

    if (scene.choicePoint) {
      this.validateChoiceStakeLayers(scene, issues);
    }
  }

  private validateChoiceStakeLayers(scene: SceneBlueprint, issues: ValidationIssue[]): void {
    const choicePoint = scene.choicePoint;
    if (!choicePoint) return;
    const layers = filledStakeLayers(choicePoint.stakesLayers);
    const meaningfulChoice = choicePoint.type !== 'expression' || choicePoint.branches;

    if (meaningfulChoice && layers.length === 0) {
      issues.push(this.error(
        `Scene ${sceneLabel(scene)} choicePoint is missing stakesLayers.`,
        scene.id,
        'Keep the Stakes Triangle, but also name the stakes layers behind the choice.',
      ));
    }
    if (choicePoint.type === 'dilemma' && !hasRelationalOrIdentityLayer(choicePoint.stakesLayers || scene.stakesLayers)) {
      issues.push(this.error(
        `Scene ${sceneLabel(scene)} dilemma choice lacks relational or identity stakes.`,
        scene.id,
        'Dilemmas must pressure who the protagonist becomes and/or a relationship that matters.',
      ));
    }
    if (!hasPersonallyGroundedExistentialLayer(choicePoint.stakesLayers, scene.personalStake)) {
      issues.push(this.error(
        `Scene ${sceneLabel(scene)} choicePoint existential stakes are not personally grounded.`,
        scene.id,
        'Tie existential choice stakes to a concrete person, home, future, freedom, identity, or irreversible loss.',
      ));
    }
  }

  private validateExistentialEscalation(scenes: SceneBlueprint[], issues: ValidationIssue[]): void {
    const firstExistentialIndex = scenes.findIndex((scene) => hasExistentialLayer(scene.stakesLayers));
    if (firstExistentialIndex < 0) return;

    const priorInvestment = scenes
      .slice(0, firstExistentialIndex)
      .some((scene) => hasNonExistentialLayer(scene.stakesLayers) || hasPersonalStake(scene.personalStake));

    if (firstExistentialIndex === 0 && scenes.length > 1) {
      issues.push(this.warning(
        `Scene ${sceneLabel(scenes[0])} opens with existential stakes.`,
        scenes[0].id,
        'Opening existential stakes can work, but make sure the same scene first establishes the concrete personal, relational, or identity loss that makes the threat matter.',
      ));
    } else if (!priorInvestment) {
      issues.push(this.error(
        `Scene ${sceneLabel(scenes[firstExistentialIndex])} introduces existential stakes without prior personal investment.`,
        scenes[firstExistentialIndex].id,
        'Establish what the protagonist personally stands to lose before expanding to existential or world-scale stakes.',
      ));
    }
  }

  private validateTransitions(
    scene: SceneBlueprint,
    sceneIds: Set<string>,
    issues: ValidationIssue[],
    metrics: DramaticStructureMetrics,
  ): void {
    const leadsTo = arrayOrEmpty(scene.leadsTo);
    const transitions = arrayOrEmpty(scene.transitionOut);
    const transitionsByTarget = new Map(transitions.map((transition) => [transition.toSceneId, transition]));

    for (const targetId of leadsTo) {
      metrics.transitionCount += 1;
      if (!sceneIds.has(targetId)) continue;
      const transition = transitionsByTarget.get(targetId);
      if (!transition) {
        issues.push(this.error(
          `Scene ${sceneLabel(scene)} routes to ${targetId} without transitionOut metadata.`,
          scene.id,
          'Every leadsTo target needs a therefore/but transition with causalLink and pressureChange.',
        ));
        continue;
      }

      const connector = normalizeConnector(transition.connector);
      if (!VALID_CONNECTORS.has(connector)) {
        issues.push(this.error(
          `Scene ${sceneLabel(scene)} transition to ${targetId} is not therefore/but.`,
          scene.id,
          'Use connector "therefore" or "but"; never rely on simple chronology.',
        ));
      }
      if (!hasText(transition.causalLink) || !hasText(transition.pressureChange)) {
        issues.push(this.error(
          `Scene ${sceneLabel(scene)} transition to ${targetId} lacks causal pressure.`,
          scene.id,
          'Explain the consequence, reversal, discovery, cost, escalation, or choice residue that makes the next scene necessary.',
        ));
      } else {
        metrics.causalTransitionCount += 1;
      }
    }
  }

  private validateResidue(scene: SceneBlueprint, issues: ValidationIssue[], isFinalScene: boolean): void {
    const residue = arrayOrEmpty(scene.residue);
    if (residue.length === 0) {
      issues.push(this.error(
        `Scene ${sceneLabel(scene)} has no residue.`,
        scene.id,
        'Every scene must leave changed information, leverage, relationship, identity, resource, danger, promise, wound, reputation, access, or future option.',
      ));
      return;
    }

    residue.forEach((item, index) => {
      const location = `${scene.id}:residue[${index}]`;
      if (!VALID_RESIDUE_TYPES.has(item.type)) {
        issues.push(this.error(
          `Scene ${sceneLabel(scene)} has invalid residue type "${String(item.type)}".`,
          location,
          'Use information, relationship, identity, resource, danger, promise, wound, reputation, or access.',
        ));
      }
      if (!hasText(item.description)) {
        issues.push(this.error(
          `Scene ${sceneLabel(scene)} has residue without description.`,
          location,
          'Describe what remains changed after this scene.',
        ));
      }
    });

    if (isFinalScene && !residue.some((item) => ['information', 'relationship', 'identity', 'danger', 'promise', 'reputation', 'access'].includes(item.type))) {
      issues.push(this.warning(
        `Final scene ${sceneLabel(scene)} may not leave episode-scale residue.`,
        scene.id,
        'Final scenes should leave a changed state that can echo into later choices, relationships, information, identity, danger, reputation, or access.',
      ));
    }
  }
}
