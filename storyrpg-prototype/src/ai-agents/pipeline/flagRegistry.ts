/**
 * Flag registry — the single naming office for every flag-like name the
 * generation pipeline mints or classifies (audit item 2, 2026-07-03).
 *
 * Before this existed, flag names were minted ad-hoc by agents and classified
 * by prefix-sniffing spread across four files (callbackLedger.isStructuralFlag,
 * flagVocabulary.isRuntimeFlag, residueObligations.isExcludedResidueFlag,
 * promiseLedgerValidators.isNonLedgerRef), each with its own slightly
 * different pattern list. This module is now the one home for:
 *
 *  1. KIND CLASSIFICATION — `inferFlagKind()` is the single pattern table;
 *     registered names take precedence over inference, so a name minted
 *     through the registry never depends on its spelling to be classified.
 *  2. DETERMINISTIC MINTING — encounter-outcome, treatment-seed, branch-axis
 *     and route names are created (and simultaneously registered) here, so a
 *     misspelling can never enter the data at the source.
 *  3. SETTER BOOKKEEPING — assembly registers every authored setFlag so
 *     late-stage reconciliation (flagVocabulary) and validators can ask the
 *     registry instead of re-scanning the story.
 *
 * Generator-only (lives under src/ai-agents — the reader boundary check
 * forbids it from the reader bundle). The reader engine treats flag names as
 * opaque strings; this registry governs CREATION for new runs and never
 * renames anything already published.
 *
 * Instance management follows the storyLexicon pattern: a module-level active
 * registry with reset for tests. With nothing registered, every query falls
 * back to `inferFlagKind()` — byte-identical to the old prefix sniffers.
 */

import { encounterOutcomeFlag } from '../utils/encounterOutcomeFlags';
import { normalizeTintFlag } from '../utils/tintVocabulary';

export type FlagKind =
  /** Plain story flag set by choices/beats; trackable as a ledger promise. */
  | 'narrative'
  /** tint:* identity cosmetics — non-ledger, identity-engine vocabulary. */
  | 'tint'
  /** route_* branch path markers — structural, never cross-episode promises. */
  | 'route'
  /** treatment_branch_* ending-axis eligibility — structural. */
  | 'branch_axis'
  /** encounter_<id>_<outcome> result memory — structural, engine-adjacent. */
  | 'encounter_outcome'
  /** treatment_seed_ep<N>_<i> authored foreshadow seeds — presence obligations. */
  | 'treatment_seed'
  /** Engine/diagnostic internals (ui_, debug_, visited_, choice_seen_, _outcome_). */
  | 'runtime';

export interface RegisteredFlag {
  name: string;
  kind: FlagKind;
  /** Where the name came from, for diagnostics (e.g. 'seedEncounterOutcomeFlags', 'blueprint:ep1'). */
  source: string;
}

/**
 * THE single pattern table. Every prefix rule that used to live in a
 * per-file sniffer is here, and only here. Order matters: most specific
 * first (treatment_seed_ before the generic narrative fallback).
 */
export function inferFlagKind(name: string): FlagKind {
  if (name.startsWith('tint:')) return 'tint';
  if (name.startsWith('route_')) return 'route';
  if (name.startsWith('treatment_branch_')) return 'branch_axis';
  if (name.startsWith('treatment_seed_')) return 'treatment_seed';
  if (name.startsWith('encounter_')) return 'encounter_outcome';
  // The engine's dotted `encounter.` internals are runtime state, not outcome
  // flags (isStructuralFlag never matched them; isRuntimeFlag did — preserved
  // by keeping them in the runtime kind, which is condition-readable).
  if (/^(?:encounter\.|ui_|debug_|visited_|choice_seen_|_outcome_)/.test(name)) return 'runtime';
  return 'narrative';
}

/** Kinds the callback ledger never tracks as promises (was isStructuralFlag). */
const STRUCTURAL_KINDS: ReadonlySet<FlagKind> = new Set(['tint', 'route', 'branch_axis', 'encounter_outcome']);
/** Kinds a condition may read without an in-story setter (was flagVocabulary.isRuntimeFlag). */
const RUNTIME_READABLE_KINDS: ReadonlySet<FlagKind> = new Set(['encounter_outcome', 'route', 'runtime']);
/** Kinds excluded from residue obligations (was isExcludedResidueFlag). */
const RESIDUE_EXCLUDED_KINDS: ReadonlySet<FlagKind> = new Set([...STRUCTURAL_KINDS, 'treatment_seed']);

export class FlagRegistry {
  private byName = new Map<string, RegisteredFlag>();

  /** Idempotent registration; first registration wins on kind/source. Returns the name. */
  register(name: string, kind: FlagKind, source: string): string {
    const trimmed = name.trim();
    if (!trimmed) return name;
    if (!this.byName.has(trimmed)) {
      this.byName.set(trimmed, { name: trimmed, kind, source });
    }
    return trimmed;
  }

  isRegistered(name: string): boolean {
    return this.byName.has(name);
  }

  /** Registered kind when known, pattern inference otherwise. */
  kindOf(name: string): FlagKind {
    return this.byName.get(name)?.kind ?? inferFlagKind(name);
  }

  /** All registered names of the given kinds (e.g. narrative setters for reconciliation). */
  namesOfKind(...kinds: FlagKind[]): string[] {
    const wanted = new Set(kinds);
    return [...this.byName.values()].filter((f) => wanted.has(f.kind)).map((f) => f.name);
  }

  entries(): RegisteredFlag[] {
    return [...this.byName.values()];
  }

  // ── Deterministic minting (create + register in one step) ──

  mintEncounterOutcomeFlag(encounterId: string, outcome: string, source: string): string {
    return this.register(encounterOutcomeFlag(encounterId, outcome), 'encounter_outcome', source);
  }

  mintTreatmentSeedFlag(episodeNumber: number, index: number, source: string): string {
    return this.register(`treatment_seed_ep${episodeNumber}_${index}`, 'treatment_seed', source);
  }

  mintTintFlag(raw: string, source: string): string {
    return this.register(normalizeTintFlag(raw), 'tint', source);
  }

  registerBranchAxis(name: string, source: string): string {
    return this.register(name, 'branch_axis', source);
  }

  registerRouteFlag(name: string, source: string): string {
    return this.register(name, 'route', source);
  }

  registerNarrativeSetter(name: string, source: string): string {
    return this.register(name, 'narrative', source);
  }
}

// ── Classification predicates (the sniffers' single replacement) ──

/** Accepts a bare flag name or a `flag:`-prefixed hook id (the sniffers did). */
function bareFlagName(flagOrHookId: string): string {
  return flagOrHookId.startsWith('flag:') ? flagOrHookId.slice('flag:'.length) : flagOrHookId;
}

/** Was callbackLedger.isStructuralFlag: never a ledger promise, by design. */
export function isStructuralFlagKind(flagOrHookId: string): boolean {
  return STRUCTURAL_KINDS.has(getFlagRegistry().kindOf(bareFlagName(flagOrHookId)));
}

/** Was callbackLedger.isTintFlag: cosmetic tint, tracked only as a tone hook. */
export function isTintFlagKind(flagOrHookId: string): boolean {
  return getFlagRegistry().kindOf(bareFlagName(flagOrHookId)) === 'tint';
}

/** Was flagVocabulary.isRuntimeFlag: legitimately readable without an in-story setter. */
export function isRuntimeReadableFlag(name: string): boolean {
  return RUNTIME_READABLE_KINDS.has(getFlagRegistry().kindOf(name));
}

/** Was residueObligations.isExcludedResidueFlag: outside residue-obligation scope. */
export function isResidueExcludedFlag(name: string): boolean {
  return RESIDUE_EXCLUDED_KINDS.has(getFlagRegistry().kindOf(name));
}

// ── Active-instance management (storyLexicon pattern) ──

let activeRegistry = new FlagRegistry();

export function getFlagRegistry(): FlagRegistry {
  return activeRegistry;
}

export function setFlagRegistry(registry: FlagRegistry): void {
  activeRegistry = registry;
}

/** Fresh registry for a new run or test. Returns it for convenience. */
export function resetFlagRegistry(): FlagRegistry {
  activeRegistry = new FlagRegistry();
  return activeRegistry;
}
