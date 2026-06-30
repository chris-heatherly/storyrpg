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

function hasNear(text: string, left: RegExp, right: RegExp, distance = 80): boolean {
  const source = normalizeSeedText(text);
  const leftMatch = left.exec(source);
  if (!leftMatch || leftMatch.index === undefined) return false;
  const start = Math.max(0, leftMatch.index - distance);
  const end = Math.min(source.length, leftMatch.index + leftMatch[0].length + distance);
  return right.test(source.slice(start, end));
}

const CONCRETE_SEED_RULES: ConcreteSeedRule[] = [
  {
    matches: (seed) => /\brougher\b[\s\S]{0,80}\bman\b/.test(seed)
      && /\bkitchen\b/.test(seed)
      && /\bentrance\b/.test(seed),
    missingTokens: ['rougher', 'man', 'kitchen', 'entrance', 'woodsmoke'],
    depicted: (prose) => {
      const hay = normalizeSeedText(prose);
      const hasFigure = /\brougher\b[\s\S]{0,40}\bman\b|\bman\b[\s\S]{0,40}\brougher\b/.test(hay);
      if (!hasFigure) return false;
      const hasKitchenThreshold = /\bkitchen\b/.test(hay)
        && (/\b(?:entrance|door|doorframe|archway|threshold)\b/.test(hay) || /\bwoodsmoke\b/.test(hay));
      const hasTreatmentSign = /\b(?:woodsmoke|hand\s*knit|sweater|didn t fit|doesn t fit|out of place)\b/.test(hay);
      return hasKitchenThreshold && hasTreatmentSign
        && (hasNear(hay, /\brougher\b/, /\bkitchen\b/, 160) || hasNear(hay, /\bman\b/, /\bkitchen\b/, 160));
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
