/**
 * Cross-run quality-ledger plumbing (S3 remediation ledger + Wave-0 gate
 * shadow telemetry).
 *
 * Faithful port of FullStoryPipeline.getLedgerBaseDir, getRemediationSummary,
 * getRunName, recordRemediationSafe, recordGateShadowSafe,
 * recordFinalContractShadow, and recordPlanGateShadow (pure move). The
 * per-run remediation counters move with the cluster; everything is
 * best-effort and never load-bearing.
 *
 * Extracted from FullStoryPipeline to keep that monolith from growing.
 */

import { Story } from '../../types';
import { runFidelityValidatorsShadow, FIDELITY_VALIDATOR_FLAGS } from '../validators/runFidelityValidators';
import { recordRemediation, type RemediationLedgerRecord } from '../remediation/remediationLedger';
import { recordGateShadow, buildGateShadowRecord, type GateShadowRecord } from '../remediation/gateShadowLedger';
import { isGateEnabled } from '../remediation/gateDefaults';
import { computePlanTimeShadow } from '../remediation/planTimeShadow';
// Type-only import — erased at runtime, so no runtime cycle with the monolith.
import type { FullCreativeBrief } from './FullStoryPipeline';

export interface RunLedgerDeps {
  /** The active run output directory (or undefined before it is known). */
  currentOutputDirectory: () => string | undefined;
  /** Serialized callback ledger for the resume-proof plan-time shadow. */
  serializeCallbackLedger: () => unknown;
}

export class RunLedger {
  private remediationsAttemptedCount = 0;
  private remediationsSucceededCount = 0;
  private remediationsDegradedCount = 0;

  constructor(private deps: RunLedgerDeps) {}

  /** Zero the per-run counters (called from the per-run state resets). */
  resetCounters(): void {
    this.remediationsAttemptedCount = 0;
    this.remediationsSucceededCount = 0;
    this.remediationsDegradedCount = 0;
  }

  /**
   * Cross-run ledgers live in the PARENT of a run's output dir
   * (e.g. generated-stories/). Mirrors pipelineOutputWriter's ledgerBaseDir.
   * Returns '' when no output dir is known — callers skip recording in that case.
   */
  private getLedgerBaseDir(): string {
    const outDir = this.deps.currentOutputDirectory();
    if (!outDir) return '';
    const trimmed = outDir.replace(/\/+$/, '');
    const slash = trimmed.lastIndexOf('/');
    return slash >= 0 ? trimmed.slice(0, slash + 1) : './';
  }

  /** S3: per-run remediation counters for the success quality-ledger row. */
  getRemediationSummary(): { attempted: number; succeeded: number; degraded: number } {
    return {
      attempted: this.remediationsAttemptedCount,
      succeeded: this.remediationsSucceededCount,
      degraded: this.remediationsDegradedCount,
    };
  }

  /** Run-dir basename for ledger rows (e.g. "my-story_2026-05-28T12-34-56"). */
  getRunName(): string {
    const outDir = this.deps.currentOutputDirectory();
    if (!outDir) return '';
    const trimmed = outDir.replace(/\/+$/, '');
    return trimmed.slice(trimmed.lastIndexOf('/') + 1);
  }

  /**
   * Best-effort remediation-ledger append. Never throws and no-ops when no
   * baseDir is available (e.g. non-node runtime or output dir not yet set).
   * Also bumps the per-run summary counters from the record's honest fields.
   */
  async recordRemediationSafe(
    record: Omit<RemediationLedgerRecord, 'timestamp' | 'runDir'> & { timestamp?: string; runDir?: string },
  ): Promise<void> {
    // Counters are best-effort telemetry; update them regardless of baseDir.
    this.remediationsAttemptedCount += 1;
    if (record.succeeded) this.remediationsSucceededCount += 1;
    if (record.degraded) this.remediationsDegradedCount += 1;

    const baseDir = this.getLedgerBaseDir();
    if (!baseDir) return; // no output dir — skip ledger write (counters still tracked)
    try {
      await recordRemediation(baseDir, {
        ...record,
        timestamp: record.timestamp ?? new Date().toISOString(),
        runDir: record.runDir ?? this.getRunName(),
      });
    } catch {
      /* ledger is analytics-only, never load-bearing */
    }
  }

  /** Wave-0 shadow telemetry: record what a gate WOULD do, regardless of flag state. Best-effort. */
  async recordGateShadowSafe(
    record: Omit<GateShadowRecord, 'timestamp' | 'runDir'> & { timestamp?: string; runDir?: string },
  ): Promise<void> {
    const baseDir = this.getLedgerBaseDir();
    if (!baseDir) return;
    try {
      await recordGateShadow(baseDir, {
        ...record,
        timestamp: record.timestamp ?? new Date().toISOString(),
        runDir: record.runDir ?? this.getRunName(),
      });
    } catch {
      /* shadow ledger is analytics-only, never load-bearing */
    }
  }

  /** Wave-0 shadow telemetry for the final-contract-class gates (design-note + treatment-fidelity). */
  async recordFinalContractShadow(
    input: { story: Story; brief: FullCreativeBrief },
    treatmentSourced: boolean,
    designNoteLeaks: number,
  ): Promise<void> {
    await this.recordGateShadowSafe(buildGateShadowRecord({
      gate: 'GATE_DESIGN_NOTE_LEAK', validator: 'MechanicsLeakageValidator (design-note class)',
      scope: 'scene', enabled: isGateEnabled('GATE_DESIGN_NOTE_LEAK'), blockingCount: designNoteLeaks, storyId: input.story.id,
    }));
    try {
      const shadow = runFidelityValidatorsShadow({
        story: input.story,
        seasonPlan: input.brief.seasonPlan,
        sourceAnalysis: input.brief.multiEpisode?.sourceAnalysis,
      });
      const counts = new Map<string, number>();
      for (const f of shadow) if (f.severity === 'error') counts.set(f.validator, (counts.get(f.validator) ?? 0) + 1);
      for (const [validator, flag] of Object.entries(FIDELITY_VALIDATOR_FLAGS)) {
        await this.recordGateShadowSafe(buildGateShadowRecord({
          gate: flag, validator, scope: 'episode',
          enabled: isGateEnabled(flag) && treatmentSourced, blockingCount: counts.get(validator) ?? 0, storyId: input.story.id,
        }));
      }
    } catch {
      /* shadow only — never load-bearing */
    }

    // Resume-proof plan-time shadow: recompute the plan-time gates from the ASSEMBLED
    // story here (the per-episode seam is skipped on resumed jobs, so this final-stage
    // pass is the always-on source). Aggregated per gate across episodes.
    try {
      const planTime = await computePlanTimeShadow({
        story: input.story as unknown as Parameters<typeof computePlanTimeShadow>[0]['story'],
        callbackLedger: this.deps.serializeCallbackLedger(),
        totalEpisodes: (input.story as unknown as { episodes?: unknown[] }).episodes?.length ?? 0,
      });
      for (const r of planTime) {
        await this.recordGateShadowSafe(buildGateShadowRecord({
          gate: r.gate, validator: r.validator, scope: 'episode',
          enabled: isGateEnabled(r.gate), blockingCount: r.blockingCount, storyId: input.story.id,
          details: 'final-stage aggregate (resume-proof)',
        }));
      }
    } catch {
      /* shadow only — never load-bearing */
    }
  }

  /** One-line shadow helper for the plan-time gate seams (episode scope). */
  async recordPlanGateShadow(
    gate: string, validator: string, blockingCount: number,
    issues: Array<{ severity: string; message?: string }>, storyId?: string,
  ): Promise<void> {
    await this.recordGateShadowSafe(
      buildGateShadowRecord({ gate, validator, scope: 'episode', enabled: isGateEnabled(gate), blockingCount, issues, storyId }),
    );
  }
}
