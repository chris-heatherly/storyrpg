import { describe, expect, it } from 'vitest';
import type { Story } from '../../types';
import {
  canonicalizeProtagonistPronouns,
  otherGenderNamesFromStory,
  applyPronounDisambiguations,
} from './protagonistPronounResolver';

function storyWith(npcs: Array<{ name: string; pronouns: string }>, beats: Array<Record<string, unknown>>): Story {
  return {
    id: 's', title: 't', genre: 'g', synopsis: '', coverImage: '',
    initialState: { attributes: {}, skills: {}, tags: [], inventory: [] },
    npcs: npcs.map((n, i) => ({ id: `npc-${i}`, name: n.name, description: '', pronouns: n.pronouns })),
    episodes: [{
      id: 'ep1', number: 1, title: '', synopsis: '', coverImage: '',
      startingSceneId: 's1',
      scenes: [{ id: 's1', name: 's1', startingBeatId: 'b1', beats }],
    }],
  } as unknown as Story;
}

const KYLIE = { names: ['Kylie', 'Kylie Marinescu'], pronouns: 'she/her' };

/** Read the first beat's narrativeText (carried as an arbitrary field on the test fixture). */
function beat0(story: Story): Record<string, unknown> {
  return story.episodes[0].scenes[0].beats[0] as unknown as Record<string, unknown>;
}

describe('canonicalizeProtagonistPronouns', () => {
  it('repairs wrong-gender pronouns in protagonist-only sentences', () => {
    const story = storyWith(
      [{ name: 'Mika', pronouns: 'he/him' }],
      [{ id: 'b1', narrativeText: "Kylie keeps his eyes level and says nothing." }],
    );
    const result = canonicalizeProtagonistPronouns(story, KYLIE, otherGenderNamesFromStory(story, 'she/her'));
    expect(beat0(story).narrativeText).toBe('Kylie keeps her eyes level and says nothing.');
    expect(result.repaired).toBe(1);
    expect(result.ambiguous).toHaveLength(0);
  });

  it('repairs reflexives anchored on the protagonist', () => {
    const story = storyWith([], [{ id: 'b1', text: 'Kylie forces herself to wait, then asks Kylie to repeat himself.' }]);
    // Two sentences would be cleaner; here one sentence, no other-gender name -> repaired.
    canonicalizeProtagonistPronouns(story, KYLIE, []);
    expect(beat0(story).text).toContain('repeat herself');
  });

  it('does NOT rewrite when a male character is named in the same sentence (ambiguous)', () => {
    const story = storyWith(
      [{ name: 'Victor', pronouns: 'he/him' }],
      [{ id: 'b1', narrativeText: 'Victor looks at him, and Kylie holds the gaze.' }],
    );
    const result = canonicalizeProtagonistPronouns(story, KYLIE, otherGenderNamesFromStory(story, 'she/her'));
    // "him" could be Kylie OR Victor's object — never auto-rewritten.
    expect(beat0(story).narrativeText).toBe('Victor looks at him, and Kylie holds the gaze.');
    expect(result.repaired).toBe(0);
    expect(result.ambiguous).toHaveLength(1);
  });

  it('repairs the protagonist sentence and leaves a male-only sentence untouched', () => {
    const story = storyWith(
      [{ name: 'Mika', pronouns: 'he/him' }],
      [{ id: 'b1', narrativeText: 'Kylie keeps his eyes level. Mika studies his face.' }],
    );
    const result = canonicalizeProtagonistPronouns(story, KYLIE, otherGenderNamesFromStory(story, 'she/her'));
    const out = beat0(story).narrativeText as string;
    expect(out).toContain('Kylie keeps her eyes level.');
    // Second sentence has no protagonist reference -> correctly left alone (Mika's face).
    expect(out).toContain('Mika studies his face.');
    expect(result.repaired).toBe(1);
    expect(result.ambiguous).toHaveLength(0);
  });

  it('flags an ambiguous sentence where protagonist and a male NPC co-occur', () => {
    const story = storyWith(
      [{ name: 'Mika', pronouns: 'he/him' }],
      [{ id: 'b1', narrativeText: 'Kylie watches Mika lift his glass.' }],
    );
    const result = canonicalizeProtagonistPronouns(story, KYLIE, otherGenderNamesFromStory(story, 'she/her'));
    // "his" is Mika's; protagonist + male NPC co-occur -> never auto-rewritten, flagged.
    expect(beat0(story).narrativeText).toBe('Kylie watches Mika lift his glass.');
    expect(result.repaired).toBe(0);
    expect(result.ambiguous).toHaveLength(1);
  });

  it('leaves correct prose untouched and skips they/them protagonists', () => {
    const story = storyWith([], [{ id: 'b1', narrativeText: 'Kylie keeps her eyes level.' }]);
    const before = beat0(story).narrativeText;
    canonicalizeProtagonistPronouns(story, KYLIE, []);
    expect(beat0(story).narrativeText).toBe(before);

    const they = storyWith([], [{ id: 'b1', narrativeText: 'Kylie keeps his eyes level.' }]);
    const r = canonicalizeProtagonistPronouns(they, { names: ['Kylie'], pronouns: 'they/them' }, []);
    expect(r.repaired).toBe(0); // they/them is never "wrong gender"
  });

  it('preserves capitalization at sentence start', () => {
    const story = storyWith([], [{ id: 'b1', narrativeText: 'His hands shook. Kylie steadied them.' }]);
    // Sentence 1 PRECEDES any protagonist mention -> no topic established -> conservative skip.
    canonicalizeProtagonistPronouns(story, KYLIE, []);
    expect(beat0(story).narrativeText).toBe('His hands shook. Kylie steadied them.');
  });

  it('G12: repairs pronoun-only follow-on sentences under a protagonist topic', () => {
    // "The night swallows Kylie. He orders second…" shipped in g12 because the
    // follow-on sentence carries no name. Topic propagation repairs it.
    const story = storyWith([], [{ id: 'b1', narrativeText: 'Kylie froze. His instinct was to run.' }]);
    canonicalizeProtagonistPronouns(story, KYLIE, []);
    expect(beat0(story).narrativeText).toBe('Kylie froze. Her instinct was to run.');

    // An intervening other-gender NAME clears the topic — conservative again.
    const story2 = storyWith([], [{ id: 'b1', narrativeText: 'Kylie froze. Victor stepped in. His instinct was to run.' }]);
    canonicalizeProtagonistPronouns(story2, KYLIE, ['Victor']);
    expect(beat0(story2).narrativeText).toContain('His instinct');
  });
});

describe('canonicalizeProtagonistPronouns — reflexive in ambiguous sentence (gen-5 clock bug)', () => {
  it('repairs a wrong-gender REFLEXIVE even when another character is named', () => {
    // "how fully Kylie allows himself to be present … for Victor" — the blanket
    // ambiguity skip left "himself" unrepaired because Victor is also named, but a
    // reflexive binds to its clause subject (Kylie), so it is safe to repair.
    const story = storyWith(
      [{ name: 'Victor', pronouns: 'he/him' }],
      [{ id: 'b1', description: 'How fully Kylie allows himself to be present in Bucharest, instead of performing it for Victor.' }],
    );
    const result = canonicalizeProtagonistPronouns(story, KYLIE, otherGenderNamesFromStory(story, 'she/her'));
    expect(beat0(story).description).toContain('allows herself');
    expect(beat0(story).description).not.toContain('himself');
    expect(result.repaired).toBeGreaterThanOrEqual(1);
  });

  it('still reports (does not touch) a non-reflexive pronoun that is genuinely ambiguous', () => {
    const story = storyWith(
      [{ name: 'Victor', pronouns: 'he/him' }],
      [{ id: 'b1', description: 'Kylie watches Victor lift his glass.' }],
    );
    const result = canonicalizeProtagonistPronouns(story, KYLIE, otherGenderNamesFromStory(story, 'she/her'));
    // "his" could be Victor's — left untouched, reported as ambiguous.
    expect(beat0(story).description).toContain('his glass');
    expect(result.ambiguous.length).toBeGreaterThanOrEqual(1);
  });

  it('does not rewrite a male NPC pronoun when only the NPC first name appears with a protagonist possessive', () => {
    const story = storyWith(
      [{ name: 'Victor Valcescu', pronouns: 'he/him' }],
      [{
        id: 'b1',
        visualMoment: 'Victor stands just outside the light of Kylie\'s apartment building entrance, looking down at her as he says her name.',
      }],
    );
    const result = canonicalizeProtagonistPronouns(story, KYLIE, otherGenderNamesFromStory(story, 'she/her'));

    expect(beat0(story).visualMoment).toBe('Victor stands just outside the light of Kylie\'s apartment building entrance, looking down at her as he says her name.');
    expect(result.repaired).toBe(0);
    expect(result.ambiguous.length).toBeGreaterThanOrEqual(1);
  });
});

describe('otherGenderNamesFromStory', () => {
  it('returns male NPC names for a female protagonist', () => {
    const story = storyWith(
      [{ name: 'Victor', pronouns: 'he/him' }, { name: 'Stela', pronouns: 'she/her' }],
      [{ id: 'b1', text: '' }],
    );
    expect(otherGenderNamesFromStory(story, 'she/her')).toEqual(['Victor']);
  });

  it('includes full names and first-name aliases for wrong-gender NPCs', () => {
    const story = storyWith(
      [{ name: 'Victor Valcescu', pronouns: 'he/him' }, { name: 'Stela Pavel', pronouns: 'she/her' }],
      [{ id: 'b1', text: '' }],
    );
    expect(otherGenderNamesFromStory(story, 'she/her')).toEqual(['Victor Valcescu', 'Victor']);
  });
});

describe('applyPronounDisambiguations', () => {
  it('replaces an ambiguous sentence in a reader-facing field (incl. encounter outcomeText)', () => {
    const story = storyWith(
      [{ name: 'Victor', pronouns: 'he/him' }],
      [{ id: 'b1', outcomeText: 'Kylie watches Victor lift his glass. The room goes quiet.' }],
    );
    const rewrites = new Map([
      ['Kylie watches Victor lift his glass.', 'Kylie watches Victor lift his own glass.'],
    ]);
    const applied = applyPronounDisambiguations(story, rewrites);
    expect(applied).toBe(1);
    expect(beat0(story).outcomeText).toBe('Kylie watches Victor lift his own glass. The room goes quiet.');
  });

  it('does not touch agent-facing fields and returns 0 when nothing matches', () => {
    const story = storyWith([{ name: 'Victor', pronouns: 'he/him' }], [
      { id: 'b1', text: 'Unrelated prose.', authorNote: 'Kylie watches Victor lift his glass.' },
    ]);
    const rewrites = new Map([['Kylie watches Victor lift his glass.', 'rewritten']]);
    // authorNote is NOT a reader-facing TEXT_KEY → never rewritten.
    expect(applyPronounDisambiguations(story, rewrites)).toBe(0);
    expect((beat0(story) as { authorNote: string }).authorNote).toBe('Kylie watches Victor lift his glass.');
    expect(applyPronounDisambiguations(story, new Map())).toBe(0);
  });
});
