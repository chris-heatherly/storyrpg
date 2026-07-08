import type { Story } from '../../types/story';
import type { SceneEventOwnershipCue, SeasonScenePlan } from '../../types/scenePlan';
import { BaseValidator, type ValidationIssue, type ValidationResult } from './BaseValidator';
import { collectRelationshipScenes, sceneVisibleText, type RelationshipSceneRef } from '../utils/relationshipArcLedger';

export interface SceneSpatialUnitInput {
  story: Story;
  scenePlan?: SeasonScenePlan;
  treatmentSourced?: boolean;
}

interface LocationHit {
  location: string;
  index: number;
  active: boolean;
}

const MICRO_LOCATION_RE = /\b(?:door|doorway|threshold|hall|hallway|corridor|stairs?|stairwell|sidewalk|street|road|car|cab|taxi|bridge|path|entrance|exit|gate|line|queue)\b/i;
const FUTURE_HANDOFF_RE = /\b(?:toward|to|for|near|points?\s+(?:you\s+)?toward|suggests?|mentions?|names?|tells?\s+you\s+about|invites?\s+you\s+to|later\s+at|tomorrow\s+at)\b/i;
const DEPARTURE_CONTEXT_RE = /\b(?:leav(?:e|es|ing|t)|back\s+from|away\s+from|fades?|fading|recedes?|behind\s+you|behind\s+her|behind\s+him|behind\s+them)\b/i;
const ACTIVE_LOCATION_RE = /\b(?:at|inside|outside|behind|within|into|through|across|under|beside|on|in)\b[^.!?]{0,80}$|^\s*[^.!?]{0,80}\b(?:arrives?|appears?|waits?|stands?|looks?|says?|asks?|hands?|offers?|presses?|closes?|walks?|leads?|follows?|clocks?|pulls?|blocks?|meets?|introduces?)\b/i;
const MEANINGFUL_ACTION_RE = /\b(?:says?|asks?|answers?|hands?|offers?|presses?|takes?|gives?|closes?|walks?|leads?|follows?|clocks?|starts?|meets?|introduces?|appears?|waits?|stands?|looks?|smiles?|touches?|pulls?|blocks?|warns?|reveals?|finds?|discovers?|attacks?|rescues?|chooses?|decides?)\b/i;
const NAMED_VENUE_RE = /\b([A-ZÀ-Ž][A-Za-zÀ-ž'’-]+(?:\s+[A-ZÀ-Ž][A-Za-zÀ-ž'’-]+){0,3}\s+(?:Apartment|Apartments|Books|Bookshop|Bookstore|Club|Gardens?|Park|Bar|Rooftop|Store|House|Estate|Market|Hotel|Cafe|Café|Church|Museum|Station|Square|Theatre|Theater|Library))\b/g;

// Owned events that are journeys: staging them on-page necessarily touches both
// the origin and the destination, so a scene that owns one is allowed a second
// active spatial anchor (bite-me 2026-07-02: "arrival" owned by s1-1 could not
// be depicted without the spatial gate demanding the scene be split, while the
// event-ledger gate demanded it stay).
const MOVEMENT_EVENT_CUES: ReadonlySet<SceneEventOwnershipCue> = new Set([
  'arrival',
  'venueDoor',
  'roadBreakdown',
  'walkHome',
  'endingAftermath',
]);

function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^the\s+/, '')
    .replace(/^(?:loc|location)\s+/, '')
    .trim();
}

function locationPattern(location: string): RegExp | undefined {
  const normalized = normalize(location);
  const tokens = normalized.split(' ').filter((token) => token.length >= 4 && !MICRO_LOCATION_RE.test(token));
  if (tokens.length === 0) return undefined;
  const phrase = tokens.map((token) => token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+');
  return new RegExp(`\\b${phrase}\\b`, 'i');
}

// Locative evidence required before a PROSE-mined "Proper Noun + venue-noun"
// match counts as a place. Named social groups are lexically identical to
// venues ("the Dusk Club" is a friend group, not a nightclub), so a prose
// mention only registers as a location when the surrounding words put someone
// AT it (bite-me 2026-07-02T19-39-25: "Venue, The Dusk Club" spatial FP).
const LOCATIVE_LEAD_RE = /\b(?:at|inside|into|outside|near|within|toward|entering|enters?|arriv\w+\s+(?:at|in)|walks?\s+(?:into|to)|steps?\s+(?:into|inside)|back\s+(?:at|to)|meets?\s+(?:you\s+)?at|door\s+of|threshold\s+of|leaves?)\s+(?:the\s+|a\s+)?$/i;

function collectKnownLocations(story: Story, scenePlan?: SeasonScenePlan): string[] {
  const out = new Map<string, string>();
  const add = (value: unknown): void => {
    if (typeof value !== 'string') return;
    const trimmed = value.trim();
    if (!trimmed || MICRO_LOCATION_RE.test(trimmed) || trimmed.length < 5) return;
    out.set(normalize(trimmed), trimmed);
  };
  for (const ref of collectRelationshipScenes(story, scenePlan)) {
    add(ref.scene.timeline?.location);
    for (const loc of ref.planned?.locations ?? []) add(loc);
    const text = sceneVisibleText(ref.scene);
    for (const match of text.matchAll(NAMED_VENUE_RE)) {
      const lead = text.slice(Math.max(0, (match.index ?? 0) - 40), match.index ?? 0);
      if (!LOCATIVE_LEAD_RE.test(lead)) continue;
      add(match[1]);
    }
  }
  return Array.from(out.values());
}

/**
 * Locations the plan sanctions for THIS scene: its declared plan locations and
 * its timeline anchor. A scene whose active prose locations are all declared in
 * its own plan entry is a sanctioned multi-location scene — the authoring
 * decision was made at plan time, and bridge quality between the anchors is
 * SceneTransitionContinuityValidator's concern, not a split demand.
 */
function sanctionedLocationKeys(ref: RelationshipSceneRef): Set<string> {
  const keys = new Set<string>();
  const add = (value: unknown): void => {
    if (typeof value !== 'string') return;
    const key = normalize(value);
    if (key) keys.add(key);
  };
  add(ref.scene.timeline?.location);
  for (const loc of ref.planned?.locations ?? []) add(loc);
  return keys;
}

function ownsMovementEventCue(ref: RelationshipSceneRef): boolean {
  return (ref.planned?.sceneEventOwnership?.ownedEvents ?? [])
    .some((event) => MOVEMENT_EVENT_CUES.has(event.cue));
}

function sentenceWindow(text: string, index: number): string {
  const start = Math.max(text.lastIndexOf('.', index), text.lastIndexOf('!', index), text.lastIndexOf('?', index));
  const nextStops = ['.', '!', '?']
    .map((char) => text.indexOf(char, index))
    .filter((value) => value >= 0);
  const end = nextStops.length ? Math.min(...nextStops) : text.length;
  return text.slice(Math.max(0, start + 1), Math.min(text.length, end + 1));
}

function locationHits(text: string, locations: string[]): LocationHit[] {
  const hits: LocationHit[] = [];
  const comparableText = text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  for (const location of locations) {
    const pattern = locationPattern(location);
    if (!pattern) continue;
    const normalizedText = normalize(text);
    const match = pattern.exec(normalizedText);
    if (!match) continue;
    const phrase = normalize(location);
    const comparableIndex = comparableText.indexOf(phrase);
    const window = sentenceWindow(comparableText, comparableIndex >= 0 ? comparableIndex : match.index);
    const departureContext = DEPARTURE_CONTEXT_RE.test(window);
    const active = !departureContext && (
      ACTIVE_LOCATION_RE.test(window) || (MEANINGFUL_ACTION_RE.test(window) && !FUTURE_HANDOFF_RE.test(window))
    );
    hits.push({ location, index: comparableIndex >= 0 ? comparableIndex : match.index, active });
  }
  return hits;
}

export class SceneSpatialUnitValidator extends BaseValidator {
  constructor() {
    super('SceneSpatialUnitValidator');
  }

  validate(input: SceneSpatialUnitInput): ValidationResult {
    const issues: ValidationIssue[] = [];
    const locations = collectKnownLocations(input.story, input.scenePlan);
    if (locations.length < 2) return { valid: true, score: 100, issues: [], suggestions: [] };

    for (const ref of collectRelationshipScenes(input.story, input.scenePlan)) {
      const text = sceneVisibleText(ref.scene);
      if (!text.trim()) continue;
      const hits = locationHits(text, locations);
      const activeLocations = Array.from(new Set(hits.filter((hit) => hit.active).map((hit) => hit.location)));
      if (activeLocations.length < 2) continue;
      const sanctioned = sanctionedLocationKeys(ref);
      if (activeLocations.every((location) => sanctioned.has(normalize(location)))) continue;
      issues.push(this.error(
        `Scene "${ref.scene.id}" conducts meaningful action in multiple major locations: ${activeLocations.join(', ')}.`,
        `sceneSpatialUnit:ep${ref.episodeNumber}:${ref.scene.id}`,
        'Split this into one full scene per major named location. A beat may hand off to the next location, but introductions, choices, encounters, reveals, and relationship turns must happen in their own scene.',
      ));
    }

    const errors = issues.filter((issue) => issue.severity === 'error').length;
    return {
      valid: errors === 0,
      score: issues.length === 0 ? 100 : Math.max(0, 100 - errors * 20),
      issues,
      suggestions: issues.map((issue) => issue.suggestion).filter((value): value is string => Boolean(value)),
    };
  }
}
