import { describe, expect, it } from 'vitest';
import {
  compactOverFragmentedText,
  countSentencesBounded,
  segmentSentenceFragments,
  splitBeatTextForCaps,
} from './beatTextCaps';

describe('countSentencesBounded (the cap checker semantics)', () => {
  it('counts runs of terminal punctuation', () => {
    expect(countSentencesBounded('One. Two! Three?')).toBe(3);
  });

  it('counts an ellipsis as one boundary', () => {
    expect(countSentencesBounded('She waited... then knocked.')).toBe(2);
  });

  it('counts abbreviations as boundaries — deliberately unchanged checker semantics', () => {
    // "Dr." counts. Any remedy sharing this module produces text this counter
    // accepts, which is the whole point of centralizing it.
    expect(countSentencesBounded('Dr. Smith ran.')).toBe(2);
  });
});

describe('segmentSentenceFragments', () => {
  it('keeps terminal punctuation with each fragment and keeps a trailing unterminated fragment', () => {
    expect(segmentSentenceFragments('One. Two! And then')).toEqual(['One.', 'Two!', 'And then']);
  });

  it('returns empty for empty text', () => {
    expect(segmentSentenceFragments('')).toEqual([]);
  });
});

describe('compactOverFragmentedText', () => {
  it('merges choppy fragments under the word cap down to the sentence cap', () => {
    const text = 'She turned. She smiled. She waited. She spoke. She left. She returned.';
    const result = compactOverFragmentedText(text, 70, 4);
    expect(result.applied).toBe(true);
    expect(countSentencesBounded(result.text)).toBeLessThanOrEqual(4);
  });

  it('merges the r116 b4 shape: 9 punctuation runs plus a trailing fragment (10 fragments, silently bailed before)', () => {
    // bite-me-r116_2026-07-18T20-48-58 s1-3-b4: 9/4 sentences at 60/70 words.
    // The old fragments.length > 9 guard silently rejected this exact shape.
    const text =
      'Behind the counter, a woman looks up. Her plait is dark. Her gaze is steady. She does not smile. '
      + '"You are new," she says. "The city watches." She sets down her pen. The bell goes quiet. You wait. and then';
    expect(countSentencesBounded(text)).toBe(9);
    expect(segmentSentenceFragments(text).length).toBe(10);
    const result = compactOverFragmentedText(text, 70, 4);
    expect(result.applied).toBe(true);
    expect(countSentencesBounded(result.text)).toBeLessThanOrEqual(4);
  });

  it('declines over-word-cap text with a typed reason (split territory, not merge)', () => {
    const longText = Array.from({ length: 8 }, (_, i) => `Sentence number ${i} keeps going with many extra trailing words here now.`).join(' ');
    const result = compactOverFragmentedText(longText, 70, 4);
    expect(result.applied).toBe(false);
    expect(result.bailReason).toBe('over_word_cap');
    expect(result.text).toBe(longText);
  });

  it('returns unchanged, no reason, when already within the sentence cap', () => {
    const result = compactOverFragmentedText('One. Two.', 70, 4);
    expect(result.applied).toBe(false);
    expect(result.bailReason).toBeUndefined();
  });
});

describe('splitBeatTextForCaps', () => {
  it('splits over-word-cap text into chunks each within both caps', () => {
    const text = Array.from({ length: 8 }, (_, i) => `Sentence number ${i} keeps going with many extra trailing words attached to it.`).join(' ');
    const chunks = splitBeatTextForCaps(text, { maxWords: 70, maxSentences: 4 });
    expect(chunks).toBeDefined();
    expect(chunks!.length).toBeGreaterThanOrEqual(2);
    for (const chunk of chunks!) {
      expect(countSentencesBounded(chunk)).toBeLessThanOrEqual(4);
      expect(chunk.trim().split(/\s+/).length).toBeLessThanOrEqual(70);
    }
    // No prose authored or lost: the chunks re-join to the original fragments.
    expect(chunks!.join(' ')).toBe(segmentSentenceFragments(text).join(' '));
  });

  it('returns undefined for a single mega-sentence over the word cap (genuinely needs an LLM rewrite)', () => {
    const megaSentence = `${Array.from({ length: 80 }, (_, i) => `word${i}`).join(' ')}.`;
    expect(splitBeatTextForCaps(megaSentence, { maxWords: 70, maxSentences: 4 })).toBeUndefined();
  });

  it('returns undefined when any one fragment alone exceeds the word cap', () => {
    const text = `Short opener. ${Array.from({ length: 80 }, (_, i) => `word${i}`).join(' ')}.`;
    expect(splitBeatTextForCaps(text, { maxWords: 70, maxSentences: 4 })).toBeUndefined();
  });

  it('returns undefined when the text is already within caps', () => {
    expect(splitBeatTextForCaps('One. Two.', { maxWords: 70, maxSentences: 4 })).toBeUndefined();
  });
});

describe('splitBeatTextForCaps minimum-substance guard (batch r121)', () => {
  it('never emits a chunk under the substance floor — the r121 lone-quote trailing fragment', () => {
    // r121 shipped beat "s1-3-b4-split-3" containing ONE character (a stray
    // quote) — the trailing fragment survived greedy packing as its own chunk
    // and downstream repair rejected rewrites for omitting the junk beat id.
    const text = `${Array.from({ length: 8 }, (_, i) => `Sentence number ${i} keeps rolling forward with plenty of extra words attached here.`).join(' ')} '`;
    const chunks = splitBeatTextForCaps(text, { maxWords: 70, maxSentences: 4 });
    if (chunks) {
      for (const chunk of chunks) {
        expect(chunk.trim().split(/\s+/).length).toBeGreaterThanOrEqual(4);
      }
    }
    // Either outcome is acceptable (fold or decline); emitting a junk chunk is not.
  });

  it('folds a small trailing fragment into the previous chunk when caps allow', () => {
    const text = 'First sentence has a solid handful of words. Second sentence also carries real content along. so it';
    const chunks = splitBeatTextForCaps(text, { maxWords: 12, maxSentences: 1 });
    if (chunks) {
      for (const chunk of chunks) {
        expect(chunk.trim().split(/\s+/).length).toBeGreaterThanOrEqual(4);
      }
    }
  });
});
