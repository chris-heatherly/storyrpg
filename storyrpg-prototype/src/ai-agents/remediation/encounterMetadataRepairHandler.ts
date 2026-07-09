import type { Story } from '../../types/story';
import {
  contractRepairIssueFingerprint,
  type ContractRepairHandler,
  type ContractRepairReport,
} from './finalContractRepair';

export interface EncounterDescriptionAuthor {
  reauthorEncounterDescription(input: {
    currentDescription?: string;
    sourceSynopsis?: string;
    sceneName?: string;
    sceneProse?: string;
  }): Promise<string | undefined>;
}

export interface EncounterMetadataRepairOptions {
  author: () => EncounterDescriptionAuthor | null;
  emit?: (message: string) => void;
  maxScenesPerRound?: number;
}

type RepairIssue = ContractRepairReport['blockingIssues'][number];

function descriptionIssues(issues: RepairIssue[]): RepairIssue[] {
  return issues.filter((issue) =>
    issue.type === 'unsafe_fallback_prose'
    && issue.sceneId
    && issue.fieldPath === 'encounter.description');
}

/** LLM re-author for the exact shippable encounter metadata field. */
export function buildEncounterMetadataRepairHandler(
  options: EncounterMetadataRepairOptions,
): ContractRepairHandler {
  return async ({ story, blockingIssues }) => {
    const issues = descriptionIssues(blockingIssues);
    if (issues.length === 0) return { story, changed: false };

    const author = options.author();
    if (!author) return { story, changed: false };

    const selectedSceneIds = Array.from(new Set(issues.map((issue) => issue.sceneId!)))
      .slice(0, options.maxScenesPerRound ?? 4);
    const attemptedIssueKeys: string[] = [];
    let changed = 0;

    for (const sceneId of selectedSceneIds) {
      const scene = story.episodes
        .flatMap((episode) => episode.scenes ?? [])
        .find((candidate) => candidate.id === sceneId);
      const encounter = scene?.encounter as unknown as Record<string, unknown> | undefined;
      if (!scene || !encounter || typeof encounter.description !== 'string') continue;

      for (const issue of issues.filter((candidate) => candidate.sceneId === sceneId)) {
        attemptedIssueKeys.push(contractRepairIssueFingerprint(issue));
      }

      const currentDescription = encounter.description.trim();
      const firstEncounterSetup = ((encounter.phases as Array<{
        beats?: Array<{ setupText?: string }>;
      }> | undefined)?.[0]?.beats?.[0]?.setupText ?? '').trim();
      const next = await author.reauthorEncounterDescription({
        currentDescription,
        sceneName: scene.name,
        sceneProse: firstEncounterSetup || scene.beats?.[0]?.text,
      });
      if (!next || next === currentDescription) continue;
      encounter.description = next;
      changed += 1;
    }

    if (changed === 0) return { story, changed: false, attemptedIssueKeys };
    options.emit?.(`Encounter metadata repair re-authored ${changed} description field(s).`);
    return {
      story,
      changed: true,
      attemptedIssueKeys,
      record: {
        rule: 'final_contract_encounter_description',
        scope: 'encounter',
        attempted: selectedSceneIds.length,
        succeeded: changed === selectedSceneIds.length,
        degraded: changed < selectedSceneIds.length,
        blocked: false,
        attempts: selectedSceneIds.length,
        details: `Re-authored ${changed} encounter.description field(s) by exact validator path`,
      },
    };
  };
}
