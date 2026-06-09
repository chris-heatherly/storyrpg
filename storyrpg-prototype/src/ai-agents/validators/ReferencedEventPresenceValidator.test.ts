import { describe, it, expect } from 'vitest';
import { ReferencedEventPresenceValidator } from './ReferencedEventPresenceValidator';
import type { Story } from '../../types';

function story(sceneOpts: { objective: string; beats: Array<{ text?: string; mustShowDetail?: string }> }): Story {
  return {
    id: 's', title: 't', genre: 'romance', synopsis: '', coverImage: '',
    initialState: { attributes: {} as never, skills: {} as never, tags: [], inventory: [] },
    npcs: [],
    episodes: [{
      id: 'ep-3', number: 3, title: 'E3', synopsis: '', coverImage: '', startingSceneId: 's3-3',
      scenes: [{
        id: 's3-3', name: 'Splinters', startingBeatId: 'b1',
        sequenceIntent: { objective: sceneOpts.objective },
        beats: sceneOpts.beats.map((b, i) => ({ id: `b${i + 1}`, text: b.text || '', mustShowDetail: b.mustShowDetail })),
      }],
    }],
  } as unknown as Story;
}

const run = (s: Story) => new ReferencedEventPresenceValidator().validate({ story: s });

describe('ReferencedEventPresenceValidator', () => {
  it('flags enumerated objective items absent from the scene prose (G10 splinters)', () => {
    const res = run(story({
      objective: "Kylie collects four splinters of wrongness — Ileana's tears, the photograph, the maiden name, Mika's absence.",
      beats: [
        { text: 'In the powder room, Ileana presses a damp cloth to her wrist; her tears have left tracks in her makeup.' },
        { text: 'You watch her in the mirror and say nothing.' },
      ],
    }));
    const msgs = res.issues.map((i) => i.message).join('\n');
    // Ileana's tears ARE present → not flagged; photograph / maiden name / Mika's absence are absent → flagged.
    expect(res.issues.length).toBe(3);
    expect(msgs).toMatch(/photograph/i);
    expect(msgs).toMatch(/maiden name/i);
    expect(msgs).toMatch(/Mika's absence/i);
    expect(msgs).not.toMatch(/Ileana's tears/i);
  });

  it('passes when every enumerated item is dramatized', () => {
    const res = run(story({
      objective: 'You gather three clues — the photograph, the maiden name, the missing hour.',
      beats: [
        { text: 'The photograph on the mantle shows a woman with your face and no Victor beside her.' },
        { text: 'Veronica. The maiden name is stitched into the frame: Lupu.' },
        { text: 'Mika has been gone the better part of an hour, and no one will say where.' },
      ],
    }));
    expect(res.issues).toHaveLength(0);
  });

  it('ignores non-enumerated abstract objectives (no false positives)', () => {
    const res = run(story({
      objective: 'Kylie tries to absorb what happened and recalibrate before the next pressure.',
      beats: [{ text: 'You set your keys down and breathe.' }],
    }));
    expect(res.issues).toHaveLength(0);
  });

  it('ignores short lists (< 3 items)', () => {
    const res = run(story({
      objective: 'You notice two things — the photograph and the silence.',
      beats: [{ text: 'The room is quiet.' }],
    }));
    expect(res.issues).toHaveLength(0);
  });
});
