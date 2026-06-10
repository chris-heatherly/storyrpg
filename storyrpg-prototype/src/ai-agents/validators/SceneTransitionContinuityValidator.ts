/**
 * Scene-Transition Continuity Validator (2026-06-09 storytelling-quality audit —
 * the "unmanaged passage of time / location change" defect class).
 *
 * The audited g10 runs shipped hard cuts the reader cannot follow: bite-me-g10
 * s1-3 ends in a bookshop in the afternoon and s1-4 opens "Four in the morning
 * and you are still in your coat" on a rooftop — ~8 unexplained hours and a
 * location change with no transition prose. No validator looked at the seam
 * between adjacent scenes, so both runs shipped QA-passing at band `ship`.
 *
 * The generation-side fix gives every blueprint scene a planned `timeOfDay` /
 * `timeJumpFromPrevious` (sceneTimeline util) and persists them on the
 * assembled `Scene.timeline` together with the writer's `transitionIn` phrase.
 * This validator is the deterministic backstop over that metadata: for every
 * scene-graph edge prev → next INSIDE an episode where the planned location or
 * time-of-day changes, the arriving scene must acknowledge the shift —
 * a non-empty `timeline.transitionIn`, OR temporal/movement language in its
 * opening prose. Episode boundaries are skipped (an episode opener
 * legitimately re-establishes time and place from scratch).
 *
 * Scenes with no `timeline` metadata (legacy stories, pre-fix runs) are
 * skipped entirely — the validator only asserts against what was planned.
 *
 * An encounter scene with NO prose at all on a changed-time/place edge gets a
 * dedicated finding: an empty encounter scaffold sitting exactly where a jump
 * happens is the worst version of the defect (the g10 pattern).
 *
 * Pure, deterministic, generator-internal. Registration is DEFAULT-OFF behind
 * `GATE_SCENE_TRANSITION_CONTINUITY`, dispatched from {@link runFidelityValidators};
 * per the gate-promotion discipline it ships advisory until one live `=1` run
 * confirms the false-positive profile.
 */

import { BaseValidator, ValidationIssue, ValidationResult } from './BaseValidator';
import type { Beat } from '../../types/content';
import type { Episode, Scene, Story } from '../../types/story';

/**
 * Opening-prose markers that count as acknowledging a time/place shift.
 * Deliberately broad — the validator should only fire when the opening shows
 * NO sign of transition at all, not police phrasing style.
 */
const TRANSITION_MARKERS = new RegExp(
  [
    // explicit time passage
    'later', 'by the time', 'next (morning|day|night|evening)', 'the following',
    'hours? (pass|later|after)', 'that (night|evening|morning|afternoon)',
    'after (the|that|a)\\b', 'since (then|the)', 'by (dawn|dusk|nightfall|morning|noon|midnight)',
    'come (morning|nightfall|dawn)', 'days? (later|pass)', '\\bnow\\b.*\\b(hours|days)\\b',
    // time-of-day grounding in the opening
    '\\b(dawn|sunrise|daybreak|morning|noon|midday|afternoon|dusk|sunset|twilight|evening|night|midnight)\\b',
    '\\d{1,2}\\s?(a\\.?m\\.?|p\\.?m\\.?|o.clock)',
    // movement / arrival
    'you (arrive|reach|step (into|out|onto)|enter|leave|cross|climb|walk|ride|drive|return|make your way|find yourself)',
    'back (at|in|to)\\b', 'on the way', 'the (walk|ride|drive|journey|road) (to|back|home)',
    'across (town|the city)', 'outside\\b', 'halfway (to|across)',
  ].join('|'),
  'i',
);

/** The first reader-facing prose of a scene (first non-empty beat, or encounter setup). */
function openingProse(scene: Scene): string {
  for (const beat of scene.beats || []) {
    const text = String((beat as Beat).text || '').trim();
    if (text) return text;
  }
  // Encounter scenes carry their prose inside scene.encounter, not scene.beats.
  const enc = scene.encounter as
    | { setupText?: string; phases?: Array<{ beats?: Array<{ text?: string; setupText?: string }> }> }
    | undefined;
  if (enc) {
    if (String(enc.setupText || '').trim()) return String(enc.setupText).trim();
    for (const phase of enc.phases || []) {
      for (const b of phase.beats || []) {
        const text = String(b.text || b.setupText || '').trim();
        if (text) return text;
      }
    }
  }
  return '';
}

/** True when the arriving scene acknowledges the shift. */
function acknowledgesTransition(scene: Scene): boolean {
  if (String(scene.timeline?.transitionIn || '').trim()) return true;
  const opening = openingProse(scene);
  if (!opening) return false;
  // Only the opening stretch counts — a marker buried five beats in does not
  // help the reader at the cut.
  return TRANSITION_MARKERS.test(opening.slice(0, 400));
}

const norm = (s: string | undefined): string =>
  String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

export interface SceneTransitionContinuityInput {
  story: Story;
}

export class SceneTransitionContinuityValidator extends BaseValidator {
  constructor() {
    super('SceneTransitionContinuityValidator');
  }

  /**
   * Walk every intra-episode scene-graph edge; where the planned location or
   * time-of-day changes, the arriving scene must acknowledge the shift.
   */
  validate(input: SceneTransitionContinuityInput): ValidationResult {
    const issues: ValidationIssue[] = [];

    for (const episode of input.story.episodes || []) {
      const byId = new Map<string, Scene>();
      for (const scene of episode.scenes || []) byId.set(scene.id, scene);

      for (const from of episode.scenes || []) {
        const fromMeta = from.timeline;
        if (!fromMeta) continue;
        for (const targetId of from.leadsTo || []) {
          const to = byId.get(targetId);
          const toMeta = to?.timeline;
          if (!to || !toMeta) continue;

          const locationChanged = Boolean(
            norm(fromMeta.location) && norm(toMeta.location)
            && norm(fromMeta.location) !== norm(toMeta.location),
          );
          const timeChanged = Boolean(
            fromMeta.timeOfDay && toMeta.timeOfDay && fromMeta.timeOfDay !== toMeta.timeOfDay,
          );
          if (!locationChanged && !timeChanged) continue;

          const shift = [
            locationChanged ? `location ${fromMeta.location} → ${toMeta.location}` : '',
            timeChanged ? `time ${fromMeta.timeOfDay} → ${toMeta.timeOfDay}` : '',
          ].filter(Boolean).join(', ');
          const where = `transition:ep${episode.number}:${from.id}->${to.id}`;

          if (!openingProse(to)) {
            issues.push(this.error(
              `Scene "${to.id}" (episode ${episode.number}) follows a planned shift (${shift}) but carries NO opening prose at all to bridge it — the reader gets a hard cut with nothing on-page.`,
              where,
              'Give the scene (or its encounter setup) opening prose that grounds the new time/place and how the protagonist got there.',
            ));
            continue;
          }

          if (!acknowledgesTransition(to)) {
            issues.push(this.error(
              `Unacknowledged ${timeChanged && locationChanged ? 'time-and-place' : timeChanged ? 'time' : 'location'} jump into scene "${to.id}" (episode ${episode.number}): planned shift (${shift}) but the scene has no transitionIn and its opening prose carries no transition or arrival language. The reader cannot follow how the story moved.`,
              where,
              'Add a transitionIn phrase and let the opening beat acknowledge the jump — name the new time/place and how (or why) the protagonist is now here.',
            ));
          }
        }
      }
    }

    const errors = issues.filter((i) => i.severity === 'error').length;
    const score = Math.max(0, 100 - errors * 10 - (issues.length - errors) * 2);
    return {
      valid: errors === 0,
      score,
      issues,
      suggestions: issues.map((i) => i.suggestion).filter((s): s is string => Boolean(s)),
    };
  }
}
