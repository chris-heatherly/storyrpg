/**
 * Targeted cost/stakes-field re-author support (bite-me 2026-07-06 postmortem).
 *
 * ROOT CAUSE this exists for: when the LLM omits an optional `cost` object on
 * a partialVictory outcome (or a storylet/stakes string), DETERMINISTIC code
 * (EncounterArchitect.buildDefaultEncounterCost / encounterConverter.
 * deriveEncounterCost) injects a registered template placeholder ("Relief
 * arrives with a complication still attached."). The no-boilerplate scan then
 * flags it — but regenerating the WHOLE encounter cannot reliably clear it:
 * the injection recurs whenever the field is omitted again, and the regen
 * feedback named a registry label the LLM never authored. Runs hard-aborted
 * in an unwinnable loop.
 *
 * The fix is a FOCUSED field re-author: collect exactly the offending string
 * fields (with their surrounding fictional context), ask the LLM to author
 * those strings alone, and write them back in place. Pure helpers here; the
 * LLM call lives on EncounterArchitect.reauthorFallbackCostFields and the
 * final-contract handler in remediation/encounterCostRepairHandler.ts.
 *
 * Works on BOTH shapes that carry these fields — the generation-time
 * EncounterStructure and the converted runtime encounter — because the walk
 * is key-based, not shape-based.
 */

import { SYNTHETIC_FALLBACK_PROSE_PATTERNS } from '../constants/syntheticFallbackProse';

/** The cost/stakes string fields deterministic code is known to backfill. */
const COST_FIELD_KEYS = new Set([
  'immediateEffect',
  'visibleComplication',
  'lingeringEffect',
  'victory',
  'defeat',
]);

/** Ancestor fields that give the re-author useful fictional context. */
const CONTEXT_KEYS = ['narrativeText', 'narrativeFunction', 'setupText', 'outcomeText', 'name', 'description'] as const;

export interface FallbackCostFieldEntry {
  /** Stable id used to key the LLM's JSON response back to this entry. */
  id: string;
  /** The object that owns the offending string (mutated in place on apply). */
  container: Record<string, unknown>;
  /** The offending key on `container`. */
  key: string;
  /** The current (template) text. */
  currentText: string;
  /** The syntheticFallbackProse registry label that matched. */
  label: string;
  /** Best-effort surrounding fiction (nearest narrativeText/name/etc.). */
  context: string;
}

function matchFallbackLabel(text: string): string | undefined {
  for (const entry of SYNTHETIC_FALLBACK_PROSE_PATTERNS) {
    if (entry.pattern.test(text)) return entry.label;
  }
  return undefined;
}

function contextFrom(obj: Record<string, unknown>): string | undefined {
  for (const key of CONTEXT_KEYS) {
    const value = obj[key];
    if (typeof value === 'string' && value.trim().length >= 8 && !matchFallbackLabel(value)) {
      return value.trim();
    }
  }
  return undefined;
}

const WALK_MAX_DEPTH = 40;

/**
 * Walk an encounter tree (structure or runtime shape) and collect every
 * cost/stakes string field whose value is registered deterministic fallback
 * prose. Containers are returned by reference so authored replacements can be
 * applied in place.
 */
export function collectFallbackCostFieldEntries(root: unknown): FallbackCostFieldEntry[] {
  const entries: FallbackCostFieldEntry[] = [];
  const seen = new Set<object>();

  const visit = (node: unknown, inheritedContext: string, depth: number): void => {
    if (!node || typeof node !== 'object' || depth > WALK_MAX_DEPTH || seen.has(node)) return;
    seen.add(node as object);
    if (Array.isArray(node)) {
      for (const item of node) visit(item, inheritedContext, depth + 1);
      return;
    }
    const obj = node as Record<string, unknown>;
    const localContext = contextFrom(obj) ?? inheritedContext;
    for (const [key, value] of Object.entries(obj)) {
      if (typeof value === 'string') {
        if (!COST_FIELD_KEYS.has(key)) continue;
        const label = matchFallbackLabel(value);
        if (!label) continue;
        entries.push({
          id: `field-${entries.length + 1}`,
          container: obj,
          key,
          currentText: value,
          label,
          context: localContext,
        });
      } else if (value && typeof value === 'object') {
        visit(value, localContext, depth + 1);
      }
    }
  };

  visit(root, '', 0);
  return entries;
}

export interface CostReauthorContext {
  sceneName?: string;
  sceneDescription?: string;
  protagonistName?: string;
}

/** Human wording per field key so the LLM knows what each string must do. */
const FIELD_INTENT: Record<string, string> = {
  immediateEffect: 'the concrete price the partial win costs RIGHT NOW, in the fiction',
  visibleComplication: 'the visible complication that follows the protagonist out of this encounter',
  lingeringEffect: 'how the cost keeps echoing after the encounter ends',
  victory: 'what winning this encounter concretely means in this scene',
  defeat: 'what losing this encounter concretely costs in this scene',
};

/**
 * One focused prompt authoring ALL offending fields in a single call.
 * The prompt shows the ACTUAL placeholder string (never just a registry
 * label) and the surrounding fictional context for each field.
 */
export function buildCostReauthorPrompt(
  entries: FallbackCostFieldEntry[],
  ctx: CostReauthorContext,
): string {
  const header = [
    'You are repairing an interactive-fiction encounter. The pipeline injected generic placeholder',
    'sentences into a few cost/stakes fields because they were left unauthored. Replace each',
    'placeholder with ONE specific, concrete sentence grounded in this scene.',
    '',
    ctx.sceneName ? `SCENE: ${ctx.sceneName}` : '',
    ctx.sceneDescription ? `SCENE CONTEXT: ${ctx.sceneDescription}` : '',
    ctx.protagonistName ? `PROTAGONIST: ${ctx.protagonistName}` : '',
  ].filter(Boolean).join('\n');

  const fieldBlocks = entries.map((entry) => {
    const intent = FIELD_INTENT[entry.key] ?? 'the concrete in-fiction meaning of this field';
    return [
      `- id: ${entry.id}`,
      `  field: ${entry.key} (${intent})`,
      `  placeholder to replace: "${entry.currentText}"`,
      entry.context ? `  surrounding fiction: "${entry.context.slice(0, 240)}"` : '',
    ].filter(Boolean).join('\n');
  }).join('\n');

  return `${header}

FIELDS TO AUTHOR:
${fieldBlocks}

Each replacement MUST:
- be one concrete sentence (max ~30 words) specific to THIS scene's people, place, and stakes;
- never mention stats, dice, percentages, or game mechanics;
- never reuse or lightly reword the placeholder sentence;
- differ from the other replacements.

Return ONLY a JSON object mapping each id to its authored sentence. Example: {"field-1":"…","field-2":"…"}. No prose outside the JSON.`;
}

/**
 * Write authored texts back into their containers. A field is replaced only
 * with REAL prose: non-empty, not itself a registered fallback, and not an
 * echo of the placeholder — a failed re-author leaves the placeholder in
 * place for the contract gate to catch (never worse than before).
 * Returns the number of fields replaced.
 */
export function applyAuthoredCostFieldTexts(
  entries: FallbackCostFieldEntry[],
  authored: Record<string, unknown>,
): number {
  let replaced = 0;
  for (const entry of entries) {
    const value = authored[entry.id];
    if (typeof value !== 'string') continue;
    const text = value.trim();
    if (text.length < 12) continue;
    if (matchFallbackLabel(text)) continue;
    if (text.toLowerCase() === entry.currentText.trim().toLowerCase()) continue;
    entry.container[entry.key] = text;
    replaced += 1;
  }
  return replaced;
}
