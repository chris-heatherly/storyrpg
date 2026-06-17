import type { Story } from '../../types';
import { nearestSetter } from '../validators/FlagContractValidator';

/**
 * WS1.1 — flag-vocabulary reconciliation. The SET side (ChoiceAuthor consequences) and the
 * READ side (SceneWriter conditions / textVariants) are authored independently with no shared
 * vocabulary, so a condition can read a flag that nothing sets — dead content that can never
 * render. g17: a variant in s3-2 reads `accepted_victor_invitation` but the setter writes
 * `received_victor_invitation`. This deterministic pass rewrites a dead-condition flag to its
 * nearest real setter (tight shared-token / edit-distance threshold via FlagContractValidator's
 * `nearestSetter`), so the authored content renders instead of dying silently — and lowers the
 * false-positive surface that keeps GATE_FLAG_CONTRACT from being promotable.
 *
 * Deterministic + idempotent + golden-parity when every condition already has a setter.
 */

// Same classification as FlagContractValidator: `type:'flag'` SETS in a consequence subtree,
// READS in a condition subtree.
const CONSEQUENCE_KEYS = new Set([
  'onShow', 'onSelect', 'onEnter', 'onExit', 'consequences', 'effects', 'onSuccess', 'onFailure', 'results',
]);
const CONDITION_KEYS = new Set(['condition', 'conditions', 'requires', 'showIf', 'displayCondition', 'modifiers']);

/** Rewrite the flag this condition reads, in place, to the resolved setter name. */
type FlagRewrite = (target: string) => void;

interface FlagScan {
  setterNames: Set<string>;
  /** flag name → rewrite thunks for every condition reading it. */
  readSites: Map<string, FlagRewrite[]>;
}

function scan(story: Story): FlagScan {
  const setterNames = new Set<string>();
  const readSites = new Map<string, FlagRewrite[]>();
  const noteRead = (flag: string, rewrite: FlagRewrite): void => {
    const list = readSites.get(flag) || [];
    list.push(rewrite);
    readSites.set(flag, list);
  };
  const walk = (node: unknown, seen: Set<object>, inConsequence: boolean): void => {
    if (!node || typeof node !== 'object' || seen.has(node)) return;
    seen.add(node as object);
    if (Array.isArray(node)) {
      for (const item of node) walk(item, seen, inConsequence);
      return;
    }
    const obj = node as Record<string, unknown>;
    if (obj.type === 'setFlag' && typeof obj.flag === 'string') setterNames.add(obj.flag);
    if (obj.type === 'flag' && typeof obj.flag === 'string') {
      if (inConsequence) setterNames.add(obj.flag);
      else noteRead(obj.flag, (target) => { obj.flag = target; });
    }
    if (Array.isArray(obj.setsFlags)) {
      for (const sf of obj.setsFlags) {
        const f = (sf as { flag?: unknown })?.flag;
        if (typeof f === 'string') setterNames.add(f);
      }
    }
    for (const [key, value] of Object.entries(obj)) {
      if (key === 'condition' && typeof value === 'string') {
        noteRead(value, (target) => { obj[key] = target; });
      } else if (value && typeof value === 'object') {
        const childInConsequence = CONSEQUENCE_KEYS.has(key)
          ? true
          : CONDITION_KEYS.has(key)
            ? false
            : inConsequence;
        walk(value, seen, childInConsequence);
      }
    }
  };
  for (const episode of story.episodes || []) {
    for (const scene of episode.scenes || []) walk(scene, new Set(), false);
  }
  return { setterNames, readSites };
}

/** Engine namespaces a condition may legitimately read without an in-story setter. */
function isRuntimeFlag(flag: string): boolean {
  return (
    /^encounter[_.]/.test(flag) ||
    flag.startsWith('route_') ||
    flag.startsWith('_outcome_')
  );
}

export interface FlagReconcileResult {
  reconciled: Array<{ from: string; to: string }>;
  unresolved: string[];
}

/**
 * Rewrite every dead-condition flag (read, never set) to its nearest real setter, in place.
 * Returns the reconciled (from→to) pairs and the flags with no near setter (true dead conditions
 * the GATE_FLAG_CONTRACT error still surfaces). The rewrite thunks recompute the actual setter
 * per flag (the `__REWRITE__` sentinel in {@link scan} is replaced here with the resolved name).
 */
export function reconcileFlagVocabulary(story: Story): FlagReconcileResult {
  const { setterNames, readSites } = scan(story);
  const reconciled: Array<{ from: string; to: string }> = [];
  const unresolved: string[] = [];
  for (const [flag, rewrites] of readSites) {
    if (setterNames.has(flag) || isRuntimeFlag(flag)) continue;
    const target = nearestSetter(flag, setterNames);
    if (!target) {
      unresolved.push(flag);
      continue;
    }
    for (const rewrite of rewrites) rewrite(target);
    reconciled.push({ from: flag, to: target });
  }
  return { reconciled, unresolved };
}
