import type { EpisodeBlueprint, SceneBlueprint } from '../agents/StoryArchitect';
import { BaseValidator, ValidationIssue, ValidationResult } from './BaseValidator';

export interface SceneTurnContractOptions {
  episodeStructureMode?: 'standard' | 'sceneEpisodes';
}

export interface SceneTurnContractMetrics {
  sceneCount: number;
  scenesWithEntryIntent: number;
  scenesWithObstacle: number;
  scenesWithForcedDecision: number;
  scenesWithExitShift: number;
  multiCharacterSceneCount: number;
  multiCharacterScenesWithPowerShift: number;
  consequenceBearingSceneCount: number;
}

export interface SceneTurnContractValidationResult extends ValidationResult {
  metrics: SceneTurnContractMetrics;
}

const EMPTY_PLACEHOLDER = /\b(tbd|none|n\/a|unknown|placeholder|not specified)\b/i;
const INTENT_TERMS = /\b(want|wants|need|needs|must|try|tries|seeks?|protect|prove|repair|recover|escape|hide|learn|investigate|find|save|reach|open|enter|confront|avoid|decide|choose|choice|commit|refuse|stay|stand|act|help|goal|objective|intent)\b/i;
const OBSTACLE_TERMS = /\b(block|blocks|resist|resists|obstacle|opposes|opposition|conflict|threat|danger|pressure|cost|risk|locked|missing|hidden|fear|refuse|refuses|antagonist|enemy|rival|wound|time|deadline|debt|suspicion|accusation|trap|secret|betray|limit|complicate|complicates)\b/i;
const DECISION_TERMS = /\b(decide|decides|decision|choose|chooses|choice|chose|commit|commits|commitment|refuse|refuses|refusal|accept|accepts|reject|rejects|reveal|reveals|hide|hides|sacrifice|sacrifices|tradeoff|trade-off|risk|risks|betray|betrays|trust|trusts|confront|confronts|promise|promises|confess|confesses|answer|answers|must|cannot|can no longer|turns toward|turns away|irreversible)\b/i;
const EXIT_SHIFT_TERMS = /\b(changed|different|leaves|leave|shift|shifts|now|no longer|becomes|cost|consequence|residue|new|lost|gained|damaged|wounded|trust|leverage|identity|reputation|access|future|relationship|information|knows|learns|discovers|carries|public|private)\b/i;
const POWER_SHIFT_TERMS = /\b(power|upper hand|advantage|leverage|status|control|pressure|dominance|vulnerab\w*|expos\w*|corner\w*|accus\w*|challenge\w*|confront\w*|threat\w*|blackmail|humiliat\w*|trust|mistrust|betray\w*|alliance|distance|closer|withdraw\w*|submit\w*|yield\w*|defy|defies|refus\w*|authority|permission|debt|favor|owes?|credibility|reputation|silence|voice|public|private)\b/i;
const CONSEQUENCE_TERMS = /\b(changed|consequence|cost|residue|therefore|but|because|learns?|knows?|discovers?|reveal\w*|information|clue|secret|trust|relationship|identity|reputation|resource|access|danger|threat|promise|wound|debt|lost|gained|opens?|closes?|future|choice|commit|refus\w*|payoff|setup|theme|stake|leverage)\b/i;

function hasText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && !EMPTY_PLACEHOLDER.test(value);
}

function arrayOrEmpty<T>(value: T[] | undefined): T[] {
  return Array.isArray(value) ? value : [];
}

function sceneLabel(scene: SceneBlueprint): string {
  return `${scene.id || '(missing-id)'}${scene.name ? ` (${scene.name})` : ''}`;
}

function textFrom(values: unknown[]): string {
  return values
    .filter((value): value is string => hasText(value))
    .join(' ');
}

function transitionText(scene: SceneBlueprint): string {
  return arrayOrEmpty(scene.transitionOut)
    .map((transition) => [transition.causalLink, transition.pressureChange].filter(Boolean).join(' '))
    .join(' ');
}

function residueText(scene: SceneBlueprint): string {
  return arrayOrEmpty(scene.residue)
    .map((residue) => [residue.type, residue.description].filter(Boolean).join(' '))
    .join(' ');
}

function entryIntentText(scene: SceneBlueprint): string {
  return textFrom([
    scene.sequenceIntent?.objective,
    scene.dramaticQuestion,
    scene.wantVsNeed,
    scene.choicePoint?.stakes?.want,
    scene.encounterDescription,
  ]);
}

function obstacleText(scene: SceneBlueprint): string {
  return textFrom([
    scene.sequenceIntent?.obstacle,
    scene.conflictEngine,
    scene.dramaticStructure?.turn,
    scene.dramaticStructure?.pressurePeak,
    scene.encounterDescription,
    scene.encounterStakes,
    scene.encounterBuildup,
  ]);
}

function forcedDecisionText(scene: SceneBlueprint): string {
  return textFrom([
    scene.choicePoint?.description,
    scene.choicePoint?.themeAnswer,
    scene.choicePoint?.stakes?.cost,
    scene.choicePoint?.stakes?.identity,
    scene.sequenceIntent?.turningPoint,
    scene.dramaticStructure?.pressurePeak,
    scene.dramaticStructure?.changedState,
    ...(scene.keyBeats || []),
    transitionText(scene),
    residueText(scene),
  ]);
}

function exitShiftText(scene: SceneBlueprint): string {
  return textFrom([
    scene.sequenceIntent?.endState,
    scene.dramaticStructure?.changedState,
    transitionText(scene),
    residueText(scene),
    ...(scene.keyBeats || []).slice(-2),
  ]);
}

function sceneHaystack(scene: SceneBlueprint): string {
  return textFrom([
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
    scene.sequenceIntent?.objective,
    scene.sequenceIntent?.obstacle,
    scene.sequenceIntent?.turningPoint,
    scene.sequenceIntent?.endState,
    scene.dramaticStructure?.question,
    scene.dramaticStructure?.turn,
    scene.dramaticStructure?.pressurePeak,
    scene.dramaticStructure?.changedState,
    scene.choicePoint?.description,
    scene.choicePoint?.themeAnswer,
    scene.choicePoint?.stakes?.want,
    scene.choicePoint?.stakes?.cost,
    scene.choicePoint?.stakes?.identity,
    ...(scene.keyBeats || []),
    transitionText(scene),
    residueText(scene),
  ]);
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

function isMultiCharacterScene(scene: SceneBlueprint): boolean {
  return arrayOrEmpty(scene.npcsPresent).length > 0 || arrayOrEmpty(scene.encounterRequiredNpcIds).length > 0;
}

function hasEntryIntent(scene: SceneBlueprint): boolean {
  const text = entryIntentText(scene);
  return hasText(scene.sequenceIntent?.objective) || INTENT_TERMS.test(text);
}

function hasObstacle(scene: SceneBlueprint): boolean {
  const text = obstacleText(scene);
  return hasText(scene.sequenceIntent?.obstacle) || hasText(scene.conflictEngine) || OBSTACLE_TERMS.test(text);
}

function hasForcedDecision(scene: SceneBlueprint): boolean {
  if (scene.choicePoint) return true;
  return DECISION_TERMS.test(forcedDecisionText(scene));
}

function hasExitShift(scene: SceneBlueprint): boolean {
  if (hasText(scene.sequenceIntent?.endState) || hasText(scene.dramaticStructure?.changedState)) return true;
  if (arrayOrEmpty(scene.residue).length > 0) return true;
  return EXIT_SHIFT_TERMS.test(exitShiftText(scene));
}

function hasPowerShift(scene: SceneBlueprint): boolean {
  const text = textFrom([
    scene.dramaticStructure?.turn,
    scene.dramaticStructure?.pressurePeak,
    scene.dramaticStructure?.changedState,
    scene.sequenceIntent?.turningPoint,
    scene.sequenceIntent?.endState,
    scene.choicePoint?.description,
    scene.choicePoint?.stakes?.cost,
    scene.choicePoint?.stakes?.identity,
    scene.encounterDescription,
    scene.encounterStakes,
    ...(scene.keyBeats || []),
    residueText(scene),
  ]);
  return POWER_SHIFT_TERMS.test(text);
}

function filledStakeLayerCount(scene: SceneBlueprint): number {
  const layers = scene.stakesLayers;
  if (!layers) return 0;
  return [layers.material, layers.relational, layers.identity, layers.existential]
    .filter(hasText)
    .length;
}

function hasNarrativeConsequence(scene: SceneBlueprint): boolean {
  if (arrayOrEmpty(scene.residue).length > 0) return true;
  if (scene.choicePoint) return true;
  if (scene.isEncounter) return true;
  if (hasText(scene.themePressure)) return true;
  if (filledStakeLayerCount(scene) > 0) return true;
  if (arrayOrEmpty(scene.transitionOut).some((transition) => hasText(transition.causalLink) || hasText(transition.pressureChange))) return true;
  if (hasText(scene.dramaticStructure?.changedState)) return true;
  if (hasText(scene.sequenceIntent?.endState)) return true;
  return CONSEQUENCE_TERMS.test(sceneHaystack(scene));
}

export class SceneTurnContractValidator extends BaseValidator {
  constructor() {
    super('SceneTurnContractValidator');
  }

  validate(
    blueprint: EpisodeBlueprint,
    options: SceneTurnContractOptions = {},
  ): SceneTurnContractValidationResult {
    const issues: ValidationIssue[] = [];
    const scenes = arrayOrEmpty(blueprint.scenes);
    const metrics: SceneTurnContractMetrics = {
      sceneCount: scenes.length,
      scenesWithEntryIntent: 0,
      scenesWithObstacle: 0,
      scenesWithForcedDecision: 0,
      scenesWithExitShift: 0,
      multiCharacterSceneCount: 0,
      multiCharacterScenesWithPowerShift: 0,
      consequenceBearingSceneCount: 0,
    };

    scenes.forEach((scene) => {
      const isFinalScene = (scene.leadsTo || []).length === 0 || scene === scenes[scenes.length - 1];
      const major = isMajorScene(scene, isFinalScene);
      const multiCharacter = isMultiCharacterScene(scene);
      const entry = hasEntryIntent(scene);
      const obstacle = hasObstacle(scene);
      const decision = hasForcedDecision(scene);
      const exit = hasExitShift(scene);
      const powerShift = hasPowerShift(scene);
      const consequence = hasNarrativeConsequence(scene);

      if (entry) metrics.scenesWithEntryIntent += 1;
      if (obstacle) metrics.scenesWithObstacle += 1;
      if (decision) metrics.scenesWithForcedDecision += 1;
      if (exit) metrics.scenesWithExitShift += 1;
      if (multiCharacter) metrics.multiCharacterSceneCount += 1;
      if (multiCharacter && powerShift) metrics.multiCharacterScenesWithPowerShift += 1;
      if (consequence) metrics.consequenceBearingSceneCount += 1;

      const prefix = options.episodeStructureMode === 'sceneEpisodes'
        ? `sceneEpisode scene ${sceneLabel(scene)}`
        : `Scene ${sceneLabel(scene)}`;

      if (!entry) {
        issues.push(this.error(
          `${prefix} lacks entry intent.`,
          scene.id,
          'Use dramaticQuestion, wantVsNeed, choice stakes, or sequenceIntent.objective to show what the character enters wanting, avoiding, seeking, protecting, learning, or deciding.',
        ));
      }

      if (!obstacle) {
        issues.push(this.error(
          `${prefix} lacks an active obstacle.`,
          scene.id,
          'Use conflictEngine or sequenceIntent.obstacle to name what blocks, resists, complicates, or prices the entry intent.',
        ));
      }

      if (!decision) {
        issues.push(this.error(
          `${prefix} lacks a forced decision or irreversible reaction.`,
          scene.id,
          'Add a choicePoint or make the pressure peak/keyBeats force commitment, refusal, revelation, sacrifice, tradeoff, or irreversible reaction.',
        ));
      }

      if (!exit) {
        issues.push(this.error(
          `${prefix} lacks an exit shift.`,
          scene.id,
          'Use dramaticStructure.changedState, sequenceIntent.endState, residue, or transitionOut.pressureChange to show changed emotional, strategic, relational, informational, material, or identity footing.',
        ));
      }

      if (multiCharacter && !powerShift) {
        const message = `${prefix} lacks a power-dynamic shift.`;
        const suggestion = 'In multi-character scenes, shift leverage, trust, vulnerability, intimacy, distance, status, information, threat, debt, or public/private advantage at least once.';
        issues.push(major || options.episodeStructureMode === 'sceneEpisodes'
          ? this.error(message, scene.id, suggestion)
          : this.warning(message, scene.id, suggestion));
      }

      if (!consequence) {
        issues.push(this.error(
          `${prefix} appears removable; it has no clear narrative consequence.`,
          scene.id,
          'Make the scene change information, relationship, identity, resource/access, danger, promise/setup/payoff, choice consequence, theme pressure, stakes, route state, or emotional footing.',
        ));
      }
    });

    const errors = issues.filter((issue) => issue.severity === 'error').length;
    const score = Math.max(0, 100 - errors * 10);

    return {
      valid: errors === 0,
      score,
      issues,
      suggestions: issues.map((issue) => issue.suggestion).filter((suggestion): suggestion is string => Boolean(suggestion)),
      metrics,
    };
  }
}
