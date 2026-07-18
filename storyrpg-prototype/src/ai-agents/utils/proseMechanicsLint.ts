/**
 * G8: deterministic prose-mechanics linter — DETECTION ONLY.
 *
 * proseTypography.ts already auto-fixes the meaning-preserving spacing/quote
 * artifacts. The classes here (comma-splice-with-capitalized-continuation
 * inside dialogue, doubled punctuation) need a wording decision, so per the
 * standing rule deterministic code never repairs them — findings route a
 * bounded SceneWriter micro-rewrite and otherwise surface as advisory.
 *
 * Precision discipline: patterns are deliberately narrow. The splice check
 * only fires inside double-quoted dialogue, and only when the capitalized
 * continuation is a word that is ONLY capitalized at sentence start
 * (aux verbs, pronouns, wh-words, common interjections). "I" is excluded
 * (always capitalized; ", I stayed" is legitimate fiction), and The/A/An are
 * excluded (titles: «read my blog, The Dusk Diaries»).
 */

export type ProseMechanicsCode =
  | 'dialogue_comma_splice'
  | 'doubled_punctuation'
  | 'adjacent_comma_period'
  | 'malformed_honorific_punctuation';

export interface ProseMechanicsFinding {
  code: ProseMechanicsCode;
  /** Short excerpt around the defect, for feedback prompts and diagnostics. */
  excerpt: string;
}

export interface SceneMechanicsFinding extends ProseMechanicsFinding {
  beatId: string;
  field: 'text' | 'setupText' | 'escalationText' | 'textVariant';
}

/** Words that are only capitalized at sentence start — a comma before them inside dialogue is a splice. */
const SPLICE_CONTINUATION_WORDS = new Set([
  'was', 'were', 'is', 'are', 'am', 'be', 'been',
  'do', 'does', 'did', 'have', 'has', 'had',
  'can', 'could', 'will', 'would', 'shall', 'should', 'may', 'might', 'must',
  'he', 'she', 'it', 'we', 'they', 'you',
  'what', 'who', 'whom', 'whose', 'why', 'how', 'when', 'where', 'which',
  'there', 'then', 'now', 'but', 'so', 'yes', 'no',
  'welcome', 'come', 'tell', 'look', 'listen', 'wait', 'stop', 'let',
  "don't", "isn't", "aren't", "wasn't", "weren't", "didn't", "doesn't", "won't", "can't",
]);

const DIALOGUE_SPAN_RE = /["“]([^"“”]{2,400})["”]/g;
const SPLICE_CANDIDATE_RE = /,\s+([A-Z][a-z]*(?:['’][a-z]+)?)/g;
const DOUBLED_PUNCT_RE = /,,+|;;+|::+|(?<![.!?])\.\.(?!\.)/g;
const ADJACENT_COMMA_PERIOD_RE = /,\.|\.,/g;
// High-precision syntax defect: a comma cannot terminate an abbreviated
// honorific immediately before a proper name ("Mr, Midnight").
const MALFORMED_HONORIFIC_RE = /\b(?:Mr|Mrs|Ms|Dr|Prof|St|Sr|Jr),\s+(?=[A-Z])/g;

function excerptAround(text: string, index: number, length: number): string {
  const start = Math.max(0, index - 20);
  const end = Math.min(text.length, index + length + 20);
  return `${start > 0 ? '…' : ''}${text.slice(start, end)}${end < text.length ? '…' : ''}`;
}

export function lintProseMechanics(text: string): ProseMechanicsFinding[] {
  if (!text) return [];
  const findings: ProseMechanicsFinding[] = [];

  for (const span of text.matchAll(DIALOGUE_SPAN_RE)) {
    const inner = span[1];
    for (const candidate of inner.matchAll(SPLICE_CANDIDATE_RE)) {
      if (SPLICE_CONTINUATION_WORDS.has(candidate[1].toLowerCase())) {
        const at = (span.index ?? 0) + 1 + (candidate.index ?? 0);
        findings.push({ code: 'dialogue_comma_splice', excerpt: excerptAround(text, at, candidate[0].length) });
      }
    }
  }

  for (const match of text.matchAll(DOUBLED_PUNCT_RE)) {
    findings.push({ code: 'doubled_punctuation', excerpt: excerptAround(text, match.index ?? 0, match[0].length) });
  }
  for (const match of text.matchAll(ADJACENT_COMMA_PERIOD_RE)) {
    findings.push({ code: 'adjacent_comma_period', excerpt: excerptAround(text, match.index ?? 0, match[0].length) });
  }
  for (const match of text.matchAll(MALFORMED_HONORIFIC_RE)) {
    findings.push({ code: 'malformed_honorific_punctuation', excerpt: excerptAround(text, match.index ?? 0, match[0].length) });
  }
  return findings;
}

export function lintSceneMechanics(
  beats: Array<{ id?: string; text?: string; setupText?: string; escalationText?: string; textVariants?: Array<{ text?: string }> }>,
): SceneMechanicsFinding[] {
  const findings: SceneMechanicsFinding[] = [];
  for (const beat of beats ?? []) {
    const beatId = beat.id ?? '?';
    const surfaces: Array<[SceneMechanicsFinding['field'], string | undefined]> = [
      ['text', beat.text],
      ['setupText', beat.setupText],
      ['escalationText', beat.escalationText],
      ...(beat.textVariants ?? []).map((variant): [SceneMechanicsFinding['field'], string | undefined] => ['textVariant', variant.text]),
    ];
    for (const [field, value] of surfaces) {
      if (!value) continue;
      for (const finding of lintProseMechanics(value)) {
        findings.push({ ...finding, beatId, field });
      }
    }
  }
  return findings;
}

const CODE_INSTRUCTIONS: Record<ProseMechanicsCode, string> = {
  dialogue_comma_splice:
    'a comma splices two sentences inside dialogue (capitalized continuation after a comma). Replace the comma with a period, em dash, or conjunction — whichever reads naturally in the speaker\'s voice',
  doubled_punctuation: 'doubled punctuation marks. Collapse to a single mark (a true ellipsis must be three dots)',
  adjacent_comma_period: 'a comma directly adjacent to a period. Keep exactly one correct mark',
  malformed_honorific_punctuation:
    'a comma incorrectly terminates an abbreviated honorific before a proper name. Replace only that comma with a period',
};

/** Feedback for the bounded SceneWriter micro-rewrite. Names each exact defect; forbids rewording. */
export function mechanicsLintFeedback(findings: SceneMechanicsFinding[]): string {
  const lines = findings.slice(0, 12).map(
    (finding) => `- beat ${finding.beatId} (${finding.field}): ${CODE_INSTRUCTIONS[finding.code]}. Defect: «${finding.excerpt}»`,
  );
  return [
    'MECHANICS FEEDBACK: Your previous draft contains mechanical punctuation defects. Fix ONLY the defects listed below — do not reword, restructure, or re-plot anything else. Every other sentence must remain exactly as written.',
    ...lines,
  ].join('\n');
}
