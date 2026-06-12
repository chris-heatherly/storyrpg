import { describe, expect, it } from 'vitest';

import { buildSourceMaterialFidelitySection, SceneWriter } from './SceneWriter';
import type { SourceMaterialAnalysis } from '../../types/sourceAnalysis';

function createWriter(): SceneWriter {
  return new SceneWriter({
    provider: 'anthropic',
    model: 'test-model',
    apiKey: 'test-key',
    maxTokens: 1024,
    temperature: 0,
  });
}

describe('SceneWriter structural guards', () => {
  const preEncounterInput = {
    sceneBlueprint: {
      id: 'scene-3b',
      name: 'Underground Club Scene',
      description: 'Carmen takes Lena to the deeper supernatural nightlife scene.',
      location: 'loc-underground-club',
      mood: 'intoxicating',
      purpose: 'branch',
      narrativeFunction: 'Introduces Mika and the more dangerous edge of Bucharest nightlife.',
      dramaticQuestion: 'Who in this room knows Lena before she knows them?',
      wantVsNeed: 'Belong in the city vs understand its danger',
      conflictEngine: 'Mika knows more about Lena than Lena knows about Mika.',
      npcsPresent: ['char-mika'],
      keyBeats: [
        'Mika approaches with knowing eyes',
        'Mika offers cryptic advice about being careful who you trust',
      ],
      leadsTo: ['scene-4'],
    },
    storyContext: {
      title: 'Bite Me',
      genre: 'paranormal romance',
      tone: 'sumptuous and dangerous',
      worldContext: 'Modern Bucharest nightlife.',
    },
    protagonistInfo: {
      name: 'Lena',
      pronouns: 'she/her',
      description: 'An American food writer starting over.',
    },
    npcs: [],
    targetBeatCount: 5,
    dialogueHeavy: true,
    nextSceneContext: {
      id: 'scene-4',
      name: 'The Attack in Cismigiu Park',
      location: 'loc-cismigiu-park',
      description: 'Walking home alone through the foggy park, Lena is stalked and attacked.',
      isEncounter: true,
      encounterType: 'combat',
      encounterDescription: 'Lena must survive a supernatural predator in the foggy park.',
      encounterBeatPlan: ['Fog rolls in as Lena takes a shortcut through the dark park'],
    },
  } as any;

  it('rejects a pre-encounter scene that ends without a handoff beat', async () => {
    class BadHandoffSceneWriter extends SceneWriter {
      protected async callLLM(): Promise<string> {
        return JSON.stringify({
          sceneId: 'scene-3b',
          sceneName: 'Underground Club Scene',
          description: 'Mika introduces herself.',
          startingBeatId: 'beat-1',
          beats: [
            {
              id: 'beat-1',
              text: 'A platinum-haired woman smiles through the crimson light.',
              nextBeatId: 'beat-2',
              visualMoment: 'Mika approaches Lena.',
              primaryAction: 'approaches',
              emotionalRead: 'calculated warmth',
              relationshipDynamic: 'Mika holds the information advantage',
              mustShowDetail: 'bracelets catching the light',
            },
            {
              id: 'beat-2',
              text: '"You have your grandmother\'s eyes," she says, extending a manicured hand. "I am Mika."',
              visualMoment: 'Mika extends her hand.',
              primaryAction: 'offers a greeting',
              emotionalRead: 'Lena is startled',
              relationshipDynamic: 'Mika controls the exchange',
              mustShowDetail: 'the extended hand',
            },
          ],
          moodProgression: ['intoxicating'],
          charactersInvolved: ['char-mika'],
          keyMoments: ['Mika reveals she knows Lena'],
          continuityNotes: [],
        });
      }
    }

    const writer = new BadHandoffSceneWriter({
      provider: 'anthropic',
      model: 'test-model',
      apiKey: 'test-key',
      maxTokens: 1024,
      temperature: 0,
    });

    const result = await writer.execute(preEncounterInput);

    expect(result.success).toBe(false);
    expect(result.error).toContain('Pre-encounter handoff missing');
  });

  it('accepts a pre-encounter scene whose final beat bridges into the encounter', async () => {
    class GoodHandoffSceneWriter extends SceneWriter {
      protected async callLLM(): Promise<string> {
        return JSON.stringify({
          sceneId: 'scene-3b',
          sceneName: 'Underground Club Scene',
          description: 'Mika introduces herself.',
          startingBeatId: 'beat-1',
          beats: [
            {
              id: 'beat-1',
              text: 'A platinum-haired woman smiles through the crimson light.',
              nextBeatId: 'beat-2',
              visualMoment: 'Mika approaches Lena.',
              primaryAction: 'approaches',
              emotionalRead: 'calculated warmth',
              relationshipDynamic: 'Mika holds the information advantage',
              mustShowDetail: 'bracelets catching the light',
            },
            {
              id: 'beat-2',
              text: '"Be careful who you trust," Mika warns as Carmen leads you back outside into the Bucharest night.',
              visualMoment: 'Mika warns Lena near the club exit.',
              primaryAction: 'warns Lena',
              emotionalRead: 'Lena is unsettled',
              relationshipDynamic: 'Mika releases Lena with a warning',
              mustShowDetail: 'the club door opening to the night street',
            },
          ],
          moodProgression: ['intoxicating', 'uneasy'],
          charactersInvolved: ['char-mika'],
          keyMoments: ['Mika warns Lena'],
          continuityNotes: [],
        });
      }
    }

    const writer = new GoodHandoffSceneWriter({
      provider: 'anthropic',
      model: 'test-model',
      apiKey: 'test-key',
      maxTokens: 1024,
      temperature: 0,
    });

    const result = await writer.execute(preEncounterInput);

    expect(result.success).toBe(true);
    expect(result.data?.beats.at(-1)?.text).toContain('warns');
  });

  it('repairs malformed JSON once before failing the scene', async () => {
    class RepairableSceneWriter extends SceneWriter {
      calls = 0;

      protected async callLLM(): Promise<string> {
        this.calls += 1;
        if (this.calls === 1) {
          return '```json\n{"sceneId":"scene-2a","sceneName":"Bold Entrance","beats":[{"id":"beat-1","text":"You step into the club';
        }
        return JSON.stringify({
          sceneId: 'scene-2a',
          sceneName: 'Bold Entrance',
          description: 'Lena enters the club and draws attention.',
          startingBeatId: 'beat-1',
          beats: [
            {
              id: 'beat-1',
              text: 'You step into Vâlcescu Club before the velvet rope has stopped swaying, and every nearby conversation tilts toward you.',
              shotType: 'character',
              visualMoment: 'Lena enters the club with the rope still moving behind her.',
              primaryAction: 'steps confidently into the club',
              emotionalRead: 'confident but watchful',
              relationshipDynamic: 'attention shifts toward Lena',
              mustShowDetail: 'the moving velvet rope behind Lena',
            },
          ],
          moodProgression: ['electric'],
          charactersInvolved: ['lena'],
          keyMoments: ['Lena enters with confidence'],
          continuityNotes: [],
        });
      }
    }

    const writer = new RepairableSceneWriter({
      provider: 'anthropic',
      model: 'test-model',
      apiKey: 'test-key',
      maxTokens: 1024,
      temperature: 0,
    });

    const result = await writer.execute({
      sceneBlueprint: {
        id: 'scene-2a',
        name: 'Bold Entrance',
        description: 'Lena enters Vâlcescu Club with confidence.',
        location: 'club',
        mood: 'electric',
        purpose: 'branch',
        narrativeFunction: 'Shows Lena choosing boldness.',
        dramaticQuestion: 'Will boldness draw the right attention?',
        wantVsNeed: 'Be seen vs stay safe',
        conflictEngine: 'The club notices her before she knows who is watching.',
        npcsPresent: [],
        keyBeats: ['Lena enters boldly'],
        leadsTo: [],
      },
      storyContext: {
        title: 'Bite Me',
        genre: 'romance',
        tone: 'darkly playful',
        worldContext: 'Modern Bucharest nightlife.',
      },
      protagonistInfo: {
        name: 'Lena',
        pronouns: 'she/her',
        description: 'An American starting over.',
      },
      npcs: [],
      targetBeatCount: 3,
      dialogueHeavy: false,
    } as any, 1);

    expect(result.success).toBe(true);
    expect(result.data?.sceneId).toBe('scene-2a');
    expect(result.data?.beats?.[0]?.text).toContain('You step into');
    expect(writer.calls).toBe(2);
  });

  it('includes adapted scene-craft guidance and StoryRPG-shaped few-shot example', () => {
    const writer = new SceneWriter({
      provider: 'anthropic',
      model: 'test-model',
      apiKey: 'test-key',
      maxTokens: 1024,
      temperature: 0,
    });

    const prompt = (writer as any).getAgentSpecificPrompt();
    expect(prompt).toContain('scene takeaways');
    expect(prompt).toContain('Do not use film/camera direction terms in player-facing prose');
    expect(prompt).not.toMatch(/restrained\s+interiority/);
    expect(prompt).not.toContain('internal monologue');
    expect(prompt).toContain('Example: StoryRPG SceneWriter Beat Scale');
    expect(prompt).toContain('Prefer turns over topics');
    expect(prompt).toContain('leverage, trust, evidence');
    expect(prompt).toContain('Vivid means vivid story intent');
    expect(prompt).toContain('The scene keyMoment should be the beat where those takeaways become felt, proven, revealed, or changed');
    expect(prompt).toContain('Do not contradict season anchors, source-material fidelity, established character state, player choices, flags, callbacks, or encounter setup context');
    expect(prompt).toContain('Do not add art-direction language that fights the active ArtStyleProfile, negative prompt, provider settings, or style-bible anchors');
    expect(prompt).toContain('Visual metadata should describe what must be understood, not impose a conflicting style');
    expect(prompt).toContain('Do not directly describe characters\' thoughts and feelings');
    expect(prompt).toContain('externalize inner life');
    expect(prompt).toContain('## Fight, Weapon, And Physical Action Scenes');
    expect(prompt).toContain('specific strikes, maneuvers');
    expect(prompt).toContain('destructive effects');
    expect(prompt).toContain('wounds, or damage');
    expect(prompt).toContain('## Conflict Damage');
    expect(prompt).toContain('## Prose And Dialogue Craft');
    expect(prompt).toContain('Use sensory detail selectively and purposefully');
    expect(prompt).toContain('Do not force all five senses into every beat');
    expect(prompt).toContain('Respect the active source style, genre, tone, user instructions, and style guide');
    expect(prompt).toContain('Use precise, concrete, genre-appropriate language');
    expect(prompt).toContain('not ornate prose or conflicting art direction');
    expect(prompt).toContain('Make description dynamic');
    expect(prompt).toContain('spare, natural, character-specific, pressure-aware, and subtextual');
    expect(prompt).toContain('Vary sentence rhythm with scene pressure');
    expect(prompt).toContain('Avoid repetition');
  });

  it('includes scene-specific target guidance for takeaways, clarity, and style-safe visual metadata', () => {
    const writer = createWriter();
    const prompt = (writer as any).buildPrompt(preEncounterInput);

    expect(prompt).toContain('The scene keyMoment should be the beat where sceneTakeaways become felt, proven, revealed, or changed');
    expect(prompt).toContain('Each non-rest beat should show a concrete shift in action, intent, leverage, mood, relationship dynamic, tactical position, information, or consequence');
    expect(prompt).toContain('fill them naturally with local detail');
    expect(prompt).toContain('Vivid means vivid story intent');
    expect(prompt).toContain('unless they come from the active style contract');
    expect(prompt).toContain('The final beat of each scene should land a pointed resolution or consequence');
    expect(prompt).toContain('Never write a static meeting where characters only discuss information');
    expect(prompt).toContain('In action scenes, the hero or allies should be wounded, damaged, depleted, exposed, or narrowly escape a specific harm');
    expect(prompt).toContain('Every meaningful conflict should damage someone or something');
    expect(prompt).toContain('Use selective sensory detail to establish place, mood, danger, intimacy, texture, or consequence');
    expect(prompt).toContain('Respect active source style, genre, tone, user instructions, and style guide');
    expect(prompt).toContain('Make description carry pressure, movement, mood, threat, desire, or consequence');
    expect(prompt).toContain('Reveal inner life through action, speech, silence, bodily response, facial expression, object handling, proximity, risk, and choice behavior');
    expect(prompt).toContain('Avoid repeated plot events, dialogue, scene shapes, and descriptive phrasing unless intentional callback/payoff');
  });

  it('expands underspecified choice scenes into a stable three-beat structure', () => {
    const writer = new SceneWriter({
      provider: 'anthropic',
      model: 'test-model',
      apiKey: 'test-key',
      maxTokens: 1024,
      temperature: 0,
    });

    const normalized = (writer as any).normalizeContent(
      {
        sceneId: 'scene-2',
        sceneName: 'The Law of the Ember',
        beats: [
          {
            id: 'collapsed-beat',
            text: 'The traveler reaches toward the heater vents while Cassandra watches for any sign of defiance.',
            isChoicePoint: true,
          },
        ],
        startingBeatId: 'collapsed-beat',
        moodProgression: ['tense'],
        charactersInvolved: ['char-cassandra-goldmere'],
        keyMoments: ['The traveler reaches for warmth'],
        continuityNotes: [],
      },
      {
        sceneBlueprint: {
          id: 'scene-2',
          name: 'The Law of the Ember',
          description: 'While the caravan clears customs, a freezing traveler reaches for the wagon heat.',
          location: 'ice-gates',
          mood: 'tense',
          purpose: 'branch',
          narrativeFunction: 'Introduces the moral law of Frosthold.',
          dramaticQuestion: 'Will Lyralei uphold the city law or her mother?',
          wantVsNeed: 'Keep social safety vs honor the law',
          conflictEngine: 'Cassandra demands compliance while a desperate stranger pleads for warmth.',
          npcsPresent: ['char-cassandra-goldmere'],
          keyBeats: [
            'A freezing traveler reaches for the heat',
            'Cassandra orders the guards to push them back',
          ],
          leadsTo: ['scene-3'],
          choicePoint: {
            type: 'dilemma',
            description: 'Do you intervene?',
            stakes: {
              want: 'Honor the sacred law',
              cost: 'Defy Cassandra in public',
              identity: 'Merchant obedience versus human decency',
            },
            optionHints: ['Help the traveler', 'Look away'],
          },
        },
        storyContext: {
          title: 'Test Story',
          genre: 'fantasy',
          tone: 'dramatic',
          worldContext: 'A frozen mountain city.',
        },
        protagonistInfo: {
          name: 'Lyralei',
          pronouns: 'she/her',
          description: 'A merchant daughter under pressure.',
        },
        npcs: [],
        targetBeatCount: 5,
        dialogueHeavy: true,
      }
    );

    expect(normalized.beats).toHaveLength(3);
    expect(normalized.startingBeatId).toBe('beat-1');
    expect(normalized.beats.map((beat: any) => beat.id)).toEqual(['beat-1', 'beat-2', 'beat-3']);
    expect(normalized.beats[2].isChoicePoint).toBe(true);
    expect(normalized.beats[0].nextBeatId).toBe('beat-2');
    expect(normalized.beats[1].nextBeatId).toBe('beat-3');
    expect(normalized.beats[2].nextBeatId).toBeUndefined();
  });

  it('canonicalizes a bare textVariant callbackHookId to its planted flag: hook id', () => {
    const writer = createWriter();

    const normalized = (writer as any).normalizeContent(
      {
        sceneId: 'scene-7',
        sceneName: 'The Reckoning',
        beats: [
          {
            id: 'beat-1',
            text: 'The corridor still smells of smoke.',
            textVariants: [
              {
                // The bug (bite-me-g14): agent copies the condition flag NAME into
                // callbackHookId instead of the planted `flag:`-prefixed hook id.
                condition: { type: 'flag', flag: 'treatment_seed_ep1_3', value: true },
                text: 'The key card you palmed back then still opens the door.',
                callbackHookId: 'treatment_seed_ep1_3',
              },
              {
                // An already-canonical id must pass through untouched.
                condition: { type: 'flag', flag: 'protected_brightwell', value: true },
                text: 'Brightwell meets your eye, remembering.',
                callbackHookId: 'flag:protected_brightwell',
              },
            ],
          },
        ],
        startingBeatId: 'beat-1',
        moodProgression: [],
        charactersInvolved: [],
        keyMoments: [],
        continuityNotes: [],
      },
      {
        sceneBlueprint: { id: 'scene-7', name: 'The Reckoning' },
        unresolvedCallbacks: [
          { id: 'flag:treatment_seed_ep1_3', sourceEpisode: 1, summary: 'You palmed the key card.', flags: ['treatment_seed_ep1_3'] },
          { id: 'flag:protected_brightwell', sourceEpisode: 1, summary: 'You shielded Brightwell.', flags: ['protected_brightwell'] },
        ],
      }
    );

    const variants = normalized.beats[0].textVariants;
    expect(variants[0].callbackHookId).toBe('flag:treatment_seed_ep1_3');
    expect(variants[1].callbackHookId).toBe('flag:protected_brightwell');
  });

  it('drops a structural-flag callbackHookId (branch-axis mislabel) but keeps condition.flag', () => {
    const writer = createWriter();

    const normalized = (writer as any).normalizeContent(
      {
        sceneId: 'scene-1',
        sceneName: 'The Sachet',
        beats: [
          {
            id: 'beat-1',
            text: 'Stela slides the sachet into your palm.',
            textVariants: [
              {
                // The bug (bite-me-g14 2026-06-11): branch-reconvergence residue gated
                // on a real seed flag was ALSO tagged with a callbackHookId pointing at
                // a `treatment_branch_` axis flag — which the ledger never plants, so the
                // dangling-payoff gate aborted the Season Canon seal.
                condition: { type: 'flag', flag: 'treatment_seed_ep1_1', value: true },
                text: "Stela's fingers brush the quartz at your hip when she slides the sachet into your palm.",
                callbackHookId: 'treatment_branch_mika_s_crossroad_read_gently_vs_read_cruelly',
              },
            ],
          },
        ],
        startingBeatId: 'beat-1',
        moodProgression: [],
        charactersInvolved: [],
        keyMoments: [],
        continuityNotes: [],
      },
      { sceneBlueprint: { id: 'scene-1', name: 'The Sachet' } }
    );

    const variant = normalized.beats[0].textVariants[0];
    expect(variant.callbackHookId).toBeUndefined();
    // The legitimate branch-residue gating is preserved.
    expect(variant.condition.flag).toBe('treatment_seed_ep1_1');
  });

  it('normalizes optional sceneTakeaways and transitionIn metadata', () => {
    const writer = new SceneWriter({
      provider: 'anthropic',
      model: 'test-model',
      apiKey: 'test-key',
      maxTokens: 1024,
      temperature: 0,
    });

    const normalized = (writer as any).normalizeContent({
      sceneId: 'scene-1',
      sceneName: 'A Clean Exit',
      beats: [],
      startingBeatId: '',
      moodProgression: [],
      charactersInvolved: [],
      keyMoments: [],
      continuityNotes: [],
      sceneTakeaways: 'Mara learns the safe route was sold.',
      transitionIn: 42,
    });

    expect(normalized.sceneTakeaways).toEqual(['Mara learns the safe route was sold.']);
    expect(normalized.transitionIn).toBe('42');
  });

  it('strips agent-facing pressure notes from player-facing beat text and prompts', () => {
    const writer = new SceneWriter({
      provider: 'anthropic',
      model: 'test-model',
      apiKey: 'test-key',
      maxTokens: 1024,
      temperature: 0,
    });
    const input = {
      sceneBlueprint: {
        id: 'scene-1',
        name: 'Ambush at the Gate',
        description: 'The escort is hit from both sides.',
        location: 'road',
        mood: 'urgent',
        purpose: 'branch',
        narrativeFunction: 'Force Aethavyr to choose who receives protection first.',
        dramaticQuestion: 'Who does Aethavyr protect first?',
        wantVsNeed: 'Duty versus earned loyalty',
        conflictEngine: 'Arrows split the formation.',
        npcsPresent: ['brightwell', 'lysandra'],
        keyBeats: [
          'Pressure: Lord Brightwell stumbles under the first volley.',
          'Choice pressure: - When the ambush hits, does Aethavyr protect Lord Brightwell or Lysandra? WANT: do your duty. COST: leave one exposed. IDENTITY: who counts first?',
          'Forward pressure: The exposed person remembers who Aethavyr chose.',
        ],
        leadsTo: [],
      },
      storyContext: {
        title: 'Test Story',
        genre: 'fantasy',
        tone: 'urgent',
        worldContext: 'A roadside ambush.',
      },
      protagonistInfo: {
        name: 'Aethavyr',
        pronouns: 'they/them',
        description: 'A sworn protector.',
      },
      npcs: [],
      targetBeatCount: 4,
      dialogueHeavy: false,
    } as any;

    const prompt = (writer as any).buildPrompt(input);
    expect(prompt).toContain('- Lord Brightwell stumbles under the first volley.');
    expect(prompt).not.toContain('Choice pressure:');
    expect(prompt).not.toContain('Forward pressure:');

    const normalized = (writer as any).normalizeContent({
      sceneId: 'scene-1',
      sceneName: 'Ambush at the Gate',
      beats: [{
        id: 'beat-1',
        text: 'Aethavyr hears the first arrow hit the carriage.\n\nChoice pressure: - When the ambush hits, does Aethavyr protect Lord Brightwell or Lysandra? WANT: do your duty.',
      }],
      startingBeatId: 'beat-1',
      moodProgression: [],
      charactersInvolved: [],
      keyMoments: [],
      continuityNotes: [],
    }, input);

    expect(normalized.beats[0].text).not.toContain('Choice pressure:');
    expect(normalized.beats[0].text).toContain('Aethavyr hears the first arrow hit the carriage.');
  });

  it('injects the required-beats checklist into the prompt when the blueprint carries requiredBeats (treatment-sourced)', () => {
    const writer = new SceneWriter({
      provider: 'anthropic',
      model: 'test-model',
      apiKey: 'test-key',
      maxTokens: 1024,
      temperature: 0,
    });
    const input = {
      sceneBlueprint: {
        id: 'scene-2-3',
        name: 'The Battlement Leap',
        description: 'Darian storms the wall; Aethavyr is tested.',
        location: 'fort wall',
        mood: 'tense',
        purpose: 'bottleneck',
        narrativeFunction: 'Dramatize the authored Ep2 naming/leap turn.',
        dramaticQuestion: 'Does Aethavyr act?',
        wantVsNeed: 'Instinct versus self-doubt',
        conflictEngine: 'Darian breaches the battlement.',
        npcsPresent: [],
        keyBeats: ['The wall is breached.'],
        leadsTo: [],
        signatureMoment: 'Lysandra names him Aethavyr after the leap.',
        requiredBeats: [
          { id: 's2-3-rb1', sourceTurn: 'turn A', mustDepict: 'Darian assaults the battlement.', tier: 'authored' },
          { id: 's2-3-rb2', sourceTurn: 'turn B', mustDepict: 'Aethavyr makes an instinctive rescue leap.', tier: 'authored' },
        ],
      },
      storyContext: { title: 'Endsong', genre: 'fantasy', tone: 'epic', worldContext: 'A besieged fort.' },
      protagonistInfo: { name: 'Aethavyr', pronouns: 'they/them', description: 'A nascent dragon.' },
      npcs: [],
      targetBeatCount: 4,
      dialogueHeavy: false,
    } as any;

    const prompt = (writer as any).buildPrompt(input);
    expect(prompt).toContain('REQUIRED BEATS — depict each, in order');
    expect(prompt).toContain('1. [authored] Darian assaults the battlement.');
    expect(prompt).toContain('2. [authored] Aethavyr makes an instinctive rescue leap.');
    expect(prompt).toContain('Signature moment (MUST be depicted, never inverted):');
    expect(prompt).toContain('Lysandra names him Aethavyr after the leap.');
    // Ordering preserved in the rendered prompt.
    expect(prompt.indexOf('Darian assaults')).toBeLessThan(prompt.indexOf('instinctive rescue leap'));
  });

  it('leaves the prompt unchanged (no required-beats checklist) for from-scratch scenes', () => {
    const writer = new SceneWriter({
      provider: 'anthropic',
      model: 'test-model',
      apiKey: 'test-key',
      maxTokens: 1024,
      temperature: 0,
    });
    const input = {
      sceneBlueprint: {
        id: 'scene-1',
        name: 'A Quiet Morning',
        description: 'Nothing authored here.',
        location: 'village',
        mood: 'calm',
        purpose: 'transition',
        narrativeFunction: 'Establish the village.',
        dramaticQuestion: 'What is normal?',
        wantVsNeed: 'Comfort versus restlessness',
        conflictEngine: 'Routine.',
        npcsPresent: [],
        keyBeats: ['The day begins.'],
        leadsTo: [],
      },
      storyContext: { title: 'Test', genre: 'fantasy', tone: 'calm', worldContext: 'A village.' },
      protagonistInfo: { name: 'Ren', pronouns: 'they/them', description: 'A farmhand.' },
      npcs: [],
      targetBeatCount: 4,
      dialogueHeavy: false,
    } as any;

    const prompt = (writer as any).buildPrompt(input);
    expect(prompt).not.toContain('REQUIRED BEATS');
    expect(prompt).not.toContain('Signature moment (MUST be depicted');
  });

  it('flags unresolved schema variables in player-facing beat text', () => {
    const writer = new SceneWriter({
      provider: 'anthropic',
      model: 'test-model',
      apiKey: 'test-key',
      maxTokens: 1024,
      temperature: 0,
    });

    const issues = (writer as any).collectIssues(
      {
        sceneId: 'scene-1',
        sceneName: 'Placeholder Leak',
        beats: [{ id: 'beat-1', text: '{Protagonist} reaches the tower.' }],
        startingBeatId: 'beat-1',
        moodProgression: [],
        charactersInvolved: [],
        keyMoments: [],
        continuityNotes: [],
      },
      {
        sceneBlueprint: {
          id: 'scene-1',
          name: 'Placeholder Leak',
          description: 'A bad placeholder leaks into prose.',
          location: 'tower',
          mood: 'tense',
          purpose: 'bottleneck',
          narrativeFunction: 'Test.',
          dramaticQuestion: 'Will it leak?',
          wantVsNeed: 'Fix vs fail',
          conflictEngine: 'The prompt.',
          npcsPresent: [],
          keyBeats: [],
          leadsTo: [],
        },
        targetBeatCount: 1,
      },
    );

    expect(issues.join('\n')).toContain('SCHEMA PLACEHOLDER LEAK');
  });

  it('adds POV clarity feedback when the opening beat does not anchor the player character', () => {
    const writer = new SceneWriter({
      provider: 'anthropic',
      model: 'test-model',
      apiKey: 'test-key',
      maxTokens: 1024,
      temperature: 0,
    });

    const issues = (writer as any).collectIssues(
      {
        sceneId: 'scene-1',
        sceneName: 'Unanchored Opening',
        beats: [{ id: 'beat-1', text: 'Mara waits beside the black gate while fog closes over the road.' }],
        startingBeatId: 'beat-1',
        moodProgression: [],
        charactersInvolved: ['mara'],
        keyMoments: [],
        continuityNotes: [],
      },
      {
        sceneBlueprint: {
          id: 'scene-1',
          name: 'Unanchored Opening',
          description: 'The player arrives at the gate.',
          location: 'gate',
          mood: 'tense',
          purpose: 'bottleneck',
          narrativeFunction: 'Test.',
          dramaticQuestion: 'Who is here?',
          wantVsNeed: 'Clarity vs drift',
          conflictEngine: 'A foggy opening.',
          npcsPresent: ['mara'],
          keyBeats: [],
          leadsTo: [],
        },
        protagonistInfo: {
          name: 'Alex',
          pronouns: 'they/them',
          description: 'The player character.',
        },
        npcs: [{
          id: 'mara',
          name: 'Mara',
          pronouns: 'she/her',
          description: 'A wary ally.',
          voiceNotes: '',
        }],
        targetBeatCount: 1,
      },
    );

    expect(issues.join('\n')).toContain('POV CLARITY');
  });

  it('adds fiction-first turn audit feedback for repeated topic beats', () => {
    const writer = createWriter();
    const issues = (writer as any).collectIssues(
      {
        sceneId: 'scene-1',
        sceneName: 'Topic Chain',
        beats: [
          {
            id: 'beat-1',
            text: 'Mara explains the old rule while Alex listens.',
            shotType: 'character',
            primaryAction: 'Mara explains the old rule',
          },
          {
            id: 'beat-2',
            text: 'Alex observes the room and thinks about what it means.',
            shotType: 'character',
            primaryAction: 'Alex observes the room',
          },
        ],
        startingBeatId: 'beat-1',
        moodProgression: [],
        charactersInvolved: [],
        keyMoments: [],
        continuityNotes: [],
      },
      {
        sceneBlueprint: {
          id: 'scene-1',
          name: 'Topic Chain',
          description: 'Two people discuss a charm.',
          location: 'cafe',
          mood: 'tense',
          purpose: 'bottleneck',
          narrativeFunction: 'Test.',
          dramaticQuestion: 'Will it turn?',
          wantVsNeed: 'Know vs admit',
          conflictEngine: 'Evasion.',
          npcsPresent: [],
          keyBeats: [],
          leadsTo: [],
        },
        targetBeatCount: 2,
      },
    );

    expect(issues.join('\n')).toContain('FICTION-FIRST TURN TOPIC_RUN');
  });
});

describe('SceneWriter dramatic intent visual contracts', () => {
  it.each([
    [
      'dialogue',
      {
        id: 'beat-dialogue',
        text: 'Mrs. Constantinou reports what she witnessed, clutching her shopping bag as Daphne listens.',
        primaryAction: 'Mrs. Constantinou reports what she witnessed',
      },
    ],
    [
      'investigation',
      {
        id: 'beat-investigation',
        text: 'Daphne studies the phone photo, noticing the flowers blooming from the asphalt behind Alex.',
        primaryAction: 'Daphne notices the evidence',
      },
    ],
    [
      'romance',
      {
        id: 'beat-romance',
        text: 'Alex deflects with practiced charm, brushing Daphne\'s knuckles while avoiding the question.',
        primaryAction: 'Alex deflects with practiced charm',
      },
    ],
    [
      'action',
      {
        id: 'beat-action',
        text: 'Daphne reaches across the counter and pulls the cracked charm into the light.',
      },
    ],
    [
      'quiet interiority',
      {
        id: 'beat-quiet',
        text: 'Yiayia Eleni observes the situation, her hands stilling in the flour as the room goes quiet.',
        primaryAction: 'Yiayia Eleni observes the situation',
        intensityTier: 'rest' as const,
      },
    ],
    [
      'comedy',
      {
        id: 'beat-comedy',
        text: 'Alex smiles too brightly and checks his phone upside down, trying to pretend nothing strange happened.',
        primaryAction: 'Alex smiles',
      },
    ],
  ])('strengthens %s beats with visible dramatic intent', (_kind, beat) => {
    const writer = createWriter();
    const normalized = (writer as any).normalizeContent({
      sceneId: 'scene-1',
      sceneName: 'Dramatic Intent',
      beats: [{ shotType: 'character', ...beat }],
      startingBeatId: beat.id,
      moodProgression: [],
      charactersInvolved: [],
      keyMoments: [],
      continuityNotes: [],
    });

    const strengthened = normalized.beats[0];
    expect(strengthened.dramaticIntent?.visibleTurn).toBeTruthy();
    expect(strengthened.dramaticIntent?.visualSubtextCue).toBeTruthy();
    expect(strengthened.dramaticIntent?.obstacle).toBeTruthy();
    expect(strengthened.sequenceIntent?.objective).toBeTruthy();
    expect(strengthened.sequenceIntent?.visualThread).toBeTruthy();
    expect(strengthened.sequenceIntent?.beatRole).toBeTruthy();
    expect(strengthened.coveragePlan?.shotDistance).toBeTruthy();
    expect(strengthened.coveragePlan?.cameraAngle).toBeTruthy();
    expect(strengthened.coveragePlan?.coverageReason).toContain(strengthened.sequenceIntent?.beatRole);
    expect(strengthened.primaryAction).not.toMatch(/reports what she witnessed|observes the situation|deflects with practiced charm|^Alex smiles$/i);
    expect(strengthened.primaryAction).not.toContain('takes a decisive physical action');
    expect(strengthened.visualMoment).toContain(strengthened.dramaticIntent.visibleTurn.split(' ')[0]);
  });

  it('does not replace already concrete physical actions', () => {
    const writer = createWriter();
    const beat = {
      id: 'beat-concrete',
      text: 'Daphne reaches across the counter and pulls the cracked charm into the light.',
      shotType: 'action' as const,
      primaryAction: 'Daphne reaches across the counter',
    };

    const normalized = (writer as any).normalizeContent({
      sceneId: 'scene-1',
      sceneName: 'Concrete Action',
      beats: [beat],
      startingBeatId: beat.id,
      moodProgression: [],
      charactersInvolved: [],
      keyMoments: [],
      continuityNotes: [],
    });

    expect(normalized.beats[0].primaryAction).toBe('Daphne reaches across the counter');
    expect(normalized.beats[0].dramaticIntent?.visibleTurn).toBeTruthy();
    expect(normalized.sequenceIntent?.objective).toBeTruthy();
    expect(normalized.beats[0].sequenceIntent?.turningPoint).toBeTruthy();
  });

  it('derives a quiet rest sequence as recalibration instead of random stillness', () => {
    const writer = createWriter();
    const normalized = (writer as any).normalizeContent({
      sceneId: 'scene-rest',
      sceneName: 'Aftermath',
      beats: [
        {
          id: 'beat-rest',
          text: 'Mara sits alone after the argument, turning the ring in her fingers until her breathing steadies.',
          shotType: 'character' as const,
          intensityTier: 'rest' as const,
        },
      ],
      startingBeatId: 'beat-rest',
      moodProgression: [],
      charactersInvolved: ['Mara'],
      keyMoments: [],
      continuityNotes: [],
    });

    expect(normalized.sequenceIntent?.activity).toMatch(/quiet recovery|visible exchange|recovery/i);
    expect(normalized.beats[0].sequenceIntent?.beatRole).toBe('aftermath');
    expect(normalized.beats[0].sequenceIntent?.visualThread).toBeTruthy();
    expect(normalized.beats[0].coveragePlan?.stagingPattern).toBeTruthy();
  });
});

describe('buildSourceMaterialFidelitySection', () => {
  it('includes the new writing style guide in scene-writing context', () => {
    const section = buildSourceMaterialFidelitySection({
      writingStyleGuide: {
        source: 'explicit_prompt',
        summary: 'Spare noir prose.',
        narrativeVoice: 'Dry, watchful, close to the protagonist.',
        sentenceRhythm: 'Short lines with occasional hard pivots.',
        diction: 'Plain words, street-level metaphors.',
        dialogueStyle: 'Clipped and evasive.',
        povAndDistance: 'Close third person.',
        imageryAndSensoryFocus: 'Rain, neon, stale coffee.',
        pacing: 'Fast through action, slower on suspicion.',
        doList: ['Use concrete noir detail.'],
        avoidList: ['Avoid purple prose.'],
        evidence: ['Write in spare noir prose.'],
      },
      directLanguageFragments: {
        dialogue: ['Everyone owes someone.'],
        prose: ['Rain turned the harbor lights into bruises.'],
        terminology: ['dockside'],
      },
    } as SourceMaterialAnalysis);

    expect(section).toContain('Writing Style Guide (explicit_prompt)');
    expect(section).toContain('Spare noir prose.');
    expect(section).toContain('Everyone owes someone.');
    expect(section).toContain('dockside');
  });

  it('handles legacy flat direct-language fragments without crashing', () => {
    const section = buildSourceMaterialFidelitySection({
      directLanguageFragments: [
        { text: 'The old road remembered every footstep.', context: 'prose' },
        { text: 'Stay behind me.', context: 'dialogue', speaker: 'Ari' },
      ],
    } as SourceMaterialAnalysis);

    expect(section).toContain('The old road remembered every footstep.');
    expect(section).toContain('Stay behind me.');
  });
});
