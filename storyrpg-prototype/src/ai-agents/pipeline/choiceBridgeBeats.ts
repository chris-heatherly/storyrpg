/**
 * Choice-bridge beat synthesis (pure move from FullStoryPipeline).
 *
 * Single responsibility: every choice that routes to another scene gets a
 * reader-facing bridge beat so the decision visibly turns into motion instead
 * of teleporting the player. Bridge text prefers the authored in-fiction
 * fragment and falls back to a deterministic generic line (rotation keyed on
 * choice id) only as a last resort.
 */

import type { EpisodeBlueprint, SceneBlueprint } from '../agents/StoryArchitect';
import type { GeneratedBeat, SceneContent } from '../agents/SceneWriter';
import type { ChoiceSet } from '../agents/ChoiceAuthor';
import { isUnsafeCallbackProse } from '../constants/metaProse';
import { cleanChoiceBridgeFragment, sanitizeReaderFacingSceneName } from './readerTextFallbacks';

export function ensureChoiceBridgeBeats(
  blueprint: EpisodeBlueprint,
  sceneBlueprint: SceneBlueprint,
  content: SceneContent,
  choiceMap: Map<string, ChoiceSet>,
): void {
  for (const beat of content.beats || []) {
    if (!beat.isChoicePoint) continue;
    const choiceSet = choiceMap.get(`${sceneBlueprint.id}::${beat.id}`) || choiceMap.get(beat.id);
    if (!choiceSet) continue;

    for (const choice of choiceSet.choices || []) {
      const targetSceneId = choice.nextSceneId;
      if (!targetSceneId) continue;

      const targetScene = blueprint.scenes.find(scene => scene.id === targetSceneId);
      const bridgeId = `${beat.id}-bridge-${String(choice.id || 'choice')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '') || 'choice'}`;

      const readerTargetName = sanitizeReaderFacingSceneName(targetScene?.name || targetSceneId, targetSceneId);
      const originalTargetBeat = choice.nextBeatId
        ? content.beats.find(candidate => candidate.id === choice.nextBeatId)
        : undefined;
      const originalTargetBeatId = originalTargetBeat?.isChoiceBridge ? undefined : choice.nextBeatId;

      const routeContext = {
        sourceSceneId: sceneBlueprint.id,
        sourceBeatId: beat.id,
        sourceChoiceId: choice.id,
        choiceSummary: choice.feedbackCue?.echoSummary || choice.text,
        originalTargetSceneId: targetSceneId,
        originalTargetBeatId,
        transitionIntent: `Bridge from "${sanitizeReaderFacingSceneName(sceneBlueprint.name)}" to "${readerTargetName}" without teleporting the player.`,
        bridgePurpose: 'choice_transition',
      };

      choice.routeContext = routeContext;
      choice.nextBeatId = bridgeId;

      const existingBridge = content.beats.find(candidate => candidate.id === bridgeId);
      if (existingBridge) {
        existingBridge.nextSceneId = targetSceneId;
        existingBridge.nextBeatId = originalTargetBeatId;
        existingBridge.isChoiceBridge = true;
        existingBridge.routeContext = routeContext;
        continue;
      }

      const bridgeText = buildChoiceBridgeBeatText(choice);
      content.beats.push({
        id: bridgeId,
        text: bridgeText,
        nextSceneId: targetSceneId,
        nextBeatId: originalTargetBeatId,
        isChoiceBridge: true,
        routeContext,
        visualMoment: bridgeText,
        primaryAction: bridgeText,
        emotionalRead: 'the chosen decision visibly turns into motion',
        relationshipDynamic: 'the decision changes posture, pace, or distance before the moment moves on',
        mustShowDetail: targetScene?.location
          ? `a concrete transition toward ${targetScene.location}`
          : 'a concrete transition from decision into action',
        intensityTier: 'supporting',
        sequenceIntent: {
          objective: 'Let the decision become visible movement without a jump in place or relationship.',
          activity: 'decision, movement, and arrival',
          obstacle: 'the decision needs a visible breath before the moment moves on',
          startState: choice.feedbackCue?.echoSummary || choice.text,
          endState: targetScene ? `The decision has enough momentum to carry the moment onward.` : 'The decision has enough momentum to carry forward.',
          beatRole: 'handoff',
          mechanicThread: choice.consequenceDomain || choice.choiceIntent,
        },
      } as GeneratedBeat);
    }
  }
}

export function buildChoiceBridgeBeatText(choice: ChoiceSet['choices'][number]): string {
  const rawImmediate = cleanChoiceBridgeFragment(
    choice.outcomeTexts?.partial
    || choice.reactionText
    || choice.feedbackCue?.progressSummary
    || choice.reminderPlan?.immediate
  );
  // The lead fragment is sourced from planning fields; reject any meta/design-note
  // register ("In the next scene…", raw flag ids) rather than leak it to readers.
  const immediate = rawImmediate && !isUnsafeCallbackProse(rawImmediate) && !isGenericChoiceBridgeFragment(rawImmediate)
    ? rawImmediate
    : '';
  // Prefer the authored in-fiction fragment ALONE. The generic line was previously
  // APPENDED to every bridge, producing robotic structural closers ("The path forward
  // is set.") on top of real prose (gen-5 audit) — it is now a last-resort fallback.
  const lead = immediate || genericBridgeDestination(choice.id);
  const trimmed = lead.trim();
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

export function isGenericChoiceBridgeFragment(text: string): boolean {
  const normalized = text.trim().toLowerCase().replace(/\s+/g, ' ');
  return [
    'the choice leaves a visible pressure in the next moment.',
    'the choice leaves a visible pressure in the next moment',
    'in the next room, access, trust, and pressure have already shifted.',
    'in the next room, access, trust, and pressure have already shifted',
    'people remember what the protagonist risked, and they treat the next ask differently.',
    'people remember what the protagonist risked, and they treat the next ask differently',
    'what comes next is already in motion.',
    'what comes next is already in motion',
    'there is no stepping back from here.',
    'there is no stepping back from here',
    'the decision settles into your chest and stays there.',
    'the decision settles into your chest and stays there',
    'the choice changes the air around you.',
    'the choice changes the air around you',
  ].includes(normalized);
}

/**
 * Deterministic generic in-fiction line for a choice bridge with no authored
 * fragment. In-world register (no "path/threshold/forward is set" scaffolding, no
 * scene names); rotation keyed on the choice id avoids identical consecutive lines.
 */
export function genericBridgeDestination(choiceId: string | undefined): string {
  const options = [
    'What comes next is already in motion.',
    'There is no stepping back from here.',
    'The decision settles into your chest and stays there.',
    'The choice changes the air around you.',
  ];
  const key = String(choiceId || '');
  let hash = 0;
  for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  return options[hash % options.length];
}
