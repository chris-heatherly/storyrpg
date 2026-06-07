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
  /**
   * Season Canon (P2): the SPECIFIC episode this promise is meant to pay off in,
   * so it can be enforced exactly when that episode runs (the promise-due gate)
   * rather than against a vague window. Populated from the season spine (P5);
   * when set it is authoritative and `payoffWindow` is derived from it. Optional
   * for back-compat with window-only hooks.
   */
  payoffEpisode?: number;
  payoffCount: number;
  resolved: boolean;
  /**
   * Season Canon (P5): a promise intentionally dropped (e.g. its path was never
   * taken, or the spine cut it). The season-completion gate treats abandoned the
   * same as paid — it just must not be silently left open.
   */
  abandoned?: boolean;
  abandonReason?: string;
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
    // An explicit payoffEpisode (from the season spine) is authoritative: when
    // present it pins the window's start to that exact episode and is never lost
    // on a later merge that omits it.
    const payoffEpisode = hook.payoffEpisode ?? existing?.payoffEpisode;
    const payoffWindow =
      payoffEpisode != null
        ? { minEpisode: payoffEpisode, maxEpisode: Math.max(payoffEpisode, hook.payoffWindow.maxEpisode) }
        : hook.payoffWindow;
    const merged: CallbackHook = {
      ...hook,
      payoffEpisode,
      payoffWindow,
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
   * Seed a callback hook for a single score a choice moves (`setScore` /
   * `changeScore`). The mirror of {@link recordFlagSet} for the score axis: a
   * SceneWriter can emit a TextVariant keyed on `score:<name>` (e.g. a beat that
   * fires when `thorne_loyalty` is high), and without a planted promise that payoff
   * is "dangling" and trips the Season-Canon promise gate. The hook id is keyed on
   * the score (`score:<name>`) so repeated moves of the same score merge.
   */
  recordScoreSet(params: {
    choice: Choice;
    score: string;
    episode: number;
    sceneId: string;
  }): CallbackHook | undefined {
    const { score } = params;
    if (!score) return undefined;
    const summary = params.choice.memorableMoment?.summary
      || (params.choice.text ? `Earlier choice: "${params.choice.text}" (moved ${score}).` : `An earlier choice moved ${score}.`);
    return this.add({
      id: `score:${score}`,
      sourceEpisode: params.episode,
      sourceSceneId: params.sceneId,
      sourceChoiceId: params.choice.id,
      flags: [],
      conditionKeys: [`score:${score}`],
      impactFactors: params.choice.impactFactors ?? [],
      consequenceTier: 'branchlet',
      summary,
      payoffWindow: {
        minEpisode: params.episode,
        maxEpisode: params.episode + this.config.defaultWindowSpan,
      },
    });
  }

  /**
   * Trackable scores a choice moves: the score names of its `setScore` /
   * `changeScore` consequences. The score axis of {@link trackableFlagsOf}.
   */
  trackableScoresOf(choice: Choice): string[] {
    const scores: string[] = [];
    for (const consequence of choice.consequences ?? []) {
      if (
        (consequence.type === 'setScore' || consequence.type === 'changeScore') &&
        typeof (consequence as { score?: unknown }).score === 'string' &&
        (consequence as { score: string }).score.length > 0
      ) {
        scores.push((consequence as { score: string }).score);
      }
    }
    return scores;
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

  /** Whether a hook id exists (for dangling-payoff detection). */
  has(hookId: string): boolean {
    return this.hooks.has(hookId);
  }

  /**
   * Season Canon (P2): pin a hook's explicit payoff episode (from the season
   * spine). Re-derives the window so `unresolvedFor` surfaces it at the right
   * time. No-op if the hook is unknown. Returns the updated hook.
   */
  setPayoffEpisode(hookId: string, payoffEpisode: number, latestEpisode?: number): CallbackHook | undefined {
    const hook = this.hooks.get(hookId);
    if (!hook) return undefined;
    hook.payoffEpisode = payoffEpisode;
    hook.payoffWindow = {
      minEpisode: payoffEpisode,
      maxEpisode: Math.max(payoffEpisode, latestEpisode ?? hook.payoffWindow.maxEpisode),
    };
    return hook;
  }

  /**
   * Promises explicitly targeted to pay off in `episode` that are still open
   * (unresolved). The promise-due gate enforces these MUST be paid in `episode`.
   */
  dueAt(episode: number): CallbackHook[] {
    return Array.from(this.hooks.values()).filter(
      (hook) => hook.payoffEpisode === episode && !hook.resolved,
    );
  }

  /** Hooks carrying an explicit payoffEpisode target (for plant-validity). */
  withExplicitTarget(): CallbackHook[] {
    return Array.from(this.hooks.values()).filter((hook) => hook.payoffEpisode != null);
  }

  /**
   * Season Canon (P5): intentionally drop a promise so the completion gate doesn't
   * flag it as silently-open. No-op if the hook is unknown.
   */
  abandon(hookId: string, reason: string): CallbackHook | undefined {
    const hook = this.hooks.get(hookId);
    if (!hook) return undefined;
    hook.abandoned = true;
    hook.abandonReason = reason;
    return hook;
  }

  /** Hooks that are neither resolved nor abandoned (still owed). */
  stillOpen(): CallbackHook[] {
    return Array.from(this.hooks.values()).filter((hook) => !hook.resolved && !hook.abandoned);
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
