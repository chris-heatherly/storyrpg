/**
 * Regen-adoption contract (SAR wave 2, R6 — retry-feedback discipline).
 *
 * A regeneration attempt is adopted only when the ISSUES THAT TRIGGERED IT
 * actually cleared — not on a bare aggregate-score bump, which let rewrites
 * swap one instance of a defect for another (same fingerprint, new text) or
 * win on score while the triggering POV/voice/continuity issue survived.
 *
 * Mirrors the shape of `improvesMissingRealization` in
 * sceneRealizationGuard.ts: deterministic, LLM-free, compares before/after
 * findings by a stable fingerprint.
 */

/**
 * Stable fingerprint for a validator issue description: case/whitespace
 * folded, with numbers stripped (scores, beat indices, and counts vary
 * between attempts while describing the same defect).
 */
export function issueFingerprint(issue: string): string {
  return issue
    .toLowerCase()
    .replace(/[0-9]+(?:\.[0-9]+)?/g, '#')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Adopt a regen attempt only if every triggering issue's fingerprint is gone
 * from the after-set. A regen triggered by nothing (defensive) is never
 * adopted through this predicate — callers keep their own "clean validation"
 * fast-path for that.
 */
export function shouldAdoptRegenAttempt(beforeIssues: string[], afterIssues: string[]): boolean {
  const before = beforeIssues.map(issueFingerprint).filter(Boolean);
  if (before.length === 0) return false;
  const after = new Set(afterIssues.map(issueFingerprint).filter(Boolean));
  return before.every((fingerprint) => !after.has(fingerprint));
}
