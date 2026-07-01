const LOCATION_RE = /\b(?:at|in|inside|outside|on|near|through|to|from)\s+(?:the\s+|a\s+|an\s+)?([A-ZÀ-Ž][A-Za-zÀ-ž0-9'’-]*(?:\s+[A-ZÀ-Ž][A-Za-zÀ-ž0-9'’-]*){0,3}|[a-z][a-z0-9'’-]*(?:\s+[a-z][a-z0-9'’-]*){0,2}\s+(?:bar|club|park|station|apartment|archive|venue|hotel|house|garden|gardens|market|office|studio|library|bookshop|bookstore|rooftop|courtyard|cafe|café|museum|shop))/g;
const CATEGORY_LOCATION_RE = /\b(?:at|in|inside|outside|on|near|through|to|from)\s+(?:the\s+|a\s+|an\s+)?((?:rooftop\s+)?(?:bar|club|park|station|apartment|archive|venue|hotel|house|garden|gardens|market|office|studio|library|bookshop|bookstore|rooftop|courtyard|cafe|café|museum|shop))\b/gi;

const CITY_CONTAINER_CUES = new Set([
  'city',
  'town',
  'village',
  'new city',
  'home city',
  'city center',
  'bucharest',
  'new york',
  'london',
  'paris',
  'rome',
  'tokyo',
  'los angeles',
]);

function cleanText(value: unknown): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

export function normalizeSceneLocationCue(value: unknown): string | undefined {
  const normalized = cleanText(value)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\b(?:the|a|an)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized) return undefined;
  if (/^(?:purpose|scene|episode|next|before|after|consequence|consequences|turn|handoff)\b/.test(normalized)) return undefined;
  if (/\bcismigiu\b/.test(normalized)) return 'cismigiu';
  if (/\brooftop\b/.test(normalized) && /\bbar\b/.test(normalized)) return 'rooftop bar';
  if (/\bbook(?:shop|store)\b/.test(normalized)) return 'bookshop';
  if (/\bapartment\b/.test(normalized)) return 'apartment';
  if (/\bclub\b/.test(normalized) || /\bvenue\b/.test(normalized)) return normalized.includes('valcescu') ? 'valcescu club' : 'club';
  return normalized.replace(/\bgardens\b/g, 'garden');
}

export function isContainerLocationCue(value: string): boolean {
  return CITY_CONTAINER_CUES.has(value);
}

export function extractSceneLocationCues(text: unknown): string[] {
  const out = new Set<string>();
  const value = cleanText(text);
  for (const match of [...value.matchAll(LOCATION_RE), ...value.matchAll(CATEGORY_LOCATION_RE)]) {
    const cue = normalizeSceneLocationCue(match[1]);
    if (cue) out.add(cue);
  }
  return [...out];
}

function isDirectLocationLabel(value: unknown): boolean {
  const text = cleanText(value);
  if (!text || text.length > 48 || /[.!?]/.test(text)) return false;
  return !/\b(?:arrives?|attacks?|attacked|enters?|forms?|gathers?|meets?|opens?|publishes?|reaches|turns?|walks?|writes?)\b/i.test(text);
}

export function uniqueMajorLocationCues(inputs: unknown[]): string[] {
  const raw = inputs.flatMap((input) => {
    if (Array.isArray(input)) return input.flatMap((item) => uniqueMajorLocationCues([item]));
    const direct = isDirectLocationLabel(input) ? normalizeSceneLocationCue(input) : undefined;
    const extracted = extractSceneLocationCues(input);
    return [...(direct ? [direct] : []), ...extracted];
  });
  const cues = Array.from(new Set(raw.filter(Boolean)));
  const specific = cues.filter((cue) => !isContainerLocationCue(cue));
  const candidates = specific.length > 0 ? specific : cues;
  const collapsed: string[] = [];
  for (const cue of candidates) {
    if (collapsed.some((existing) => existing === cue || existing.includes(cue) || cue.includes(existing))) continue;
    collapsed.push(cue);
  }
  return collapsed;
}
