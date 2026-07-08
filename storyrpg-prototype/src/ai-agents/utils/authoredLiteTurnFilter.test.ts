import { describe, expect, it } from 'vitest';
import { filterAuthoredLiteEpisodeTurns, isFutureSeasonEpisodeTurn } from './authoredLiteTurnFilter';

describe('authoredLiteTurnFilter', () => {
  it('filters future-season spoiler turns from early episodes', () => {
    expect(isFutureSeasonEpisodeTurn("Mika's Secret Contract", 1)).toBe(true);
    expect(isFutureSeasonEpisodeTurn('She explores the streets of Bucharest.', 1)).toBe(false);
  });

  it('drops likely-consequence and major-pressure planning register', () => {
    const turns = [
      'Kylie arrives in Bucharest with two suitcases.',
      "Mika's Secret Contract",
      'Major pressure: Can she start over?',
      'She explores the streets of Bucharest.',
    ];
    expect(filterAuthoredLiteEpisodeTurns(turns, 1)).toEqual([
      'Kylie arrives in Bucharest with two suitcases.',
      'She explores the streets of Bucharest.',
    ]);
  });
});
