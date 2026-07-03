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
import { analyzeEncounterDepth, deepenRootTerminalWins, shrinkClockToAttainable } from '../utils/encounterDepthContract';
import { isGateEnabled } from '../remediation/gateDefaults';
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

/** All player-facing prose strings in an encounter tree (judge/scan input). */
export function collectEncounterProseStrings(encounter: unknown): string[] {
  const prose: string[] = [];
  collectEncounterProse(encounter, prose);
  return prose;
}

/**
 * Template signatures present anywhere in an encounter's player-facing prose.
 * Shared by this validator (final contract, defense-in-depth) and by
 * ContentGenerationPhase's generation-time acceptance check (no-boilerplate
 * mandate: an encounter is never ACCEPTED while any signature remains, so
 * template prose can't survive to the final contract in the first place).
 */
export function scanEncounterTemplateProse(encounter: unknown): string[] {
  const prose: string[] = [];
  collectEncounterProse(encounter, prose);
  const found = new Set<string>();
  for (const text of prose) {
    for (const sig of findTemplateSignatures(text)) found.add(sig);
  }
  return [...found];
}

const MALFORMED_SECOND_PERSON_PATTERNS: Array<{ id: string; pattern: RegExp }> = [
  { id: 'you-kiss-takes', pattern: /\bYou kiss takes\b/i },
  { id: 'you-maze-exit', pattern: /\byou maze' exit\b/i },
  { id: 'you-rooftop', pattern: /\byou rooftop\b/i },
  { id: 'you-proper-noun-phrase', pattern: /\bYou\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3}\b/ },
  {
    id: 'you-possessive-noun-after-preposition',
    pattern:
      /\b(?:on|in|into|from|across|near|at|under|through|between|behind|before|after|inside|outside|against|over|around|beside)\s+you\s+(?:bar|candle|door|hedge|maze|photograph|pulse|roof|rooftop|stair|stairs|way|window)\b/i,
  },
  {
    id: 'imperative-you-adjective-noun',
    pattern:
      /\b(?:Hold|Take|Leave|Follow|Refuse|Drink|Kiss|Touch|Open|Close|Guard|Keep)\s+you\s+(?:charcoal|dark|cold|flannel|warm|wine|dead-end)\b/i,
  },
  { id: 'you-verb-fragment', pattern: /\byou\s+(?:freez|ly|crosses|takes)\b/i },
];

/**
 * Deterministic scan for malformed second-person replacement residue in encounter
 * prose. These are not style complaints; they are broken player-facing strings
 * produced by possessive/protagonist rewrite passes ("you rooftop", "You kiss
 * takes"). The pattern list is deliberately narrow so valid phrasing such as
 * "you watch the bar" is not flagged.
 */
export function scanMalformedEncounterProse(encounter: unknown): string[] {
  const found = new Set<string>();
  for (const raw of collectEncounterProseStrings(encounter)) {
    const text = raw.replace(/\s+/g, ' ').trim();
    if (!text) continue;
    for (const { id, pattern } of MALFORMED_SECOND_PERSON_PATTERNS) {
      const match = text.match(pattern);
      if (!match) continue;
      const snippet = text.length > 180 ? `${text.slice(0, 177)}...` : text;
      found.add(`${id}: ${snippet}`);
      break;
    }
  }
  return [...found];
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
        const found = new Set<string>(scanEncounterTemplateProse(encounter));
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

        const malformed = scanMalformedEncounterProse(encounter);
        if (malformed.length > 0) {
          blockingIssues.push({
            type: 'encounter_malformed_prose',
            severity: 'error',
            message: `Encounter in scene "${scene.id}" contains malformed second-person prose (${malformed.slice(0, 3).join('; ')}).`,
            episodeId: episode.id,
            episodeNumber: episode.number,
            sceneId: scene.id,
            validator: 'EncounterQualityValidator',
            suggestion: 'Apply an unambiguous possessive rewrite where possible; otherwise regenerate the affected encounter section.',
          });
        }

        // (2) Clock-coverage gap. Only acted on when telemetry confirms the
        // encounter DEGRADED — on a healthy build, Phase-2 branches are nested
        // inside outcomes (not counted as separate phases), so the coverage
        // heuristic would undercount and false-positive. A degraded encounter
        // genuinely lost those branches, so the undercount is real there.
        // (3) Depth contract (G12): a root-level terminal victory makes the
        // bottleneck set-piece winnable in one click; a goal clock no authored
        // path can fill renders an objective that never completes. The clock
        // half is autofixed (shrinkClockToAttainable) by applyEncounterQualityGate;
        // the one-click win needs regen, so it blocks under the depth gate.
        {
          const depth = analyzeEncounterDepth(encounter as never);
          for (const win of depth.oneClickWins) {
            const issue = {
              type: 'encounter_one_click_win' as const,
              severity: (isGateEnabled('GATE_ENCOUNTER_SETPIECE_DEPTH') ? 'error' : 'warning') as 'error' | 'warning',
              message: `Encounter in scene "${scene.id}" can be won in a single click: root choice "${win.choiceId}" is a terminal ${win.outcome}${win.hasConsequences ? '' : ' with zero consequences'}. The set-piece has no middle.`,
              episodeId: episode.id,
              episodeNumber: episode.number,
              sceneId: scene.id,
              validator: 'EncounterQualityValidator',
              suggestion: 'Terminal victory/partialVictory must sit at least two choice layers deep, and every terminal must carry consequences.',
            };
            if (issue.severity === 'error') blockingIssues.push(issue);
            else warnings.push(issue);
          }
          if (depth.maxGoalTicks > 0 && depth.goalSegments > depth.maxGoalTicks) {
            warnings.push({
              type: 'encounter_clock_coverage_gap',
              severity: 'warning',
              message: `Encounter in scene "${scene.id}" has a ${depth.goalSegments}-segment goal clock but the best authored path ticks only ${depth.maxGoalTicks} — the objective can never visibly complete. Autofix shrinks the clock to attainable.`,
              episodeId: episode.id,
              episodeNumber: episode.number,
              sceneId: scene.id,
              validator: 'EncounterQualityValidator',
              suggestion: 'Author enough goalTicks across the tree, or let shrinkClockToAttainable size the clock honestly.',
            });
          }
        }

        // (4) Skill monoculture inside the encounter tree (G12: perception held
        // 57% of slots across the season's encounters — "always pick perception"
        // becomes the meta). Advisory; the architect prompt now caps this upstream.
        {
          const skillCounts = new Map<string, number>();
          let slots = 0;
          const seen = new Set<object>();
          const tally = (node: unknown): void => {
            if (!node || typeof node !== 'object' || seen.has(node)) return;
            seen.add(node as object);
            if (Array.isArray(node)) { for (const n of node) tally(n); return; }
            const obj = node as Record<string, unknown>;
            if (typeof obj.primarySkill === 'string' && obj.primarySkill.trim()) {
              const k = obj.primarySkill.toLowerCase();
              skillCounts.set(k, (skillCounts.get(k) ?? 0) + 1);
              slots += 1;
            }
            for (const v of Object.values(obj)) if (v && typeof v === 'object') tally(v);
          };
          tally(encounter);
          if (slots >= 6) {
            const [topSkill, topCount] = [...skillCounts.entries()].sort((a, b) => b[1] - a[1])[0];
            const share = topCount / slots;
            if (share > 0.4) {
              warnings.push({
                type: 'invalid_encounter',
                severity: 'warning',
                message: `Encounter in scene "${scene.id}": skill "${topSkill}" carries ${(share * 100).toFixed(0)}% of ${slots} choice slots — a single-skill meta. Cap any one skill at ~40% of encounter slots.`,
                episodeId: episode.id,
                episodeNumber: episode.number,
                sceneId: scene.id,
                validator: 'EncounterQualityValidator',
                suggestion: 'Rotate primarySkill across the tree (persuasion/deception/investigation/etc.) so no single approach dominates.',
              });
            }
          }
        }

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
      // G13 one-click-win pass (telemetry-independent): demote root-level
      // terminal wins into a two-step finish (appended flat finish beat) so the
      // depth contract holds without a regen. Runs BEFORE the clock shrink so
      // the injected finish ticks are counted. Idempotent.
      const deepen = deepenRootTerminalWins(sceneEnc as never);
      for (const flat of deepen.flatRouted) {
        console.info(
          `[EncounterQuality] scene ${scene.id}: root terminal ${flat.outcome} on choice ${flat.choiceId} routed to finish beat ${flat.finishBeatId}`,
        );
      }
      for (const skip of deepen.skipped) {
        console.warn(
          `[EncounterQuality] scene ${scene.id}: root terminal ${skip.outcome} on choice ${skip.choiceId} NOT repairable (degenerate no-beats phase) — will block`,
        );
      }
      // G12 honest-clock pass (telemetry-independent): if no authored path can
      // fill the goal clock, shrink it to the best attainable ticks so perfect
      // play visibly completes the objective. Idempotent; no-op when healthy.
      const shrink = shrinkClockToAttainable(sceneEnc as never);
      if (shrink.goalShrunk) {
        console.info(
          `[EncounterQuality] scene ${scene.id}: goal clock shrunk ${shrink.goalFrom}→${shrink.goalTo} (best attainable ticks)`,
        );
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
