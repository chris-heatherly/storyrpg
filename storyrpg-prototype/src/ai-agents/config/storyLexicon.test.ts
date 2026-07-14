import { afterEach, describe, expect, it } from 'vitest';
import {
  BITE_ME_LEXICON,
  GENRE_NEUTRAL_LEXICON,
  getStoryLexicon,
  resetStoryLexiconFromEnv,
  resolveStoryLexiconFromEnv,
  setStoryLexicon,
} from './storyLexicon';

describe('storyLexicon (R2.4)', () => {
  afterEach(() => {
    resetStoryLexiconFromEnv({});
  });

  it('defaults to Bite-Me when env is unset (golden stability)', () => {
    expect(resolveStoryLexiconFromEnv({})).toBe(BITE_ME_LEXICON);
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
});
