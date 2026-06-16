/**
 * Episode knowledge extraction (Season Canon, Phase B2).
 *
 * Produces the structured facts + claims that populate the SeasonCanon at seal time
 * — the producer the seal plumbing was already waiting for (`sealAndPersistEpisode`
 * accepts `claims` + `extraDeltas` but nothing supplied them, so the canon held only
 * flag-derived + capability facts and the canon-consistency gate ran over zero claims).
 *
 * Deterministic seed (no new LLM call): reuse the QA bundles the pipeline already
 * builds — the per-character knowledge (`buildContinuityCharacterKnowledge`) and the
 * scene timeline (`buildContinuityTimeline`) — plus the flags this episode's beats
 * gate on. Keys (`factId`) are deterministic slugs per the seasonCanon contract so a
 * later reference to the same fact resolves across episodes.
 */

import type { EpisodeCanonDeltas } from './seasonCanon';
import type { KnowledgeClaim } from '../validators/canonConsistencyValidator';

export interface EpisodeKnowledgeInputs {
  episodeNumber: number;
  protagonistId: string;
  /** From buildContinuityCharacterKnowledge: what each character knows. */
  characterKnowledge?: Array<{ characterId: string; knows?: string[]; doesNotKnow?: string[] }>;
  /** From buildContinuityTimeline: ordered "what happens when". */
  timelineEvents?: Array<{ event: string; when: string }>;
  /** Flags this episode's beats/choices gate on (the basis for knowledge claims). */
  referencedFlags?: string[];
  /**
   * Optional free prose (e.g. concatenated scene text) scanned alongside timeline
   * events for recurring quantified metrics. Conservative: only clearly quantified,
   * clearly recurring metrics are emitted (see extractMonotonicMetrics).
   */
  sceneText?: string;
}

export interface EpisodeKnowledgeResult {
  /** worldFacts + knowledge to merge into the seal's extraDeltas. */
  deltas: EpisodeCanonDeltas;
  /** Claims for the canon-consistency gate (who references what, this episode). */
  claims: KnowledgeClaim[];
}

/** Deterministic slug for a factId (stable across episodes for the same statement). */
export function factSlug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64) || 'fact';
}

/**
 * A recurring quantified metric pulled from prose: a number immediately followed by
 * a tracked count noun (views/readers/followers/subscribers). These are the metrics
 * that regress across episodes when each episode re-guesses the figure, so each is
 * emitted as a worldFact with a STABLE id (keyed on the metric noun, not the value)
 * + numericValue + monotonic:'increasing'. The stable id makes the same metric across
 * episodes collide on id in sealEpisode and trip the max/min constraint.
 */
export interface MonotonicMetric {
  id: string;
  metric: string;
  value: number;
  statement: string;
}

/**
 * Metric nouns we treat as monotonically-increasing audience counts. Deliberately a
 * small, explicit allowlist — broadening this is the main false-positive risk (a
 * one-off in-fiction quantity like "50 soldiers" must NOT be tracked), so we only
 * match nouns that are unambiguously cumulative audience metrics.
 *
 * LIMITATION: this is a pattern matcher, not semantic understanding. It only fires on
 * "<number> <noun>" adjacency for these nouns and cannot tell a real metric from a
 * coincidental phrasing; that is the conservative trade chosen over a generic
 * extractor that might fabricate constraints from arbitrary numbers in prose.
 */
const MONOTONIC_METRIC_NOUNS = ['views', 'readers', 'followers', 'subscribers'] as const;

/** Parse a possibly-grouped integer like "90,147" or "84000" → number (or undefined). */
function parseGroupedInt(raw: string): number | undefined {
  const cleaned = raw.replace(/,/g, '');
  if (!/^\d+$/.test(cleaned)) return undefined;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Scan prose for `<number> <metric-noun>` and emit one MonotonicMetric per noun
 * (the HIGHEST value seen for that noun this episode — within an episode the latest/
 * largest figure is the one canon should carry). Returns [] when nothing matches.
 *
 * Only digit-form numbers are recognized; spelled-out numbers ("fifty thousand") are
 * intentionally NOT parsed — coercing prose number-words risks fabrication, and the
 * cross-episode constraint surfaced in the prompt is what steers the writer away from
 * a spelled-out regression in the first place.
 */
export function extractMonotonicMetrics(text: string): MonotonicMetric[] {
  if (!text) return [];
  const best = new Map<string, number>();
  for (const noun of MONOTONIC_METRIC_NOUNS) {
    // number (with optional grouping) followed within a couple words by the noun.
    const re = new RegExp(`(\\d[\\d,]*)\\s+(?:\\w+\\s+){0,2}${noun}\\b`, 'gi');
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const value = parseGroupedInt(m[1]);
      if (value === undefined) continue;
      const prev = best.get(noun);
      if (prev === undefined || value > prev) best.set(noun, value);
    }
  }
  return [...best.entries()].map(([metric, value]) => ({
    id: `metric:${metric}`,
    metric,
    value,
    statement: `${metric} count stands at ${value.toLocaleString('en-US')}`,
  }));
}

export function extractEpisodeKnowledge(input: EpisodeKnowledgeInputs): EpisodeKnowledgeResult {
  const worldFacts: NonNullable<EpisodeCanonDeltas['worldFacts']> = [];
  const knowledge: NonNullable<EpisodeCanonDeltas['knowledge']> = [];
  const claims: KnowledgeClaim[] = [];
  const seenWF = new Set<string>();
  const seenK = new Set<string>();
  const seenClaim = new Set<string>();

  // World facts from the scene timeline (bounded by scene count).
  for (const t of input.timelineEvents ?? []) {
    if (!t?.event) continue;
    const id = `wf:${factSlug(t.event)}`;
    if (seenWF.has(id)) continue;
    seenWF.add(id);
    worldFacts.push({ id, statement: t.when ? `${t.when}: ${t.event}` : t.event });
  }

  // Recurring quantified metrics (view/reader/follower/subscriber counts) → numeric
  // monotonic worldFacts with a STABLE id, so the same metric collides on id across
  // episodes and sealEpisode enforces the no-regression constraint. Scanned from the
  // timeline event text plus any supplied scene prose.
  const metricCorpus = [
    ...(input.timelineEvents ?? []).map((t) => t?.event ?? ''),
    input.sceneText ?? '',
  ].join('\n');
  for (const metric of extractMonotonicMetrics(metricCorpus)) {
    if (seenWF.has(metric.id)) continue;
    seenWF.add(metric.id);
    worldFacts.push({
      id: metric.id,
      statement: metric.statement,
      numericValue: metric.value,
      monotonic: 'increasing',
    });
  }

  // Knowledge: what each character knows → who-knows-what facts (bounded by roster).
  for (const ck of input.characterKnowledge ?? []) {
    if (!ck?.characterId) continue;
    for (const k of ck.knows ?? []) {
      if (!k) continue;
      const factId = `know:${factSlug(k)}`;
      const key = `${ck.characterId}|${factId}`;
      if (seenK.has(key)) continue;
      seenK.add(key);
      knowledge.push({ characterId: ck.characterId, factId, summary: k });
    }
  }

  // Claims: each flag the episode gates on is referenced by the protagonist NOW. The
  // canon-consistency gate flags it impossible if that fact is established later.
  for (const flag of input.referencedFlags ?? []) {
    if (!flag) continue;
    const factId = `flag:${flag}`;
    const key = `${input.protagonistId}|${factId}`;
    if (seenClaim.has(key)) continue;
    seenClaim.add(key);
    claims.push({ characterId: input.protagonistId, factId, episode: input.episodeNumber, summary: `references ${flag}` });
  }

  return { deltas: { worldFacts, knowledge }, claims };
}

interface FlagCondishScene {
  beats?: Array<{
    conditions?: unknown;
    choices?: Array<{ conditions?: unknown; condition?: unknown }>;
    textVariants?: Array<{ condition?: unknown }>;
  }>;
}
interface FlagCondishEpisode {
  scenes?: FlagCondishScene[];
}

/** Pull the flag names referenced by any condition in the episode (beats/choices/variants). */
export function collectReferencedFlags(episode: FlagCondishEpisode | undefined): string[] {
  const flags = new Set<string>();
  const visit = (cond: unknown): void => {
    if (!cond || typeof cond !== 'object') return;
    const c = cond as { type?: string; flag?: string; conditions?: unknown[]; and?: unknown[]; or?: unknown[] };
    if (c.type === 'flag' && typeof c.flag === 'string') flags.add(c.flag);
    for (const arr of [c.conditions, c.and, c.or]) {
      if (Array.isArray(arr)) for (const sub of arr) visit(sub);
    }
  };
  for (const scene of episode?.scenes ?? []) {
    for (const beat of scene.beats ?? []) {
      visit(beat.conditions);
      for (const ch of beat.choices ?? []) { visit(ch.conditions); visit(ch.condition); }
      for (const v of beat.textVariants ?? []) visit(v.condition);
    }
  }
  return [...flags];
}

/**
 * Concatenate an assembled episode's reader-facing prose (beat text + choice outcome
 * texts) into one corpus string for {@link extractMonotonicMetrics}. Lets the live
 * pipeline feed real prose to the metric extractor so blog-readership and similar
 * counts become monotonic canon facts (the bite-me 90K→50K regression).
 */
export function episodeProseCorpus(
  episode: { scenes?: Array<{ beats?: Array<{ text?: string; choices?: Array<{ outcomeTexts?: Record<string, string> }> }> }> } | undefined,
): string {
  return (episode?.scenes ?? [])
    .flatMap((sc) => (sc.beats ?? []).flatMap((b) => [
      b?.text ?? '',
      ...(b?.choices ?? []).flatMap((c) => Object.values(c.outcomeTexts ?? {})),
    ]))
    .join(' ');
}
