import type { Choice, Consequence } from '../../types';
import { isPlaceholderStake } from '../constants/placeholderStakes';
import { isPlanningRegisterText } from '../constants/planningRegisterText';
import { normalizeTintFlag } from '../utils/tintVocabulary';
import { getFlagRegistry } from './flagRegistry';
import { isGateEnabled } from '../remediation/gateDefaults';
import { normalizeChoiceStatCheck } from '../utils/statCheckNormalization';

/**
 * Route a fallback choice set across a branch point's distinct `leadsTo` targets so
 * every target is reached by ≥1 choice (round-robin), padding the choice list when
 * there are fewer choices than targets. Used to structurally realize a planned branch
 * when ChoiceAuthor fails for a branch point, so GATE_BRANCH_FANOUT passes instead of
 * hard-aborting the episode. Pure (returns new objects); unit-testable.
 */
export function routeFallbackChoicesAcrossTargets<T extends { id: string; nextSceneId?: string }>(
  baseChoices: T[],
  targets: string[],
  beatId: string,
): T[] {
  if (targets.length === 0 || baseChoices.length === 0) return baseChoices.slice();
  const choices = baseChoices.slice();
  while (choices.length < targets.length) {
    const i = choices.length;
    const template = baseChoices[i % baseChoices.length];
    choices.push({ ...template, id: `${beatId}-fallback-choice-${i + 1}` });
  }
  return choices.map((choice, i) => ({ ...choice, nextSceneId: targets[i % targets.length] }));
}

export interface ReaderFacingFallbackChoiceInput {
  optionHints?: string[];
  localContext?: string[];
  choicePointDescription?: string;
  choiceBeatText?: string;
  choiceBeatVisualMoment?: string;
  sceneName?: string;
  dramaticQuestion?: string;
  dramaticPurpose?: string;
  conflictEngine?: string;
}

export interface ChoiceAttachmentBeat {
  id: string;
  text?: string;
  isChoicePoint?: boolean;
}

function isUnsafeFallbackText(text: string | undefined): boolean {
  if (!text || text.trim().length === 0) return true;
  return isPlanningRegisterText(text)
    || isPlaceholderStake(text)
    || /\bforeshadowing\b/i.test(text)
    || /\baudience catches\b/i.test(text)
    || /\bprotagonist\b/i.test(text)
    || /\bscene should echo\b/i.test(text)
    || /\bchoice changes the room\b/i.test(text)
    || /\bchoice leaves visible residue\b/i.test(text)
    || /\bdecision changes the tone\b/i.test(text)
    || /\bscene\s*\d+\b/i.test(text)
    || /\bserves\s+the\s+\w+\s+beat\b/i.test(text)
    || /\bforward\s+pressure\s*:/i.test(text);
}

function isMixedDecisionHint(text: string | undefined): boolean {
  const normalized = String(text || '').replace(/\s+/g, ' ').trim();
  if (!normalized) return false;
  const hasMultipleClauses = /;\s*(?:and|or)\b/i.test(normalized) || /\band at \d/i.test(normalized);
  if (!hasMultipleClauses) return false;
  const decisionWords = normalized.match(/\b(?:accept|decline|wait|choose|name|run|fight|freeze|scream)\b/gi) ?? [];
  return decisionWords.length >= 3;
}

function sentence(text: string): string {
  const trimmed = text.trim().replace(/\s+/g, ' ');
  if (!trimmed) return trimmed;
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

function expandShortFallbackOption(text: string): string {
  const trimmed = text.trim().replace(/\.$/, '');
  const normalized = trimmed.toLowerCase();
  const known: Record<string, string> = {
    scream: 'Scream for help',
    run: 'Run for the open path',
    freeze: 'Freeze and read the danger',
    fight: 'Fight back with everything you have',
    'fight back': 'Fight back with everything you have',
  };
  if (known[normalized]) return known[normalized];
  if (/^(?:the|a|an)\s+/i.test(trimmed)) return `Choose ${trimmed} as the name`;
  if (trimmed.length < 16) return `Choose ${trimmed}`;
  return trimmed;
}

interface OptionHintFragment {
  text: string;
  context: string;
}

function optionHintFragments(hints: string[]): OptionHintFragment[] {
  const fragments: OptionHintFragment[] = [];
  for (const hint of hints) {
    const trimmed = String(hint || '').trim();
    if (!trimmed) continue;
    if (isUnsafeFallbackText(trimmed) || isMixedDecisionHint(trimmed)) continue;

    const afterColon = trimmed.split(/:/).slice(1).join(':').trim();
    const beforeColon = afterColon ? trimmed.split(/:/)[0].trim() : '';
    const listLike = Boolean(afterColon) || /,|\/|\bor\b/i.test(trimmed);
    if (!listLike) fragments.push({ text: trimmed, context: trimmed });

    const listSource = afterColon || trimmed;
    for (const piece of listSource.split(/\s*(?:,|\/|\bor\b)\s*/i)) {
      const clean = piece
        .replace(/\((?:canonical|default)\)/gi, '')
        .replace(/^(?:and|or)\s+/i, '')
        .trim();
      if (clean && !isUnsafeFallbackText(clean)) {
        fragments.push({ text: clean, context: [beforeColon, clean].filter(Boolean).join(' ') });
      }
    }
  }
  return fragments;
}

const FALLBACK_CONTEXT_STOPWORDS = new Set([
  'the', 'and', 'that', 'this', 'with', 'from', 'into', 'your', 'you', 'her', 'his',
  'him', 'she', 'they', 'them', 'their', 'for', 'when', 'what', 'where', 'why', 'how',
  'does', 'did', 'will', 'can', 'could', 'would', 'should', 'give', 'handle', 'choose',
  'decide', 'scene', 'moment', 'next', 'morning',
]);

function fallbackContextTokens(text: string | undefined): Set<string> {
  const out = new Set<string>();
  for (const raw of String(text || '').toLowerCase().split(/[^a-z0-9]+/)) {
    let token = raw.trim();
    if (token.endsWith('s') && token.length > 4) token = token.slice(0, -1);
    if (token.length < 4 || FALLBACK_CONTEXT_STOPWORDS.has(token)) continue;
    out.add(token);
  }
  return out;
}

function contextualHintFragments(fragments: OptionHintFragment[], contextText: string): OptionHintFragment[] {
  const context = fallbackContextTokens(contextText);
  if (context.size === 0) return fragments;
  const scored = fragments.map((fragment) => {
    const tokens = fallbackContextTokens(fragment.context);
    let score = 0;
    for (const token of tokens) if (context.has(token)) score += 1;
    return { fragment, score };
  });
  const best = Math.max(0, ...scored.map((item) => item.score));
  if (best <= 0) return fragments;
  return scored.filter((item) => item.score > 0).map((item) => item.fragment);
}

function compactFragment(text: string | undefined, maxWords = 8): string {
  const cleaned = String(text || '')
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned || isUnsafeFallbackText(cleaned)) return '';

  const concrete = cleaned.match(/\b(?:the|a|an|her|his|their|this|that)\s+[a-z][a-z'-]+(?:\s+[a-z][a-z'-]+){0,5}/i);
  const source = concrete?.[0] || cleaned.split(/[.!?;:]/)[0] || '';
  const words = source.split(/\s+/).filter(Boolean).slice(0, maxWords);
  return words.join(' ').replace(/[,;:]$/, '').trim();
}

function uniqueSafeOptions(options: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const option of options) {
    const text = sentence(expandShortFallbackOption(option));
    const key = text.toLowerCase();
    if (isUnsafeFallbackText(text) || seen.has(key)) continue;
    seen.add(key);
    out.push(text);
  }
  return out;
}

export function buildReaderFacingFallbackChoiceOptions(input: ReaderFacingFallbackChoiceInput): string[] {
  const fragments = optionHintFragments(input.optionHints || []);
  const localContext = [
    ...(input.localContext || []),
    input.choiceBeatText,
    input.choiceBeatVisualMoment,
  ].filter(Boolean).join(' ');
  const contextual = contextualHintFragments(fragments, localContext);
  const hinted = uniqueSafeOptions(contextual.map((fragment) => fragment.text));
  if (hinted.length >= 3) return hinted.slice(0, 4);

  const anchor = compactFragment(input.choicePointDescription);

  const derived = anchor
    ? [
        `Respond to ${anchor}`,
        `Hold back and study ${anchor}`,
        `Press for the truth behind ${anchor}`,
      ]
    : [
        'Act before the moment closes',
        'Wait long enough to read the danger',
        'Ask what is really at stake',
      ];

  return uniqueSafeOptions([...hinted, ...derived]).slice(0, 4);
}

const COMPLETED_CHOICE_BEAT_RE =
  /\b(?:you|kylie|he|she|they)\s+(?:write|writes|wrote|name|names|named|choose|chooses|chose|accept|accepts|accepted|decline|declines|declined|wait|waits|waited|open|opens|opened|finally|already)\b/i;

const PROMPTABLE_CHOICE_BEAT_RE =
  /\b(?:what do you|how do you|which do you|do you|will you|decide how|choose whether|choose how|choose what|pick one|make the call)\b/i;

export function isSafeChoiceAttachmentBeat(beat: ChoiceAttachmentBeat | undefined): boolean {
  if (!beat) return false;
  if (beat.isChoicePoint === true) return true;
  const text = String(beat.text || '').replace(/\s+/g, ' ').trim();
  if (!text || isUnsafeFallbackText(text)) return false;
  if (PROMPTABLE_CHOICE_BEAT_RE.test(text)) return true;
  if (COMPLETED_CHOICE_BEAT_RE.test(text)) return false;
  return false;
}

const BRANCH_MATCH_STOPWORDS = new Set([
  'the', 'and', 'that', 'this', 'with', 'from', 'into', 'your', 'you', 'her', 'his',
  'him', 'she', 'they', 'them', 'their', 'a', 'an', 'to', 'of', 'it', 'is', 'in', 'on',
  'because', 'rather', 'than', 'not', 'but', 'where', 'when', 'who',
]);

function branchTokens(text: string | undefined): Set<string> {
  const out = new Set<string>();
  for (const raw of String(text || '').toLowerCase().split(/[^a-z0-9]+/)) {
    if (raw.length >= 4 && !BRANCH_MATCH_STOPWORDS.has(raw)) out.add(raw);
  }
  return out;
}

/** Content-word overlap between a choice's text and a branch path's label. */
function branchAffinity(choiceText: string | undefined, label: string | undefined): number {
  const a = branchTokens(choiceText);
  const b = branchTokens(label);
  if (a.size === 0 || b.size === 0) return 0;
  let hits = 0;
  for (const t of a) if (b.has(t)) hits += 1;
  return hits;
}

/**
 * Repair an UNDER-FANNED branch point in place: when a multi-target branch scene's
 * AUTHORED choices route to fewer than 2 of its `leadsTo` targets (e.g. the LLM pointed
 * both choices at the same scene, orphaning the other branch — the bite-me-gen-8 s1-1
 * case), re-point spare choices at the unreached targets until ≥2 distinct targets are
 * covered.
 *
 * IMPORTANT (story coherence): this does NOT write or move prose — the choices are
 * already authored. It only corrects each choice's DESTINATION. When `pathHints` give
 * the authored branch-path label for each target (from BranchManager — e.g. s1-3="The
 * Side Entrance / accept the key card", s1-2="The Front Door / decline"), the spare
 * choice routed to a target is the one whose TEXT best matches that target's authored
 * intent — so "decline" lands on the front-door branch, never the side-entrance one.
 * Without hints it falls back to the first safe spare (last resort; logged by caller).
 *
 * "Spare" = a choice whose nextSceneId is not an in-target route, else a redundant
 * choice whose target is already covered by another choice. Existing distinct routing is
 * preserved. Returns true iff any choice was re-pointed. Pure (mutates choices).
 */
export function repairBranchFanOut<T extends { nextSceneId?: string; text?: string }>(
  choices: T[],
  leadsTo: string[] | undefined,
  opts?: { pathHints?: Array<{ target: string; label: string }> },
): boolean {
  const targets = [...new Set((leadsTo ?? []).filter(Boolean))];
  const need = Math.min(2, targets.length, choices.length);
  if (need < 2) return false; // not a multi-target branch (or too few choices to fan out)

  const inTarget = (id: string | undefined): id is string => !!id && targets.includes(id);
  const distinctReached = (): Set<string> => new Set(choices.map((c) => c.nextSceneId).filter(inTarget));
  if (distinctReached().size >= need) return false; // already fans out enough

  const labelByTarget = new Map((opts?.pathHints ?? []).map((h) => [h.target, h.label]));

  // Choices safe to re-point: unrouted / out-of-target, OR redundant (their target is
  // covered by another choice). Never steals the SOLE choice reaching a target.
  const spareChoices = (): T[] => {
    const counts = new Map<string, number>();
    for (const c of choices) if (inTarget(c.nextSceneId)) counts.set(c.nextSceneId, (counts.get(c.nextSceneId) ?? 0) + 1);
    return choices.filter((c) => !inTarget(c.nextSceneId) || (counts.get(c.nextSceneId as string) ?? 0) > 1);
  };

  let changed = false;
  for (const target of targets) {
    if (distinctReached().size >= need) break;
    if (distinctReached().has(target)) continue;
    const spares = spareChoices();
    if (spares.length === 0) break; // nothing safe to re-point
    // Route the spare whose TEXT best matches this target's authored branch label, so
    // the choice goes where the author intended (not by arbitrary order). First spare
    // when there is no label or no signal.
    const label = labelByTarget.get(target);
    let chosen = spares[0];
    if (label) {
      let best = -1;
      for (const c of spares) {
        const score = branchAffinity(c.text, label);
        if (score > best) { best = score; chosen = c; }
      }
    }
    chosen.nextSceneId = target;
    changed = true;
  }
  return changed;
}

/**
 * Re-point each choice set's `beatId` at its scene's ACTUAL choice-point beat when
 * the recorded id has drifted out of sync with the scene content.
 *
 * A choice set is keyed to the choice-point beat id that existed when ChoiceAuthor
 * ran. Several post-authoring rewrite passes (the scene-time realization retry's
 * `Object.assign`, SceneCritic polish, POV regeneration, continuity repair) REPLACE
 * a scene's beats array with freshly-id'd beats but do not re-key the scene's choice
 * set. Assembly links choices to beats strictly by `${sceneId}::${beatId}`
 * (assembly.ts), so a drifted beatId silently drops the choices — and for a branch
 * point that unrealizes the planned branch and hard-aborts the episode at
 * GATE_BRANCH_FANOUT (the bite-me-g13 ep3 s3-1 case: choice set beatId "beat-3" but
 * the assembled scene's choice-point beat is "s3-1-b3", so s3-1 shipped choiceless
 * and "reached none of [s3-2, s3-3]").
 *
 * For every choice set whose recorded beatId no longer matches any beat in its
 * scene, re-point it at an UNCLAIMED choice-point beat (the marked `isChoicePoint`
 * beat, else the last beat) — never one already claimed by an aligned choice set, so
 * a scene with multiple choice points is not mis-linked. Choice sets that still match
 * a beat are untouched, making this a no-op on aligned runs (golden parity). Mutates
 * `choiceSets` in place; returns the number of re-pointed sets.
 */
export function reconcileChoiceSetBeatIds(
  sceneContents: Array<{ sceneId: string; beats?: Array<ChoiceAttachmentBeat> }>,
  choiceSets: Array<{ sceneId?: string; beatId: string }>,
): number {
  const beatsByScene = new Map(sceneContents.map((sc) => [sc.sceneId, sc.beats ?? []]));
  // Beat ids already correctly claimed by an aligned choice set, per scene — never
  // steal one of these when re-pointing a drifted set.
  const claimed = new Map<string, Set<string>>();
  const claim = (sceneId: string, beatId: string) => {
    const set = claimed.get(sceneId) ?? new Set<string>();
    set.add(beatId);
    claimed.set(sceneId, set);
  };
  for (const cs of choiceSets) {
    if (!cs.sceneId) continue;
    const beats = beatsByScene.get(cs.sceneId);
    if (beats?.some((b) => b.id === cs.beatId)) claim(cs.sceneId, cs.beatId);
  }

  let repaired = 0;
  for (const cs of choiceSets) {
    if (!cs.sceneId) continue;
    const beats = beatsByScene.get(cs.sceneId);
    if (!beats || beats.length === 0) continue;
    const matchedBeat = beats.find((b) => b.id === cs.beatId);
    // Assembly only attaches a choice set to a beat when that beat is the marked
    // choice point AND the choiceMap has `${sceneId}::${beat.id}` (assembly.ts).
    // So the set is correctly linked ONLY when its beatId names a choice-point
    // beat. Leave it alone in two aligned cases:
    //  - it already names the (or a) marked choice-point beat;
    //  - the scene marks NO choice-point beat at all (nothing to move to — the
    //    last-beat fallback in choice-point detection stands in, and re-pointing
    //    can't help since assembly attaches choices to no beat regardless).
    const hasMarkedChoicePoint = beats.some((b) => b.isChoicePoint);
    if (matchedBeat?.isChoicePoint) continue;
    if (matchedBeat && !hasMarkedChoicePoint) continue;
    // Otherwise the set is mis-linked and assembly would DROP its choices: the
    // beatId either names no beat (rename drift — bite-me-g13 ep3 s3-1) or names a
    // NON-choice-point beat while the choice point moved elsewhere (bite-me-g14
    // ep2 s2-1: set keyed "beat-3", but the post-rewrite choice point is "beat-4",
    // so the branch shipped choiceless and "reached none of [s2-2, s2-3]").
    // Re-point at an UNCLAIMED choice-point beat (else a promptable last beat).
    // Never fall back to a beat that already narrates the decision as completed;
    // that shipped stale fallback choices on Bite Me s2-4-b8 ("You name him
    // The Mountain" with choices to accept Radu's lift / wait for the tow).
    const sceneClaimed = claimed.get(cs.sceneId) ?? new Set<string>();
    const lastBeat = beats[beats.length - 1];
    const candidate =
      beats.find((b) => b.isChoicePoint && !sceneClaimed.has(b.id)) ??
      (!sceneClaimed.has(lastBeat.id) && isSafeChoiceAttachmentBeat(lastBeat) ? lastBeat : undefined);
    if (candidate && candidate.id !== cs.beatId) {
      cs.beatId = candidate.id;
      claim(cs.sceneId, candidate.id);
      repaired += 1;
    }
  }
  return repaired;
}

/**
 * Normalize a Consequence object to fix common LLM field-name deviations.
 */
export function normalizeConsequence(c: Consequence): Consequence {
  const raw = c as Record<string, unknown>;
  if ((c.type === 'changeScore' || c.type === 'setScore') && !('score' in c) && typeof raw.target === 'string') {
    return { ...(c as Record<string, unknown>), score: raw.target as string } as Consequence;
  }
  if (c.type === 'setFlag' && !('flag' in c) && typeof raw.name === 'string') {
    return normalizeConsequence({ ...(c as Record<string, unknown>), flag: raw.name as string } as Consequence);
  }
  // G12: authored tints rarely matched the identity engine's canonical vocabulary
  // (tint:bold vs tint:boldness), leaving the whole tint tier inert at runtime.
  if (c.type === 'setFlag' && typeof raw.flag === 'string' && (raw.flag as string).startsWith('tint:')) {
    const canonical = getFlagRegistry().mintTintFlag(raw.flag as string, 'choiceAssembly');
    if (canonical !== raw.flag) {
      return { ...(c as unknown as Record<string, unknown>), flag: canonical } as unknown as Consequence;
    }
  }
  // Every authored setter is registered at assembly, so late-stage
  // reconciliation and validators can consult the registry instead of
  // re-scanning the story (audit item 2).
  if (c.type === 'setFlag' && typeof raw.flag === 'string') {
    const registry = getFlagRegistry();
    registry.register(raw.flag as string, registry.kindOf(raw.flag as string), 'choiceAssembly');
  }
  if (c.type === 'relationship' && !('dimension' in c)) {
    const dimensionAlias = raw.relationshipType ?? raw.aspect;
    if (typeof dimensionAlias === 'string') {
      return { ...(c as Record<string, unknown>), dimension: dimensionAlias } as Consequence;
    }
  }
  return c;
}

export function normalizeConsequences(consequences: Consequence[] | undefined): Consequence[] | undefined {
  if (!consequences || !Array.isArray(consequences)) return consequences;
  return consequences.map(normalizeConsequence);
}

function normalizeDelayedConsequences(delayedConsequences: Choice['delayedConsequences']): Choice['delayedConsequences'] {
  if (!delayedConsequences || !Array.isArray(delayedConsequences)) return delayedConsequences;
  return delayedConsequences.map((entry) => ({
    ...entry,
    consequence: normalizeConsequence(entry.consequence),
  }));
}

/**
 * Fold a choice's `tintFlag` into its consequences as a real `setFlag`. Previously
 * the tintFlag was dead metadata — never applied at runtime, never counted in the
 * consequence budget (tint stuck at 0%), and never surfaced for tint callbacks.
 * Making it a real consequence fixes all three (the engine sets it, the budget
 * classifies a `tint:` setFlag as the tint tier, and episodePlantContext can surface
 * it). Deduped so a choice that already sets the flag isn't doubled.
 */
export function foldTintFlagIntoConsequences(
  consequences: Consequence[] | undefined,
  tintFlag: string | undefined,
): Consequence[] | undefined {
  if (!tintFlag) return consequences;
  const canonicalTint = normalizeTintFlag(tintFlag);
  const list = Array.isArray(consequences) ? [...consequences] : [];
  const already = list.some(
    (c) => c.type === 'setFlag' && typeof (c as { flag?: string }).flag === 'string'
      && normalizeTintFlag((c as { flag: string }).flag) === canonicalTint,
  );
  if (!already) list.push({ type: 'setFlag', flag: canonicalTint, value: true } as Consequence);
  return list;
}

/**
 * Bake witness reactions into the rendered outcome texts (G12 / WS7).
 *
 * `reactionText` and `witnessReactions` have NO runtime consumer — the engine
 * renders `outcomeTexts` only (storyEngine), so roughly half the authored witness
 * reactivity never reached the player ("Mika's posture loosens…" lived only in
 * metadata). Deterministic, additive: append the first witness reaction sentence
 * to each tier that does not already mention that witness. Kill switch:
 * GATE_WITNESS_BAKE=0.
 */
export function bakeWitnessReactionsIntoOutcomeTexts(
  outcomeTexts: Choice['outcomeTexts'],
  witnessReactions: Choice['witnessReactions'],
): Choice['outcomeTexts'] {
  if (!outcomeTexts || !witnessReactions?.length) return outcomeTexts;
  const reaction = witnessReactions
    .map((wr) => (typeof wr?.reactionText === 'string' ? wr.reactionText.trim() : ''))
    .find((t) => t.length > 0);
  if (!reaction) return outcomeTexts;
  const probe = reaction.toLowerCase().slice(0, 40);
  const bake = (tier: string | undefined): string | undefined => {
    if (!tier || !tier.trim()) return tier;
    if (tier.toLowerCase().includes(probe)) return tier; // already present
    const base = tier.trim();
    const sep = /[.!?…"”]$/.test(base) ? ' ' : '. ';
    return `${base}${sep}${reaction}`;
  };
  return {
    ...outcomeTexts,
    ...(outcomeTexts.success !== undefined ? { success: bake(outcomeTexts.success)! } : {}),
    ...(outcomeTexts.partial !== undefined ? { partial: bake(outcomeTexts.partial)! } : {}),
    ...(outcomeTexts.failure !== undefined ? { failure: bake(outcomeTexts.failure)! } : {}),
  };
}

export function assembleChoiceForStory(
  choice: Choice,
  nextSceneId: string | undefined = choice.nextSceneId,
): Choice {
  return {
    id: choice.id,
    text: choice.text,
    choiceType: choice.choiceType,
    choiceIntent: choice.choiceIntent,
    impactFactors: choice.impactFactors,
    consequenceTier: choice.consequenceTier,
    stakes: choice.stakes,
    conditions: choice.conditions,
    showWhenLocked: choice.showWhenLocked,
    lockedText: choice.lockedText,
    statCheck: normalizeChoiceStatCheck(choice.statCheck),
    consequenceDomain: choice.consequenceDomain,
    storyVerb: choice.storyVerb,
    affordanceSource: choice.affordanceSource,
    reminderPlan: choice.reminderPlan,
    feedbackCue: choice.feedbackCue,
    moralContract: choice.moralContract,
    residueHints: choice.residueHints,
    witnessReactions: choice.witnessReactions,
    failureResidue: choice.failureResidue,
    visualResidueHint: choice.visualResidueHint,
    consequences: foldTintFlagIntoConsequences(normalizeConsequences(choice.consequences), choice.tintFlag),
    delayedConsequences: normalizeDelayedConsequences(choice.delayedConsequences),
    routeContext: choice.routeContext,
    nextSceneId,
    nextBeatId: choice.nextBeatId,
    outcomeTexts: isGateEnabled('GATE_WITNESS_BAKE')
      ? bakeWitnessReactionsIntoOutcomeTexts(choice.outcomeTexts, choice.witnessReactions)
      : choice.outcomeTexts,
    reactionText: choice.reactionText,
    tintFlag: choice.tintFlag ? normalizeTintFlag(choice.tintFlag) : choice.tintFlag,
    memorableMoment: choice.memorableMoment,
  };
}
