import { describe, expect, it } from 'vitest';
import {
  extractTreatmentFromMarkdown,
  splitSentencesPreservingAbbreviations,
} from './treatmentExtraction';

describe('splitSentencesPreservingAbbreviations', () => {
  it('does not split title abbreviations away from following names', () => {
    const parts = splitSentencesPreservingAbbreviations(
      'At 4 a.m. the archivist publishes the first field note under codename Dr. Lantern, and by evening the post has gone citywide. The archive answers.'
    ).map((part) => part.trim());

    expect(parts).toEqual([
      'At 4 a.m. the archivist publishes the first field note under codename Dr. Lantern, and by evening the post has gone citywide.',
      'The archive answers.',
    ]);
  });

  it('preserves abbreviations when deriving episode turns from Lite high-level descriptions', () => {
    const treatment = extractTreatmentFromMarkdown(`# StoryRPG Lite Treatment

## 1. Story Premise

- **Title:** Archive Lights
- **Genre:** urban mystery
- **Tone:** precise and tense
- **Logline:** An archivist follows public clues through a city archive.

## 7. Episode Outline

### Episode 1: The First Note

- **Story Circle role:** \`you\`
- **High-level description:** At 4 a.m. the archivist publishes the first field note under codename Dr. Lantern, and by evening the post has gone citywide. The archive answers with a locked door.
- **Major pressure:** Can the archivist publish the truth before the archive hides it?
- **Likely consequence:** The public note makes the archivist visible.
`);

    expect(treatment.episodes[1]?.episodeTurns).toContain(
      'At 4 a.m. the archivist publishes the first field note under codename Dr. Lantern, and by evening the post has gone citywide.'
    );
    expect(treatment.episodes[1]?.episodeTurns).not.toContain(
      'At 4 a.m. the archivist publishes the first field note under codename Dr.'
    );
  });
});
