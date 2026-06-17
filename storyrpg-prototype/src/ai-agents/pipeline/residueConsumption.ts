import type { Story } from '../../types';
import type { TextVariant } from '../../types/content';
import { isStructuralFlag } from './callbackLedger';
import { buildCallbackCondition, deriveChoiceAcknowledgment } from './callbackOrchestration';

/**
 * WS0.2 — residue-consume contract (season-final, whole-story).
 *
 * Player-choice flags are SET by choices/onShow but ~80% are never READ by any condition
 * (g17: 49 write-only flags) — so the season's biggest decisions leave no trace. The
 * per-episode `injectFallbackCallbacks` only realizes ledger HOOKS (choice-harvested,
 * trackable flags) and is capped at 2/scene, so flags set via onShow/encounter prose, or
 * starved by the cap, or set in the last scene, stay dead. This pass generalizes that into a
 * contract over the assembled Story: every consequential set-flag with no reader gets a
 * flag-gated TextVariant appended to a downstream beat (in-fiction acknowledgment), driving
 * the validator's write-only count toward 0.
 *
 * Deterministic + idempotent + golden-parity when every consequential flag is already read.
 * The set/read classification mirrors FlagContractValidator exactly (same SETTER/CONDITION
 * key sets and excluded plumbing namespaces) so what this injects precisely clears what that
 * validator counts as write-only residue. The LLM-authored read upgrade (richer, scene-
 * specific prose) is a follow-up (WS0.2b) that rides the Phase 2 golden regen; the
 * deterministic acknowledgment here guarantees consumption without a live run.
 */

const RESIDUE_REMINDER_TAG = 'auto-residue';

// Mirror FlagContractValidator: `type:'flag'` SETS inside a consequence subtree, READS inside
// a condition subtree.
const CONSEQUENCE_KEYS = new Set([
  'onShow', 'onSelect', 'onEnter', 'onExit', 'consequences', 'effects', 'onSuccess', 'onFailure', 'results',
]);
const CONDITION_KEYS = new Set(['condition', 'conditions', 'requires', 'showIf', 'displayCondition', 'modifiers']);

/** Plumbing namespaces consumed out-of-band — excluded from the residue contract (matches the validator). */
function isExcludedNamespace(flag: string): boolean {
  return (
    flag.startsWith('tint:') ||
    flag.startsWith('route_') ||
    flag.startsWith('treatment_') ||
    /^encounter[_.]/.test(flag)
  );
}

function isConsequentialFlag(flag: string): boolean {
  return Boolean(flag) && !isExcludedNamespace(flag) && !isStructuralFlag(flag);
}

interface SetSite {
  epIdx: number;
  scIdx: number;
}

interface FlagAnalysis {
  setSites: Map<string, SetSite>;
  consumers: Set<string>;
}

function analyzeStory(story: Story): FlagAnalysis {
  const setSites = new Map<string, SetSite>();
  const consumers = new Set<string>();
  const noteSet = (flag: string, epIdx: number, scIdx: number): void => {
    if (!isConsequentialFlag(flag)) return;
    if (!setSites.has(flag)) setSites.set(flag, { epIdx, scIdx });
  };
  const walk = (node: unknown, epIdx: number, scIdx: number, seen: Set<object>, inConsequence: boolean): void => {
    if (!node || typeof node !== 'object' || seen.has(node)) return;
    seen.add(node as object);
    if (Array.isArray(node)) {
      for (const item of node) walk(item, epIdx, scIdx, seen, inConsequence);
      return;
    }
    const obj = node as Record<string, unknown>;
    if (obj.type === 'setFlag' && typeof obj.flag === 'string') noteSet(obj.flag, epIdx, scIdx);
    if (obj.type === 'flag' && typeof obj.flag === 'string') {
      if (inConsequence) noteSet(obj.flag, epIdx, scIdx);
      else consumers.add(obj.flag);
    }
    if (Array.isArray(obj.setsFlags)) {
      for (const sf of obj.setsFlags) {
        const f = (sf as { flag?: unknown })?.flag;
        if (typeof f === 'string') noteSet(f, epIdx, scIdx);
      }
    }
    for (const [key, value] of Object.entries(obj)) {
      if (key === 'condition' && typeof value === 'string') {
        consumers.add(value);
      } else if (value && typeof value === 'object') {
        const childInConsequence = CONSEQUENCE_KEYS.has(key)
          ? true
          : CONDITION_KEYS.has(key)
            ? false
            : inConsequence;
        walk(value, epIdx, scIdx, seen, childInConsequence);
      }
    }
  };
  (story.episodes || []).forEach((ep, epIdx) =>
    (ep.scenes || []).forEach((sc, scIdx) => walk(sc, epIdx, scIdx, new Set(), false)),
  );
  return { setSites, consumers };
}

export interface ResidueDebt {
  flag: string;
  epIdx: number;
  scIdx: number;
}

/** Consequential flags that are SET but never READ — the residue the story silently forgets. */
export function planResidueConsumption(story: Story): ResidueDebt[] {
  const { setSites, consumers } = analyzeStory(story);
  const debts: ResidueDebt[] = [];
  for (const [flag, site] of setSites) {
    if (!consumers.has(flag)) debts.push({ flag, epIdx: site.epIdx, scIdx: site.scIdx });
  }
  return debts;
}

export interface ResidueConsumeResult {
  injected: number;
  residual: string[];
}

interface PlacementState {
  usedPerBeat: Map<string, number>;
  usedPerScene: Map<string, number>;
  maxPerBeat: number;
  maxPerScene: number;
}

function tryPlace(story: Story, debt: ResidueDebt, st: PlacementState, sameSceneAllowed: boolean): boolean {
  const episodes = story.episodes || [];
  for (let e = debt.epIdx; e < episodes.length; e++) {
    const scenes = episodes[e].scenes || [];
    for (let s = 0; s < scenes.length; s++) {
      const isLater = e > debt.epIdx || s > debt.scIdx;
      const isSame = e === debt.epIdx && s === debt.scIdx;
      if (!isLater && !(sameSceneAllowed && isSame)) continue;
      const scKey = `${e}:${s}`;
      if ((st.usedPerScene.get(scKey) ?? 0) >= st.maxPerScene) continue;
      for (const beat of scenes[s].beats || []) {
        const beatId = beat.id || '';
        if (!beatId) continue;
        if ((st.usedPerBeat.get(beatId) ?? 0) >= st.maxPerBeat) continue;
        // A matching TextVariant REPLACES the beat's base text at runtime, so compose
        // base prose + acknowledgment rather than overwrite the beat (G12 lesson).
        const base = typeof beat.text === 'string' ? beat.text.trim() : '';
        const ack = deriveChoiceAcknowledgment(debt.flag);
        const variant: TextVariant = {
          condition: buildCallbackCondition(debt.flag),
          text: base ? `${base}\n\n${ack}` : ack,
          reminderTag: RESIDUE_REMINDER_TAG,
        };
        const b = beat as { textVariants?: TextVariant[] };
        b.textVariants = [...(b.textVariants || []), variant];
        st.usedPerBeat.set(beatId, (st.usedPerBeat.get(beatId) ?? 0) + 1);
        st.usedPerScene.set(scKey, (st.usedPerScene.get(scKey) ?? 0) + 1);
        return true;
      }
    }
  }
  return false;
}

/**
 * In-place: append a flag-gated acknowledgment TextVariant to a downstream beat for every
 * consequential set-flag no condition reads. Two-pass placement — strictly-later scenes
 * first, then a same-scene fallback for flags set in the last scene — so coverage is maximal.
 * Returns the injected count and any flag that had no eligible beat (true residual).
 */
export function applyResidueConsumption(
  story: Story,
  opts: { maxPerBeat?: number; maxPerScene?: number } = {},
): ResidueConsumeResult {
  // Place latest-set flags FIRST: a flag set in the last scene has the fewest downstream
  // beats, so it must claim them before an early-episode flag (which has the whole rest of
  // the season to land in) consumes them. This clears the residue at one ack per beat
  // without stacking multiple acknowledgments on a single beat.
  const debts = planResidueConsumption(story).sort(
    (a, b) => b.epIdx - a.epIdx || b.scIdx - a.scIdx,
  );
  if (!debts.length) return { injected: 0, residual: [] };
  const st: PlacementState = {
    usedPerBeat: new Map(),
    usedPerScene: new Map(),
    maxPerBeat: opts.maxPerBeat ?? 1,
    maxPerScene: opts.maxPerScene ?? 99,
  };
  // Seed the placement budget from auto-residue variants already injected by a prior run, so
  // re-running the pass is idempotent (no stacking, residual stays residual).
  (story.episodes || []).forEach((ep, e) =>
    (ep.scenes || []).forEach((sc, s) => {
      for (const beat of sc.beats || []) {
        const existing = (beat as { textVariants?: TextVariant[] }).textVariants || [];
        const n = existing.filter((v) => v.reminderTag === RESIDUE_REMINDER_TAG).length;
        if (n > 0) {
          st.usedPerBeat.set(beat.id || '', n);
          st.usedPerScene.set(`${e}:${s}`, (st.usedPerScene.get(`${e}:${s}`) ?? 0) + n);
        }
      }
    }),
  );
  let injected = 0;
  const residual: string[] = [];
  for (const debt of debts) {
    // Prefer a strictly-later scene; fall back to the same scene (last-scene flags). Done
    // per-debt — combined with the reverse sort, a last-scene flag claims its scarce
    // same-scene beat before an early flag's strictly-later search could consume it.
    if (tryPlace(story, debt, st, false) || tryPlace(story, debt, st, true)) injected += 1;
    else residual.push(debt.flag);
  }
  return { injected, residual };
}
