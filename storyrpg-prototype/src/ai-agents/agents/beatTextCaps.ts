/**
 * Beat word/sentence-cap counting and the deterministic remedies for over-cap
 * beat prose — merge (comma-join choppy fragments) and split (redistribute
 * sentences across chained beats).
 *
 * Why one module: the cap CHECKER counts sentences as runs of terminal
 * punctuation (`/[.!?]+/g`), which disagrees with every other sentence utility
 * in the codebase (textEnforcer counts on punctuation+whitespace,
 * sentenceOpenerStats keeps abbreviations intact, ...). A remedy built on a
 * different definition can emit "fixed" text the checker still fails — so the
 * checker and both remedies live here and share one segmentation by
 * construction.
 *
 * Fiction-first note: neither remedy authors prose. The merge changes only
 * punctuation between existing LLM-authored fragments (accepted precedent —
 * shipped in SceneWriter since the fragment-compaction fix); the split
 * redistributes whole existing sentences across beats.
 *
 * Origin: bite-me-r116_2026-07-18T20-48-58 — s1-3-b4 shipped 9 sentences at
 * 60/70 words, the merge net silently bailed (fragments.length > 9), the LLM
 * revision didn't fix it, and the whole episode aborted on a pacing defect.
 */

/**
 * The cap checker's sentence count: runs of terminal punctuation. Ellipses
 * count once (`+`); abbreviations ("Dr.") DO count — deliberately unchanged,
 * because this is the semantics the cap has always been enforced under.
 */
export function countSentencesBounded(text: string): number {
  return (text.match(/[.!?]+/g) || []).length;
}

/**
 * Segment text into sentence fragments, each carrying its terminal punctuation
 * (a trailing unterminated fragment is kept too). Same expression the merge
 * has always used; now also the split's boundary definition.
 */
export function segmentSentenceFragments(text: string): string[] {
  return (
    text.match(/[^.!?]+[.!?]+|[^.!?]+$/g)
      ?.map((fragment) => fragment.trim())
      .filter(Boolean)
  ) ?? [];
}

function wordCount(text: string): number {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

export type CompactBailReason =
  | 'over_word_cap'
  | 'over_char_budget'
  | 'too_many_fragments'
  | 'still_over_after_merge';

export interface CompactOverFragmentedResult {
  text: string;
  applied: boolean;
  /** Why the merge declined, when it did — so callers can log instead of silently passing the defect on. */
  bailReason?: CompactBailReason;
  fragmentCount?: number;
}

/**
 * Comma-merge choppy prose (over the sentence cap, under the word cap) down to
 * `maxSentences` sentences. Every decline path reports WHY: the silent
 * `return text` bails are how r116's b4 defect survived normalization twice
 * without a single log line.
 *
 * The fragment ceiling is 16 (was 9): the even-distribution grouping keeps
 * comma runs bounded (≤4 fragments per sentence at 16), and the word cap
 * already bounds total length. r116's b4 had 9 punctuation runs plus a
 * trailing unterminated fragment = 10 fragments — exactly what the old bound
 * silently rejected.
 */
export function compactOverFragmentedText(
  text: string,
  maxWords: number,
  maxSentences: number,
): CompactOverFragmentedResult {
  if (!text || countSentencesBounded(text) <= maxSentences) return { text, applied: false };
  if (wordCount(text) > maxWords) return { text, applied: false, bailReason: 'over_word_cap' };
  if (text.length > 700) return { text, applied: false, bailReason: 'over_char_budget' };

  const fragments = segmentSentenceFragments(text);
  if (fragments.length <= maxSentences) return { text, applied: false };
  if (fragments.length > 16) {
    return { text, applied: false, bailReason: 'too_many_fragments', fragmentCount: fragments.length };
  }

  const groups: string[][] = Array.from({ length: maxSentences }, () => []);
  fragments.forEach((fragment, index) => {
    groups[Math.min(maxSentences - 1, Math.floor(index * maxSentences / fragments.length))].push(fragment);
  });

  const compacted = groups
    .filter((group) => group.length > 0)
    .map((group) => group.map((fragment, index) => {
      const cleaned = fragment.replace(/[.!?]+$/g, '').trim();
      if (index < group.length - 1) return `${cleaned},`;
      const terminal = fragment.match(/[.!?]+$/)?.[0]?.slice(-1) || '.';
      return `${cleaned}${terminal}`;
    }).join(' '))
    .join(' ');

  if (countSentencesBounded(compacted) <= maxSentences) {
    return { text: compacted, applied: true, fragmentCount: fragments.length };
  }
  return { text, applied: false, bailReason: 'still_over_after_merge', fragmentCount: fragments.length };
}

/** A split producing more than this many beats means the source beat was degenerate bloat, not a near-miss — leave those to the LLM revision. */
const MAX_SPLIT_CHUNKS = 3;

/**
 * Split over-cap beat text into chunks that each satisfy BOTH caps, greedily
 * packing whole sentence fragments in order. Returns `undefined` when a split
 * cannot help or should not run: a single fragment alone breaks the word cap
 * (a mega-sentence only an LLM rewrite can fix), the text is already within
 * caps, or the split would need more than MAX_SPLIT_CHUNKS beats — a beat
 * that oversized is degenerate output whose fix is a concise LLM rewrite
 * (the OVERLONG revision path), not a mechanical dice into a dozen beats.
 */
export function splitBeatTextForCaps(
  text: string,
  caps: { maxWords: number; maxSentences: number },
): string[] | undefined {
  if (!text) return undefined;
  if (countSentencesBounded(text) <= caps.maxSentences && wordCount(text) <= caps.maxWords) {
    return undefined;
  }
  const fragments = segmentSentenceFragments(text);
  if (fragments.length < 2) return undefined;
  if (fragments.some((fragment) => wordCount(fragment) > caps.maxWords)) return undefined;

  const chunks: string[] = [];
  let current: string[] = [];
  let currentWords = 0;
  for (const fragment of fragments) {
    const fragmentWords = wordCount(fragment);
    const fragmentSentences = Math.max(1, countSentencesBounded(fragment));
    const currentSentences = countSentencesBounded(current.join(' '));
    if (
      current.length > 0
      && (currentWords + fragmentWords > caps.maxWords
        || currentSentences + fragmentSentences > caps.maxSentences)
    ) {
      chunks.push(current.join(' '));
      current = [];
      currentWords = 0;
    }
    current.push(fragment);
    currentWords += fragmentWords;
  }
  if (current.length > 0) chunks.push(current.join(' '));

  if (chunks.length < 2 || chunks.length > MAX_SPLIT_CHUNKS) return undefined;
  if (chunks.some((chunk) => countSentencesBounded(chunk) > caps.maxSentences || wordCount(chunk) > caps.maxWords)) {
    return undefined;
  }
  return chunks;
}
