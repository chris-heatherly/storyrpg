import { describe, expect, it } from 'vitest';
import { extractTreatmentFromMarkdown } from './treatmentExtraction';

const TREATMENT_WITH_LITERAL_FACTS = `# Branching-Narrative Season Treatment

## 9. Episode Outline

### Episode 1: Mr. Midnight
- Structural role: hook
- Episode promise: Kylie learns the blog can change her life.
- Synopsis: Kylie publishes the Mr. Midnight post; by 6pm it has 80,000 reads and brand deals start appearing in her inbox.
- Cliffhanger question: who left the black roses?

### Episode 3: The Name on the Chain
- Structural role: plotTurn1
- Episode promise: the club glamour starts leaking family history.
- Synopsis: Marinescu recognizes Kylie's grandmother Veronica by her maiden name and the gold chain in Kylie's bag.
- Cliffhanger question: why does Victor vanish from the photograph?
`;

describe('extractTreatmentFromMarkdown literal episode anchors', () => {
  it('preserves authored social-proof numbers and named lineage facts without making them scene-driving episode turns', () => {
    const treatment = extractTreatmentFromMarkdown(TREATMENT_WITH_LITERAL_FACTS);

    expect(treatment.episodes[1]?.episodeTurns ?? []).not.toContain(
      'by 6pm it has 80,000 reads and brand deals start appearing in her inbox.',
    );
    expect(treatment.episodes[3]?.episodeTurns ?? []).not.toContain(
      "Marinescu recognizes Kylie's grandmother Veronica by her maiden name and the gold chain in Kylie's bag.",
    );
    expect(treatment.episodes[1]?.consequenceSeeds).toContain(
      'by 6pm it has 80,000 reads and brand deals start appearing in her inbox.',
    );
    expect(treatment.episodes[3]?.consequenceSeeds).toContain(
      "Marinescu recognizes Kylie's grandmother Veronica by her maiden name and the gold chain in Kylie's bag.",
    );
    expect(treatment.episodes[1]?.informationMovement).toContain('80,000 reads');
    expect(treatment.episodes[3]?.informationMovement).toContain('Veronica');
  });
});
