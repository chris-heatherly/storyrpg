/**
 * Literal placeholder stakes emitted by StoryArchitect for un-authored choice
 * points (see StoryArchitect scene-elaboration fallback). These are SENTINELS:
 * any stakes component equal (normalized) to one of these must score 0 so the
 * downstream stakes validator forces ChoiceAuthor to regenerate real stakes,
 * rather than letting a generic placeholder ship.
 *
 * Keep the producer (StoryArchitect) and the validator (StakesTriangleValidator)
 * pointed at THIS single source of truth so they never drift.
 */
export const PLACEHOLDER_STAKES = {
  /** `want` is a template — the scene name varies, so match by prefix below. */
  want: (sceneName: string): string => `Advance the goal of ${sceneName}`,
  cost: 'Each option forfeits a different advantage.',
  identity: 'The choice reveals the protagonist under pressure.',
} as const;

/** Exact-match sentinels (cost + identity have no variable parts). */
export const PLACEHOLDER_STAKES_SENTINELS: readonly string[] = [
  PLACEHOLDER_STAKES.cost,
  PLACEHOLDER_STAKES.identity,
];

const WANT_TEMPLATE_PREFIX = /^advance the goal of /;

/**
 * True when `text` is one of the un-authored placeholder stakes literals
 * (case-insensitive, trimmed). Handles the `want` template by prefix.
 */
export function isPlaceholderStake(text: string | undefined): boolean {
  if (!text) return false;
  const t = text.trim().toLowerCase();
  if (t.length === 0) return false;
  return PLACEHOLDER_STAKES_SENTINELS.some((s) => s.toLowerCase() === t) || WANT_TEMPLATE_PREFIX.test(t);
}
