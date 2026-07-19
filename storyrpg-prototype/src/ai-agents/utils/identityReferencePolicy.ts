import type {
  NarrativeIdentityScheduleContract,
  NarrativeLexicalArtifactContract,
  NarrativeRealizationTask,
} from '../../types/narrativeContract';
import { literalPhraseMatch } from './literalPhraseMatch';

export interface SceneIdentityReferencePolicy {
  characterId: string;
  canonicalName: string;
  availableAliases: string[];
  unavailableAliases: string[];
  forbiddenReferences: string[];
}

export interface IdentityReferenceViolation {
  characterId: string;
  canonicalName: string;
  reference: string;
  fieldPath: string;
}

function normalized(value: string): string {
  return value.trim().toLocaleLowerCase();
}

function unique(values: Array<string | undefined>): string[] {
  return Array.from(new Map(
    values
      .map((value) => value?.trim())
      .filter((value): value is string => Boolean(value))
      .map((value) => [normalized(value), value]),
  ).values());
}

function literalForbiddenBySceneTask(
  value: string,
  sceneId: string | undefined,
  realizationTasks: NarrativeRealizationTask[],
): boolean {
  const target = normalized(value);
  return realizationTasks.some((task) =>
    (!sceneId || !task.sceneId || task.sceneId === sceneId)
    && task.evidenceAtoms.some((atom) =>
      atom.polarity === 'forbidden'
      && atom.verificationAuthority === 'literal'
      && atom.acceptedPatterns.some((pattern) => normalized(pattern) === target),
    ),
  );
}

function lexicalArtifactAvailable(
  value: string,
  episodeNumber: number,
  sceneId: string | undefined,
  lexicalArtifactContracts: NarrativeLexicalArtifactContract[],
): boolean | undefined {
  const target = normalized(value);
  const artifact = lexicalArtifactContracts.find((contract) => normalized(contract.canonicalValue) === target);
  if (!artifact) return undefined;
  if (episodeNumber < artifact.episodeNumber) return false;
  if (episodeNumber > artifact.episodeNumber) return true;
  if (!sceneId) return false;
  if (artifact.creatorSceneId === sceneId) return true;
  return !artifact.forbiddenBeforeSceneIds.includes(sceneId);
}

/**
 * Resolve legal reader-facing identity references from contracts that already
 * exist in the canonical graph. An alias is not globally legal merely because
 * it appears in `allowedAliases`: a lexical creation contract or scene-local
 * forbidden task can keep it unavailable until its owning scene creates it.
 */
export function resolveSceneIdentityReferencePolicies(input: {
  episodeNumber: number;
  sceneId?: string;
  identityScheduleContracts?: NarrativeIdentityScheduleContract[];
  lexicalArtifactContracts?: NarrativeLexicalArtifactContract[];
  realizationTasks?: NarrativeRealizationTask[];
}): SceneIdentityReferencePolicy[] {
  const lexicalArtifactContracts = input.lexicalArtifactContracts ?? [];
  const realizationTasks = input.realizationTasks ?? [];
  return (input.identityScheduleContracts ?? []).map((schedule) => {
    const beforeNamedIntroduction = input.episodeNumber < schedule.firstNamedEpisode;
    const availableAliases: string[] = [];
    const unavailableAliases: string[] = [];
    for (const alias of unique(schedule.allowedAliases)) {
      const lexicalAvailability = lexicalArtifactAvailable(
        alias,
        input.episodeNumber,
        input.sceneId,
        lexicalArtifactContracts,
      );
      const unavailable = lexicalAvailability === false
        || literalForbiddenBySceneTask(alias, input.sceneId, realizationTasks);
      (unavailable ? unavailableAliases : availableAliases).push(alias);
    }
    const canonical = schedule.canonicalName.trim();
    const firstName = canonical.split(/\s+/)[0];
    const scheduledForbidden = beforeNamedIntroduction
      ? [canonical, firstName.length >= 3 && firstName !== canonical ? firstName : undefined]
      : [];
    return {
      characterId: schedule.characterId,
      canonicalName: canonical,
      availableAliases,
      unavailableAliases,
      forbiddenReferences: unique([
        ...scheduledForbidden,
        ...(beforeNamedIntroduction ? schedule.forbiddenBeforeNamedEpisode : []),
        ...unavailableAliases,
      ]),
    };
  });
}

export function findIdentityReferenceViolations(
  value: unknown,
  policies: SceneIdentityReferencePolicy[],
  rootPath = 'scene',
): IdentityReferenceViolation[] {
  const violations: IdentityReferenceViolation[] = [];
  const seen = new Set<string>();
  const inspect = (text: string, fieldPath: string): void => {
    for (const policy of policies) {
      const matchedReferences = policy.forbiddenReferences
        .filter((reference) => literalPhraseMatch(reference, text))
        .filter((reference, _index, matches) => !matches.some((other) =>
          other !== reference
          && normalized(other).length > normalized(reference).length
          && literalPhraseMatch(reference, other),
        ));
      for (const reference of matchedReferences) {
        const key = `${policy.characterId}::${normalized(reference)}::${fieldPath}`;
        if (seen.has(key)) continue;
        seen.add(key);
        violations.push({
          characterId: policy.characterId,
          canonicalName: policy.canonicalName,
          reference,
          fieldPath,
        });
      }
    }
  };
  const walk = (current: unknown, path: string, key?: string): void => {
    if (typeof current === 'string') {
      if (key !== 'id' && !/(?:Id|ID)$/.test(key ?? '')) inspect(current, path);
      return;
    }
    if (Array.isArray(current)) {
      current.forEach((entry, index) => walk(entry, `${path}[${index}]`));
      return;
    }
    if (!current || typeof current !== 'object') return;
    for (const [entryKey, entry] of Object.entries(current as Record<string, unknown>)) {
      walk(entry, `${path}.${entryKey}`, entryKey);
    }
  };
  walk(value, rootPath);
  return violations;
}
