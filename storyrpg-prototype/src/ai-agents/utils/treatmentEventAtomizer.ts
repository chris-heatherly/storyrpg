import type { TreatmentEventAtom, TreatmentEventType } from '../../types/treatmentEvent';
import {
  detectPrimaryStoryEventCues,
  STORY_EVENT_CUE_ORDER,
  type StoryEventCue,
} from '../remediation/storyEventCues';

export interface TreatmentAtomizerInput {
  episodeNumber: number;
  text: string;
  sourceSection?: string;
  idPrefix?: string;
  /** When true, the atom must be staged even if cue heuristics classify it as context-only. */
  forceStage?: boolean;
}

export function isAuthoredEpisodeTurnSource(sourceSection: string | undefined): boolean {
  return Boolean(sourceSection?.trim() && /^episodeTurn:/i.test(sourceSection.trim()));
}

const NON_PLAYABLE_PATTERNS: Array<{ label: string; pattern: RegExp }> = [
  { label: 'episode analysis label', pattern: /^\**(?:major pressure|likely consequence|story circle role)\**\s*:/i },
  { label: 'theme or premise card', pattern: /\b(?:theme|premise|thesis|audience promise|tonal promise)\b/i },
  { label: 'want need lie wound language', pattern: /\b(?:want|need|lie|wound|lack|desire|fear)\b/i },
  { label: 'story circle summary', pattern: /\b(?:story circle|you\s*->\s*need|go\s*->\s*search|find\s*->\s*take|return\s*->\s*change)\b/i },
  { label: 'abstract dramatic question', pattern: /^(?:can|will|what|who|whether|how)\b[^.!?]{10,}\?$/i },
  { label: 'future payoff bundle', pattern: /\b(?:future payoff|payoff window|callback|later episode|next episode|season-long|eventual)\b/i },
  { label: 'choice menu list', pattern: /\b(?:canonical|choice menu|option hints?|what name do you give|scream\s*,\s*run\s*,\s*freeze|(?:^|[,;])\s*or\s+[^.!?]+)\b/i },
  { label: 'planning register verb', pattern: /\b(?:establishing|establishes|serves|pressure|residue|turn|anchors?|proof that|demonstrates|sets up|pays off)\b/i },
  { label: 'craft instruction', pattern: /\b(?:dramatize|show that|reveal that|explore|underline|symbolize|signal|foreshadow)\b/i },
  { label: 'summary-only phrasing', pattern: /\b(?:as a|with the intent to|in order to|must learn to|struggles with)\b/i },
];

const PLAYABLE_FIELD_LABEL = /^\**(?:high-level description|description|sequence|episode events?|scene events?)\**\s*:\s*/i;
const LEDGER_ONLY_CONTEXT_RE = /\b(?:future payoff|payoff window|callback|later episode|next episode|season-long|eventual|information ledger|ending state|possible ending|route math|downstream)\b/i;
const SUPPORT_CONTEXT_RE = /\b(?:theme|premise|thesis|audience promise|tonal promise|wants?|needs?|lie|wound|lack|desire|fear|pressure|relationship|trust|intimacy|belonging|identity|baseline|normal)\b/i;

const ACTION_PATTERNS: Array<{ type: TreatmentEventType; pattern: RegExp }> = [
  { type: 'arrival', pattern: /\b(?:arrives?|enters?|returns?|comes to|reaches|lands at)\b/i },
  { type: 'departure', pattern: /\b(?:leaves?|flees?|escapes?|walks out|drives away|departs)\b/i },
  { type: 'exploration', pattern: /\b(?:explores?|wanders?|roams?|walks?\s+(?:through|around|the)|tours?|strolls?)\b/i },
  { type: 'meeting', pattern: /\b(?:meets?|joins?|forms?|gathers?|assembles?|encounters?|runs into|is introduced to)\b/i },
  { type: 'conversation', pattern: /\b(?:asks?|tells?|confesses?|argues?|admits?|calls?|texts?|answers?)\b/i },
  { type: 'discovery', pattern: /\b(?:finds?|discovers?|notices?|learns?|uncovers?|realizes?)\b/i },
  { type: 'conflict', pattern: /\b(?:attacks?|attacked|fights?|confronts?|threatens?|chases?|ambushes?|ambushed|rescues?|rescued|accuses?)\b/i },
  { type: 'choice', pattern: /\b(?:chooses?|decides?|must choose|has to decide)\b/i },
  { type: 'aftermath', pattern: /\b(?:afterward|aftermath|fallout|consequence|goes public|goes viral|spreads|writes?|drafts?|posts?|publishes?|starts?\s+(?:a\s+)?blog)\b/i },
  { type: 'reveal', pattern: /\b(?:reveals?|exposes?|confirms?|shows?)\b/i },
  { type: 'relationship_shift', pattern: /\b(?:trusts?|betrays?|befriends?|become\s+friends|rejects?|forgives?|protects?|forms?\s+(?:the\s+)?\w+\s+club)\b/i },
  { type: 'state_change', pattern: /\b(?:becomes?|changes?|loses?|gains?|is wounded|is trapped|is freed)\b/i },
];

const TIME_CUE_PATTERN = /\b(?:dawn|morning|midday|afternoon|dusk|evening|night|midnight|later|afterward|the next day|next morning|same night|earlier|before|after|at\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\b/i;
const LOCATION_PATTERN = /\b(?:at|in|inside|outside|on|near|through|to|from)\s+((?:the\s+)?[A-Z][A-Za-z0-9'’-]*(?:\s+[A-Z][A-Za-z0-9'’-]*){0,3})/g;
const ENTITY_PATTERN = /\b[A-Z][A-Za-z0-9'’-]*(?:\s+[A-Z][A-Za-z0-9'’-]*){0,2}\b/g;
const CONNECTOR_SPLIT = /\s+(?:and then|but then|then|afterward|afterwards|before|while|as)\s+/i;

export function atomizeTreatmentText(input: TreatmentAtomizerInput): TreatmentEventAtom[] {
  // LLM-sourced contracts can arrive without sourceText/eventAtoms — an
  // absent text has no events to atomize, it is not a crash.
  if (!input.text?.trim()) return [];
  const sourceSentences = splitTreatmentSentences(input.text);
  const atoms: TreatmentEventAtom[] = [];
  let order = 0;
  for (const sentence of sourceSentences) {
    const atomSentence = stripPlayableFieldLabel(sentence);
    const fragments = splitCompoundSentence(atomSentence);
    for (const fragment of fragments) {
      const trimmed = normalizeWhitespace(fragment);
      if (!trimmed) continue;
      const playable = input.forceStage || isPlayableTreatmentEvent(trimmed);
      const eventText = playable ? concreteEventText(trimmed) : trimmed;
      const metadata = eventCueMetadata(eventText, playable, input.forceStage);
      order += 1;
      atoms.push({
        id: `${input.idPrefix || `ep${input.episodeNumber}`}-atom-${order}`,
        episodeNumber: input.episodeNumber,
        order,
        sourceText: sentence,
        eventText,
        eventType: playable ? inferEventType(eventText) : 'context',
        chronologyKey: buildChronologyKey(eventText),
        requiredEntities: extractEntities(eventText),
        requiredLocations: extractLocations(eventText),
        timeCue: extractTimeCue(eventText),
        preservedMarkers: extractPreservedMarkers(eventText),
        realizationMode: playable ? 'dramatize' : 'context_only',
        sourceSection: input.sourceSection,
        isPlayableEvent: playable,
        ...metadata,
      });
    }
  }
  return atoms;
}

export function isPlayableTreatmentEvent(text: string): boolean {
  const trimmed = normalizeWhitespace(text);
  if (trimmed.length < 12) return false;
  if (NON_PLAYABLE_PATTERNS.some(({ pattern }) => pattern.test(trimmed))) return false;
  return ACTION_PATTERNS.some(({ pattern }) => pattern.test(trimmed));
}

export function splitTreatmentSentences(text: string): string[] {
  return normalizeWhitespace(text)
    .split(/(?<=[.!?])\s+|\n+/)
    .map((part) => part.trim().replace(/^[-*]\s+/, ''))
    .filter(Boolean);
}

export function splitCompoundSentence(sentence: string): string[] {
  const normalized = normalizeWhitespace(sentence);
  const commaThenSplit = normalized.replace(/\s*,\s*(?=(?:then|afterward|afterwards|before|while|as)\b)/gi, ' ');
  if (!CONNECTOR_SPLIT.test(commaThenSplit)) return [normalized];
  const fragments = commaThenSplit.split(CONNECTOR_SPLIT).map((part) => part.trim()).filter(Boolean);
  if (fragments.length <= 1) return [normalized];
  return fragments.map((fragment, index) => {
    if (index === 0) return fragment;
    return /^[A-Z]/.test(fragment) ? fragment : fragment.replace(/^([a-z])/, (match) => match.toUpperCase());
  });
}

function stripPlayableFieldLabel(text: string): string {
  return normalizeWhitespace(text.replace(PLAYABLE_FIELD_LABEL, ''));
}

function eventCueMetadata(
  eventText: string,
  playable: boolean,
  forceStage = false,
): Pick<TreatmentEventAtom, 'eventCues' | 'dramaticPriority' | 'sceneKindHint' | 'ownershipIntent'> {
  if (!playable) {
    return {
      ownershipIntent: forceStage ? 'must_stage' : supportIntentForContext(eventText),
      dramaticPriority: forceStage ? 20 : 0,
      sceneKindHint: forceStage ? 'standard' : undefined,
    };
  }
  const cueSet = detectPrimaryStoryEventCues(eventText);
  const cues = Array.from(cueSet) as StoryEventCue[];
  const cuePriority = cues.reduce((max, cue) => Math.max(max, STORY_EVENT_CUE_ORDER[cue] ?? 0), 0);
  const dramaticPriority = cuePriority + (cueSet.has('threatEncounter') ? 40 : 0);
  return {
    eventCues: cues,
    dramaticPriority,
    sceneKindHint: cueSet.has('threatEncounter') ? 'encounter' : 'standard',
    ownershipIntent: 'must_stage',
  };
}

function supportIntentForContext(text: string): TreatmentEventAtom['ownershipIntent'] {
  if (LEDGER_ONLY_CONTEXT_RE.test(text)) return 'ledger_only';
  if (SUPPORT_CONTEXT_RE.test(text)) return 'may_support';
  return 'ledger_only';
}

export function inferEventType(text: string): TreatmentEventType {
  return ACTION_PATTERNS.find(({ pattern }) => pattern.test(text))?.type || 'state_change';
}

export function buildChronologyKey(text: string): string {
  const normalized = text
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length > 2 && !STOPWORDS.has(token))
    .slice(0, 8)
    .join('-');
  return normalized || 'event';
}

function concreteEventText(text: string): string {
  return text
    .replace(/\b(?:in order to|so that)\b.*$/i, '')
    .replace(/\b(?:establishing|establishes|serves|symbolizes|foreshadows)\b.*$/i, '')
    .replace(/\s*,\s*$/, '')
    .trim();
}

function extractTimeCue(text: string): string | undefined {
  return text.match(TIME_CUE_PATTERN)?.[0];
}

/** Times, numbers, and quoted codenames that must survive paraphrase. */
export function extractPreservedMarkers(text: string): string[] {
  const markers = new Set<string>();
  const time = extractTimeCue(text);
  if (time) markers.add(time);
  for (const match of text.matchAll(/\b\d{1,3}(?:,\d{3})*(?:\+|k|K)?\b/g)) {
    if (match[0]) markers.add(match[0]);
  }
  for (const match of text.matchAll(/["“]([^"”]{2,40})["”]/g)) {
    const quoted = match[1]?.trim();
    if (quoted) markers.add(quoted);
  }
  // Common viral/scale markers when present in treatment text.
  for (const match of text.matchAll(/\b(?:viral|gone viral|4\s*a\.?m\.?|4am|codename)\b/gi)) {
    if (match[0]) markers.add(match[0]);
  }
  return Array.from(markers).slice(0, 8);
}

function extractLocations(text: string): string[] {
  const found = new Set<string>();
  for (const match of text.matchAll(LOCATION_PATTERN)) {
    const location = normalizeEntity(match[1]);
    if (location && !GENERIC_CAPITALIZED_WORDS.has(location.toLowerCase())) found.add(location);
  }
  return Array.from(found).slice(0, 6);
}

function extractEntities(text: string): string[] {
  const found = new Set<string>();
  for (const match of text.matchAll(ENTITY_PATTERN)) {
    const entity = normalizeEntity(match[0]);
    if (!entity || GENERIC_CAPITALIZED_WORDS.has(entity.toLowerCase())) continue;
    found.add(entity);
  }
  return Array.from(found).slice(0, 8);
}

function normalizeEntity(value: string): string {
  return normalizeWhitespace(value.replace(/^(?:the|a|an)\s+/i, ''));
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

const STOPWORDS = new Set([
  'the', 'and', 'but', 'then', 'that', 'with', 'from', 'into', 'onto', 'near', 'inside', 'outside',
  'after', 'before', 'while', 'where', 'when', 'this', 'their', 'there', 'they', 'them', 'her',
  'his', 'its', 'you', 'your', 'she', 'he', 'has', 'have', 'had', 'was', 'were', 'will',
]);

const GENERIC_CAPITALIZED_WORDS = new Set([
  'episode', 'story', 'scene', 'act', 'hook', 'plot', 'turn', 'midpoint', 'climax', 'resolution',
  'choice', 'character', 'protagonist', 'theme', 'morning', 'night', 'afternoon', 'evening',
]);
