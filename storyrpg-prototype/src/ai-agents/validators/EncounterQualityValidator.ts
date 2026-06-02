/**
 * EncounterQualityValidator (blocking, final stage)
 *
 * Catches the failure class the rest of the gate was blind to: an encounter that
 * shipped GENERIC TEMPLATE prose to the player instead of authored content (the
 * Endsong climax — situation prompt, choices, results, and all four outcome
 * storylets were `buildDeterministicFallback` / `createDefaultStorylet` filler).
 * The existing validators checked encounter STRUCTURE (clocks, phases, terminal
 * outcomes) but never that the prose was bespoke.
 *
 * Two checks:
 *  1. Template-signature scan (PRIMARY, blocking, telemetry-independent): any
 *     `TEMPLATE_SIGNATURES` fragment in player-facing encounter prose →
 *     `encounter_template_collapse`. Works on the final story alone.
 *  2. Clock-coverage gap (blocking only when telemetry says the encounter is
 *     degraded; advisory otherwise): a single-phase encounter whose goal clock
 *     exceeds its authored choices, after `shrinkClockToCoverage` should already
 *     have run — so anything left is a genuine unfilled gap.
 *
 * Emits FinalStoryContractIssue[] so the pipeline can merge results straight
 * into the final-story contract report.
 */

import type { Story } from '../../types';
import { findTemplateSignatures } from '../agents/EncounterArchitect';
import { computeAuthoredCoverage, isClockUnderCovered, shrinkClockToCoverage } from '../pipeline/encounterRemediation';
import type { FinalStoryContractIssue } from './FinalStoryContractValidator';

/** Per-scene encounter telemetry the pipeline can optionally supply. */
export interface EncounterTelemetrySummary {
  degraded?: boolean;
  phase4DefaultCollisions?: string[];
}

export interface EncounterQualityInput {
  story: Story;
  /** sceneId → telemetry. When absent, the clock-coverage check is advisory. */
  telemetryBySceneId?: Map<string, EncounterTelemetrySummary>;
}

export interface EncounterQualityReport {
  passed: boolean;
  blockingIssues: FinalStoryContractIssue[];
  warnings: FinalStoryContractIssue[];
}

/** Player-facing prose keys to scan within an encounter object. */
const PROSE_KEYS = new Set([
  'setupText',
  'text',
  'narrativeText',
  'outcomeText',
  'situationText',
  'resolutionText',
  'complication',
]);

// Encounter branch prose nests deep: a choice's outcome carries a
// `nextSituation` with its own choices/outcomes, which can carry ANOTHER
// nextSituation — so template prose routinely sits at depth ~10-15. The old
// limit of 8 stopped the scan BEFORE that prose, letting a templated branch
// (e.g. a phase-3 conditional choice's fallback nextSituation) ship undetected.
// Keep a generous cap purely as an infinite-recursion guard.
const PROSE_SCAN_MAX_DEPTH = 40;

/** Recursively collect player-facing prose strings from an encounter object. */
function collectEncounterProse(node: unknown, out: string[], depth = 0): void {
  if (node == null || depth > PROSE_SCAN_MAX_DEPTH) return;
  if (Array.isArray(node)) {
    for (const item of node) collectEncounterProse(item, out, depth + 1);
    return;
  }
  if (typeof node === 'object') {
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      if (typeof value === 'string') {
        if (PROSE_KEYS.has(key)) out.push(value);
      } else {
        collectEncounterProse(value, out, depth + 1);
      }
    }
  }
}

export class EncounterQualityValidator {
  validate(input: EncounterQualityInput): EncounterQualityReport {
    const blockingIssues: FinalStoryContractIssue[] = [];
    const warnings: FinalStoryContractIssue[] = [];

    for (const episode of input.story.episodes || []) {
      for (const scene of episode.scenes || []) {
        const encounter = (scene as any).encounter;
        if (!encounter) continue;

        // (1) Template-signature scan — reliable, telemetry-independent.
        const prose: string[] = [];
        collectEncounterProse(encounter, prose);
        const found = new Set<string>();
        for (const text of prose) {
          for (const sig of findTemplateSignatures(text)) found.add(sig);
        }
        if (found.size > 0) {
          blockingIssues.push({
            type: 'encounter_template_collapse',
            severity: 'error',
            message: `Encounter in scene "${scene.id}" ships generic template prose (matched ${found.size} fallback signature(s): ${[...found].slice(0, 3).map((s) => `"${s.slice(0, 40)}…"`).join(', ')}). The phased build degraded to boilerplate instead of authored content.`,
            episodeId: episode.id,
            episodeNumber: episode.number,
            sceneId: scene.id,
            validator: 'EncounterQualityValidator',
            suggestion: 'Regenerate the encounter (phase reliability) so player-facing prose is bespoke.',
          });
        }

        // (2) Clock-coverage gap. Only acted on when telemetry confirms the
        // encounter DEGRADED — on a healthy build, Phase-2 branches are nested
        // inside outcomes (not counted as separate phases), so the coverage
        // heuristic would undercount and false-positive. A degraded encounter
        // genuinely lost those branches, so the undercount is real there.
        const telemetry = input.telemetryBySceneId?.get(scene.id);
        if (telemetry?.degraded === true && isClockUnderCovered(encounter)) {
          const cov = computeAuthoredCoverage(encounter);
          blockingIssues.push({
            type: 'encounter_clock_coverage_gap',
            severity: 'error',
            message: `Encounter in scene "${scene.id}" degraded (telemetry) and has a goal clock of ${cov.goalSegments} segment(s) but only ${cov.authoredChoices} authored choice(s) across ${cov.authoredPhases} phase(s) — the clock cannot be filled by authored content. shrinkClockToCoverage should have run.`,
            episodeId: episode.id,
            episodeNumber: episode.number,
            sceneId: scene.id,
            validator: 'EncounterQualityValidator',
            suggestion: 'Shrink the clock to authored coverage (shrinkClockToCoverage) or regenerate the missing phases.',
          });
        }
      }
    }

    return { passed: blockingIssues.length === 0, blockingIssues, warnings };
  }
}

/**
 * Thin orchestration helper so the pipeline monolith only delegates: build the
 * per-scene telemetry map from the raw telemetry array, run the validator, and
 * merge its findings into an existing contract-style report in place (blocking
 * issues flip `passed`). Kept here rather than in FullStoryPipeline to avoid
 * growing the monolith.
 */
export function applyEncounterQualityGate(
  report: { passed: boolean; blockingIssues: FinalStoryContractIssue[]; warnings: FinalStoryContractIssue[] },
  story: Story,
  encounterTelemetry: Array<{ sceneId?: string; degraded?: boolean; phase4DefaultCollisions?: string[] }> | undefined,
): void {
  const telemetryBySceneId = new Map<string, EncounterTelemetrySummary>();
  for (const t of encounterTelemetry || []) {
    if (!t?.sceneId) continue;
    const prev = telemetryBySceneId.get(t.sceneId);
    telemetryBySceneId.set(t.sceneId, {
      degraded: (prev?.degraded ?? false) || t.degraded === true,
      phase4DefaultCollisions: t.phase4DefaultCollisions,
    });
  }

  // REMEDIATION (runs on the runtime story the validator + save both see):
  // a degraded encounter left with a clock larger than its authored choices is
  // FIXABLE — shrink the clock to honest coverage (goal -> #choices, threat
  // scaled) so it ships playable instead of blocking the whole run. This is the
  // shrink rung of the regenerate->shrink->block ladder; the source-side shrink
  // in EncounterArchitect can be defeated by the agent->runtime conversion, so
  // we do the authoritative shrink here on the final object. Only unfixable
  // template-collapse (generic prose) should block; an oversized clock never
  // should.
  for (const episode of story.episodes || []) {
    for (const scene of episode.scenes || []) {
      const sceneEnc = (scene as { encounter?: unknown }).encounter;
      if (!sceneEnc) continue;
      const degraded = telemetryBySceneId.get(scene.id)?.degraded === true;
      if (degraded && isClockUnderCovered(sceneEnc as Parameters<typeof isClockUnderCovered>[0])) {
        shrinkClockToCoverage(sceneEnc as Parameters<typeof shrinkClockToCoverage>[0]);
      }
    }
  }

  const enc = new EncounterQualityValidator().validate({ story, telemetryBySceneId });
  if (enc.blockingIssues.length > 0) {
    report.blockingIssues.push(...enc.blockingIssues);
    report.passed = report.blockingIssues.length === 0;
  }
  if (enc.warnings.length > 0) report.warnings.push(...enc.warnings);
}
