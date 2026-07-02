/**
 * Scene/beat signal inference for media planning (pure move from FullStoryPipeline).
 *
 * Deterministic heuristics that read authored prose/mood fields and infer the
 * signals audio narration and visual planning consume: emotion category,
 * intensity, valence, scene context (climax/flashback/time-of-day), choice
 * positions, and world-bible location resolution.
 */

import type { SceneBlueprint } from '../agents/StoryArchitect';
import type { SceneContent } from '../agents/SceneWriter';
import type { ChoiceSet } from '../agents/ChoiceAuthor';
import type { WorldBible } from '../agents/WorldBuilder';
import { TEXT_LIMITS } from '../../constants/validation';

/**
 * Map speakerMood string to emotion category
 */
export function mapSpeakerMoodToEmotion(speakerMood?: string): 'hopeful' | 'tense' | 'melancholy' | 'triumphant' | 'eerie' | 'neutral' {
  if (!speakerMood) return 'neutral';

  const mood = speakerMood.toLowerCase();

  if (mood.includes('happy') || mood.includes('joy') || mood.includes('excit') || mood.includes('hope')) return 'hopeful';
  if (mood.includes('tense') || mood.includes('anxious') || mood.includes('nervous') || mood.includes('fear') || mood.includes('worry')) return 'tense';
  if (mood.includes('sad') || mood.includes('grief') || mood.includes('mourn') || mood.includes('melan')) return 'melancholy';
  if (mood.includes('triumph') || mood.includes('victory') || mood.includes('proud') || mood.includes('confident')) return 'triumphant';
  if (mood.includes('eerie') || mood.includes('creep') || mood.includes('unnerv') || mood.includes('dread')) return 'eerie';
  if (mood.includes('angry') || mood.includes('rage') || mood.includes('frust')) return 'tense'; // Map anger to tense

  return 'neutral';
}

/**
 * Infer emotional intensity from mood and text
 */
export function inferIntensity(speakerMood?: string, text?: string): 'low' | 'medium' | 'high' {
  const mood = (speakerMood || '').toLowerCase();
  const content = (text || '').toLowerCase();

  // High intensity indicators
  if (mood.includes('rage') || mood.includes('terror') || mood.includes('ecsta') || mood.includes('grief')) return 'high';
  const exclamationMatches = content.match(/!/g);
  if (content.includes('!') && exclamationMatches && exclamationMatches.length >= 2) return 'high';
  if (content.includes('scream') || content.includes('shout') || content.includes('explod')) return 'high';

  // Low intensity indicators
  if (mood.includes('calm') || mood.includes('peace') || mood.includes('serene') || mood.includes('quiet')) return 'low';
  if (mood.includes('bored') || mood.includes('tired') || mood.includes('sleepy')) return 'low';

  return 'medium';
}

/**
 * Infer emotional valence from mood and text
 */
export function inferValence(speakerMood?: string, text?: string): 'positive' | 'negative' | 'ambiguous' {
  const mood = (speakerMood || '').toLowerCase();

  // Positive
  if (mood.includes('happy') || mood.includes('joy') || mood.includes('hope') || mood.includes('love') ||
      mood.includes('excit') || mood.includes('proud') || mood.includes('triumph') || mood.includes('relief')) {
    return 'positive';
  }

  // Negative
  if (mood.includes('sad') || mood.includes('grief') || mood.includes('fear') || mood.includes('anger') ||
      mood.includes('rage') || mood.includes('despair') || mood.includes('terror') || mood.includes('disgust')) {
    return 'negative';
  }

  // Ambiguous/mixed
  return 'ambiguous';
}

/**
 * Extract scene context for visual generation
 */
export function extractSceneContext(
  scene: SceneContent,
  sceneIndex: number,
  totalScenes: number,
  worldBible: WorldBible
): {
  isClimactic: boolean;
  isResolution: boolean;
  isFlashback: boolean;
  isNightmare: boolean;
  isSafeHubScene: boolean;
  branchType: 'dark' | 'hopeful' | 'neutral';
  timeOfDay?: 'dawn' | 'day' | 'dusk' | 'night';
} {
  const sceneName = (scene.sceneName || '').toLowerCase();
  const keyMoments = (Array.isArray(scene.keyMoments) ? scene.keyMoments : []).join(' ').toLowerCase();
  const moodProg = (Array.isArray(scene.moodProgression) ? scene.moodProgression : []).join(' ').toLowerCase();

  // Determine if climactic (near end, contains confrontation/climax keywords)
  const isNearEnd = sceneIndex >= totalScenes - 2;
  const hasClimaxKeywords = keyMoments.includes('climax') || keyMoments.includes('confrontation') ||
                            keyMoments.includes('showdown') || keyMoments.includes('final');
  const isClimactic = isNearEnd && hasClimaxKeywords;

  // Resolution (last scene, contains resolution keywords)
  const isResolution = sceneIndex === totalScenes - 1 &&
                       (keyMoments.includes('resolution') || keyMoments.includes('aftermath') || keyMoments.includes('conclude'));

  // Flashback/nightmare detection
  const isFlashback = sceneName.includes('flashback') || sceneName.includes('memory') || keyMoments.includes('past');
  const isNightmare = sceneName.includes('nightmare') || sceneName.includes('dream') || keyMoments.includes('nightmare');

  // Safe hub (calm base scenes)
  const isSafeHubScene = moodProg.includes('calm') || moodProg.includes('safe') ||
                         sceneName.includes('base') || sceneName.includes('home') || sceneName.includes('haven');

  // Branch type inference (would normally come from player state)
  let branchType: 'dark' | 'hopeful' | 'neutral' = 'neutral';
  if (moodProg.includes('dark') || moodProg.includes('despair') || moodProg.includes('corrupt')) {
    branchType = 'dark';
  } else if (moodProg.includes('hope') || moodProg.includes('redemption') || moodProg.includes('light')) {
    branchType = 'hopeful';
  }

  // Time of day inference
  let timeOfDay: 'dawn' | 'day' | 'dusk' | 'night' | undefined;
  if (sceneName.includes('dawn') || sceneName.includes('morning') || keyMoments.includes('sunrise')) {
    timeOfDay = 'dawn';
  } else if (sceneName.includes('night') || sceneName.includes('midnight') || keyMoments.includes('dark')) {
    timeOfDay = 'night';
  } else if (sceneName.includes('dusk') || sceneName.includes('sunset') || sceneName.includes('evening')) {
    timeOfDay = 'dusk';
  } else if (sceneName.includes('day') || sceneName.includes('noon') || sceneName.includes('afternoon')) {
    timeOfDay = 'day';
  }

  return { isClimactic, isResolution, isFlashback, isNightmare, isSafeHubScene, branchType, timeOfDay };
}

/**
 * Map choice sets to choice positions for visual planning
 */
export function mapChoicePositions(
  choiceSets: ChoiceSet[],
  scene: SceneContent
): Array<{
  beatId: string;
  choiceType: 'binary' | 'multiple' | 'timed';
  options?: Array<{ type: 'trust' | 'suspicion' | 'action' | 'caution' | 'kindness' | 'cruelty' | 'other'; label?: string }>;
}> {
  const positions: Array<{
    beatId: string;
    choiceType: 'binary' | 'multiple' | 'timed';
    options?: Array<{ type: 'trust' | 'suspicion' | 'action' | 'caution' | 'kindness' | 'cruelty' | 'other'; label?: string }>;
  }> = [];

  for (const choiceSet of choiceSets) {
    // Only include choices that belong to beats in this scene
    const belongsToScene = scene.beats.some(b => b.id === choiceSet.beatId);
    if (!belongsToScene) continue;

    const choiceCount = choiceSet.choices.length;
    const choiceType: 'binary' | 'multiple' | 'timed' = choiceCount === 2 ? 'binary' : 'multiple';

    positions.push({
      beatId: choiceSet.beatId,
      choiceType,
      options: choiceSet.choices.map(c => ({
        type: inferChoiceType(c.text),
        label: c.text.substring(0, TEXT_LIMITS.shortPreviewLength)
      }))
    });
  }

  return positions;
}

/**
 * Infer choice type from text
 */
export function inferChoiceType(choiceText: string): 'trust' | 'suspicion' | 'action' | 'caution' | 'kindness' | 'cruelty' | 'other' {
  const text = choiceText.toLowerCase();

  if (text.includes('trust') || text.includes('believe') || text.includes('faith')) return 'trust';
  if (text.includes('suspic') || text.includes('doubt') || text.includes('question')) return 'suspicion';
  if (text.includes('attack') || text.includes('fight') || text.includes('confront')) return 'action';
  if (text.includes('wait') || text.includes('careful') || text.includes('cautious')) return 'caution';
  if (text.includes('help') || text.includes('kind') || text.includes('compassion')) return 'kindness';
  if (text.includes('cruel') || text.includes('harsh') || text.includes('punish')) return 'cruelty';

  return 'other';
}

/**
 * Get location info from world bible for a scene
 */
export function resolveWorldLocationForScene(
  sceneBlueprint: Pick<SceneBlueprint, 'location' | 'name' | 'description'>,
  worldBible: WorldBible
) {
  const authoredLocation = (sceneBlueprint.location || '').trim().toLowerCase();
  if (authoredLocation) {
    const exactIdMatch = worldBible.locations.find((loc) => loc.id.toLowerCase() === authoredLocation);
    if (exactIdMatch) return exactIdMatch;
    const exactNameMatch = worldBible.locations.find((loc) => loc.name.toLowerCase() === authoredLocation);
    if (exactNameMatch) return exactNameMatch;
    const partialNameMatch = worldBible.locations.find((loc) => loc.name.toLowerCase().includes(authoredLocation) || authoredLocation.includes(loc.name.toLowerCase()));
    if (partialNameMatch) return partialNameMatch;
  }

  const sceneText = `${sceneBlueprint.name} ${sceneBlueprint.description || ''}`.toLowerCase();
  const heuristicMatch = worldBible.locations.find((loc) => {
    const locName = loc.name.toLowerCase();
    return sceneText.includes(locName) || locName.includes(sceneText.split(' ')[0] || '');
  });
  return heuristicMatch || worldBible.locations[0];
}
