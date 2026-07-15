import type { Story } from '../../types/story';
import type { NarrativeRealizationTask } from '../../types/narrativeContract';
import {
  contractRepairIssueFingerprint,
  type ContractRepairHandler,
  type ContractRepairReport,
} from './finalContractRepair';

/**
 * Final-contract executor for choice_reauthor findings — the last routed class
 * with no handler (bite-me_2026-07-14T23-29-29: the s1-4 choice-resolution
 * blocker was withheld as diagnostic_stop across all three repair rounds while
 * every other issue got its repair pass). Re-authors the route-invariant
 * shared payoff from the task's missing meanings and projects it into every
 * outcome tier of the scene's choice beats: the LLM writes the passage,
 * deterministic code only copies it.
 */

export interface SharedResolutionAuthor {
  reauthorSharedResolutionText(ctx: {
    currentPassage?: string;
    requiredMeanings: string[];
    sceneName?: string;
    protagonistName?: string;
    feedback?: string;
  }): Promise<string | undefined>;
}

type RepairIssue = ContractRepairReport['blockingIssues'][number];

function choiceResolutionIssues(issues: RepairIssue[]): RepairIssue[] {
  return issues.filter((issue) => issue.repairHandler === 'choice_reauthor' && issue.sceneId);
}

function missingMeanings(
  issue: RepairIssue,
  tasksById: Map<string, NarrativeRealizationTask> | undefined,
): string[] {
  const atomIds = issue.missingEvidenceAtoms ?? [];
  const task = issue.taskId ? tasksById?.get(issue.taskId) : undefined;
  const meanings = atomIds.map((atomId) => {
    const atom = task?.evidenceAtoms.find((candidate) => candidate.id === atomId);
    return atom ? atom.description : atomId;
  });
  return meanings.length > 0 ? meanings : [issue.message ?? 'the required choice resolution'];
}

interface ChoiceWithOutcomes {
  outcomeTexts?: Record<string, string | undefined>;
}

function sceneChoices(scene: { beats?: Array<{ choices?: unknown[] }> }): ChoiceWithOutcomes[] {
  return (scene.beats ?? []).flatMap((beat) =>
    ((beat.choices ?? []) as ChoiceWithOutcomes[]).filter((choice) => choice && typeof choice === 'object'));
}

export function buildChoiceResolutionRepairHandler(options: {
  author: () => SharedResolutionAuthor | null;
  tasksById?: () => Map<string, NarrativeRealizationTask> | undefined;
  emit?: (message: string) => void;
  maxScenesPerRound?: number;
}): ContractRepairHandler {
  return async ({ story, blockingIssues }) => {
    const issues = choiceResolutionIssues(blockingIssues);
    if (issues.length === 0) return { story, changed: false };
    const author = options.author();
    if (!author) return { story, changed: false };

    const attemptedIssueKeys: string[] = [];
    let repairedScenes = 0;
    const sceneIds = Array.from(new Set(issues.map((issue) => issue.sceneId!)))
      .slice(0, options.maxScenesPerRound ?? 2);
    for (const sceneId of sceneIds) {
      const sceneIssues = issues.filter((issue) => issue.sceneId === sceneId);
      for (const issue of sceneIssues) attemptedIssueKeys.push(contractRepairIssueFingerprint(issue));
      const scene = story.episodes
        .flatMap((episode) => episode.scenes ?? [])
        .find((candidate) => candidate.id === sceneId);
      if (!scene) continue;
      const choices = sceneChoices(scene as never).filter((choice) => choice.outcomeTexts);
      if (choices.length === 0) {
        options.emit?.(`Choice-resolution repair skipped ${sceneId}: no choice outcome surfaces found.`);
        continue;
      }
      const meanings = Array.from(new Set(sceneIssues.flatMap((issue) => missingMeanings(issue, options.tasksById?.()))));
      const sampleOutcome = choices[0].outcomeTexts?.success ?? Object.values(choices[0].outcomeTexts ?? {})[0];
      const passage = await author.reauthorSharedResolutionText({
        currentPassage: sampleOutcome,
        requiredMeanings: meanings,
        sceneName: (scene as { name?: string }).name,
        feedback: sceneIssues.map((issue) => issue.message).filter(Boolean).join('; '),
      });
      if (!passage) continue;
      // Route invariance: the authored payoff is appended once to every tier
      // that does not already carry it (materializeSharedChoiceResolution
      // semantics over the shipped story shape).
      const normalized = passage.toLowerCase();
      let projected = 0;
      for (const choice of choices) {
        for (const tier of Object.keys(choice.outcomeTexts ?? {})) {
          const existing = choice.outcomeTexts![tier]?.trim();
          if (!existing || existing.toLowerCase().includes(normalized)) continue;
          const separator = /[.!?…”]$/.test(existing) ? ' ' : '. ';
          choice.outcomeTexts![tier] = `${existing}${separator}${passage}`;
          projected += 1;
        }
      }
      if (projected > 0) repairedScenes += 1;
    }

    if (repairedScenes === 0) return { story, changed: false, attemptedIssueKeys };
    options.emit?.(`Choice-resolution repair re-authored the shared payoff for ${repairedScenes} scene(s).`);
    return {
      story,
      changed: true,
      attemptedIssueKeys,
      record: {
        rule: 'final_contract_choice_resolution',
        scope: 'choices',
        attempted: sceneIds.length,
        succeeded: repairedScenes === sceneIds.length,
        degraded: repairedScenes < sceneIds.length,
        blocked: false,
        attempts: sceneIds.length,
        details: `Re-authored route-invariant choice payoff for ${repairedScenes} scene(s) from missing-meaning context`,
      },
    };
  };
}
