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

  it('does not flag a verbal forward reference the scene contract itself stages (storyrpg-lite 2026-07-05 Mika)', () => {
    // The authored s1-2 turn has Stela speak OF "her other friend Mika" before
    // Mika's on-page introduction in the next scene — the treatment demands
    // the mention, so it is a planned reference, not a cold name-drop.
    const story = makeStory(
      [
        { id: 'char-stela-pavel', name: 'Stela Pavel' },
        { id: 'char-mika-dragan', name: 'Mika Dragan' },
      ],
      [{
        number: 1,
        scenes: [
          makeScene({
            id: 's1-2',
            charactersInvolved: ['char-stela-pavel'],
            beats: [beat("'My friend Mika and I are going to Valescu Club tonight,' Stela Pavel says. 'You should come.'")],
          }),
          makeScene({
            id: 's1-3',
            charactersInvolved: ['char-stela-pavel', 'char-mika-dragan'],
            beats: [beat("'Mika, this is Kylie.' Mika Dragan gestures to the empty seat.")],
          }),
        ],
      }],
    );
    const plannedSceneContractText = new Map([
      ['s1-2', 'She wanders into a bookshop owned by Stela who befriends her and introduces Kylie to the secret nightlife world of Valescu Club and her other friend Mika.'],
    ]);

    const withContract = validator.validate({ story, plannedSceneContractText });
    expect(withContract.issues.filter((i) => i.severity === 'error')).toEqual([]);

    // Without the contract context the same story still flags — the exception
    // is scoped to plan-staged references only.
    const withoutContract = validator.validate({ story });
    expect(withoutContract.issues.filter((i) => i.severity === 'error')).toHaveLength(1);
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

  it('flags the Stela class: first appearance introduced via an unseen prior meeting ("the woman from the bookstore")', () => {
    const story = makeStory(
      [{ id: 'char-stela', name: 'Stela Pavel' }],
      [{
        number: 1,
        scenes: [
          makeScene({ id: 's1-1', beats: [beat('You wrestle your luggage through the heavy oak door.')] }),
          makeScene({
            id: 's1-2',
            charactersInvolved: ['char-stela'],
            beats: [beat('You, Mika, and Stela Pavel—the woman from the bookstore—have claimed a corner, the low thrum of music a curtain around your table.')],
          }),
        ],
      }],
    );

    const result = validator.validate({ story });
    const errors = result.issues.filter((issue) => issue.severity === 'error');
    expect(errors.some((issue) => issue.message.includes('back-reference') && issue.message.includes('s1-2'))).toBe(true);
    expect(result.valid).toBe(false);
  });

  it('does not flag a first appearance that introduces the character in-scene', () => {
    const story = makeStory(
      [{ id: 'char-stela', name: 'Stela Pavel' }],
      [{
        number: 1,
        scenes: [
          makeScene({
            id: 's1-2',
            charactersInvolved: ['char-stela'],
            beats: [beat('A woman with silver-streaked hair sets down her glass and offers a hand. "Stela Pavel," she says. "Mika collects strays; I vet them."')],
          }),
        ],
      }],
    );

    const result = validator.validate({ story });
    expect(result.issues.filter((issue) => issue.message.includes('back-reference'))).toEqual([]);
  });

  it('does not flag a multi-character bookshop introduction that mentions a club handoff', () => {
    const story = makeStory(
      [
        { id: 'char-mika', name: 'Mika Dragan' },
        { id: 'char-stela', name: 'Stela Pavel' },
      ],
      [{
        number: 1,
        scenes: [
          makeScene({
            id: 's1-2',
            charactersInvolved: ['char-mika', 'char-stela'],
            beats: [beat('You push through the bookshop door. Stela Pavel looks up from the counter and offers a hand. "Kylie?" she says. "Mika mentioned you might wander in. There is a private door at the Vâlcescu Club tonight if you want to see what her other friend means by nightlife."')],
          }),
        ],
      }],
    );

    const result = validator.validate({ story });
    expect(result.issues.filter((issue) => issue.message.includes('off-page familiarity'))).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it('still flags summary-style third-person familiarity on a first meeting scene', () => {
    const story = makeStory(
      [
        { id: 'char-mika', name: 'Mika Dragan' },
        { id: 'char-stela', name: 'Stela Pavel' },
      ],
      [{
        number: 1,
        scenes: [
          makeScene({
            id: 's1-2',
            charactersInvolved: ['char-mika', 'char-stela'],
            beats: [beat('She explores the streets of Bucharest and wanders into a bookshop owned by Stela who befriends her and introduces Kylie to the secret nightlife world of Valescu Club and her other friend Mika.')],
          }),
        ],
      }],
    );

    const result = validator.validate({ story });
    expect(result.issues.some((issue) => issue.message.includes('off-page familiarity'))).toBe(true);
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
