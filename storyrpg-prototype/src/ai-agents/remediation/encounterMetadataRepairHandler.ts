import type { Story } from '../../types/story';
import { flagUnsafeReaderDescription } from '../constants/unsafeReaderText';
import {
  ENCOUNTER_DESCRIPTION_FIELD_PATH,
  resolveEncounterDescriptionField,
} from '../utils/readerFacingDescriptionFields';
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
// pasted treatment sentence in encounter.phases[0].description, which an
// exact-match filter could never reach — the issue survived every round.
// Field enumeration/resolution lives in the shared reader-facing module so
// this handler, the producer sanitation pass, and the validator cannot drift.

function descriptionIssues(issues: RepairIssue[]): RepairIssue[] {
  return issues.filter((issue) =>
    issue.type === 'unsafe_fallback_prose'
    && issue.sceneId
    && typeof issue.fieldPath === 'string'
    && ENCOUNTER_DESCRIPTION_FIELD_PATH.test(issue.fieldPath));
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
    const authoredBySceneSource = new Map<string, string | undefined>();
    const changedSceneIds = new Set<string>();
    const changedFieldPaths: string[] = [];
    let changed = 0;

    for (const issue of selected) {
      attemptedIssueKeys.push(contractRepairIssueFingerprint(issue));
      const scene = story.episodes
        .flatMap((episode) => episode.scenes ?? [])
        .find((candidate) => candidate.id === issue.sceneId);
      const encounter = scene?.encounter as unknown as Record<string, unknown> | undefined;
      if (!scene || !encounter) continue;
      const field = resolveEncounterDescriptionField(encounter, issue.fieldPath!);
      if (!field) {
        options.emit?.(`Encounter metadata repair could not resolve ${issue.fieldPath} on ${issue.sceneId}.`);
        continue;
      }

      const currentDescription = (field.get() ?? '').trim();
      const firstEncounterSetup = ((encounter.phases as Array<{
        beats?: Array<{ setupText?: string }>;
      }> | undefined)?.[0]?.beats?.[0]?.setupText ?? '').trim();
      const authoringKey = `${issue.sceneId}\u0000${currentDescription}`;
      let next = authoredBySceneSource.get(authoringKey);
      if (!authoredBySceneSource.has(authoringKey)) {
        next = await author.reauthorEncounterDescription({
          currentDescription,
          sourceSynopsis: typeof encounter.sourceSynopsis === 'string'
            ? encounter.sourceSynopsis
            : currentDescription,
          sceneName: scene.name,
          sceneProse: firstEncounterSetup || scene.beats?.[0]?.text,
        });
        authoredBySceneSource.set(authoringKey, next);
      }
      if (!next || next === currentDescription) {
        // A verbatim echo used to skip SILENTLY here — three resumes showed
        // zero metadata-repair evidence while the budget burned. Say so.
        options.emit?.(`Encounter metadata re-author for ${issue.fieldPath} returned ${next ? 'the same text (verbatim echo)' : 'nothing'} — keeping the field for the next round.`);
        continue;
      }
      // Accept only text the final validator's own ruler considers clean —
      // an unchecked re-author that still reads as pasted synopsis just
      // burns a repair round and re-flags on revalidation.
      const unsafeLabel = flagUnsafeReaderDescription(next);
      if (unsafeLabel) {
        options.emit?.(`Encounter metadata re-author for ${issue.fieldPath} still reads as ${unsafeLabel} — keeping the field for the next round.`);
        continue;
      }
      field.set(next);
      changed += 1;
      changedSceneIds.add(issue.sceneId!);
      changedFieldPaths.push(`scene:${issue.sceneId}.${issue.fieldPath}`);
    }

    if (changed === 0) return { story, changed: false, attemptedIssueKeys };
    options.emit?.(`Encounter metadata repair re-authored ${changed} description field(s).`);
    return {
      story,
      changed: true,
      attemptedIssueKeys,
      changedFieldPaths,
      atomicScopes: [...changedSceneIds].map((sceneId) => ({ kind: 'scene' as const, sceneId })),
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
