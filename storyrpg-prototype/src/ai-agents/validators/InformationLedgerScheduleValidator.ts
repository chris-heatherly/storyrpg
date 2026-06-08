/**
 * Information Ledger SCHEDULE Validator (Treatment-Fidelity Remediation Plan §4.3).
 *
 * Distinct from {@link InformationLedgerValidator}, which reasons only over the
 * *generated* ledger's internal runway (setup → payoff distance, mystery caps,
 * open/close balance) and never reconciles the AUTHORED treatment schedule. This
 * validator answers a different, fidelity-first question:
 *
 *   "For every authored INFO-N entry (setup/reveal/payoff episodes declared in the
 *    treatment), did the setup actually land in or before its authored setup
 *    episode, and did the reveal land in its authored reveal episode — and did the
 *    reveal never precede the setup on-page?"
 *
 * Input: the authored {@link InformationLedgerEntry}[] (the treatment's Section-6
 * INFO ledger, carried onto the SeasonPlan) plus the final {@link Story}. For each
 * authored entry the validator derives the *observed* setup/reveal episode from the
 * generated story by scanning, in episode order, every scene's beats and choice
 * consequences for a marker tied to that INFO entry:
 *
 *   - a `setFlag` consequence whose flag references the INFO id (e.g.
 *     `info_1_setup`, `INFO-1-reveal`, `treatment_seed_info1_hint`), with the
 *     setup/reveal phase read from the flag suffix; or
 *   - beat / scene text that names the INFO id or label token (a softer signal,
 *     treated as a setup touch unless it carries a reveal/payoff keyword).
 *
 * A caller that already has an exact projection (e.g. the EpisodePipeline) may pass
 * {@link InformationScheduleContext.observedSchedule} to override the scan for a
 * given INFO id — mirroring how {@link ChargeMaterializationValidator} accepts a
 * caller-supplied per-edge target rather than always re-deriving.
 *
 * Severity (per §4.3):
 *  - **blocking (error):** a reveal that precedes its setup on-page (reveal episode
 *    < setup episode), or an authored reveal/payoff that never appears at all.
 *  - **warning:** off-by-one placement — setup landing AFTER its authored setup
 *    episode, or a reveal landing on a different episode than authored (but still
 *    after its own setup).
 *
 * Fiction-first: this is generator-internal quality machinery; nothing here reaches
 * the player (`docs/STORY_QUALITY_CONTRACT.md`). Pure / deterministic — the same
 * (entries, story, context) always yields the same result.
 *
 * Registration: this validator lands DEFAULT-OFF behind a gate flag; the Wiring
 * phase registers it in `validatorRegistry.ts` / `architectGatePolicy.ts`. Do not
 * wire it here.
 */

import type { InformationLedgerEntry } from '../../types/seasonPlan';
import type { Story, Episode, Scene } from '../../types/story';
import type { Beat } from '../../types/content';
import type { Consequence } from '../../types/consequences';
import { BaseValidator, ValidationIssue, ValidationResult } from './BaseValidator';

/** The phase a marker attests to for an INFO entry. */
export type InfoSchedulePhase = 'setup' | 'reveal';

/**
 * A caller-supplied observed schedule for one INFO entry, overriding the story
 * scan. Either field may be left undefined to mean "not observed" (the scan is
 * NOT consulted as a fallback when an override object is supplied for that id).
 */
export interface ObservedInfoSchedule {
  /** Episode the setup was actually planted in (earliest observed setup touch). */
  setupEpisode?: number;
  /** Episode the reveal actually landed in. */
  revealEpisode?: number;
}

/** Context for {@link InformationLedgerScheduleValidator.validate}. */
export interface InformationScheduleContext {
  /**
   * Optional per-INFO observed schedule keyed by INFO id. When an entry exists for
   * an id, it overrides the story scan for that id entirely.
   */
  observedSchedule?: Record<string, ObservedInfoSchedule>;
}

export interface InformationScheduleMetrics {
  /** Authored INFO entries examined. */
  entryCount: number;
  /** Entries whose authored setup AND reveal landed on schedule (no issue). */
  onScheduleCount: number;
  /** Entries with a reveal-before-setup violation (blocking). */
  revealBeforeSetupCount: number;
  /** Entries whose authored reveal/payoff never appeared (blocking). */
  missingRevealCount: number;
  /** Entries with an off-by-one / off-episode placement (warning). */
  offPlacementCount: number;
}

export interface InformationScheduleResult extends ValidationResult {
  metrics: InformationScheduleMetrics;
}

/**
 * Reveal/payoff keyword signal in free text or a flag suffix. Bounded by
 * non-letters (not `\b`) so it still fires inside snake/camel flag names like
 * `info_1_reveal` or `INFO-1-payoff`, where an underscore is a word char and a
 * plain `\b` would not match.
 */
const REVEAL_TOKEN = /(^|[^a-z])(reveal|revealed|payoff|paidoff|paid[\s_-]?off|disclos|expose)/i;
/** Setup/hint keyword signal in a flag suffix (same non-`\b` boundary rule). */
const SETUP_TOKEN = /(^|[^a-z])(setup|set[\s_-]?up|hint|plant|seed|foreshadow)/i;

function normalizeToken(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

/**
 * True for the SeasonPlanner's arc-recontextualization summary entries
 * (`info-arc-<N>-reframe` / label "… (Arc N) reframe"). These summarize a whole
 * arc rather than carrying a discrete, id-tagged reveal, so the schedule's
 * discrete-reveal checks do not apply to them.
 */
function isArcReframeSummary(entry: InformationLedgerEntry): boolean {
  return /^info-arc-\d+-reframe$/i.test(entry.id || '')
    || /\(arc\s*\d+\)\s*reframe/i.test(entry.label || '');
}

/** Does a flag / text reference this INFO entry's id (or its label as a token)? */
function referencesEntry(text: string, entry: InformationLedgerEntry): boolean {
  const haystack = normalizeToken(text);
  const idToken = normalizeToken(entry.id);
  if (idToken.length > 0 && haystack.includes(idToken)) return true;
  return false;
}

interface ScanMarker {
  episode: number;
  phase: InfoSchedulePhase;
}

export class InformationLedgerScheduleValidator extends BaseValidator {
  constructor() {
    super('InformationLedgerScheduleValidator');
  }

  /**
   * Reconcile each authored INFO entry against the generated story's observed
   * setup/reveal schedule. Pure — does not mutate inputs.
   */
  validate(
    authoredLedger: InformationLedgerEntry[] | undefined,
    story: Pick<Story, 'episodes'>,
    ctx: InformationScheduleContext = {},
  ): InformationScheduleResult {
    const issues: ValidationIssue[] = [];
    const entries = Array.isArray(authoredLedger) ? authoredLedger : [];
    const metrics: InformationScheduleMetrics = {
      entryCount: entries.length,
      onScheduleCount: 0,
      revealBeforeSetupCount: 0,
      missingRevealCount: 0,
      offPlacementCount: 0,
    };

    if (entries.length === 0) {
      // Nothing authored to reconcile — vacuously fidelity-clean.
      return this.result(issues, metrics);
    }

    const episodes = Array.isArray(story.episodes) ? story.episodes : [];
    const overrides = ctx.observedSchedule ?? {};

    // Partial-season scoping: a treatment authors INFO reveals across all N episodes,
    // but a run may generate only a subset (e.g. the first 3). A reveal/payoff
    // scheduled for an ungenerated episode legitimately cannot have landed — flagging
    // it "missing" is a false positive. Scope schedule checks to generated episodes.
    // (An in-range reveal that never landed — e.g. an Ep2 reveal in a 3-episode run —
    // is still a REAL miss and is NOT suppressed.) Only applies when we can tell which
    // episodes ran.
    const generatedEpisodeNumbers = new Set<number>();
    for (const ep of episodes) {
      if (typeof ep.number === 'number' && Number.isFinite(ep.number)) generatedEpisodeNumbers.add(ep.number);
    }
    const episodeGenerated = (ep: number | undefined): boolean =>
      generatedEpisodeNumbers.size === 0 || (typeof ep === 'number' && generatedEpisodeNumbers.has(ep));

    for (const entry of entries) {
      const location = `informationLedger.${entry.id || entry.label || 'unknown'}`;

      // Arc-reframe summary entries (id `info-arc-<N>-reframe`, label "… (Arc N)
      // reframe") are NOT discrete plantable facts — the SeasonPlanner injects them to
      // describe an arc's overall recontextualization, which is delivered across the
      // arc's scenes collectively rather than as a single id-tagged reveal or flag.
      // They carry no reveal flag and no id-in-prose, so the discrete-reveal checks
      // would always false-fail. Skip them (a thematic arc-reframe check, if ever
      // wanted, is a separate concern).
      if (isArcReframeSummary(entry)) continue;

      // Authored expectation: earliest authored setup episode and the authored
      // reveal episode (reveal preferred, else payoff).
      const authoredSetup = this.authoredSetupEpisode(entry);
      const authoredReveal = entry.plannedRevealEpisode ?? entry.plannedPayoffEpisode;

      // Observed schedule: caller override, else derived from the story scan.
      const observed = Object.prototype.hasOwnProperty.call(overrides, entry.id)
        ? overrides[entry.id]
        : this.scanStory(entry, episodes);

      const observedSetup = observed.setupEpisode;
      const observedReveal = observed.revealEpisode;

      let entryClean = true;

      // (1) reveal-before-setup — BLOCKING. Use the strongest available signal:
      // prefer observed-vs-observed; fall back to observed-reveal-vs-authored-setup.
      const effectiveSetup = observedSetup ?? authoredSetup;
      if (observedReveal !== undefined && effectiveSetup !== undefined && observedReveal < effectiveSetup) {
        metrics.revealBeforeSetupCount += 1;
        entryClean = false;
        issues.push(this.error(
          `INFO "${entry.id}" reveals in episode ${observedReveal} before its setup in episode ${effectiveSetup} — a reveal must never precede its setup.`,
          `${location}.reveal`,
          'Move the reveal to (or after) the setup episode, or plant the setup earlier so the reveal is earned.',
        ));
      }

      // (2) authored reveal/payoff never appeared — BLOCKING. Scoped to generated
      // episodes: a reveal scheduled for an episode that was never generated cannot
      // have landed yet, so skip it (partial-season run). An in-range reveal that
      // never landed is still flagged.
      if (authoredReveal !== undefined && observedReveal === undefined && episodeGenerated(authoredReveal)) {
        metrics.missingRevealCount += 1;
        entryClean = false;
        issues.push(this.error(
          `INFO "${entry.id}" has an authored reveal/payoff in episode ${authoredReveal} but no reveal landed anywhere in the final story.`,
          `${location}.reveal`,
          'Depict the authored reveal/payoff on-page in its episode, or emit a reveal flag the schedule can detect.',
        ));
      }

      // (3) off-placement — WARNING. Only meaningful when the entry is not already
      // a reveal-before-setup violation.
      // (3a) setup landed AFTER its authored setup episode.
      if (
        authoredSetup !== undefined &&
        observedSetup !== undefined &&
        observedSetup > authoredSetup &&
        episodeGenerated(authoredSetup)
      ) {
        metrics.offPlacementCount += 1;
        entryClean = false;
        issues.push(this.warning(
          `INFO "${entry.id}" setup landed in episode ${observedSetup}, after its authored setup episode ${authoredSetup}.`,
          `${location}.setup`,
          'Plant the setup in or before the authored setup episode so the reveal has its full runway.',
        ));
      }

      // (3b) reveal landed on a DIFFERENT episode than authored (but after setup).
      if (
        authoredReveal !== undefined &&
        observedReveal !== undefined &&
        observedReveal !== authoredReveal &&
        !(effectiveSetup !== undefined && observedReveal < effectiveSetup) &&
        episodeGenerated(authoredReveal)
      ) {
        metrics.offPlacementCount += 1;
        entryClean = false;
        issues.push(this.warning(
          `INFO "${entry.id}" reveal landed in episode ${observedReveal}, not its authored reveal episode ${authoredReveal}.`,
          `${location}.reveal`,
          'Land the reveal on its authored episode to preserve the treatment\'s information rhythm.',
        ));
      }

      if (entryClean) metrics.onScheduleCount += 1;
    }

    return this.result(issues, metrics);
  }

  /** Earliest authored setup episode (min setupTouchEpisodes, else introducedEpisode). */
  private authoredSetupEpisode(entry: InformationLedgerEntry): number | undefined {
    const touches = Array.isArray(entry.setupTouchEpisodes)
      ? entry.setupTouchEpisodes.filter((n) => typeof n === 'number' && Number.isFinite(n))
      : [];
    if (touches.length > 0) return Math.min(...touches);
    if (typeof entry.introducedEpisode === 'number' && Number.isFinite(entry.introducedEpisode)) {
      return entry.introducedEpisode;
    }
    return undefined;
  }

  /**
   * Scan the final story (episode order) for markers tied to this INFO entry.
   * Returns the earliest observed setup episode and the earliest observed reveal
   * episode (a reveal is the load-bearing landing; the first one wins).
   */
  private scanStory(
    entry: InformationLedgerEntry,
    episodes: Episode[],
  ): ObservedInfoSchedule {
    const markers: ScanMarker[] = [];
    const ordered = [...episodes].sort((a, b) => (a.number ?? 0) - (b.number ?? 0));

    for (const episode of ordered) {
      const epNum = episode.number;
      if (typeof epNum !== 'number' || !Number.isFinite(epNum)) continue;
      for (const scene of episode.scenes ?? []) {
        this.collectSceneMarkers(entry, scene, epNum, markers);
      }
      for (const c of episode.onComplete ?? []) {
        this.collectConsequenceMarker(entry, c, epNum, markers);
      }
    }

    const setups = markers.filter((m) => m.phase === 'setup').map((m) => m.episode);
    const reveals = markers.filter((m) => m.phase === 'reveal').map((m) => m.episode);
    return {
      setupEpisode: setups.length > 0 ? Math.min(...setups) : undefined,
      revealEpisode: reveals.length > 0 ? Math.min(...reveals) : undefined,
    };
  }

  private collectSceneMarkers(
    entry: InformationLedgerEntry,
    scene: Scene,
    epNum: number,
    markers: ScanMarker[],
  ): void {
    for (const beat of scene.beats ?? []) {
      this.collectBeatMarkers(entry, beat, epNum, markers);
    }
    // Encounter scenes carry their setup/reveal beats in `encounter.phases[].beats`
    // and `encounter.storylets[].beats`, NOT `scene.beats` — so an INFO reveal that
    // lands inside an encounter (e.g. a midpoint reframe staged in the Velvet Booth)
    // would read as "never landed" if we only scanned scene.beats. Scan encounter
    // beats too.
    const enc = scene.encounter as
      | { phases?: Array<{ beats?: Beat[] }>; storylets?: unknown }
      | undefined;
    if (enc) {
      for (const phase of enc.phases ?? []) {
        for (const beat of phase.beats ?? []) this.collectBeatMarkers(entry, beat, epNum, markers);
      }
      const storylets = Array.isArray(enc.storylets)
        ? enc.storylets
        : Object.values((enc.storylets ?? {}) as Record<string, unknown>);
      for (const storylet of storylets) {
        if (!storylet || typeof storylet !== 'object') continue;
        for (const beat of (storylet as { beats?: Beat[] }).beats ?? []) {
          this.collectBeatMarkers(entry, beat, epNum, markers);
        }
      }
    }
  }

  private collectBeatMarkers(
    entry: InformationLedgerEntry,
    beat: Beat,
    epNum: number,
    markers: ScanMarker[],
  ): void {
    // Flag emitters (the deterministic, authoritative signal).
    for (const c of beat.onShow ?? []) {
      this.collectConsequenceMarker(entry, c, epNum, markers);
    }
    for (const choice of beat.choices ?? []) {
      for (const c of choice.consequences ?? []) {
        this.collectConsequenceMarker(entry, c, epNum, markers);
      }
    }
    // Softer prose signal: beat text that names the INFO id. Treated as a reveal
    // touch when it carries a reveal keyword, otherwise a setup touch. Encounter beats
    // carry prose in `setupText`/`escalationText` rather than `text`, so check those too.
    const proseFields = [
      beat.text,
      (beat as { setupText?: string }).setupText,
      (beat as { escalationText?: string }).escalationText,
    ];
    for (const prose of proseFields) {
      if (typeof prose === 'string' && referencesEntry(prose, entry)) {
        markers.push({ episode: epNum, phase: REVEAL_TOKEN.test(prose) ? 'reveal' : 'setup' });
      }
    }
  }

  private collectConsequenceMarker(
    entry: InformationLedgerEntry,
    c: Consequence,
    epNum: number,
    markers: ScanMarker[],
  ): void {
    if (c.type !== 'setFlag') return;
    const flag = c.flag;
    if (typeof flag !== 'string' || !referencesEntry(flag, entry)) return;
    // Phase from the flag suffix: explicit reveal/payoff token → reveal; explicit
    // setup/hint/seed token → setup; otherwise default to setup (a bare flag plant
    // is a setup touch, not a reveal).
    const phase: InfoSchedulePhase = REVEAL_TOKEN.test(flag)
      ? 'reveal'
      : SETUP_TOKEN.test(flag)
        ? 'setup'
        : 'setup';
    markers.push({ episode: epNum, phase });
  }

  private result(
    issues: ValidationIssue[],
    metrics: InformationScheduleMetrics,
  ): InformationScheduleResult {
    const errorCount = issues.filter((issue) => issue.severity === 'error').length;
    const warningCount = issues.filter((issue) => issue.severity === 'warning').length;
    return {
      valid: errorCount === 0,
      score: Math.max(0, 100 - errorCount * 20 - warningCount * 5),
      issues,
      suggestions: issues.map((i) => i.suggestion).filter((s): s is string => Boolean(s)),
      metrics,
    };
  }
}
