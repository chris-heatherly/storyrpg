/**
 * Story lexicon (audit 2026-07-01, Phase 6 — de-overfit).
 *
 * Story-SPECIFIC vocabulary that had been hardcoded into general-purpose
 * detectors (storyEventCues, sceneLocationCues, RequiredBeatRealization,
 * EncounterProseIntegrity). Those heuristics now build their regexes from the
 * ACTIVE lexicon, so a different story can supply its own proper nouns and
 * plot phrases instead of silently false-negativing on Bite-Me's.
 *
 * ROLLOUT NOTE: the default is deliberately the Bite-Me lexicon for now —
 * this step is a pure vocabulary RELOCATION with byte-identical behavior
 * (goldens + the defect corpus replay unchanged). Flipping the default to
 * GENRE_NEUTRAL_LEXICON changes cue detection for existing fixtures and is
 * gated on a corpus/golden regen plus the owed live `=1` run, like every
 * other behavior flip. Callers (pipeline start) can already opt in per story
 * via setStoryLexicon().
 */

export interface StoryLexicon {
  /** Proper-noun places that collapse to a canonical cue (e.g. "Cișmigiu Gardens" → "cismigiu"). */
  signaturePlaces: string[];
  /** Named venues that qualify a generic club/venue cue (e.g. "valcescu" → "valcescu club"). */
  namedVenues: string[];
  /** Cities/settlements treated as ambient CONTAINERS, never conflicting locations. */
  containerCities: string[];
  /** Story-signature object nouns for the objectHandoff cue (generic token/talisman/etc. stay built in). */
  handoffObjectNouns: string[];
  /** Story-specific phrases that mark a social-meet beat. */
  socialMeetPhrases: string[];
  /** Named in-fiction social groups (e.g. "Dusk Club") whose formation is a trackable story event. */
  socialGroupNames: string[];
  /** Story-specific phrases that mark the episode-ending aftermath beat (regex fragments allowed). */
  endingAftermathPhrases: string[];
  /** Entities whose on-page presence realizes the season's central pressure. */
  seasonPressureEntities: string[];
  /** Anchor phrases that pair with a pressure entity (story title, motifs). */
  seasonPressureAnchorPhrases: string[];
  /** Concrete on-page prop nouns that ground a "hidden knowledge" beat (regex fragments allowed). */
  concreteOnPageCueNouns: string[];
  /** Corpus-derived nouns seen in the malformed-"you <noun>" corruption class (g22/g23). */
  malformedYouNouns: string[];
  /** The in-fiction publication title(s), used by blog-readership realization checks. */
  publicationTitles: string[];
}

/** Vocabulary mined from the Bite Me treatment + g10–g23 defect corpus. */
export const BITE_ME_LEXICON: StoryLexicon = {
  signaturePlaces: ['cismigiu'],
  namedVenues: ['valcescu'],
  containerCities: ['bucharest', 'new york', 'london', 'paris', 'rome', 'tokyo', 'los angeles'],
  handoffObjectNouns: ['quartz', 'crystal', 'charm'],
  socialMeetPhrases: ['podcast', 'kitchen entrance', 'notices across'],
  socialGroupNames: ['dusk club', 'our odd little club'],
  endingAftermathPhrases: ['9 ?am', 'dm pile', 'brand deal', 'message pile', 'horrible dream', 'coming over'],
  seasonPressureEntities: ['victor', 'charcoal', 'rescuer', 'savior', 'midnight'],
  seasonPressureAnchorPhrases: ['blog', 'dating after dusk', 'voice', 'chosen', 'saved', 'rescued', 'roses?', 'card'],
  concreteOnPageCueNouns: ['stray dog', 'courtyard', 'key ?card', 'card', 'quartz', 'herbs?', 'chain', 'necklace', 'letter', 'photo', 'phone', 'mirror', 'window', 'door', 'blood', 'hand', 'pocket', 'table'],
  malformedYouNouns: ['rooftop', 'bar', 'stair', 'same', 'charcoal', 'flannel', 'hedge', 'music', 'dark', 'threshold', 'room', 'club', 'glass', 'curtain', 'willow', 'attacker', 'boulevard', 'first', 'velvet', 'key(?:\\s+card)?', 'back-room', 'door', 'choice', 'candle', 'maze', 'lantern', 'inch', 'noticer', 'woman', 'night', 'pulse', 'watchfulness', 'grin', 'thing', 'catalogue'],
  publicationTitles: ['dating after dusk'],
};

/** Story-agnostic baseline: generic cues only, no proper nouns. */
export const GENRE_NEUTRAL_LEXICON: StoryLexicon = {
  signaturePlaces: [],
  namedVenues: [],
  containerCities: ['city center'],
  handoffObjectNouns: [],
  socialMeetPhrases: [],
  socialGroupNames: [],
  endingAftermathPhrases: ['cliffhanger', 'episode end'],
  seasonPressureEntities: [],
  seasonPressureAnchorPhrases: [],
  concreteOnPageCueNouns: ['letter', 'photo', 'phone', 'mirror', 'window', 'door', 'blood', 'hand', 'pocket', 'table'],
  malformedYouNouns: ['room', 'door', 'night', 'thing', 'woman', 'choice'],
  publicationTitles: [],
};

// See ROLLOUT NOTE above: defaults stay Bite-Me until the live-run-gated flip.
let activeLexicon: StoryLexicon = BITE_ME_LEXICON;

export function getStoryLexicon(): StoryLexicon {
  return activeLexicon;
}

/** Select the lexicon for the current run (pipeline start / tests). */
export function setStoryLexicon(lexicon: StoryLexicon): void {
  activeLexicon = lexicon;
}

/** Build a regex alternation from lexicon terms; null-safe for empty lists. */
export function lexiconAlternation(terms: string[]): string {
  return terms.filter(Boolean).join('|');
}

/**
 * Convenience: a `\b(?:a|b)\b`-style matcher for lexicon terms, or a
 * never-matching regex when the list is empty (so `.test()` is always safe).
 */
export function lexiconMatcher(terms: string[], flags = ''): RegExp {
  const alternation = lexiconAlternation(terms);
  return alternation ? new RegExp(`\\b(?:${alternation})\\b`, flags) : /(?!)/;
}
