import { getStoryLexicon, lexiconAlternation, lexiconMatcher } from '../config/storyLexicon';

export type StoryEventCue =
  | 'arrival'
  | 'venueDoor'
  | 'objectHandoff'
  | 'socialMeet'
  | 'threatEncounter'
  | 'roadBreakdown'
  | 'friendDebrief'
  | 'lateNightWriting'
  | 'antagonistContact'
  | 'blogAftermath'
  | 'endingAftermath'
  | 'walkHome';

export const STORY_EVENT_CUE_ORDER: Partial<Record<StoryEventCue, number>> = {
  arrival: 10,
  venueDoor: 20,
  objectHandoff: 30,
  socialMeet: 40,
  threatEncounter: 50,
  walkHome: 60,
  lateNightWriting: 70,
  antagonistContact: 75,
  blogAftermath: 80,
};

/**
 * Human-readable event descriptions for LLM feedback prompts — used when a
 * generated sentence introduces a staged event cue the scene must not own
 * (e.g. the turn re-author inventing "an anonymous message arrives" gave the
 * scene antagonistContact ownership and broke route chronology, bite-me
 * 2026-07-07 s1-7 second abort).
 */
export const STORY_EVENT_CUE_DESCRIPTIONS: Record<StoryEventCue, string> = {
  arrival: 'arriving in a new city or place for the first time',
  venueDoor: 'entering or being turned away at a venue door',
  objectHandoff: 'an object being handed over or received',
  socialMeet: 'a first meeting or social introduction',
  threatEncounter: 'an attack, ambush, or physical threat',
  roadBreakdown: 'a vehicle breakdown or being stranded on the road',
  friendDebrief: 'debriefing or confiding in a friend afterwards',
  lateNightWriting: 'writing, drafting, or publishing a post/blog',
  antagonistContact: 'an anonymous or hidden sender making contact (message, note, call)',
  blogAftermath: 'a published post going viral / readership blowing up',
  endingAftermath: 'the episode-ending aftermath or cliffhanger fallout',
  walkHome: 'being walked or escorted home',
};

/**
 * A staged anchor/signature moment must be a stageable EVENT, not a rhetorical
 * question or abstract pressure. Question-shaped text ("Can Kylie start
 * over…?") gives SceneWriter nothing to depict: as an encounter anchor it
 * becomes an abstract shell scene (bite-me 2026-07-02 treatment-enc-1-1); as
 * a signature device the prose reads as negation and
 * SignatureDevicePresenceValidator flags INVERTED (bite-me 2026-07-03 s1-5).
 */
export function isQuestionShapedAnchor(value: string | undefined): boolean {
  const text = (value ?? '').trim();
  if (!text) return true;
  if (/\?\s*$/.test(text)) return true;
  return /^(?:can|could|will|would|should|does|do|did|is|are|was|were|who|what|when|where|why|how)\b/i.test(text);
}

export function normalizeEventCueText(value: string | undefined): string {
  return (value ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function hasPublicWritingActionCueText(text: string): boolean {
  const writingObject = /\b(?:blog|post|column|newsletter|site|account|feed|journal|diary|publication|dispatch|public account|public story|anonymous story|anonymous post|codename|title)\b/;
  const explicitWritingMoment = /\b(?:[234]\s*a\s*m|[234]\s*am|late night|unable to sleep|numbers in (?:her|your|their) phone|dictionary|draft|blank page|publish button)\b/;
  // The writing ACTION must act on the writing OBJECT (proximity window, like
  // every other cue in this file). Independent presence anywhere in the text
  // conflated "write under her own name … The blog …" — an identity aspiration
  // plus a season-anchor reference — into a staged first-post event (bite-me
  // 2026-07-07 s1-7 SceneConstructionGate abort).
  const writingActionAlt = 'writes?|wrote|drafts?|drafted|types?|typed|posts|posted|publishes|published|publish|chooses?\\s+(?:a\\s+)?codename|chooses?\\s+(?:a\\s+)?title';
  const writingObjectAlt = 'blog|post|column|newsletter|site|account|feed|journal|diary|publication|dispatch|public account|public story|anonymous story|anonymous post|codename|title';
  const actsOnWritingObject = new RegExp(`\\b(?:${writingActionAlt})\\b.{0,100}\\b(?:${writingObjectAlt})\\b`).test(text)
    || new RegExp(`\\b(?:${writingObjectAlt})\\b.{0,100}\\b(?:${writingActionAlt})\\b`).test(text);
  const concreteWritingAction = new RegExp(`\\b(?:${writingActionAlt})\\b`);
  return actsOnWritingObject
    || (explicitWritingMoment.test(text) && (concreteWritingAction.test(text) || writingObject.test(text)));
}

export function detectStoryEventCues(value: string | undefined): Set<StoryEventCue> {
  const text = normalizeEventCueText(value);
  const cues = new Set<StoryEventCue>();
  if (!text) return cues;

  const travelArrival = /\b(?:lands?|arrives?|arrival|unpacks?)\b.{0,120}\b(?:city|town|village|home|apartment|room|airport|station|dock|suitcases?|address)\b/.test(text)
    || /\b(?:city|town|village|home|apartment|room|airport|station|dock|suitcases?|address)\b.{0,120}\b(?:lands?|arrives?|arrival|unpacks?)\b/.test(text)
    || /\b(?:suitcases?|airport|station|dock|first room|new home|new city)\b/.test(text);
  const nonTravelArrival = /\b(?:message|invitation|email|text|reply|notification|bubble|letter|memory|rescuer|stranger|offer|answer)\s+arrives?\b/.test(text)
    || /\barriv(?:es?|al)\s+of\s+(?:a\s+)?(?:message|invitation|email|text|reply|notification|letter|memory|rescuer|stranger|offer|answer)\b/.test(text);
  if (travelArrival && !nonTravelArrival) {
    cues.add('arrival');
  }

  const explicitVenueDoor = /\b(?:side entrance|key card|keycard|club door|venue door|private door|service entrance|back room)\b/.test(text)
    || /\b(?:club|venue|entrance)\b.{0,120}\b(?:key card|keycard|private|side|service|invitation)\b/.test(text)
    || /\b(?:key card|keycard|private|side|service|invitation)\b.{0,120}\b(?:club|venue|entrance)\b/.test(text);
  if (explicitVenueDoor) {
    cues.add('venueDoor');
  }

  // Generic handoff nouns + story-signature ones from the lexicon (Phase 6).
  const handoffNouns = lexiconAlternation(['stone', 'token', 'talisman', 'amulet', 'gift', 'ward', ...getStoryLexicon().handoffObjectNouns]);
  const objectNoun = new RegExp(`\\b(?:bookshop|bookstore|shop|${handoffNouns})\\b`).test(text);
  const objectTransfer = new RegExp(`\\b(?:gives?|hands?|presses?|slides?|passes?|offers?)\\b.{0,120}\\b(?:${handoffNouns})\\b|\\b(?:${handoffNouns})\\b.{0,120}\\b(?:gives?|hands?|presses?|slides?|passes?|offers?)\\b`).test(text);
  if (objectTransfer || (objectNoun && /\b(?:protective|protection|consent|gift|token|talisman|amulet|ward)\b/.test(text))) {
    cues.add('objectHandoff');
  }

  // Generic group nouns + named story groups from the lexicon (e.g. "Dusk Club").
  const groupNouns = lexiconAlternation(['club', 'circle', 'crew', 'group', 'friends?', 'allies', 'companions', 'table', 'booth', 'bar', 'party', ...getStoryLexicon().socialGroupNames]);
  const namedGroupRe = lexiconMatcher(getStoryLexicon().socialGroupNames, 'i');
  const socialGroupFormation = new RegExp(`\\b(?:forms?|founds?|gathers?|joins?|meets?|convenes?|assembles?|pulls together)\\b.{0,100}\\b(?:${groupNouns})\\b`).test(text)
    || new RegExp(`\\b(?:${groupNouns})\\b.{0,100}\\b(?:forms?|founds?|gathers?|joins?|meets?|convenes?|assembles?|pulls together)\\b`).test(text)
    || (namedGroupRe.test(text) && /\b(?:form(?:s|ed)?|found(?:s|ed)?|join(?:s|ed)?|toast|official|we'?re a thing|become friends)\b/i.test(text));
  const socialMeetPhrases = lexiconAlternation(['rooftop', 'roof', 'terrace', 'bar', 'party', 'table', 'booth', 'dance floor', 'first meet', 'first meeting', 'social triangle', ...getStoryLexicon().socialMeetPhrases]);
  if (socialGroupFormation || new RegExp(`\\b(?:${socialMeetPhrases})\\b`).test(text)) {
    cues.add('socialMeet');
  }

  const rescueRecap = /\b(?:story|post|blog|prose|draft|codename|title|viral|proof|retelling|turns?|turned|writes?|wrote|publish(?:es|ed)?)\b.{0,100}\b(?:rescues?|rescued|rescue|terror|attack(?:ed)?)\b/.test(text)
    || /\b(?:rescues?|rescued|rescue|terror|attack(?:ed)?)\b.{0,100}\b(?:story|post|blog|prose|draft|codename|title|viral|proof|retelling|turns?|turned|writes?|wrote|publish(?:es|ed)?)\b/.test(text);
  const violentGrip = /\b(?:attacker|aggressor|rough hands?|hands?|fingers?)\b.{0,80}\bgrip\b/.test(text)
    || /\bgrip\b.{0,80}\b(?:arm|wrist|throat|coat|collar|bicep|shoulder|skin|bone|pain|bruise|breath|attacker|aggressor)\b/.test(text);
  // Strip metaphorical "sounding like a threat" / "without yet sounding like a
  // threat" before the live-threat lexicon — those are social-pressure lines,
  // not attack/ambush set pieces (Bite Me Ep3 privacy framing false positive).
  const threatLexiconText = text.replace(
    /\b(?:sound(?:s|ing)?|seem(?:s|ing)?|feel(?:s|ing)?)\s+like\s+a\s+threat\b/gi,
    ' ',
  );
  const liveThreatAction = /\b(?:pinned|attacker|attacks?|attacked|aggressor|knife|scream|freeze|fight back|lunges?|chases?|ambush|threat|rough hands?|grab(?:s|bed)?|don't scream)\b/.test(threatLexiconText)
    || violentGrip
    || /\b(?:can stand|can you stand|asks if (?:she|he|you|they) can stand)\b/.test(text);
  const directThreat = liveThreatAction
    || (!rescueRecap && /\b(?:rescues?|rescued|rescue)\b/.test(text));
  const threatPlace = /\b(?:park|garden|alley|street|shadow)\b/.test(text) && /\b(?:attacker|attacks?|attacked|aggressor|knife|scream|fight|rescues?|rescued|rescue|ambush|threat|danger)\b/.test(text);
  if (directThreat || (threatPlace && !rescueRecap)) {
    cues.add('threatEncounter');
  }

  // A determiner+"walk home" noun phrase ("the attack, the rescue, the walk
  // home") names the event in a recounting rather than staging it — strip it
  // before the verb test (keep in sync with RouteContinuityValidator
  // WALK_HOME_NOUN_PHRASE and the sceneEventOwnership twin).
  const walkHomeText = text.replace(/\b(?:the|a|an|that|this|her|his|their|our|my|your|its) walk home\b/g, ' ');
  if (/\b(?:walks?|takes?|escorts?|sees?)\b.{0,80}\b(?:you|her|him|them|the protagonist)?\s*home\b/.test(walkHomeText)) {
    cues.add('walkHome');
  }

  if (hasRoadBreakdownCueText(text)) {
    cues.add('roadBreakdown');
  }

  if (/\b(?:debrief|convenes?|regroups?|recaps?|friend group|after date|afterdate|checks in|compares notes|group chat)\b/.test(text)) {
    cues.add('friendDebrief');
  }

  // Phrasal "start(s) over" means "begin anew", not "launch a publication" —
  // strip it before the launch-verb test so "start over … the blog" (bite-me
  // 2026-07-07 s1-7) cannot read as founding the blog.
  const launchText = text.replace(/\b(?:starts?|started|starting) over\b/g, ' ');
  const publicWritingLaunch = /\b(?:starts?|launches?|founds?|opens?|creates?|begins?)\b.{0,100}\b(?:blog|post|column|newsletter|site|account|feed|journal|diary|publication|dispatch|public account|public story)\b/.test(launchText)
    || /\b(?:blog|post|column|newsletter|site|account|feed|journal|diary|publication|dispatch|public account|public story)\b.{0,100}\b(?:starts?|launches?|founds?|opens?|creates?|begins?)\b/.test(launchText);
  if (publicWritingLaunch || hasPublicWritingActionCueText(text)) {
    cues.add('lateNightWriting');
  }

  // First contact from a hidden/unknown watcher: an unsolicited comment, DM,
  // or message from an anonymous/new/private sender. Staged fresh THREE times
  // in bite-me 2026-07-03 (blog comment, private DM, formal-account comment)
  // because nothing owned the event.
  const anonymousSender = /\b(?:anonymous|unknown|unsigned|unfamiliar|new user|private account|formal account|no name|initials?|admirer|watcher)\b/;
  const contactArtifact = /\b(?:comment|message|dm|direct message|reply|note|notification)\b/;
  const contactVerb = /\b(?:leaves?|left|arrives?|arrived|appears?|appeared|sends?|sent|writes?|wrote|posts?|posted|flashes?)\b/;
  const contactFromSender = /\b(?:comment|message|dm|direct message|reply|note|notification)\b.{0,60}\bfrom\b.{0,50}\b(?:anonymous|unknown|unsigned|unfamiliar|new user|private account|formal account|no name|initials?|admirer|watcher)\b/;
  const senderWithContact = /\b(?:anonymous|unknown|unsigned|unfamiliar|new user|private account|formal account|no name|admirer|watcher)\b.{0,60}\b(?:with|leaves?|left|writes?|wrote|posts?|posted|sends?|sent)\b.{0,50}\b(?:comment|message|dm|direct message|reply|note|notification)\b/;
  if (
    contactFromSender.test(text)
    || senderWithContact.test(text)
    || (anonymousSender.test(text) && contactArtifact.test(text) && contactVerb.test(text))
  ) {
    cues.add('antagonistContact');
  }

  const publicBlogAftermath = (/\b(?:readership|viral|views?|comments?|dashboard|profile|public pressure|public signal|broke the internet|audience growth|attention spike)\b/.test(text)
    || /\b\d[\d,]*\s+reads?\b/.test(text))
    && !/\b(?:could|might|may|has to|need(?:s)? to|going to|will)\s+(?:go\s+)?viral\b/.test(text)
    && !/\b(?:[234]\s*a\s*m|[234]\s*am|draft|cursor|blank page|publish button|write|writing|writes?|publishes|published)\b/.test(text);
  if (publicBlogAftermath) {
    cues.add('blogAftermath');
  }

  const endingPhrases = lexiconAlternation(['cliffhanger', 'episode end', ...getStoryLexicon().endingAftermathPhrases]);
  if (new RegExp(`\\b(?:${endingPhrases})\\b`).test(text)) {
    cues.add('endingAftermath');
  }

  return cues;
}

export function detectPrimaryStoryEventCues(value: string | undefined): Set<StoryEventCue> {
  const text = normalizeEventCueText(value);
  const cues = detectStoryEventCues(value);
  if (!text) return cues;

  if (cues.has('venueDoor') && /\b(?:email|message|text|notification|comment|profile|blog|post|online|reader|request)\b/.test(text)) {
    cues.delete('venueDoor');
  }

  if (cues.has('threatEncounter')) {
    // A recounting/writing context that names "the attack" as a determiner
    // noun phrase is a REFERENCE, not a staging (bite-me 2026-07-04 scene-4:
    // "frame your blog post about … the attack" / "describe the terrifying
    // attack" owned threatEncounter, duplicating the real ambush scene and
    // hard-aborting SceneConstructionGate). Mirror the walkHome
    // determiner-noun-phrase strip before the live-threat verb test; fresh
    // staging verbs ("attacks", "lunges", "grabs") survive the strip.
    const recapContext = /\b(?:story|stories|post|posts|blog|prose|draft|codename|title|viral|proof|retelling|frames?|framed|recounts?|describes?|writes?|wrote|writing|publish(?:es|ed)?)\b/.test(text);
    const threatText = recapContext
      ? text.replace(/\b(?:the|a|an|that|this|her|his|their|our|my|your|its)\s+(?:\w+\s+){0,2}?attack\b/g, ' ')
      : text;
    const violentGrip = /\b(?:attacker|aggressor|rough hands?|hands?|fingers?)\b.{0,80}\bgrip\b/.test(threatText)
      || /\bgrip\b.{0,80}\b(?:arm|wrist|throat|coat|collar|bicep|shoulder|skin|bone|pain|bruise|breath|attacker|aggressor)\b/.test(threatText);
    const liveThreat = /\b(?:attacker|attacks?|attacked|aggressor|knife|scream|fight back|lunges?|chases?|ambush|rough hands?|grab(?:s|bed)?|don't scream)\b/.test(threatText)
      || violentGrip;
    const liveRescue = /\b(?:rescues?|rescued|rescue|saves?|saved)\b/.test(threatText)
      && /\b(?:attacker|attacks?|attacked|aggressor|knife|scream|fight|park|garden|alley|street|fog|shadow|hands?|grab(?:s|bed)?)\b/.test(threatText);
    if (!liveThreat && !liveRescue) cues.delete('threatEncounter');
  }

  return cues;
}

/**
 * Realization-side cue detection: everything detectPrimaryStoryEventCues
 * finds, plus generous synonyms for cues whose prose stagings rarely use the
 * planning vocabulary. Ownership ASSIGNMENT must stay conservative (a loose
 * detector would spray ownership across scenes), but ownership ENFORCEMENT
 * must be generous — prose that stages a walk home as "the walk to your
 * apartment … you reach your door … he waits at the threshold" depicts the
 * event without ever saying "walks her home" (bite-me 2026-07-05:
 * treatment-enc-1-1 staged the escorted walk home on-page and still blocked
 * on TreatmentEventLedgerValidator's owned-cue check).
 */
export function detectRealizedStoryEventCues(value: string | undefined): Set<StoryEventCue> {
  const cues = detectPrimaryStoryEventCues(value);
  const text = normalizeEventCueText(value);
  if (!text) return cues;

  if (!cues.has('walkHome')) {
    const walkText = text.replace(/\b(?:the|a|an|that|this|her|his|their|our|my|your|its) walk home\b/g, ' ');
    const escortToDwelling = /\b(?:walks?|walking|walked|escorts?|escorting|guides?|guiding|leads?|leading|takes?)\b.{0,80}\b(?:home|apartment|threshold|door(?:step|way)?|building)\b/.test(walkText);
    const dwellingArrival = /\b(?:reach(?:es|ed)?|arriv(?:es?|ed|ing) at)\s+(?:your|her|his|their|my)\s+(?:door(?:step|way)?|threshold|apartment|building)\b/.test(walkText);
    if (escortToDwelling || dwellingArrival) cues.add('walkHome');
  }

  return cues;
}

function hasRoadBreakdownCueText(text: string): boolean {
  if (/\b(?:roadside|mountain road|broken down|breaks down|cab breaks|country road)\b/.test(text)) return true;
  const signals = [
    /\bcab\b/,
    /\btow\b/,
    /\broad\b/,
    /\blift\b/,
    /\bdriver\b/,
    /\bstranger\b/,
    /\bbreakdown\b/,
    /\bflat tire\b/,
    /\bengine\b/,
    /\bcountry\b/,
    /\bremote\b/,
    /\bdiner\b/,
  ];
  return signals.filter((pattern) => pattern.test(text)).length >= 2;
}
