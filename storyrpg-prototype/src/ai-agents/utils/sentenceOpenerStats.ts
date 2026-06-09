import type { Story } from '../../types';

/**
 * Sentence-opener variety analysis (shared by the SentenceOpenerVarietyValidator
 * and the `analyze:openers` CLI so detection and measurement use ONE definition).
 *
 * The reader plays in second person, so "You …" openers are correct and expected.
 * The defect is MONOTONY: stacking subject-first second-person declaratives
 * ("You save the file. You don't know where. You just know …") flattens the prose.
 * G10 measured 39% second-person openers in Bite Me (43% in post-choice
 * `outcomeTexts`), with 18/92 beats opening ≥60% of their sentences second-person.
 *
 * This module quantifies that and locates the worst passages. It does NOT punish
 * second person itself — only runs of consecutive second-person openers within a
 * single authored passage (a beat's text, or one success/partial/failure tier).
 */

/** A run of this many consecutive second-person sentence openers in one passage flags. */
export const MONOTONY_RUN_THRESHOLD = 3;

export interface OpenerBucketStats {
  sentences: number;
  secondPersonOpenings: number;
}

export interface MonotonyPassage {
  /** Beat id or `${choiceId}:${tier}` for an outcome tier. */
  where: string;
  bucket: 'beat' | 'outcome';
  /** Longest run of consecutive second-person openers in this passage. */
  longestRun: number;
  sentences: number;
  /** First ~90 chars of the offending passage, for the validator message / report. */
  excerpt: string;
}

export interface OpenerStats {
  totalSentences: number;
  secondPersonOpenings: number;
  /** 0..1 across all analyzed sentences. */
  secondPersonRatio: number;
  /** Longest consecutive run found in any single passage. */
  longestRun: number;
  /** Passages whose longest run reaches MONOTONY_RUN_THRESHOLD. */
  monotonyPassages: MonotonyPassage[];
  byBucket: {
    beat: OpenerBucketStats;
    outcome: OpenerBucketStats;
  };
}

/**
 * Split prose into sentences. Conservative: split on a terminator followed by
 * whitespace and an opening capital or quote. Keeps abbreviations/decimals intact
 * well enough for opener analysis (we only ever read the first word).
 */
export function splitSentences(text: string | undefined): string[] {
  if (!text) return [];
  return text
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s+(?=["“'A-Z])/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** First alphabetic word of a sentence, after stripping leading quotes/dashes/parens. */
export function openerWord(sentence: string): string {
  const m = sentence.replace(/^["“'(—–\-\s]+/, '').match(/^([A-Za-z][A-Za-z'’]*)/);
  return m ? m[1] : '';
}

/**
 * True when a sentence opens with a second-person pronoun (You/Your/You're/You'd/…).
 * Precise set so non-pronoun "you…" words (young, youth) do NOT count.
 */
export function isSecondPersonOpener(word: string): boolean {
  return /^(?:you|your|youre|youd|youll|youve|yours|yourself|yourselves)$/i.test(
    word.replace(/['’]/g, ''),
  );
}

/** Longest run of consecutive second-person openers across a passage's sentences. */
export function longestSecondPersonRun(sentences: string[]): number {
  let run = 0;
  let longest = 0;
  for (const s of sentences) {
    const w = openerWord(s);
    if (!w) continue;
    if (isSecondPersonOpener(w)) {
      run += 1;
      if (run > longest) longest = run;
    } else {
      run = 0;
    }
  }
  return longest;
}

interface ChoiceLike {
  id?: string;
  text?: string;
  outcomeTexts?: { success?: string; partial?: string; failure?: string };
}

/** Walk a story, scoring every beat's text and every outcome tier for opener monotony. */
export function analyzeStory(story: Story): OpenerStats {
  const stats: OpenerStats = {
    totalSentences: 0,
    secondPersonOpenings: 0,
    secondPersonRatio: 0,
    longestRun: 0,
    monotonyPassages: [],
    byBucket: {
      beat: { sentences: 0, secondPersonOpenings: 0 },
      outcome: { sentences: 0, secondPersonOpenings: 0 },
    },
  };

  const consume = (text: string | undefined, bucket: 'beat' | 'outcome', where: string): void => {
    const sentences = splitSentences(text);
    if (sentences.length === 0) return;
    for (const s of sentences) {
      const w = openerWord(s);
      if (!w) continue;
      stats.totalSentences += 1;
      stats.byBucket[bucket].sentences += 1;
      if (isSecondPersonOpener(w)) {
        stats.secondPersonOpenings += 1;
        stats.byBucket[bucket].secondPersonOpenings += 1;
      }
    }
    const longest = longestSecondPersonRun(sentences);
    if (longest > stats.longestRun) stats.longestRun = longest;
    if (longest >= MONOTONY_RUN_THRESHOLD) {
      stats.monotonyPassages.push({
        where,
        bucket,
        longestRun: longest,
        sentences: sentences.length,
        excerpt: (text || '').replace(/\s+/g, ' ').trim().slice(0, 90),
      });
    }
  };

  for (const ep of story.episodes || []) {
    for (const sc of ep.scenes || []) {
      for (const beat of sc.beats || []) {
        consume(beat.text, 'beat', beat.id || '(beat)');
        const choices = (beat as { choices?: ChoiceLike[] }).choices || [];
        for (const choice of choices) {
          const ot = choice.outcomeTexts;
          if (!ot) continue;
          const base = choice.id || '(choice)';
          consume(ot.success, 'outcome', `${base}:success`);
          consume(ot.partial, 'outcome', `${base}:partial`);
          consume(ot.failure, 'outcome', `${base}:failure`);
        }
      }
    }
  }

  stats.secondPersonRatio =
    stats.totalSentences > 0 ? stats.secondPersonOpenings / stats.totalSentences : 0;
  return stats;
}
