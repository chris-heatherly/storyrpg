const GENERIC_PERSON_NAMES = new Set([
  'character',
  'hero',
  'lead',
  'main character',
  'player',
  'player character',
  'protagonist',
  'the character',
  'the hero',
  'the lead',
  'the main character',
  'the player',
  'the player character',
  'the protagonist',
  'unknown',
]);

function normalizedIdentityText(value?: string): string {
  return (value ?? '')
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/** True when a launch/schema fallback is masquerading as a person's name. */
export function isPlaceholderPersonName(value?: string): boolean {
  const normalized = normalizedIdentityText(value);
  if (!normalized) return true;
  if (GENERIC_PERSON_NAMES.has(normalized)) return true;
  if (/^(?:tbd|todo|placeholder|fill(?: me)? in|n\/?a|none|null|unnamed)(?:\b|$)/i.test(normalized)) return true;
  return /(?:\{\{|\}\}|<[^>]+>|\[[^\]]*(?:name|character|protagonist)[^\]]*\])/i.test(value ?? '');
}

export function normalizeCanonicalPersonName(value?: string): string | undefined {
  const trimmed = value?.normalize('NFKC').replace(/\s+/g, ' ').trim();
  if (!trimmed || trimmed.length < 2 || isPlaceholderPersonName(trimmed)) return undefined;
  return trimmed;
}

export function canonicalPersonNamesEqual(left?: string, right?: string): boolean {
  const a = normalizeCanonicalPersonName(left);
  const b = normalizeCanonicalPersonName(right);
  return Boolean(a && b && normalizedIdentityText(a) === normalizedIdentityText(b));
}

export function normalizeCanonicalPronouns(value?: string): 'he/him' | 'she/her' | 'they/them' | undefined {
  const normalized = normalizedIdentityText(value).replace(/\s+/g, '');
  if (normalized === 'he/him') return 'he/him';
  if (normalized === 'she/her') return 'she/her';
  if (normalized === 'they/them') return 'they/them';
  return undefined;
}
