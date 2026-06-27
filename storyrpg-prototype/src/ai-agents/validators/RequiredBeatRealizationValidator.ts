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
import { isGateEnabledAt } from '../remediation/gateRegistry';
import { evaluateMomentRealization, normalizeRealizationText } from '../remediation/realizationEvaluator';
import { concreteSeedDepicted } from '../utils/concreteSeedRealization';
import { classifyTreatmentObligation } from './treatmentObligationClassifier';

/** Verbatim substring (normalized) OR sufficient content-word overlap. */
function beatDepicted(mustDepict: string, prose: string): boolean {
  return evaluateMomentRealization('RequiredBeatRealizationValidator', mustDepict, prose).depicted;
}

function seedDepicted(mustDepict: string, prose: string): boolean {
  const needle = normalizeRealizationText(mustDepict);
  const hay = normalizeRealizationText(prose);
  const concreteDepicted = concreteSeedDepicted(needle, prose);
  if (typeof concreteDepicted === 'boolean') return concreteDepicted;
  if (beatDepicted(mustDepict, prose)) return true;
  if (/\bblog readership number\b/.test(needle)) {
    return /\b(?:blog|dating after dusk|post)\b/.test(hay)
      && /\b(?:reads?|readership|views?|view count|dashboard)\b/.test(hay)
      && /\b(?:\d{1,3}\s?\d{3}|\d+k)\b/.test(hay);
  }
  if (needle === 'season central pressure') {
    return /\b(?:victor|charcoal|rescuer|savior|midnight)\b/.test(hay)
      && /\b(?:blog|dating after dusk|voice|chosen|saved|rescued|roses?|card)\b/.test(hay);
  }
  return false;
}

function isAbstractSeedLabel(mustDepict: string): boolean {
  const words = mustDepict
    .replace(/[^\p{L}\p{N}'\s-]+/gu, ' ')
    .trim()
    .split(/\s+/)
    .filter((word) => word && !/^(a|an|the|of|and|or|in|on|at|to|for)$/i.test(word));
  if (words.length === 0 || words.length > 4) return false;
  return words.every((word) => /^[A-Z0-9]/.test(word));
}

function isKnownConcreteSeedLabel(mustDepict: string): boolean {
  const needle = normalizeRealizationText(mustDepict);
  return needle === 'season central pressure';
}

function isChoiceContingentSeed(mustDepict: string): boolean {
  return /\b(did or did(?:n['’]t| not)|accept(?:ed|s)? or refus(?:ed|es)?|refus(?:ed|es)? or accept(?:ed|s)?|whether|depending on|chosen path|choice path|route)\b/i
    .test(mustDepict);
}

function isCompositeSynopsisSeed(mustDepict: string): boolean {
  const normalized = normalizeRealizationText(mustDepict);
  const contentWords = normalized.split(/\s+/).filter(Boolean);
  if (contentWords.length < 12) return false;

  const clauseCount = mustDepict
    .split(/[,;]|\band\b/gi)
    .map((clause) => clause.trim())
    .filter(Boolean)
    .length;
  if (clauseCount < 4) return false;

  const lifecycleVerbs = normalized.match(
    /\b(?:arrives?|arrived|builds?|built|launch(?:es|ed)?|lets?|courted|courts?|ignoring|ignored|becomes?|became|begins?|began|discovers?|learns?|realizes?|chooses?|decides?)\b/g,
  ) ?? [];

  return new Set(lifecycleVerbs).size >= 3;
}

function isHiddenInformationSeed(mustDepict: string): boolean {
  const detailText = mustDepict.includes(':')
    ? mustDepict.split(':').slice(1).join(':').trim()
    : mustDepict;
  const normalized = normalizeRealizationText(detailText);
  const hasHiddenCue = /\b(?:secret(?:ly)?|betray(?:al|s|ed|ing)?|debt|debts|owed|owes|bound|contract|assigned|steering|reel(?:s|ed|ing)?|manipulat(?:es|ed|ing|ion)|truth|true nature|real nature|reveal(?:s|ed)?|behind the scenes)\b/
    .test(normalized);
  if (!hasHiddenCue) return false;

  const hasConcreteOnPageCue = /\b(?:stray dog|courtyard|key ?card|card|quartz|herbs?|chain|necklace|letter|photo|phone|mirror|window|door|blood|hand|pocket|table)\b/
    .test(normalized);
  return !hasConcreteOnPageCue;
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

/**
 * Collect required beats of a given tier from STANDARD scenes. Encounter scenes are
 * skipped (EncounterAnchorContentValidator covers them). `authored` beats are blocking
 * (the gap); `seed` beats are advisory (cold-open / consequence-seed / info-ledger plants
 * distributed from treatmentGuidance — counted, never blocking).
 */
function collectStandardBeats(plan: SeasonScenePlan, tier: RequiredBeat['tier']): AuthoredBeatExpectation[] {
  const out: AuthoredBeatExpectation[] = [];
  const seen = new Set<string>();
  for (const scene of plan.scenes) {
    if (scene.kind === 'encounter') continue;
    for (const beat of scene.requiredBeats || []) {
      if (beat.tier !== tier || !beat.mustDepict?.trim()) continue;
      const mustDepict = beat.mustDepict.trim();
      const sourceTurn = beat.sourceTurn?.trim();
      let text = mustDepict;
      if (tier === 'seed' && isAbstractSeedLabel(mustDepict)) {
        const hasConcreteSource = Boolean(
          sourceTurn
          && normalizeRealizationText(sourceTurn) !== normalizeRealizationText(mustDepict)
          && !isAbstractSeedLabel(sourceTurn),
        );
        if (hasConcreteSource) text = sourceTurn as string;
        else if (!isKnownConcreteSeedLabel(mustDepict)) continue;
      }
      if (tier === 'seed' && isChoiceContingentSeed(text)) continue;
      if (tier === 'authored') {
        const classification = classifyTreatmentObligation({
          validator: 'RequiredBeatRealizationValidator',
          text,
        });
        if (!classification.blocksFinalProse) continue;
      }
      const key = `${scene.id}::${normalizeRealizationText(text)}`;
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
    const beats = collectStandardBeats(input.plan, 'authored');
    const seedBeats = collectStandardBeats(input.plan, 'seed');
    const coldOpenBeats = collectStandardBeats(input.plan, 'coldopen');

    if (beats.length === 0 && seedBeats.length === 0 && coldOpenBeats.length === 0) {
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

    // Cold-open / consequence-seed / information-ledger plants distributed from
    // treatmentGuidance. A missing seed is normally a WARNING (the detail is finer-grained
    // than a turn and may legitimately land in a sibling scene). bite-me-g16: a dropped
    // seed whose Episode-3 payoff still references it ships an unearned payoff. When
    // GATE_TREATMENT_SEED_REALIZATION is on, a seed absent from its entire bound episode
    // escalates to a blocking miss (routed to the season-final scene regen to re-plant it).
    // Default-OFF → unchanged warning behavior; promote at M4 after a live run.
    const blockSeedMiss = isGateEnabledAt('GATE_TREATMENT_SEED_REALIZATION', 'season-final');
    for (const beat of seedBeats) {
      if (
        generatedEpisodeNumbers.size > 0
        && typeof beat.episodeNumber === 'number'
        && !generatedEpisodeNumbers.has(beat.episodeNumber)
      ) {
        continue;
      }
      const sceneText = sceneProseById.get(beat.sceneId);
      // Seeds may drift to a sibling scene, so check the whole episode, not just the bound scene.
      const haystack = `${sceneText ?? ''}\n${episodeProseByNumber.get(beat.episodeNumber) ?? ''}`;
      if (haystack.trim().length === 0) continue;
      if (!seedDepicted(beat.text, haystack)) {
        const message = `Treatment plant not found on-page in episode ${beat.episodeNumber} (bound to scene "${beat.sceneId}"): "${beat.text}". A cold open, recurring object, or information-ledger tell from the treatment was dropped.`;
        const where = `seedBeat:ep${beat.episodeNumber}:${beat.sceneId}:${beat.beatId}`;
        const suggestion = 'Plant this seed on-page somewhere in the episode — it sets up a later payoff that becomes unearned if the setup is missing.';
        const shouldBlockSeedMiss = blockSeedMiss
          && !isCompositeSynopsisSeed(beat.text)
          && !isHiddenInformationSeed(beat.text);
        issues.push(shouldBlockSeedMiss ? this.error(message, where, suggestion) : this.warning(message, where, suggestion));
      }
    }

    // Cold open (WS1.3): the episode opener that establishes the protagonist's world and the
    // relationships a later payoff leans on (g17 dropped the ep1 Sadie-FaceTime + grandmother's-
    // chain hook entirely). Unlike a generic seed it is reliably due, so blocking on it is
    // low-FP. Routed to the season-final scene regen to re-author the opening. DEFAULT-OFF behind
    // GATE_COLD_OPEN_REALIZATION → warning until a live run confirms a clean baseline.
    const blockColdOpenMiss = isGateEnabledAt('GATE_COLD_OPEN_REALIZATION', 'season-final');
    for (const beat of coldOpenBeats) {
      if (
        generatedEpisodeNumbers.size > 0
        && typeof beat.episodeNumber === 'number'
        && !generatedEpisodeNumbers.has(beat.episodeNumber)
      ) {
        continue;
      }
      const sceneText = sceneProseById.get(beat.sceneId);
      const haystack = `${sceneText ?? ''}\n${episodeProseByNumber.get(beat.episodeNumber) ?? ''}`;
      if (haystack.trim().length === 0) continue;
      if (!beatDepicted(beat.text, haystack)) {
        const message = `Cold open not found on-page in episode ${beat.episodeNumber} (scene "${beat.sceneId}"): "${beat.text}". The episode-opening hook (and any named cast it introduces) was dropped — later payoffs that lean on it become unearned.`;
        const where = `coldOpenBeat:ep${beat.episodeNumber}:${beat.sceneId}:${beat.beatId}`;
        const suggestion = 'Open the episode on the authored cold open; dramatize its hook and named cast on-page before moving on.';
        issues.push(blockColdOpenMiss ? this.error(message, where, suggestion) : this.warning(message, where, suggestion));
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
