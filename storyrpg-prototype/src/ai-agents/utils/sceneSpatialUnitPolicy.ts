import type { RequiredBeat, SceneEventOwnershipProfile } from '../../types/scenePlan';
import { detectPrimaryStoryEventCues } from '../remediation/storyEventCues';
import { getStoryLexicon } from '../config/storyLexicon';
import {
  anchoredSceneLocationCues,
  isContainerLocationCue,
  normalizeLocationText,
  uniqueMajorLocationCues,
} from './sceneLocationCues';

const HARD_TIERS = new Set<RequiredBeat['tier']>(['authored', 'signature', 'coldopen']);

const MOVEMENT_EVENT_CUES = new Set<SceneEventOwnershipProfile['ownedEvents'][number]['cue']>([
  'arrival',
  'venueDoor',
  'roadBreakdown',
  'walkHome',
  'endingAftermath',
]);

function cleanText(value: unknown): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

export function hardBeatTexts(beats: RequiredBeat[] | undefined): string[] {
  return (beats ?? [])
    .filter((beat) => HARD_TIERS.has(beat.tier))
    .map((beat) => cleanText(beat.mustDepict || beat.sourceTurn))
    .filter(Boolean);
}

export function sceneOwnsMovementCueFromOwnership(
  ownedEvents: SceneEventOwnershipProfile['ownedEvents'] | undefined,
): boolean {
  return (ownedEvents ?? []).some((event) => MOVEMENT_EVENT_CUES.has(event.cue));
}

export function sceneOwnsMovementCueFromTexts(texts: string[]): boolean {
  return texts.some((text) => {
    const cues = detectPrimaryStoryEventCues(text);
    return [...cues].some((cue) => MOVEMENT_EVENT_CUES.has(cue as never));
  });
}

/**
 * Plan-time spatial cue count aligned with final SceneSpatialUnitValidator.
 * Container city + specific venue in hard beats count as two units (explore
 * Bucharest + Lumina bookshop), unlike anchoredSceneLocationCues alone.
 */
export function strictSceneLocationCues(labelInputs: unknown[], hardTexts: string[]): string[] {
  const perBeatUnits = spatialUnitsFromHardTexts(hardTexts);
  if (perBeatUnits.length >= 2) return perBeatUnits;
  const anchored = anchoredSceneLocationCues(labelInputs, hardTexts);
  return anchored.length > 0 ? anchored : perBeatUnits;
}

function spatialUnitFromHardText(text: string): string | undefined {
  const normalized = normalizeLocationText(text);
  if (/\b(?:bookshop|bookstore|lumina)\b/i.test(text)) return 'bookshop';
  if (/\b(?:explores?|wandering|wanders?|strolls?|streets?)\b/i.test(text)) {
    const container = getStoryLexicon().containerCities.find((city) => normalized.includes(city));
    if (container) return container;
    return 'exploration';
  }
  if (/\b(?:arrives?|arrival|suitcases?)\b/i.test(text)) {
    const container = getStoryLexicon().containerCities.find((city) => normalized.includes(city));
    if (container) return container;
  }
  if (/\b(?:club|valescu|nightlife|velvet rope)\b/i.test(text)) return 'club';
  if (/\b(?:rooftop|terrace|charcoal suit)\b/i.test(text)) return 'rooftop bar';
  if (/\b(?:cismigiu|cișmigiu|gardens?)\b/i.test(text)) return 'cismigiu gardens';
  const specific = uniqueMajorLocationCues([text]).find((cue) => !isContainerLocationCue(cue));
  if (specific) return specific;
  return getStoryLexicon().containerCities.find((city) => normalized.includes(city));
}

function spatialUnitsFromHardTexts(hardTexts: string[]): string[] {
  const units: string[] = [];
  for (const text of hardTexts) {
    const unit = spatialUnitFromHardText(text);
    if (unit) units.push(unit);
  }
  const collapsed: string[] = [];
  for (const unit of units) {
    if (collapsed.some((existing) => existing === unit || existing.includes(unit) || unit.includes(existing))) continue;
    collapsed.push(unit);
  }
  return collapsed;
}

export function spatialMovementAllowance(
  ownedEvents: SceneEventOwnershipProfile['ownedEvents'] | undefined,
  hardTexts: string[],
): number {
  return sceneOwnsMovementCueFromOwnership(ownedEvents) || sceneOwnsMovementCueFromTexts(hardTexts)
    ? 2
    : 1;
}

export interface SpatialUnitViolation {
  sceneId: string;
  locationCues: string[];
  allowance: number;
}

export function detectSpatialUnitViolations(input: {
  sceneId?: string;
  kind?: string;
  isEncounter?: boolean;
  locations?: string[];
  location?: string;
  requiredBeats?: RequiredBeat[];
  sceneEventOwnership?: SceneEventOwnershipProfile;
}): SpatialUnitViolation | undefined {
  if (input.kind === 'encounter' || input.isEncounter) return undefined;
  const hardTexts = hardBeatTexts(input.requiredBeats);
  if (hardTexts.length === 0) return undefined;
  const labels = [input.location, ...(input.locations ?? [])];
  const cues = strictSceneLocationCues(labels, hardTexts);
  const allowance = spatialMovementAllowance(input.sceneEventOwnership?.ownedEvents, hardTexts);
  if (cues.length <= allowance) return undefined;
  return {
    sceneId: input.sceneId ?? 'scene',
    locationCues: cues,
    allowance,
  };
}
