/**
 * Episode Spine Contract Validator
 *
 * Blocking gate on the canonical ESC before blueprint elaboration. Ensures unit
 * order, prerequisites, one-location rule, and Story Circle facet coverage.
 */

import type { EpisodeSpineContract } from '../../types/episodeSpine';
import type { PlannedScene } from '../../types/scenePlan';
import { BaseValidator, ValidationIssue, ValidationResult } from './BaseValidator';
import { plannedGroupFormation } from '../utils/relationshipPacingStagePolicy';

export interface EpisodeSpineValidationInput {
  spine: EpisodeSpineContract;
  scenes?: PlannedScene[];
}

export class EpisodeSpineContractValidator extends BaseValidator {
  constructor() {
    super('EpisodeSpineContractValidator');
  }

  validate(input: EpisodeSpineValidationInput): ValidationResult {
    const issues: ValidationIssue[] = [];
    const { spine, scenes = [] } = input;

    if (!spine.units.length) {
      issues.push(this.error(
        `Episode ${spine.episodeNumber} spine has no units.`,
        `episodeSpine:${spine.episodeNumber}`,
        'Decompose treatment turns into atomic spine units before planning scenes.',
      ));
      return finalize(issues);
    }

    this.checkUnitOrder(spine, issues);
    this.checkPrerequisites(spine, issues);
    this.checkOneLocationPerUnit(spine, issues);
    this.checkStoryCircleFacets(spine, issues);
    this.checkSceneProjection(spine, scenes, issues);
    this.checkRelationshipPacingProjection(scenes, issues);

    const errors = issues.filter((issue) => issue.severity === 'error').length;
    return {
      valid: errors === 0,
      score: errors === 0 ? 100 : Math.max(0, 100 - errors * 20),
      issues,
      suggestions: issues.map((issue) => issue.suggestion).filter((value): value is string => Boolean(value)),
    };
  }

  private checkUnitOrder(spine: EpisodeSpineContract, issues: ValidationIssue[]): void {
    for (let i = 0; i < spine.units.length; i += 1) {
      if (spine.units[i].order !== i) {
        issues.push(this.error(
          `Episode ${spine.episodeNumber} spine unit "${spine.units[i].id}" has order ${spine.units[i].order} but sits at index ${i}.`,
          spine.units[i].id,
          'Spine unit order must be contiguous and 0-based.',
        ));
      }
    }
  }

  private checkPrerequisites(spine: EpisodeSpineContract, issues: ValidationIssue[]): void {
    const byId = new Map(spine.units.map((unit) => [unit.id, unit]));
    for (const unit of spine.units) {
      for (const prereqId of unit.prerequisites) {
        const prereq = byId.get(prereqId);
        if (!prereq || prereq.order >= unit.order) {
          issues.push(this.error(
            `Episode ${spine.episodeNumber} spine unit "${unit.id}" lists invalid prerequisite "${prereqId}".`,
            `${unit.id}:prerequisites`,
          ));
        }
      }
    }
  }

  private checkOneLocationPerUnit(spine: EpisodeSpineContract, issues: ValidationIssue[]): void {
    for (const unit of spine.units) {
      if (unit.sceneKind === 'encounter') continue;
      if (!unit.locationId?.trim()) {
        issues.push(this.error(
          `Episode ${spine.episodeNumber} spine unit "${unit.id}" has no locationId.`,
          `${unit.id}:locationId`,
          'Every standard spine unit must declare exactly one canonical location.',
        ));
      }
    }
  }

  private checkStoryCircleFacets(spine: EpisodeSpineContract, issues: ValidationIssue[]): void {
    if (spine.episodeStoryCircleBeats.length === 0) return;
    const primaryBeat = spine.episodeStoryCircleBeats.find((beat) => beat);
    if (!primaryBeat) return;
    const hasPrimaryFacet = spine.units.some((unit) => unit.storyCircleFacets.includes(primaryBeat));
    if (!hasPrimaryFacet) {
      issues.push(this.error(
        `Episode ${spine.episodeNumber} spine does not advance primary Story Circle beat "${primaryBeat}".`,
        `episodeSpine:${spine.episodeNumber}:storyCircle`,
        'Assign storyCircleFacets on spine units that realize the episode role.',
      ));
    }
  }

  private checkSceneProjection(
    spine: EpisodeSpineContract,
    scenes: PlannedScene[],
    issues: ValidationIssue[],
  ): void {
    if (scenes.length === 0) return;
    const unitById = new Map(spine.units.map((unit) => [unit.id, unit]));
    const unitIds = new Set(unitById.keys());

    for (const scene of scenes) {
      if (scene.spineUnitId && !unitIds.has(scene.spineUnitId)) {
        issues.push(this.error(
          `Planned scene "${scene.id}" references unknown spine unit "${scene.spineUnitId}".`,
          scene.id,
        ));
      }
    }

    const projected = scenes
      .filter((scene) => scene.spineUnitId && unitById.has(scene.spineUnitId))
      .slice()
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.id.localeCompare(b.id));

    let previousUnitOrder = Number.NEGATIVE_INFINITY;
    for (const scene of projected) {
      const unit = unitById.get(scene.spineUnitId!)!;
      if (unit.order <= previousUnitOrder) {
        issues.push(this.error(
          `Planned scenes with spineUnitId are out of ESC order: "${scene.id}" (unit ${unit.id} order ${unit.order}) follows a later-or-equal unit.`,
          scene.id,
          'Reconcile PlannedScene.order to Episode Spine Contract unit.order before blueprint elaboration.',
        ));
      }
      previousUnitOrder = unit.order;

      for (const prereqId of unit.prerequisites) {
        const prereq = unitById.get(prereqId);
        if (!prereq) continue;
        const prereqScene = projected.find((candidate) => candidate.spineUnitId === prereqId);
        if (!prereqScene) {
          issues.push(this.error(
            `Spine unit "${unit.id}" prerequisite "${prereqId}" is not projected onto any planned scene before "${scene.id}".`,
            scene.id,
          ));
          continue;
        }
        if ((prereqScene.order ?? 0) >= (scene.order ?? 0)) {
          issues.push(this.error(
            `Spine unit "${unit.id}" prerequisite "${prereqId}" maps to scene "${prereqScene.id}" at order ${prereqScene.order}, which is not earlier than "${scene.id}" (order ${scene.order}).`,
            scene.id,
            'Prerequisites must project to earlier PlannedScene.order values.',
          ));
        }
      }
    }
  }

  private checkRelationshipPacingProjection(scenes: PlannedScene[], issues: ValidationIssue[]): void {
    for (const scene of scenes) {
      const group = plannedGroupFormation(scene);
      if (!group) continue;
      if ((scene.relationshipPacing ?? []).length === 0) {
        issues.push(this.error(
          `Planned scene "${scene.id}" stages group formation ("${group}") without relationshipPacing contracts.`,
          scene.id,
          'Attach group formation pacing contracts when the spine projects a bond unit.',
        ));
      }
    }
  }
}

function finalize(issues: ValidationIssue[]): ValidationResult {
  const errors = issues.filter((issue) => issue.severity === 'error').length;
  return {
    valid: errors === 0,
    score: errors === 0 ? 100 : 0,
    issues,
    suggestions: [],
  };
}
