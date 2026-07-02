import { getStoryLexicon, lexiconAlternation } from '../config/storyLexicon';

export type StoryEventCue =
  | 'arrival'
  | 'venueDoor'
  | 'objectHandoff'
  | 'socialMeet'
  | 'threatEncounter'
  | 'roadBreakdown'
  | 'friendDebrief'
  | 'lateNightWriting'
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
  blogAftermath: 80,
};

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
  const concreteWritingAction = /\b(?:writes?|wrote|drafts?|drafted|types?|typed|posts|posted|publishes|published|publish|chooses?\s+(?:a\s+)?codename|chooses?\s+(?:a\s+)?title)\b/;
  const explicitWritingMoment = /\b(?:[234]\s*a\s*m|[234]\s*am|late night|unable to sleep|numbers in (?:her|your|their) phone|dictionary|draft|blank page|publish button)\b/;
  return concreteWritingAction.test(text) && writingObject.test(text)
    || (explicitWritingMoment.test(text) && (concreteWritingAction.test(text) || writingObject.test(text)))
    || (/\b(?:publish|published|publishes)\b/.test(text) && writingObject.test(text));
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

  const socialGroupFormation = /\b(?:forms?|founds?|gathers?|joins?|meets?|convenes?|assembles?|pulls together)\b.{0,100}\b(?:club|circle|crew|group|friends?|allies|companions|table|booth|bar|party)\b/.test(text)
    || /\b(?:club|circle|crew|group|friends?|allies|companions|table|booth|bar|party)\b.{0,100}\b(?:forms?|founds?|gathers?|joins?|meets?|convenes?|assembles?|pulls together)\b/.test(text);
  const socialMeetPhrases = lexiconAlternation(['rooftop', 'roof', 'terrace', 'bar', 'party', 'table', 'booth', 'dance floor', 'first meet', 'first meeting', 'social triangle', ...getStoryLexicon().socialMeetPhrases]);
  if (socialGroupFormation || new RegExp(`\\b(?:${socialMeetPhrases})\\b`).test(text)) {
    cues.add('socialMeet');
  }

  const rescueRecap = /\b(?:story|post|blog|prose|draft|codename|title|viral|proof|retelling|turns?|turned|writes?|wrote|publish(?:es|ed)?)\b.{0,100}\b(?:rescues?|rescued|rescue|terror|attack(?:ed)?)\b/.test(text)
    || /\b(?:rescues?|rescued|rescue|terror|attack(?:ed)?)\b.{0,100}\b(?:story|post|blog|prose|draft|codename|title|viral|proof|retelling|turns?|turned|writes?|wrote|publish(?:es|ed)?)\b/.test(text);
  const violentGrip = /\b(?:attacker|aggressor|rough hands?|hands?|fingers?)\b.{0,80}\bgrip\b/.test(text)
    || /\bgrip\b.{0,80}\b(?:arm|wrist|throat|coat|collar|bicep|shoulder|skin|bone|pain|bruise|breath|attacker|aggressor)\b/.test(text);
  const liveThreatAction = /\b(?:pinned|attacker|attacks?|attacked|aggressor|knife|scream|freeze|fight back|lunges?|chases?|ambush|threat|rough hands?|grab(?:s|bed)?|don't scream)\b/.test(text)
    || violentGrip
    || /\b(?:can stand|can you stand|asks if (?:she|he|you|they) can stand)\b/.test(text);
  const directThreat = liveThreatAction
    || (!rescueRecap && /\b(?:rescues?|rescued|rescue)\b/.test(text));
  const threatPlace = /\b(?:park|garden|alley|street|shadow)\b/.test(text) && /\b(?:attacker|attacks?|attacked|aggressor|knife|scream|fight|rescues?|rescued|rescue|ambush|threat|danger)\b/.test(text);
  if (directThreat || (threatPlace && !rescueRecap)) {
    cues.add('threatEncounter');
  }

  if (/\b(?:walks?|takes?|escorts?|sees?)\b.{0,80}\b(?:you|her|him|them|the protagonist)?\s*home\b/.test(text)) {
    cues.add('walkHome');
  }

  if (hasRoadBreakdownCueText(text)) {
    cues.add('roadBreakdown');
  }

  if (/\b(?:debrief|convenes?|regroups?|recaps?|friend group|after date|afterdate|checks in|compares notes|group chat)\b/.test(text)) {
    cues.add('friendDebrief');
  }

  const publicWritingLaunch = /\b(?:starts?|launches?|founds?|opens?|creates?|begins?)\b.{0,100}\b(?:blog|post|column|newsletter|site|account|feed|journal|diary|publication|dispatch|public account|public story)\b/.test(text)
    || /\b(?:blog|post|column|newsletter|site|account|feed|journal|diary|publication|dispatch|public account|public story)\b.{0,100}\b(?:starts?|launches?|founds?|opens?|creates?|begins?)\b/.test(text);
  if (publicWritingLaunch || hasPublicWritingActionCueText(text)) {
    cues.add('lateNightWriting');
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
    const violentGrip = /\b(?:attacker|aggressor|rough hands?|hands?|fingers?)\b.{0,80}\bgrip\b/.test(text)
      || /\bgrip\b.{0,80}\b(?:arm|wrist|throat|coat|collar|bicep|shoulder|skin|bone|pain|bruise|breath|attacker|aggressor)\b/.test(text);
    const liveThreat = /\b(?:attacker|attacks?|attacked|aggressor|knife|scream|fight back|lunges?|chases?|ambush|rough hands?|grab(?:s|bed)?|don't scream)\b/.test(text)
      || violentGrip;
    const liveRescue = /\b(?:rescues?|rescued|rescue|saves?|saved)\b/.test(text)
      && /\b(?:attacker|attacks?|attacked|aggressor|knife|scream|fight|park|garden|alley|street|fog|shadow|hands?|grab(?:s|bed)?)\b/.test(text);
    if (!liveThreat && !liveRescue) cues.delete('threatEncounter');
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
