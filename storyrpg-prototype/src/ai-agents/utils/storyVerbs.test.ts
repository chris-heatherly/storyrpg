import { describe, expect, it } from 'vitest';
import { deriveStoryVerbs } from './storyVerbs';

describe('deriveStoryVerbs', () => {
  it('returns genre-specific verbs before generic fallbacks', () => {
    const verbs = deriveStoryVerbs({ genre: 'Heist thriller', tone: 'tense' });

    expect(verbs.map((item) => item.verb)).toContain('case');
    expect(verbs.map((item) => item.verb)).toContain('tail');
    expect(verbs.length).toBeLessThanOrEqual(12);
  });

  it('returns generic verbs for unknown genres', () => {
    const verbs = deriveStoryVerbs({ genre: 'Kitchen sink dreamscape' });

    expect(verbs.length).toBeGreaterThan(0);
    expect(verbs[0]).toMatchObject({
      verb: expect.any(String),
      description: expect.any(String),
    });
  });
});
