import type { Story } from '../../types/story';
import { contractRepairIssueFingerprint, type ContractRepairHandler, type ContractRepairReport } from './finalContractRepair';

export interface EncounterRouteAuthor {
  reauthorEncounterRoute(input: {
    encounterTree: unknown;
    outcomeTier: string;
    missingEvidence: string[];
    sourceText?: string;
    sceneName?: string;
  }): Promise<number>;
}

function routeIssues(issues: ContractRepairReport['blockingIssues']): ContractRepairReport['blockingIssues'] {
  return issues.filter((issue) => issue.repairHandler === 'encounter_route' || issue.outcomeTier);
}

export function buildEncounterRouteRepairHandler(options: {
  author: () => EncounterRouteAuthor | null;
  emit?: (message: string) => void;
  maxRoutesPerRound?: number;
}): ContractRepairHandler {
  return async ({ story, blockingIssues }) => {
    const issues = routeIssues(blockingIssues).filter((issue) => issue.sceneId && issue.outcomeTier);
    if (issues.length === 0) return { story, changed: false };
    const author = options.author();
    if (!author) return { story, changed: false };

    const attemptedIssueKeys: string[] = [];
    let repaired = 0;
    const selected = issues.slice(0, options.maxRoutesPerRound ?? 4);
    for (const issue of selected) {
      attemptedIssueKeys.push(contractRepairIssueFingerprint(issue));
      const scene = story.episodes
        .flatMap((episode) => episode.scenes ?? [])
        .find((candidate) => candidate.id === issue.sceneId);
      if (!scene?.encounter) continue;
      const count = await author.reauthorEncounterRoute({
        encounterTree: scene.encounter,
        outcomeTier: issue.outcomeTier!,
        missingEvidence: issue.missingEvidenceAtoms ?? [issue.message ?? 'route realization'],
        sourceText: issue.message,
        sceneName: scene.name,
      });
      repaired += count;
    }
    if (repaired === 0) return { story, changed: false, attemptedIssueKeys };
    options.emit?.(`Encounter route repair re-authored ${repaired} route surface(s).`);
    return {
      story,
      changed: true,
      attemptedIssueKeys,
      record: {
        rule: 'final_contract_encounter_route',
        scope: 'encounter',
        attempted: selected.length,
        succeeded: repaired === selected.length,
        degraded: repaired < selected.length,
        blocked: false,
        attempts: selected.length,
        details: `Re-authored ${repaired} encounter route surface(s) with explicit missing-evidence context`,
      },
    };
  };
}
