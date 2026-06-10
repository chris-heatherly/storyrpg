/**
 * Required-Beat Realization Validator (G10 audit — closes the "authored-tier required
 * beat on a STANDARD scene" gap).
 *
 * The "expand, do not rewrite" contract binds each authored treatment turn to a
 * {@link RequiredBeat} on its {@link PlannedScene}. Two existing validators backstop
 * subsets of those beats:
 *
 *   - {@link SignatureDevicePresenceValidator} checks only `tier === 'signature'` beats.
 *   - {@link EncounterAnchorContentValidator} checks required beats only on
 *     `kind === 'encounter'` scenes.
 *
 * That leaves a hole the G10 audit hit hard: an `tier === 'authored'` required beat on a
 * `kind === 'standard'` scene is verified by NOTHING. The audited ENDSONG ep1 shipped
 * scene `s1-6` ("Vraxxan Names the Key") with exactly one authored required beat —
 * *"Vraxxan materializes, names Aethavyr 'old friend', reaches for Lysandra, and declares
 * her blood the key to the Codex before withdrawing wounded"* — and the generated prose
 * stopped at the villain's entrance ("Hello, old friend"), with the key reveal, the
 * wounded withdrawal, and the vow all unwritten. The scene was the season's HOOK payload;
 * it shipped QA-passing because no gate checks authored-tier beats on a standard scene.
 *
 * This validator closes that hole. For every planned STANDARD scene's `authored`-tier
 * required beats, it asserts the beat's content words appear in that scene's generated
 * reader-facing prose (keyword overlap + verbatim-substring), mirroring the matching
 * logic of {@link SignatureDevicePresenceValidator}. `connective`-tier beats are exempt
 * (that band is the model's legitimate invention); `signature`-tier and `encounter`-scene
 * beats are exempt here because their dedicated validators already cover them.
 *
 * Partial-season aware: a treatment plans beats for all N episodes, but a run may
 * generate only a subset; a beat whose episode was not generated is legitimately absent
 * and skipped (mirrors SignatureDevicePresenceValidator's scoping).
 *
 * Pure, deterministic, fiction-first generator-internal machinery — nothing it reads or
 * emits reaches the player. Registration is DEFAULT-OFF behind `GATE_REQUIRED_BEAT_REALIZATION`,
 * dispatched from {@link runFidelityValidators}.
 *
 * ⚠️ PRECISION CAVEAT — ADVISORY/SHADOW ONLY, do NOT promote to a blocking gate on keyword
 * matching alone. An offline replay over the two audited g10 final stories (2026-06-09)
 * showed the keyword-overlap heuristic does NOT cleanly separate true from false positives
 * when a `mustDepict` is a *paraphrastic episode-turn summary* (the common case): the true
 * Endsong s1-6 miss scored 0.50 while genuinely-dramatized scenes (Bite Me s1-1 key-card,
 * s2-1 three-dates) scored 0.11–0.40 — i.e. an absent beat and a present-but-paraphrased
 * beat are indistinguishable by token overlap. So this validator is a useful *signal* (it
 * did surface the real s1-6 hole) but is FALSE-POSITIVE-PRONE on summary-style required
 * beats. A reliable blocking version needs an LLM-judge ("does this scene's prose dramatize
 * this authored turn?"), mirroring the ReferencedEventPresence LLM-judge follow-up the
 * roadmap already scoped out of the deterministic path. Keep it default-OFF / advisory.
 */

import { BaseValidator, ValidationIssue, ValidationResult } from './BaseValidator';
import type { PlannedScene, RequiredBeat, SeasonScenePlan } from '../../types/scenePlan';
import type { Beat } from '../../types/content';
import type { Episode, Scene, Story } from '../../types/story';

/** Stopwords stripped before keyword overlap (mirrors SignatureDevicePresenceValidator). */
const STOPWORDS = new Set([
  'about', 'after', 'again', 'against', 'also', 'and', 'because', 'become', 'before', 'being', 'between',
  'choice', 'chooses', 'could', 'during', 'episode', 'every', 'from', 'have', 'into', 'keeps', 'later',
  'leave', 'leaves', 'major', 'make', 'makes', 'must', 'opens', 'paths', 'player', 'pressure', 'scene',
  'should', 'that', 'their', 'them', 'then', 'there', 'this', 'through', 'when', 'where', 'with', 'without',
  'staged', 'moment', 'beat', 'depict', 'depicts', 'show', 'shows',
]);

/** Minimum content-word overlap for a required beat to count as "depicted". */
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

/** A needle token is present if a haystack token matches exactly or via a shared stem. */
function tokenPresent(token: string, hayTokens: string[], haySet: Set<string>): boolean {
  if (haySet.has(token)) return true;
  for (const h of hayTokens) {
    if (h.startsWith(token) || token.startsWith(h)) return true;
  }
  return false;
}

function overlapScore(needle: string, haystack: string): number {
  const needed = [...new Set(contentTokens(needle))];
  if (needed.length === 0) return 1; // nothing concrete to assert → trivially present
  const hayTokens = [...new Set(contentTokens(haystack))];
  const haySet = new Set(hayTokens);
  const hits = needed.filter((token) => tokenPresent(token, hayTokens, haySet)).length;
  return hits / needed.length;
}

/** Verbatim substring (normalized) OR sufficient content-word overlap. */
function beatDepicted(mustDepict: string, prose: string): boolean {
  const normalizedBeat = normalize(mustDepict);
  if (normalizedBeat.length === 0) return true;
  if (normalize(prose).includes(normalizedBeat)) return true;
  return overlapScore(mustDepict, prose) >= PRESENCE_MIN_SCORE;
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
  // A standard scene normally carries its prose in `scene.beats`, but defensively also
  // collect any encounter prose (a scene can carry both) so a beat realized inside an
  // encounter phase/storylet still counts as depicted.
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

/** One authored required beat the prose must depict. */
interface AuthoredBeatExpectation {
  episodeNumber: number;
  sceneId: string;
  beatId: string;
  text: string;
}

function isAuthoredStandardBeat(beat: RequiredBeat): boolean {
  return beat.tier === 'authored' && Boolean(beat.mustDepict?.trim());
}

/**
 * Collect every authored-tier required beat from STANDARD scenes (the gap). Encounter
 * scenes are skipped (EncounterAnchorContentValidator covers them); signature/connective
 * tiers are skipped (signature → SignatureDevicePresenceValidator; connective → invention).
 */
function collectAuthoredBeats(plan: SeasonScenePlan): AuthoredBeatExpectation[] {
  const out: AuthoredBeatExpectation[] = [];
  const seen = new Set<string>();
  for (const scene of plan.scenes) {
    if (scene.kind === 'encounter') continue;
    for (const beat of scene.requiredBeats || []) {
      if (!isAuthoredStandardBeat(beat)) continue;
      const text = beat.mustDepict.trim();
      const key = `${scene.id}::${normalize(text)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ episodeNumber: scene.episodeNumber, sceneId: scene.id, beatId: beat.id, text });
    }
  }
  return out;
}

export interface RequiredBeatRealizationInput {
  /** The season scene plan carrying authored required beats. */
  plan: SeasonScenePlan;
  /** The generated story whose prose must depict each authored required beat. */
  story: Story;
}

export class RequiredBeatRealizationValidator extends BaseValidator {
  constructor() {
    super('RequiredBeatRealizationValidator');
  }

  /**
   * Assert each authored-tier required beat on a standard scene lands in the generated
   * prose for that scene (keyword overlap + verbatim substring). Pure and deterministic.
   */
  validate(input: RequiredBeatRealizationInput): ValidationResult {
    const issues: ValidationIssue[] = [];
    const beats = collectAuthoredBeats(input.plan);

    if (beats.length === 0) {
      return { valid: true, score: 100, issues: [], suggestions: [] };
    }

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

    for (const beat of beats) {
      // Partial-season scoping: skip a beat whose episode was not generated this run.
      if (
        generatedEpisodeNumbers.size > 0
        && typeof beat.episodeNumber === 'number'
        && !generatedEpisodeNumbers.has(beat.episodeNumber)
      ) {
        continue;
      }

      const sceneText = sceneProseById.get(beat.sceneId);
      const haystack = sceneText ?? episodeProseByNumber.get(beat.episodeNumber) ?? '';
      const where = `requiredBeat:ep${beat.episodeNumber}:${beat.sceneId}:${beat.beatId}`;

      if (haystack.length === 0) {
        issues.push(this.error(
          `Authored required beat for episode ${beat.episodeNumber} scene "${beat.sceneId}" cannot be checked: no generated prose found for that scene or episode. Beat: "${beat.text}".`,
          where,
          'Ensure the planned scene carrying this authored beat actually produced a generated scene with reader-facing prose.',
        ));
        continue;
      }

      if (!beatDepicted(beat.text, haystack)) {
        issues.push(this.error(
          `Authored required beat is missing from the final prose of episode ${beat.episodeNumber} scene "${beat.sceneId}": "${beat.text}". The authored turn must be dramatized on-page, not dropped or truncated.`,
          where,
          'Dramatize this authored beat on-page in its scene — show the staged turn the treatment fixed; do not stop the scene before it occurs.',
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
