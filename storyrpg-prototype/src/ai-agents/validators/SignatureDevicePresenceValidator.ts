/**
 * Signature Device Presence Validator (Treatment-Fidelity Remediation §4.4, RC5).
 *
 * The "expand, do not rewrite" contract (Phase 3 / §5) binds each authored
 * SIGNATURE staged moment to the scene that must depict it — a
 * {@link RequiredBeat} with `tier === 'signature'`, plus the convenience
 * {@link PlannedScene.signatureMoment} surface. A signature device is a staged
 * image the prose MUST show (the Ep1 joined-blood archive floor; the Ep2 naming +
 * instinctive rescue leap) and must NEVER be inverted/negated ("he didn't").
 *
 * The downstream beat-author stage is responsible for realizing every signature
 * `mustDepict`; THIS validator is the backstop (§4.4, §5 #4). It is a pure,
 * deterministic, structurally-blind check over (plan, generated story):
 *
 *  1. Collect every signature beat from the plan: each scene's `signatureMoment`
 *     and any `requiredBeats[tier === 'signature']` (scene-level and encounter-level).
 *  2. For each, gather the generated prose for the SAME scene (matched by id, since
 *     a generated `Scene.id === plannedScene.id`), falling back to the whole
 *     episode's prose when the scene id was split/renamed downstream.
 *  3. Assert the signature's content words appear in that prose (keyword overlap +
 *     a light verbatim-substring semantic check). A signature that does not land at
 *     all is a blocking error.
 *  4. Assert the signature is NOT inverted — its content words must not co-occur in
 *     close proximity with a negation cue ("didn't", "never", "failed to", "no
 *     longer", …). An inverted signature is a blocking error even if its keywords
 *     are technically present (the Ep2 "He didn't" failure mode, RC5).
 *
 * Severity: BLOCKING (errors) for both absence and inversion of a signature beat —
 * these are authored devices the story exists to deliver. Non-signature tiers
 * (`authored`/`connective`) are intentionally OUT of scope here; the broader
 * {@link TreatmentFidelityValidator} and the per-turn fidelity gates cover those.
 *
 * Fiction-first: this is generator-internal quality machinery; nothing it reads or
 * emits reaches the player (`docs/STORY_QUALITY_CONTRACT.md`).
 *
 * Registration is DEFAULT-OFF behind a gate flag, wired by the Wiring phase
 * (validatorRegistry/architectGatePolicy are NOT edited here) — consistent with how
 * recent fidelity validators landed.
 */

import { BaseValidator, ValidationIssue, ValidationResult } from './BaseValidator';
import type { PlannedScene, RequiredBeat, SeasonScenePlan } from '../../types/scenePlan';
import type { Beat } from '../../types/content';
import type { Episode, Scene, Story } from '../../types/story';

/** Stopwords stripped before keyword overlap (mirrors TreatmentFidelityValidator). */
const STOPWORDS = new Set([
  'about', 'after', 'again', 'against', 'also', 'and', 'because', 'become', 'before', 'being', 'between',
  'choice', 'chooses', 'could', 'during', 'episode', 'every', 'from', 'have', 'into', 'keeps', 'later',
  'leave', 'leaves', 'major', 'make', 'makes', 'must', 'opens', 'paths', 'player', 'pressure', 'scene',
  'should', 'that', 'their', 'them', 'then', 'there', 'this', 'through', 'when', 'where', 'with', 'without',
  'staged', 'moment', 'signature', 'device', 'image', 'show', 'shows', 'depict', 'depicts',
]);

/**
 * Negation cues that, near a signature's content words, mean it was inverted.
 *
 * Deliberately ACTION/verb-negation forms only. The bare standalone "not"/"no" is
 * EXCLUDED: it produces "not X but Y" noun-contrast false positives (e.g. "what she
 * keeps returning to is not the shadow or the scream but …" is not an inverted
 * signature). The auxiliary forms ("did not", "does not", …) still catch the real
 * "he did not <do the signature>" inversion (RC5) via the multi-word cues below.
 */
const NEGATION_CUES = [
  "didn't", 'did not', 'does not', "doesn't", 'do not', "don't",
  'never', 'no longer', 'without', 'failed to', 'fails to', 'fail to',
  'refused to', 'refuses to', 'unable to', "couldn't", 'could not', "wouldn't",
  'would not', 'cannot', "can't", 'instead of', 'rather than', 'avoided', 'avoids',
];

/** How many normalized tokens around a content-word hit to scan for a negation cue. */
const INVERSION_WINDOW_TOKENS = 6;

/**
 * Inversion-by-proximity is only reliable for SHORT, concrete signatures (a literal
 * staged action like "leaps from the battlement to save the child"). Long descriptive
 * design-note signatures (15+ content words, often containing their own negations and
 * abstract vocabulary like "realizes"/"somehow") share words with faithful prose that
 * naturally sits near benign negations ("without once checking her phone", "no longer
 * knows") — producing irreducible false positives. So the inversion check is skipped
 * for signatures longer than this; presence (and the EncounterAnchorContentValidator's
 * depiction check) still cover them.
 */
const INVERSION_MAX_SIG_TOKENS = 12;

/** Minimum content-word overlap for a signature to count as "present". */
const PRESENCE_MIN_SCORE = 0.5;

function normalize(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Content tokens (≥4 chars, not a stopword) used for keyword overlap. */
function contentTokens(value: string | undefined): string[] {
  if (!value) return [];
  return normalize(value)
    .split(' ')
    .filter((token) => token.length >= 4 && !STOPWORDS.has(token));
}

/**
 * A needle token counts as present if a haystack token matches it exactly OR via a
 * shared stem (one is a prefix of the other; both ≥4 chars). Lets authored anchors
 * match the inflected forms the prose actually uses ("leap"~"leaping").
 */
function tokenPresent(token: string, hayTokens: string[], haySet: Set<string>): boolean {
  if (haySet.has(token)) return true;
  for (const h of hayTokens) {
    if (h.startsWith(token) || token.startsWith(h)) return true;
  }
  return false;
}

function overlapScore(needle: string, haystack: string): number {
  const needed = [...new Set(contentTokens(needle))];
  if (needed.length === 0) return 1; // nothing to assert → trivially present
  const hayTokens = [...new Set(contentTokens(haystack))];
  const haySet = new Set(hayTokens);
  const hits = needed.filter((token) => tokenPresent(token, hayTokens, haySet)).length;
  return hits / needed.length;
}

/** Verbatim substring (normalized) OR sufficient content-word overlap. */
function signaturePresent(signature: string, prose: string): boolean {
  const normalizedSig = normalize(signature);
  if (normalizedSig.length === 0) return true;
  if (normalize(prose).includes(normalizedSig)) return true;
  return overlapScore(signature, prose) >= PRESENCE_MIN_SCORE;
}

/**
 * True iff the signature appears NEGATED in the prose: at least one of its content
 * words sits within {@link INVERSION_WINDOW_TOKENS} tokens of a negation cue. This
 * catches the RC5 "He didn't <do the signature>" inversion the symptom run showed.
 */
function signatureInverted(signature: string, prose: string): boolean {
  const sigTokens = new Set(contentTokens(signature));
  if (sigTokens.size === 0) return false;

  const proseTokens = normalize(prose).split(' ').filter(Boolean);
  if (proseTokens.length === 0) return false;

  const tokenIsSig = (tok: string): string | undefined => {
    for (const sigTok of sigTokens) {
      if (tok === sigTok || tok.startsWith(sigTok) || sigTok.startsWith(tok)) return sigTok;
    }
    return undefined;
  };

  // Index every position of a negation cue (single-word checked positionally;
  // multi-word matched as a contiguous token run).
  const singleWordCues = new Set(
    NEGATION_CUES.filter((c) => !c.includes(' ')).map((c) => normalize(c)).filter(Boolean),
  );
  const multiWordCues = NEGATION_CUES
    .filter((c) => c.includes(' '))
    .map((c) => normalize(c).split(' ').filter(Boolean))
    .filter((arr) => arr.length > 0);

  const cuePositions: number[] = [];
  proseTokens.forEach((tok, idx) => {
    if (singleWordCues.has(tok)) cuePositions.push(idx);
  });
  for (const cue of multiWordCues) {
    for (let i = 0; i + cue.length <= proseTokens.length; i++) {
      let match = true;
      for (let j = 0; j < cue.length; j++) {
        if (proseTokens[i + j] !== cue[j]) { match = false; break; }
      }
      if (match) cuePositions.push(i);
    }
  }
  if (cuePositions.length === 0) return false;

  // A genuine inversion negates the signature's ACTION: ≥2 DISTINCT signature content
  // tokens cluster within the window of a negation cue (e.g. "he did NOT leap from the
  // battlement to save the child" — battlement/leap/save/child all near "not"). The old
  // rule fired on a SINGLE content token near any negation, which false-positived on
  // descriptive/meta signatures full of common words ("light then dark … the attack")
  // in long prose — a lone "dark" near an unrelated "not" is not an inversion.
  for (const pos of cuePositions) {
    const start = Math.max(0, pos - INVERSION_WINDOW_TOKENS);
    const end = Math.min(proseTokens.length, pos + INVERSION_WINDOW_TOKENS + 1);
    const distinct = new Set<string>();
    for (let i = start; i < end; i++) {
      if (i === pos) continue;
      const sigTok = tokenIsSig(proseTokens[i]);
      if (sigTok) distinct.add(sigTok);
    }
    if (distinct.size >= 2) return true;
  }
  return false;
}

/** All reader-facing prose on a single beat (text + variant texts). */
function beatProse(beat: Beat): string {
  return [beat.text, ...((beat.textVariants || []).map((variant) => variant.text))]
    .filter(Boolean)
    .join(' ');
}

/** All reader-facing prose for one generated scene (flat beats + encounter content). */
function sceneProse(scene: Scene): string {
  const parts: string[] = [scene.name, ...(scene.beats || []).map(beatProse)];
  // Encounter scenes carry their prose in `encounter.phases[].beats` and
  // `encounter.storylets[].beats`, NOT `scene.beats` — so an encounter-staged
  // signature device (e.g. the rooftop→Cișmigiu "two anchors" anchor) would read as
  // "missing" if we only scanned scene.beats. Include encounter prose too.
  const enc = scene.encounter as
    | { phases?: Array<{ beats?: unknown[] }>; storylets?: unknown }
    | undefined;
  if (enc) {
    const collect = (beats: unknown[] | undefined): void => {
      for (const beat of beats || []) {
        const b = beat as Partial<Beat> & { setupText?: string; escalationText?: string };
        parts.push(b.text || '', b.setupText || '', b.escalationText || '');
        for (const variant of b.textVariants || []) parts.push(variant.text || '');
      }
    };
    for (const phase of enc.phases || []) collect(phase.beats);
    const storylets = Array.isArray(enc.storylets)
      ? enc.storylets
      : Object.values((enc.storylets ?? {}) as Record<string, unknown>);
    for (const storylet of storylets) {
      if (storylet && typeof storylet === 'object') collect((storylet as { beats?: unknown[] }).beats);
    }
  }
  return parts.filter(Boolean).join(' ');
}

/** All reader-facing prose for one generated episode. */
function episodeProse(episode: Episode): string {
  return [episode.title, episode.synopsis, ...(episode.scenes || []).map(sceneProse)]
    .filter(Boolean)
    .join(' ');
}

/** One signature the prose must land. */
interface SignatureExpectation {
  episodeNumber: number;
  sceneId: string;
  /** Where it came from, for the diagnostic message. */
  origin: 'signatureMoment' | 'requiredBeat' | 'encounterRequiredBeat';
  /** The signature text the prose must depict. */
  text: string;
  /** Beat id, when the signature came from a RequiredBeat. */
  beatId?: string;
}

function isSignatureBeat(beat: RequiredBeat): boolean {
  return beat.tier === 'signature';
}

/**
 * A descriptive DESIGN-NOTE signature (a "label — description" summary, a parenthetical
 * aside, or a long abstract phrase) rather than a concrete staged line. The keyword /
 * proximity heuristics false-positive on these (they share abstract words with faithful
 * prose and sit near benign negations), and for encounter scenes their depiction is
 * already hard-checked by EncounterAnchorContentValidator — so this validator treats
 * them as advisory rather than blocking.
 */
function isDesignNoteSignature(text: string): boolean {
  if (/[—–]| -- | - /.test(text)) return true;        // "label — description" separator
  if (/\([^)]*\)/.test(text)) return true;             // parenthetical aside
  return contentTokens(text).length > INVERSION_MAX_SIG_TOKENS; // long summary
}

/** Collect every signature expectation a plan carries (deduped by scene + text). */
function collectSignatures(plan: SeasonScenePlan): SignatureExpectation[] {
  const out: SignatureExpectation[] = [];
  const seen = new Set<string>();
  // The SAME signature text often appears as BOTH scene.signatureMoment AND a signature
  // requiredBeat (scene- or encounter-level) — without dedup that emits the identical
  // finding 2-3×, inflating the blocking count. Key on scene id + normalized text.
  const push = (sig: SignatureExpectation): void => {
    const key = `${sig.sceneId}::${normalize(sig.text)}`;
    if (!sig.text || seen.has(key)) return;
    seen.add(key);
    out.push(sig);
  };
  for (const scene of plan.scenes) {
    if (scene.signatureMoment?.trim()) {
      push({
        episodeNumber: scene.episodeNumber,
        sceneId: scene.id,
        origin: 'signatureMoment',
        text: scene.signatureMoment.trim(),
      });
    }
    for (const beat of scene.requiredBeats || []) {
      if (isSignatureBeat(beat) && beat.mustDepict.trim()) {
        push({
          episodeNumber: scene.episodeNumber,
          sceneId: scene.id,
          origin: 'requiredBeat',
          text: beat.mustDepict.trim(),
          beatId: beat.id,
        });
      }
    }
    for (const beat of scene.encounter?.requiredBeats || []) {
      if (isSignatureBeat(beat) && beat.mustDepict.trim()) {
        push({
          episodeNumber: scene.episodeNumber,
          sceneId: scene.id,
          origin: 'encounterRequiredBeat',
          text: beat.mustDepict.trim(),
          beatId: beat.id,
        });
      }
    }
  }
  return out;
}

/** Context for {@link SignatureDevicePresenceValidator.validate}. */
export interface SignatureDevicePresenceInput {
  /** The season scene plan carrying signature moments / signature required beats. */
  plan: SeasonScenePlan;
  /** The generated story whose prose must land each signature. */
  story: Story;
}

export class SignatureDevicePresenceValidator extends BaseValidator {
  constructor() {
    super('SignatureDevicePresenceValidator');
  }

  /**
   * Assert each authored signature device lands in the generated prose for its
   * scene (keyword + light-semantic) and is not inverted/negated. Pure and
   * deterministic — the same (plan, story) always yields the same result.
   */
  validate(input: SignatureDevicePresenceInput): ValidationResult {
    const issues: ValidationIssue[] = [];
    const signatures = collectSignatures(input.plan);

    // No signature beats authored → nothing to enforce (from-scratch / silent
    // treatment runs). Trivially valid.
    if (signatures.length === 0) {
      return { valid: true, score: 100, issues: [], suggestions: [] };
    }

    // Index generated prose by scene id and by episode number.
    const sceneProseById = new Map<string, string>();
    const episodeProseByNumber = new Map<number, string>();
    const generatedEpisodeNumbers = new Set<number>();
    for (const episode of input.story.episodes || []) {
      if (typeof episode.number === 'number') generatedEpisodeNumbers.add(episode.number);
      episodeProseByNumber.set(episode.number, episodeProse(episode));
      for (const scene of episode.scenes || []) {
        sceneProseById.set(scene.id, sceneProse(scene));
      }
    }

    for (const sig of signatures) {
      // Partial-season scoping: a treatment plans signatures for all N episodes, but a
      // run may generate only a subset (e.g. the first 3). A signature whose episode was
      // not generated is legitimately absent — not "summarized away" — so skip it rather
      // than emitting a false "no generated prose found" error for ungenerated episodes.
      // Only applies when we can tell which episodes ran.
      if (
        generatedEpisodeNumbers.size > 0
        && typeof sig.episodeNumber === 'number'
        && !generatedEpisodeNumbers.has(sig.episodeNumber)
      ) {
        continue;
      }

      // Prefer the exact scene's prose; fall back to the whole episode if the
      // scene id was split/renamed downstream (still scene-local, not whole-story).
      const sceneText = sceneProseById.get(sig.sceneId);
      const haystack = sceneText ?? episodeProseByNumber.get(sig.episodeNumber) ?? '';
      const where = `${sig.origin}:ep${sig.episodeNumber}:${sig.sceneId}${sig.beatId ? `:${sig.beatId}` : ''}`;

      if (haystack.length === 0) {
        issues.push(this.error(
          `Signature device for episode ${sig.episodeNumber} scene "${sig.sceneId}" cannot be checked: no generated prose found for that scene or episode. Signature: "${sig.text}".`,
          where,
          'Ensure the planned scene carrying this signature beat actually produced a generated scene with reader-facing prose.',
        ));
        continue;
      }

      // Design-note signatures (descriptive summaries) are advisory here: their keyword/
      // proximity heuristics false-positive on faithful dramatized prose, and encounter
      // depiction is hard-checked by EncounterAnchorContentValidator. Concrete staged
      // signatures stay BLOCKING errors.
      const designNote = isDesignNoteSignature(sig.text);

      if (!signaturePresent(sig.text, haystack)) {
        const message = `Signature device is missing from the final prose of episode ${sig.episodeNumber} scene "${sig.sceneId}": "${sig.text}". The staged signature moment must be depicted, not summarized away.`;
        const suggestion = 'Dramatize the signature device on-page in this scene — show the staged image/action the treatment fixed; do not drop or paraphrase it out.';
        issues.push(designNote ? this.warning(message, where, suggestion) : this.error(message, where, suggestion));
        continue;
      }

      // Inversion-by-proximity is unreliable for design-note signatures (and long ones),
      // so only run it on concrete, in-range signatures — where it stays a blocking error.
      if (!designNote && contentTokens(sig.text).length <= INVERSION_MAX_SIG_TOKENS && signatureInverted(sig.text, haystack)) {
        issues.push(this.error(
          `Signature device appears INVERTED/negated in episode ${sig.episodeNumber} scene "${sig.sceneId}": "${sig.text}". The prose negates the staged moment (e.g. "he didn't ...") instead of depicting it.`,
          where,
          'Depict the signature device as it happens — remove the negation. The authored signature is a fixed staged beat and must occur, not be averted.',
        ));
      }
    }

    const errors = issues.filter((i) => i.severity === 'error').length;
    const nonErrors = issues.length - errors;
    const score = Math.max(0, 100 - errors * 10 - nonErrors * 2);
    return {
      valid: errors === 0,
      score,
      issues,
      suggestions: issues.map((i) => i.suggestion).filter((s): s is string => Boolean(s)),
    };
  }
}
