import { describe, it, expect } from 'vitest';
import { CharacterIntroductionValidator } from './CharacterIntroductionValidator';
import type { Scene, Story } from '../../types/story';

function makeScene(overrides: Partial<Scene> & { id: string }): Scene {
  return {
    name: overrides.id,
    beats: [],
    startingBeatId: '',
    ...overrides,
  } as Scene;
}

const beat = (text: string) => ({ id: 'b1', text, nextBeatId: undefined }) as never;

function makeStory(
  npcs: Array<{ id: string; name: string }>,
  episodes: Array<{ number: number; scenes: Scene[] }>,
): Story {
  return {
    id: 'test-story',
    title: 'Test',
    genre: 'drama',
    synopsis: '',
    coverImage: '',
    initialState: { attributes: {} as never, skills: {} as never, tags: [], inventory: [] },
    npcs: npcs.map((n) => ({ ...n, description: '' })),
    episodes: episodes.map((e) => ({
      id: `ep-${e.number}`,
      number: e.number,
      title: `Ep ${e.number}`,
      synopsis: '',
      coverImage: '',
      scenes: e.scenes,
      startingSceneId: e.scenes[0]?.id ?? '',
    })),
  } as unknown as Story;
}

const validator = new CharacterIntroductionValidator();

describe('CharacterIntroductionValidator', () => {
  it('passes when a character is introduced on-page before later mentions', () => {
    const story = makeStory(
      [{ id: 'char-stela', name: 'Stela' }],
      [{
        number: 1,
        scenes: [
          makeScene({ id: 's1', charactersInvolved: ['char-stela'], beats: [beat('Stela looks up from the register as you enter.')] }),
          makeScene({ id: 's2', beats: [beat('You think about what Stela said.')] }),
        ],
      }],
    );
    const result = validator.validate({ story });
    expect(result.issues).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it('flags the Victor class: named in prose before any scene casts them', () => {
    const story = makeStory(
      [{ id: 'char-victor', name: 'Victor Vâlcescu' }],
      [{
        number: 2,
        scenes: [
          makeScene({ id: 's2-4', beats: [beat("You open Victor's first. Of course you do.")] }),
          makeScene({ id: 's3-2', charactersInvolved: ['char-victor'], beats: [beat('Victor is already there, gesturing at the roses.')] }),
        ],
      }],
    );
    const result = validator.validate({ story });
    const errors = result.issues.filter((i) => i.severity === 'error');
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain('Victor Vâlcescu');
    expect(errors[0].message).toContain('s2-4');
  });

  it('flags the Sylvanor class: cast in metadata but never named in prose', () => {
    const story = makeStory(
      [{ id: 'char-sylvanor', name: 'Sylvanor Dawnheart' }],
      [{
        number: 2,
        scenes: [
          makeScene({ id: 'enc-2-1', charactersInvolved: ['char-sylvanor'], beats: [beat('The archive floor gives way beneath you.')] }),
        ],
      }],
    );
    const result = validator.validate({ story });
    const warnings = result.issues.filter((i) => i.severity === 'warning');
    expect(warnings.some((w) => w.message.includes('metadata only'))).toBe(true);
  });

  it('flags first appearances that imply an off-page friend group before introduction', () => {
    const story = makeStory(
      [
        { id: 'char-mika', name: 'Mika Drăgan' },
        { id: 'char-stela', name: 'Stela Pavel' },
      ],
      [{
        number: 1,
        scenes: [
          makeScene({
            id: 's1-1',
            charactersInvolved: ['char-mika', 'char-stela'],
            beats: [beat('It has only been three days with Mika and Stela, so every easy gesture still feels slightly staged: Stela refills your wine and Mika watches over the rim of her glass.')],
          }),
        ],
      }],
    );

    const result = validator.validate({ story });
    const errors = result.issues.filter((issue) => issue.severity === 'error');
    expect(errors.some((issue) => issue.message.includes('off-page familiarity'))).toBe(true);
    expect(result.valid).toBe(false);
  });

  it('matches accented names via the unique first token', () => {
    const story = makeStory(
      [{ id: 'char-ileana', name: 'Ileana Vâlcescu' }],
      [{
        number: 1,
        scenes: [
          makeScene({ id: 's1', beats: [beat('Ileana watches you from the powder room mirror.')] }),
        ],
      }],
    );
    const result = validator.validate({ story });
    // Named with no cast presence anywhere → cold name-drop error.
    expect(result.issues.filter((i) => i.severity === 'error')).toHaveLength(1);
  });

  it('does not fire on ambiguous shared first names', () => {
    const story = makeStory(
      [
        { id: 'char-darian-s', name: 'Darian Stormwind' },
        { id: 'char-darian-v', name: 'Darian Vale' },
      ],
      [{
        number: 1,
        scenes: [
          // Bare "Darian" is ambiguous between two roster members — no match, no finding.
          makeScene({ id: 's1', beats: [beat('Darian crouches beside the soldier.')] }),
        ],
      }],
    );
    expect(validator.validate({ story }).issues).toEqual([]);
  });

  it('warns on plan drift: appearing before the planned introduction episode', () => {
    const story = makeStory(
      [{ id: 'char-vraxxan', name: 'Vraxxan' }],
      [{
        number: 1,
        scenes: [
          makeScene({ id: 's1-6', charactersInvolved: ['char-vraxxan'], beats: [beat('Vraxxan materializes. "Hello, old friend."')] }),
        ],
      }],
    );
    const result = validator.validate({
      story,
      characterIntroductions: [{ characterId: 'char-vraxxan', introducedInEpisode: 2 }],
    });
    const drift = result.issues.filter((i) => i.message.includes('season plan introduces them'));
    expect(drift).toHaveLength(1);
    expect(drift[0].severity).toBe('warning');
  });

  it('reads encounter prose so encounter-introduced characters count', () => {
    const story = makeStory(
      [{ id: 'char-sylvanor', name: 'Sylvanor Dawnheart' }],
      [{
        number: 2,
        scenes: [
          makeScene({
            id: 'enc-2-1',
            charactersInvolved: ['char-sylvanor'],
            beats: [],
            encounter: { setupText: 'Sylvanor Dawnheart bars the archive door, wary of your bloodied hands.' } as never,
          }),
        ],
      }],
    );
    expect(validator.validate({ story }).issues).toEqual([]);
  });
});
