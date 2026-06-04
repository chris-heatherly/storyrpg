import { describe, it, expect } from 'vitest';
import type { Story } from '../../../types/story';
import type { Beat } from '../../../types/content';
import { repairMechanicsLeakage } from './mechanicsLeakageRepair';
import {
  MechanicsLeakageValidator,
  type MechanicsLeakageText,
} from '../../validators/MechanicsLeakageValidator';

const ENABLED = (flag: string) => flag === 'GATE_MECHANICS_LEAKAGE';
const DISABLED = (_flag: string) => false;

/** Build a one-beat / one-scene / one-episode Story around the given beat. */
function makeStory(beat: Partial<Beat> & { id: string; text: string }): Story {
  const fullBeat: Beat = {
    ...beat,
    id: beat.id,
    text: beat.text,
  };
  return {
    id: 'story-1',
    title: 'T',
    genre: 'g',
    synopsis: 's',
    coverImage: '',
    initialState: { attributes: {} as never, skills: {} as never, tags: [], inventory: [] },
    npcs: [],
    episodes: [
      {
        id: 'ep-1',
        number: 1,
        title: 'E',
        synopsis: 's',
        coverImage: '' as never,
        startingSceneId: 'sc-1',
        scenes: [
          {
            id: 'sc-1',
            name: 'S',
            startingBeatId: fullBeat.id,
            beats: [fullBeat],
          },
        ],
      },
    ],
  } as Story;
}

/** Run the real validator over every beat (+ variants) in the story. */
function validate(story: Story) {
  const texts: MechanicsLeakageText[] = [];
  for (const ep of story.episodes) {
    for (const sc of ep.scenes) {
      for (const b of sc.beats) {
        texts.push({ id: b.id, text: b.text, sceneId: sc.id, beatId: b.id });
        for (const [i, v] of (b.textVariants ?? []).entries()) {
          texts.push({ id: `${b.id}:v${i}`, text: v.text, sceneId: sc.id, beatId: b.id });
        }
      }
    }
  }
  return new MechanicsLeakageValidator().validate({ texts });
}

describe('repairMechanicsLeakage', () => {
  it('is a complete no-op when the gate flag is disabled', () => {
    const story = makeStory({ id: 'b1', text: 'Gained: Trust +10' });
    const before = JSON.parse(JSON.stringify(story));

    const result = repairMechanicsLeakage(story, DISABLED);

    expect(result.fixedCount).toBe(0);
    expect(result.records).toEqual([]);
    expect(story).toEqual(before);
  });

  it('redacts a safe isolated stat-delta fragment and clears the leak', () => {
    const story = makeStory({ id: 'b1', text: 'You step into the hall. Trust +10' });
    expect(validate(story).valid).toBe(false);

    const result = repairMechanicsLeakage(story, ENABLED);

    expect(result.fixedCount).toBe(1);
    expect(result.records).toHaveLength(1);
    expect(result.records[0]).toEqual({
      rule: 'MechanicsLeakage',
      scope: 'autofix',
      attempted: 1,
      succeeded: true,
      degraded: false,
      blocked: false,
      attempts: 1,
    });
    expect(story.episodes[0].scenes[0].beats[0].text).toBe('You step into the hall.');
    expect(validate(story).valid).toBe(true);
  });

  it('redacts isolated deltas inside text variants too', () => {
    const story = makeStory({
      id: 'b1',
      text: 'The door swings open.',
      textVariants: [{ condition: {} as never, text: 'Reward unlocked. +5 reputation' }],
    });
    expect(validate(story).valid).toBe(false);

    const result = repairMechanicsLeakage(story, ENABLED);

    expect(result.fixedCount).toBe(1);
    expect(story.episodes[0].scenes[0].beats[0].textVariants?.[0].text).toBe('Reward unlocked.');
    expect(validate(story).valid).toBe(true);
  });

  it('leaves an in-sentence stat delta untouched (deferred to regen)', () => {
    // Narrative-frame verb "increased" => the delta is woven into prose; skip it.
    const text = 'Her trust in you increased, and trust +10 flickered past.';
    const story = makeStory({ id: 'b1', text });

    const result = repairMechanicsLeakage(story, ENABLED);

    expect(result.fixedCount).toBe(0);
    expect(result.records).toEqual([]);
    expect(story.episodes[0].scenes[0].beats[0].text).toBe(text);
  });

  it('does not touch non-delta leak classes (dice / probability / thresholds)', () => {
    // These belong to B1 regen, not deterministic redaction.
    const story = makeStory({
      id: 'b1',
      text: 'You roll a d20 and the odds of failure loom. Skill above 12 is required.',
    });
    const before = story.episodes[0].scenes[0].beats[0].text;

    const result = repairMechanicsLeakage(story, ENABLED);

    expect(result.fixedCount).toBe(0);
    expect(story.episodes[0].scenes[0].beats[0].text).toBe(before);
  });

  it('reports fixedCount 0 on an already-valid story', () => {
    const story = makeStory({
      id: 'b1',
      text: 'The lantern gutters as she presses her palm to the cold iron door.',
    });
    expect(validate(story).valid).toBe(true);
    const before = JSON.parse(JSON.stringify(story));

    const result = repairMechanicsLeakage(story, ENABLED);

    expect(result.fixedCount).toBe(0);
    expect(result.records).toEqual([]);
    expect(story).toEqual(before);
  });

  it('counts each removed delta fragment as its own fix', () => {
    const story = makeStory({ id: 'b1', text: 'Tally: Trust +10. XP +50.' });

    const result = repairMechanicsLeakage(story, ENABLED);

    expect(result.fixedCount).toBe(2);
    expect(result.records).toHaveLength(2);
    expect(validate(story).valid).toBe(true);
  });
});
