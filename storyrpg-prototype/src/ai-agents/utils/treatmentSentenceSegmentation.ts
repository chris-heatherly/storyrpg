const SENTENCE_ABBREVIATION_DOT = '__TREATMENT_ABBR_DOT__';
const SENTENCE_ABBREVIATION_RE = /\b(?:Mr|Mrs|Ms|Mx|Dr|Prof|Sr|Jr|St|Mt|Capt|Lt|Col|Gen|Sen|Rep|Gov|Rev)\.|\b(?:a|p)\.m\./gi;

function protectSentenceAbbreviations(text: string): string {
  return text.replace(SENTENCE_ABBREVIATION_RE, (match) =>
    match.replace(/\./g, SENTENCE_ABBREVIATION_DOT)
  );
}

function restoreSentenceAbbreviations(text: string): string {
  return text.replace(new RegExp(SENTENCE_ABBREVIATION_DOT, 'g'), '.');
}

export function splitSentencesPreservingAbbreviations(text: string): string[] {
  return protectSentenceAbbreviations(text)
    .split(/(?<=[.!?])\s+|;\s+/)
    .map((part) => restoreSentenceAbbreviations(part));
}
