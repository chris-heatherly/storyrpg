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
  textVariants?: TextVariantLike[];
  setupText?: string;
  escalationText?: string;
  setupTextVariants?: TextVariantLike[];
  escalationTextVariants?: TextVariantLike[];
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

function collectVariants(texts: string[], variants: TextVariantLike[] | undefined): void {
  for (const variant of variants ?? []) pushReaderText(texts, variant.text);
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

/**
 * Reader-facing encounter META texts outside the strict realization surface.
 * Used by broad text hygiene scans that should include visual/cost/supporting
 * prose, while realization validators use collectReaderFacingTexts above.
 */
export function collectEncounterMetaTexts(scene: Scene): string[] {
  const enc = scene.encounter as unknown as Record<string, unknown> | undefined;
  if (!enc) return [];
  const texts: string[] = [];
  const keys = new Set([
    'narrativeText', 'outcomeText', 'setupText', 'escalationText',
    'visualMoment', 'visualNarrative', 'visibleCost', 'visibleComplication',
    'immediateEffect', 'lingeringEffect',
    'description', 'victory', 'defeat', 'onSuccess', 'onFailure',
  ]);
  const seen = new Set<object>();
  const visit = (node: unknown): void => {
    if (!node || typeof node !== 'object' || seen.has(node)) return;
    seen.add(node as object);
    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      if (typeof value === 'string') {
        if (keys.has(key)) pushReaderText(texts, value);
      } else if (value && typeof value === 'object') {
        visit(value);
      }
    }
  };
  visit(enc);
  return texts;
}
