// ========================================
// RESUME-PROOF PLAN-TIME SHADOW
// ========================================
//
// The plan-time gates (setup-payoff, choice-density, consequence-budget,
// prop-introduction, callback-coverage) and their shadow recording live in the
// per-episode generation loop. On a RESUMED job that loop is skipped (episodes load
// from a checkpoint), so the plan-time gates never run and no shadow data is logged.
//
// This module recomputes the same plan-time findings from the ASSEMBLED story at the
// final-assembly stage — which runs on every job, resume or fresh — so the off→on
// promotion dataset is always populated. The assembled story carries everything the
// validators need (scenes/beats, choices with choiceType + consequences, cast roster,
// callback ledger). Pure: no LLM, no wall-clock, no randomness.

import { ChoiceDensityValidator } from '../validators/ChoiceDensityValidator';
import { ConsequenceBudgetValidator } from '../validators/ConsequenceBudgetValidator';
import { PropIntroductionValidator } from '../validators/PropIntroductionValidator';
import { CallbackCoverageValidator } from '../validators/CallbackCoverageValidator';
import { SetupPayoffValidator } from '../validators/SetupPayoffValidator';
import { buildPropIntroductionInput } from './propIntroductionGate';
import { repairPropIntroduction } from './repairs/propIntroductionRepair';
import { PLAN_GATE_FLAGS } from './planGatePolicy';

// Loose shapes — read from the assembled Story without coupling to its full type.
interface SChoice { id?: string; choiceType?: string; consequences?: unknown[] }
interface SBeat {
  id?: string;
  text?: string;
  isChoicePoint?: boolean;
  choices?: SChoice[];
  plantsThreadId?: string;
  paysOffThreadId?: string;
}
interface SScene { id?: string; name?: string; charactersInvolved?: string[]; beats?: SBeat[] }
interface SEpisode { scenes?: SScene[] }
export interface PlanTimeShadowStory {
  episodes?: SEpisode[];
  npcs?: Array<{ id: string; name?: string }>;
}

export interface PlanTimeShadowResult {
  gate: string;
  validator: string;
  /** Pre-repair blocker count: what the gate would have fired on before local cleanup. */
  blockingCount: number;
  /** Blocking findings still present after repair / suppression. */
  residualBlockingCount?: number;
  wouldRepairCount?: number;
  repairAttempted?: boolean;
  repairSucceeded?: boolean;
}

interface ShadowCountBucket {
  validator: string;
  n: number;
  residual?: number;
  repairAttempted?: boolean;
  repairSucceeded?: boolean;
}

/** Count error-severity findings across validators that use either `severity` or `level`. */
function errCount(result: { issues?: Array<{ severity?: string; level?: string }> }): number {
  return (result.issues ?? []).filter((i) => i.severity === 'error' || i.level === 'error').length;
}

/** Minimal observed-thread ledger from beat plant/payoff markers (mirrors narrativeDiagnostics). */
function deriveThreadLedger(scenes: SScene[]): { threads: any[]; designNotes: string } | undefined {
  const byId = new Map<string, any>();
  const ensure = (id: string) => {
    let t = byId.get(id);
    if (!t) {
      t = { id, kind: 'seed', priority: 'minor', label: id, plants: [], payoffs: [], status: 'planned' };
      byId.set(id, t);
    }
    return t;
  };
  for (const sc of scenes) {
    for (const b of sc.beats ?? []) {
      const sceneId = sc.id ?? '';
      if (b.plantsThreadId) ensure(b.plantsThreadId).plants.push({ sceneId, beatId: b.id ?? '' });
      if (b.paysOffThreadId) ensure(b.paysOffThreadId).payoffs.push({ sceneId, beatId: b.id ?? '' });
    }
  }
  return byId.size === 0 ? undefined : { threads: Array.from(byId.values()), designNotes: 'derived (resume-proof shadow)' };
}

/**
 * Recompute plan-time would-gate counts from the assembled story, aggregated per gate
 * across all episodes. Each validator runs in strict mode so it surfaces the
 * error-severity findings the gate would block on. Defensive: a validator throwing
 * degrades to 0 for that gate rather than aborting.
 */
export async function computePlanTimeShadow(opts: {
  story: PlanTimeShadowStory;
  callbackLedger?: unknown;
  totalEpisodes: number;
}): Promise<PlanTimeShadowResult[]> {
  const counts: Record<string, ShadowCountBucket> = {
    [PLAN_GATE_FLAGS.choiceDensity]: { validator: 'ChoiceDensityValidator', n: 0 },
    [PLAN_GATE_FLAGS.consequenceBudget]: { validator: 'ConsequenceBudgetValidator', n: 0 },
    [PLAN_GATE_FLAGS.propIntroduction]: { validator: 'PropIntroductionValidator', n: 0 },
    [PLAN_GATE_FLAGS.callbackCoverage]: { validator: 'CallbackCoverageValidator', n: 0 },
    [PLAN_GATE_FLAGS.setupPayoff]: { validator: 'SetupPayoffValidator', n: 0 },
  };
  const bump = (gate: string, n: number) => { counts[gate].n += n; };
  // ChoiceDensity + ConsequenceBudget validate() are ASYNC; the rest are sync.
  const guardAsync = async (fn: () => Promise<number>, gate: string) => { try { bump(gate, await fn()); } catch { /* degrade to 0 */ } };
  const guard = (fn: () => number, gate: string) => { try { bump(gate, fn()); } catch { /* degrade to 0 */ } };

  const episodes = opts.story.episodes ?? [];
  const knownIds = (opts.story.npcs ?? []).flatMap((n) => [n.id, n.name]).filter(Boolean) as string[];

  for (let idx = 0; idx < episodes.length; idx++) {
    const epNum = idx + 1;
    const scenes = episodes[idx].scenes ?? [];
    const choicePoint = (b: SBeat) => (b.choices?.length ?? 0) > 0 || !!b.isChoicePoint;

    await guardAsync(async () => {
      const beats = scenes.flatMap((sc) => (sc.beats ?? []).map((b) => ({ id: b.id ?? '', text: b.text ?? '', isChoicePoint: choicePoint(b) })));
      const dScenes = scenes.map((sc) => ({ id: sc.id ?? '', beats: (sc.beats ?? []).map((b) => ({ id: b.id ?? '', text: b.text ?? '', isChoicePoint: choicePoint(b) })) }));
      return errCount(await new ChoiceDensityValidator().validate({ beats, scenes: dScenes } as any, { strict: true }) as any);
    }, PLAN_GATE_FLAGS.choiceDensity);

    await guardAsync(async () => {
      const choices = scenes.flatMap((sc) => (sc.beats ?? []).flatMap((b) => (b.choices ?? []).map((c) => ({ id: c.id ?? '', choiceType: c.choiceType, consequences: c.consequences ?? [] }))));
      return errCount(await new ConsequenceBudgetValidator().validate({ choices } as any, { strictMode: true }) as any);
    }, PLAN_GATE_FLAGS.consequenceBudget);

    guard(() => {
      // Mirror the fresh-run seam: resolve raw label refs to canonical ids (on COPIES,
      // never mutating the story) BEFORE counting, so the shadow reflects what the gate
      // actually sees post-repair rather than inflating on label/id mismatches.
      const roster = (opts.story.npcs ?? []).map((n) => ({ id: n.id, name: n.name }));
      const propScenes = scenes.map((sc) => ({ sceneId: sc.id ?? '', sceneName: sc.name, referencedEntityIds: [...(sc.charactersInvolved ?? [])] }));
      const before = errCount(new PropIntroductionValidator().validate(buildPropIntroductionInput(knownIds, propScenes), { strict: true }) as any);
      repairPropIntroduction(propScenes, roster);
      const after = errCount(new PropIntroductionValidator().validate(buildPropIntroductionInput(knownIds, propScenes), { strict: true }) as any);
      counts[PLAN_GATE_FLAGS.propIntroduction].n += before;
      const existing = counts[PLAN_GATE_FLAGS.propIntroduction];
      existing.residual = (existing.residual ?? 0) + after;
      if (before > 0) {
        existing.repairAttempted = true;
        existing.repairSucceeded = (existing.repairSucceeded ?? true) && after === 0;
      }
      return 0;
    }, PLAN_GATE_FLAGS.propIntroduction);

    if (opts.callbackLedger) {
      guard(() => errCount(new CallbackCoverageValidator().validate({ ledger: opts.callbackLedger as any, currentEpisode: epNum, totalEpisodes: opts.totalEpisodes }, { strict: true }) as any), PLAN_GATE_FLAGS.callbackCoverage);
    }

    const ledger = deriveThreadLedger(scenes);
    if (ledger) {
      guard(() => errCount(new SetupPayoffValidator().validate({ ledger: ledger as any, currentEpisode: epNum, sceneContents: scenes.map((sc) => ({ sceneId: sc.id, beats: sc.beats })) as any }) as any), PLAN_GATE_FLAGS.setupPayoff);
    }
  }

  return Object.entries(counts).map(([gate, v]) => {
    return {
      gate,
      validator: v.validator,
      blockingCount: v.n,
      residualBlockingCount: v.residual,
      wouldRepairCount: v.repairAttempted ? v.n : undefined,
      repairAttempted: v.repairAttempted,
      repairSucceeded: v.repairSucceeded,
    };
  });
}
