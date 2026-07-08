/**
 * Reduce treatment / Story Circle loglines to stageable event text.
 *
 * Character dossier language ("charming, wounded observer", "intent to rebuild
 * after a public breakup") is evidence for CharacterTreatment contracts, not a
 * gate for Arrival / Story Circle "you" final_prose depiction. Second-person
 * prose correctly never copies those adjectives, so demanding them makes
 * predicted-clear repair restore good arrival scenes forever
 * (bite-me 2026-07-08T00-01-23).
 */

const ROLE_APPOSITION_RE =
  /\s+as\s+(?:a|an|the)\s+(?:[\w-]+(?:,\s+[\w-]+)*)\s+(?:observer|writer|blogger|outsider|newcomer|traveler|traveller|stranger|protagonist)\b/gi;

const INTENT_CLAUSE_RE =
  /(?:,?\s+)?(?:and\s+)?(?:with\s+)?(?:the\s+)?(?:intent|intention|desire|hope|plan|decision)\s+to\b[^,.!?]*/gi;

const REINVENT_CLAUSE_RE =
  /(?:,?\s+)?(?:to\s+)?(?:reinvent(?:\s+her(?:self)?)?|rebuild(?:\s+(?:her|his|their)?\s+life)?|start\s+over)\b[^,.!?]*/gi;

const PUBLIC_BREAKUP_RE =
  /(?:,?\s+)?(?:after\s+)?(?:a\s+)?(?:public(?:ly)?\s+)?(?:humiliating\s+)?(?:breakup|cancellation|engagement)\b[^,.!]*/gi;

const TRAIT_STACK_RE =
  /\b(?:charming|wounded|lonely|glamorous|heartbroken|humiliated)\b(?:\s*,\s*|\s+)?/gi;

/** Keep playable arrival/event nouns; drop dossier filler for depiction gates. */
export function toStageableTreatmentMoment(sourceText: string): string {
  let text = String(sourceText || '').replace(/\s+/g, ' ').trim();
  if (!text) return '';

  text = text
    .replace(ROLE_APPOSITION_RE, '')
    .replace(INTENT_CLAUSE_RE, '')
    .replace(REINVENT_CLAUSE_RE, '')
    .replace(PUBLIC_BREAKUP_RE, '')
    .replace(TRAIT_STACK_RE, '')
    .replace(/\s+,/g, ',')
    .replace(/,\s*,+/g, ',')
    .replace(/\s{2,}/g, ' ')
    .replace(/^[\s,;:.-]+|[\s,;:.-]+$/g, '')
    .replace(/,\s+and\s*$/i, '')
    .replace(/\band\s*$/i, '')
    .trim();

  // Collapse "with , her grandmother's" artifacts from trait stripping.
  text = text
    .replace(/\bwith\s*,\s*/gi, 'with ')
    .replace(/,\s+with\s+/gi, ' with ')
    .replace(/\s{2,}/g, ' ')
    .trim();

  return text || String(sourceText || '').trim();
}
