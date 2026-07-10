/**
 * Scene-time required-beat realization guard (2026-06-12, bite-me-g13 root
 * cause work). The authored treatment binds `requiredBeats` / `signatureMoment`
 * to planned scenes, SceneWriter receives them as a prompt checklist — and
 * then NOTHING verified realization until the season-final contract, ~90
 * minutes later. Worse, three generation-time rewrite passes (the SceneCritic
 * voice polish, the POV/voice regen swap, the continuity repair) rewrite beat
 * prose with no knowledge of the contract, so even a faithfully-realized
 * moment could be paraphrased away ("Cișmigiu" → "the park") before the
 * final gate ever saw it.
 *
 * This module gives every generation-time site a deterministic, LLM-free way
 * to (a) detect an under-realized scene the moment it's written — feeding the
 * existing regen-with-feedback loop at 'scene' placement, where a retry costs
 * one scene instead of one season — and (b) refuse a polish/regen rewrite
 * that LOSES an authored moment the previous text depicted.
 *
 * Scoring mirrors the season-final validators exactly (realizationScoring.ts),
 * so "missing here" predicts "blocking there".
 *
 * Gate: GATE_SCENE_REQUIRED_BEAT_CHECK (placement 'scene', remediation/regen,
 * default ON — it retries once and fails locally if authored/signature moments
 * remain missing, so final contract is confirmation rather than late surgery).
 */

import { missingMomentTokens, momentDepicted } from './realizationScoring';
import { characterIntroductionMomentName, getRealizationPovContext, hasSecondPersonAddress, normalizeRealizationText } from './realizationEvaluator';
import { isGenericScenePlannerText } from '../utils/sceneContractBuilders';
import { isUnsafeCoverageMetadataText } from '../utils/coverageMetadataHygiene';

/** The contract surface both SceneBlueprint and (tagged) SceneContent carry. */
export interface SceneContractSource {
  requiredBeats?: Array<{ tier?: string; mustDepict?: string }>;
  storyCircleBeatContracts?: Array<{
    beat?: string;
    sourceText?: string;
    requiredRealization?: string[];
    eventAtoms?: string[];
  }>;
  signatureMoment?: string;
  choicePoint?: { setsTreatmentSeeds?: string[] };
  encounterSetupContext?: string[];
  /** R4 shift-left: the SceneTurnRealizationValidator's central-turn contract. */
  turnContract?: {
    centralTurn?: string;
    turnEvent?: string;
    source?: string;
  };
  /** R4 shift-left: treatment-blocking arc pressure bound to THIS scene. */
  arcPressureContracts?: Array<{
    id?: string;
    fieldName?: string;
    sourceText?: string;
    eventAtoms?: string[];
    blockingLevel?: string;
  }>;
}

/** A prose-bearing beat as the realization validators scan it. */
export interface RealizableBeat {
  id?: string;
  text?: string;
  setupText?: string;
  escalationText?: string;
  nextBeatId?: string;
  isChoicePoint?: boolean;
  choices?: unknown[];
  visualMoment?: string;
  primaryAction?: string;
  textVariants?: Array<{ text?: string }>;
}

export interface RequiredMoment {
  moment: string;
  /** Which season-final validator will enforce this moment (drives stopwords). */
  validator: 'RequiredBeatRealizationValidator' | 'SignatureDevicePresenceValidator';
  tier: string;
  /**
   * Alternate phrasings that also satisfy the moment (e.g. a contract's
   * eventAtoms) — mirrors the season-final validators, which accept sourceText
   * OR any event atom as depicted.
   */
  alternates?: string[];
}

/** Depicted when the moment itself OR any registered alternate is on-page. */
function momentOrAlternateDepicted(m: RequiredMoment, prose: string): boolean {
  if (momentSatisfiedByProse(m.validator, m.moment, prose)) return true;
  return (m.alternates ?? []).some((alt) => alt && momentSatisfiedByProse(m.validator, alt, prose));
}

export interface MissingMoment extends RequiredMoment {
  missingTokens: string[];
}

export interface InsertMissingMomentOptions {
  /**
   * Default false. Time-coded/cross-scene authored moments must normally route
   * to cluster or blueprint repair instead of deterministic one-scene insertion.
   */
  allowTimelineCuedInsertion?: boolean;
  /** Default false. Cold-open moments should only be deterministically inserted into the opening scene. */
  allowColdOpenInsertion?: boolean;
  /** Default false. Overloaded scenes should escalate, not accept more prose. */
  sceneDensityOverloaded?: boolean;
  onSkip?: (missing: MissingMoment, reason: string) => void;
}

function normalizedWords(value: string): string[] {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9']+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

function isTitleLikeAbstractLabel(moment: string): boolean {
  const words = moment
    .replace(/[^\p{L}\p{N}'\s-]+/gu, ' ')
    .trim()
    .split(/\s+/)
    .filter((word) => word && !/^(a|an|the|of|and|or|in|on|at|to|for)$/i.test(word));
  if (words.length === 0 || words.length > 4) return false;
  return words.every((word) => /^[A-Z0-9]/.test(word));
}

function isChoiceContingentSeed(moment: string): boolean {
  return /\b(did or did(?:n['’]t| not)|accept(?:ed|s)? or refus(?:ed|es)?|refus(?:ed|es)? or accept(?:ed|s)?|whether|depending on|chosen path|choice path|route)\b/i
    .test(moment);
}

function isSocialUmbrellaAuthoredMoment(moment: string): boolean {
  if (!/\badopts?\b/i.test(moment)) return false;
  return !/\b(swaps?|hands?|gives?|presses?|kisses?|walks?|rescues?|drops?|pins?|opens?|takes?|declines?|refuses?)\b/i
    .test(moment.replace(/\badopts?\b/ig, ''));
}

function isConcreteSceneSeed(moment: string): boolean {
  if (isChoiceContingentSeed(moment)) return false;
  if (isTitleLikeAbstractLabel(moment)) return false;
  const words = normalizedWords(moment);
  if (words.length < 5) return false;
  const hasSpatialAnchor = words.some((word) => [
    'in', 'inside', 'outside', 'on', 'under', 'behind', 'beside', 'near', 'across', 'through', 'into', 'from', 'at',
  ].includes(word));
  const hasPhysicalSignal = words.some((word) => [
    'body', 'blood', 'car', 'chair', 'courtyard', 'door', 'eyes', 'face', 'floor', 'glass', 'hand', 'key', 'letter',
    'light', 'mirror', 'phone', 'pocket', 'room', 'shadow', 'stone', 'table', 'voice', 'wall', 'window',
  ].includes(word));
  return hasSpatialAnchor && hasPhysicalSignal;
}

/** Every authored moment the scene's prose must depict. */
export function requiredMomentsFor(source: SceneContractSource | undefined): RequiredMoment[] {
  if (!source) return [];
  const moments: RequiredMoment[] = [];
  for (const beat of source.requiredBeats ?? []) {
    const moment = beat?.mustDepict?.trim();
    if (!moment) continue;
    const tier = beat.tier ?? 'authored';
    // Connective beats are free tissue the writer may author around — the
    // validators don't enforce them and neither do we. Seed beats are enforced
    // only when they are already a concrete on-page image/action. Setting a
    // treatment_seed_* flag is not enough: those flags often carry agent-facing
    // secret/backstory labels that must never be inserted as player prose.
    if (tier === 'connective') continue;
    if (tier === 'authored' && isSocialUmbrellaAuthoredMoment(moment)) continue;
    if (tier === 'seed' && !isConcreteSceneSeed(moment)) continue;
    moments.push({
      moment,
      tier,
      validator: tier === 'signature' ? 'SignatureDevicePresenceValidator' : 'RequiredBeatRealizationValidator',
    });
  }
  for (const contract of source.storyCircleBeatContracts ?? []) {
    const moment = contract.sourceText?.trim();
    if (!moment) continue;
    const required = contract.requiredRealization ?? [];
    if (!required.includes('final_prose') || !required.includes('scene_turn')) continue;
    if (moments.some((m) => m.moment === moment)) continue;
    moments.push({
      moment,
      tier: `storyCircle:${contract.beat ?? 'beat'}`,
      validator: 'RequiredBeatRealizationValidator',
      alternates: (contract.eventAtoms ?? []).map((atom) => atom.trim()).filter(Boolean),
    });
  }
  const signature = source.signatureMoment?.trim();
  if (signature && !moments.some((m) => m.moment === signature)) {
    moments.push({ moment: signature, tier: 'signature', validator: 'SignatureDevicePresenceValidator' });
  }
  // R4 shift-left: the SceneTurnRealizationValidator's central turn, checked
  // at scene time with the SAME evaluator it uses at season-final
  // (momentDepicted via evaluateMomentRealization). Blocking sources only
  // (treatment/encounter/planner) — and a GENERIC planner turn is an
  // architecture defect ("replace the turn"), not a prose-realization retry,
  // so it is left to the plan-time turn-contract gates.
  const centralTurn = (source.turnContract?.centralTurn ?? source.turnContract?.turnEvent)?.trim();
  const turnSource = source.turnContract?.source;
  if (
    centralTurn
    && (turnSource === 'treatment' || turnSource === 'encounter'
      || (turnSource === 'planner' && !isGenericScenePlannerText(centralTurn)))
    && !moments.some((m) => m.moment === centralTurn)
  ) {
    moments.push({ moment: centralTurn, tier: 'sceneTurn', validator: 'RequiredBeatRealizationValidator' });
  }
  // R4 shift-left: treatment-blocking arc pressure bound to this scene — the
  // SceneTurnRealizationValidator blocks at season-final when neither the
  // sourceText nor any event atom is dramatized (same OR semantics here).
  for (const contract of source.arcPressureContracts ?? []) {
    if (contract.blockingLevel !== 'treatment') continue;
    const moment = contract.sourceText?.trim();
    if (!moment || moments.some((m) => m.moment === moment)) continue;
    moments.push({
      moment,
      tier: `arcPressure:${contract.fieldName ?? contract.id ?? 'contract'}`,
      validator: 'RequiredBeatRealizationValidator',
      alternates: (contract.eventAtoms ?? []).map((atom) => atom.trim()).filter(Boolean),
    });
  }
  return moments;
}

/** The beats' prose exactly as the validators will scan it. */
export function proseOfBeats(beats: RealizableBeat[] | undefined): string {
  const parts: string[] = [];
  for (const b of beats ?? []) {
    parts.push(b.text ?? '', b.setupText ?? '', b.escalationText ?? '');
    for (const variant of b.textVariants ?? []) parts.push(variant?.text ?? '');
  }
  return parts.filter(Boolean).join(' ');
}

/** Authored moments the beats do NOT yet depict (with the absent content words). */
export function missingRequiredMoments(
  source: SceneContractSource | undefined,
  beats: RealizableBeat[] | undefined,
): MissingMoment[] {
  const moments = requiredMomentsFor(source);
  if (moments.length === 0) return [];
  const prose = proseOfBeats(beats);
  return moments
    .filter((m) => !momentOrAlternateDepicted(m, prose))
    .map((m) => ({ ...m, missingTokens: missingMomentTokens(m.validator, m.moment, prose) }));
}

export function missingRealizationScore(missing: MissingMoment[]): number {
  return missing.reduce((sum, m) => sum + 1 + m.missingTokens.length, 0);
}

export function improvesMissingRealization(before: MissingMoment[], after: MissingMoment[]): boolean {
  if (after.length < before.length) return true;
  if (after.length > before.length) return false;
  return missingRealizationScore(after) < missingRealizationScore(before);
}

function safeIdPart(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'authored-moment';
}

function authoredMomentText(moment: string): string {
  const trimmed = moment.trim();
  if (!trimmed) return '';
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

function isTerseActionSummary(moment: string): boolean {
  const words = normalizedWords(moment);
  if (words.length === 0 || words.length > 7) return false;
  return /\b(?:adopts?|walks?|kisses?|declines?|vanishes?|drops?|rescues?|presses?|hands?|gives?|swaps?|takes?)\b/i.test(moment)
    && !/[,"“”‘’]|\b(?:because|while|when|as|until|before|after|through|under|against)\b/i.test(moment);
}

const CONCRETE_ACTION_REQUIREMENT_TOKENS = new Set([
  'walk-home',
  'swap-shoes',
  'kiss-hand',
  'threshold',
  'decline-entry',
  'vanish',
  'drop-attacker',
  'pinned-tree',
]);

function hasConcreteActionRequirement(missing: MissingMoment): boolean {
  return missing.missingTokens.some((token) => CONCRETE_ACTION_REQUIREMENT_TOKENS.has(token));
}

function stripTitleCaseTimelineProperNouns(value: string): string {
  return value.replace(/\b(?:[A-Z][a-z0-9'’]+(?:\s+|$)){2,6}/g, (phrase) => {
    const words = phrase.trim().split(/\s+/);
    const hasTimelineWord = words.some((word) =>
      /^(?:Night|Morning|Dawn|Dusk|Sunset|Midnight|Weekend|Later|Earlier|Before|After|Next|Previous|Second|Third|Fourth)$/u.test(word),
    );
    return hasTimelineWord ? ' ' : phrase;
  });
}

function hasUnsafeDeterministicInsertionCue(moment: string): boolean {
  const timelineText = stripTitleCaseTimelineProperNouns(moment);
  return /\b(?:night|morning|dawn|dusk|sunset|midnight|weekend|later|earlier|before|after|next|previous|second|third|fourth|return(?:s|ed)?|again|handoff|transition|[0-9]+\s*(?:am|pm|a\.m\.|p\.m\.))\b/i
    .test(timelineText);
}

/** Story-circle contract text is an episode-level summary by construction —
 * it narrates arcs ("arrives as a charming, wounded observer… intent to
 * rebuild"), never a stageable on-page moment. It must be realized by
 * SceneWriter (or fail the realization gate), never pasted as beat prose.
 * bite-me 2026-07-03 shipped "Kylie arrives in Bucharest." this way. */
function isStoryCircleSummaryTier(tier: string): boolean {
  return tier.toLowerCase().startsWith('storycircle');
}

/** Treatment/design-summary red flags that must never ship as player prose:
 * meta role labels, character-design appositives ("as a charming, wounded
 * observer"), goal-statement language ("the intent to rebuild"), and the same
 * third-person synopsis / planning leaks the final RouteContinuity gate uses. */
function isTreatmentSummaryProse(moment: string): boolean {
  if (/\bthe (?:narrator|protagonist)\b/i.test(moment)) return true;
  if (/\bas an? [a-z'’-]+, [a-z'’-]+ [a-z'’-]+\b/i.test(moment)) return true;
  if (/\b(?:with )?the intent to [a-z]/i.test(moment)) return true;
  // Shared with RouteContinuity / coverage hygiene — e.g. "She wanders into a
  // bookshop owned by Stela…" must never be pasted as recovery prose/metadata.
  if (isUnsafeCoverageMetadataText(moment)) return true;
  return false;
}

/**
 * Verbatim paste of an unsafe treatment synopsis into beat.text must not count
 * as dramatization — otherwise insertMissingMomentBeats can "satisfy" the gate
 * that justified the paste.
 */
export function momentSatisfiedByProse(
  validator: string | undefined,
  moment: string,
  prose: string,
): boolean {
  if (!momentDepicted(validator, moment, prose)) return false;
  if (!isUnsafeCoverageMetadataText(moment)) return true;
  const needle = normalizeRealizationText(moment);
  const hay = normalizeRealizationText(prose);
  if (!needle || !hay) return false;
  // Exact (or near-exact) synopsis paste is summary-only, not scene drama.
  if (hay === needle) return false;
  // Prose that is mostly the synopsis plus a short wrapper still fails.
  if (hay.includes(needle) && hay.length <= needle.length + 40) return false;
  return true;
}

/** In a second-person story, a moment that NAMES the protagonist is planning
 * register by construction ("Kylie Marinescu arrives in Bucharest") — pasting
 * it as a beat ships a third-person POV break AND a synopsis card as player
 * prose (bite-me / storyrpg-lite 2026-07-04 s1-1 leak). Such moments must be
 * realized by SceneWriter or judged semantically at season-final, never
 * inserted verbatim. */
function momentNamesProtagonistInSecondPersonStory(moment: string, currentProse: string): boolean {
  const aliases = getRealizationPovContext()?.protagonistAliases ?? [];
  if (aliases.length === 0 || !hasSecondPersonAddress(currentProse)) return false;
  return aliases.some((alias) => {
    const trimmed = alias.trim();
    if (!trimmed) return false;
    const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
    return new RegExp(`\\b${escaped}\\b`, 'i').test(moment);
  });
}

function isSameSceneViralAftermathMoment(moment: string): boolean {
  const normalized = normalizedWords(moment).join(' ');
  return /\bviral\b/.test(normalized)
    && /\bmr midnight\b/.test(normalized)
    && /\bpost\b/.test(normalized)
    && /\b(?:makes?|making) (?:her|you) a name\b/.test(normalized);
}

const TEMPORAL_NUMBER_WORDS: Record<string, number> = {
  one: 1,
  first: 1,
  two: 2,
  second: 2,
  three: 3,
  third: 3,
  four: 4,
  fourth: 4,
  five: 5,
  fifth: 5,
  six: 6,
  sixth: 6,
  seven: 7,
  seventh: 7,
};

function parseTemporalNumber(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const normalized = value.toLowerCase().replace(/[^a-z0-9\s-]+/g, ' ');
  const numericNight = /\bnight\s+([0-9]+)\b/.exec(normalized);
  if (numericNight) return Number(numericNight[1]);
  const wordNight = /\bnight\s+(one|first|two|second|three|third|four|fourth|five|fifth|six|sixth|seven|seventh)\b/.exec(normalized);
  if (wordNight) return TEMPORAL_NUMBER_WORDS[wordNight[1]];
  const later = /\b(one|first|two|second|three|third|four|fourth|five|fifth|six|sixth|seven|seventh|[0-9]+)\s+nights?\s+later\b/.exec(normalized);
  if (later) return /^\d+$/.test(later[1]) ? Number(later[1]) : TEMPORAL_NUMBER_WORDS[later[1]];
  return undefined;
}

function insertionIndexForMissingMoment<T extends RealizableBeat>(
  beats: T[],
  fallbackIndex: number,
  moment: string,
): number {
  const momentNight = parseTemporalNumber(moment);
  if (momentNight === undefined) return fallbackIndex;

  const boundedFallback = Math.max(0, Math.min(fallbackIndex, beats.length));
  for (let i = 0; i < boundedFallback; i += 1) {
    const beatNight = parseTemporalNumber(beats[i].text || beats[i].setupText || beats[i].visualMoment || beats[i].primaryAction);
    if (beatNight !== undefined && beatNight > momentNight) return i;
  }
  return boundedFallback;
}

/**
 * Last-resort scene-time recovery for concrete authored moments. The LLM gets
 * two chances first; if it still omits a treatment-bound image/action, insert
 * the authored source text as a real beat before the scene choice point.
 *
 * This is deterministic and source-bound: it never invents new story material,
 * and it runs during episode generation so the episode seal sees the recovery.
 */
export function insertMissingMomentBeats<T extends RealizableBeat>(
  sceneId: string,
  beats: T[],
  missing: MissingMoment[],
  options: InsertMissingMomentOptions = {},
): T[] {
  if (missing.length === 0) return beats;
  if (options.sceneDensityOverloaded) {
    for (const m of missing) options.onSkip?.(m, 'scene density is overloaded');
    return beats;
  }
  const currentProse = proseOfBeats(beats);
  const safeMissing = missing.filter((m) => {
    if (momentSatisfiedByProse(m.validator, m.moment, currentProse)) {
      options.onSkip?.(m, 'moment is already depicted in current prose');
      return false;
    }
    if (/^coldopen\b/i.test(m.tier) && !options.allowColdOpenInsertion) {
      options.onSkip?.(m, 'cold-open moment belongs in the opening scene');
      return false;
    }
    if (isStoryCircleSummaryTier(m.tier)) {
      options.onSkip?.(m, 'story-circle source text is an episode summary, not stageable prose — needs SceneWriter realization');
      return false;
    }
    // R4: turn-contract and arc-pressure text is planning register by
    // construction — it must be DRAMATIZED by the writer (retry feedback) or
    // judged at season-final, never pasted verbatim as reader prose.
    if (m.tier === 'sceneTurn' || m.tier.startsWith('arcPressure')) {
      options.onSkip?.(m, `${m.tier} contract text is a planning artifact, not stageable prose — needs SceneWriter realization`);
      return false;
    }
    if (characterIntroductionMomentName(m.moment)) {
      options.onSkip?.(m, 'character-introduction directive is writer guidance, not stageable prose — needs SceneWriter realization');
      return false;
    }
    if (isTreatmentSummaryProse(m.moment)) {
      options.onSkip?.(m, 'moment reads as treatment/design summary, not stageable prose — needs SceneWriter realization');
      return false;
    }
    if (momentNamesProtagonistInSecondPersonStory(m.moment, currentProse)) {
      options.onSkip?.(m, 'moment names the protagonist in third person in a second-person story — needs SceneWriter realization, never verbatim insertion');
      return false;
    }
    if (isTerseActionSummary(m.moment) && !hasConcreteActionRequirement(m)) {
      options.onSkip?.(m, 'terse action summary needs prose rewrite, not deterministic label insertion');
      return false;
    }
    if (isSameSceneViralAftermathMoment(m.moment)) return true;
    if (options.allowTimelineCuedInsertion) return true;
    if (!hasUnsafeDeterministicInsertionCue(m.moment)) return true;
    options.onSkip?.(m, 'moment has timeline or cross-scene cues');
    return false;
  });
  if (safeMissing.length === 0) return beats;
  const choiceIndex = beats.findIndex((beat) => beat.isChoicePoint || (beat.choices?.length ?? 0) > 0);
  let insertAt = choiceIndex >= 0 ? choiceIndex : beats.length;
  const inserted: T[] = [];

  safeMissing.forEach((m, index) => {
    const text = authoredMomentText(m.moment);
    if (!text) return;
    const id = `${sceneId}-authored-${safeIdPart(m.tier)}-${safeIdPart(m.moment)}-${index + 1}`;
    // Never clone authored obligation text into image/visual metadata — those
    // fields are RouteContinuity-scanned and must be derived from dramatized
    // beat.text (sanitizeSceneContentForReader / SceneWriter visual contract).
    inserted.push({
      id,
      text,
      nextBeatId: beats[insertAt]?.id,
    } as T);
  });

  if (inserted.length === 0) return beats;
  insertAt = Math.min(...safeMissing.map((m) => insertionIndexForMissingMoment(beats, insertAt, m.moment)));
  for (let i = 0; i < inserted.length - 1; i += 1) {
    inserted[i].nextBeatId = inserted[i + 1].id;
  }
  inserted[inserted.length - 1].nextBeatId = beats[insertAt]?.id;
  const previous = beats[insertAt - 1];
  if (previous) previous.nextBeatId = inserted[0].id;
  beats.splice(insertAt, 0, ...inserted);
  return beats;
}

/**
 * SceneWriter feedback for a realization retry — names each under-realized
 * authored moment and the exact content words the prose must carry (the
 * season-final check is a keyword heuristic; paraphrasing proper nouns away
 * fails it even when the prose reads well).
 */
export function realizationRetryFeedback(missing: MissingMoment[]): string {
  const humanizeMissingToken = (token: string): string => {
    switch (token) {
      case 'walk-home':
        return 'show the named character walking or escorting the protagonist home';
      case 'swap-shoes':
        return 'show the named character actually swapping, replacing, trading, or changing the protagonist\'s shoes on-page';
      case 'american-shoes':
        return 'keep the authored American-shoes detail explicit while staging the shoe exchange';
      case 'kiss-hand':
        return 'show the named character kissing the protagonist\'s hand, knuckles, or fingers';
      case 'threshold':
        return 'show the doorway, threshold, entrance, or other boundary where the action happens';
      case 'decline-entry':
        return 'show the named character explicitly refusing to enter, come inside, or cross the threshold';
      case 'vanish':
        return 'show the named character vanishing, disappearing, or being suddenly gone';
      case 'drop-attacker':
        return 'show the attacker/shadow being dropped, dispatched, knocked down, or thrown aside';
      case 'pinned-tree':
        return 'show the protagonist pinned, slammed, or pressed against the willow/tree/bark';
      default:
        return token;
    }
  };

  const lines = [
    'IMPORTANT - The previous draft did not dramatize these AUTHORED moments on-page. Each one below MUST be depicted concretely in this scene (action, dialogue, sensory detail) — not summarized, alluded to, or moved off-page:',
  ];
  missing.forEach((m, i) => {
    lines.push(`${i + 1}. [${m.tier}] ${m.moment}`);
    if (m.missingTokens.length > 0) {
      const readableTokens = m.missingTokens.map(humanizeMissingToken);
      lines.push(
        `   These requirements from the authored moment must appear in the prose (verbatim or clearly dramatized; keep proper nouns exactly): ${readableTokens.join(', ')}`,
      );
    }
  });
  return lines.join('\n');
}

/**
 * Does a rewrite LOSE an authored moment the previous beats depicted?
 * Returns the first lost moment, or undefined when the rewrite is safe.
 * Deterministic and free — every polish/regen pass should ask this before
 * replacing prose.
 */
export function rewriteLosesRequiredMoment(
  source: SceneContractSource | undefined,
  beforeBeats: RealizableBeat[] | undefined,
  afterBeats: RealizableBeat[] | undefined,
): RequiredMoment | undefined {
  const moments = requiredMomentsFor(source);
  if (moments.length === 0) return undefined;
  const before = proseOfBeats(beforeBeats);
  const after = proseOfBeats(afterBeats);
  return moments.find(
    (m) => momentOrAlternateDepicted(m, before) && !momentOrAlternateDepicted(m, after),
  );
}
