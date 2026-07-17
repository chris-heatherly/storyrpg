/**
 * Content-hash primitive shared by repair carry-forward and QA evidence sync.
 *
 * FNV-1a 32-bit over the JSON serialization, prefixed so a hash's algorithm is
 * self-describing in artifacts. This is an identity/staleness key, not a
 * cryptographic digest.
 */
export function fnv1a32Json(value: unknown): string {
  const text = JSON.stringify(value);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, '0')}`;
}
