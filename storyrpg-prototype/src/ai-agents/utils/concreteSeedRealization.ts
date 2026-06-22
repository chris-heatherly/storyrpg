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

function hasAny(value: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(value));
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
  {
    matches: (seed) => /\brose\s+quartz\b/.test(seed) && /\bwarding\s+consent\b/.test(seed),
    missingTokens: ['Stela', 'rose quartz', 'hand', 'warding consent'],
    depicted: (prose) => {
      const hay = normalizeSeedText(prose);
      return /\bstela\b/.test(hay)
        && (
          hasAny(hay, [/\brose\s+quartz\b/, /\bpink(?:ish)?\s+(?:stone|quartz)\b/, /\brough\s+surfaced\s+pink\b/])
          || (/\bquartz\b/.test(hay) && /\bpink(?:ish)?\b/.test(hay))
        )
        && hasAny(hay, [/\bhand\b/, /\bpalm\b/, /\bfingers?\b/])
        && hasAny(hay, [/\bward/, /\bprotection\b/, /\bprotective\b/, /\bwarning\b/, /\bconsent\b/, /\bnew\s+apartment\b/]);
    },
  },
  {
    matches: (seed) => /\bprotective\s+bag\s+of\s+herbs\b/.test(seed) || (/\bbag\s+of\s+herbs\b/.test(seed) && /\bwarding\b/.test(seed)),
    missingTokens: ['Stela', 'herb bag', 'brunch', 'protection'],
    depicted: (prose) => {
      const hay = normalizeSeedText(prose);
      return /\bstela\b/.test(hay)
        && hasAny(hay, [/\bherbs?\b/, /\bmuslin\s+bag\b/, /\bsmall\s+bag\b/, /\bsachet\b/, /\blavender\b/, /\bcrushed\s+pine\b/])
        && hasAny(hay, [/\bbrunch\b/, /\bbreakfast\b/, /\btable\b/, /\bcafe\b/, /\bcoffee\b/])
        && hasAny(hay, [/\bprotect/, /\bward/, /\bshield\b/, /\bagainst\s+drafts\b/, /\bagainst\s+draft\b/]);
    },
  },
];

export function concreteSeedRuleFor(normalizedSeed: string): ConcreteSeedRule | undefined {
  return CONCRETE_SEED_RULES.find((rule) => rule.matches(normalizedSeed));
}

export function concreteSeedDepicted(normalizedSeed: string, prose: string): boolean | undefined {
  const rule = concreteSeedRuleFor(normalizedSeed);
  return rule ? rule.depicted(prose) : undefined;
}
