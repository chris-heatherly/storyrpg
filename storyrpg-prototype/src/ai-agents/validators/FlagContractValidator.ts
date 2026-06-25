/**
 * Flag setter/consumer contract (G12).
 *
 * The g12 audit found the residue economy ~1/3 functional: 5 conditions read flags
 * that NOTHING ever sets (`blog_post_timing` — ep1's finale sets booleans
 * `blog_post_published_midnight`/`blog_post_held_overnight`, ep3's three authored
 * variants read a 3-value string flag that doesn't exist; `stela_warned_at_bookshop`
 * and `writing_glasses_worn` as statCheck modifiers whose bonuses can never trigger;
 * `kylie_logs_observations` a near-miss of the real `kylie_logs_for_now`), and 77 of
 * 110 set flags were write-only. A condition keyed on an unset flag is authored
 * content that can never render — silent loss of the player's choice.
 *
 * Deterministic, no LLM: deep-walks the story once collecting every setFlag-style
 * setter and every flag-condition consumer, then reports consumers with no setter
 * (with a nearest-setter suggestion for the near-miss class). Write-only flags are
 * summarized as one advisory metric (cross-episode payoff windows make per-flag
 * warnings too noisy).
 */

import type { Story } from '../../types';
import { BaseValidator, type ValidationIssue, type ValidationResult } from './BaseValidator';
import type { SerializedCallbackLedger } from '../pipeline/callbackLedger';
import type { SeasonResidueObligation } from '../../types/seasonPlan';
import {
  classifyLedgerFlag,
  classifyPlannedFlag,
} from '../pipeline/choiceMemoryDebt';

export interface FlagContractInput {
  story: Story;
  /** Extra flags known to be set at runtime outside the story data (engine namespaces). */
  runtimeSetFlagPatterns?: RegExp[];
  /** Optional callback ledger so write-only flags can be split from future-window hooks. */
  callbackLedger?: SerializedCallbackLedger;
  /** Highest generated episode number in the current slice/season. Defaults to the story max. */
  generatedThroughEpisode?: number;
  seasonResiduePlan?: SeasonResidueObligation[];
}

/** Engine-set namespaces a story condition may legitimately read without an in-story setter. */
const DEFAULT_RUNTIME_PATTERNS: RegExp[] = [
  /^encounter\./,                                      // engine memory flags (dot notation)
  /^encounter_.+_(victory|partialVictory|defeat|escape)$/, // seeded outcome flags (backstop; seeding adds real setters)
  /^route_/,                                           // route flags folded at assembly
  /^_outcome_/,                                        // stat-check outcome variant selectors, resolved by the engine
];

interface FlagRef {
  flag: string;
  location: string;
}

function levenshtein(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > 6) return 99;
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...new Array(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
  }
  return dp[a.length][b.length];
}

/** Shared-token similarity for snake_case flag names (near-miss suggestions). */
export function nearestSetter(flag: string, setters: Set<string>): string | undefined {
  let best: string | undefined;
  let bestScore = -Infinity;
  const flagTokens = new Set(flag.split(/[_:.]/).filter(Boolean));
  for (const s of setters) {
    const sTokens = s.split(/[_:.]/).filter(Boolean);
    const shared = sTokens.filter((t) => flagTokens.has(t)).length;
    // Rank by shared snake_case tokens first (the real near-miss signal:
    // kylie_logs_observations → kylie_logs_for_now), edit distance as tiebreak.
    const score = shared * 10 - levenshtein(flag, s);
    if (score > bestScore) {
      bestScore = score;
      best = s;
    }
  }
  if (best === undefined) return undefined;
  const sharedBest = best.split(/[_:.]/).filter((t) => flagTokens.has(t)).length;
  return sharedBest >= 2 || levenshtein(flag, best) <= 3 ? best : undefined;
}

export interface FlagContractMetrics {
  settersTotal: number;
  consumersTotal: number;
  readWithoutSetFlags: number;
  unsetConditionFlags: number;
  terminalWriteOnlyFlags: number;
  crossSliceWriteOnlyFlags: number;
  futureWindowFlags: number;
  resolvedLedgerFlags: number;
  writeOnlyFlags: number;
  plannedPaidFlags: number;
  plannedDueMissingFlags: number;
  plannedFutureWindowFlags: number;
  plannedTerminalSliceOkFlags: number;
  unplannedOrphanFlags: number;
}

function generatedThroughEpisode(story: Story, override?: number): number {
  if (typeof override === 'number' && Number.isFinite(override)) return override;
  const numbers = (story.episodes || [])
    .map((episode) => episode.number)
    .filter((n): n is number => typeof n === 'number' && Number.isFinite(n));
  return numbers.length > 0 ? Math.max(...numbers) : 0;
}

export class FlagContractValidator extends BaseValidator {
  constructor() {
    super('FlagContractValidator');
  }

  validate(input: FlagContractInput): ValidationResult & { metrics: FlagContractMetrics } {
    const runtimePatterns = [...DEFAULT_RUNTIME_PATTERNS, ...(input.runtimeSetFlagPatterns || [])];
    const generatedThrough = generatedThroughEpisode(input.story, input.generatedThroughEpisode);
    const setters = new Map<string, FlagRef[]>();
    const consumers = new Map<string, FlagRef[]>();

    const note = (map: Map<string, FlagRef[]>, flag: string, location: string): void => {
      if (!flag || typeof flag !== 'string') return;
      const list = map.get(flag) || [];
      list.push({ flag, location });
      map.set(flag, list);
    };

    // Keys that introduce a CONSEQUENCE (side-effect) subtree vs a CONDITION (read)
    // subtree. `type:'flag'` is ambiguous: in a condition it READS a flag, but inside an
    // onShow/onSelect consequence list it SETS one. bite-me-g16 authored onShow flag-sets
    // using the condition form `{type:'flag', value:true}` (a runtime no-op the assembly
    // pass now rewrites to setFlag); classifying by context keeps the validator accurate on
    // un-normalized data too, so it reports a write-only residue flag, not a dead condition.
    const CONSEQUENCE_KEYS = new Set([
      'onShow', 'onSelect', 'onEnter', 'onExit', 'consequences', 'effects', 'onSuccess', 'onFailure', 'results',
    ]);
    const CONDITION_KEYS = new Set(['condition', 'conditions', 'requires', 'showIf', 'displayCondition', 'modifiers']);

    // One deep walk per scene so findings carry a scene-level location.
    const walk = (node: unknown, location: string, seen: Set<object>, inConsequence: boolean): void => {
      if (!node || typeof node !== 'object' || seen.has(node)) return;
      seen.add(node as object);
      if (Array.isArray(node)) {
        for (const item of node) walk(item, location, seen, inConsequence);
        return;
      }
      const obj = node as Record<string, unknown>;

      if (obj.type === 'setFlag' && typeof obj.flag === 'string') {
        note(setters, obj.flag, location);
      }
      if (obj.type === 'flag' && typeof obj.flag === 'string') {
        // Setter inside a consequence list; reader otherwise (condition / text-variant gate).
        note(inConsequence ? setters : consumers, obj.flag, location);
      }
      // Storylet `setsFlags: [{ flag, value }]`
      if (Array.isArray(obj.setsFlags)) {
        for (const sf of obj.setsFlags) {
          const f = (sf as { flag?: unknown })?.flag;
          if (typeof f === 'string') note(setters, f, location);
        }
      }
      for (const [key, value] of Object.entries(obj)) {
        // Bare-string condition = flag name (engine: player.flags[condition] === true).
        if (key === 'condition' && typeof value === 'string') {
          note(consumers, value, location);
        } else if (value && typeof value === 'object') {
          const childInConsequence = CONSEQUENCE_KEYS.has(key)
            ? true
            : CONDITION_KEYS.has(key)
              ? false
              : inConsequence;
          walk(value, location, seen, childInConsequence);
        }
      }
    };

    for (const episode of input.story.episodes || []) {
      for (const scene of episode.scenes || []) {
        walk(scene, `ep${episode.number}/${scene.id}`, new Set(), false);
      }
    }

    const issues: ValidationIssue[] = [];
    const setterNames = new Set(setters.keys());
    const terminalSceneIds = new Set(
      (input.story.episodes || [])
        .filter((episode) => episode.number === generatedThrough)
        .flatMap((episode) => {
          const scenes = episode.scenes || [];
          const terminal = scenes[scenes.length - 1];
          return terminal?.id ? [`ep${episode.number}/${terminal.id}`] : [];
        }),
    );

    let unsetCount = 0;
    for (const [flag, refs] of consumers) {
      if (setterNames.has(flag)) continue;
      if (runtimePatterns.some((re) => re.test(flag))) continue;
      unsetCount += 1;
      const near = nearestSetter(flag, setterNames);
      issues.push(this.error(
        `Condition reads flag "${flag}" which nothing ever sets (${refs.length} reference(s), e.g. ${refs[0].location}) — the conditioned content can never render.`,
        refs[0].location,
        near
          ? `Did the author mean "${near}"? Align the condition with the real setter, or add the setter.`
          : 'Add a setter for this flag or remove the dead condition.',
      ));
    }

    // Write-only summary (advisory): exclude plumbing namespaces that are consumed
    // out-of-band (tints → identity engine, treatment branch markers, ledger hooks).
    let futureWindowFlags = 0;
    let resolvedLedgerFlags = 0;
    let terminalWriteOnlyFlags = 0;
    let plannedPaidFlags = 0;
    let plannedDueMissingFlags = 0;
    let plannedFutureWindowFlags = 0;
    let plannedTerminalSliceOkFlags = 0;
    let unplannedOrphanFlags = 0;
    const writeOnly = [...setters.keys()].filter((f) => {
      if (consumers.has(f)) return false;
      if (f.startsWith('tint:') || f.startsWith('route_') || f.startsWith('treatment_') || /^encounter[_.]/.test(f)) return false;
      const ledgerClass = classifyLedgerFlag(f, input.callbackLedger, generatedThrough);
      if (ledgerClass === 'future-window') {
        futureWindowFlags += 1;
        return false;
      }
      if (ledgerClass === 'resolved-or-abandoned') {
        resolvedLedgerFlags += 1;
        return false;
      }
      const plannedClass = classifyPlannedFlag(f, input.seasonResiduePlan, new Set(consumers.keys()), generatedThrough);
      if (plannedClass === 'planned_paid') {
        plannedPaidFlags += 1;
        return false;
      }
      if (plannedClass === 'future_window') {
        plannedFutureWindowFlags += 1;
        return false;
      }
      if (plannedClass === 'terminal_slice_ok') {
        plannedTerminalSliceOkFlags += 1;
        return false;
      }
      if (plannedClass === 'planned_due_missing') {
        plannedDueMissingFlags += 1;
        return true;
      }
      unplannedOrphanFlags += 1;
      const refs = setters.get(f) ?? [];
      if (refs.some((ref) => terminalSceneIds.has(ref.location))) {
        terminalWriteOnlyFlags += 1;
        return false;
      }
      return true;
    });
    if (writeOnly.length > 0) {
      issues.push(this.warning(
        `${writeOnly.length} player-choice flag(s) are set but never read by any condition in the generated range ` +
        `(e.g. ${writeOnly.slice(0, 5).join(', ')}). Ledger-qualified future-window hooks are counted separately; these are true orphan flags the story silently forgets.`,
        'story',
        'Condition later prose on the decisions that matter, or drop the dead flags.',
      ));
    }

    const errors = issues.filter((i) => i.severity === 'error').length;
    return {
      valid: errors === 0,
      score: Math.max(0, 100 - errors * 10 - (issues.length - errors) * 2),
      issues,
      suggestions: issues.map((i) => i.suggestion).filter((s): s is string => Boolean(s)),
      metrics: {
        settersTotal: setters.size,
        consumersTotal: consumers.size,
        readWithoutSetFlags: unsetCount,
        unsetConditionFlags: unsetCount,
        terminalWriteOnlyFlags,
        crossSliceWriteOnlyFlags: futureWindowFlags,
        futureWindowFlags,
        resolvedLedgerFlags,
        writeOnlyFlags: writeOnly.length,
        plannedPaidFlags,
        plannedDueMissingFlags,
        plannedFutureWindowFlags,
        plannedTerminalSliceOkFlags,
        unplannedOrphanFlags,
      },
    };
  }
}
