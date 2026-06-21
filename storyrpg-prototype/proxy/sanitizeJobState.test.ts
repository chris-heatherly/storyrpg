import { describe, expect, it } from 'vitest';

const { sanitizeJobState, scrubPlanningRegisterProse } = require('./sanitizeJobState');

describe('sanitizeJobState planning-register scrub', () => {
  it('rewrites choice-response planning prose in nested worker state', () => {
    const raw =
      "The bell over the door to Lumina Books chimes softly as you step inside.\n\n" +
      "The next beat visibly responds to the authored choice: At the door of Valcescu Club on night two: accept Mika's key card to the side entrance, or thank her politely and leave it.";

    const sanitized = sanitizeJobState({
      checkpoint: {
        output: {
          text: raw,
          designNotes: 'Deterministic sceneEpisode fallback: preserves authored choice pressure when ChoiceAuthor does not produce a usable choice set.',
        },
      },
    });

    expect(sanitized.checkpoint.output.text).not.toContain('The next beat visibly responds');
    expect(sanitized.checkpoint.output.text).toContain("The memory of Mika's key card");
    expect(sanitized.checkpoint.output.designNotes).toContain('preserves treatment pressure');
  });

  it('leaves ordinary prose untouched', () => {
    const text = 'The bell over the door chimes softly as you step inside.';
    expect(scrubPlanningRegisterProse(text)).toBe(text);
  });
});
