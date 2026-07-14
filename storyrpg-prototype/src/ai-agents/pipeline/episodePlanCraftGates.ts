/**
 * Episode plan-time craft gates (R2.6 extract from FullStoryPipeline).
 * Hard-blocks on error-severity findings when the per-rule flag is set.
 * R2.3 frontier enforcement: episodes within generatedThrough+1 may block.
 */
import { ChoiceDensityValidator } from '../validators/ChoiceDensityValidator';
import { PropIntroductionValidator } from '../validators/PropIntroductionValidator';
import { buildPropIntroductionInput } from '../remediation/propIntroductionGate';
import { repairAndRevalidatePropIntroduction } from '../remediation/repairs/propIntroductionRepair';
import { PLAN_GATE_FLAGS, shouldGate } from '../remediation/planGatePolicy';
import { isGateEnabled, isShadowLoggingEnabled } from '../remediation/gateDefaults';
import { buildValidatorPromotionRecord, type GateShadowRecord } from '../remediation/gateShadowLedger';
import { RemediationBudget, shouldAttemptRemediation } from '../remediation/RemediationBudget';
import { type RemediationLedgerRecord } from '../remediation/remediationLedger';
import { validateObligationLedger } from '../validators/ObligationLedgerValidator';
import { createSeasonGateEnforcement } from './seasonGateFrontier';
import { PipelineError } from './errors';
import { CallbackLedger } from './callbackLedger';
import type { CharacterBible } from '../agents/CharacterDesigner';
import type { GeneratedBeat, SceneContent } from '../agents/SceneWriter';
import type { NarrativeDiagnosticsReport } from '../validators/narrativeDiagnostics';

export interface EpisodePlanCraftGateDeps {
  episodeNumber: number;
  generatedThroughEpisode: number;
  narrativeDiagnosticsReport: NarrativeDiagnosticsReport;
  callbackLedger: CallbackLedger;
  sceneContents: SceneContent[];
  characterBible: CharacterBible;
  remediationBudget: RemediationBudget | null;
  recordPlanGateShadow: (
    gate: string,
    validator: string,
    blockingCount: number,
    issues: Array<{ severity: string; message: string }>,
    storyId: string | undefined,
  ) => Promise<void>;
  recordRemediationSafe: (
    record: Omit<RemediationLedgerRecord, 'timestamp' | 'runDir'> & { timestamp?: string; runDir?: string },
  ) => Promise<void>;
  recordGateShadowSafe: (record: GateShadowRecord) => Promise<void>;
}

export async function enforceEpisodePlanCraftGates(deps: EpisodePlanCraftGateDeps): Promise<void> {
  const i = deps.episodeNumber;
  const narrativeDiagnosticsReport = deps.narrativeDiagnosticsReport;
  const sceneContents = deps.sceneContents;
  const characterBible = deps.characterBible;

      // Bucket D: plan-time craft gates (opt-in, default OFF). The validators ran
      // advisory inside runNarrativeDiagnostics above (report unchanged); these only
      // HARD-BLOCK on error-severity findings when the per-rule flag is set. The gate
      // checks run OUTSIDE the diagnostics try/catch so a real gate failure propagates
      // as a PipelineError instead of being swallowed as a non-fatal warning. With the
      // flags unset, shouldGate returns gate:false → behavior is unchanged.
      // NOTE(de-@ts-nocheck): this block previously referenced out-of-scope
      // `brief`/`story` copied from generate(). The `brief` ReferenceError
      // killed runNarrativeDiagnostics above as a "non-fatal" warning, which
      // left narrativeDiagnosticsReport undefined and silently skipped every
      // plan-time gate in multi-episode runs. Fixed to baseBrief; the gate
      // shadow records pass storyId: undefined (no Story exists in this
      // scope — the season story is assembled later by the driver).
      if (narrativeDiagnosticsReport) {
        const isEnabled = isGateEnabled;
        const shadow = isShadowLoggingEnabled();
        // R2.3: enforce plan gates inside the generation frontier (+1); shadow beyond.
        const seasonGateEnforcement = createSeasonGateEnforcement({
          episodeNumber: i,
          generatedThroughEpisode: deps.generatedThroughEpisode,
        });

        // UNIFIED-LEDGER GATE SOURCE (2026-07-03): both setup-payoff and
        // callback-coverage gates now read the ObligationLedgerValidator's
        // kind-filtered findings instead of the legacy diagnostics arms
        // (SetupPayoffValidator / CallbackCoverageValidator produced ZERO
        // findings across all 202 archived runs — the unified ledger is the
        // live source of truth for thread and callback debt).
        const obligationGateFindings = (() => {
          try {
            return validateObligationLedger(deps.callbackLedger, {
              episodeNumber: i,
              generatedThroughEpisode: i,
            }).findings;
          } catch {
            return [];
          }
        })();
        const setupPayoffIssues = obligationGateFindings.filter((f) => f.gateId === 'GATE_SETUP_PAYOFF');
        const setupPayoffGate = shouldGate(PLAN_GATE_FLAGS.setupPayoff, setupPayoffIssues, seasonGateEnforcement);
        await deps.recordPlanGateShadow(PLAN_GATE_FLAGS.setupPayoff, 'ObligationLedgerValidator', setupPayoffGate.blockingCount, setupPayoffIssues, undefined);
        if (setupPayoffGate.gate) {
          const errs = setupPayoffIssues.filter((iss) => iss.severity === 'error');
          // S3: record the hard block before throwing (best-effort).
          await deps.recordRemediationSafe({
            rule: 'setup_payoff_gate', scope: 'episode', attempted: 1,
            succeeded: false, degraded: false, blocked: true, attempts: 1,
            storyId: undefined, details: `Setup/payoff gate blocked episode ${i}: ${setupPayoffGate.blockingCount} issue(s)`,
          });
          throw new PipelineError(
            `[SetupPayoffGate] Setup/payoff failed the blocking gate (${setupPayoffGate.blockingCount} issue(s)): ` +
              errs.map((iss) => iss.message).join('; ') +
              '. Unset GATE_SETUP_PAYOFF to downgrade to advisory.',
            `episode_${i}_setup_payoff_gate`,
            { context: { episode: i, blockingCount: setupPayoffGate.blockingCount } },
          );
        }

        // Callback-coverage gate: all callback-family obligation kinds
        // (choice_callback / flag_promise / score_promise / forward_promise)
        // route to GATE_CALLBACK_COVERAGE in the unified ledger.
        const callbackGateIssues = obligationGateFindings.filter((f) => f.gateId === 'GATE_CALLBACK_COVERAGE');
        const callbackGate = shouldGate(PLAN_GATE_FLAGS.callbackCoverage, callbackGateIssues, seasonGateEnforcement);
        await deps.recordPlanGateShadow(PLAN_GATE_FLAGS.callbackCoverage, 'ObligationLedgerValidator', callbackGate.blockingCount, callbackGateIssues, undefined);
        if (callbackGate.gate) {
          const errs = callbackGateIssues.filter((iss) => iss.severity === 'error');
          // S3: record the hard block before throwing (best-effort).
          await deps.recordRemediationSafe({
            rule: 'callback_coverage_gate', scope: 'episode', attempted: 1,
            succeeded: false, degraded: false, blocked: true, attempts: 1,
            storyId: undefined, details: `Callback coverage gate blocked episode ${i}: ${callbackGate.blockingCount} issue(s)`,
          });
          throw new PipelineError(
            `[CallbackCoverageGate] Callback coverage failed the blocking gate (${callbackGate.blockingCount} issue(s)): ` +
              errs.map((iss) => iss.message).join('; ') +
              '. Unset GATE_CALLBACK_COVERAGE to downgrade to advisory.',
            `episode_${i}_callback_coverage_gate`,
            { context: { episode: i, blockingCount: callbackGate.blockingCount } },
          );
        }

        // ChoiceDensity gate (default OFF; GATE_CHOICE_DENSITY=1). The validator
        // emits 'error' only for the "zero choices" case; all genuine structural
        // (D4) and timing-cap violations are warning-level by default, so the
        // gate would never fire on them. When the flag is on we re-run the
        // validator in STRICT mode (a pure, deterministic re-eval of the same
        // beats/scenes) so those violations surface as 'error' for shouldGate.
        // With the flag OFF this branch is skipped entirely → behavior unchanged.
        if (isEnabled(PLAN_GATE_FLAGS.choiceDensity) || shadow) {
          const densityResult = await new ChoiceDensityValidator().validate(
            {
              beats: sceneContents.flatMap((sc) =>
                (sc.beats ?? []).map((b) => ({
                  id: b.id,
                  text: b.text ?? b.content ?? '',
                  isChoicePoint: ((b as GeneratedBeat & { choices?: unknown[] }).choices?.length ?? 0) > 0 || b.isChoicePoint,
                })),
              ),
              scenes: sceneContents.map((sc) => ({
                id: sc.sceneId,
                beats: (sc.beats ?? []).map((b) => ({
                  id: b.id,
                  text: b.text ?? b.content ?? '',
                  isChoicePoint: ((b as GeneratedBeat & { choices?: unknown[] }).choices?.length ?? 0) > 0 || b.isChoicePoint,
                })),
              })),
            },
            { strict: true },
          );
          const densityIssues = densityResult.issues.map((iss) => ({ severity: iss.level, message: iss.message }));
          const densityGate = shouldGate(PLAN_GATE_FLAGS.choiceDensity, densityIssues, seasonGateEnforcement);
          await deps.recordPlanGateShadow(PLAN_GATE_FLAGS.choiceDensity, 'ChoiceDensityValidator', densityGate.blockingCount, densityIssues, undefined);
          if (densityGate.gate) {
            const errs = densityIssues.filter((iss) => iss.severity === 'error');
            await deps.recordRemediationSafe({
              rule: 'choice_density_gate', scope: 'episode', attempted: 1,
              succeeded: false, degraded: false, blocked: true, attempts: 1,
              storyId: undefined, details: `Choice density gate blocked episode ${i}: ${densityGate.blockingCount} issue(s)`,
            });
            throw new PipelineError(
              `[ChoiceDensityGate] Choice density failed the blocking gate (${densityGate.blockingCount} issue(s)): ` +
                errs.map((iss) => iss.message).join('; ') +
                '. Unset GATE_CHOICE_DENSITY to downgrade to advisory.',
              `episode_${i}_choice_density_gate`,
              { context: { episode: i, blockingCount: densityGate.blockingCount } },
            );
          }
        }

        // Consequence-budget balance is a season-plan property. Do not re-run
        // the whole-season percentage validator against this generated episode
        // slice; FinalStoryContractValidator checks per-scene consequence-tier
        // conformance against the season plan instead.

        // PropIntroduction gate (default OFF; GATE_PROP_INTRODUCTION=1). PARTIAL
        // gate (see propIntroductionGate.ts SCOPE NOTE): the deterministic
        // episode-level subset. Known entities = declared cast (ids + display
        // names) folded with every scene's declared introductions; references
        // come from each scene's charactersInvolved (the only per-scene entity
        // signal available at this seam — props are not yet a tracked field, so
        // unresolved-prop detection is deferred to a future SceneContent
        // .referencedEntityIds/.introducesEntityIds population). The validator
        // emits only warning-level issues today, so the gate fires only if it
        // begins emitting 'error' (shouldGate counts error-severity); with the
        // flag OFF this branch is skipped → behavior unchanged.
        if (isEnabled(PLAN_GATE_FLAGS.propIntroduction) || shadow) {
          const propInput = buildPropIntroductionInput(
            (characterBible.characters ?? []).flatMap((c) => [c.id, c.name]),
            sceneContents.map((sc) => ({
              sceneId: sc.sceneId,
              sceneName: sc.sceneName,
              referencedEntityIds: sc.charactersInvolved ?? [],
            })),
          );
          // strict: this block only runs when GATE_PROP_INTRODUCTION is set, so escalate
          // unresolved references to error-severity here so the gate can actually fire.
          const propResult = new PropIntroductionValidator().validate(propInput, { strict: true });
          const propIssues = propResult.issues.map((iss) => ({ severity: iss.severity, message: iss.message }));
          const propGate = shouldGate(PLAN_GATE_FLAGS.propIntroduction, propIssues, seasonGateEnforcement);
          await deps.recordGateShadowSafe(buildValidatorPromotionRecord({
            gate: PLAN_GATE_FLAGS.propIntroduction,
            validator: 'PropIntroductionValidator',
            scope: 'episode',
            placement: 'plan',
            enabled: isEnabled(PLAN_GATE_FLAGS.propIntroduction),
            blockingCount: propGate.blockingCount,
            wouldRepairCount: propGate.blockingCount,
            repairAttempted: false,
            residualBlockingCount: propGate.blockingCount,
            issues: propIssues,
            details: `episode=${i}; unresolved=${propGate.blockingCount}; repairTelemetry=pre`,
          }));
          if (propGate.blockingCount > 0) {
            // Wave 4 repair loop: resolve raw label->canonical-id references (the
            // witness-bug class) and re-validate before aborting. Genuinely-unknown
            // references are NOT rewritten, so a real dangling reference still blocks.
            const propRoster = (characterBible.characters ?? []).map((c) => ({ id: c.id, name: c.name }));
            const propRepairScenes = sceneContents
              .filter((sc) => Array.isArray(sc.charactersInvolved))
              .map((sc) => ({ sceneId: sc.sceneId, sceneName: sc.sceneName, referencedEntityIds: sc.charactersInvolved as string[] }));
            const propRepair = await repairAndRevalidatePropIntroduction(propRepairScenes, propRoster, {
              canSpend: () => propGate.gate ? shouldAttemptRemediation(deps.remediationBudget) : true,
            });
            if (propGate.gate) {
              for (const rec of propRepair.records) await deps.recordRemediationSafe(rec);
            }
            const repairedPropResult = new PropIntroductionValidator().validate(
              buildPropIntroductionInput(
                propRoster.flatMap((r) => [r.id, r.name]),
                propRepairScenes.map((sc) => ({
                  sceneId: sc.sceneId,
                  sceneName: sc.sceneName,
                  referencedEntityIds: sc.referencedEntityIds,
                })),
              ),
              { strict: true },
            );
            const remainingUnknownCount = repairedPropResult.issues.filter((iss) => iss.severity === 'error').length;
            await deps.recordGateShadowSafe(buildValidatorPromotionRecord({
              gate: PLAN_GATE_FLAGS.propIntroduction,
              validator: 'PropIntroductionValidator',
              scope: 'episode',
              placement: 'plan',
              enabled: isEnabled(PLAN_GATE_FLAGS.propIntroduction),
              blockingCount: propGate.blockingCount,
              wouldRepairCount: propGate.blockingCount,
              repairAttempted: true,
              repairSucceeded: propRepair.passed,
              residualBlockingCount: remainingUnknownCount,
              issues: repairedPropResult.issues.map((iss) => ({ severity: iss.severity, message: iss.message })),
              details:
                `episode=${i}; wouldRepairCount=${propGate.blockingCount}; repairedCount=${propRepair.fixedCount}; ` +
                `remainingUnknownCount=${remainingUnknownCount}; examples=${propRepair.examples.join(',') || 'none'}`,
            }));
            if (propGate.gate && !propRepair.passed) {
              const errs = propIssues.filter((iss) => iss.severity === 'error');
              await deps.recordRemediationSafe({
                rule: 'prop_introduction_gate', scope: 'episode', attempted: 1,
                succeeded: false, degraded: false, blocked: true, attempts: 1,
                storyId: undefined, details: `Prop introduction gate blocked episode ${i}: ${propGate.blockingCount} issue(s)`,
              });
              throw new PipelineError(
                `[PropIntroductionGate] Prop introduction failed the blocking gate (${propGate.blockingCount} unresolved reference(s)): ` +
                  errs.map((iss) => iss.message).join('; ') +
                  '. Unset GATE_PROP_INTRODUCTION to downgrade to advisory.',
                `episode_${i}_prop_introduction_gate`,
                { context: { episode: i, blockingCount: propGate.blockingCount } },
              );
            }
          }
        }
      }

}
