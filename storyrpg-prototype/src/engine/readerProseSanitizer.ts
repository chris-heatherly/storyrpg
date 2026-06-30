const UNSAFE_READER_PROSE_PATTERNS: RegExp[] = [
  /\bstill changes how this moment lands\b/i,
  /\bleaves a visible residue\b/i,
  /\bstill colors how (?:everyone|the player|you|they)\s+enters?\b/i,
  /\bthe path here still matters\b/i,
  /\bthe (?:route|path) chosen before this moment\b/i,
  /\bThe\s+aftermath\s+changes\s+what\s+characters\s+say,\s*hide,\s*risk,\s*or\s*trust\b/i,
  /\bThe\s+consequence\s+stays\s+visible\s+through\s+changed\s+access,\s*posture,\s*information,\s*or\s*danger\b/i,
  /\bLater\s+pressure\s+can\s+return\s+through\s+trust,\s*knowledge,\s*access,\s*or\s*risk\b/i,
  /\bThe\s+answer\s+changes\s+what\s+can\s+be\s+safely\s+said\s+next\b/i,
  /\bLater\s+scenes\s+should\s+remember\s+how\s+this\s+changed\s+access,\s*posture,\s*information,\s*risk,\s*or\s*trust\b/i,
  /\bThe\s+aftermath\s+stays\s+visible\s+in\s+what\s+characters\s+offer,\s*hide,\s*risk,\s*or\s*refuse\b/i,
  /\bthe next threshold waits ahead\b/i,
  /\bthe path forward is set\b/i,
  /\bthe moment lands immediately\b/i,
  /\byour understanding changes\b/i,
  /\ba relationship shifts\b/i,
  /\byour reputation shifts\b/i,
  /\bthe danger around you changes\b/i,
  /\byour identity shifts\b/i,
  /\byour leverage changes\b/i,
  /\byour resources change\b/i,
  /\bthe choice changed the shape of the story\b/i,
  /\bthe selected (?:route|choice) changes the next scene\b/i,
  /\b(?:later narration remembers which|which) path the player chose\b/i,
  /\bthe world gives up a little more of its pattern\b/i,
  /\bordinary\s+world\s+is\s+[^.!?\n]{1,180}/i,
  /(?:^|[.!?]\s+)(?:her|his|their|your)\s+grandmother['’]s\s+address\s*[.!?](?:\s|$)/i,
  /\bprotects\s+herself\s+(?:the\s+way\s+she\s+always\s+has|by\s+observing|through\s+observing)\b/i,
  /\bOpening\s+promise\s*:/i,
  /\breinvention-as-performance\b/i,
  /\bnext[-\s]+scene\s+pressure\b/i,
  /\bprovide\s+aftermath\s+or\s+a\s+grounded\s+transition\s+into\s+the\s+next\s+scene\b/i,
  /\b(?:viral|public)\s+attention\s+pressure\s+the\s+next\s+scene\b/i,
  /\bHand\s+the\s+changed\s+state\s+into\s+the\s+next\s+scene\b/i,
  /(?:^|[.!?]\s+)\s*development\s+scene\s+\d+\s*\.?\s*(?:$|[.!?])/i,
  /(?:^|[.!?]\s+)\s*PEAK\s*:/i,
  /\bwhat\s+name\s+do\s+you\s+give\s+him\b[^.!?\n]*(?:canonical|the\s+stranger|the\s+velvet|the\s+suit)/i,
  /\bscream\s*,\s*run\s*,\s*freeze\b[^.!?\n]*\bwhat\s+name\s+do\s+you\s+give\s+him\b/i,
  /\bmidnight\s*\(canonical\)[^.!?\n]*(?:the\s+stranger|the\s+velvet|the\s+suit)/i,
  /\byou made a choice\b/i,
  /^\s*you chose\b/i,
  /\bpeople remember what the protagonist risked\b/i,
  /\bthe protagonist\b/i,
  /\baccess,\s*trust,\s*and\s*pressure have already shifted\b/i,
  /\bAftermath that resettles stakes;\s*serves\b/i,
  /\bserves\s+the\s+(?:hook|plotTurn1|pinch1|midpoint|pinch2|climax|resolution)\s+beat\b/i,
  /\bForward pressure\s*:/i,
  /\bcomposed surface slips through a small evasive movement\b/i,
  /\bsmall evasive movement\b/i,
  /\bposture,\s*glance,\s*and\s*distance make the unspoken tension visible\b/i,
  /\bhands and attention lock onto\b[^.!?\n]*\bmaking the subtext visible\b/i,
  /\bmaking the subtext visible\b/i,
  /\bvisibly changing the balance of the moment\b/i,
  /\b(?:smile|averted eyes|busy hands)\b[^.!?\n]*\bbetray what the words avoid\b/i,
  /\bthe character reacts through a visible gesture,\s*object cue,\s*or shift in distance\b/i,
];

const AUDIO_DIRECTIVE_RE = /\s*(?:\[(?:whispering|hushed|urgent|tense|tender|playful|commanding|bitter|grief-held|breathless|triumphant|ominous|measured|pause|beat|sigh|laughs?|crying|softly|loudly|angrily|sadly)[^\]]*\]|<\s*\/?\s*(?:voice|prosody|speak|break|emphasis)\b[^>]*>)/gi;

function stripAudioDirectives(text: string): string {
  return text.replace(AUDIO_DIRECTIVE_RE, ' ').replace(/\s{2,}/g, ' ').trim();
}

function isUnsafeReaderProse(text: string): boolean {
  return UNSAFE_READER_PROSE_PATTERNS.some((pattern) => pattern.test(text));
}

/**
 * Last-line defense for generated/cached reader prose. Generation validators
 * should prevent these structural notes, but playback must not render them if
 * an older package or saved text variant still contains one.
 */
export function sanitizeReaderProse(text: string): string {
  const audioSafeText = stripAudioDirectives(text || '');
  if (!audioSafeText || !isUnsafeReaderProse(audioSafeText)) return audioSafeText;

  const paragraphs = audioSafeText
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .filter((paragraph) => !isUnsafeReaderProse(paragraph));

  if (paragraphs.length > 0) {
    return paragraphs.join('\n\n');
  }

  const sentences = (audioSafeText.match(/[^.!?]+[.!?]+(?:\s+|$)|[^.!?]+$/g) ?? [])
    .map((sentence) => sentence.trim())
    .filter(Boolean)
    .filter((sentence) => /[A-Za-z0-9]/.test(sentence))
    .filter((sentence) => !isUnsafeReaderProse(sentence));

  return sentences.join(' ');
}
