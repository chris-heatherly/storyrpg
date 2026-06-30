import type { EpisodeBlueprint, SceneBlueprint } from '../agents/StoryArchitect';
import {
  BLUEPRINT_CONTRACT_HYGIENE_PATTERNS,
  BLUEPRINT_SCANNED_SCENE_FIELDS,
  type BlueprintHygieneIssueType,
} from '../utils/blueprintTextHygiene';

export interface BlueprintContractHygieneIssue {
  validator: 'BlueprintContractHygieneValidator';
  severity: 'error' | 'warning';
  type: BlueprintHygieneIssueType;
  message: string;
  path: string;
  sceneId?: string;
  excerpt: string;
  pattern: string;
}

export interface BlueprintContractHygieneReport {
  passed: boolean;
  blockingIssues: BlueprintContractHygieneIssue[];
  warnings: BlueprintContractHygieneIssue[];
  fieldsScanned: number;
}

export class BlueprintContractHygieneValidator {
  validate(blueprint: EpisodeBlueprint): BlueprintContractHygieneReport {
    const blockingIssues: BlueprintContractHygieneIssue[] = [];
    const warnings: BlueprintContractHygieneIssue[] = [];
    let fieldsScanned = 0;

    const scan = (value: unknown, path: string, scene?: SceneBlueprint): void => {
      if (typeof value !== 'string' || value.trim().length === 0) return;
      fieldsScanned += 1;
      for (const candidate of BLUEPRINT_CONTRACT_HYGIENE_PATTERNS) {
        if (!candidate.pattern.test(value)) continue;
        const issue: BlueprintContractHygieneIssue = {
          validator: 'BlueprintContractHygieneValidator',
          severity: 'error',
          type: candidate.type,
          message: `Blueprint field contains ${candidate.label}; route back to plan repair before SceneWriter.`,
          path,
          sceneId: scene?.id,
          excerpt: excerpt(value, candidate.pattern),
          pattern: candidate.label,
        };
        blockingIssues.push(issue);
      }
    };

    blueprint.scenes?.forEach((scene, sceneIndex) => {
      for (const field of BLUEPRINT_SCANNED_SCENE_FIELDS) {
        scan((scene as unknown as Record<string, unknown>)[field], `scenes[${sceneIndex}].${field}`, scene);
      }
      scene.requiredBeats?.forEach((beat, beatIndex) => {
        scan(beat.sourceTurn, `scenes[${sceneIndex}].requiredBeats[${beatIndex}].sourceTurn`, scene);
        scan(beat.mustDepict, `scenes[${sceneIndex}].requiredBeats[${beatIndex}].mustDepict`, scene);
      });
      if (scene.choicePoint) {
        scan(scene.choicePoint.description, `scenes[${sceneIndex}].choicePoint.description`, scene);
        scan(scene.choicePoint.stakes?.want, `scenes[${sceneIndex}].choicePoint.stakes.want`, scene);
        scan(scene.choicePoint.stakes?.cost, `scenes[${sceneIndex}].choicePoint.stakes.cost`, scene);
        scan(scene.choicePoint.stakes?.identity, `scenes[${sceneIndex}].choicePoint.stakes.identity`, scene);
      }
      if (scene.turnContract) {
        for (const [key, value] of Object.entries(scene.turnContract)) {
          scan(value, `scenes[${sceneIndex}].turnContract.${key}`, scene);
        }
      }
    });

    return {
      passed: blockingIssues.length === 0,
      blockingIssues,
      warnings,
      fieldsScanned,
    };
  }
}

function excerpt(text: string, pattern: RegExp): string {
  const match = pattern.exec(text);
  const start = Math.max(0, (match?.index ?? 0) - 50);
  return text.slice(start, start + 180).replace(/\s+/g, ' ').trim();
}
