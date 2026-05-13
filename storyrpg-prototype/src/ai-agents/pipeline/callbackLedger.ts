// ========================================
// CALLBACK LEDGER
// ========================================
//
// Tracks "memorable moments" across episodes so later episodes can author
// TextVariants that reference earlier choices. Implements the Witcher-style
// delayed-consequence pattern described in docs/PLAN_DELAYED_CONSEQUENCES.md.
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
import type { TextVariant } from '../../types/content';

export interface CallbackHook {
  id: string;
  sourceEpisode: number;
  sourceSceneId: string;
  sourceChoiceId: string;
  flags: string[];
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
  add(hook: Omit<CallbackHook, 'payoffCount' | 'resolved' | 'createdAt'> & {
    payoffCount?: number;
    resolved?: boolean;
    createdAt?: string;
  }): CallbackHook {
    const existing = this.hooks.get(hook.id);
    const merged: CallbackHook = {
      ...hook,
      payoffCount: existing?.payoffCount ?? hook.payoffCount ?? 0,
      resolved: existing?.resolved ?? hook.resolved ?? false,
      createdAt: existing?.createdAt ?? hook.createdAt ?? new Date().toISOString(),
      flags: Array.from(new Set([...(existing?.flags ?? []), ...hook.flags])),
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
      summary: moment.summary,
      payoffWindow: {
        minEpisode: params.episode + 1,
        maxEpisode: params.episode + this.config.defaultWindowSpan,
      },
    });
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
      ledger.hooks.set(hook.id, { ...hook });
    }
    return ledger;
  }
}
