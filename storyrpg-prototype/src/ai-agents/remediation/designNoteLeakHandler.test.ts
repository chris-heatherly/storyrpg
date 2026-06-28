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

  it('strips a feedback cue appended as its own base-text paragraph', () => {
    const story = storyWithLeak();
    const beat: any = (story as any).episodes[0].scenes[0].beats[0];
    beat.text = `Base prose.\n\n${CUE}`;
    beat.textVariants = [{ text: 'A genuine alternate beat with its own staged action and detail.' }];

    const result = handler({ story, blockingIssues: [] }) as { story: Story; changed: boolean; record?: any };
    const repairedBeat: any = (result.story as any).episodes[0].scenes[0].beats[0];

    expect(result.changed).toBe(true);
    expect(repairedBeat.text).toBe('Base prose.');
    expect(repairedBeat.textVariants).toHaveLength(1);
    expect(result.record.attempted).toBe(1);
  });

  it('strips generic callback scaffolding appended as its own base-text paragraph', () => {
    const story = {
      episodes: [{ number: 1, scenes: [{ id: 's1', beats: [{
        id: 'b1',
        text: 'You stop typing, staring at the title you just wrote.\n\nAccepting the rose quartz from her still changes how this moment lands.',
        textVariants: [],
        choices: [],
      }] }] }],
    } as unknown as Story;

    const result = handler({ story, blockingIssues: [] }) as { story: Story; changed: boolean; record?: any };
    const repairedBeat: any = (result.story as any).episodes[0].scenes[0].beats[0];

    expect(result.changed).toBe(true);
    expect(repairedBeat.text).toBe('You stop typing, staring at the title you just wrote.');
    expect(result.record.attempted).toBe(1);
  });

  it('strips generic callback scaffolding when it is the whole textVariant', () => {
    const story = {
      episodes: [{ number: 1, scenes: [{ id: 's1', beats: [{
        id: 'b1',
        text: 'Base prose.',
        textVariants: [
          { text: 'A real alternate.' },
          { text: 'Opening the card and read it aloud to Mika still changes how this moment lands.' },
        ],
        choices: [],
      }] }] }],
    } as unknown as Story;

    const result = handler({ story, blockingIssues: [] }) as { story: Story; changed: boolean; record?: any };
    const repairedBeat: any = (result.story as any).episodes[0].scenes[0].beats[0];

    expect(result.changed).toBe(true);
    expect(repairedBeat.textVariants).toHaveLength(1);
    expect(repairedBeat.textVariants[0].text).toBe('A real alternate.');
  });

  it('strips treatment-residue planning directives appended to textVariants', () => {
    const leakedDirective = 'Show immediate residue from the authored path: Choosing the rooftop route changes who trusts you later.';
    const story = {
      episodes: [{ number: 1, scenes: [{ id: 's1', beats: [{
        id: 'b1',
        text: 'Base prose.',
        textVariants: [
          { text: `A real alternate beat with grounded action.\n\n${leakedDirective}` },
        ],
        choices: [],
      }] }] }],
    } as unknown as Story;

    const result = handler({ story, blockingIssues: [] }) as { story: Story; changed: boolean; record?: any };
    const repairedBeat: any = (result.story as any).episodes[0].scenes[0].beats[0];

    expect(result.changed).toBe(true);
    expect(repairedBeat.textVariants).toHaveLength(1);
    expect(repairedBeat.textVariants[0].text).toBe('A real alternate beat with grounded action.');
  });

  it('is a no-op when no variant matches a feedback cue (clean run → golden parity)', async () => {
    const story = {
      episodes: [{ number: 1, scenes: [{ id: 's1', beats: [{
        id: 'b1', text: 'Base.', textVariants: [{ text: 'A real alternate.' }],
        choices: [{ id: 'c1', text: 'Go', feedbackCue: { echoSummary: CUE } }],
      }] }] }],
    } as unknown as Story;
    const result = await handler({ story, blockingIssues: [] });
    expect(result.changed).toBe(false);
  });
});
