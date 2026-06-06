/**
 * Unit test for Phase 1, Step 1.1: the deterministic parser must decompose the
 * Section-7 free-text season spine (`Plot turn 1 (Ep3)` etc.) into the structured
 * `seasonGuidance.beatEpisodeAnchors` map on the extracted treatment.
 */

import { describe, expect, it } from 'vitest';
import { extractTreatmentFromMarkdown } from './treatmentExtraction';

// Minimal treatment markdown carrying enough markers to be classified as a
// treatment plus a Section-7 spine with explicit (EpN) beat anchors.
const TREATMENT = `# Branching-Narrative Season Treatment

## 7. 3-Act / 7-Point Season Spine
- Hook (Ep1)
- Plot turn 1 (Ep3)
- Pinch 1 (Ep4)
- Midpoint (Ep6)
- Pinch 2 (Ep7)
- Climax (Ep10)

## 9. Episode Outline

### Episode 1: Dawn and Discord
- Structural role: hook
- Episode promise: the valley wakes
- Cliffhanger question: who lit the beacon?

### Episode 3: The Siege Tightens
- Structural role: plotTurn1
- Episode promise: the walls hold, barely
- Cliffhanger question: can they break the line?
`;

describe('Step 1.1 — Section-7 beat→episode anchor parsing', () => {
  it('populates seasonGuidance.beatEpisodeAnchors from the spine', () => {
    const treatment = extractTreatmentFromMarkdown(TREATMENT);
    expect(treatment.isTreatment).toBe(true);
    expect(treatment.seasonGuidance?.beatEpisodeAnchors).toEqual({
      hook: 1,
      plotTurn1: 3,
      pinch1: 4,
      midpoint: 6,
      pinch2: 7,
      climax: 10,
    });
  });

  it('leaves beatEpisodeAnchors unset when the spine has no (EpN) anchors', () => {
    const noAnchors = TREATMENT.replace(/\(Ep\d+\)/g, '');
    const treatment = extractTreatmentFromMarkdown(noAnchors);
    expect(treatment.seasonGuidance?.beatEpisodeAnchors).toBeUndefined();
  });
});
