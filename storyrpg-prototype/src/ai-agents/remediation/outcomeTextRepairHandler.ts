/**
 * LLM outcome-text repair handler for the final-contract repair loop.
 *
 * OutcomeTextQualityValidator (blocking) flags `outcome_text_stub`: a choice whose
 * `outcomeTexts.{success,partial,failure}` is the ChoiceAuthor deterministic fallback
 * stub — "the tier was never authored." This happens when ChoiceAuthor failed entirely
 * (a deterministic fallback choice set shipped) or only partially authored a choice.
 * Historically there was NO repair handler for this class, so even a single stub tier
 * hard-aborted the whole season at the final contract — and the assembly fixes that
 * stopped silently dropping fallback choices made those stubs SURFACE rather than
 * vanish, so the abort got more frequent (bite-me-g14: 52 blocking stub findings).
 *
 * This handler converts that abort into bounded per-choice repair: walk the assembled
 * story for choices carrying stub tiers, hand each to ChoiceAuthor's focused
 * `reauthorOutcomeTexts` (a small structured call — three short strings — that succeeds
 * far more reliably than re-running full choice authoring), replace ONLY the stub tiers
 * with the authored prose, and let the repair loop RE-VALIDATE. A tier is replaced only
 * when the new text is non-empty and not itself a stub, so a failed re-author leaves the
 * stub in place (the gate still blocks — no worse than before).
 */

import type { Story } from '../../types/story';
import { isFallbackOutcomeText } from '../constants/choiceTextFallbacks';
import { PIPELINE_TIMEOUTS, withTimeout } from '../utils/withTimeout';
import type { ContractRepairHandler } from './finalContractRepair';

export type OutcomeTier = 'success' | 'partial' | 'failure';

/** The single capability this handler needs — ChoiceAuthor implements it structurally. */
export interface OutcomeReauthorAgent {
  reauthorOutcomeTexts(ctx: {
    choiceText: string;
    stakes?: { want?: string; cost?: string; identity?: string };
    sceneName?: string;
    sceneLocation?: string;
    needTiers: OutcomeTier[];
  }): Promise<Partial<Record<OutcomeTier, string>>>;
}

interface ChoiceLike {
  id?: string;
  text?: string;
  stakes?: { want?: string; cost?: string; identity?: string };
  outcomeTexts?: Partial<Record<OutcomeTier, string>>;
}

export interface StubOutcomeTarget {
  choice: ChoiceLike;
  sceneName?: string;
  sceneLocation?: string;
  needTiers: OutcomeTier[];
}

const TIERS: OutcomeTier[] = ['success', 'partial', 'failure'];

/**
 * Best-effort setting hint for the re-author prompt. Assembled scenes carry no
 * structured `location`, so derive an establishing snippet from the scene's first
 * beat (its `text`, else its `visualMoment`) — enough for the re-author to keep
 * outcome prose physically consistent with the place (no indoor furniture in a
 * park, etc.). Returns undefined when no establishing prose is available.
 */
function deriveSceneSetting(scene: unknown): string | undefined {
  const beats = (scene as { beats?: Array<{ text?: string; visualMoment?: string }> })?.beats;
  const first = Array.isArray(beats) ? beats[0] : undefined;
  const source = (first?.text || first?.visualMoment || '').trim();
  if (source.length < 12) return undefined;
  return source.length > 200 ? `${source.slice(0, 200)}…` : source;
}

/**
 * Walk the assembled story for choices whose outcome tiers are the deterministic
 * stub. Mirrors OutcomeTextQualityValidator's recursive walk (choices live in
 * `scene.beats[].choices` AND `encounter.phases/storylets[].beats[].choices`), and
 * carries the enclosing scene name down for the re-author prompt's context.
 */
export function collectStubOutcomeChoices(story: Story): StubOutcomeTarget[] {
  const targets: StubOutcomeTarget[] = [];
  const visit = (node: unknown, sceneName?: string, sceneLocation?: string): void => {
    if (Array.isArray(node)) {
      for (const item of node) visit(item, sceneName, sceneLocation);
      return;
    }
    if (!node || typeof node !== 'object') return;
    const obj = node as Record<string, unknown>;
    if (obj.outcomeTexts && typeof obj.outcomeTexts === 'object') {
      const choice = obj as ChoiceLike;
      const needTiers = TIERS.filter((t) => isFallbackOutcomeText(choice.outcomeTexts?.[t]));
      if (needTiers.length > 0 && (choice.text || choice.id)) {
        targets.push({ choice, sceneName, sceneLocation, needTiers });
      }
    }
    for (const v of Object.values(obj)) if (v && typeof v === 'object') visit(v, sceneName, sceneLocation);
  };
  const episodes = (story as { episodes?: Array<{ scenes?: Array<{ name?: string }> }> }).episodes ?? [];
  for (const ep of episodes) {
    for (const scene of ep.scenes ?? []) {
      visit(scene, (scene as { name?: string }).name, deriveSceneSetting(scene));
    }
  }
  return targets;
}

export interface OutcomeTextRepairOptions {
  /** Provides the re-author agent (the run's ChoiceAuthor, or one built from config). Null disables the handler for the round. */
  author: () => OutcomeReauthorAgent | null;
  emit?: (message: string) => void;
  /** Choices re-authored per round cap (default 8) so a pathological report can't fan out unbounded LLM spend. */
  maxChoicesPerRound?: number;
}

const keyOf = (t: StubOutcomeTarget): string => String(t.choice.id || t.choice.text || '');

/**
 * Build the ContractRepairHandler. Plugs into runFinalContractRepair alongside the
 * deterministic + scene-prose handlers; the loop re-validates after each round, so a
 * successful re-author clears the stub finding on the next validation pass.
 */
export function buildOutcomeTextRepairHandler(opts: OutcomeTextRepairOptions): ContractRepairHandler {
  // Persists across repair rounds (built once per enforcement): later rounds
  // prioritize choices never attempted yet so a stubborn one can't starve the rest.
  const attempted = new Set<string>();
  return async ({ story }) => {
    const all = collectStubOutcomeChoices(story);
    if (all.length === 0) return { story, changed: false };

    const fresh = all.filter((t) => !attempted.has(keyOf(t)));
    const batch = (fresh.length ? fresh : all).slice(0, opts.maxChoicesPerRound ?? 8);

    const author = opts.author();
    if (!author) {
      opts.emit?.('Outcome-text contract repair skipped: no author available.');
      return { story, changed: false };
    }

    let repairedTiers = 0;
    let repairedChoices = 0;
    let calls = 0;
    for (const t of batch) {
      attempted.add(keyOf(t));
      try {
        const out = await withTimeout(
          author.reauthorOutcomeTexts({
            choiceText: String(t.choice.text || t.choice.id || 'the choice'),
            stakes: t.choice.stakes,
            sceneName: t.sceneName,
            sceneLocation: t.sceneLocation,
            needTiers: t.needTiers,
          }),
          PIPELINE_TIMEOUTS.llmAgent,
          `ChoiceAuthor.reauthorOutcomeTexts(${keyOf(t)})`,
        );
        calls += 1;
        if (!t.choice.outcomeTexts) continue;
        let choiceTouched = false;
        for (const tier of t.needTiers) {
          const value = out[tier];
          // Only replace a stub with REAL authored prose — never another stub.
          if (typeof value === 'string' && value.trim().length >= 12 && !isFallbackOutcomeText(value)) {
            t.choice.outcomeTexts[tier] = value.trim();
            repairedTiers += 1;
            choiceTouched = true;
          }
        }
        if (choiceTouched) repairedChoices += 1;
      } catch (err) {
        opts.emit?.(`Outcome-text contract repair for ${keyOf(t)} failed (stub kept): ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    if (repairedTiers === 0) return { story, changed: false };
    opts.emit?.(`Outcome-text contract repair: re-authored ${repairedTiers} stub tier(s) across ${repairedChoices} choice(s).`);
    return {
      story,
      changed: true,
      record: {
        rule: 'final_contract_outcome_text',
        scope: 'choices',
        attempted: batch.length,
        succeeded: repairedChoices === batch.length,
        degraded: repairedChoices < batch.length,
        blocked: false,
        attempts: calls,
        details: `Re-authored ${repairedTiers} stub outcome tier(s) across ${repairedChoices} choice(s)`,
      },
    };
  };
}
