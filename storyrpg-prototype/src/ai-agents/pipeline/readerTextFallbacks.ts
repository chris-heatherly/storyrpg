/**
 * Reader-text fallbacks and sanitization (pure move from FullStoryPipeline).
 *
 * Single responsibility: never ship agent-facing planning register, placeholder
 * stakes, or stub text to the reader. Provides the deterministic fallback
 * choice-set builders used when ChoiceAuthor fails, and the sanitizers that
 * scrub agent-facing fidelity text out of reader-facing prose fields.
 */

import type { SceneBlueprint } from '../agents/StoryArchitect';
import type { GeneratedBeat, SceneContent } from '../agents/SceneWriter';
import type { ChoiceSet } from '../agents/ChoiceAuthor';
import type { ChoiceImpactFactor } from '../../types/choice';
import { isPlaceholderStake } from '../constants/placeholderStakes';
import { isPlanningRegisterText } from '../constants/planningRegisterText';
import {
  buildReaderFacingFallbackChoiceOptions,
  routeFallbackChoicesAcrossTargets,
} from './choiceAssembly';

export function ensureSentence(text: string): string {
  const trimmed = String(text || '').trim();
  if (!trimmed) return 'The pressure changes shape.';
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

/** Registered placeholder when beat prose is planning register — final contract blocks and routes LLM re-author. */
export const BEAT_PROSE_NEEDS_REAUTHOR_PLACEHOLDER =
  'The moment still needs authored prose before it can continue.';

const AGENT_FACING_FIDELITY_PATTERNS: RegExp[] = [
  /\bserves\s+the\s+\w+\s+beat\b/i,
  /\bforward\s+pressure\s*:/i,
  /\bcomposed surface slips through a small evasive movement\b/i,
  /\bsmall evasive movement\b/i,
  /\bmaking the subtext visible\b/i,
  /\bposture, glance, and distance make the unspoken tension visible\b/i,
  /\bvisibly changing the balance of the moment\b/i,
  /\bbusy hands betray what the words avoid\b/i,
  /\bvisible gesture, object cue, or shift in distance\b/i,
];

function matchesAgentFacingFidelityPatterns(cleaned: string): boolean {
  return AGENT_FACING_FIDELITY_PATTERNS.some((pattern) => pattern.test(cleaned));
}

/** Planning register / agent scaffolding in reader prose — no length cap (beat prose may exceed 240 chars). */
export function isPlanningRegisterProse(text: string | undefined): boolean {
  const cleaned = String(text || '').trim();
  if (!cleaned) return true;
  return isPlanningRegisterText(cleaned)
    || isPlaceholderStake(cleaned)
    || matchesAgentFacingFidelityPatterns(cleaned);
}

/** Vet short fallback *candidates* (stakes, echo lines) — length cap applies here only. */
export function isUnsafeReaderFallbackCandidate(text: string | undefined): boolean {
  const cleaned = String(text || '').trim();
  if (!cleaned) return true;
  return isPlanningRegisterProse(cleaned) || cleaned.length > 240;
}

/** @deprecated Prefer {@link isUnsafeReaderFallbackCandidate} for fallbacks or {@link isPlanningRegisterProse} for beat prose. */
export function isUnsafeReaderFallbackText(text: string | undefined): boolean {
  return isUnsafeReaderFallbackCandidate(text);
}

function stripPressurePrefixedParagraphs(text: string): string {
  return String(text || '')
    .split(/\n{2,}|\r?\n/)
    .map((part) => part.trim())
    .filter((part) => part && !/^(?:pressure|choice pressure|forward pressure):/i.test(part))
    .join('\n\n')
    .trim();
}

export function safeFallbackReaderText(text: string | undefined, fallback: string, lastResort?: string): string {
  const cleaned = String(text || '').trim();
  if (!cleaned || isUnsafeReaderFallbackText(cleaned)) {
    const fallbackText = String(fallback || '').trim();
    if (fallbackText && !isUnsafeReaderFallbackText(fallbackText)) {
      return ensureSentence(fallbackText);
    }
    return ensureSentence(lastResort || 'The choice leaves visible residue in the scene.');
  }
  return ensureSentence(cleaned);
}

export function fallbackTintFlag(choiceType: string, index: number): string {
  if (choiceType === 'expression') return index % 2 === 0 ? 'tint:emotion' : 'tint:intuition';
  if (choiceType === 'relationship') return index % 2 === 0 ? 'tint:teamwork' : 'tint:empathy';
  if (choiceType === 'strategic') return index % 2 === 0 ? 'tint:pragmatism' : 'tint:intuition';
  return index % 2 === 0 ? 'tint:sacrifice' : 'tint:caution';
}

export function fallbackReactionText(choiceText: string): string {
  return `${ensureSentence(choiceText)} The choice changes the room's next silence.`;
}

export function fallbackOutcomeTexts(choiceText: string): { success: string; partial: string; failure: string } {
  const sentence = ensureSentence(choiceText);
  return {
    success: `${sentence} The moment yields a clearer emotional footing.`,
    partial: `${sentence} The moment shifts, but the uncertainty stays close.`,
    failure: `${sentence} The hesitation leaves a visible complication behind.`,
  };
}

export function fallbackResidueDescription(choiceText: string): string {
  return `${ensureSentence(choiceText)} The scene should echo this as an immediate tonal residue.`;
}

export function stripAgentFacingFidelityText(text: string, fallback: string): string {
  const cleaned = stripPressurePrefixedParagraphs(text);
  if (!cleaned || isUnsafeReaderFallbackCandidate(cleaned)) {
    return ensureSentence(fallback || 'The story pressure changes what can happen next.');
  }
  return cleaned;
}

/** Sanitize beat prose for the reader — never substitute blueprint descriptions; preserve long LLM prose. */
export function stripBeatProseForReader(text: string): string {
  const cleaned = stripPressurePrefixedParagraphs(text);
  if (!cleaned || isPlanningRegisterProse(cleaned)) {
    return ensureSentence(BEAT_PROSE_NEEDS_REAUTHOR_PLACEHOLDER);
  }
  return cleaned;
}

export function createFallbackChoiceSet(
  sceneBlueprint: SceneBlueprint,
  choiceBeat: GeneratedBeat
): ChoiceSet {
  const choicePoint = sceneBlueprint.choicePoint;
  const optionHints = (choicePoint?.optionHints || [])
    .map((hint) => String(hint || '').trim())
    .filter(Boolean);
  const options = buildReaderFacingFallbackChoiceOptions({
    optionHints,
    localContext: [
      ...(sceneBlueprint.requiredBeats || []).flatMap((beat: { sourceTurn?: string; mustDepict?: string }) => [
        beat.sourceTurn,
        beat.mustDepict,
      ]).filter((text): text is string => typeof text === 'string' && text.trim().length > 0),
    ],
    choicePointDescription: choicePoint?.description,
    choiceBeatText: choiceBeat.text,
    choiceBeatVisualMoment: choiceBeat.visualMoment,
    sceneName: sceneBlueprint.name,
    dramaticQuestion: sceneBlueprint.dramaticQuestion,
    dramaticPurpose: sceneBlueprint.dramaticPurpose,
    conflictEngine: sceneBlueprint.conflictEngine,
  });
  const rawStakes = choicePoint?.stakes;
  const stakes = {
    want: safeFallbackReaderText(
      rawStakes?.want,
      sceneBlueprint.dramaticQuestion || sceneBlueprint.dramaticPurpose || 'Change what can happen next.',
      'Change what can happen next.'
    ),
    cost: safeFallbackReaderText(
      rawStakes?.cost,
      sceneBlueprint.conflictEngine || 'The choice gives up one kind of safety to claim another.',
      'The choice gives up one kind of safety to claim another.'
    ),
    identity: safeFallbackReaderText(
      rawStakes?.identity,
      sceneBlueprint.wantVsNeed || 'The choice reveals what the protagonist is becoming under pressure.',
      'The choice reveals what the protagonist is becoming under pressure.'
    ),
  };
  const choiceType = choicePoint?.type || 'dilemma';
  const consequenceTier = 'sceneTint' as const;
  const impactFactors =
    choiceType === 'expression' ? [] :
    choiceType === 'relationship' ? ['relationship', 'identity'] :
    choiceType === 'strategic' ? ['information', 'process'] :
    ['identity', 'relationship'];
  const choiceIntent = choiceType === 'expression' ? 'flavor' : choiceType === 'dilemma' ? 'dilemma' : 'blind';
  const storyVerb = choiceType === 'relationship' ? 'protect' : choiceType === 'strategic' ? 'observe' : 'commit';
  const immediateReminder = safeFallbackReaderText(
    choicePoint?.reminderPlan?.immediate || choicePoint?.description,
    'The decision changes the tone of the scene.'
  );

  return {
    beatId: choiceBeat.id,
    sceneId: sceneBlueprint.id,
    choiceType,
    overallStakes: stakes,
    overallStakesLayers: choicePoint?.stakesLayers || sceneBlueprint.stakesLayers,
    designNotes: 'Deterministic fallback: preserves authored choice pressure when ChoiceAuthor does not produce a usable choice set.',
    choices: options.map((text, index) => {
      const tintFlag = fallbackTintFlag(choiceType, index);
      return {
        id: `${choiceBeat.id}-fallback-choice-${index + 1}`,
        text: ensureSentence(text),
        choiceType,
        choiceIntent,
        impactFactors,
        consequenceTier,
        storyVerb,
        reactionText: fallbackReactionText(text),
        tintFlag,
        outcomeTexts: fallbackOutcomeTexts(text),
        residueHints: [{
          kind: 'immediate_prose_echo' as const,
          description: fallbackResidueDescription(text),
        }],
        stakes,
        stakesLayers: choicePoint?.stakesLayers || sceneBlueprint.stakesLayers,
        stakesAnnotation: stakes,
        consequenceDomain: choicePoint?.consequenceDomain || 'identity',
        consequences: [{ type: 'setFlag' as const, flag: tintFlag, value: true }],
        reminderPlan: choicePoint?.reminderPlan || {
          immediate: immediateReminder,
          shortTerm: stripAgentFacingFidelityText(
            sceneBlueprint.narrativeFunction || '',
            'The residue carries into the next scene.'
          ),
        },
        feedbackCue: {
          echoSummary: `You chose: ${ensureSentence(text)}`,
          progressSummary: stripAgentFacingFidelityText(
            choicePoint?.reminderPlan?.immediate || sceneBlueprint.narrativeFunction || '',
            'The choice leaves visible residue.'
          ),
        },
        expectedResidue: choicePoint?.expectedResidue,
      };
    }),
  } as ChoiceSet;
}

/**
 * Last-resort fallback for a choiceless BRANCH POINT. Reuses the deterministic
 * choice-set builder, then routes ≥1 choice to EACH distinct `leadsTo` target so the
 * planned branch is structurally realized (satisfying GATE_BRANCH_FANOUT) instead of
 * hard-aborting the episode when ChoiceAuthor fails. Returns undefined for non-branch
 * scenes (leadsTo < 2 distinct), where a choiceless scene is survivable on its own.
 */
export function buildBranchFallbackChoiceSet(
  sceneBlueprint: SceneBlueprint,
  choiceBeat: GeneratedBeat | undefined,
): ChoiceSet | undefined {
  if (!choiceBeat) return undefined;
  const targets = [...new Set((sceneBlueprint.leadsTo || []).filter(Boolean))];
  if (targets.length < 2) return undefined; // only branch points need this net

  const base = createFallbackChoiceSet(sceneBlueprint, choiceBeat);
  // Pad to cover every target and route round-robin so each leadsTo target is reached.
  const choices = routeFallbackChoicesAcrossTargets(base.choices, targets, choiceBeat.id).map((choice) => ({
    ...choice,
    choiceIntent: 'branching' as const,
    consequenceTier: 'structuralBranch' as const,
    impactFactors: Array.from(new Set<ChoiceImpactFactor>([...(choice.impactFactors || []), 'outcome'])),
  }));
  return {
    ...base,
    choices,
    designNotes:
      `${base.designNotes} Routed across leadsTo targets [${targets.join(', ')}] to preserve the ` +
      'planned branch after ChoiceAuthor failed for this branch point.',
  };
}

export function sanitizeSceneContentForReader(sceneBlueprint: SceneBlueprint, content: SceneContent): void {
  if (!Array.isArray(content.beats)) return;
  for (const beat of content.beats) {
    const sceneFallback = sceneBlueprint.description || sceneBlueprint.dramaticQuestion || sceneBlueprint.name || 'The story pressure changes.';
    beat.text = stripBeatProseForReader(beat.text);
    beat.visualMoment = stripAgentFacingFidelityText(
      beat.visualMoment || beat.text,
      beat.text || sceneFallback
    );
    beat.primaryAction = stripAgentFacingFidelityText(
      beat.primaryAction || beat.text,
      beat.text || sceneFallback
    );
    beat.emotionalRead = stripAgentFacingFidelityText(
      beat.emotionalRead || '',
      'The protagonist absorbs the consequence.'
    );
    beat.relationshipDynamic = stripAgentFacingFidelityText(
      beat.relationshipDynamic || '',
      sceneBlueprint.npcsPresent?.length
        ? 'The relationship pressure changes.'
        : 'The situation pressure changes.'
    );
  }
}

export function sanitizeReaderFacingSceneName(name: string | undefined, fallback = 'the next scene'): string {
  const cleaned = String(name || fallback)
    .replace(/\s*\((?:[^)]*\b(?:ENCOUNTER|Episode\s+Climax|Buildup|Setup|Transition|Bridge)\b[^)]*)\)\s*/gi, ' ')
    .replace(/\s*\[(?:[^\]]*\b(?:ENCOUNTER|Episode\s+Climax|Buildup|Setup|Transition|Bridge)\b[^\]]*)\]\s*/gi, ' ')
    .replace(/\s+-\s*(?:ENCOUNTER|Episode\s+Climax|Buildup|Setup|Transition|Bridge)\b.*$/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned || fallback;
}

export function cleanChoiceBridgeFragment(value: string | undefined): string {
  return sanitizeReaderFacingSceneName(value || '', '')
    .replace(/\bThe decision carries you\b.*$/i, '')
    .replace(/\bone concrete step at a time\b\.?/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function ensureBlueprintFidelityText(sceneBlueprint: SceneBlueprint, content: SceneContent): void {
  const importantBeats = (sceneBlueprint.keyBeats || [])
    .map((beat) => (beat || '').trim())
    .filter((beat) => /^(?:pressure|choice pressure|forward pressure):/i.test(beat));
  if (importantBeats.length === 0) return;

  content.continuityNotes = Array.isArray(content.continuityNotes) ? content.continuityNotes : [];
  for (const importantBeat of importantBeats) {
    const note = `Agent-facing fidelity pressure preserved outside reader prose: ${importantBeat}`;
    if (!content.continuityNotes.includes(note)) {
      content.continuityNotes.push(note);
    }
  }

  if (!content.startingBeatId && content.beats?.[0]) {
    content.startingBeatId = content.beats[0].id;
  }
}

/** Normalize planning strings for verbatim-leak comparison. */
export function normalizePlanningTextForCompare(text: string | undefined): string {
  return String(text || '')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[.!?]+$/g, '')
    .toLowerCase();
}

/** Collect agent-facing strings from a scene blueprint that must never ship as beat.text verbatim. */
export function collectSceneBlueprintPlanningStrings(sceneBlueprint: SceneBlueprint): string[] {
  const out: string[] = [];
  const push = (value: string | undefined) => {
    const trimmed = String(value || '').trim();
    if (trimmed.length >= 24) out.push(trimmed);
  };
  push(sceneBlueprint.description);
  push(sceneBlueprint.dramaticQuestion);
  push(sceneBlueprint.dramaticPurpose);
  push(sceneBlueprint.narrativeFunction);
  push(sceneBlueprint.conflictEngine);
  push(sceneBlueprint.wantVsNeed);
  push(sceneBlueprint.turnContract?.centralTurn);
  push(sceneBlueprint.turnContract?.turnEvent);
  push(sceneBlueprint.turnContract?.handoff);
  for (const beat of sceneBlueprint.keyBeats ?? []) push(beat);
  for (const beat of sceneBlueprint.requiredBeats ?? []) {
    push(beat.mustDepict);
    push(beat.sourceTurn);
  }
  return out;
}

export function beatTextMatchesBlueprintPlanning(
  beatText: string | undefined,
  sceneBlueprint: SceneBlueprint,
): string | undefined {
  const normalizedBeat = normalizePlanningTextForCompare(beatText);
  if (!normalizedBeat || normalizedBeat.length < 24) return undefined;
  for (const candidate of collectSceneBlueprintPlanningStrings(sceneBlueprint)) {
    const normalizedCandidate = normalizePlanningTextForCompare(candidate);
    if (!normalizedCandidate) continue;
    if (normalizedBeat === normalizedCandidate) return candidate;
    if (
      normalizedBeat.length >= 40
      && normalizedCandidate.length >= 40
      && (normalizedBeat.includes(normalizedCandidate) || normalizedCandidate.includes(normalizedBeat))
    ) {
      return candidate;
    }
  }
  return undefined;
}
