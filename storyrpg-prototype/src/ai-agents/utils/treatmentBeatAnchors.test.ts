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

const STORY_CIRCLE_TREATMENT = `# Branching-Narrative Season Treatment

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

  it('populates seasonGuidance.storyCircleBeatEpisodeAnchors from the current Story Circle spine', () => {
    const treatment = extractTreatmentFromMarkdown(STORY_CIRCLE_TREATMENT);
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
    expect(treatment.episodes[1]?.normalizedStructuralRoles).toEqual(['hook']);
    expect(treatment.episodes[3]?.normalizedStructuralRoles).toEqual(['plotTurn1']);
  });
});
