// ========================================
// BUCKET D PLAN-GATE WIRING TESTS
// ========================================
//
// These assert the seam-level contract the four Bucket D gates are wired to:
//   - flag OFF  => the validator still runs (advisory) and the gate NEVER throws
//   - flag ON + an error-severity finding => shouldGate reports gate:true with the
//     blocking count, which is exactly the condition each seam throws on.
//
// The gate seams themselves (SeasonPlannerAgent.execute, seasonChoicePlan,
// FullStoryPipeline) compose `shouldGate(...)` with a `process.env[flag] === '1'`
// lookup, so testing that composition over the REAL validator output here covers
// the decision without booting the whole pipeline. The throw tag/message is a
// thin string the seam wraps around this decision.

import { describe, expect, it } from 'vitest';
import { PLAN_GATE_FLAGS, shouldGate } from './planGatePolicy';
import { stabilizeByHysteresis } from './judgeStabilizer';
import { buildPropIntroductionInput } from './propIntroductionGate';
import { ArcPressureArchitectureValidator } from '../validators/ArcPressureArchitectureValidator';
import { CallbackCoverageValidator } from '../validators/CallbackCoverageValidator';
import { ChoiceDistributionValidator } from '../validators/ChoiceDistributionValidator';
import { ChoiceDensityValidator } from '../validators/ChoiceDensityValidator';
import { ConsequenceBudgetValidator } from '../validators/ConsequenceBudgetValidator';
import { PropIntroductionValidator } from '../validators/PropIntroductionValidator';
import { SetupPayoffValidator } from '../validators/SetupPayoffValidator';
import { assignSeasonChoiceTypes, type SeasonChoiceMoment } from '../pipeline/seasonChoicePlan';
import { DEFAULT_LEDGER_CONFIG, type SerializedCallbackLedger } from '../pipeline/callbackLedger';
import type { NarrativeThread, ThreadLedger } from '../../types';

const off = (_flag: string) => false;
const on =
  (flag: string) =>
  (f: string) =>
    f === flag;

const isLater = (p: SeasonChoiceMoment['payoff']) =>
  typeof p === 'object' && p !== null && typeof (p as { payoffEpisode?: number }).payoffEpisode === 'number';

describe('Bucket D plan-gate wiring', () => {
  // --- ArcPressure (season seam) -------------------------------------------
  describe('ArcPressure gate', () => {
    const violatingPlan = { arcs: [], episodes: [], totalEpisodes: 0 };

    it('produces an error-severity finding on a plan with no arcs', () => {
      const result = new ArcPressureArchitectureValidator().validate(violatingPlan);
      expect(result.issues.some((i) => i.severity === 'error')).toBe(true);
    });

    it('does not gate when GATE_ARC_PRESSURE is off (validator still ran)', () => {
      const result = new ArcPressureArchitectureValidator().validate(violatingPlan);
      const { gate, blockingCount } = shouldGate(PLAN_GATE_FLAGS.arcPressure, result.issues, off);
      expect(gate).toBe(false);
      expect(blockingCount).toBeGreaterThan(0);
    });

    it('gates when GATE_ARC_PRESSURE is on and an error exists', () => {
      const result = new ArcPressureArchitectureValidator().validate(violatingPlan);
      const decision = shouldGate(
        PLAN_GATE_FLAGS.arcPressure,
        result.issues,
        on(PLAN_GATE_FLAGS.arcPressure),
      );
      expect(decision.gate).toBe(true);
      // The seam throws `[ArcPressureGate] ...`; assert the tag composes from the decision.
      expect(decision.gate ? '[ArcPressureGate]' : '').toBe('[ArcPressureGate]');
    });
  });

  // --- ChoiceDistribution (plan-emit seam) ---------------------------------
  describe('ChoiceDistribution gate', () => {
    // 8 later-payoff moments: the deficit assignment avoids 'expression' for
    // later-payoff moments, but the expression budget (3 of 8) cannot be drained
    // by non-expression-wanting moments, so the fallback forces 'expression' onto
    // later-payoff (branching) moments — an error-severity expression+branching
    // violation at the ChoiceDistributionValidator.
    const laterPayoffMoments: SeasonChoiceMoment[] = Array.from({ length: 8 }, (_, k) => ({
      id: `m${k}`,
      episode: k + 1,
      anchor: `decision ${k}`,
      payoff: { payoffEpisode: k + 2 },
    }));

    // The gate seam reconstructs the validator input from the assigned plan.
    const runValidator = () => {
      const plan = assignSeasonChoiceTypes(laterPayoffMoments);
      return new ChoiceDistributionValidator().validate({
        choiceSets: plan.moments.map((m) => ({
          beatId: m.id,
          choiceType: m.choiceType ?? 'expression',
          hasBranching: isLater(m.payoff),
        })),
        targets: { expression: 35, relationship: 30, strategic: 20, dilemma: 15 },
        maxBranchingChoicesPerEpisode: Number.MAX_SAFE_INTEGER,
      });
    };

    it('produces an error-severity finding (expression choice with branching)', () => {
      expect(runValidator().issues.some((i) => i.severity === 'error')).toBe(true);
    });

    it('does not gate when GATE_CHOICE_DISTRIBUTION is off', () => {
      const { gate, blockingCount } = shouldGate(
        PLAN_GATE_FLAGS.choiceDistribution,
        runValidator().issues,
        off,
      );
      expect(gate).toBe(false);
      expect(blockingCount).toBeGreaterThan(0);
    });

    it('gates when GATE_CHOICE_DISTRIBUTION is on and an error exists', () => {
      const decision = shouldGate(
        PLAN_GATE_FLAGS.choiceDistribution,
        runValidator().issues,
        on(PLAN_GATE_FLAGS.choiceDistribution),
      );
      expect(decision.gate).toBe(true);
      expect(decision.gate ? '[ChoiceDistributionGate]' : '').toBe('[ChoiceDistributionGate]');
    });
  });

  // --- SetupPayoff (diagnostic seam) ---------------------------------------
  describe('SetupPayoff gate', () => {
    // A major thread paid off but never planted => deus-ex-machina => error.
    const majorUnplanted: NarrativeThread = {
      id: 'thread-x',
      kind: 'reveal',
      priority: 'major',
      label: 'The hidden benefactor',
      description: 'Who has been protecting the protagonist.',
      plants: [],
      payoffs: [{ sceneId: 's1', beatId: 'b1' }],
      status: 'planned',
    };
    const ledger: ThreadLedger = { threads: [majorUnplanted] };

    const runValidator = () =>
      new SetupPayoffValidator().validate({ ledger, sceneContents: [], currentEpisode: 1 });

    it('produces an error-severity finding for the major unplanted thread', () => {
      expect(runValidator().issues.some((i) => i.severity === 'error')).toBe(true);
    });

    it('does not gate when GATE_SETUP_PAYOFF is off', () => {
      const { gate, blockingCount } = shouldGate(
        PLAN_GATE_FLAGS.setupPayoff,
        runValidator().issues,
        off,
      );
      expect(gate).toBe(false);
      expect(blockingCount).toBeGreaterThan(0);
    });

    it('gates when GATE_SETUP_PAYOFF is on and an error exists', () => {
      const decision = shouldGate(
        PLAN_GATE_FLAGS.setupPayoff,
        runValidator().issues,
        on(PLAN_GATE_FLAGS.setupPayoff),
      );
      expect(decision.gate).toBe(true);
      expect(decision.gate ? '[SetupPayoffGate]' : '').toBe('[SetupPayoffGate]');
    });
  });

  // --- CallbackCoverage (diagnostic seam) ----------------------------------
  describe('CallbackCoverage gate', () => {
    const emptyLedger: SerializedCallbackLedger = {
      version: 1,
      hooks: [],
      config: DEFAULT_LEDGER_CONFIG,
    };

    // The real CallbackCoverageValidator emits only warning/suggestion levels
    // today, so the gate is a wired no-op even when enabled — this documents that
    // the flag NEVER blocks on the validator's current output (behavior unchanged).
    it('the validator emits no error-severity findings today (gate is a no-op even when on)', () => {
      const result = new CallbackCoverageValidator().validate({
        ledger: emptyLedger,
        currentEpisode: 1,
        totalEpisodes: 5,
      });
      expect(result.issues.filter((i) => i.level === 'error').length).toBe(0);
      // The diagnostic mapper passes non-suggestion `level` straight through to
      // `severity`, so today's output yields no gate even with the flag enabled.
      const asDiagnostic = result.issues.map((i) => ({ severity: i.level }));
      expect(
        shouldGate(PLAN_GATE_FLAGS.callbackCoverage, asDiagnostic, on(PLAN_GATE_FLAGS.callbackCoverage)).gate,
      ).toBe(false);
    });

    it('gates when GATE_CALLBACK_COVERAGE is on and an error-severity finding is present', () => {
      // If the validator (or a future strict mode) emits an error, the seam blocks.
      const issues = [{ severity: 'error' as const }];
      expect(shouldGate(PLAN_GATE_FLAGS.callbackCoverage, issues, off).gate).toBe(false);
      const on1 = shouldGate(PLAN_GATE_FLAGS.callbackCoverage, issues, on(PLAN_GATE_FLAGS.callbackCoverage));
      expect(on1.gate).toBe(true);
      expect(on1.gate ? '[CallbackCoverageGate]' : '').toBe('[CallbackCoverageGate]');
    });

    // --- Strict seam ------------------------------------------------------
    // The FullStoryPipeline gate re-runs the validator in STRICT mode when the
    // flag is enabled (the diagnostics-report path stays advisory). These tests
    // exercise that exact composition over the REAL validator output: a genuine
    // coverage violation in strict mode produces an 'error' the gate blocks on,
    // while the same ledger in default mode stays a 'warning' (flag-off path
    // unchanged).
    //
    // Genuine violation: episode 2, one unresolved hook from episode 1 whose
    // payoff window covers episode 2, but zero hooks paid off this episode.
    const violatingLedger: SerializedCallbackLedger = {
      version: 1,
      hooks: [
        {
          id: 'hook-unpaid',
          sourceEpisode: 1,
          sourceSceneId: 's1',
          sourceChoiceId: 'c1',
          flags: [],
          summary: 'The protagonist swore to return for the captured scout.',
          payoffWindow: { minEpisode: 1, maxEpisode: 3 },
          payoffCount: 0,
          resolved: false,
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      ],
      config: DEFAULT_LEDGER_CONFIG,
    };

    const runStrict = (strict: boolean) =>
      new CallbackCoverageValidator().validate(
        { ledger: violatingLedger, currentEpisode: 2, totalEpisodes: 5 },
        { strict },
      );

    it('strict seam: genuine violation emits an error and the gate blocks when the flag is on', () => {
      const result = runStrict(true);
      expect(result.issues.filter((i) => i.level === 'error').length).toBe(1);
      const asDiagnostic = result.issues.map((i) => ({ severity: i.level }));
      // Flag off => no gate even though an error exists; flag on => gate fires.
      expect(shouldGate(PLAN_GATE_FLAGS.callbackCoverage, asDiagnostic, off).gate).toBe(false);
      const decision = shouldGate(PLAN_GATE_FLAGS.callbackCoverage, asDiagnostic, on(PLAN_GATE_FLAGS.callbackCoverage));
      expect(decision.gate).toBe(true);
      expect(decision.blockingCount).toBe(1);
    });

    it('default (non-strict) seam: same violation stays a warning and never gates (flag-off path unchanged)', () => {
      const result = runStrict(false);
      expect(result.issues.filter((i) => i.level === 'error').length).toBe(0);
      expect(result.issues.some((i) => i.level === 'warning')).toBe(true);
      const asDiagnostic = result.issues.map((i) => ({ severity: i.level }));
      // Even with the flag on, the default-mode output yields no gate — this is
      // the path the pipeline uses when GATE_CALLBACK_COVERAGE is unset.
      expect(
        shouldGate(PLAN_GATE_FLAGS.callbackCoverage, asDiagnostic, on(PLAN_GATE_FLAGS.callbackCoverage)).gate,
      ).toBe(false);
    });
  });

  // --- ChoiceDensity (all-scenes seam, strict) -----------------------------
  // The FullStoryPipeline gate re-runs the validator in STRICT mode only when
  // GATE_CHOICE_DENSITY=1 (default-off path uses the advisory IBPV run). Strict
  // mode promotes structural (D4) violations from warning to error so shouldGate
  // can block. Fixture: 4 scenes, only the LAST carries a choice point → <50%
  // coverage AND first scene has no choice → two clear structural violations.
  describe('ChoiceDensity gate', () => {
    const beat = (id: string, isChoicePoint = false) => ({ id, text: 'A short beat of prose.', isChoicePoint });
    const scenesInput = {
      beats: [beat('s1b1'), beat('s2b1'), beat('s3b1'), beat('s4b1', true)],
      scenes: [
        { id: 's1', beats: [beat('s1b1')] },
        { id: 's2', beats: [beat('s2b1')] },
        { id: 's3', beats: [beat('s3b1')] },
        { id: 's4', beats: [beat('s4b1', true)] },
      ],
    };

    const runValidator = (strict: boolean) =>
      new ChoiceDensityValidator().validate(scenesInput, { strict });

    it('default (non-strict): structural violations stay warning and never gate (flag-off path unchanged)', async () => {
      const result = await runValidator(false);
      expect(result.issues.filter((i) => i.level === 'error').length).toBe(0);
      expect(result.issues.some((i) => i.level === 'warning')).toBe(true);
      const asDiagnostic = result.issues.map((i) => ({ severity: i.level }));
      // Even with the flag on, default-mode output yields no gate.
      expect(
        shouldGate(PLAN_GATE_FLAGS.choiceDensity, asDiagnostic, on(PLAN_GATE_FLAGS.choiceDensity)).gate,
      ).toBe(false);
    });

    it('strict: structural violations become errors; gates only when the flag is on', async () => {
      const result = await runValidator(true);
      expect(result.issues.filter((i) => i.level === 'error').length).toBeGreaterThan(0);
      const asDiagnostic = result.issues.map((i) => ({ severity: i.level }));
      expect(shouldGate(PLAN_GATE_FLAGS.choiceDensity, asDiagnostic, off).gate).toBe(false);
      const decision = shouldGate(
        PLAN_GATE_FLAGS.choiceDensity,
        asDiagnostic,
        on(PLAN_GATE_FLAGS.choiceDensity),
      );
      expect(decision.gate).toBe(true);
      expect(decision.blockingCount).toBeGreaterThan(0);
    });
  });

  // --- ConsequenceBudget (all-scenes seam, strict) -------------------------
  // The seam passes { strictMode: true } only when GATE_CONSEQUENCE_BUDGET=1.
  // Strict mode promotes extreme-deviation (|dev| > tolerance*2) budget findings
  // from warning to error. Fixture: every consequence is an explicit 'branch'
  // category → branch 100% (target 5%) and callback 0% (target 60%), both
  // extreme deviations.
  describe('ConsequenceBudget gate', () => {
    const budgetInput = {
      choices: [
        {
          id: 'c1',
          choiceType: 'strategic',
          consequences: [
            { type: 'skill', budgetCategory: 'branch' as const },
            { type: 'skill', budgetCategory: 'branch' as const },
          ],
        },
      ],
    };

    const runValidator = (strictMode: boolean) =>
      new ConsequenceBudgetValidator().validate(budgetInput, { strictMode });

    it('default (non-strict): extreme deviations stay warning and never gate (flag-off path unchanged)', async () => {
      const result = await runValidator(false);
      expect(result.issues.filter((i) => i.level === 'error').length).toBe(0);
      expect(result.issues.some((i) => i.level === 'warning')).toBe(true);
      const asDiagnostic = result.issues.map((i) => ({ severity: i.level }));
      expect(
        shouldGate(PLAN_GATE_FLAGS.consequenceBudget, asDiagnostic, on(PLAN_GATE_FLAGS.consequenceBudget)).gate,
      ).toBe(false);
    });

    it('strict: extreme deviations become errors; gates only when the flag is on', async () => {
      const result = await runValidator(true);
      expect(result.issues.filter((i) => i.level === 'error').length).toBeGreaterThan(0);
      const asDiagnostic = result.issues.map((i) => ({ severity: i.level }));
      expect(shouldGate(PLAN_GATE_FLAGS.consequenceBudget, asDiagnostic, off).gate).toBe(false);
      const decision = shouldGate(
        PLAN_GATE_FLAGS.consequenceBudget,
        asDiagnostic,
        on(PLAN_GATE_FLAGS.consequenceBudget),
      );
      expect(decision.gate).toBe(true);
      expect(decision.blockingCount).toBeGreaterThan(0);
    });
  });

  // --- PropIntroduction (all-scenes seam, PARTIAL) -------------------------
  // PARTIAL gate (cast-reference subset; see propIntroductionGate.ts SCOPE
  // NOTE). The validator emits only WARNING-severity findings today, so the gate
  // is a wired no-op even when GATE_PROP_INTRODUCTION=1 — this documents that the
  // flag never blocks on the validator's current output (behavior unchanged). It
  // still wires the helper so a future error-severity finding would block.
  describe('PropIntroduction gate (partial)', () => {
    // Scene references an undeclared entity → an unresolved (warning) finding.
    const propInput = buildPropIntroductionInput(
      ['protagonist', 'Mara'],
      [
        { sceneId: 's1', sceneName: 'Open', referencedEntityIds: ['protagonist'] },
        { sceneId: 's2', sceneName: 'Reveal', referencedEntityIds: ['ghost-of-the-keep'] },
      ],
    );

    it('flags the undeclared reference as a warning (validator runs)', () => {
      const result = new PropIntroductionValidator().validate(propInput);
      expect(result.valid).toBe(false);
      expect(result.issues.some((i) => i.severity === 'warning')).toBe(true);
    });

    it('is a no-op gate today: only warnings, so it never blocks even when the flag is on', () => {
      const result = new PropIntroductionValidator().validate(propInput);
      expect(result.issues.filter((i) => i.severity === 'error').length).toBe(0);
      const asDiagnostic = result.issues.map((i) => ({ severity: i.severity }));
      expect(shouldGate(PLAN_GATE_FLAGS.propIntroduction, asDiagnostic, off).gate).toBe(false);
      expect(
        shouldGate(PLAN_GATE_FLAGS.propIntroduction, asDiagnostic, on(PLAN_GATE_FLAGS.propIntroduction)).gate,
      ).toBe(false);
    });

    it('would block if an error-severity finding ever appears (gate composition is wired)', () => {
      const issues = [{ severity: 'error' as const }];
      expect(shouldGate(PLAN_GATE_FLAGS.propIntroduction, issues, off).gate).toBe(false);
      expect(
        shouldGate(PLAN_GATE_FLAGS.propIntroduction, issues, on(PLAN_GATE_FLAGS.propIntroduction)).gate,
      ).toBe(true);
    });
  });

  // --- Cliffhanger soft-gate (hysteresis decision) -------------------------
  // The FullStoryPipeline cliffhanger soft-gate NEVER throws; the flag only
  // changes the repair DECISION. Default-off path: repair when quality is not
  // good/excellent (heuristic score < 62). Flag-on path: hysteresis-stabilized
  // so a borderline draw in [57, 62) is treated as a pass (NO repair). 62 is the
  // 'good' threshold; 5 is the margin used at the seam.
  describe('Cliffhanger soft-gate (hysteresis decision)', () => {
    const THRESHOLD = 62;
    const MARGIN = 5;
    // The default-off decision the seam uses (quality !== good/excellent).
    const defaultNeedsRepair = (score: number) => score < THRESHOLD;
    const stabilizedNeedsRepair = (score: number) => stabilizeByHysteresis(score, THRESHOLD, MARGIN);

    it('default-off: a borderline score (59) still triggers repair', () => {
      expect(defaultNeedsRepair(59)).toBe(true);
    });

    it('flag-on: a borderline score (59) in the hysteresis band does NOT trigger repair', () => {
      expect(stabilizedNeedsRepair(59)).toBe(false);
    });

    it('flag-on: a clearly low score (40) still triggers repair', () => {
      expect(stabilizedNeedsRepair(40)).toBe(true);
    });

    it('both paths agree a passing score (75) never triggers repair', () => {
      expect(defaultNeedsRepair(75)).toBe(false);
      expect(stabilizedNeedsRepair(75)).toBe(false);
    });
  });
});
