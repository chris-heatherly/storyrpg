import { describe, expect, it } from 'vitest';
import { resolvePlayerTemplateString, resolvePlayerTemplatesInObject } from './playerTemplateResolver';

describe('playerTemplateResolver', () => {
  it('resolves player name and pronoun templates into concrete prose', () => {
    const result = resolvePlayerTemplateString(
      '{{Player.name}} lifts {{player.their}} bag before {{player.they}} leave.',
      { name: 'Charley Whitaker', pronouns: 'she/her' },
    );

    expect(result.value).toBe('Charley Whitaker lifts her bag before she leaves.');
    expect(result.replacements).toBe(3);
  });

  it('walks nested story-like objects', () => {
    const result = resolvePlayerTemplatesInObject(
      {
        text: '{{player.name}} waits.',
        beats: [{ text: '{{Player.they}} listen.' }],
      },
      { name: 'Morgan', pronouns: 'they/them' },
    );

    expect(result.value).toEqual({
      text: 'Morgan waits.',
      beats: [{ text: 'They listen.' }],
    });
    expect(result.replacements).toBe(2);
  });
});
