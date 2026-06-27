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

import { evaluateMomentRealization, PRESENCE_MIN_SCORE } from './realizationEvaluator';

export { PRESENCE_MIN_SCORE };

/** The validator's presence check: normalized-substring OR ≥0.5 content-word overlap. */
export function momentDepicted(validator: string | undefined, moment: string, prose: string): boolean {
  return evaluateMomentRealization(validator, moment, prose).depicted;
}

/** Content words of the authored moment the prose does NOT yet carry. */
export function missingMomentTokens(validator: string | undefined, moment: string, prose: string): string[] {
  return evaluateMomentRealization(validator, moment, prose).missingTokens;
}

/**
 * Pull the quoted authored moment out of a realization finding message. The
 * RequiredBeat / Signature validators emit:
 *   `… scene "<id>": "<MOMENT>". The authored turn must be dramatized …`
 *   `… scene "<id>": "<MOMENT>". The staged signature moment must be depicted …`
 * SceneTurnRealizationValidator emits:
 *   `… does not dramatize its central turn on-page: "<MOMENT>".`
 *   `… mentions its central turn but does not give it a complete scene shape …: "<MOMENT>".`
 *   `… does not dramatize its authored beat event on-page: "<MOMENT>".`
 *   `… stages Story Circle … but does not give it complete scene shape …: "<MOMENT>".`
 *   `… does not dramatize the authored arc event on-page: "<MOMENT>".`
 *   `… stages arc pressure … but does not give it complete scene shape …: "<MOMENT>".`
 * EncounterAnchorContentValidator (now also routed to the scene-prose repair):
 *   `… does not depict its central conflict on-page: "<MOMENT>".`
 *   `… does not depict required beat <id> (<tier>): "<MOMENT>".`
 * TreatmentEventLedgerValidator:
 *   `Treatment event ledger miss …: "<MOMENT>".`
 *   `Treatment event ledger summary-only realization …: "<MOMENT>".`
 * RequiredBeat seed/cold-open forms:
 *   `Treatment plant not found …: "<MOMENT>". A cold open…`
 *   `Cold open not found …: "<MOMENT>". The episode-opening hook…`
 */
export function requiredMomentFromMessage(message: string | undefined): string | undefined {
  if (!message) return undefined;
  const turn = /: "([\s\S]*)"\. The (?:authored turn|staged signature moment) must be/.exec(message);
  if (turn?.[1]) return turn[1].trim();
  const treatmentPlant = /(?:Treatment plant|Cold open) not found[\s\S]*?: "([\s\S]*?)"\. (?:A cold open|The episode-opening hook)/.exec(message);
  if (treatmentPlant?.[1]) return treatmentPlant[1].trim();
  const sceneTurnStart = /(?:does not dramatize (?:its central turn|its authored beat event|the authored arc event) on-page|(?:mentions its central turn|stages Story Circle [^:]+|stages arc pressure [^:]+) but does not give it (?:a )?complete scene shape[\s\S]*?): "/.exec(message);
  const sceneTurnTail = extractQuotedTail(message, sceneTurnStart);
  if (sceneTurnTail) return sceneTurnTail;
  const sceneTurn = /(?:does not dramatize (?:its central turn|its authored beat event|the authored arc event) on-page|(?:mentions its central turn|stages Story Circle [^:]+|stages arc pressure [^:]+) but does not give it (?:a )?complete scene shape[\s\S]*?): "([\s\S]*)"\.\s*$/.exec(message);
  if (sceneTurn?.[1]) return sceneTurn[1].trim();
  const treatmentLedger = /Treatment event ledger (?:miss|summary-only realization)[\s\S]*?: "([\s\S]*)"\.\s*$/.exec(message);
  if (treatmentLedger?.[1]) return treatmentLedger[1].trim();
  // EncounterAnchorContent forms: the moment is the FINAL quoted span at end of message.
  const anchor = /does not depict (?:its central conflict on-page|required beat [^:]+): "([\s\S]*)"\.\s*$/.exec(message);
  if (anchor?.[1]) return anchor[1].trim();

  const quotedSpans = Array.from(message.matchAll(/"([^"]+)"/g))
    .map((match) => match[1]?.trim())
    .filter((span): span is string => Boolean(span && !isNonMomentQuotedSpan(span)));
  return quotedSpans.at(-1);
}

function extractQuotedTail(message: string, startMatch: RegExpExecArray | null): string | undefined {
  if (!startMatch) return undefined;
  const start = startMatch.index + startMatch[0].length;
  const end = message.lastIndexOf('"');
  if (end <= start) return undefined;
  return message.slice(start, end).trim();
}

function isNonMomentQuotedSpan(span: string): boolean {
  if (span === 'None') return true;
  if (/^s\d+(?:[-\w]*)?$/i.test(span)) return true;
  if (/^(?:episode|scene|beat|choice|encounter)[-_]?\w*$/i.test(span)) return true;
  if (/^treatment-enc-\d+-\d+$/i.test(span)) return true;
  return false;
}
