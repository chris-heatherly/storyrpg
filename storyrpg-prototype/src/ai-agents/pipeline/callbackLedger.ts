// ========================================
// CALLBACK LEDGER
// ========================================
//
// Tracks "memorable moments" across episodes so later episodes can author
// TextVariants that reference earlier choices. Implements the Witcher-style
// delayed-consequence pattern.
//
// Shape:
//   - ChoiceAuthor / authors tag notable choices with a `memorableMoment`.
//   - FullStoryPipeline harvests those into the ledger at end of each episode.
//   - Before generating episode N+1, the ledger's unresolved hooks are injected
//     into SceneWriter / ChoiceAuthor prompts.
//   - When a SceneWriter emits a TextVariant with `callbackHookId`, the
//     pipeline records a payoff.
//   - A hook is `resolved` once its payoffCount exceeds a threshold (default 2).
//
// The ledger is pure data + pure transforms; I/O (read/write) is handled by
// FullStoryPipeline using the existing pipelineOutputWriter helpers.

import type { Choice } from '../../types/choice';
import type { ChoiceConsequenceTier, ChoiceImpactFactor } from '../../types/choice';
import type { TextVariant } from '../../types/content';

export interface CallbackHook {
  id: string;
  sourceEpisode: number;
  sourceSceneId: string;
  sourceChoiceId: string;
  flags: string[];
  conditionKeys?: string[];
  impactFactors?: ChoiceImpactFactor[];
  consequenceTier?: ChoiceConsequenceTier;
  summary: string;
  payoffWindow: { minEpisode: number; maxEpisode: number };
  payoffCount: number;
  resolved: boolean;
  createdAt: string;
}

export interface LedgerConfig {
  // Number of distinct payoff references before a hook is marked resolved.
  payoffThreshold: number;
  // Default window (in episodes) during which hooks are eligible for payoff.
  defaultWindowSpan: number;
  // Cap on active (unresolved) hooks kept in prompts. Oldest get retired first.
  maxActiveHooks: number;
}

type CallbackHookInput = Omit<
  CallbackHook,
  'payoffCount' | 'resolved' | 'createdAt' | 'conditionKeys' | 'impactFactors' | 'consequenceTier'
> & {
  conditionKeys?: string[];
  impactFactors?: ChoiceImpactFactor[];
  consequenceTier?: ChoiceConsequenceTier;
  payoffCount?: number;
  resolved?: boolean;
  createdAt?: string;
};

export const DEFAULT_LEDGER_CONFIG: LedgerConfig = {
  payoffThreshold: 2,
  defaultWindowSpan: 3,
  maxActiveHooks: 10,
};

export interface SerializedCallbackLedger {
  version: 1;
  storyId?: string;
  hooks: CallbackHook[];
  config: LedgerConfig;
}

export class CallbackLedger {
  private hooks = new Map<string, CallbackHook>();
  private config: LedgerConfig;
  private storyId?: string;

  constructor(options?: { storyId?: string; config?: Partial<LedgerConfig> }) {
    this.storyId = options?.storyId;
    this.config = { ...DEFAULT_LEDGER_CONFIG, ...(options?.config ?? {}) };
  }

  /**
   * Add a new hook. If an id already exists, updates flags/summary but
   * preserves payoff state and createdAt.
   */
  add(hook: CallbackHookInput): CallbackHook {
    const existing = this.hooks.get(hook.id);
    const merged: CallbackHook = {
      ...hook,
      payoffCount: existing?.payoffCount ?? hook.payoffCount ?? 0,
      resolved: existing?.resolved ?? hook.resolved ?? false,
      createdAt: existing?.createdAt ?? hook.createdAt ?? new Date().toISOString(),
      flags: Array.from(new Set([...(existing?.flags ?? []), ...hook.flags])),
      conditionKeys: Array.from(new Set([
        ...(existing?.conditionKeys ?? []),
        ...(hook.conditionKeys ?? []),
        ...hook.flags,
      ])),
      impactFactors: hook.impactFactors ?? existing?.impactFactors ?? [],
      consequenceTier: hook.consequenceTier ?? existing?.consequenceTier ?? 'callback',
    };
    this.hooks.set(hook.id, merged);
    return merged;
  }

  /**
   * Register a choice's memorableMoment as a callback hook. Returns the hook
   * if one was created (or undefined when the choice had no memorableMoment).
   */
  recordChoice(params: {
    choice: Choice;
    episode: number;
    sceneId: string;
  }): CallbackHook | undefined {
    const moment = params.choice.memorableMoment;
    if (!moment?.id || !moment?.summary) return undefined;

    return this.add({
      id: moment.id,
      sourceEpisode: params.episode,
      sourceSceneId: params.sceneId,
      sourceChoiceId: params.choice.id,
      flags: moment.flags ?? this.inferFlagsFromChoice(params.choice),
      conditionKeys: moment.flags ?? this.inferFlagsFromChoice(params.choice),
      impactFactors: params.choice.impactFactors ?? [],
      consequenceTier: params.choice.consequenceTier ?? this.inferConsequenceTier(params.choice),
      summary: moment.summary,
      payoffWindow: {
        minEpisode: params.episode + 1,
        maxEpisode: params.episode + this.config.defaultWindowSpan,
      },
    });
  }

  /**
   * Seed a lightweight callback hook for a single trackable flag a choice sets
   * (1.1). Unlike `recordChoice` — which only seeds `memorableMoment`-tagged
   * choices — this brings ordinary `setFlag` consequences into the ledger so
   * they enter the inject -> payoff loop and stop shipping as unread debt.
   *
   * Cosmetic (`tint:`) and structural (`route_`) flags are skipped, as are
   * flag clears. Returns the hook, or undefined when the flag isn't trackable.
   * The hook id is keyed on the flag so repeated sets of the same flag merge.
   */
  recordFlagSet(params: {
    choice: Choice;
    flag: string;
    episode: number;
    sceneId: string;
  }): CallbackHook | undefined {
    const { flag } = params;
    if (!flag || flag.startsWith('tint:') || flag.startsWith('route_')) return undefined;
    const summary = params.choice.memorableMoment?.summary
      || (params.choice.text ? `Earlier choice: "${params.choice.text}" (sets ${flag}).` : `An earlier choice set ${flag}.`);
    return this.add({
      id: `flag:${flag}`,
      sourceEpisode: params.episode,
      sourceSceneId: params.sceneId,
      sourceChoiceId: params.choice.id,
      flags: [flag],
      conditionKeys: [flag],
      impactFactors: params.choice.impactFactors ?? [],
      consequenceTier: 'callback',
      summary,
      payoffWindow: {
        // Eligible from the setting episode onward (same-episode payoff allowed).
        minEpisode: params.episode,
        maxEpisode: params.episode + this.config.defaultWindowSpan,
      },
    });
  }

  /**
   * Trackable flags a choice sets: `setFlag` consequences that are neither
   * cosmetic (`tint:`) nor structural (`route_`), and that set rather than
   * clear the flag. Mirrors ChoiceAuthor.setsTrackableFlag.
   */
  trackableFlagsOf(choice: Choice): string[] {
    const flags: string[] = [];
    for (const consequence of choice.consequences ?? []) {
      if (
        consequence.type === 'setFlag' &&
        typeof consequence.flag === 'string' &&
        !consequence.flag.startsWith('tint:') &&
        !consequence.flag.startsWith('route_') &&
        consequence.value !== false
      ) {
        flags.push(consequence.flag);
      }
    }
    return flags;
  }

  private inferConsequenceTier(choice: Choice): ChoiceConsequenceTier {
    if (choice.nextSceneId) return 'branchlet';
    if (choice.tintFlag) return 'sceneTint';
    if (choice.choiceType === 'expression' || choice.choiceIntent === 'flavor') return 'callback';
    if ((choice.consequences ?? []).some((c) => c.type === 'addItem' || c.type === 'removeItem' || c.type === 'setScore')) {
      return 'branchlet';
    }
    return 'callback';
  }

  /**
   * Best-effort flag inference: if no flags were declared on the
   * memorableMoment, pull them from the choice's `setFlag` consequences.
   */
  private inferFlagsFromChoice(choice: Choice): string[] {
    const flags: string[] = [];
    for (const consequence of choice.consequences ?? []) {
      if (consequence.type === 'setFlag' && typeof consequence.flag === 'string') {
        flags.push(consequence.flag);
      }
    }
    return flags;
  }

  /**
   * Record that a hook was referenced by a TextVariant (or similar payoff).
   * Auto-resolves when payoffCount >= payoffThreshold.
   */
  recordPayoff(hookId: string): CallbackHook | undefined {
    const hook = this.hooks.get(hookId);
    if (!hook) return undefined;
    hook.payoffCount += 1;
    if (hook.payoffCount >= this.config.payoffThreshold) {
      hook.resolved = true;
    }
    return hook;
  }

  /**
   * Scan a set of TextVariants for callbackHookId references and record
   * a payoff for each one. Returns the list of hookIds that matched.
   */
  recordPayoffsFromVariants(variants: TextVariant[] | undefined): string[] {
    if (!variants) return [];
    const matched: string[] = [];
    for (const variant of variants) {
      if (variant.callbackHookId && this.hooks.has(variant.callbackHookId)) {
        this.recordPayoff(variant.callbackHookId);
        matched.push(variant.callbackHookId);
      }
    }
    return matched;
  }

  /**
   * Return unresolved hooks eligible for payoff in the given episode,
   * oldest first, capped at maxActiveHooks.
   */
  unresolvedFor(episode: number): CallbackHook[] {
    const eligible = Array.from(this.hooks.values()).filter(
      (hook) =>
        !hook.resolved &&
        hook.payoffWindow.minEpisode <= episode &&
        hook.payoffWindow.maxEpisode >= episode,
    );
    eligible.sort((a, b) => a.sourceEpisode - b.sourceEpisode);
    return eligible.slice(0, this.config.maxActiveHooks);
  }

  /**
   * Every hook currently tracked (resolved + unresolved). Useful for validators
   * and UI.
   */
  all(): CallbackHook[] {
    return Array.from(this.hooks.values());
  }

  size(): number {
    return this.hooks.size;
  }

  serialize(): SerializedCallbackLedger {
    return {
      version: 1,
      storyId: this.storyId,
      hooks: Array.from(this.hooks.values()),
      config: this.config,
    };
  }

  static deserialize(raw: SerializedCallbackLedger | string): CallbackLedger {
    const parsed: SerializedCallbackLedger = typeof raw === 'string' ? JSON.parse(raw) : raw;
    const ledger = new CallbackLedger({
      storyId: parsed.storyId,
      config: parsed.config,
    });
    for (const hook of parsed.hooks ?? []) {
      ledger.hooks.set(hook.id, normalizeHook(hook));
    }
    return ledger;
  }
}

function normalizeHook(hook: CallbackHook): CallbackHook {
  const flags = hook.flags ?? [];
  return {
    ...hook,
    flags,
    conditionKeys: hook.conditionKeys ?? flags,
    impactFactors: hook.impactFactors ?? [],
    consequenceTier: hook.consequenceTier ?? 'callback',
  };
}
