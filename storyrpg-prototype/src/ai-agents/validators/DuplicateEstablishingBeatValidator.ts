/**
 * DuplicateEstablishingBeatValidator
 *
 * Catches the "dual first-entry" continuity defect: two scenes on the same
 * linear path that BOTH stage the protagonist entering the same location for the
 * first time. The Endsong Gen-4 case was s3-2 ("You cross the threshold into the
 * commander's hall … tallow and old blood … Thorne at the map table") immediately
 * followed by s3-3 ("You step into the great hall of Fort Dawnwatch and the smell
 * finds you first … you find Thorne"). The second scene should be a continuation,
 * not a fresh arrival.
 *
 * Deterministic and prose-only: it looks at each scene's first reader-facing beat
 * for an "establishing entry" (an entry verb in the opening sentence) and pairs
 * consecutive scenes that re-enter the SAME place — keyed on the blueprint
 * `location` when available, and falling back to a shared place-noun in the entry
 * clause (hall, keep, chamber, …) when it is not. No LLM.
 */

import type { Episode, Scene, Beat } from '../../types';
import type { EpisodeBlueprint } from '../agents/StoryArchitect';

export interface DuplicateEstablishingBeatIssue {
  type: 'duplicate_establishing_beat';
  severity: 'warning' | 'error';
  message: string;
  sceneId: string;
  beatId?: string;
  priorSceneId: string;
}

export interface DuplicateEstablishingBeatResult {
  valid: boolean;
  issues: DuplicateEstablishingBeatIssue[];
  metrics: { scenesChecked: number; duplicateEstablishingBeatCount: number };
}

export interface DuplicateEstablishingBeatOptions {
  /** When true, issues are 'error' (gating). Default 'warning' (advisory). */
  blocking?: boolean;
}

// Entry verbs that, in an opening sentence, mark a fresh arrival into a place.
const ENTRY_PATTERN =
  /\b(?:cross(?:es|ed)?|step(?:s|ped)?(?:\s+(?:in|into|inside|through))?|enter(?:s|ed|ing)?|walk(?:s|ed|ing)?\s+(?:in|into|inside|through)|push(?:es|ed)?\s+(?:open|through)|arrive(?:s|d)?(?:\s+at)?|come(?:s)?\s+(?:in|into|through))\b/i;

// Distinctive place-nouns used as the fallback "same location" signal.
const PLACE_NOUNS = [
  'hall', 'keep', 'chamber', 'courtyard', 'archive', 'cellar', 'crypt', 'tower',
  'gate', 'gatehouse', 'fort', 'throne room', 'great hall', 'commander', 'sanctum',
  'parlor', 'ballroom', 'estate', 'manor', 'lodge', 'study', 'foyer', 'atrium',
];

function firstProseBeat(scene: Scene): Beat | undefined {
  return (scene.beats || []).find((b) => !b.isChoiceBridge && typeof b.text === 'string' && b.text.trim().length > 0);
}

/** The opening sentence (first ~200 chars) of a beat, lowercased. */
function openingSentence(text: string): string {
  const trimmed = text.trim();
  const stop = trimmed.search(/[.!?]/);
  const head = stop >= 0 ? trimmed.slice(0, stop + 1) : trimmed.slice(0, 200);
  return head.toLowerCase();
}

function isEstablishingEntry(text: string): boolean {
  return ENTRY_PATTERN.test(openingSentence(text));
}

function placeNounsIn(text: string): Set<string> {
  const head = openingSentence(text);
  const found = new Set<string>();
  for (const noun of PLACE_NOUNS) {
    if (head.includes(noun)) found.add(noun);
  }
  return found;
}

function normalizeLocation(value: string | undefined): string {
  return (value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

export class DuplicateEstablishingBeatValidator {
  validateEpisode(
    episode: Episode,
    blueprint?: EpisodeBlueprint,
    options: DuplicateEstablishingBeatOptions = {},
  ): DuplicateEstablishingBeatResult {
    const issues: DuplicateEstablishingBeatIssue[] = [];
    const severity: 'warning' | 'error' = options.blocking ? 'error' : 'warning';

    const locationById = new Map<string, string>();
    for (const bp of blueprint?.scenes || []) {
      if (bp.id && bp.location) locationById.set(bp.id, normalizeLocation(bp.location));
    }

    // Walk consecutive non-encounter scenes (encounters are their own staging).
    const scenes = (episode.scenes || []).filter((s) => !s.encounter);
    for (let i = 1; i < scenes.length; i++) {
      const prev = scenes[i - 1];
      const cur = scenes[i];
      const prevBeat = firstProseBeat(prev);
      const curBeat = firstProseBeat(cur);
      if (!prevBeat?.text || !curBeat?.text) continue;
      if (!isEstablishingEntry(prevBeat.text) || !isEstablishingEntry(curBeat.text)) continue;

      const prevLoc = locationById.get(prev.id);
      const curLoc = locationById.get(cur.id);
      const sameLocation = Boolean(prevLoc && curLoc && prevLoc === curLoc);

      let sharedPlace = false;
      if (!sameLocation) {
        const prevPlaces = placeNounsIn(prevBeat.text);
        const curPlaces = placeNounsIn(curBeat.text);
        for (const p of curPlaces) {
          if (prevPlaces.has(p)) { sharedPlace = true; break; }
        }
      }

      if (sameLocation || sharedPlace) {
        issues.push({
          type: 'duplicate_establishing_beat',
          severity,
          message:
            `Scene ${cur.id} stages a fresh entry into the same location already entered in ${prev.id} ` +
            'on this linear path — the second scene should continue the visit, not re-arrive.',
          sceneId: cur.id,
          beatId: curBeat.id,
          priorSceneId: prev.id,
        });
      }
    }

    const errorCount = issues.filter((x) => x.severity === 'error').length;
    return {
      valid: errorCount === 0,
      issues,
      metrics: { scenesChecked: scenes.length, duplicateEstablishingBeatCount: issues.length },
    };
  }
}
