import type { Story } from '../../types/story';
import type { SeasonScenePlan } from '../../types/scenePlan';
import { BaseValidator, type ValidationIssue, type ValidationResult } from './BaseValidator';
import { collectRelationshipScenes, sceneVisibleText } from '../utils/relationshipArcLedger';

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
    for (const match of text.matchAll(NAMED_VENUE_RE)) add(match[1]);
  }
  return Array.from(out.values());
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
