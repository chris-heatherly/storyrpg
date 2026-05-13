import { describe, expect, it } from 'vitest';

import { CharacterDesigner, normalizeFashionStyle } from './CharacterDesigner';

describe('CharacterDesigner fashion style handling', () => {
  it('normalizes partial fashion style payloads without requiring legacy data', () => {
    expect(
      normalizeFashionStyle({
        styleSummary: ' Silk courtwear with knife-sharp lines ',
        styleTags: ['court fashion', ''],
        signatureGarments: ['high-collared coat'],
        materials: ['silk'],
        colorPalette: ['ivory', 'black'],
        accessories: ['signet ring'],
      })
    ).toEqual({
      styleSummary: 'Silk courtwear with knife-sharp lines',
      styleTags: ['court fashion'],
      signatureGarments: ['high-collared coat'],
      materials: ['silk'],
      colorPalette: ['ivory', 'black'],
      accessories: ['signet ring'],
    });

    expect(normalizeFashionStyle(undefined)).toBeUndefined();
    expect(normalizeFashionStyle({ styleSummary: '', styleTags: [] })).toBeUndefined();
  });

  it('preserves normalized fashion style when normalizing a character bible', () => {
    const designer = new CharacterDesigner({
      provider: 'anthropic',
      model: 'test',
      apiKey: 'test',
      maxTokens: 1000,
      temperature: 0,
    });

    const bible = (designer as any).normalizeCharacterBible({
      characters: [
        {
          id: 'hero',
          name: 'Hero',
          pronouns: 'they/them',
          role: 'protagonist',
          importance: 'major',
          overview: 'A lead.',
          fullBackground: 'A lead.',
          want: 'Find the truth.',
          fear: 'Losing the truth.',
          flaw: 'Refuses help.',
          traits: [],
          values: [],
          quirks: [],
          physicalDescription: 'Tall and watchful.',
          distinctiveFeatures: [],
          typicalAttire: 'weatherproof cloak',
          fashionStyle: {
            styleSummary: 'Weatherproof traveler layers.',
            styleTags: ['traveler'],
            signatureGarments: ['cloak'],
            materials: ['waxed cotton'],
            colorPalette: ['moss green'],
            accessories: ['map case'],
          },
          voiceProfile: {
            vocabulary: 'educated',
            sentenceLength: 'average',
            formality: 'neutral',
            verbalTics: [],
            favoriteExpressions: [],
            avoidedWords: [],
            whenHappy: '',
            whenAngry: '',
            whenNervous: '',
            whenLying: '',
            greetingExamples: [],
            farewellExamples: [],
            underStressExamples: [],
            writingGuidance: '',
          },
          relationships: [],
          arcPotential: { currentState: '', possibleGrowth: '', possibleFall: '', triggerEvents: [] },
        },
      ],
      keyDynamics: [],
      gaps: [],
      doNotForget: [],
    });

    expect(bible.characters[0].fashionStyle?.signatureGarments).toEqual(['cloak']);
    expect(bible.characters[0].fashionStyle?.colorPalette).toEqual(['moss green']);
  });

  it('restores requested fashion style when the LLM omits it', () => {
    const designer = new CharacterDesigner({
      provider: 'anthropic',
      model: 'test',
      apiKey: 'test',
      maxTokens: 1000,
      temperature: 0,
    });

    const bible: any = {
      characters: [{ id: 'hero', name: 'Hero', typicalAttire: '' }],
    };
    const input: any = {
      charactersToCreate: [
        {
          id: 'hero',
          fashionStyle: {
            styleSummary: 'Weatherproof traveler layers.',
            styleTags: ['traveler'],
            signatureGarments: ['cloak'],
            materials: ['waxed cotton'],
            colorPalette: ['moss green'],
            accessories: ['map case'],
          },
        },
      ],
    };

    (designer as any).preserveInputFashionStyle(bible, input);

    expect(bible.characters[0].fashionStyle.signatureGarments).toEqual(['cloak']);
    expect(bible.characters[0].typicalAttire).toContain('Weatherproof traveler layers');
  });
});
