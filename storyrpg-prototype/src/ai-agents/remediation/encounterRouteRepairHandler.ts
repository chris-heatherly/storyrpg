import type { Story } from '../../types/story';
import type { NarrativeRealizationTask } from '../../types/narrativeContract';
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

function outcomeTierFromFieldPath(fieldPath: string | undefined): string | undefined {
  return /\.outcomes\.([A-Za-z0-9_-]+)(?:\.|$)/.exec(fieldPath ?? '')?.[1];
}

function routeIssues(issues: ContractRepairReport['blockingIssues']): ContractRepairReport['blockingIssues'] {
  return issues.filter((issue) =>
    issue.repairHandler === 'encounter_route'
    || issue.outcomeTier
    || (issue.type === 'unsafe_fallback_prose' && outcomeTierFromFieldPath(issue.fieldPath))
  );
}

/**
 * Translate opaque atom IDs into the authored meaning the re-author must put
 * on the page. An LLM told to satisfy
 * "event:ep1-u6:rescue:evidence:1:complicated" can only guess; told
 * "action evidence for event:ep1-u6 on complicated: rescue / saved" it can
 * write the line.
 */
function describeMissingEvidence(
  issue: ContractRepairReport['blockingIssues'][number],
  tasksById: Map<string, NarrativeRealizationTask> | undefined,
): string[] {
  const atomIds = issue.missingEvidenceAtoms ?? [];
  if (atomIds.length === 0) return [issue.message ?? 'route realization'];
  const task = issue.taskId ? tasksById?.get(issue.taskId) : undefined;
  return atomIds.map((atomId) => {
    const atom = task?.evidenceAtoms.find((candidate) => candidate.id === atomId);
    if (!atom) return atomId;
    const patterns = (atom.acceptedPatterns ?? []).filter(Boolean);
    return `${atom.description}${patterns.length > 0 ? ` (accepted evidence: ${patterns.join(' / ')})` : ''}`;
  });
}

export function buildEncounterRouteRepairHandler(options: {
  author: () => EncounterRouteAuthor | null;
  emit?: (message: string) => void;
  maxRoutesPerRound?: number;
  /** Realization tasks keyed by id, for atom-ID → authored-meaning translation. */
  tasksById?: () => Map<string, NarrativeRealizationTask> | undefined;
}): ContractRepairHandler {
  return async ({ story, blockingIssues }) => {
    const issues = routeIssues(blockingIssues)
      .map((issue) => ({ ...issue, outcomeTier: issue.outcomeTier ?? outcomeTierFromFieldPath(issue.fieldPath) }))
      .filter((issue) => issue.sceneId && issue.outcomeTier);
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
        missingEvidence: describeMissingEvidence(issue, options.tasksById?.()),
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
