import { describe, it, expect } from 'vitest';
import {
  anchorIdentifier,
  buildArcStripAnchorPrompt,
  buildCharacterAnchorPrompt,
  buildEnvironmentAnchorPrompt,
} from './anchorPrompts';

const STYLE =
  'romance novel cover. rendered in the soft-focus illustrated style of romance novel covers; warm pastel palette; golden-hour glow.';

describe('buildCharacterAnchorPrompt', () => {
  it('produces a single-character portrait prompt scoped to the supplied style', () => {
    const built = buildCharacterAnchorPrompt({
      style: STYLE,
      protagonistName: 'Elena',
      colorTerms: ['warm coral', 'gold', 'deep teal'],
      protagonistDescription: 'Dark hair, green eyes, wine-red coat.',
    });
    expect(built.role).toBe('character-anchor');
    expect(built.prompt.style).toBe(STYLE);
    expect(built.prompt.prompt).toContain('Elena');
    expect(built.prompt.prompt).toContain('warm coral, gold, deep teal');
    expect(built.prompt.prompt).toContain('Identity anchors');
    expect(built.prompt.negativePrompt).toContain('text');
    expect(built.prompt.negativePrompt).toContain('multi-panel');
    expect(built.prompt.aspectRatio).toBe('3:4');
  });

  it('omits the identity line when no description is supplied', () => {
    const built = buildCharacterAnchorPrompt({
      style: STYLE,
      protagonistName: 'Rook',
    });
    expect(built.prompt.prompt).not.toContain('Identity anchors');
  });
});

describe('buildArcStripAnchorPrompt', () => {
  it('uses the supplied stripPrompt when provided', () => {
    const built = buildArcStripAnchorPrompt({
      style: STYLE,
      storyTitle: 'Starlight Harbor',
      stripPrompt: 'Five panels moving from storm gray to gold and back to gray.',
    });
    expect(built.role).toBe('arc-strip');
    expect(built.prompt.prompt).toBe('Five panels moving from storm gray to gold and back to gray.');
    expect(built.prompt.style).toBe(STYLE);
    expect(built.prompt.aspectRatio).toBe('4:1');
    expect(built.prompt.negativePrompt).toContain('person');
  });

  it('falls back to a style-agnostic strip description when no stripPrompt is supplied', () => {
    const built = buildArcStripAnchorPrompt({
      style: STYLE,
      storyTitle: 'Starlight Harbor',
    });
    expect(built.prompt.prompt).toContain('Starlight Harbor');
    expect(built.prompt.prompt).toContain('No characters');
  });
});

describe('buildEnvironmentAnchorPrompt', () => {
  it('renders a location-only vignette scoped to the style', () => {
    const built = buildEnvironmentAnchorPrompt({
      style: STYLE,
      storyTitle: 'Starlight Harbor',
      locationName: 'The Harbor Pier',
      toneTerms: ['warm coral', 'deep teal'],
    });
    expect(built.role).toBe('environment-anchor');
    expect(built.prompt.prompt).toContain('The Harbor Pier');
    expect(built.prompt.prompt).toContain('warm coral, deep teal');
    expect(built.prompt.style).toBe(STYLE);
    expect(built.prompt.aspectRatio).toBe('16:9');
    expect(built.prompt.negativePrompt).toContain('people');
  });

  it('uses a generic phrase when no location is supplied', () => {
    const built = buildEnvironmentAnchorPrompt({
      style: STYLE,
      storyTitle: 'Starlight Harbor',
    });
    expect(built.prompt.prompt).toContain("episode's primary location");
  });
});

describe('anchorIdentifier', () => {
  it('formats a slug-friendly identifier keyed off the story slug', () => {
    expect(anchorIdentifier('starlight-harbor', 'character-anchor')).toBe(
      'style-bible-starlight-harbor-character-anchor',
    );
    expect(anchorIdentifier('starlight-harbor', 'arc-strip')).toBe(
      'style-bible-starlight-harbor-arc-strip',
    );
    expect(anchorIdentifier('starlight-harbor', 'environment-anchor')).toBe(
      'style-bible-starlight-harbor-environment-anchor',
    );
  });
});
