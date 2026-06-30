/**
 * Sustained-set-piece detection (G10) — SHARED between the EncounterArchitect (which must
 * AUTHOR escalating structure for such encounters) and EncounterSetPieceDepthValidator
 * (which flags a sustained set piece that collapsed to one decision + a summary). One source
 * of truth so the generator and the gate agree on what "sustained" means.
 *
 * A treatment can stage an encounter as a SUSTAINED set piece — "a sustained defensive set
 * piece (wall breach + repulse) culminating in the choice to evacuate" (Endsong ep3) — i.e.
 * an escalating sequence, not a single decision. Deterministic, no LLM.
 */

const SUSTAINED_SET_PIECE_RE =
  /\b(sustained|set[\s-]?piece|siege|repulse|successive|wave after wave|waves of|prolonged|drawn[\s-]?out|extended (?:battle|fight|chase|defen[cs]e|siege)|escalating (?:battle|assault|siege|sequence)|running (?:battle|fight))\b/i;

export { SUSTAINED_SET_PIECE_RE };

/** True when any of the supplied intent fragments describes a sustained set piece. */
export function isSustainedSetPiece(...fragments: Array<string | undefined | null>): boolean {
  return SUSTAINED_SET_PIECE_RE.test(fragments.filter(Boolean).join(' '));
}
