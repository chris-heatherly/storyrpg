import { describe, expect, it, afterEach } from 'vitest';
import { BaseAgent, TruncatedLLMResponseError } from './BaseAgent';

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

describe('CharacterDesigner low-weight voice sample backfill', () => {
  const designer: any = new CharacterDesigner({ provider: 'anthropic', model: 'test', apiKey: 'test', maxTokens: 1000, temperature: 0 });

  const voice = (greetingExamples: string[]) => ({
    vocabulary: 'educated',
    sentenceLength: 'average',
    formality: 'neutral',
    verbalTics: [],
    favoriteExpressions: [],
    avoidedWords: [],
    whenHappy: 'Warmer.',
    whenAngry: 'Sharper.',
    whenNervous: 'Quieter.',
    whenLying: 'Too precise.',
    greetingExamples,
    farewellExamples: ['Goodbye.'],
    underStressExamples: ['Not now.'],
    writingGuidance: 'Brief and precise.',
  });

  const character = (id: string, greetingExamples: string[], tier = 'background') => ({
    id,
    name: id,
    pronouns: 'she/her',
    tier,
    want: 'To get through the moment without drawing attention.',
    fear: 'Being pulled into danger she does not understand.',
    flaw: 'She withholds context when frightened.',
    voiceProfile: voice(greetingExamples),
  });

  it('pads minor/background greeting examples before structural validation', () => {
    const bible: any = {
      characters: [character('char-ileana', ['Bună.'])],
      keyDynamics: [],
      gaps: [],
      doNotForget: [],
      voiceDistinctions: 'Each character has a distinct rhythm.',
    };
    const input: any = {
      charactersToCreate: [
        { id: 'char-ileana', name: 'Ileana', role: 'neutral', importance: 'minor', briefDescription: 'A brief phone contact.' },
      ],
    };

    designer.backfillLowWeightVoiceSamples(bible, input);
    expect(bible.characters[0].voiceProfile.greetingExamples).toHaveLength(2);
    expect(() => designer.validateCharacterBible(bible, input)).not.toThrow();
  });

  it('pads supporting neutral greeting examples before structural validation', () => {
    const bible: any = {
      characters: [character('char-sadie', ['Hi, Aunt Kylie.'], 'supporting')],
      keyDynamics: [],
      gaps: [],
      doNotForget: [],
      voiceDistinctions: 'Each character has a distinct rhythm.',
    };
    const input: any = {
      charactersToCreate: [
        { id: 'char-sadie', name: 'Sadie', role: 'neutral', importance: 'supporting', briefDescription: 'A niece who appears as family pressure.' },
      ],
    };

    designer.backfillLowWeightVoiceSamples(bible, input);
    expect(bible.characters[0].voiceProfile.greetingExamples).toHaveLength(2);
    expect(() => designer.validateCharacterBible(bible, input)).not.toThrow();
  });

  it('does not pad major character voice samples', () => {
    const bible: any = {
      characters: [character('char-kylie', ['Hi.'], 'core')],
      keyDynamics: [],
      gaps: [],
      doNotForget: [],
      voiceDistinctions: 'Each character has a distinct rhythm.',
    };
    const input: any = {
      charactersToCreate: [
        { id: 'char-kylie', name: 'Kylie', role: 'protagonist', importance: 'major', briefDescription: 'Lead.' },
      ],
    };

    designer.backfillLowWeightVoiceSamples(bible, input);
    expect(bible.characters[0].voiceProfile.greetingExamples).toHaveLength(1);
    expect(() => designer.validateCharacterBible(bible, input)).toThrow('needs more greeting examples');
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

describe('CharacterDesigner.backfillGapArchetypes (legacy gaps advisory)', () => {
  afterEach(() => BaseAgent.setLlmTransportOverride(null));
  const designer: any = new CharacterDesigner({ provider: 'anthropic', model: 'test', apiKey: 'test', maxTokens: 1000, temperature: 0 });
  const input = () => ({
    charactersToCreate: [
      { id: 'char-avery', name: 'Avery', role: 'protagonist', importance: 'major', briefDescription: 'lead' },
    ],
    storyContext: { title: 'T', genre: 'Drama', tone: 'Tense', themes: ['trust'], userPrompt: 'p' },
  });

  it('does not synthesize generic archetypes from model-authored gaps', async () => {
    let calls = 0;
    BaseAgent.setLlmTransportOverride(async () => { calls += 1; return '{}'; });
    const bible: any = {
      characters: [{ id: 'char-avery', name: 'Avery', role: 'protagonist' }],
      keyDynamics: [], gaps: ['The story is missing a clear antagonist.'], doNotForget: [],
    };

    await designer.backfillGapArchetypes(bible, input());

    expect(calls).toBe(0);
    expect(bible.characters.map((c: any) => c.id)).toEqual(['char-avery']);
    expect(bible.gaps).toEqual([]);
  });

  it('is a no-op when the gap archetype is already covered by the roster', async () => {
    let calls = 0;
    BaseAgent.setLlmTransportOverride(async () => { calls += 1; return '{}'; });
    const bible: any = {
      // An antagonist already exists under that role label.
      characters: [
        { id: 'char-avery', name: 'Avery', role: 'protagonist' },
        { id: 'char-rival', name: 'Rival', role: 'antagonist' },
      ],
      keyDynamics: [], gaps: ['Could use a stronger antagonist.'], doNotForget: [],
    };
    await designer.backfillGapArchetypes(bible, input());
    expect(calls).toBe(0);
    expect(bible.characters).toHaveLength(2);
    expect(bible.gaps).toEqual([]);
  });

  it('is a no-op (no LLM call) when gaps is empty', async () => {
    let calls = 0;
    BaseAgent.setLlmTransportOverride(async () => { calls += 1; return '{}'; });
    const bible: any = { characters: [{ id: 'char-avery', name: 'Avery', role: 'protagonist' }], keyDynamics: [], gaps: [], doNotForget: [] };
    await designer.backfillGapArchetypes(bible, input());
    expect(calls).toBe(0);
    expect(bible.characters).toHaveLength(1);
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

describe('CharacterDesigner provider truncation recovery', () => {
  afterEach(() => BaseAgent.setLlmTransportOverride(null));

  it('routes MAX_TOKENS failures to the compact character-bible contract', async () => {
    const designer = new CharacterDesigner({ provider: 'gemini', model: 'test', apiKey: 'test', maxTokens: 1000, temperature: 0 });
    const good = JSON.stringify({
      characters: [
        {
          id: 'char-a',
          name: 'A',
          pronouns: 'she/her',
          role: 'protagonist',
          importance: 'major',
          overview: 'A watchful lead trying to rebuild her public life.',
          want: 'She wants to claim a life that cannot be turned into gossip again.',
          fear: 'She fears desire will make her visible to people who enjoy hurting her.',
          flaw: 'She mistakes being chosen for being understood when pressure rises.',
          physicalDescription: 'A sharp-eyed woman with restless hands and carefully composed posture.',
          typicalAttire: 'Black travel layers with a practical coat and guarded elegance.',
          voiceProfile: {
            greetingExamples: ['You made it.', 'Tell me the worst part first.'],
            farewellExamples: ['Text me when you get home.'],
            underStressExamples: ['No, slow down. What did you actually see?'],
            signatureLines: ['I am taking notes.', 'That is not nothing.', 'Try again, but honest.'],
            verbalTics: ['No, wait.'],
            writingGuidance: 'Precise, guarded, funny when cornered.',
          },
          relationships: [{ targetId: 'char-b', targetName: 'B', relationshipType: 'friend', currentDynamic: 'Warm trust under pressure.' }],
          arcPotential: {
            currentState: 'Guarded observer.',
            possibleGrowth: 'She claims authorship of her life.',
            possibleFall: 'She lets attention replace intimacy.',
            triggerEvents: ['A rescue that feels too perfect.'],
          },
        },
      ],
      relationshipSummary: 'A small ensemble built around attention, trust, and withheld motives.',
      keyDynamics: [{ characters: ['char-a', 'char-b'], dynamic: 'Trust under pressure.', narrativePotential: 'Choices can deepen or crack the friendship.' }],
      ensembleBalance: 'The ensemble balances romantic danger, friend intimacy, and social ambition.',
      gaps: [],
      voiceDistinctions: 'A is precise and guarded; others should not share her note-taking cadence.',
      doNotForget: ['A watches before she acts.'],
    });

    let calls = 0;
    let retryPrompt = '';
    BaseAgent.setLlmTransportOverride(async (req) => {
      calls += 1;
      if (calls === 1) {
        throw new TruncatedLLMResponseError('Truncated LLM response from Gemini: finishReason=MAX_TOKENS', 'gemini', 'MAX_TOKENS');
      }
      retryPrompt = req.messages.map((m) => String(m.content)).join('\n');
      return good;
    });

    const result = await designer.execute({
      charactersToCreate: [{ id: 'char-a', name: 'A', role: 'protagonist', importance: 'major', briefDescription: 'A watchful lead.' }],
      storyContext: { title: 'T', genre: 'Drama', tone: 'Tense', themes: ['trust'] },
      worldContext: 'A city of secrets.',
    });

    expect(result.success).toBe(true);
    expect(calls).toBe(2);
    expect(retryPrompt).toContain('COMPACT RETRY');
    expect(retryPrompt).toContain('output token limit');
  });

  it('routes Gemini prohibited-content empty responses to a source-thinned safety retry', async () => {
    const designer = new CharacterDesigner({ provider: 'gemini', model: 'test', apiKey: 'test', maxTokens: 1000, temperature: 0 });
    const good = JSON.stringify({
      characters: [
        {
          id: 'char-a',
          name: 'A',
          pronouns: 'she/her',
          role: 'protagonist',
          importance: 'major',
          tier: 'core',
          overview: 'A guarded lead trying to reclaim her story.',
          want: 'She wants authorship over the attention around her.',
          fear: 'She fears intimacy will become public leverage.',
          flaw: 'She turns uncertainty into performance too quickly.',
          physicalDescription: 'A sharp-eyed woman with composed posture.',
          distinctiveFeatures: ['watchful eyes', 'careful stillness'],
          typicalAttire: 'Practical black travel layers.',
          voiceProfile: {
            vocabularyLevel: 'sophisticated',
            speechPattern: 'Precise and dry.',
            verbalTics: ['No, wait.'],
            emotionalTendency: 'Jokes when cornered.',
            greetingExamples: ['You made it.', 'Tell me the worst part first.'],
            farewellExamples: ['Text me when you get home.'],
            underStressExamples: ['Slow down. What did you actually see?'],
            signatureLines: ['I am taking notes.', 'That is not nothing.', 'Try again, but honest.'],
          },
          relationships: [],
          arcPotential: { growth: 'She claims authorship.', fall: 'She mistakes attention for intimacy.' },
          secrets: ['She edits fear into charm.'],
        },
      ],
      relationshipSummary: 'A compact ensemble built around attention and trust.',
      keyDynamics: [],
      ensembleBalance: 'The roster balances romantic pressure and friend intimacy.',
      gaps: [],
      voiceDistinctions: 'A is precise and guarded.',
      doNotForget: ['A watches before she acts.'],
    });

    let calls = 0;
    let retryPrompt = '';
    BaseAgent.setLlmTransportOverride(async (req) => {
      calls += 1;
      if (calls === 1) {
        throw new Error('Failed to parse Gemini response as JSON: Gemini returned empty content (finishReason=unknown, blockReason=PROHIBITED_CONTENT).');
      }
      if (calls === 2) {
        retryPrompt = req.messages.map((m) => String(m.content)).join('\n');
      }
      return good;
    });

    const result = await designer.execute({
      charactersToCreate: [{
        id: 'char-a',
        name: 'A',
        role: 'protagonist',
        importance: 'major',
        briefDescription: 'A vampire-adjacent lead whose story includes a bite and blood danger.',
      }],
      storyContext: { title: 'Bite Me', genre: 'Supernatural romance', tone: 'Tense', themes: ['desire', 'danger'] },
      worldContext: 'Raw source text with vampire bite blood details should not be included in the retry.',
      rawDocument: 'This source text should not appear in the safety retry.',
    });

    expect(result.success).toBe(true);
    expect(calls).toBeGreaterThanOrEqual(2);
    expect(retryPrompt).toContain('SAFETY RETRY');
    expect(retryPrompt).not.toContain('This source text should not appear');
    expect(retryPrompt).toContain('supernatural-adjacent lead');
    expect(retryPrompt).not.toMatch(/\bvampire\b/i);
    expect(retryPrompt).not.toMatch(/\bblood\b/i);
  });
});
