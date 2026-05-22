import type { TreatmentEpisodeGuidance } from '../../types/sourceAnalysis';
import type { SourceMaterialAnalysis } from '../../types/sourceAnalysis';
import type { Story } from '../../types/story';
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

export interface TreatmentFinalStoryValidationInput {
  story: Story;
  analysis?: SourceMaterialAnalysis;
  expectedEpisodeCount?: number;
  sourceText?: string;
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

function storyText(story: Story): string {
  return [
    story.title,
    story.genre,
    story.synopsis,
    ...(story.tags || []),
    ...(story.npcs || []).map((npc) => [
      npc.name,
      npc.description,
      npc.role,
      npc.want,
      npc.fear,
      npc.flaw,
      npc.arc?.startState,
      npc.arc?.endState,
      ...(npc.arc?.keyBeats || []),
      ...(npc.secrets || []),
    ].filter(Boolean).join(' ')),
    ...(story.episodes || []).map((episode) => [
      episode.title,
      episode.synopsis,
      ...(episode.scenes || []).map((scene) => [
        scene.name,
        ...(scene.charactersInvolved || []),
        ...(scene.beats || []).map((beat) => [
          beat.text,
          ...(beat.textVariants || []).map((variant) => variant.text),
          ...(beat.choices || []).map((choice) => [
            choice.text,
            choice.reactionText,
            choice.tintFlag,
            choice.storyVerb,
            choice.memorableMoment?.summary,
            ...(choice.residueHints || []).map((hint) => hint.description),
            ...(choice.witnessReactions || []).map((reaction) => reaction.reactionText),
            choice.failureResidue?.description,
            choice.outcomeTexts?.success,
            choice.outcomeTexts?.partial,
            choice.outcomeTexts?.failure,
          ].filter(Boolean).join(' ')),
        ].filter(Boolean).join(' ')),
      ].filter(Boolean).join(' ')),
    ].filter(Boolean).join(' ')),
  ].filter(Boolean).join(' ');
}

function pushMissingExactAnchor(issues: string[], label: string, anchor: string, haystack: string): void {
  if (!anchor.trim()) return;
  if (normalize(haystack).includes(normalize(anchor))) return;
  issues.push(`[TreatmentFidelity] Final story is missing required ${label}: "${anchor}".`);
}

function collectCriticalSourceAnchors(sourceText: string | undefined): Array<{ label: string; value: string }> {
  if (!sourceText) return [];
  const anchors: Array<{ label: string; value: string }> = [];
  const addIfPresent = (label: string, value: string) => {
    if (normalize(sourceText).includes(normalize(value))) anchors.push({ label, value });
  };

  // High-signal anchors common in StoryRPG treatments: proper names, branded
  // places, codenames, and authored numeric promises. Keep this conservative
  // so the final-story gate catches identity drift without requiring every
  // capitalized phrase from a treatment to appear verbatim.
  for (const value of [
    'Dating After Dusk',
    'Daniel Hayes',
    'Sadie',
    'Lumina Books',
    'Mr. Midnight',
    'The Mountain',
    'Vâlcescu Club',
    'Cismigiu',
    'Cișmigiu',
    'rose quartz',
  ]) {
    addIfPresent('source anchor', value);
  }

  for (const match of sourceText.matchAll(/\b(?:\d{1,3},\d{3}|\d+K)\b/g)) {
    const value = match[0];
    const nearby = sourceText.slice(Math.max(0, match.index! - 80), Math.min(sourceText.length, match.index! + 80));
    if (/\b(?:blog|read|reader|readership|post|viral)\b/i.test(nearby)) {
      anchors.push({ label: 'blog readership number', value });
    }
  }

  return anchors.filter((anchor, index, all) =>
    all.findIndex((other) => normalize(other.value) === normalize(anchor.value)) === index
  );
}

function firstMentionIndex(haystack: string, needle: string): number {
  return normalize(haystack).indexOf(normalize(needle));
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
  validateFinalStory(input: TreatmentFinalStoryValidationInput): TreatmentFidelityValidationResult {
    const issues: string[] = [];
    const story = input.story;
    const allStoryText = storyText(story);
    const generatedEpisodeNumbers = new Set((story.episodes || []).map((episode) => episode.number));
    const maxGeneratedEpisode = Math.max(0, ...generatedEpisodeNumbers);

    if (input.expectedEpisodeCount !== undefined && story.episodes.length !== input.expectedEpisodeCount) {
      issues.push(
        `[TreatmentFidelity] Final story has ${story.episodes.length} episode(s); expected ${input.expectedEpisodeCount}.`
      );
    }

    if (input.analysis) {
      for (const character of input.analysis.majorCharacters || []) {
        if (character.firstAppearance <= maxGeneratedEpisode || input.expectedEpisodeCount === input.analysis.totalEstimatedEpisodes) {
          pushMissingExactAnchor(issues, 'character', character.name, allStoryText);
        }
      }
      for (const location of input.analysis.keyLocations || []) {
        if (location.importance === 'major' && (location.firstAppearance <= maxGeneratedEpisode || input.expectedEpisodeCount === input.analysis.totalEstimatedEpisodes)) {
          pushMissingExactAnchor(issues, 'major location', location.name, allStoryText);
        }
      }
      for (const element of input.analysis.adaptationGuidance?.elementsToPreserve || []) {
        if (!hasCloseMatch(element, allStoryText, 0.28)) {
          issues.push(`[TreatmentFidelity] Final story does not preserve treatment element: "${element}".`);
        }
      }
      for (const episodeGuidance of input.analysis.episodeBreakdown || []) {
        if (!generatedEpisodeNumbers.has(episodeGuidance.episodeNumber)) continue;
        const guidance = episodeGuidance.treatmentGuidance;
        if (!guidance) continue;
        const episode = story.episodes.find((candidate) => candidate.number === episodeGuidance.episodeNumber);
        const episodeText = episode ? storyText({ ...story, episodes: [episode] }) : allStoryText;
        for (const pressure of guidance.majorChoicePressures || []) {
          if (!hasCloseMatch(pressure, episodeText, 0.3)) {
            issues.push(`[TreatmentFidelity] Episode ${episodeGuidance.episodeNumber} is missing authored major choice pressure: "${pressure}".`);
          }
        }
        for (const seed of guidance.consequenceSeeds || []) {
          if (!hasCloseMatch(seed, episodeText, 0.24)) {
            issues.push(`[TreatmentFidelity] Episode ${episodeGuidance.episodeNumber} is missing authored consequence seed: "${seed}".`);
          }
        }
        if (guidance.authoredCliffhanger && !hasCloseMatch(guidance.authoredCliffhanger, episodeText, 0.35)) {
          issues.push(`[TreatmentFidelity] Episode ${episodeGuidance.episodeNumber} is missing authored cliffhanger: "${guidance.authoredCliffhanger}".`);
        }
      }
    }

    for (const anchor of collectCriticalSourceAnchors(input.sourceText)) {
      pushMissingExactAnchor(issues, anchor.label, anchor.value, allStoryText);
    }

    const victorIndex = firstMentionIndex(allStoryText, 'Victor');
    const raduIndex = firstMentionIndex(allStoryText, 'Radu');
    if (victorIndex >= 0 && raduIndex >= 0 && raduIndex < victorIndex) {
      issues.push('[TreatmentFidelity] Final story mentions Radu before Victor; check treatment continuity/order before generation proceeds.');
    }

    return { valid: issues.length === 0, issues };
  }

  validate(input: TreatmentFidelityValidationInput): TreatmentFidelityValidationResult {
    const issues: string[] = [];
    const guidance = input.treatmentGuidance;
    if (!guidance) return { valid: true, issues };

    const allBlueprintText = blueprintText(input.blueprint);

    if (guidance.authoredCliffhanger) {
      const cliffhangerHaystack = [
        finalSceneText(input.blueprint),
        input.blueprint.arc?.resolution,
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
      const matchedChoice = guidance.majorChoicePressures!.some((pressure) => hasCloseMatch(pressure, choices, 0.5));
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
