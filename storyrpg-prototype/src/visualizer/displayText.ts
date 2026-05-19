export function normalizeVisualizerText(value: unknown): string {
  const text = typeof value === 'string' ? value : String(value || '');
  if (!text) return '';

  return text.replace(/\{\{\s*player\.([a-zA-Z]+)(?:\|([a-zA-Z]+))?\s*\}\}/gi, (_match, rawKey, rawFilter) => {
    const key = String(rawKey || '').toLowerCase();
    const filter = String(rawFilter || '').toLowerCase();
    const replacement = PLAYER_TOKEN_REPLACEMENTS[key] ?? 'the protagonist';
    return filter === 'capitalize' ? capitalize(replacement) : replacement;
  });
}

const PLAYER_TOKEN_REPLACEMENTS: Record<string, string> = {
  name: 'the protagonist',
  they: 'they',
  them: 'them',
  their: 'their',
  theirs: 'theirs',
  themselves: 'themselves',
  themself: 'themselves',
  he: 'they',
  him: 'them',
  his: 'their',
  himself: 'themselves',
  she: 'they',
  her: 'them',
  hers: 'theirs',
  herself: 'themselves',
};

function capitalize(value: string): string {
  if (!value) return value;
  return value.charAt(0).toUpperCase() + value.slice(1);
}
