export interface PlayerTemplateContext {
  name: string;
  pronouns?: string;
}

export interface PlayerTemplateResolution<T> {
  value: T;
  replacements: number;
}

const PRONOUNS: Record<string, Record<string, string>> = {
  'he/him': {
    they: 'he',
    them: 'him',
    their: 'his',
    theirs: 'his',
    themselves: 'himself',
    are: 'is',
    were: 'was',
    have: 'has',
  },
  'she/her': {
    they: 'she',
    them: 'her',
    their: 'her',
    theirs: 'hers',
    themselves: 'herself',
    are: 'is',
    were: 'was',
    have: 'has',
  },
  'they/them': {
    they: 'they',
    them: 'them',
    their: 'their',
    theirs: 'theirs',
    themselves: 'themselves',
    are: 'are',
    were: 'were',
    have: 'have',
  },
};

const SKIP_CONJUGATION = new Set([
  'am',
  'are',
  'is',
  'was',
  'were',
  'be',
  'been',
  'being',
  'can',
  'could',
  'will',
  'would',
  'should',
  'may',
  'might',
  'must',
  'has',
  'have',
  'had',
  'do',
  'does',
  'did',
]);

export function resolvePlayerTemplateString(
  text: string,
  context: PlayerTemplateContext,
): PlayerTemplateResolution<string> {
  if (!text || !text.includes('{{')) return { value: text, replacements: 0 };

  const pronouns = PRONOUNS[(context.pronouns || '').toLowerCase()] ?? PRONOUNS['they/them'];
  let replacements = 0;
  const name = context.name || 'the protagonist';

  let value = text.replace(/\{\{\s*(Player|player)\.([a-zA-Z]+)(?:\|([a-zA-Z]+))?\s*\}\}/g, (match, namespace, key, filter) => {
    replacements += 1;
    const normalizedKey = String(key).toLowerCase();
    const raw = normalizedKey === 'name' ? name : pronouns[normalizedKey] ?? name;
    return applyTemplateCasing(raw, namespace === 'Player' || filter === 'capitalize');
  });

  if ((context.pronouns || '').toLowerCase() !== 'they/them') {
    value = value.replace(/\b(he|she)\s+([a-z]+)\b/g, (match, subject, verb) => {
      if (SKIP_CONJUGATION.has(verb.toLowerCase())) return match;
      return `${subject} ${conjugateThirdPersonSingular(verb)}`;
    });
    value = value.replace(/\b(He|She)\s+([a-z]+)\b/g, (match, subject, verb) => {
      if (SKIP_CONJUGATION.has(verb.toLowerCase())) return match;
      return `${subject} ${conjugateThirdPersonSingular(verb)}`;
    });
  }

  return { value, replacements };
}

export function resolvePlayerTemplatesInObject<T>(
  input: T,
  context: PlayerTemplateContext,
): PlayerTemplateResolution<T> {
  let replacements = 0;

  const visit = (value: unknown): unknown => {
    if (typeof value === 'string') {
      const resolved = resolvePlayerTemplateString(value, context);
      replacements += resolved.replacements;
      return resolved.value;
    }
    if (Array.isArray(value)) {
      return value.map(visit);
    }
    if (value && typeof value === 'object') {
      const out: Record<string, unknown> = {};
      for (const [key, child] of Object.entries(value)) {
        out[key] = visit(child);
      }
      return out;
    }
    return value;
  };

  return {
    value: visit(input) as T,
    replacements,
  };
}

function applyTemplateCasing(value: string, capitalize: boolean): string {
  if (!capitalize || !value) return value;
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function conjugateThirdPersonSingular(verb: string): string {
  const lower = verb.toLowerCase();
  if (lower.endsWith('y') && !/[aeiou]y$/.test(lower)) {
    return `${verb.slice(0, -1)}ies`;
  }
  if (/(s|sh|ch|x|z|o)$/i.test(verb)) {
    return `${verb}es`;
  }
  return `${verb}s`;
}
