import fs from 'node:fs';
import path from 'node:path';
import {
  shouldAdoptOwnerRepairCandidate,
  type RealizationTaskGateFinding,
} from '../src/ai-agents/pipeline/realizationTaskGate';
import { isCriticalOwnerRealizationFinding } from '../src/ai-agents/pipeline/deferredRealization';
import type { NarrativeRealizationTask } from '../src/types/narrativeContract';

/**
 * Offline owner-repair policy replay: load the realization-blockers and
 * owner-repair-attempt diagnostics an aborted run already wrote, and evaluate
 * them under the CURRENT repair policy (adoption rule, criticality, capacity)
 * — no LLM calls, no live run. This turns "did the policy change fix the last
 * failure?" from a 60-90 minute live-run question into a seconds-long replay
 * (2026-07-14 convergence review, section C).
 *
 *   npm run replay:owner-repair -- generated-stories/bite-me_2026-07-14T17-29-14
 *   npm run replay:owner-repair -- <run-dir> --scene s1-3
 *   npm run replay:owner-repair -- <run-dir> --out /tmp/replay.json
 *
 * Read-only with respect to the run dir; the only write is the optional --out
 * report. What it answers per blocked scene:
 *   - Which findings remained, which atoms were missing, and whether each
 *     finding is critical (abort) or deferrable under current policy.
 *   - The patch operation capacity the current union-targeting math would
 *     grant (standard and expanded tiers).
 *   - For every recorded repair attempt: would the current adoption rule have
 *     adopted the candidate the run actually produced?
 */

interface BlockersFile {
  episodeNumber: number;
  sceneId: string;
  findings?: RealizationTaskGateFinding[];
  realizationTasks?: NarrativeRealizationTask[];
  repairHistory?: Array<{
    attempt: number;
    outcome: string;
    capacityTier?: string;
    error?: string;
    adopted?: boolean;
    resolvedFingerprints?: string[];
    introducedFingerprints?: string[];
  }>;
}

interface AttemptFile {
  attempt: number;
  sceneId: string;
  adopted?: boolean;
  repairTarget?: { fingerprint?: string };
  previousFindings?: RealizationTaskGateFinding[];
  candidateFindings?: RealizationTaskGateFinding[];
  resolvedFingerprints?: string[];
  introducedFingerprints?: string[];
}

function unionMissingAtomCount(findings: RealizationTaskGateFinding[]): number {
  return new Set(findings.flatMap((finding) => [
    ...(finding.missingEvidenceAtoms ?? []),
    ...(finding.matchedForbiddenAtoms ?? []),
  ])).size;
}

/** Mirrors the ContentGenerationPhase capacity math; update both together. */
function operationCapacity(missingAtoms: number): { standard: number; expanded: number } {
  return {
    standard: Math.min(4, Math.max(3, missingAtoms + 1)),
    expanded: Math.min(5, Math.max(4, missingAtoms + 1)),
  };
}

function readJson<T>(file: string): T | undefined {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
  } catch {
    return undefined;
  }
}

function main(): void {
  const args = process.argv.slice(2);
  const runDir = args.find((arg) => !arg.startsWith('--'));
  if (!runDir || !fs.existsSync(runDir)) {
    console.error('Usage: npm run replay:owner-repair -- <run-dir> [--scene <sceneId>] [--out <report.json>]');
    process.exit(2);
  }
  const sceneFilter = args.includes('--scene') ? args[args.indexOf('--scene') + 1] : undefined;
  const outPath = args.includes('--out') ? args[args.indexOf('--out') + 1] : undefined;

  const entries = fs.readdirSync(runDir);
  const blockerFiles = entries
    .filter((name) => /^episode-\d+-scene-.+-realization-blockers\.json$/.test(name))
    .filter((name) => !sceneFilter || name.includes(`-scene-${sceneFilter}-`));
  if (blockerFiles.length === 0) {
    console.log(`No realization-blockers diagnostics in ${runDir}${sceneFilter ? ` for scene ${sceneFilter}` : ''}.`);
    process.exit(0);
  }

  const report: Record<string, unknown>[] = [];
  for (const blockerName of blockerFiles.sort()) {
    const blockers = readJson<BlockersFile>(path.join(runDir, blockerName));
    if (!blockers) continue;
    const tasks = blockers.realizationTasks ?? [];
    const findings = blockers.findings ?? [];
    const critical = findings.filter((finding) => isCriticalOwnerRealizationFinding(finding, tasks));
    const deferrable = findings.filter((finding) => !isCriticalOwnerRealizationFinding(finding, tasks));
    const missingAtoms = unionMissingAtomCount(findings);
    const capacity = operationCapacity(missingAtoms);
    const terminal = critical.length > 0
      ? `ABORT (${critical.length} critical finding(s))`
      : 'DEFER to episode-contract repair (run continues)';

    console.log(`\n=== ${blockers.sceneId} (episode ${blockers.episodeNumber}) — ${blockerName}`);
    for (const finding of findings) {
      const isCritical = isCriticalOwnerRealizationFinding(finding, tasks);
      const atoms = [...(finding.missingEvidenceAtoms ?? []), ...(finding.matchedForbiddenAtoms ?? [])];
      console.log(`  ${isCritical ? 'CRITICAL ' : 'deferrable'} ${finding.code} ${finding.taskId}`);
      if (atoms.length > 0) console.log(`             missing/forbidden atoms: ${atoms.join(', ')}`);
    }
    console.log(`  union missing atoms: ${missingAtoms} → patch capacity standard=${capacity.standard} expanded=${capacity.expanded}`);
    console.log(`  terminal policy now: ${terminal}`);

    const attemptReplays: Record<string, unknown>[] = [];
    const attemptFiles = entries
      .filter((name) => name.startsWith(`episode-${blockers.episodeNumber}-scene-${blockers.sceneId}-owner-repair-attempt-`))
      .sort();
    for (const attemptName of attemptFiles) {
      const attempt = readJson<AttemptFile>(path.join(runDir, attemptName));
      if (!attempt?.previousFindings || !attempt.candidateFindings) continue;
      const adoptNow = shouldAdoptOwnerRepairCandidate({
        previous: attempt.previousFindings,
        candidate: attempt.candidateFindings,
        targetFingerprint: attempt.repairTarget?.fingerprint ?? '',
      });
      const changed = adoptNow !== Boolean(attempt.adopted);
      console.log(`  attempt ${attempt.attempt}: recorded adopted=${Boolean(attempt.adopted)} → current policy adopts=${adoptNow}${changed ? '   ← CHANGED' : ''}`
        + ` (resolved ${attempt.resolvedFingerprints?.length ?? 0}, introduced ${attempt.introducedFingerprints?.length ?? 0})`);
      attemptReplays.push({
        file: attemptName,
        attempt: attempt.attempt,
        recordedAdopted: Boolean(attempt.adopted),
        currentPolicyAdopts: adoptNow,
        resolved: attempt.resolvedFingerprints ?? [],
        introduced: attempt.introducedFingerprints ?? [],
      });
    }

    report.push({
      file: blockerName,
      sceneId: blockers.sceneId,
      episodeNumber: blockers.episodeNumber,
      findings: findings.map((finding) => ({
        code: finding.code,
        taskId: finding.taskId,
        critical: isCriticalOwnerRealizationFinding(finding, tasks),
        missingEvidenceAtoms: finding.missingEvidenceAtoms ?? [],
        matchedForbiddenAtoms: finding.matchedForbiddenAtoms ?? [],
      })),
      unionMissingAtoms: missingAtoms,
      patchCapacity: capacity,
      terminalPolicy: critical.length > 0 ? 'abort' : 'defer',
      recordedRepairHistory: blockers.repairHistory ?? [],
      attemptReplays,
    });
  }

  if (outPath) {
    fs.writeFileSync(outPath, JSON.stringify({ runDir, generatedAt: new Date().toISOString(), scenes: report }, null, 2));
    console.log(`\nReport written to ${outPath}`);
  }
}

main();
