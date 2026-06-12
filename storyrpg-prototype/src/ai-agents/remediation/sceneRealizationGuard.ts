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
 * default ON — it can only retry or preserve, never abort).
 */

import { missingMomentTokens, momentDepicted } from './realizationScoring';

/** The contract surface both SceneBlueprint and (tagged) SceneContent carry. */
export interface SceneContractSource {
  requiredBeats?: Array<{ tier?: string; mustDepict?: string }>;
  signatureMoment?: string;
}

/** A prose-bearing beat as the realization validators scan it. */
export interface RealizableBeat {
  id?: string;
  text?: string;
  setupText?: string;
  escalationText?: string;
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

/** Every authored moment the scene's prose must depict. */
export function requiredMomentsFor(source: SceneContractSource | undefined): RequiredMoment[] {
  if (!source) return [];
  const moments: RequiredMoment[] = [];
  for (const beat of source.requiredBeats ?? []) {
    const moment = beat?.mustDepict?.trim();
    if (!moment) continue;
    const tier = beat.tier ?? 'authored';
    // Connective beats are free tissue the writer may author around — the
    // validators don't enforce them and neither do we.
    if (tier === 'connective') continue;
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
