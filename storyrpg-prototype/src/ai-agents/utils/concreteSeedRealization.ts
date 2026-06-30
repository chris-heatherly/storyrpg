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

const CONCRETE_SEED_RULES: ConcreteSeedRule[] = [];

export function concreteSeedRuleFor(normalizedSeed: string): ConcreteSeedRule | undefined {
  return CONCRETE_SEED_RULES.find((rule) => rule.matches(normalizedSeed));
}

export function concreteSeedDepicted(normalizedSeed: string, prose: string): boolean | undefined {
  const rule = concreteSeedRuleFor(normalizedSeed);
  return rule ? rule.depicted(prose) : undefined;
}
