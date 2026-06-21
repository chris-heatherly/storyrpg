const UNSAFE_READER_PROSE_PATTERNS: RegExp[] = [
  /\bstill changes how this moment lands\b/i,
  /\bleaves a visible residue\b/i,
  /\bstill colors how (?:everyone|the player|you|they)\s+enters?\b/i,
  /\bthe path here still matters\b/i,
  /\bthe (?:route|path) chosen before this moment\b/i,
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
  /\byou made a choice\b/i,
  /^\s*you chose\b/i,
  /\bpeople remember what the protagonist risked\b/i,
  /\bthe protagonist\b/i,
  /\baccess,\s*trust,\s*and\s*pressure have already shifted\b/i,
  /\bAftermath that resettles stakes;\s*serves\b/i,
  /\bserves\s+the\s+(?:hook|plotTurn1|pinch1|midpoint|pinch2|climax|resolution)\s+beat\b/i,
  /\bForward pressure\s*:/i,
];

function isUnsafeReaderProse(text: string): boolean {
  return UNSAFE_READER_PROSE_PATTERNS.some((pattern) => pattern.test(text));
}

/**
 * Last-line defense for generated/cached reader prose. Generation validators
 * should prevent these structural notes, but playback must not render them if
 * an older package or saved text variant still contains one.
 */
export function sanitizeReaderProse(text: string): string {
  if (!text || !isUnsafeReaderProse(text)) return text;

  const paragraphs = text
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .filter((paragraph) => !isUnsafeReaderProse(paragraph));

  if (paragraphs.length > 0) {
    return paragraphs.join('\n\n');
  }

  const sentences = (text.match(/[^.!?]+[.!?]+(?:\s+|$)|[^.!?]+$/g) ?? [])
    .map((sentence) => sentence.trim())
    .filter(Boolean)
    .filter((sentence) => /[A-Za-z0-9]/.test(sentence))
    .filter((sentence) => !isUnsafeReaderProse(sentence));

  return sentences.join(' ');
}
