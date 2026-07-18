export interface EncounterEventSignature {
  normalizedTokens: Set<string>;
  locations: Set<string>;
  participants: Set<string>;
  pressureActions: Set<string>;
  resolutionActions: Set<string>;
  atmosphericSignals: Set<string>;
  temporalMarkers: Set<string>;
  isSetupOnly: boolean;
  isReferenceOnly: boolean;
  sourceText: string;
}

export interface EncounterEventMatch {
  matched: boolean;
  score: number;
  matchedSignals: string[];
}

const STOPWORDS = new Set([
  'about', 'after', 'again', 'against', 'also', 'and', 'because', 'before', 'being', 'between',
  'choice', 'could', 'during', 'ending', 'episode', 'every', 'from', 'have', 'into', 'keeps',
  'later', 'leave', 'leaves', 'major', 'make', 'makes', 'must', 'opens', 'player', 'pressure',
  'scene', 'should', 'that', 'their', 'them', 'then', 'there', 'this', 'through', 'when', 'where',
  'will', 'with', 'without', 'your',
]);

const LOCATION_ALIASES: Array<[string, RegExp]> = [
  ['park', /\b(?:gardens?|park)\b/i],
  ['apartment', /\b(?:apartment|walk-up|deadbolt|welcome\s+mat)\b/i],
  ['club', /\b(?:club|booth|velvet\s+rope|front\s+line|side\s+entrance|venue)\b/i],
  ['rooftop', /\b(?:rooftop|roof|terrace)\b/i],
  // Bare "books" is deliberately case-sensitive (capital B only): it exists to catch the
  // shop's proper name ("Lumina Books"), not a lowercase mention of reading material in
  // unrelated dialogue ("your taste in books") — that FP registered an unrelated rooftop
  // scene as taking place at the bookshop (r118 bite-me-r118_2026-07-18T18-36-05, s1-4).
  ['bookshop', /\b(?:[Bb]ookshop|[Bb]ookstore|[Bb]ook\s+[Ss]hop|Books)\b/],
  ['street', /\b(?:street|sidewalk|alley|courtyard|boulevard)\b/i],
  ['estate', /\b(?:estate|house|manor|villa)\b/i],
  ['maze', /\b(?:maze|hedge\s+maze|labyrinth)\b/i],
];

const PARTICIPANT_ALIASES: Array<[string, RegExp]> = [
  ['named_person', /\b[A-Z][a-z]+\b/],
  ['distinctive_stranger', /\b(?:charcoal\s+suit|man\s+in\s+(?:the\s+)?charcoal|midnight|stranger)\b/i],
  ['attacker', /\b(?:attacker|attackers|adversary|enemy|unseen)\b/i],
];

// Shared by 'escape' (below) and 'vanish' (in RESOLUTION_ACTIONS): the physical-escape
// context an ambiguous verb must be anchored to before it counts as a staged event, not
// an idiom ("the ones who get away" as a toast, r118 bite-me-r118_2026-07-18T18-36-05 s1-4).
const ESCAPE_CONTEXT = '(?:from|through|into|out|past|before|after|him|her|them|attacker|attackers|shadow|fog|park|maze|street|garden|club|room|night)';

const PRESSURE_ACTIONS: Array<[string, RegExp]> = [
  ['attack', /\b(?:attack|attacks|attacked|attacker|attackers|ambush|assault|strike|strikes|struck|lunges?|grab|grabs|grabbed|(?:hand|hands|finger|fingers|grip)\s+(?:closes?|tightens?|clamps?|wraps?)\s+(?:around|on)\s+(?:your|her|his|their|the)?\s*throat)\b/i],
  ['chase', /\b(?:chase|chases|chased|pursue|pursues|pursued|pursuit)\b/i],
  ['escape', new RegExp(
    `\\b(?:escaped|breaks?\\s+free|get\\s+away\\s+${ESCAPE_CONTEXT}|escapes?\\s+${ESCAPE_CONTEXT})\\b`,
    'i',
  )],
  ['pinned', /\b(?:pin|pins|pinned|trap|traps|trapped|cornered|corners?\s+(?!(?:of|booth|table|seat|room|bar|street|hall|corridor|with|onto|into|near|beside|by|at|in|on|from|toward|towards)\b)(?:you|her|him|them|[A-Z][a-z]+|kylie|mika|stela|victor|radu|attacker|the\s+(?:protagonist|woman|man|figure|shadow))|pressed\s+against)\b/i],
  ['confront', /\b(?:confront|confronts|showdown|duel)\b/i],
];

// Anchors "vanish"/"disappear"/"gone" to an actual person/figure reference so incidental
// or sensory uses of the bare verb ("a waiter appears and vanishes", "champagne bubbles
// vanish on your tongue" — r118 bite-me-r118_2026-07-18T18-36-05, s1-4/s1-5) don't register
// as a staged disappearance event. Matches the anchoring the "gone" variant already had.
const VANISH_PERSON = '(?:he|she|they|victor|mika|radu|stela|attacker|figure|shadow|man|woman)';

const RESOLUTION_ACTIONS: Array<[string, RegExp]> = [
  ['rescue', /\b(?:rescue|rescues|rescued|save|saves|saved|intervene|intervenes|intervened)\b/i],
  ['walk_home', /\b(?:walks?\s+(?:you|her|him|them)?\s*home|takes?\s+(?:you|her|him|them)?\s*home|sees?\s+(?:you|her|him|them)?\s*home)\b/i],
  ['vanish', new RegExp(
    `\\b${VANISH_PERSON}\\s+(?:has\\s+|had\\s+|simply\\s+|just\\s+)?(?:vanish(?:es|ed)?|disappear(?:s|ed)?)\\b`
    + `|\\b${VANISH_PERSON}\\s+(?:is\\s+|are\\s+|was\\s+|were\\s+)?gone\\b`,
    'i',
  )],
  ['defeat', /\b(?:defeat|defeats|defeated|overcome|survive|survives|survived)\b/i],
];

const ATMOSPHERIC_SIGNALS: Array<[string, RegExp]> = [
  ['shadow', /\b(?:shadow|shadows|unseen)\b/i],
  ['fog', /\b(?:fog|fogged|fog-choked|mist)\b/i],
  ['blood', /\b(?:blood|bloody|bleeding)\b/i],
  ['scream', /\b(?:scream|screams|screamed)\b/i],
];

const TEMPORAL_MARKERS: Array<[string, RegExp]> = [
  ['night', /\b(?:night|midnight|1\s*a\.?m\.?|one\s+in\s+the\s+morning|dusk)\b/i],
  ['morning', /\b(?:morning|breakfast|dawn)\b/i],
  ['afternoon', /\b(?:afternoon|midday|lunch)\b/i],
];

const SETUP_ONLY_PATTERN = /\b(?:foreshadow|warns?|warning|dream|nightmare|mentions?|remembers?|recalls?|blog|post|article|viral|retells?|reported|watches?|watching|prepares?|sets?\s+up)\b/i;
const REFERENCE_ONLY_PATTERN = /\b(?:blog|post|article|viral|writes?|wrote|recap|recaps?|retell|retells?|memory|remembers?|recalls?|dream|nightmare|warns?|warning|mentions?|reported|tells?\s+(?:you|her|him|them)\s+about|ghost\s+of|phantom\s+(?:cold|grip|touch|pain)|away\s+from\s+the\s+(?:park|fog|attack|shadow)|behind\s+you)\b/i;

function normalize(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ș/g, 's')
    .replace(/ț/g, 't')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function encounterEventTokens(value: string | undefined): string[] {
  if (!value) return [];
  return normalize(value)
    .split(' ')
    .filter((token) => token.length >= 4 && !STOPWORDS.has(token));
}

function collectMatches(source: string, patterns: Array<[string, RegExp]>): Set<string> {
  const hits = new Set<string>();
  for (const [label, pattern] of patterns) {
    if (pattern.test(source)) hits.add(label);
  }
  return hits;
}

export function buildEncounterEventSignature(texts: Array<string | undefined | null>): EncounterEventSignature {
  const sourceText = texts.filter((text): text is string => Boolean(text?.trim())).join(' ');
  const normalizedTokens = new Set(encounterEventTokens(sourceText));
  const locations = collectMatches(sourceText, LOCATION_ALIASES);
  if (locations.has('club') && isSocialClubPhrase(sourceText)) {
    locations.delete('club');
  }
  const participants = collectMatches(sourceText, PARTICIPANT_ALIASES);
  const pressureActions = collectMatches(sourceText, PRESSURE_ACTIONS);
  const resolutionActions = collectMatches(sourceText, RESOLUTION_ACTIONS);
  const atmosphericSignals = collectMatches(sourceText, ATMOSPHERIC_SIGNALS);
  const temporalMarkers = collectMatches(sourceText, TEMPORAL_MARKERS);
  const setupish = SETUP_ONLY_PATTERN.test(sourceText);
  const isReferenceOnly = REFERENCE_ONLY_PATTERN.test(sourceText);

  return {
    normalizedTokens,
    locations,
    participants,
    pressureActions,
    resolutionActions,
    atmosphericSignals,
    temporalMarkers,
    isSetupOnly: setupish && pressureActions.size === 0 && resolutionActions.size === 0,
    isReferenceOnly,
    sourceText,
  };
}

function isSocialClubPhrase(sourceText: string): boolean {
  const normalized = normalize(sourceText);
  const hasSocialClubPhrase = /\b(?:weird girls club|our club|dusk club|christening our club|club very exclusive)\b/.test(normalized);
  if (!hasSocialClubPhrase) return false;
  const hasVenueCue = /\b(?:valcescu|velvet rope|front line|side entrance|service entrance|key card|keycard|venue|booth|bar|dance floor|inside the club|club door)\b/.test(normalized);
  return !hasVenueCue;
}

function intersection<T>(a: Set<T>, b: Set<T>): T[] {
  return [...a].filter((value) => b.has(value));
}

function tokenCoverage(source: Set<string>, target: Set<string>): number {
  if (source.size === 0) return 0;
  return intersection(source, target).length / source.size;
}

export function compareEncounterEventSignatures(
  encounter: EncounterEventSignature,
  candidate: EncounterEventSignature,
): EncounterEventMatch {
  if (encounter.normalizedTokens.size === 0 || candidate.normalizedTokens.size === 0) {
    return { matched: false, score: 0, matchedSignals: [] };
  }
  if (candidate.isSetupOnly || candidate.isReferenceOnly) {
    return { matched: false, score: 0, matchedSignals: [] };
  }

  const locationHits = intersection(encounter.locations, candidate.locations);
  const participantHits = intersection(encounter.participants, candidate.participants);
  const pressureHits = intersection(encounter.pressureActions, candidate.pressureActions);
  const resolutionHits = intersection(encounter.resolutionActions, candidate.resolutionActions);
  const atmosphereHits = intersection(encounter.atmosphericSignals, candidate.atmosphericSignals);
  const temporalHits = intersection(encounter.temporalMarkers, candidate.temporalMarkers);
  const encounterCoverage = tokenCoverage(encounter.normalizedTokens, candidate.normalizedTokens);
  const candidateCoverage = tokenCoverage(candidate.normalizedTokens, encounter.normalizedTokens);

  const bothHavePressure = encounter.pressureActions.size > 0 && candidate.pressureActions.size > 0;
  const bothHaveResolution = encounter.resolutionActions.size > 0 && candidate.resolutionActions.size > 0;
  const distinctivePlace = locationHits.length > 0;
  const distinctiveActor = participantHits.some((hit) => hit !== 'attacker') || resolutionHits.length > 0;
  const eventActionMatch = pressureHits.length > 0
    || (bothHavePressure && (resolutionHits.length > 0 || atmosphereHits.length > 0 || distinctiveActor));

  let score = 0;
  score += locationHits.length * 3;
  score += participantHits.length * 2;
  score += pressureHits.length * 3;
  score += resolutionHits.length * 3;
  score += atmosphereHits.length;
  score += temporalHits.length;
  score += Math.round((encounterCoverage + candidateCoverage) * 4);

  const matchedBySignature = distinctivePlace && eventActionMatch && (!bothHaveResolution || resolutionHits.length > 0 || distinctiveActor);
  const matchedByTokens = encounterCoverage >= 0.28 && candidateCoverage >= 0.18 && bothHavePressure;
  const matched = matchedBySignature || matchedByTokens;
  const matchedSignals = [
    ...locationHits,
    ...participantHits,
    ...pressureHits,
    ...resolutionHits,
    ...atmosphereHits,
    ...temporalHits,
  ];

  return { matched, score, matchedSignals: Array.from(new Set(matchedSignals)) };
}
