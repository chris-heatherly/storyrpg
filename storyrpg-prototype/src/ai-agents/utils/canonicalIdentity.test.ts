import { describe, expect, it } from 'vitest';
import {
  canonicalPersonNamesEqual,
  isPlaceholderPersonName,
  normalizeCanonicalPersonName,
} from './canonicalIdentity';

describe('canonical identity policy', () => {
  it.each(['Hero', 'The Hero', 'the protagonist', 'Player Character', '{{protagonist.name}}', '<character name>', 'TBD'])(
    'rejects placeholder person name %s',
    (name) => {
      expect(isPlaceholderPersonName(name)).toBe(true);
      expect(normalizeCanonicalPersonName(name)).toBeUndefined();
    },
  );

  it('preserves real names and compares them canonically', () => {
    expect(normalizeCanonicalPersonName('  Kylie   Marinescu ')).toBe('Kylie Marinescu');
    expect(canonicalPersonNamesEqual('Kylie Marinescu', ' kylie  marinescu ')).toBe(true);
  });
});
