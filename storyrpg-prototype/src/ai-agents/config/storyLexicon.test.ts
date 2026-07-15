import { afterEach, describe, expect, it } from 'vitest';
import {
  BITE_ME_LEXICON,
  GENRE_NEUTRAL_LEXICON,
  getStoryLexicon,
  resetStoryLexiconFromEnv,
  resolveStoryLexiconFromEnv,
  setStoryLexicon,
  withDeclaredContainerLocations,
} from './storyLexicon';

describe('storyLexicon (R2.4)', () => {
  afterEach(() => {
    resetStoryLexiconFromEnv({});
  });

  it('defaults to genre-neutral when env is unset or unrecognized', () => {
    expect(resolveStoryLexiconFromEnv({})).toBe(GENRE_NEUTRAL_LEXICON);
    expect(resolveStoryLexiconFromEnv({ STORYRPG_STORY_LEXICON: 'unknown-story' })).toBe(GENRE_NEUTRAL_LEXICON);
  });

  it('flips to genre-neutral when STORYRPG_STORY_LEXICON=genre_neutral', () => {
    expect(resolveStoryLexiconFromEnv({ STORYRPG_STORY_LEXICON: 'genre_neutral' })).toBe(GENRE_NEUTRAL_LEXICON);
    resetStoryLexiconFromEnv({ STORYRPG_STORY_LEXICON: 'genre_neutral' });
    expect(getStoryLexicon()).toBe(GENRE_NEUTRAL_LEXICON);
  });

  it('setStoryLexicon overrides until reset', () => {
    setStoryLexicon(GENRE_NEUTRAL_LEXICON);
    expect(getStoryLexicon()).toBe(GENRE_NEUTRAL_LEXICON);
    resetStoryLexiconFromEnv({ STORYRPG_STORY_LEXICON: 'bite_me' });
    expect(getStoryLexicon()).toBe(BITE_ME_LEXICON);
  });

  it('derives a run-scoped container from the declared primary setting', () => {
    const lexicon = withDeclaredContainerLocations(GENRE_NEUTRAL_LEXICON, [
      'Modern Lisbon, Portugal (including Alfama and the riverfront)',
    ]);
    expect(lexicon.containerCities).toContain('lisbon');
    expect(lexicon.containerCities).not.toContain('portugal');
    expect(lexicon.containerCities).not.toContain('alfama');
    expect(GENRE_NEUTRAL_LEXICON.containerCities).not.toContain('lisbon');
  });

  it('registers every conjunct of a multi-part declared setting (bite-me 2026-07-15 plan abort)', () => {
    // "Modern Bucharest and the Carpathian Mountains (Bran), Romania" used to
    // register as ONE joined phrase that matched no mined cue, so "bucharest"
    // counted as a second major location and SceneConstructionGate aborted the
    // plan (conflicts: apartment+bucharest, exploration+bucharest).
    const lexicon = withDeclaredContainerLocations(GENRE_NEUTRAL_LEXICON, [
      'Modern Bucharest and the Carpathian Mountains (Bran), Romania',
    ]);
    expect(lexicon.containerCities).toContain('bucharest');
    expect(lexicon.containerCities).toContain('carpathian mountains');
    expect(lexicon.containerCities).not.toContain('bran');
    expect(lexicon.containerCities).not.toContain('romania');
  });
});
