/**
 * Small shared guards for the recurring "consume a set of LLM-keyed items by id"
 * pattern. Several pipeline steps build a `Map`/`Set` keyed by an id the LLM
 * produced (choice-set beatIds, merged rewrite beats, stamped residue
 * requirements, planted flags) and then look items up — and a MISS silently drops
 * content, surfacing only later as a downstream abort. `findUnconsumed` is the
 * primitive behind those orphan checks (e.g. assembly's reportOrphanedChoiceSets):
 * compute which keyed items were never consumed so the caller can warn instead of
 * dropping silently. Pure.
 */

/**
 * The subset of `items` whose key is NOT present in `consumedKeys`. Items with no
 * key (keyOf returns falsy) are skipped — they cannot be matched either way.
 */
export function findUnconsumed<T>(
  items: readonly T[],
  consumedKeys: ReadonlySet<string>,
  keyOf: (item: T) => string | undefined,
): T[] {
  const out: T[] = [];
  for (const item of items) {
    const key = keyOf(item);
    if (key && !consumedKeys.has(key)) out.push(item);
  }
  return out;
}
