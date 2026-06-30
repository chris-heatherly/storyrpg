import { describe, expect, it } from 'vitest';
import { reconcileBriefStoryMetadata } from './briefStoryMetadata';

const baseStoryDefaults = {
  title: 'Bite Me',
  genre: 'Adventure', // documentParser default
  synopsis: 'An interactive story.', // documentParser default
  tone: 'Engaging and immersive', // documentParser default
  themes: ['adventure', 'choice', 'consequence'], // documentParser default
};

const reconcile = (brief: any, analysis: any) =>
  reconcileBriefStoryMetadata(brief as any, analysis as any);

describe('reconcileBriefStoryMetadata', () => {
  it('overwrites documentParser defaults with the season plan genre/tone/synopsis/themes', () => {
    const brief = {
      story: { ...baseStoryDefaults },
      seasonPlan: {
        genre: 'Paranormal Romance / Dark Romantic Comedy',
        tone: 'Champagne fizz on top, blood at the bottom.',
        seasonSynopsis: 'A food writer in Bucharest discovers her glamorous new life is a feeding ground.',
        themes: ['voice', 'possession', 'reinvention'],
      },
    };
    const analysis = { genre: 'ignored', tone: 'ignored', themes: ['ignored'] };

    const { brief: out, changed } = reconcile(brief, analysis);

    expect(changed).toBe(true);
    expect(out.story.genre).toBe('Paranormal Romance / Dark Romantic Comedy');
    expect(out.story.tone).toBe('Champagne fizz on top, blood at the bottom.');
    expect(out.story.synopsis).toContain('Bucharest');
    expect(out.story.themes).toEqual(['voice', 'possession', 'reinvention']);
  });

  it('falls back to the source analysis when the season plan lacks genre/tone', () => {
    const brief = { story: { ...baseStoryDefaults }, seasonPlan: undefined };
    const analysis = { genre: 'Mythic Fantasy Romance', tone: 'Lush and melancholic', themes: ['love', 'sacrifice'] };

    const { brief: out } = reconcile(brief, analysis);

    expect(out.story.genre).toBe('Mythic Fantasy Romance');
    expect(out.story.tone).toBe('Lush and melancholic');
    expect(out.story.themes).toEqual(['love', 'sacrifice']);
  });

  it('does NOT clobber an explicitly user-set genre/tone', () => {
    const brief = {
      story: { title: 'X', genre: 'Noir Thriller', synopsis: 'A real synopsis.', tone: 'Cold and precise', themes: ['betrayal'] },
      seasonPlan: { genre: 'Paranormal Romance', tone: 'Fizzy', seasonSynopsis: 'plan synopsis', themes: ['voice'] },
    };
    const { brief: out, changed } = reconcile(brief, { genre: 'g', tone: 't', themes: ['x'] });

    expect(changed).toBe(false);
    expect(out.story.genre).toBe('Noir Thriller');
    expect(out.story.tone).toBe('Cold and precise');
    expect(out.story.synopsis).toBe('A real synopsis.');
    expect(out.story.themes).toEqual(['betrayal']);
  });
});
