/**
 * Unit test for Phase 1, Step 1.1: the deterministic parser must decompose the
 * Story Circle free-text season spine (`Go (Ep3)` etc.) into the structured
 * `seasonGuidance.storyCircleBeatEpisodeAnchors` map on the extracted treatment.
 */

import { describe, expect, it } from 'vitest';
import { extractTreatmentFromMarkdown } from './treatmentExtraction';

// Minimal treatment markdown carrying enough markers to be classified as a
// treatment plus a Story Circle spine with explicit (EpN) beat anchors.
const TREATMENT = `# Branching-Narrative Season Treatment

## 3. Story Circle Season Spine
- You (Ep1): the valley's ordinary pressure
- Need (Ep2): the missing truth
- Go (Ep3): the siege threshold
- Search (Ep4): the ravine pressure
- Find (Ep6): the reveal
- Take (Ep7): betrayal costs the alliance
- Return (Ep10): the endsong confrontation
- Change (Ep10): dawn after the bargain

## 9. Episode Outline

### Episode 1: Dawn and Discord
- Story Circle role: you
- Episode promise: the valley wakes
- Cliffhanger question: who lit the beacon?

### Episode 3: The Siege Tightens
- Story Circle role: go
- Episode promise: the walls hold, barely
- Cliffhanger question: can they break the line?
`;

describe('Step 1.1 — Story Circle beat→episode anchor parsing', () => {
  it('populates seasonGuidance.storyCircleBeatEpisodeAnchors from the spine', () => {
    const treatment = extractTreatmentFromMarkdown(TREATMENT);
    expect(treatment.isTreatment).toBe(true);
    expect(treatment.seasonGuidance?.storyCircleBeatEpisodeAnchors).toEqual({
      you: 1,
      need: 2,
      go: 3,
      search: 4,
      find: 6,
      take: 7,
      return: 10,
      change: 10,
    });
  });

  it('leaves storyCircleBeatEpisodeAnchors unset when the spine has no (EpN) anchors', () => {
    const noAnchors = TREATMENT.replace(/\(Ep\d+\)/g, '');
    const treatment = extractTreatmentFromMarkdown(noAnchors);
    expect(treatment.seasonGuidance?.storyCircleBeatEpisodeAnchors).toBeUndefined();
  });

  it('extracts raw Story Circle role text from episode guidance', () => {
    const treatment = extractTreatmentFromMarkdown(TREATMENT);
    expect(treatment.episodes[1]?.rawStoryCircleRole).toBe('you');
    expect(treatment.episodes[3]?.rawStoryCircleRole).toBe('go');
  });
});
