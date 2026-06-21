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

function declaresTreatmentSeed(source: SceneContractSource): boolean {
  if ((source.choicePoint?.setsTreatmentSeeds ?? []).some((flag) => typeof flag === 'string' && flag.startsWith('treatment_seed_'))) {
    return true;
  }
  return (source.encounterSetupContext ?? []).some((entry) => /^flag:treatment_seed_/i.test(String(entry).trim()));
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
  const hasConcreteAction = words.some((word) => /(?:ing|ed|es|s)$/.test(word) && word.length >= 5);
  return hasSpatialAnchor && (hasPhysicalSignal || hasConcreteAction);
}

/** Every authored moment the scene's prose must depict. */
export function requiredMomentsFor(source: SceneContractSource | undefined): RequiredMoment[] {
  if (!source) return [];
  const moments: RequiredMoment[] = [];
  const enforceSeeds = declaresTreatmentSeed(source);
  for (const beat of source.requiredBeats ?? []) {
    const moment = beat?.mustDepict?.trim();
    if (!moment) continue;
    const tier = beat.tier ?? 'authored';
    // Connective beats are free tissue the writer may author around — the
    // validators don't enforce them and neither do we. Seed beats are enforced
    // when this exact scene declares it will SET a treatment_seed_* flag, or
    // when the seed is already a concrete on-page image/action. Short abstract
    // labels and choice-contingent future residue stay advisory until scoped.
    if (tier === 'connective') continue;
    if (tier === 'seed' && !enforceSeeds && !isConcreteSceneSeed(moment)) continue;
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
): T[] {
  if (missing.length === 0) return beats;
  const choiceIndex = beats.findIndex((beat) => beat.isChoicePoint || (beat.choices?.length ?? 0) > 0);
  let insertAt = choiceIndex >= 0 ? choiceIndex : beats.length;
  const inserted: T[] = [];

  missing.forEach((m, index) => {
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
  for (let i = 0; i < inserted.length - 1; i += 1) {
    inserted[i].nextBeatId = inserted[i + 1].id;
  }
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
  const lines = [
    'IMPORTANT - The previous draft did not dramatize these AUTHORED moments on-page. Each one below MUST be depicted concretely in this scene (action, dialogue, sensory detail) — not summarized, alluded to, or moved off-page:',
  ];
  missing.forEach((m, i) => {
    lines.push(`${i + 1}. [${m.tier}] ${m.moment}`);
    if (m.missingTokens.length > 0) {
      lines.push(
        `   These words from the authored moment must appear in the prose (verbatim or inflected; keep proper nouns exactly): ${m.missingTokens.join(', ')}`,
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
