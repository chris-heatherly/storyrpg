// The preposition alternation allows an optional capitalized first letter so a
// sentence-initial "Through Cișmigiu" / "In Bucharest" is recognized (the rest of
// LOCATION_RE stays case-sensitive to keep the capitalized-vs-lowercase branch
// logic for the location name itself).
const LOCATION_RE = /\b(?:[Aa]t|[Ii]n|[Ii]nside|[Oo]utside|[Oo]n|[Nn]ear|[Tt]hrough|[Tt]o|[Ff]rom)\s+(?:the\s+|a\s+|an\s+)?([A-ZÀ-Ž][A-Za-zÀ-ž0-9'’-]*(?:\s+[A-ZÀ-Ž][A-Za-zÀ-ž0-9'’-]*){0,3}|[a-z][a-z0-9'’-]*(?:\s+[a-z][a-z0-9'’-]*){0,2}\s+(?:bar|club|park|station|apartment|archive|venue|hotel|house|garden|gardens|market|office|studio|library|bookshop|bookstore|rooftop|courtyard|cafe|café|museum|shop|dock|estate))/g;
const CATEGORY_LOCATION_RE = /\b(?:at|in|inside|outside|on|near|through|to|from)\s+(?:the\s+|a\s+|an\s+)?((?:rooftop\s+)?(?:bar|club|park|station|apartment|archive|venue|hotel|house|garden|gardens|market|office|studio|library|bookshop|bookstore|rooftop|courtyard|cafe|café|museum|shop|dock|estate))\b/gi;

import { getStoryLexicon } from '../config/storyLexicon';

// Generic settlement words; story-specific city names come from the active
// lexicon (audit Phase 6 — vocabulary lives in storyLexicon.ts, not here).
const GENERIC_CONTAINER_CUES = ['city', 'town', 'village', 'new city', 'home city', 'city center'];

function containerCues(): Set<string> {
  return new Set([...GENERIC_CONTAINER_CUES, ...getStoryLexicon().containerCities]);
}

function cleanText(value: unknown): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

export function normalizeSceneLocationCue(value: unknown): string | undefined {
  const normalized = cleanText(value)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\b(?:the|a|an)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized) return undefined;
  if (/^(?:purpose|scene|episode|next|before|after|consequence|consequences|turn|handoff)\b/.test(normalized)) return undefined;
  const lexicon = getStoryLexicon();
  // Story-signature places collapse to their canonical cue.
  for (const place of lexicon.signaturePlaces) {
    if (normalized.includes(place)) return place;
  }
  if (/\brooftop\b/.test(normalized) && /\bbar\b/.test(normalized)) return 'rooftop bar';
  if (/\bbook(?:shop|store)\b/.test(normalized)) return 'bookshop';
  if (/\bapartment\b/.test(normalized)) return 'apartment';
  if (/\bclub\b/.test(normalized) || /\bvenue\b/.test(normalized)) {
    const named = lexicon.namedVenues.find((venue) => normalized.includes(venue));
    return named ? `${named} club` : 'club';
  }
  return normalized.replace(/\bgardens\b/g, 'garden');
}

export function isContainerLocationCue(value: string): boolean {
  return containerCues().has(value);
}

export function extractSceneLocationCues(text: unknown): string[] {
  const out = new Set<string>();
  const value = cleanText(text);
  for (const match of [...value.matchAll(LOCATION_RE), ...value.matchAll(CATEGORY_LOCATION_RE)]) {
    const cue = normalizeSceneLocationCue(match[1]);
    if (cue) out.add(cue);
  }
  return [...out];
}

// Venue nouns that mark a phrase as an actual place. Kept in sync with the venue
// alternation in LOCATION_RE / CATEGORY_LOCATION_RE above (plus dock/estate, which
// an earlier refactor dropped).
const VENUE_NOUNS = [
  'bar', 'club', 'park', 'station', 'apartment', 'archive', 'venue', 'hotel',
  'house', 'garden', 'gardens', 'market', 'office', 'studio', 'library',
  'bookshop', 'bookstore', 'rooftop', 'courtyard', 'cafe', 'café', 'museum',
  'shop', 'dock', 'estate',
];
const VENUE_NOUN_RE = new RegExp(`\\b(?:${VENUE_NOUNS.join('|')})\\b`, 'i');
const PLACE_STOPWORDS = new Set(['of', 'the', 'and', 'de', 'la', 'le', 'du', 'des']);

// A proper place name reads as Title Case ("Vâlcescu Club", "Cișmigiu") — its
// first word is capitalized and no word is a lowercase content word. This
// distinguishes a real location label from a short prose fragment that merely
// lacks sentence punctuation ("A shadow moves behind the trees").
function looksLikeProperPlace(text: string): boolean {
  const stripped = text.replace(/^(?:the|a|an)\s+/i, '').trim();
  if (!stripped) return false;
  const words = stripped.split(/\s+/);
  if (!/^[A-ZÀ-Ž]/.test(words[0])) return false;
  return words.every((word) => /^[A-ZÀ-Ž0-9]/.test(word) || PLACE_STOPWORDS.has(word.toLowerCase()));
}

// Positive test: a value counts as a direct location label only if it actually
// looks like a place — a venue noun, a known container/city, or a proper place
// name. Previously ANY short, punctuation-free, verb-free string qualified, so
// prose fragments inflated the multi-location count that hard-aborts at
// SceneConstructionGate.
function isDirectLocationLabel(value: unknown): boolean {
  const text = cleanText(value);
  if (!text || text.length > 48 || /[.!?]/.test(text)) return false;
  if (VENUE_NOUN_RE.test(text)) return true;
  const normalized = normalizeSceneLocationCue(text);
  if (normalized && isContainerLocationCue(normalized)) return true;
  return looksLikeProperPlace(text);
}

export function uniqueMajorLocationCues(inputs: unknown[]): string[] {
  const raw = inputs.flatMap((input) => {
    if (Array.isArray(input)) return input.flatMap((item) => uniqueMajorLocationCues([item]));
    const direct = isDirectLocationLabel(input) ? normalizeSceneLocationCue(input) : undefined;
    const extracted = extractSceneLocationCues(input);
    return [...(direct ? [direct] : []), ...extracted];
  });
  const cues = Array.from(new Set(raw.filter(Boolean)));
  const specific = cues.filter((cue) => !isContainerLocationCue(cue));
  // When only ambient container cues remain (city, town, the city's proper name),
  // they describe one setting and never conflict — collapse to a single location
  // instead of counting "city center" + "bucharest" as two.
  if (specific.length === 0) return cues.length > 0 ? [cues[0]] : [];
  const collapsed: string[] = [];
  for (const cue of specific) {
    if (collapsed.some((existing) => existing === cue || existing.includes(cue) || cue.includes(existing))) continue;
    collapsed.push(cue);
  }
  return collapsed;
}
