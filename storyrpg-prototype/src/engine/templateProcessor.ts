import { PlayerState, Story, TextVariant } from '../types';
import { evaluateCondition } from './conditionEvaluator';

/**
 * Template Processor
 *
 * Handles dynamic text in story content:
 * - Variable substitution: {{player.name}}, {{npc.marcus.name}}
 * - Pronoun substitution: {{player.they}}, {{player.them}}, {{player.their}}
 * - Conditional text blocks
 */

// Pronoun mappings
const PRONOUNS = {
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

// Words that should NOT be conjugated after a subject pronoun
const SKIP_CONJUGATION = new Set([
  'and', 'or', 'but', 'then', 'also', 'still', 'just', 'even', 'both',
  'too', 'only', 'never', 'always', 'already', 'really', 'quite', 'barely',
  'almost', 'nearly', 'quickly', 'slowly', 'suddenly', 'immediately', 'again',
  'often', 'sometimes', 'usually', 'finally', 'silently', 'simply', 'merely',
  'not', 'now', 'here', 'there', 'once', 'instead', 'however', 'the', 'a', 'an',
]);

const IRREGULAR_VERBS: Record<string, string> = {
  are: 'is', were: 'was', have: 'has', do: 'does', go: 'goes',
};

function conjugateThirdPersonSingular(word: string): string {
  const lower = word.toLowerCase();
  if (lower.endsWith('s') || lower.endsWith('ed') || lower.endsWith('ing')) return word;

  if (IRREGULAR_VERBS[lower]) {
    const conj = IRREGULAR_VERBS[lower];
    return word.charAt(0) === word.charAt(0).toUpperCase()
      ? conj.charAt(0).toUpperCase() + conj.slice(1)
      : conj;
  }

  if (/(?:ch|sh|ss|x|z|o)$/i.test(lower)) return word + 'es';
  if (/[^aeiou]y$/i.test(lower)) return word.slice(0, -1) + 'ies';
  return word + 's';
}

// Template filter functions
const TEMPLATE_FILTERS: Record<string, (value: string) => string> = {
  capitalize: (v) => v.charAt(0).toUpperCase() + v.slice(1),
  lowercase: (v) => v.toLowerCase(),
  uppercase: (v) => v.toUpperCase(),
  possessive: (v) => v.endsWith('s') ? `${v}'` : `${v}'s`,
};

// Memoization cache for processTemplate results
const templateCache = new Map<string, string>();
const MAX_CACHE_SIZE = 500;
let lastPlayerStateHash = '';

function computePlayerStateHash(player: PlayerState): string {
  const relationshipHash = Object.entries(player.relationships)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([npcId, rel]) => `${npcId}:${rel.trust}:${rel.affection}:${rel.respect}:${rel.fear}`)
    .join('|');
  const scoreHash = Object.entries(player.scores)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, value]) => `${name}:${value}`)
    .join('|');
  const flagHash = Object.entries(player.flags)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, value]) => `${name}:${value}`)
    .join('|');
  const tagHash = [...player.tags].sort().join('|');
  const inventoryHash = player.inventory
    .map((item) => `${item.itemId}:${item.quantity}`)
    .sort()
    .join('|');
  return [
    player.characterName,
    player.characterPronouns,
    relationshipHash,
    scoreHash,
    flagHash,
    tagHash,
    inventoryHash,
  ].join('::');
}

/**
 * Apply a filter to a substituted value.
 */
function applyFilter(value: string, filterName: string): string {
  const fn = TEMPLATE_FILTERS[filterName.trim().toLowerCase()];
  if (fn) return fn(value);
  console.warn(`[TemplateProcessor] Unknown filter: "${filterName}" — returning value unchanged`);
  return value;
}

/**
 * Process a text string with template variables.
 * Supports filters via pipe syntax: {{player.they|capitalize}}
 */
export function processTemplate(
  text: string,
  player: PlayerState,
  story: Story | null
): string {
  if (!text) return '';

  // Cache invalidation: if player state changed, clear the cache
  const stateHash = computePlayerStateHash(player);
  if (stateHash !== lastPlayerStateHash) {
    templateCache.clear();
    lastPlayerStateHash = stateHash;
  }

  // Check cache
  const cacheKey = text;
  const cached = templateCache.get(cacheKey);
  if (cached !== undefined) return cached;

  let processed = text;

  // Replace player name (with optional filter)
  processed = processed.replace(/\{\{player\.name(?:\|(\w+))?\}\}/gi, (_, filter) => {
    const value = player.characterName;
    return filter ? applyFilter(value, filter) : value;
  });

  // Replace pronouns (with optional filter)
  const pronounSet = PRONOUNS[player.characterPronouns];
  const isSingularPronoun = player.characterPronouns !== 'they/them';

  for (const [key, value] of Object.entries(pronounSet)) {
    if (key === 'they' && isSingularPronoun) {
      // Subject pronoun with verb conjugation: when substituting "they" → "he"/"she",
      // also conjugate the verb that follows (e.g., "they catch" → "he catches").
      const regex = new RegExp(`\\{\\{player\\.they(?:\\|(\\w+))?\\}\\}(\\s+)(\\w+)?`, 'gi');
      processed = processed.replace(regex, (match, filter, space, nextWord) => {
        let result = value;
        if (match.charAt(2) === match.charAt(2).toUpperCase() && !filter) {
          result = value.charAt(0).toUpperCase() + value.slice(1);
        }
        if (filter) result = applyFilter(result, filter);
        if (!nextWord) return result + (space || '');

        if (!SKIP_CONJUGATION.has(nextWord.toLowerCase())) {
          nextWord = conjugateThirdPersonSingular(nextWord);
        }
        return result + space + nextWord;
      });
    } else {
      const regex = new RegExp(`\\{\\{player\\.${key}(?:\\|(\\w+))?\\}\\}`, 'gi');
      processed = processed.replace(regex, (match, filter) => {
        let result = value;
        if (match.charAt(2) === match.charAt(2).toUpperCase() && !filter) {
          result = value.charAt(0).toUpperCase() + value.slice(1);
        }
        return filter ? applyFilter(result, filter) : result;
      });
    }
  }

  // Replace NPC references (with optional filter)
  if (story) {
    for (const npc of story.npcs) {
      // NPC name
      const npcRegex = new RegExp(`\\{\\{npc\\.${npc.id}\\.name(?:\\|(\\w+))?\\}\\}`, 'gi');
      processed = processed.replace(npcRegex, (_, filter) => {
        return filter ? applyFilter(npc.name, filter) : npc.name;
      });

      // NPC pronouns (use their specified pronouns or default to they/them)
      const npcPronouns = npc.pronouns || 'he/him';
      const npcPronounSet = PRONOUNS[npcPronouns as keyof typeof PRONOUNS] || PRONOUNS['he/him'];
      
      for (const [key, value] of Object.entries(npcPronounSet)) {
        const pronounRegex = new RegExp(`\\{\\{npc\\.${npc.id}\\.${key}(?:\\|(\\w+))?\\}\\}`, 'gi');
        processed = processed.replace(pronounRegex, (match, filter) => {
          let result = value;
          if (match.charAt(2) === match.charAt(2).toUpperCase() && !filter) {
            result = value.charAt(0).toUpperCase() + value.slice(1);
          }
          return filter ? applyFilter(result, filter) : result;
        });
      }

      // NPC relationship values
      const rel = player.relationships[npc.id];
      if (rel) {
        for (const dim of ['trust', 'affection', 'respect', 'fear'] as const) {
          const dimRegex = new RegExp(`\\{\\{npc\\.${npc.id}\\.${dim}\\}\\}`, 'gi');
          processed = processed.replace(dimRegex, rel[dim].toString());
        }
      }
    }
  }

  // Replace score values
  const scoreRegex = /\{\{score\.(\w+)\}\}/gi;
  processed = processed.replace(scoreRegex, (_, scoreName) => {
    return (player.scores[scoreName] ?? 0).toString();
  });

  // Replace flag values (as "true"/"false" for debugging)
  const flagRegex = /\{\{flag\.(\w+)\}\}/gi;
  processed = processed.replace(flagRegex, (_, flagName) => {
    return (player.flags[flagName] ?? false).toString();
  });

  // Replace inventory item counts
  const itemRegex = /\{\{item\.(\w+)\.count\}\}/gi;
  processed = processed.replace(itemRegex, (_, itemId) => {
    const item = player.inventory.find((i) => i.itemId === itemId);
    return (item?.quantity ?? 0).toString();
  });

  // Auto-capitalize at sentence starts: after "." / "!" / "?" + whitespace,
  // and at the very start of the text. Fixes lowercase pronouns from templates.
  processed = processed.replace(/(^|[.!?]\s+)([a-z])/g, (_, prefix, char) => {
    return prefix + char.toUpperCase();
  });
  // Also capitalize after em-dash or newline followed by a lowercase letter
  processed = processed.replace(/((?:—|\n)\s*)([a-z])/g, (_, prefix, char) => {
    return prefix + char.toUpperCase();
  });

  // Store in cache (evict oldest if full)
  if (templateCache.size >= MAX_CACHE_SIZE) {
    const firstKey = templateCache.keys().next().value;
    if (firstKey !== undefined) templateCache.delete(firstKey);
  }
  templateCache.set(cacheKey, processed);

  return processed;
}

/**
 * Select the appropriate text variant based on conditions.
 */
export function selectTextVariant(
  baseText: string,
  variants: TextVariant[] | undefined,
  player: PlayerState
): string {
  if (!variants || variants.length === 0) {
    return baseText;
  }

  // Find the first matching variant
  for (const variant of variants) {
    // Only select if condition matches AND there is actual text to show
    if (variant.text && variant.text.trim().length > 0 && evaluateCondition(variant.condition, player)) {
      return variant.text;
    }
  }

  // Fall back to base text
  return baseText;
}

/**
 * Process text with both variant selection and template substitution.
 */
export function processText(
  baseText: string,
  variants: TextVariant[] | undefined,
  player: PlayerState,
  story: Story | null
): string {
  const selectedText = selectTextVariant(baseText, variants, player);
  return processTemplate(selectedText, player, story);
}

/**
 * Generate reconvergence acknowledgment text based on player's path.
 * This creates dynamic text that acknowledges which branch the player took.
 * 
 * Use this at convergence points to make players feel their choices mattered.
 */
export function getReconvergenceAcknowledgment(
  player: PlayerState,
  branchFlags: { flagName: string; acknowledgment: string }[]
): string | null {
  for (const { flagName, acknowledgment } of branchFlags) {
    if (player.flags[flagName]) {
      return processTemplate(acknowledgment, player, null);
    }
  }
  return null;
}

/**
 * Create text variants for reconvergence points.
 * Helper to generate branch-aware text variants.
 */
export function createBranchVariants(
  defaultText: string,
  branchVariants: Array<{
    branchFlag: string;
    text: string;
  }>
): TextVariant[] {
  return branchVariants.map(({ branchFlag, text }) => ({
    condition: { type: 'flag' as const, flag: branchFlag, value: true },
    text,
  }));
}
