import { describe, expect, it, afterEach } from 'vitest';
import { BaseAgent } from './BaseAgent';

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

describe('CharacterDesigner relationship-dimension backfill (1.4)', () => {
  const designer: any = new CharacterDesigner({ provider: 'anthropic', model: 'test', apiKey: 'test', maxTokens: 1000, temperature: 0 });
  const normalize = (characters: any[]) => designer.normalizeCharacterBible({ characters, keyDynamics: [], gaps: [], doNotForget: [] });

  it('backfills all four neutral dimensions for a core NPC with no initialStats', () => {
    const bible = normalize([{ id: 'rival', name: 'Rival', pronouns: 'she/her', tier: 'core' }]);
    expect(bible.characters[0].initialStats).toEqual({ trust: 0, affection: 0, respect: 0, fear: 0 });
  });

  it('preserves authored values and fills only missing dimensions for supporting NPCs', () => {
    const bible = normalize([{ id: 'ally', name: 'Ally', pronouns: 'he/him', tier: 'supporting', initialStats: { trust: 40 } }]);
    expect(bible.characters[0].initialStats).toEqual({ trust: 40, affection: 0, respect: 0, fear: 0 });
  });

  it('leaves background NPCs untouched', () => {
    const bible = normalize([{ id: 'extra', name: 'Extra', pronouns: 'they/them', tier: 'background' }]);
    expect(bible.characters[0].initialStats).toBeUndefined();
  });
});

describe('CharacterDesigner.fillMissingCharacters (incomplete-cast backfill)', () => {
  afterEach(() => BaseAgent.setLlmTransportOverride(null));
  const designer: any = new CharacterDesigner({ provider: 'anthropic', model: 'test', apiKey: 'test', maxTokens: 1000, temperature: 0 });
  const req = (id: string, name: string) => ({ id, name, role: 'supporting', importance: 'minor', briefDescription: `${name} desc` });
  const input = () => ({
    charactersToCreate: [req('char-a', 'A'), req('char-b', 'B'), req('char-c', 'C')],
    storyContext: { title: 'T', genre: 'Drama', tone: 'Tense', themes: ['trust'], userPrompt: 'p' },
  });

  it('re-requests only the missing character(s) and merges them in', async () => {
    let calls = 0;
    let promptedIds = '';
    BaseAgent.setLlmTransportOverride(async (r) => {
      calls += 1;
      promptedIds = r.messages.map((m) => String(m.content)).join('\n');
      return JSON.stringify({ characters: [{ id: 'char-c', name: 'C', pronouns: 'they/them', tier: 'core' }], keyDynamics: [], gaps: [], doNotForget: [] });
    });
    const bible: any = { characters: [{ id: 'char-a', name: 'A' }, { id: 'char-b', name: 'B' }], keyDynamics: [], gaps: [], doNotForget: [] };

    await designer.fillMissingCharacters(bible, input());

    expect(calls).toBe(1); // one focused backfill call
    expect(promptedIds).toContain('char-c'); // re-requested the missing one
    expect(promptedIds).not.toContain('char-a'); // NOT the ones already present
    expect(bible.characters.map((c: any) => c.id).sort()).toEqual(['char-a', 'char-b', 'char-c']);
  });

  it('is a no-op (no LLM call) when every requested character is present', async () => {
    let calls = 0;
    BaseAgent.setLlmTransportOverride(async () => { calls += 1; return '{}'; });
    const bible: any = { characters: [{ id: 'char-a', name: 'A' }, { id: 'char-b', name: 'B' }, { id: 'char-c', name: 'C' }] };
    await designer.fillMissingCharacters(bible, input());
    expect(calls).toBe(0);
    expect(bible.characters).toHaveLength(3);
  });

  it('leaves the bible incomplete (does not throw) when the backfill call fails', async () => {
    BaseAgent.setLlmTransportOverride(async () => { throw new Error('transport boom'); });
    const bible: any = { characters: [{ id: 'char-a', name: 'A' }], keyDynamics: [], gaps: [], doNotForget: [] };
    await expect(designer.fillMissingCharacters(bible, input())).resolves.toBeUndefined();
    expect(bible.characters.map((c: any) => c.id)).toEqual(['char-a']); // unchanged; validation surfaces the gap
  });
});

describe('CharacterDesigner.parseCharacterBibleWithCompactRetry (malformed/truncated recovery)', () => {
  afterEach(() => BaseAgent.setLlmTransportOverride(null));
  const designer: any = new CharacterDesigner({ provider: 'anthropic', model: 'test', apiKey: 'test', maxTokens: 1000, temperature: 0 });
  const input = () => ({
    charactersToCreate: [{ id: 'char-a', name: 'A', role: 'lead', importance: 'major', briefDescription: 'A desc' }],
    storyContext: { title: 'T', genre: 'Drama', tone: 'Tense', themes: ['x'], userPrompt: 'p' },
  });
  const GOOD = '{"characters":[{"id":"char-a","name":"A"}],"keyDynamics":[],"gaps":[],"doNotForget":[]}';

  it('takes the single-call path on a clean first response (no retry)', async () => {
    let calls = 0;
    BaseAgent.setLlmTransportOverride(async () => { calls += 1; return GOOD; });
    const out = await designer.parseCharacterBibleWithCompactRetry(input(), 'BASE_PROMPT', GOOD);
    expect(out.characters).toHaveLength(1);
    expect(calls).toBe(0); // clean first response → no compact retry
  });

  it('retries compactly when the first response is truncated, and the retry succeeds', async () => {
    let prompt = '';
    BaseAgent.setLlmTransportOverride(async (req) => { prompt = req.messages.map((m) => String(m.content)).join('\n'); return GOOD; });
    // Truncated mid-string: parseJSON recovers + flags truncation → retry fires.
    const truncated = '{"characters":[{"id":"char-a","name":"truncated mid';
    const out = await designer.parseCharacterBibleWithCompactRetry(input(), 'BASE_PROMPT', truncated);
    expect(out.characters).toHaveLength(1);
    expect(prompt).toContain('strictly-valid JSON'); // the retry carries the compact directive
    expect(prompt).toContain('BASE_PROMPT');
  });
});
