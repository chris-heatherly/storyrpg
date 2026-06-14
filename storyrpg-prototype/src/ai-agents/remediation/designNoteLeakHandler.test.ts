import { describe, expect, it } from 'vitest';
import { buildDesignNoteLeakStripHandler } from './designNoteLeakHandler';
import type { Story } from '../../types/story';

const handler = buildDesignNoteLeakStripHandler();
const CUE = 'Victor remembers you sided with him at the bridge.';

// A beat carrying a real prose variant plus a leaked feedback-cue variant; the choice
// that owns the cue lives on the same beat (the validator collects cues story-wide).
function storyWithLeak(): Story {
  return {
    episodes: [{
      number: 1,
      scenes: [{
        id: 's1',
        beats: [{
          id: 'b1',
          text: 'Base prose.',
          textVariants: [
            { text: 'A genuine alternate beat with its own staged action and detail.' },
            { text: CUE }, // the leak: a verbatim feedback cue masquerading as prose
          ],
          choices: [{ id: 'c1', text: 'Side with Victor', feedbackCue: { echoSummary: CUE } }],
        }],
      }],
    }],
  } as unknown as Story;
}

describe('buildDesignNoteLeakStripHandler', () => {
  it('strips the textVariant that is a verbatim feedback cue, keeping the real variant', () => {
    const story = storyWithLeak();
    const result = handler({ story, blockingIssues: [] }) as { story: Story; changed: boolean; record?: any };
    expect(result.changed).toBe(true);
    const beat: any = (result.story as any).episodes[0].scenes[0].beats[0];
    expect(beat.textVariants).toHaveLength(1);
    expect(beat.textVariants[0].text).toContain('genuine alternate beat');
    expect(beat.text).toBe('Base prose.'); // base prose untouched
    expect(result.record.rule).toBe('final_contract_design_note_leak');
    expect(result.record.attempted).toBe(1);
  });

  it('is a no-op when no variant matches a feedback cue (clean run → golden parity)', () => {
    const story = {
      episodes: [{ number: 1, scenes: [{ id: 's1', beats: [{
        id: 'b1', text: 'Base.', textVariants: [{ text: 'A real alternate.' }],
        choices: [{ id: 'c1', text: 'Go', feedbackCue: { echoSummary: CUE } }],
      }] }] }],
    } as unknown as Story;
    const result = handler({ story, blockingIssues: [] });
    expect(result.changed).toBe(false);
  });
});
