import type { CanonFact, LockedStoryCanon } from '../../types/storyCanon';

function renderFactValue(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  return JSON.stringify(value);
}

function factKey(fact: Pick<CanonFact, 'domain' | 'kind' | 'subjectId'>): string {
  return `${fact.domain}:${fact.kind}:${fact.subjectId}`;
}

/**
 * Append a generated fact to a locked canon artifact.
 *
 * This never mutates prior facts. Reusing a fact id is treated as an overwrite
 * attempt. Reusing the same domain/kind/subject with a different value is a
 * contradiction unless the caller is an explicit repair that names superseded
 * facts.
 */
export function appendCanonFact(canon: LockedStoryCanon, fact: CanonFact): LockedStoryCanon {
  if (canon.lockStatus !== 'locked') {
    throw new Error('Cannot append canon fact before source canon is locked.');
  }
  if (canon.facts.some((existing) => existing.id === fact.id)) {
    throw new Error(`Canon fact append rejected: fact id "${fact.id}" already exists.`);
  }
  if (fact.status === 'canonical' && fact.createdAtStage !== 'source' && fact.source !== 'validator_repair') {
    throw new Error('Only source-stage or validator-repair facts may be appended as canonical.');
  }
  if (fact.supersedesFactIds?.length && fact.source !== 'validator_repair') {
    throw new Error('Only validator repair may supersede existing canon facts.');
  }

  const key = factKey(fact);
  const sameKey = canon.facts.filter((existing) => factKey(existing) === key);
  const differentSameKey = sameKey.find((existing) =>
    renderFactValue(existing.value).toLowerCase() !== renderFactValue(fact.value).toLowerCase()
  );
  if (differentSameKey && !fact.supersedesFactIds?.includes(differentSameKey.id)) {
    throw new Error(
      `Canon fact append rejected: "${fact.id}" conflicts with locked fact "${differentSameKey.id}" for ${key}.`,
    );
  }

  return {
    ...canon,
    facts: [...canon.facts, fact],
  };
}
