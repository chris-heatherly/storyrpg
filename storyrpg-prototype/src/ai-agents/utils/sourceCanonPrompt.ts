import type { CanonFact, LockedStoryCanon } from '../../types/storyCanon';

function renderValue(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (Array.isArray(value)) return value.map(renderValue).filter(Boolean).join('; ');
  if (!value || typeof value !== 'object') return String(value ?? '').trim();
  const entries = Object.entries(value as Record<string, unknown>)
    .map(([key, raw]) => {
      const rendered = renderValue(raw);
      return rendered ? `${key}: ${rendered}` : '';
    })
    .filter(Boolean);
  return entries.join(' | ');
}

function factLabel(fact: CanonFact): string {
  return `${fact.domain}/${fact.kind}/${fact.subjectId}`;
}

export function renderSourceCanonPrompt(canon?: LockedStoryCanon): string | undefined {
  if (!canon || canon.lockStatus !== 'locked' || canon.facts.length === 0) return undefined;
  const lines = [
    'AUTHORITATIVE SOURCE CANON - do not contradict, rename, reinterpret, or overwrite:',
  ];
  for (const fact of canon.facts) {
    if (fact.status !== 'canonical') continue;
    const value = renderValue(fact.value);
    if (!value) continue;
    lines.push(`- ${factLabel(fact)}: ${value}`);
  }
  return lines.length > 1 ? lines.join('\n') : undefined;
}
