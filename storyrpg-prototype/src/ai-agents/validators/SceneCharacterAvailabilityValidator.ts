/**
 * Scene-Character Availability Validator (2026-07-03 — the "vampire on an
 * afternoon house call" defect class).
 *
 * bite-me 2026-07-03 staged Mika (a daylight-bound supernatural, per the world
 * bible rule "strigoi burn in direct sunlight") arriving at the protagonist's
 * apartment in "weak afternoon light". The rule existed; nothing enforced it:
 * the character's nature was prose-only and no validator compared a scene's
 * time-of-day against who is present in it.
 *
 * This validator is deterministic and data-driven: it only fires for
 * characters that carry structured `timeOfDayConstraints` (persisted from the
 * CharacterBible onto `Story.npcs`). For each scene the effective time-of-day
 * is the planned `timeline.timeOfDay`, falling back to time markers in the
 * scene's own prose ("weak afternoon light") — so an unplanned clock cannot
 * hide a violation. A constrained character counts as PRESENT only when the
 * scene prose names them (metadata-only cast entries are a different defect
 * class); text-only presence (a text message, a call) does not fire.
 *
 * Gate: GATE_SCENE_CHARACTER_AVAILABILITY (default OFF — needs a live
 * shadow run before promotion, per validator-gating convention).
 */

import { BaseValidator, ValidationIssue, ValidationResult } from './BaseValidator';
import type { Beat } from '../../types/content';
import type { Scene, Story } from '../../types/story';
import { inferTimeOfDayFromText, normalizeTimeOfDay, type SceneTimeOfDay } from '../utils/sceneTimeline';

interface ConstrainedNpc {
  id: string;
  name: string;
  species?: string;
  unavailable: Set<string>;
  reason?: string;
}

function sceneProse(scene: Scene): string {
  const parts: string[] = [];
  for (const beat of scene.beats || []) {
    const b = beat as Beat;
    parts.push(String(b.text || ''));
    for (const variant of b.textVariants || []) parts.push(String(variant?.text || ''));
  }
  const enc = scene.encounter as
    | { phases?: Array<{ beats?: Array<{ text?: string; setupText?: string }> }> }
    | undefined;
  for (const phase of enc?.phases || []) {
    for (const b of phase.beats || []) parts.push(String(b.text || b.setupText || ''));
  }
  return parts.filter(Boolean).join(' ');
}

/** Presence markers that read as remote contact rather than being on-page. */
const REMOTE_CONTACT_RE = (name: string) =>
  new RegExp(`\\b(?:text|message|call|voicemail|dm|email|note)\\b[^.!?\\n]{0,80}\\bfrom\\s+${name}\\b|\\b${name}\\b[^.!?\\n]{0,60}\\b(?:texts?|messages?|calls?|writes?)\\b[^.!?\\n]{0,40}\\b(?:you|back)\\b`, 'i');

function effectiveTimeOfDay(scene: Scene): SceneTimeOfDay | undefined {
  const planned = normalizeTimeOfDay(scene.timeline?.timeOfDay);
  if (planned) return planned;
  return inferTimeOfDayFromText(sceneProse(scene).slice(0, 2000));
}

export interface SceneCharacterAvailabilityInput {
  story: Story;
}

export class SceneCharacterAvailabilityValidator extends BaseValidator {
  constructor() {
    super('SceneCharacterAvailabilityValidator');
  }

  validate(input: SceneCharacterAvailabilityInput): ValidationResult {
    const issues: ValidationIssue[] = [];
    const constrained: ConstrainedNpc[] = (input.story.npcs || [])
      .filter((npc) => (npc.timeOfDayConstraints?.unavailable?.length ?? 0) > 0)
      .map((npc) => ({
        id: npc.id,
        name: npc.name,
        species: npc.species,
        unavailable: new Set((npc.timeOfDayConstraints!.unavailable).map((band) => String(band).toLowerCase())),
        reason: npc.timeOfDayConstraints!.reason,
      }))
      .filter((npc) => npc.name.trim().length >= 3);

    if (constrained.length === 0) {
      return { valid: true, score: 100, issues: [], suggestions: [] };
    }

    for (const episode of input.story.episodes || []) {
      for (const scene of episode.scenes || []) {
        const timeOfDay = effectiveTimeOfDay(scene);
        if (!timeOfDay) continue;
        const prose = sceneProse(scene);
        if (!prose) continue;
        for (const npc of constrained) {
          if (!npc.unavailable.has(timeOfDay)) continue;
          const nameRe = new RegExp(`\\b${npc.name.split(/\s+/)[0]}\\b`, 'i');
          if (!nameRe.test(prose)) continue;
          if (REMOTE_CONTACT_RE(npc.name.split(/\s+/)[0]).test(prose) && !new RegExp(`\\b${npc.name.split(/\s+/)[0]}\\b[^.!?\\n]{0,80}\\b(?:steps?|walks?|enters?|arrives?|stands?|sits?|leans?|smiles?|says?|opens?)\\b`, 'i').test(prose)) {
            // Only remote contact — allowed.
            continue;
          }
          issues.push(this.error(
            `Scene "${scene.id}" (episode ${episode.number}) plays at ${timeOfDay} but "${npc.name}" appears on-page, and their constraints say they can never appear during ${Array.from(npc.unavailable).join(', ')}${npc.reason ? ` (${npc.reason})` : ''}.`,
            `characterAvailability:ep${episode.number}:${scene.id}:${npc.id}`,
            `Move the scene's clock (plan timeOfDay + prose) to a permitted band, or take ${npc.name} off-page for this scene (message, call, absence the prose acknowledges).`,
          ));
        }
      }
    }

    const errors = issues.filter((issue) => issue.severity === 'error').length;
    return {
      valid: errors === 0,
      score: Math.max(0, 100 - errors * 15),
      issues,
      suggestions: issues.map((issue) => issue.suggestion).filter((value): value is string => Boolean(value)),
    };
  }
}
