import type { TreatmentEpisodeGuidance } from '../../types/sourceAnalysis';
import type { EpisodeBlueprint, SceneBlueprint, StoryArchitectInput } from '../agents/StoryArchitect';

export interface TreatmentFidelityValidationInput {
  blueprint: EpisodeBlueprint;
  treatmentGuidance?: TreatmentEpisodeGuidance;
  cliffhangerPlan?: StoryArchitectInput['cliffhangerPlan'];
  plannedEncounters?: NonNullable<NonNullable<StoryArchitectInput['seasonPlanDirectives']>['plannedEncounters']>;
}

export interface TreatmentFidelityValidationResult {
  valid: boolean;
  issues: string[];
}

const STOPWORDS = new Set([
  'about', 'after', 'again', 'against', 'also', 'and', 'because', 'become', 'before', 'being', 'between',
  'choice', 'chooses', 'could', 'during', 'episode', 'every', 'from', 'have', 'into', 'keeps', 'later',
  'leave', 'leaves', 'major', 'make', 'makes', 'must', 'opens', 'paths', 'player', 'pressure', 'scene',
  'should', 'that', 'their', 'them', 'then', 'there', 'this', 'through', 'when', 'where', 'with', 'without',
]);

function normalize(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokens(value: string | undefined): string[] {
  if (!value) return [];
  return normalize(value)
    .split(' ')
    .filter((token) => token.length >= 4 && !STOPWORDS.has(token));
}

function tokenOverlapScore(needle: string, haystack: string): number {
  const needed = [...new Set(tokens(needle))];
  if (needed.length === 0) return 0;
  const hay = new Set(tokens(haystack));
  const hits = needed.filter((token) => hay.has(token)).length;
  return hits / needed.length;
}

function hasCloseMatch(needle: string | undefined, haystack: string, minScore = 0.34): boolean {
  if (!needle?.trim()) return true;
  const normalizedNeedle = normalize(needle);
  const normalizedHaystack = normalize(haystack);
  if (normalizedHaystack.includes(normalizedNeedle)) return true;

  const needed = tokens(needle);
  const matchingTokens = needed.filter((token) => normalizedHaystack.includes(token));
  if (matchingTokens.length >= Math.min(3, needed.length)) return true;
  return tokenOverlapScore(needle, haystack) >= minScore;
}

function sceneText(scene: SceneBlueprint): string {
  const choice = scene.choicePoint;
  return [
    scene.name,
    scene.description,
    scene.narrativeFunction,
    scene.encounterDescription,
    scene.encounterBuildup,
    scene.encounterStakes,
    ...(scene.keyBeats || []),
    ...(scene.encounterBeatPlan || []),
    ...(scene.encounterSetupContext || []),
    choice?.description,
    ...(choice?.optionHints || []),
    choice?.stakes?.want,
    choice?.stakes?.cost,
    choice?.stakes?.identity,
    choice?.reminderPlan?.immediate,
    choice?.reminderPlan?.shortTerm,
    choice?.reminderPlan?.later,
    ...(choice?.expectedResidue || []),
  ].filter(Boolean).join(' ');
}

function blueprintText(blueprint: EpisodeBlueprint): string {
  return [
    blueprint.title,
    blueprint.synopsis,
    blueprint.arc?.hook,
    blueprint.arc?.plotTurn1,
    blueprint.arc?.pinch1,
    blueprint.arc?.midpoint,
    blueprint.arc?.pinch2,
    blueprint.arc?.climax,
    blueprint.arc?.resolution,
    ...(blueprint.themes || []),
    ...(blueprint.suggestedFlags || []).map((flag) => `${flag.name} ${flag.description}`),
    ...(blueprint.suggestedScores || []).map((score) => `${score.name} ${score.description}`),
    ...(blueprint.suggestedTags || []).map((tag) => `${tag.name} ${tag.description}`),
    ...(blueprint.narrativePromises || []).map((promise) => `${promise.description} ${promise.setupScene} ${promise.importance}`),
    ...(blueprint.scenes || []).map(sceneText),
  ].filter(Boolean).join(' ');
}

function finalSceneText(blueprint: EpisodeBlueprint): string {
  const finalScenes = (blueprint.scenes || []).filter((scene) => (scene.leadsTo || []).length === 0);
  const scenes = finalScenes.length > 0 ? finalScenes : blueprint.scenes.slice(-1);
  return scenes.map(sceneText).join(' ');
}

function choiceText(blueprint: EpisodeBlueprint): string {
  return (blueprint.scenes || [])
    .filter((scene) => scene.choicePoint)
    .map(sceneText)
    .join(' ');
}

function residueText(blueprint: EpisodeBlueprint): string {
  return [
    ...(blueprint.suggestedFlags || []).map((flag) => `${flag.name} ${flag.description}`),
    ...(blueprint.suggestedScores || []).map((score) => `${score.name} ${score.description}`),
    ...(blueprint.suggestedTags || []).map((tag) => `${tag.name} ${tag.description}`),
    ...(blueprint.narrativePromises || []).map((promise) => `${promise.description} ${promise.setupScene}`),
    ...(blueprint.scenes || []).map((scene) => [
      scene.incomingChoiceContext,
      ...(scene.choicePoint?.expectedResidue || []),
      scene.choicePoint?.reminderPlan?.immediate,
      scene.choicePoint?.reminderPlan?.shortTerm,
      scene.choicePoint?.reminderPlan?.later,
      ...(scene.encounterSetupContext || []),
    ].filter(Boolean).join(' ')),
  ].filter(Boolean).join(' ');
}

export class TreatmentFidelityValidator {
  validate(input: TreatmentFidelityValidationInput): TreatmentFidelityValidationResult {
    const issues: string[] = [];
    const guidance = input.treatmentGuidance;
    if (!guidance) return { valid: true, issues };

    const allBlueprintText = blueprintText(input.blueprint);

    if (guidance.authoredCliffhanger) {
      const cliffhangerHaystack = [
        finalSceneText(input.blueprint),
        input.cliffhangerPlan?.hook,
        input.cliffhangerPlan?.setup,
        input.cliffhangerPlan?.newOpenQuestion,
        input.cliffhangerPlan?.nextEpisodePressure,
      ].filter(Boolean).join(' ');
      if (!hasCloseMatch(guidance.authoredCliffhanger, cliffhangerHaystack, 0.4)) {
        issues.push(
          `[TreatmentFidelity] Blueprint does not preserve the authored cliffhanger: "${guidance.authoredCliffhanger}". ` +
          'Make the final scene narrativeFunction/keyBeats explicitly land this hook.'
        );
      }
    }

    if ((guidance.majorChoicePressures || []).length > 0) {
      const choices = choiceText(input.blueprint);
      const matchedChoice = guidance.majorChoicePressures!.some((pressure) => hasCloseMatch(pressure, choices, 0.3));
      if (!matchedChoice) {
        issues.push(
          `[TreatmentFidelity] Blueprint does not turn any authored major choice pressure into a real choicePoint. ` +
          `Use one of: ${guidance.majorChoicePressures!.join(' | ')}`
        );
      }
    }

    const plannedTreatmentEncounters = (input.plannedEncounters || []).filter((encounter) =>
      encounter.id.startsWith('treatment-enc-')
    );
    if ((guidance.encounterAnchors || []).length > 0) {
      const hasTreatmentEncounterId = plannedTreatmentEncounters.some((encounter) =>
        input.blueprint.scenes.some((scene) => scene.plannedEncounterId === encounter.id)
      );
      const hasAnchorMatch = (guidance.encounterAnchors || []).some((anchor) => hasCloseMatch(anchor, allBlueprintText, 0.35));
      if (!hasTreatmentEncounterId && !hasAnchorMatch) {
        issues.push(
          `[TreatmentFidelity] Blueprint does not preserve a treatment-derived encounter anchor. ` +
          `Include a planned encounter for one of: ${guidance.encounterAnchors!.join(' | ')}`
        );
      }
    }

    const authoredResidue = [
      ...(guidance.alternativePaths || []),
      ...(guidance.consequenceSeeds || []),
    ];
    if (authoredResidue.length > 0) {
      const residueHaystack = residueText(input.blueprint);
      const hasResidue = authoredResidue.some((residue) => hasCloseMatch(residue, residueHaystack, 0.28));
      if (!hasResidue) {
        issues.push(
          `[TreatmentFidelity] Blueprint does not show visible residue from authored alternative paths or consequence seeds. ` +
          'Add expectedResidue, reminderPlan, suggestedFlags, or narrativePromises that carry one authored residue forward.'
        );
      }
    }

    return { valid: issues.length === 0, issues };
  }
}
