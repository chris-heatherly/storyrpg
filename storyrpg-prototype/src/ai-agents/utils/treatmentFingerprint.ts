/**
 * Treatment version/identity fingerprint (Treatment-Fidelity Remediation Phase 0,
 * Step 0.1 — RC1, the dominant cause).
 *
 * The pipeline must be able to detect when the document it physically ingested is
 * NOT the authored treatment a run was supposed to expand (the ENDSONG incident:
 * a re-cut rewrite carrying `Dawn in Silvermist Valley` was ingested instead of
 * the canonical `Dawn and Discord`, and the pipeline faithfully preserved the
 * corrupt input). A "completeness check" cannot catch this — the swapped doc is
 * structurally complete. Only a TITLE / CUT / VERSION comparison can.
 *
 * This module computes a stable, human-readable fingerprint of a parsed treatment:
 *   - the episode count,
 *   - the ordered list of normalized authored episode titles, and
 *   - the Section-7 beat -> episode anchor map (when present).
 *
 * Normalization collapses whitespace and strips markdown emphasis / heading
 * punctuation so a trivially re-saved-but-identical treatment fingerprints
 * identically (per §6 "Version-guard false positives" — no false rejects).
 *
 * Pure / deterministic: a fingerprint is a function only of its inputs. No env,
 * no clock, no randomness.
 */

import { STORY_CIRCLE_BEATS } from '../../types/sourceAnalysis';
import type { StoryCircleBeat, StructuralRole } from '../../types/sourceAnalysis';
import type { ExtractedTreatment } from './treatmentExtraction';

/** Beats that can carry an explicit `(EpN)` anchor in Section 7. */
export type AnchorableBeat = Exclude<StructuralRole, 'rising' | 'falling'>;

/** A stable, comparable identity for a parsed treatment. */
export interface TreatmentFingerprint {
  /** Number of authored episodes parsed. */
  episodeCount: number;
  /** Authored episode titles, in episode order, each normalized. */
  normalizedTitles: string[];
  /**
   * Section-7 beat -> episode-number anchors (e.g. `{ plotTurn1: 3 }`). Empty
   * when the treatment does not spell out per-beat episode anchoring. Sorted by
   * beat name so the serialized form is order-independent.
   */
  beatEpisodeAnchors: Partial<Record<AnchorableBeat, number>>;
  /**
   * A single compact string combining the above — convenient for logging,
   * persisting next to `00-input-brief.json`, and `===` comparison.
   */
  signature: string;
}

const BEAT_LABELS: Array<{ beat: AnchorableBeat; pattern: RegExp }> = [
  { beat: 'hook', pattern: /\bhook\b/i },
  { beat: 'plotTurn1', pattern: /\bplot\s*turn\s*1\b/i },
  { beat: 'pinch1', pattern: /\bpinch\s*1\b/i },
  { beat: 'midpoint', pattern: /\bmid\s*point\b/i },
  { beat: 'pinch2', pattern: /\bpinch\s*2\b/i },
  { beat: 'climax', pattern: /\bclimax\b/i },
  { beat: 'resolution', pattern: /\bresolution\b/i },
];

const STORY_CIRCLE_BEAT_LABELS: Array<{ beat: StoryCircleBeat; pattern: RegExp }> = [
  { beat: 'you', pattern: /\byou\b|\bhook\b/i },
  { beat: 'need', pattern: /\bneed\b|\bwant\s*(?:vs\.?|\/)?\s*need\b/i },
  { beat: 'go', pattern: /\bgo\b|\bplot\s*turn\s*1\b|\bthreshold\b/i },
  { beat: 'search', pattern: /\bsearch\b|\bpinch\s*1\b/i },
  { beat: 'find', pattern: /\bfind\b|\bmidpoint\b/i },
  { beat: 'take', pattern: /\btake\b|\bpinch\s*2\b|\bprice\b/i },
  { beat: 'return', pattern: /\breturn\b|\bclimax\b/i },
  { beat: 'change', pattern: /\bchange\b|\bresolution\b/i },
];

/**
 * Normalize a title so trivial markdown / whitespace differences don't change the
 * fingerprint AND tolerant of an editorial suffix. This function ALWAYS
 * normalizes (it is not "kept for comparison only"): it lower-cases, strips
 * markdown emphasis and heading punctuation, collapses whitespace, AND drops a
 * single trailing parenthetical descriptor such as "(FINALE)" / "(Part 1)".
 *
 * Dropping the trailing parenthetical makes title matching tolerant of a
 * generator that keeps the title but omits the editorial suffix: "Endsong
 * (FINALE)" and "Endsong" normalize to the same "endsong", so a faithful
 * expansion is not falsely flagged as a re-title. It is deliberately narrow:
 * only a parenthetical at the very END is removed, so a genuinely different title
 * is still distinct: "Dawn and Discord" and "**Dawn and Discord (FINALE)**" match,
 * but "Dawn and Discord" vs "Dawn in Silvermist Valley" do NOT.
 */
export function normalizeTreatmentTitle(raw: string | undefined | null): string {
  if (!raw) return '';
  return raw
    .replace(/[*_`#]+/g, ' ') // markdown emphasis / heading marks
    .replace(/^[\s\-—–:.)]+/, '') // leading list / numbering punctuation
    .replace(/\s*\([^()]*\)\s*$/, '') // drop a single trailing parenthetical (e.g. "(FINALE)")
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * Extract the Section-7 `(EpN)` beat anchors from the treatment's free-text
 * season spine. The canonical treatment writes lines such as
 * `Plot turn 1 (Ep3)` / `Pinch 1 (Ep4)` / `Midpoint (Ep6)`.
 *
 * Best-effort and forgiving: matches `Ep3`, `Episode 3`, `(Ep 3)`, etc. Returns
 * only beats it can confidently anchor. This is the same free-text source the
 * remediation plan flags (`treatmentExtraction.ts:495` seasonSpine) and is the
 * intended input to the future structured `beatEpisodeAnchors` map (Phase 1).
 */
export function extractBeatEpisodeAnchors(
  seasonSpine: string | undefined,
): Partial<Record<AnchorableBeat, number>> {
  const anchors: Partial<Record<AnchorableBeat, number>> = {};
  if (!seasonSpine) return anchors;
  // Scan line-by-line so a beat keyword only binds to an (EpN) on the same line.
  for (const line of seasonSpine.split(/\r?\n/)) {
    const epMatch = line.match(/\(?\bEp(?:isode)?\.?\s*#?\s*(\d+)\b\)?/i);
    if (!epMatch) continue;
    const episodeNumber = Number(epMatch[1]);
    if (!Number.isFinite(episodeNumber)) continue;
    for (const { beat, pattern } of BEAT_LABELS) {
      if (anchors[beat] === undefined && pattern.test(line)) {
        anchors[beat] = episodeNumber;
      }
    }
  }
  return anchors;
}

export function extractStoryCircleBeatEpisodeAnchors(
  seasonSpine: string | undefined,
): Partial<Record<StoryCircleBeat, number>> {
  const anchors: Partial<Record<StoryCircleBeat, number>> = {};
  if (!seasonSpine) return anchors;
  for (const line of seasonSpine.split(/\r?\n/)) {
    const epMatch = line.match(/\(?\bEp(?:isode)?\.?\s*#?\s*(\d+)\b\)?/i);
    if (!epMatch) continue;
    const episodeNumber = Number(epMatch[1]);
    if (!Number.isFinite(episodeNumber)) continue;
    for (const { beat, pattern } of STORY_CIRCLE_BEAT_LABELS) {
      if (anchors[beat] === undefined && pattern.test(line)) {
        anchors[beat] = episodeNumber;
      }
    }
  }
  return Object.fromEntries(
    STORY_CIRCLE_BEATS
      .filter((beat) => anchors[beat] !== undefined)
      .map((beat) => [beat, anchors[beat]]),
  ) as Partial<Record<StoryCircleBeat, number>>;
}

function serializeAnchors(anchors: Partial<Record<AnchorableBeat, number>>): string {
  const entries = (Object.keys(anchors) as AnchorableBeat[])
    .filter((beat) => anchors[beat] !== undefined)
    .sort()
    .map((beat) => `${beat}:${anchors[beat]}`);
  return entries.join(',');
}

/**
 * Compute the fingerprint of a parsed treatment. `markdown` is the raw treatment
 * source (used only to recover the Section-7 anchors when the extracted
 * `seasonGuidance.seasonSpine` is the carrier).
 */
export function computeTreatmentFingerprint(
  treatment: Pick<ExtractedTreatment, 'episodes' | 'seasonGuidance'>,
): TreatmentFingerprint {
  const episodeNumbers = Object.keys(treatment.episodes || {})
    .map(Number)
    .filter(Number.isFinite)
    .sort((a, b) => a - b);

  const normalizedTitles = episodeNumbers.map((n) =>
    normalizeTreatmentTitle(treatment.episodes[n]?.authoredTitle || `episode ${n}`),
  );

  const beatEpisodeAnchors = extractBeatEpisodeAnchors(treatment.seasonGuidance?.seasonSpine);

  const signature = [
    `episodes=${episodeNumbers.length}`,
    `titles=${normalizedTitles.join('|')}`,
    `anchors=${serializeAnchors(beatEpisodeAnchors)}`,
  ].join(';');

  return {
    episodeCount: episodeNumbers.length,
    normalizedTitles,
    beatEpisodeAnchors,
    signature,
  };
}

/** The shape of a mismatch reported by {@link compareTreatmentFingerprints}. */
export interface FingerprintComparison {
  /** True iff the two fingerprints are equivalent after normalization. */
  matches: boolean;
  /** Human-readable reasons the fingerprints differ (empty when they match). */
  differences: string[];
}

/**
 * Compare two fingerprints. Equality is structural (count + ordered normalized
 * titles + anchor map), NOT raw-string equality, so a re-saved identical
 * treatment matches. Either argument may be a full {@link TreatmentFingerprint}
 * or a bare `signature` string (what an `expectedTreatmentFingerprint` request
 * field would typically carry).
 */
export function compareTreatmentFingerprints(
  actual: TreatmentFingerprint,
  expected: TreatmentFingerprint | string,
): FingerprintComparison {
  // A bare signature string is compared directly against the actual signature.
  if (typeof expected === 'string') {
    const matches = actual.signature === expected;
    return {
      matches,
      differences: matches
        ? []
        : [`signature mismatch: expected "${expected}" but ingested "${actual.signature}"`],
    };
  }

  const differences: string[] = [];
  if (actual.episodeCount !== expected.episodeCount) {
    differences.push(
      `episode count: expected ${expected.episodeCount}, ingested ${actual.episodeCount}`,
    );
  }
  const maxTitles = Math.max(actual.normalizedTitles.length, expected.normalizedTitles.length);
  for (let i = 0; i < maxTitles; i++) {
    const a = actual.normalizedTitles[i];
    const e = expected.normalizedTitles[i];
    if (a !== e) {
      differences.push(`episode ${i + 1} title: expected "${e ?? '(none)'}", ingested "${a ?? '(none)'}"`);
    }
  }
  const expectedAnchors = serializeAnchors(expected.beatEpisodeAnchors);
  const actualAnchors = serializeAnchors(actual.beatEpisodeAnchors);
  if (expectedAnchors !== actualAnchors) {
    differences.push(`beat anchors: expected "${expectedAnchors}", ingested "${actualAnchors}"`);
  }

  return { matches: differences.length === 0, differences };
}
