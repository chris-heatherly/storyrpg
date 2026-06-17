/**
 * Handler-side mirror of the realization validators' keyword-overlap scoring
 * (RequiredBeatRealizationValidator / SignatureDevicePresenceValidator), so
 * the final-contract scene-prose repair can PREDICT whether a rewrite will
 * clear the gate instead of burning a whole repair round to find out.
 *
 * Learned from the bite-me-g13 2026-06-12T14-36-20 run: the repair fired,
 * merged rewrites, and reported success — but the critic had dramatized only
 * PART of a multi-part signature (the rooftop anchor landed, the Cișmigiu
 * anchor didn't), the scene still scored 0.33 < 0.5, and the round was wasted.
 * With this mirror the handler (a) tells the critic exactly which content
 * words are still missing, and (b) verifies the merge immediately and retries
 * once with sharpened notes while the round is still open.
 *
 * Each validator's STOPWORDS set is replicated EXACTLY (they differ by a few
 * words), keyed by validator name, so the prediction matches the gate it
 * predicts. If a validator's scoring changes, update the mirror — the
 * cross-check test pins the constants against the validator behavior.
 */

/** Shared base both validators use, before their per-validator extras. */
const BASE_STOPWORDS = [
  'about', 'after', 'again', 'against', 'also', 'and', 'because', 'become', 'before', 'being', 'between',
  'choice', 'chooses', 'could', 'during', 'episode', 'every', 'from', 'have', 'into', 'keeps', 'later',
  'leave', 'leaves', 'major', 'make', 'makes', 'must', 'opens', 'paths', 'player', 'pressure', 'scene',
  'should', 'that', 'their', 'them', 'then', 'there', 'this', 'through', 'when', 'where', 'with', 'without',
];

const STOPWORDS_BY_VALIDATOR: Record<string, Set<string>> = {
  RequiredBeatRealizationValidator: new Set([
    ...BASE_STOPWORDS,
    'staged', 'moment', 'beat', 'depict', 'depicts', 'show', 'shows',
  ]),
  SignatureDevicePresenceValidator: new Set([
    ...BASE_STOPWORDS,
    'staged', 'moment', 'signature', 'device', 'image', 'show', 'shows', 'depict', 'depicts',
  ]),
};

export const PRESENCE_MIN_SCORE = 0.5;

function normalize(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function contentTokens(value: string | undefined, stopwords: Set<string>): string[] {
  if (!value) return [];
  return normalize(value)
    .split(' ')
    .filter((token) => token.length >= 4 && !stopwords.has(token));
}

function tokenPresent(token: string, hayTokens: string[], haySet: Set<string>): boolean {
  if (haySet.has(token)) return true;
  for (const h of hayTokens) {
    if (h.startsWith(token) || token.startsWith(h)) return true;
  }
  return false;
}

function stopwordsFor(validator: string | undefined): Set<string> {
  return STOPWORDS_BY_VALIDATOR[validator ?? ''] ?? STOPWORDS_BY_VALIDATOR.RequiredBeatRealizationValidator;
}

/** The validator's presence check: normalized-substring OR ≥0.5 content-word overlap. */
export function momentDepicted(validator: string | undefined, moment: string, prose: string): boolean {
  const normalizedMoment = normalize(moment);
  if (normalizedMoment.length === 0) return true;
  if (normalize(prose).includes(normalizedMoment)) return true;
  const stopwords = stopwordsFor(validator);
  const needed = [...new Set(contentTokens(moment, stopwords))];
  if (needed.length === 0) return true;
  const hayTokens = [...new Set(contentTokens(prose, stopwords))];
  const haySet = new Set(hayTokens);
  const hits = needed.filter((token) => tokenPresent(token, hayTokens, haySet)).length;
  return hits / needed.length >= PRESENCE_MIN_SCORE;
}

/** Content words of the authored moment the prose does NOT yet carry. */
export function missingMomentTokens(validator: string | undefined, moment: string, prose: string): string[] {
  const stopwords = stopwordsFor(validator);
  const needed = [...new Set(contentTokens(moment, stopwords))];
  const hayTokens = [...new Set(contentTokens(prose, stopwords))];
  const haySet = new Set(hayTokens);
  return needed.filter((token) => !tokenPresent(token, hayTokens, haySet));
}

/**
 * Pull the quoted authored moment out of a realization finding message. The
 * RequiredBeat / Signature validators emit:
 *   `… scene "<id>": "<MOMENT>". The authored turn must be dramatized …`
 *   `… scene "<id>": "<MOMENT>". The staged signature moment must be depicted …`
 * and EncounterAnchorContentValidator (now also routed to the scene-prose repair):
 *   `… does not depict its central conflict on-page: "<MOMENT>".`
 *   `… does not depict required beat <id> (<tier>): "<MOMENT>".`
 */
export function requiredMomentFromMessage(message: string | undefined): string | undefined {
  if (!message) return undefined;
  const turn = /: "([\s\S]*)"\. The (?:authored turn|staged signature moment) must be/.exec(message);
  if (turn?.[1]) return turn[1].trim();
  // EncounterAnchorContent forms: the moment is the FINAL quoted span at end of message.
  const anchor = /does not depict (?:its central conflict on-page|required beat [^:]+): "([\s\S]*)"\.\s*$/.exec(message);
  return anchor?.[1]?.trim() || undefined;
}
