import { concreteSeedDepicted, concreteSeedRuleFor, normalizeSeedText } from '../utils/concreteSeedRealization';

/** Shared base both validators use, before their per-validator extras. */
const BASE_STOPWORDS = [
  'about', 'after', 'again', 'against', 'also', 'and', 'because', 'become', 'before', 'being', 'between',
  'choice', 'chooses', 'could', 'during', 'episode', 'every', 'from', 'have', 'into', 'keeps', 'later',
  'leave', 'leaves', 'major', 'make', 'makes', 'must', 'opens', 'paths', 'player', 'pressure', 'scene',
  'should', 'that', 'their', 'them', 'then', 'there', 'this', 'through', 'when', 'where', 'with', 'without',
];

const STOPWORDS_BY_VALIDATOR: Record<string, Set<string>> = {
  RequiredBeatRealizationValidator: new Set([
    ...BASE_STOPWORDS,
    'staged', 'moment', 'beat', 'depict', 'depicts', 'show', 'shows',
  ]),
  SignatureDevicePresenceValidator: new Set([
    ...BASE_STOPWORDS,
    'staged', 'moment', 'signature', 'device', 'image', 'show', 'shows', 'depict', 'depicts',
  ]),
};

export const PRESENCE_MIN_SCORE = 0.5;

export type RealizationMode =
  | 'empty'
  | 'concrete-seed'
  | 'normalized-substring'
  | 'compound-clauses'
  | 'emphasized-spans'
  | 'token-overlap';

export interface RealizationAssessment {
  depicted: boolean;
  mode: RealizationMode;
  score: number;
  missingTokens: string[];
  missingClauses: string[];
  matchedClauses: string[];
}

export function normalizeRealizationText(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function stopwordsForRealization(validator: string | undefined): Set<string> {
  return STOPWORDS_BY_VALIDATOR[validator ?? ''] ?? STOPWORDS_BY_VALIDATOR.RequiredBeatRealizationValidator;
}

export function contentTokensForRealization(value: string | undefined, stopwords: Set<string>): string[] {
  if (!value) return [];
  return normalizeRealizationText(value)
    .split(' ')
    .filter((token) => token.length >= 4 && !stopwords.has(token));
}

function tokenPresent(token: string, hayTokens: string[], haySet: Set<string>): boolean {
  if (haySet.has(token)) return true;
  for (const h of hayTokens) {
    if (h.startsWith(token) || token.startsWith(h)) return true;
  }
  return false;
}

function overlapScore(moment: string, prose: string, stopwords: Set<string>): number {
  const needed = [...new Set(contentTokensForRealization(moment, stopwords))];
  if (needed.length === 0) return 1;
  const hayTokens = [...new Set(contentTokensForRealization(prose, stopwords))];
  const haySet = new Set(hayTokens);
  const hits = needed.filter((token) => tokenPresent(token, hayTokens, haySet)).length;
  return hits / needed.length;
}

function missingOverlapTokens(moment: string, prose: string, stopwords: Set<string>): string[] {
  const needed = [...new Set(contentTokensForRealization(moment, stopwords))];
  const hayTokens = [...new Set(contentTokensForRealization(prose, stopwords))];
  const haySet = new Set(hayTokens);
  return needed.filter((token) => !tokenPresent(token, hayTokens, haySet));
}

function emphasizedSpans(moment: string): string[] {
  const spans = [...moment.matchAll(/\*+([^*]+?)\*+/g)]
    .map((m) => m[1].trim())
    .filter((span) => span.length > 0);
  return spans.length >= 2 ? spans : [];
}

function spanPresent(span: string, prose: string, stopwords: Set<string>): boolean {
  if (normalizeRealizationText(prose).includes(normalizeRealizationText(span))) return true;
  return overlapScore(span, prose, stopwords) >= 1;
}

export function extractCompoundClauses(moment: string, stopwords: Set<string>): string[] {
  const colonList = /:\s*([\s\S]+)$/.exec(moment)?.[1];
  const commaCount = (moment.match(/,/g) || []).length;
  const listSource = colonList || (commaCount >= 2 && /\b(?:and|or)\b/i.test(moment) ? moment : '');
  if (!listSource) return [];

  const clauses = listSource
    .split(/\s*(?:;|,|\band\b)\s*/i)
    .map((clause) => clause
      .replace(/^\s*(?:and|or|including|include|includes|collects?|shows?|depicts?)\s+/i, '')
      .replace(/^[\s:—-]+|[\s.]+$/g, '')
      .trim())
    .filter((clause) => contentTokensForRealization(clause, stopwords).length >= 2);

  return clauses.length >= 3 ? clauses : [];
}

function simpleMomentDepicted(moment: string, prose: string, stopwords: Set<string>): boolean {
  if (normalizeRealizationText(prose).includes(normalizeRealizationText(moment))) return true;
  const spans = emphasizedSpans(moment);
  if (spans.length >= 2 && spans.every((span) => spanPresent(span, prose, stopwords))) return true;
  return overlapScore(moment, prose, stopwords) >= PRESENCE_MIN_SCORE;
}

export function evaluateMomentRealization(
  validator: string | undefined,
  moment: string,
  prose: string,
): RealizationAssessment {
  const normalizedMoment = normalizeRealizationText(moment);
  if (normalizedMoment.length === 0) {
    return {
      depicted: true,
      mode: 'empty',
      score: 1,
      missingTokens: [],
      missingClauses: [],
      matchedClauses: [],
    };
  }

  const validatorName = validator ?? 'RequiredBeatRealizationValidator';
  const stopwords = stopwordsForRealization(validatorName);

  if (validatorName === 'RequiredBeatRealizationValidator') {
    const concreteDepicted = concreteSeedDepicted(normalizedMoment, prose);
    if (typeof concreteDepicted === 'boolean') {
      const rule = concreteSeedRuleFor(normalizeSeedText(moment));
      return {
        depicted: concreteDepicted,
        mode: 'concrete-seed',
        score: concreteDepicted ? 1 : 0,
        missingTokens: concreteDepicted ? [] : rule?.missingTokens ?? missingOverlapTokens(moment, prose, stopwords),
        missingClauses: [],
        matchedClauses: [],
      };
    }

    const clauses = extractCompoundClauses(moment, stopwords);
    if (clauses.length > 0) {
      const matchedClauses = clauses.filter((clause) => simpleMomentDepicted(clause, prose, stopwords));
      const missingClauses = clauses.filter((clause) => !matchedClauses.includes(clause));
      return {
        depicted: missingClauses.length === 0,
        mode: 'compound-clauses',
        score: matchedClauses.length / clauses.length,
        missingTokens: [...new Set(missingClauses.flatMap((clause) => contentTokensForRealization(clause, stopwords)))],
        missingClauses,
        matchedClauses,
      };
    }
  }

  if (normalizeRealizationText(prose).includes(normalizedMoment)) {
    return {
      depicted: true,
      mode: 'normalized-substring',
      score: 1,
      missingTokens: [],
      missingClauses: [],
      matchedClauses: [],
    };
  }

  const spans = emphasizedSpans(moment);
  if (spans.length >= 2 && spans.every((span) => spanPresent(span, prose, stopwords))) {
    return {
      depicted: true,
      mode: 'emphasized-spans',
      score: 1,
      missingTokens: [],
      missingClauses: [],
      matchedClauses: spans,
    };
  }

  const score = overlapScore(moment, prose, stopwords);
  return {
    depicted: score >= PRESENCE_MIN_SCORE,
    mode: 'token-overlap',
    score,
    missingTokens: missingOverlapTokens(moment, prose, stopwords),
    missingClauses: [],
    matchedClauses: [],
  };
}
