export interface ConcreteSeedRule {
  matches(normalizedSeed: string): boolean;
  missingTokens: string[];
  depicted(prose: string): boolean;
}

export function normalizeSeedText(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function proseWindows(prose: string): string[] {
  const sentences = prose
    .split(/(?<=[.!?])\s+|\n+/)
    .map(normalizeSeedText)
    .filter(Boolean);
  const windows = [...sentences];
  for (let i = 0; i < sentences.length; i++) {
    const pair = sentences.slice(i, i + 2);
    if (pair.length === 2) windows.push(pair.join(' '));
    const triple = sentences.slice(i, i + 3);
    if (triple.length === 3) windows.push(triple.join(' '));
  }
  return windows;
}

function hasRaduFigure(window: string): boolean {
  return /\b(?:radu|rougher|stranger|man|figure)\b/.test(window);
}

function hasRaduPlacement(window: string): boolean {
  return /\b(?:kitchen|kitchens|entrance|archway|doorway|doorframe|threshold|rooftop|bar|club)\b/.test(window);
}

function hasRaduDistinguishingSign(window: string): boolean {
  return /\b(?:rougher|woodsmoke|sweater|hand knit|hand knitted|bay leaf)\b/.test(window);
}

const CONCRETE_SEED_RULES: ConcreteSeedRule[] = [
  {
    matches: (seed) => /\brougher\s+man\b.*\bkitchen\s+entrance\b/.test(seed),
    missingTokens: ['radu', 'rougher', 'man', 'kitchen', 'doorframe', 'hand-knit', 'sweater', 'woodsmoke'],
    depicted: (prose) => proseWindows(prose).some((window) => (
      hasRaduFigure(window)
      && hasRaduPlacement(window)
      && hasRaduDistinguishingSign(window)
    )),
  },
];

export function concreteSeedRuleFor(normalizedSeed: string): ConcreteSeedRule | undefined {
  return CONCRETE_SEED_RULES.find((rule) => rule.matches(normalizedSeed));
}

export function concreteSeedDepicted(normalizedSeed: string, prose: string): boolean | undefined {
  const rule = concreteSeedRuleFor(normalizedSeed);
  return rule ? rule.depicted(prose) : undefined;
}
