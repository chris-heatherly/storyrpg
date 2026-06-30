/**
 * Scene Spine Validator
 *
 * Validates a season-level {@link SeasonScenePlan} (scene-first planning). It
 * checks structural integrity of the spine and the setup/payoff graph:
 *   - every episode carries at least one scene;
 *   - scene ids are unique and ordering is well-formed;
 *   - every `setsUp` / `paysOff` reference resolves to a real scene;
 *   - the setup/payoff graph is consistent (each edge's endpoints agree) with
 *     no dangling setups (a planted setup nobody discharges) or orphan payoffs
 *     (a discharge with no matching setup);
 *   - cross-episode edges always point FORWARD (a setup pays off later, never
 *     earlier) — the path-aware integrity that scene-first planning exists to
 *     guarantee.
 *
 * This is a season-altitude validator and runs after the scene plan is built.
 * Default-advisory: it returns issues for the diagnostics trail; gating to
 * blocking is the caller's choice.
 */

import { BaseValidator, ValidationIssue, ValidationResult } from './BaseValidator';
import type { PlannedScene, SeasonScenePlan } from '../../types/scenePlan';

export class SceneSpineValidator extends BaseValidator {
  constructor() {
    super('SceneSpineValidator');
  }

  validate(scenePlan: SeasonScenePlan): ValidationResult {
    const issues: ValidationIssue[] = [];
    const scenes = scenePlan.scenes ?? [];

    if (scenes.length === 0) {
      issues.push(this.error('Scene plan is empty.', 'scenePlan', 'Plan at least one scene per episode.'));
      return finalize(issues);
    }

    // Unique ids + lookup by id.
    const byId = new Map<string, PlannedScene>();
    for (const scene of scenes) {
      if (byId.has(scene.id)) {
        issues.push(this.error(`Duplicate scene id "${scene.id}".`, scene.id, 'Scene ids must be unique across the season.'));
      }
      byId.set(scene.id, scene);
    }

    // Every episode in byEpisode has at least one scene, and ordering is sane.
    for (const [epNum, ids] of Object.entries(scenePlan.byEpisode ?? {})) {
      if (!ids || ids.length === 0) {
        issues.push(this.error(`Episode ${epNum} has no planned scenes.`, `episode:${epNum}`, 'Every episode needs at least one scene.'));
      }
      const epScenes = scenes.filter((s) => String(s.episodeNumber) === String(epNum)).sort((a, b) => a.order - b.order);
      epScenes.forEach((s, i) => {
        if (s.order !== i) {
          issues.push(this.warning(
            `Episode ${epNum} scene "${s.id}" has order ${s.order} but sits at index ${i}.`,
            s.id,
            'Scene order should be contiguous and 0-based within an episode.',
          ));
        }
      });
    }

    // Setup/payoff reference integrity.
    for (const scene of scenes) {
      for (const target of scene.setsUp ?? []) {
        const to = byId.get(target);
        if (!to) {
          issues.push(this.error(
            `Scene "${scene.id}" sets up unknown scene "${target}".`,
            scene.id,
            'Every setsUp target must be a real scene id.',
          ));
          continue;
        }
        if (!(to.paysOff ?? []).includes(scene.id)) {
          issues.push(this.warning(
            `Scene "${scene.id}" sets up "${target}" but "${target}" does not list it as a payoff.`,
            scene.id,
            'setsUp and paysOff must agree (a planted setup needs a matching discharge).',
          ));
        }
        if (to.episodeNumber < scene.episodeNumber) {
          issues.push(this.error(
            `Scene "${scene.id}" (ep ${scene.episodeNumber}) sets up "${target}" in an EARLIER episode ${to.episodeNumber}.`,
            scene.id,
            'A setup must pay off in the same or a later episode, never earlier.',
          ));
        }
      }
      for (const source of scene.paysOff ?? []) {
        const from = byId.get(source);
        if (!from) {
          issues.push(this.error(
            `Scene "${scene.id}" pays off unknown scene "${source}".`,
            scene.id,
            'Every paysOff source must be a real scene id.',
          ));
          continue;
        }
        if (!(from.setsUp ?? []).includes(scene.id)) {
          issues.push(this.warning(
            `Scene "${scene.id}" pays off "${source}" but "${source}" does not list it as a setup.`,
            scene.id,
            'setsUp and paysOff must agree (an orphan payoff has no matching setup).',
          ));
        }
      }
    }

    // Edge endpoints must resolve and agree with the per-scene arrays.
    for (const edge of scenePlan.setupPayoffEdges ?? []) {
      const from = byId.get(edge.from);
      const to = byId.get(edge.to);
      if (!from || !to) {
        issues.push(this.error(
          `Setup/payoff edge ${edge.from} -> ${edge.to} references a missing scene.`,
          `${edge.from}->${edge.to}`,
          'Edge endpoints must be real scene ids.',
        ));
        continue;
      }
      const expectedSpan = from.episodeNumber === to.episodeNumber ? 'same_episode' : 'cross_episode';
      if (edge.span !== expectedSpan) {
        issues.push(this.warning(
          `Edge ${edge.from} -> ${edge.to} is marked ${edge.span} but spans ${expectedSpan}.`,
          `${edge.from}->${edge.to}`,
          'Edge span should match the episodes of its endpoints.',
        ));
      }
    }

    return finalize(issues);
  }
}

function finalize(issues: ValidationIssue[]): ValidationResult {
  const errors = issues.filter((i) => i.severity === 'error').length;
  const score = Math.max(0, 100 - errors * 10 - (issues.length - errors) * 2);
  return {
    valid: errors === 0,
    score,
    issues,
    suggestions: issues.map((i) => i.suggestion).filter((s): s is string => Boolean(s)),
  };
}
