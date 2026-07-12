/**
 * W3 KEEP DECISION (2026-07-03): these walkers are NOT retired. The original
 * W3 plan listed them for deletion, but the keep-list preserves EncounterView's
 * situation/clock/escalation navigation — prose therefore stays inside the
 * encounter structure, and these walkers ARE the adapter that gives the
 * standard prose validators encounter coverage. Deleting them would remove
 * coverage, not duplication.
 */
import type { Scene } from '../../types';
import type { EncounterPhase } from '../../types/encounter';

/** Placeholder/residue text that does NOT count as reader-facing prose. */
const PLACEHOLDER_TEXT_PATTERN =
  /^\s*(\[?(tbd|todo|placeholder|to be (written|generated|continued)|continued|coming soon)\]?\.?)\s*$/i;

interface TextVariantLike {
  text?: string;
}

interface EncounterOutcomeLike {
  narrativeText?: string;
  outcomeText?: string;
  nextSituation?: {
    setupText?: string;
    choices?: EncounterChoiceLike[];
  };
}

interface EncounterChoiceLike {
  text?: string;
  lockedText?: string;
  outcomes?: Record<string, EncounterOutcomeLike | undefined>;
}

interface EncounterLike {
  phases?: EncounterPhase[];
  beats?: EncounterBeatLike[];
  storylets?: unknown;
  outcomes?: Record<string, EncounterOutcomeLike | undefined>;
}

interface EncounterBeatLike {
  text?: string;
  textVariants?: TextVariantLike[] | Record<string, TextVariantLike>;
  setupText?: string;
  escalationText?: string;
  setupTextVariants?: TextVariantLike[] | Record<string, TextVariantLike>;
  escalationTextVariants?: TextVariantLike[] | Record<string, TextVariantLike>;
  choices?: EncounterChoiceLike[];
}

function asObjectValues(value: unknown): unknown[] {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (typeof value === 'object') return Object.values(value as Record<string, unknown>);
  return [];
}

/** True iff `text` is a real reader-facing string. */
export function isReaderFacingText(text: string | undefined): boolean {
  const trimmed = (text ?? '').trim();
  if (trimmed.length === 0) return false;
  return !PLACEHOLDER_TEXT_PATTERN.test(trimmed);
}

function pushReaderText(texts: string[], text: string | undefined): void {
  if (isReaderFacingText(text)) texts.push(text!.trim());
}

function collectVariants(texts: string[], variants: TextVariantLike[] | Record<string, TextVariantLike> | undefined): void {
  for (const variant of asObjectValues(variants)) {
    if (variant && typeof variant === 'object') pushReaderText(texts, (variant as TextVariantLike).text);
  }
}

function collectChoiceTreeTexts(texts: string[], choices: EncounterChoiceLike[] | undefined): void {
  for (const choice of choices ?? []) {
    pushReaderText(texts, choice.text);
    pushReaderText(texts, choice.lockedText);
    for (const outcome of Object.values(choice.outcomes ?? {})) {
      collectOutcomeTexts(texts, outcome);
    }
  }
}

function collectOutcomeTexts(texts: string[], outcome: EncounterOutcomeLike | undefined): void {
  if (!outcome) return;
  pushReaderText(texts, outcome.narrativeText);
  pushReaderText(texts, outcome.outcomeText);
  pushReaderText(texts, outcome.nextSituation?.setupText);
  collectChoiceTreeTexts(texts, outcome.nextSituation?.choices);
}

function collectBeatText(texts: string[], raw: unknown): void {
  const beat = raw as EncounterBeatLike | undefined;
  if (!beat) return;
  pushReaderText(texts, beat.text);
  pushReaderText(texts, beat.setupText);
  pushReaderText(texts, beat.escalationText);
  collectVariants(texts, beat.textVariants);
  collectVariants(texts, beat.setupTextVariants);
  collectVariants(texts, beat.escalationTextVariants);
  collectChoiceTreeTexts(texts, beat.choices);
}

function routeOutcomeKeys(tier: string): string[] {
  if (tier === 'victory' || tier === 'success') return ['success', 'victory'];
  if (tier === 'partialVictory' || tier === 'complicated') return ['complicated', 'partialVictory'];
  if (tier === 'defeat' || tier === 'failure') return ['failure', 'defeat'];
  return [tier];
}

/** Keep only embedded choice outcomes that can lead to the requested route. */
function collectBeatTextForRoute(texts: string[], raw: unknown, tier: string): void {
  const beat = raw as EncounterBeatLike | undefined;
  if (!beat) return;
  pushReaderText(texts, beat.text);
  pushReaderText(texts, beat.setupText);
  pushReaderText(texts, beat.escalationText);
  collectVariants(texts, beat.textVariants);
  collectVariants(texts, beat.setupTextVariants);
  collectVariants(texts, beat.escalationTextVariants);
  for (const choice of beat.choices ?? []) {
    pushReaderText(texts, choice.text);
    pushReaderText(texts, choice.lockedText);
    for (const key of routeOutcomeKeys(tier)) collectOutcomeTexts(texts, choice.outcomes?.[key]);
  }
}

/**
 * Collect prose the reader can actually see in a scene: ordinary beats, encounter
 * setup/outcome trees, phase outcomes, and storylet beats.
 */
export function collectReaderFacingTexts(scene: Scene): string[] {
  const texts: string[] = [];
  for (const beat of scene.beats ?? []) collectBeatText(texts, beat);

  const encounter = scene.encounter as EncounterLike | undefined;
  for (const beat of encounter?.beats ?? []) collectBeatText(texts, beat);

  const phases: EncounterPhase[] = encounter?.phases ?? [];
  for (const phase of phases) {
    for (const beat of phase.beats ?? []) collectBeatText(texts, beat);
    pushReaderText(texts, phase.onSuccess?.outcomeText);
    pushReaderText(texts, phase.onFailure?.outcomeText);
  }

  for (const outcome of Object.values(encounter?.outcomes ?? {})) {
    collectOutcomeTexts(texts, outcome);
  }

  for (const storylet of asObjectValues(encounter?.storylets)) {
    if (!storylet || typeof storylet !== 'object') continue;
    for (const beat of (storylet as { beats?: unknown[] }).beats ?? []) collectBeatText(texts, beat);
  }

  return texts;
}

/** All terminal paths that may carry load-bearing signature aftermath. */
export const ENCOUNTER_OUTCOME_TIERS = [
  'victory',
  'partialVictory',
  'success',
  'complicated',
  'defeat',
  'escape',
  'failure',
] as const;

const PLAYABLE_OUTCOME_TIERS = ENCOUNTER_OUTCOME_TIERS;

/**
 * Reader-facing prose scoped to one encounter outcome tier: shared setup/phase
 * beats plus that tier's terminal outcomes and storylet beats only.
 * Used so victory/partial paths cannot "borrow" aftermath prose from a sibling
 * storylet the player never sees on their path.
 */
export function collectReaderFacingTextsForEncounterOutcomeTier(
  scene: Scene,
  tiers: readonly string[] = PLAYABLE_OUTCOME_TIERS,
): Map<string, string[]> {
  const byTier = new Map<string, string[]>();
  const encounter = scene.encounter as EncounterLike | undefined;
  if (!encounter) return byTier;

  const storylets = encounter.storylets && typeof encounter.storylets === 'object'
    ? encounter.storylets as Record<string, { beats?: unknown[] } | undefined>
    : {};
  const outcomes = encounter.outcomes ?? {};

  for (const tier of tiers) {
    const texts: string[] = [];
    for (const beat of scene.beats ?? []) collectBeatTextForRoute(texts, beat, tier);
    for (const beat of encounter.beats ?? []) collectBeatTextForRoute(texts, beat, tier);
    for (const phase of encounter.phases ?? []) {
      for (const beat of phase.beats ?? []) collectBeatTextForRoute(texts, beat, tier);
      if (tier === 'victory' || tier === 'success') pushReaderText(texts, phase.onSuccess?.outcomeText);
      if (tier === 'defeat' || tier === 'failure') pushReaderText(texts, phase.onFailure?.outcomeText);
    }
    collectOutcomeTexts(texts, outcomes[tier]);
    // Alias success↔victory / complicated↔partialVictory for architect variants.
    if (tier === 'victory') collectOutcomeTexts(texts, outcomes.success);
    if (tier === 'partialVictory') collectOutcomeTexts(texts, outcomes.complicated);
    if (tier === 'success') collectOutcomeTexts(texts, outcomes.victory);
    if (tier === 'complicated') collectOutcomeTexts(texts, outcomes.partialVictory);

    const storylet = storylets[tier]
      || (tier === 'victory' ? storylets.success : undefined)
      || (tier === 'partialVictory' ? storylets.complicated : undefined)
      || (tier === 'success' ? storylets.victory : undefined)
      || (tier === 'complicated' ? storylets.partialVictory : undefined)
      || (tier === 'defeat' ? storylets.failure : undefined)
      || (tier === 'failure' ? storylets.defeat : undefined)
      || (tier === 'escape' ? storylets.escape : undefined);
    for (const beat of storylet?.beats ?? []) collectBeatText(texts, beat);
    if (tier === 'defeat') collectOutcomeTexts(texts, outcomes.failure);
    if (tier === 'failure') collectOutcomeTexts(texts, outcomes.defeat);

    // Only report tiers that actually have tier-specific prose (outcome or storylet).
    const hasTierpecific = Boolean(outcomes[tier] || storylets[tier]
      || (tier === 'victory' && (outcomes.success || storylets.success))
      || (tier === 'partialVictory' && (outcomes.complicated || storylets.complicated))
      || (tier === 'success' && (outcomes.victory || storylets.victory))
      || (tier === 'complicated' && (outcomes.partialVictory || storylets.partialVictory))
      || (tier === 'failure' && (outcomes.defeat || storylets.defeat))
      || (tier === 'defeat' && (outcomes.failure || storylets.failure)));
    if (hasTierpecific) byTier.set(tier, texts);
  }
  return byTier;
}

/**
 * Collect only terminal prose for one outcome tier. Shared phase setup is
 * intentionally excluded: it may be authored once for every route and must
 * never make a failed terminal route look realized merely because a sibling
 * route contains the required payoff.
 */
export function collectReaderFacingTerminalTextsForEncounterOutcomeTier(
  scene: Scene,
  tier: string,
): string[] {
  const texts: string[] = [];
  const encounter = scene.encounter as EncounterLike | undefined;
  if (!encounter) return texts;
  const storylets = encounter.storylets && typeof encounter.storylets === 'object'
    ? encounter.storylets as Record<string, { beats?: unknown[] } | undefined>
    : {};
  const outcomes = encounter.outcomes ?? {};
  const outcome = outcomes[tier]
    || (tier === 'victory' ? outcomes.success : undefined)
    || (tier === 'success' ? outcomes.victory : undefined)
    || (tier === 'partialVictory' ? outcomes.complicated : undefined)
    || (tier === 'complicated' ? outcomes.partialVictory : undefined)
    || (tier === 'defeat' ? outcomes.failure : undefined)
    || (tier === 'failure' ? outcomes.defeat : undefined);
  collectOutcomeTexts(texts, outcome);
  const storylet = storylets[tier]
    || (tier === 'victory' ? storylets.success : undefined)
    || (tier === 'success' ? storylets.victory : undefined)
    || (tier === 'partialVictory' ? storylets.complicated : undefined)
    || (tier === 'complicated' ? storylets.partialVictory : undefined)
    || (tier === 'defeat' ? storylets.failure : undefined)
    || (tier === 'failure' ? storylets.defeat : undefined)
    || (tier === 'escape' ? storylets.escape : undefined);
  for (const beat of storylet?.beats ?? []) collectBeatText(texts, beat);
  return texts;
}

/**
 * Reader-facing encounter META texts outside the strict realization surface.
 * Used by broad text hygiene scans that should include visual/cost/supporting
 * prose, while realization validators use collectReaderFacingTexts above.
 */
export function collectEncounterMetaTexts(scene: Scene): string[] {
  return collectEncounterMetaTextFields(scene).map((field) => field.text);
}

export interface EncounterMetaTextField {
  /** Exact path relative to the scene object. */
  path: string;
  text: string;
}

/**
 * Collect only shippable encounter metadata and preserve exact field ownership.
 * Planning provenance is skipped as a whole subtree.
 */
export function collectEncounterMetaTextFields(scene: Scene): EncounterMetaTextField[] {
  const enc = scene.encounter as unknown as Record<string, unknown> | undefined;
  if (!enc) return [];
  const fields: EncounterMetaTextField[] = [];
  const keys = new Set([
    'narrativeText', 'outcomeText', 'setupText', 'escalationText',
    'visualMoment', 'visualNarrative', 'visibleCost', 'visibleComplication',
    'immediateEffect', 'lingeringEffect',
    'description', 'victory', 'defeat', 'onSuccess', 'onFailure',
  ]);
  const authorOnlyKeys = new Set(['sourceSynopsis', 'authoredAnchor']);
  const seen = new Set<object>();
  const visit = (node: unknown, path: string): void => {
    if (!node || typeof node !== 'object' || seen.has(node)) return;
    seen.add(node as object);
    if (Array.isArray(node)) {
      node.forEach((item, index) => visit(item, `${path}[${index}]`));
      return;
    }
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      if (authorOnlyKeys.has(key)) continue;
      const childPath = `${path}.${key}`;
      if (typeof value === 'string') {
        if (keys.has(key) && isReaderFacingText(value)) {
          fields.push({ path: childPath, text: value.trim() });
        }
      } else if (value && typeof value === 'object') {
        visit(value, childPath);
      }
    }
  };
  visit(enc, 'encounter');
  return fields;
}
