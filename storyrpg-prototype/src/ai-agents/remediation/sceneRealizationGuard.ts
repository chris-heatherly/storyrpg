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

/** The contract surface both SceneBlueprint and (tagged) SceneContent carry. */
export interface SceneContractSource {
  requiredBeats?: Array<{ tier?: string; mustDepict?: string }>;
  signatureMoment?: string;
  choicePoint?: { setsTreatmentSeeds?: string[] };
  encounterSetupContext?: string[];
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
  const signature = source.signatureMoment?.trim();
  if (signature && !moments.some((m) => m.moment === signature)) {
    moments.push({ moment: signature, tier: 'signature', validator: 'SignatureDevicePresenceValidator' });
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
    .filter((m) => !momentDepicted(m.validator, m.moment, prose))
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
  'american-shoes',
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

function hasUnsafeDeterministicInsertionCue(moment: string): boolean {
  const timelineText = moment
    .replace(/\bDating After Dusk\b/g, '')
    .replace(/\bDusk Club\b/g, '')
    .replace(/\bafter (?:a |the )?public breakup\b/ig, '')
    .replace(/\bafter (?:a |the )?(?:humiliating|cancelled|canceled) (?:engagement|breakup)\b/ig, '');
  return /\b(?:night|morning|dawn|dusk|sunset|midnight|weekend|later|earlier|before|after|next|previous|second|third|fourth|return(?:s|ed)?|again|handoff|transition|[0-9]+\s*(?:am|pm|a\.m\.|p\.m\.))\b/i
    .test(timelineText);
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
    if (momentDepicted(m.validator, m.moment, currentProse)) {
      options.onSkip?.(m, 'moment is already depicted in current prose');
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
    inserted.push({
      id,
      text,
      nextBeatId: beats[insertAt]?.id,
      visualMoment: text,
      primaryAction: text,
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
    (m) => momentDepicted(m.validator, m.moment, before) && !momentDepicted(m.validator, m.moment, after),
  );
}
