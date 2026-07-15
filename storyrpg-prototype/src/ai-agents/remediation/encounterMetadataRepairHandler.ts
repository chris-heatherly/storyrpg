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

// Nested description surfaces leak planning prose too: run 23-29-29 carried a
// pasted treatment sentence in encounter.phases[0].description, which the
// exact-match filter below could never reach — the issue survived every round.
const DESCRIPTION_FIELD_PATH = /^encounter\.(description|phases\[\d+\]\.description|storylets\.[A-Za-z0-9_-]+\.description)$/;

function descriptionIssues(issues: RepairIssue[]): RepairIssue[] {
  return issues.filter((issue) =>
    issue.type === 'unsafe_fallback_prose'
    && issue.sceneId
    && typeof issue.fieldPath === 'string'
    && DESCRIPTION_FIELD_PATH.test(issue.fieldPath));
}

/** Resolve a matched description fieldPath to a get/set pair on the encounter. */
function resolveDescriptionField(
  encounter: Record<string, unknown>,
  fieldPath: string,
): { get: () => string | undefined; set: (value: string) => void } | undefined {
  if (fieldPath === 'encounter.description') {
    return typeof encounter.description === 'string'
      ? { get: () => encounter.description as string, set: (value) => { encounter.description = value; } }
      : undefined;
  }
  const phaseMatch = fieldPath.match(/^encounter\.phases\[(\d+)\]\.description$/);
  if (phaseMatch) {
    const phase = (encounter.phases as Array<Record<string, unknown>> | undefined)?.[Number(phaseMatch[1])];
    return phase && typeof phase.description === 'string'
      ? { get: () => phase.description as string, set: (value) => { phase.description = value; } }
      : undefined;
  }
  const storyletMatch = fieldPath.match(/^encounter\.storylets\.([A-Za-z0-9_-]+)\.description$/);
  if (storyletMatch) {
    const storylet = (encounter.storylets as Record<string, Record<string, unknown>> | undefined)?.[storyletMatch[1]];
    return storylet && typeof storylet.description === 'string'
      ? { get: () => storylet.description as string, set: (value) => { storylet.description = value; } }
      : undefined;
  }
  return undefined;
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

    const selected = issues.slice(0, options.maxScenesPerRound ?? 4);
    const attemptedIssueKeys: string[] = [];
    let changed = 0;

    for (const issue of selected) {
      attemptedIssueKeys.push(contractRepairIssueFingerprint(issue));
      const scene = story.episodes
        .flatMap((episode) => episode.scenes ?? [])
        .find((candidate) => candidate.id === issue.sceneId);
      const encounter = scene?.encounter as unknown as Record<string, unknown> | undefined;
      if (!scene || !encounter) continue;
      const field = resolveDescriptionField(encounter, issue.fieldPath!);
      if (!field) {
        options.emit?.(`Encounter metadata repair could not resolve ${issue.fieldPath} on ${issue.sceneId}.`);
        continue;
      }

      const currentDescription = (field.get() ?? '').trim();
      const firstEncounterSetup = ((encounter.phases as Array<{
        beats?: Array<{ setupText?: string }>;
      }> | undefined)?.[0]?.beats?.[0]?.setupText ?? '').trim();
      const next = await author.reauthorEncounterDescription({
        currentDescription,
        sceneName: scene.name,
        sceneProse: firstEncounterSetup || scene.beats?.[0]?.text,
      });
      if (!next || next === currentDescription) continue;
      field.set(next);
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
        attempted: selected.length,
        succeeded: changed === selected.length,
        degraded: changed < selected.length,
        blocked: false,
        attempts: selected.length,
        details: `Re-authored ${changed} encounter.description field(s) by exact validator path`,
      },
    };
  };
}
