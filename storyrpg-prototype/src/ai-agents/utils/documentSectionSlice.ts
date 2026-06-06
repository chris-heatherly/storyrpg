/**
 * Section-aware document slicing for bible agents.
 *
 * The WorldBuilder and CharacterDesigner previously fed the LLM only the first
 * 3000 characters of the raw treatment (`rawDocument.substring(0, 3000)`),
 * which silently dropped authored content (e.g. Section 4 locations 4–6,
 * Section 3 supporting micro-lies) whenever it sat past the cut. This helper
 * resolves the relevant authored sections by heading instead of truncating by
 * raw char count, so an agent receives the whole of the sections it cares about
 * (or the full doc when no heading matches), never a mid-sentence cut.
 *
 * Heading detection mirrors the treatment parser's section grammar
 * (`## [N.] Heading`) but is duplicated locally rather than imported so this
 * module carries no dependency on the (owned-by-another-phase) extractor.
 */

const SECTION_HEADING_RE = /^##\s+(?:\d+\.\s+)?(.+)$/gm;

interface SectionMatch {
  /** Lower-cased heading text (without the `## N.` prefix). */
  heading: string;
  /** Offset where the section body begins (just after the heading line). */
  bodyStart: number;
  /** Offset where the heading line begins. */
  headingStart: number;
}

function findSections(markdown: string): SectionMatch[] {
  const matches = [...markdown.matchAll(SECTION_HEADING_RE)];
  return matches.map((m) => ({
    heading: (m[1] || '').trim().toLowerCase(),
    headingStart: m.index ?? 0,
    bodyStart: (m.index ?? 0) + m[0].length,
  }));
}

/**
 * Extract the named sections (by case-insensitive heading substring match),
 * preserving their headings, in document order. Returns `''` when none match.
 *
 * @param markdown   the source document (e.g. the raw treatment)
 * @param labelGroups each inner array is a set of aliases for ONE logical
 *                    section; the first alias that matches wins for that group
 */
export function sliceNamedSections(
  markdown: string,
  labelGroups: string[][]
): string {
  if (!markdown) return '';
  const sections = findSections(markdown);
  if (sections.length === 0) return '';

  const wanted: Array<{ start: number; end: number }> = [];
  for (const aliases of labelGroups) {
    const lowered = aliases.map((a) => a.toLowerCase());
    const idx = sections.findIndex((s) =>
      lowered.some((label) => s.heading.includes(label))
    );
    if (idx < 0) continue;
    const start = sections[idx].headingStart;
    const end =
      idx + 1 < sections.length ? sections[idx + 1].headingStart : markdown.length;
    wanted.push({ start, end });
  }

  if (wanted.length === 0) return '';
  // Keep document order and de-dup (a label group could resolve to a section
  // already captured by another group).
  wanted.sort((a, b) => a.start - b.start);
  const seen = new Set<number>();
  return wanted
    .filter((w) => {
      if (seen.has(w.start)) return false;
      seen.add(w.start);
      return true;
    })
    .map((w) => markdown.slice(w.start, w.end).trim())
    .join('\n\n');
}

/**
 * Resolve authored content for a bible agent without lossy char-count
 * truncation. Tries the named sections first; if none resolve (e.g. a free-form
 * source doc with no section headings), falls back to the full document. A
 * `maxChars` ceiling guards against pathological prompt sizes, but defaults
 * high enough that a typical treatment is passed whole.
 */
export function resolveAuthoredContext(
  markdown: string | undefined,
  labelGroups: string[][],
  maxChars = 60000
): { text: string; truncated: boolean } {
  if (!markdown) return { text: '', truncated: false };

  const sectioned = sliceNamedSections(markdown, labelGroups);
  const chosen = sectioned || markdown;

  if (chosen.length <= maxChars) {
    return { text: chosen, truncated: false };
  }
  return { text: chosen.slice(0, maxChars), truncated: true };
}
