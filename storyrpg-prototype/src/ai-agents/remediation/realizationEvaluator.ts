import { concreteSeedDepicted, concreteSeedRuleFor, normalizeSeedText } from '../utils/concreteSeedRealization';
import { toStageableTreatmentMoment } from '../utils/stageableTreatmentMoment';

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

/**
 * Protagonist POV context (2026-07-04, bite-me "Kylie Marinescu arrives in
 * Bucharest." leak). Second-person prose NEVER contains the protagonist's
 * name, so any authored moment phrased "ProtagonistName does X" was
 * systematically under-scored (name tokens counted as missing), which made
 * the scene-time realization guard fire on faithfully-dramatized scenes and
 * ultimately paste the planning text verbatim into player prose.
 *
 * Armed once per run at pipeline start (mirrors setStoryLexicon). When the
 * scanned prose addresses the player in second person, protagonist-name
 * tokens are excluded from the needed-token set — the protagonist is
 * axiomatically on-page as "you". Third-person-named stories are unaffected
 * (the exclusion is conditioned on second-person address in the prose).
 */
export interface RealizationPovContext {
  protagonistAliases: string[];
}

let activePovContext: RealizationPovContext | null = null;

/** Arm/disarm the protagonist POV context for the current run (pipeline start / tests). */
export function setRealizationPovContext(context: RealizationPovContext | null): void {
  activePovContext = context;
}

export function getRealizationPovContext(): RealizationPovContext | null {
  return activePovContext;
}

export function hasSecondPersonAddress(prose: string): boolean {
  return /\b(?:you|your|yours|yourself)\b/i.test(prose);
}

/** Normalized protagonist-name tokens (≥4 chars, matching content-token shape). */
export function protagonistAliasTokens(): Set<string> {
  const tokens = new Set<string>();
  for (const alias of activePovContext?.protagonistAliases ?? []) {
    for (const token of normalizeRealizationText(alias).split(' ')) {
      if (token.length >= 4) tokens.add(token);
    }
  }
  return tokens;
}

/**
 * Drop protagonist-name tokens from a needed-token list when the prose is
 * second-person (the name is unknowable there, not "missing").
 */
function withoutProtagonistTokens(needed: string[], prose: string): string[] {
  const aliasTokens = protagonistAliasTokens();
  if (aliasTokens.size === 0 || !hasSecondPersonAddress(prose)) return needed;
  return needed.filter((token) => !aliasTokens.has(token));
}

export type RealizationMode =
  | 'empty'
  | 'action-requirements'
  | 'character-introduction'
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
  const needed = withoutProtagonistTokens([...new Set(contentTokensForRealization(moment, stopwords))], prose);
  if (needed.length === 0) return 1;
  const hayTokens = [...new Set(contentTokensForRealization(prose, stopwords))];
  const haySet = new Set(hayTokens);
  const hits = needed.filter((token) => tokenPresent(token, hayTokens, haySet)).length;
  return hits / needed.length;
}

function missingOverlapTokens(moment: string, prose: string, stopwords: Set<string>): string[] {
  const needed = withoutProtagonistTokens([...new Set(contentTokensForRealization(moment, stopwords))], prose);
  const hayTokens = [...new Set(contentTokensForRealization(prose, stopwords))];
  const haySet = new Set(hayTokens);
  return needed.filter((token) => !tokenPresent(token, hayTokens, haySet));
}

interface ActionRequirement {
  token: string;
  present: boolean;
}

function anyPatternPresent(prose: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(prose));
}

function actionRequirementsFor(moment: string, prose: string): ActionRequirement[] {
  const needle = normalizeRealizationText(moment);
  const hay = normalizeRealizationText(prose);
  const requirements: ActionRequirement[] = [];
  const add = (token: string, present: boolean) => requirements.push({ token, present });

  if (/\b(?:walk|walks|walked|walking)\s+(?:her|him|them|you)?\s*home\b/.test(needle)) {
    const rescuerWalkHome = /\b(?:second|figure|charcoal|suit)\b/.test(needle);
    add('walk-home', rescuerWalkHome
      ? anyPatternPresent(hay, [
        /\b(?:victor|he|man|figure|rescuer|charcoal|suit)\b[\s\S]{0,100}\bwalk(?:s|ed|ing)?\b[\s\S]{0,80}\bhome\b/,
        /\bwalk(?:s|ed|ing)?\s+(?:you|her|him|them)\s+home\b/,
      ])
      : /\bwalk(?:s|ed|ing)?\b[\s\S]{0,80}\bhome\b|\bhome\b[\s\S]{0,80}\bwalk(?:s|ed|ing)?\b/.test(hay));
  }
  if (/\b(?:swap|swaps|swapped|swapping|switch|switches|switched|replace|replaces|replaced|trade|trades|traded)\b[\s\S]{0,80}\b(?:shoe|shoes|heels|boots)\b|\b(?:shoe|shoes|heels|boots)\b[\s\S]{0,80}\b(?:swap|swaps|swapped|swapping|switch|switches|switched|replace|replaces|replaced|trade|trades|traded)\b/.test(needle)) {
    add('swap-shoes', anyPatternPresent(hay, [
      /\b(?:swap|swaps|swapped|swapping|switch|switches|switched|replace|replaces|replaced|trade|trades|traded)\b[\s\S]{0,100}\b(?:shoe|shoes|heels|boots)\b/,
      /\b(?:shoe|shoes|heels|boots)\b[\s\S]{0,100}\b(?:swap|swaps|swapped|swapping|switch|switches|switched|replace|replaces|replaced|trade|trades|traded)\b/,
      /\b(?:take|takes|took|pulls?|pulled|kick(?:s|ed)?|slip(?:s|ped)?|unlace(?:s|d)?|remove(?:s|d)?)\s+(?:off|out\s+of)?\b[\s\S]{0,100}\b(?:shoe|shoes|sneaker|sneakers|heels|boots)\b[\s\S]{0,140}\b(?:put|puts|slides?|slid|steps?)\b[\s\S]{0,60}\b(?:on|into)\b/,
    ]));
    if (/\bamerican\b/.test(needle)) {
      add('american-shoes', /\bamerican\b[\s\S]{0,140}\b(?:shoe|shoes|sneaker|sneakers|heels|boots)\b|\b(?:shoe|shoes|sneaker|sneakers|heels|boots)\b[\s\S]{0,140}\bamerican\b/.test(hay));
    }
  }
  if (/\bkiss(?:es|ed|ing)?\b[\s\S]{0,80}\bhand\b|\bhand\b[\s\S]{0,80}\bkiss(?:es|ed|ing)?\b/.test(needle)) {
    add('kiss-hand', /\bkiss(?:es|ed|ing)?\b[\s\S]{0,80}\b(?:hand|knuckles|fingers)\b|\b(?:hand|knuckles|fingers)\b[\s\S]{0,80}\bkiss(?:es|ed|ing)?\b/.test(hay));
    if (/\bthreshold\b/.test(needle)) {
      add('threshold', /\b(?:threshold|doorway|door|stoop|entrance)\b/.test(hay));
    }
  }
  if (/\bdeclin(?:e|es|ed|ing)\s+to\s+come\s+in\b|\brefus(?:e|es|ed|ing)\s+to\s+(?:come\s+in|enter)\b/.test(needle)) {
    add('decline-entry', anyPatternPresent(hay, [
      /\bdeclin(?:e|es|ed|ing)\b[\s\S]{0,80}\b(?:come\s+in|enter|inside)\b/,
      /\brefus(?:e|es|ed|ing)\b[\s\S]{0,80}\b(?:come\s+in|enter|inside|cross)\b/,
      /\b(?:will\s+not|won t|doesn t|does\s+not)\b[\s\S]{0,80}\b(?:come\s+in|enter|inside|cross)\b/,
    ]));
  }
  if (/\bvanish(?:es|ed|ing)?\b|\bdisappear(?:s|ed|ing)?\b/.test(needle)) {
    add('vanish', /\b(?:vanish(?:es|ed|ing)?|disappear(?:s|ed|ing)?|gone|melts?\s+into|dissolv(?:e|es|ed|ing)\s+into|reced(?:e|es|ed|ing)\s+into\s+(?:the\s+)?(?:shadow|shadows|dark|darkness|fog|mist|smoke)|lost\s+to)\b/.test(hay));
  }
  if (/\bquartz\b[\s\S]{0,120}\b(?:ward|warding|consent|protect|protection)\b|\b(?:ward|warding|consent|protect|protection)\b[\s\S]{0,120}\bquartz\b/.test(needle)) {
    add('quartz-transfer', anyPatternPresent(hay, [
      /\b(?:quartz|pink(?:ish)?\s+stone|stone)\b[\s\S]{0,120}\b(?:hand|palm|fingers)\b/,
      /\b(?:hand|palm|fingers)\b[\s\S]{0,120}\b(?:quartz|pink(?:ish)?\s+stone|stone)\b/,
    ]));
    add('warding-meaning', /\b(?:ward|warding|protect|protection|warning|apartment|threshold|drafts?)\b/.test(hay));
  }
  if (/\b(?:protective|protection|ward|warding)\b[\s\S]{0,120}\b(?:bag|herb|herbs)\b|\b(?:bag|herb|herbs)\b[\s\S]{0,120}\b(?:protective|protection|ward|warding)\b/.test(needle)) {
    add('protective-herb-bag', anyPatternPresent(hay, [
      /\b(?:bag|sachet|pouch|muslin)\b[\s\S]{0,140}\b(?:herb|herbs|lavender|pine|rosemary|sage)\b/,
      /\b(?:herb|herbs|lavender|pine|rosemary|sage)\b[\s\S]{0,140}\b(?:bag|sachet|pouch|muslin)\b/,
    ]));
    add('warding-meaning', /\b(?:protect|protection|ward|warding|apartment|drafts?)\b/.test(hay));
    add('brunch-context', /\b(?:brunch|breakfast|cafe|coffee|table|phone)\b/.test(hay));
  }
  if (/\bdrops?\s+(?:the\s+)?attacker\b|\bdispatch(?:es|ed)?\s+(?:the\s+)?attacker\b/.test(needle)) {
    add('drop-attacker', anyPatternPresent(hay, [
      /\b(?:drop|drops|dropped|dispatch(?:es|ed)?|knock(?:s|ed)?|throw(?:s|n)?|slam(?:s|med)?)\b[\s\S]{0,80}\b(?:attacker|shadow|figure)\b/,
      /\b(?:attacker|shadow|figure)\b[\s\S]{0,80}\b(?:drop|drops|dropped|dispatch(?:es|ed)?|knock(?:s|ed)?|throw(?:s|n)?|slam(?:s|med)?)\b/,
    ]));
  }
  if (/\bpinn(?:ed|s)?\b[\s\S]{0,80}\b(?:willow|tree|bark)\b|\b(?:willow|tree|bark)\b[\s\S]{0,80}\bpinn(?:ed|s)?\b/.test(needle)) {
    add('pinned-tree', anyPatternPresent(hay, [
      /\b(?:pin|pins|pinned|slam(?:s|med)?|press(?:es|ed)?)\b[\s\S]{0,100}\b(?:willow|tree|bark)\b/,
      /\b(?:willow|tree|bark)\b[\s\S]{0,100}\b(?:pin|pins|pinned|slam(?:s|med)?|press(?:es|ed)?)\b/,
    ]));
  }

  return requirements;
}

function shortQuotedRequirement(moment: string): string | undefined {
  const trimmed = moment.trim();
  if (!/^["'“”‘’]+[\s\S]+["'“”‘’]+$/.test(trimmed)) return undefined;
  const inner = trimmed
    .replace(/^["'“”‘’]+/, '')
    .replace(/["'“”‘’]+$/, '')
    .trim();
  if (!inner) return undefined;
  const words = contentTokensForRealization(inner, new Set()).length;
  if (words < 2 || words > 14) return undefined;
  if (/[;—]|\b(?:by\s+\d|at\s+\d|walks?|pins?|drops?|kisses?|declines?|vanishes?)\b/i.test(inner)) return undefined;
  return inner;
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
  const sanitizedMoment = moment
    .replace(/\([^)]*\b(?:INFO-[A-Z0-9_-]+|planted live|paid off|payoff|payoffs|validator|gate)\b[^)]*\)/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const colonList = /:\s*([\s\S]+)$/.exec(sanitizedMoment)?.[1];
  const commaCount = (sanitizedMoment.match(/,/g) || []).length;
  const semicolonCount = (sanitizedMoment.match(/;/g) || []).length;
  const listSource = colonList || (semicolonCount > 0 ? sanitizedMoment : (commaCount >= 2 && /\b(?:and|or)\b/i.test(sanitizedMoment) ? sanitizedMoment : ''));
  if (!listSource) return [];

  const splitPattern = semicolonCount > 0
    ? /\s*;\s*/i
    : /\s*(?:;|,|\band\b)\s*/i;

  const clauses = listSource
    .replace(/([.!?])\s+(?=(?:She|He|They|The|A|An|By|[A-Z][a-z]+)\b)/g, '$1|CLAUSE|')
    .replace(/,\s+and\s+(?=(?:the|a|an|[A-Z][a-z]+)\b)/gi, '|CLAUSE|')
    .split(splitPattern)
    .flatMap((clause) => clause.split('|CLAUSE|'))
    .map((clause) => clause
      .replace(/^\s*(?:and|or|including|include|includes|collects?|shows?|depicts?)\s+/i, '')
      .replace(/^\s*[^—:]{2,60}\s+—\s+(?=\b(?:the|a|an|[a-z][a-z]+)\b)/i, '')
      .replace(/^[\s:—-]+|[\s.]+$/g, '')
      .trim())
    .filter((clause) => contentTokensForRealization(clause, stopwords).length >= 2);

  return clauses.length >= (semicolonCount > 0 ? 2 : 3) ? clauses : [];
}

function simpleMomentDepicted(moment: string, prose: string, stopwords: Set<string>): boolean {
  if (normalizeRealizationText(prose).includes(normalizeRealizationText(moment))) return true;
  const spans = emphasizedSpans(moment);
  if (spans.length >= 2 && spans.every((span) => spanPresent(span, prose, stopwords))) return true;
  return overlapScore(moment, prose, stopwords) >= PRESENCE_MIN_SCORE;
}

/**
 * Character-introduction beats (StoryArchitect.ensureCharacterIntroductionBeats)
 * carry writer DIRECTIVES as their mustDepict ("You meet Stela Pavel for the
 * first time in this scene — show how they enter your attention, how they name
 * themselves…"). Token/clause scoring against that meta text is unrealizable
 * by construction: good prose never contains "identifying detail" or
 * "group-belonging language" (storyrpg-lite 2026-07-04T21-46-05 s1-2 abort).
 *
 * The stageable requirement of such a moment is: the scene's prose actually
 * NAMES the character. First-contact QUALITY (no off-page familiarity, real
 * staging) is owned by CharacterIntroductionValidator, which judges it
 * semantically at the final contract and routes an LLM prose repair.
 */
export function characterIntroductionMomentName(moment: string): string | undefined {
  const match = /^you meet\s+(.{2,60}?)\s+for the first time\b/i.exec(moment.trim());
  return match?.[1]?.trim() || undefined;
}

function characterNamePresent(name: string, prose: string): boolean {
  const hay = normalizeRealizationText(prose);
  const hayTokens = new Set(hay.split(' '));
  const normalized = normalizeRealizationText(name);
  if (!normalized) return false;
  if (hay.includes(normalized)) return true;
  // Prose may use just the given name ("Stela" for "Stela Pavel") — accept any
  // name token long enough to be distinctive.
  return normalized.split(' ').some((token) => token.length >= 4 && hayTokens.has(token));
}

export function evaluateMomentRealization(
  validator: string | undefined,
  moment: string,
  prose: string,
): RealizationAssessment {
  const validatorName = validator ?? 'RequiredBeatRealizationValidator';
  // Strip character-dossier register before depiction scoring so arrival /
  // Story Circle "you" moments gate on stageable event atoms (arrive, city,
  // suitcases, address), not logline adjectives fiction never copies.
  const stageableMoment = toStageableTreatmentMoment(moment);
  const normalizedMoment = normalizeRealizationText(stageableMoment);
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

  const stopwords = stopwordsForRealization(validatorName);

  if (validatorName === 'RequiredBeatRealizationValidator') {
    const introducedName = characterIntroductionMomentName(moment);
    if (introducedName) {
      const depicted = characterNamePresent(introducedName, prose);
      return {
        depicted,
        mode: 'character-introduction',
        score: depicted ? 1 : 0,
        missingTokens: depicted ? [] : contentTokensForRealization(introducedName, stopwords),
        missingClauses: depicted ? [] : [`${introducedName} must be named on-page in this scene`],
        matchedClauses: depicted ? [`${introducedName} named on-page`] : [],
      };
    }

    const concreteDepicted = concreteSeedDepicted(normalizedMoment, prose);
    if (typeof concreteDepicted === 'boolean') {
      const rule = concreteSeedRuleFor(normalizeSeedText(stageableMoment));
      return {
        depicted: concreteDepicted,
        mode: 'concrete-seed',
        score: concreteDepicted ? 1 : 0,
        missingTokens: concreteDepicted ? [] : rule?.missingTokens ?? missingOverlapTokens(stageableMoment, prose, stopwords),
        missingClauses: [],
        matchedClauses: [],
      };
    }

    const clauses = extractCompoundClauses(stageableMoment, stopwords);
    if (clauses.length > 0) {
      const matchedClauses = clauses.filter((clause) => simpleMomentDepicted(clause, prose, stopwords));
      const missingClauses = clauses.filter((clause) => !matchedClauses.includes(clause));
      return {
        depicted: missingClauses.length === 0,
        mode: 'compound-clauses',
        score: matchedClauses.length / clauses.length,
        missingTokens: missingTokensForCompoundClauses(stageableMoment, prose, missingClauses, stopwords),
        missingClauses,
        matchedClauses,
      };
    }

    const quoted = shortQuotedRequirement(stageableMoment);
    if (quoted) {
      const depicted = normalizeRealizationText(prose).includes(normalizeRealizationText(quoted))
        || overlapScore(quoted, prose, stopwords) >= 1;
      return {
        depicted,
        mode: 'normalized-substring',
        score: depicted ? 1 : 0,
        missingTokens: depicted ? [] : contentTokensForRealization(quoted, stopwords),
        missingClauses: depicted ? [] : [quoted],
        matchedClauses: depicted ? [quoted] : [],
      };
    }

    const actionRequirements = actionRequirementsFor(stageableMoment, prose);
    if (actionRequirements.length > 0) {
      const missing = actionRequirements.filter((requirement) => !requirement.present).map((requirement) => requirement.token);
      return {
        depicted: missing.length === 0,
        mode: 'action-requirements',
        score: (actionRequirements.length - missing.length) / actionRequirements.length,
        missingTokens: missing,
        missingClauses: [],
        matchedClauses: actionRequirements.filter((requirement) => requirement.present).map((requirement) => requirement.token),
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

  const spans = emphasizedSpans(stageableMoment);
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

  const score = overlapScore(stageableMoment, prose, stopwords);
  return {
    depicted: score >= PRESENCE_MIN_SCORE,
    mode: 'token-overlap',
    score,
    missingTokens: missingOverlapTokens(stageableMoment, prose, stopwords),
    missingClauses: [],
    matchedClauses: [],
  };
}

function missingTokensForCompoundClauses(
  moment: string,
  prose: string,
  missingClauses: string[],
  stopwords: Set<string>,
): string[] {
  const missing = missingClauses.flatMap((clause) => contentTokensForRealization(clause, stopwords));
  if (/\bmr\.?\s+midnight\b/i.test(moment) && !/\bmidnight\b/i.test(prose)) {
    missing.push('midnight');
  }
  return [...new Set(missing)];
}
