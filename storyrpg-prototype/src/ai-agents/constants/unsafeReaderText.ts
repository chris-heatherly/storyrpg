import { READER_PROSE_LEAK_PATTERNS, STRUCTURAL_SCAFFOLDING_PATTERNS } from './metaProse';
import { SYNTHETIC_FALLBACK_PROSE_PATTERNS } from './syntheticFallbackProse';
import { isPlanningRegisterText } from './planningRegisterText';

/**
 * ONE ruler for "is this reader-facing description text unsafe to ship" —
 * shared by the producer-boundary sanitation, the final-contract metadata
 * repairer's acceptance check, and (via its own composite) the final
 * RouteContinuityValidator.
 *
 * The Cismigiu treatment sentence survived to the final contract three runs
 * in a row because each stage measured with a different subset: the producer
 * checked only isPlanningRegisterText (false for that sentence), the final
 * validator checked four detectors (the reader-prose-leak "embedded treatment
 * synopsis paste" pattern caught it), and the repair handler checked nothing
 * before accepting re-authored text. Detect, sanitize, repair, and
 * re-validate must all use the same ruler.
 */
export function flagUnsafeReaderDescription(text: string | undefined): string | undefined {
  const value = String(text ?? '').trim();
  if (!value) return undefined;
  for (const entry of SYNTHETIC_FALLBACK_PROSE_PATTERNS) {
    if (entry.pattern.test(value)) return entry.label;
  }
  for (const entry of READER_PROSE_LEAK_PATTERNS) {
    if (entry.pattern.test(value)) return entry.label;
  }
  for (const entry of STRUCTURAL_SCAFFOLDING_PATTERNS) {
    if (entry.pattern.test(value)) return entry.label;
  }
  if (isPlanningRegisterText(value)) return 'planning-register text';
  return undefined;
}
