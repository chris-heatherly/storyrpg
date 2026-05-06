import { describe, expect, it } from 'vitest';
import { buildBeatImagePrompt } from './beatPromptBuilder';

describe('buildBeatImagePrompt', () => {
  it('defaults beat prompts to one full-screen continuous image', () => {
    const prompt = buildBeatImagePrompt(
      {
        beatId: 'beat-1',
        beatText: 'Mara steps between the guard and the broken gate.',
        beatIndex: 0,
        totalBeats: 2,
        visualMoment: 'Mara steps between the guard and the broken gate.',
        primaryAction: 'steps forward with one hand raised',
        emotionalRead: 'Mara is afraid but resolved',
        relationshipDynamic: 'Mara protects the protagonist by taking the nearer danger',
        mustShowDetail: 'the broken gate behind them',
        foregroundCharacterNames: ['Mara'],
      },
      {
        sceneId: 'scene-1',
        sceneName: 'The Gate',
        genre: 'fantasy',
        tone: 'urgent',
        artStyle: 'inked watercolor',
      },
    );

    expect(prompt.prompt).toContain('One full-screen continuous image');
    expect(prompt.prompt).toContain('single camera');
    expect(prompt.negativePrompt).toContain('comic panels');
    expect(prompt.negativePrompt).toContain('split-screen');
    expect(prompt.negativePrompt).toContain('multi-panel');
  });

  it('applies the same single-image guard to establishing shots', () => {
    const prompt = buildBeatImagePrompt(
      {
        beatId: 'beat-1',
        beatText: 'Rain hammers the empty courtyard.',
        beatIndex: 0,
        totalBeats: 1,
        shotType: 'establishing',
        visualMoment: 'Rain hammers the empty courtyard.',
      },
      {
        sceneId: 'scene-1',
        sceneName: 'The Courtyard',
        genre: 'mystery',
        tone: 'somber',
        artStyle: 'noir wash',
      },
    );

    expect(prompt.prompt).toContain('One full-screen continuous image');
    expect(prompt.negativePrompt).toContain('storyboard cells');
  });

  it('tells the provider not to add offscreen scene characters to focused beats', () => {
    const prompt = buildBeatImagePrompt(
      {
        beatId: 'beat-2',
        beatText: 'Miss Scarlet slides the brass key toward Professor Plum.',
        beatIndex: 0,
        totalBeats: 1,
        visualMoment: 'Miss Scarlet slides the brass key toward Professor Plum.',
        primaryAction: 'slides the brass key across the table',
        foregroundCharacterNames: ['Miss Scarlet', 'Professor Plum'],
      },
      {
        sceneId: 'scene-1',
        sceneName: 'The Study',
        genre: 'mystery',
        tone: 'tense',
        artStyle: 'painted mystery illustration',
      },
    );

    expect(prompt.prompt).toContain('Visible shot cast: Miss Scarlet, Professor Plum only');
    expect(prompt.prompt).toContain('Do not add other scene-present characters');
    expect(prompt.prompt).not.toContain('Colonel Mustard visible in the background');
  });

  it('only lists background characters when the resolver explicitly provides them', () => {
    const prompt = buildBeatImagePrompt(
      {
        beatId: 'beat-3',
        beatText: 'Mrs Peacock watches as Miss Scarlet slides the brass key toward Professor Plum.',
        beatIndex: 0,
        totalBeats: 1,
        visualMoment: 'Miss Scarlet slides the brass key toward Professor Plum.',
        primaryAction: 'slides the brass key across the table',
        foregroundCharacterNames: ['Miss Scarlet', 'Professor Plum'],
        backgroundCharacterNames: ['Mrs Peacock'],
      },
      {
        sceneId: 'scene-1',
        sceneName: 'The Study',
        genre: 'mystery',
        tone: 'tense',
        artStyle: 'painted mystery illustration',
      },
    );

    expect(prompt.prompt).toContain('Visible shot cast: Miss Scarlet, Professor Plum, Mrs Peacock only');
    expect(prompt.prompt).toContain('Mrs Peacock visible in the background');
  });

  it('uses depth-based group staging instead of default left-center-right lineup', () => {
    const prompt = buildBeatImagePrompt(
      {
        beatId: 'beat-group-depth',
        beatText: 'Mara confronts Vale while Sera watches the door.',
        beatIndex: 0,
        totalBeats: 1,
        visualMoment: 'Mara confronts Vale while Sera watches the door.',
        primaryAction: 'leans toward the accusation as the others react',
        foregroundCharacterNames: ['Mara', 'Vale', 'Sera'],
      },
      {
        sceneId: 'scene-1',
        sceneName: 'The Hall',
        genre: 'fantasy',
        tone: 'tense',
        artStyle: 'inked watercolor',
      },
    );

    expect(prompt.prompt).toContain('Staging:');
    expect(prompt.prompt).toContain('Layer characters in depth');
    expect(prompt.prompt).toContain('do not arrange everyone as a flat left-center-right lineup');
    expect(prompt.prompt).not.toMatch(/Mara left, Vale center, Sera right/);
  });

  it('keeps explicit character staging overrides when provided', () => {
    const prompt = buildBeatImagePrompt(
      {
        beatId: 'beat-explicit-staging',
        beatText: 'Mara confronts Vale while Sera watches the door.',
        beatIndex: 0,
        totalBeats: 1,
        visualMoment: 'Mara confronts Vale while Sera watches the door.',
        primaryAction: 'leans toward the accusation as the others react',
        foregroundCharacterNames: ['Mara', 'Vale', 'Sera'],
        characterStaging: {
          Mara: 'left of the broken table',
          Vale: 'centered in the doorway',
          Sera: 'right side near the stairs',
        },
      },
      {
        sceneId: 'scene-1',
        sceneName: 'The Hall',
        genre: 'fantasy',
        tone: 'tense',
        artStyle: 'inked watercolor',
      },
    );

    expect(prompt.prompt).toContain('Mara left of the broken table');
    expect(prompt.prompt).toContain('Vale centered in the doorway');
    expect(prompt.prompt).toContain('Sera right side near the stairs');
  });

  it('includes locked cinematic coverage and relationship blocking', () => {
    const prompt = buildBeatImagePrompt(
      {
        beatId: 'beat-coverage',
        beatText: 'Kenji waits while Hikari decides what to say.',
        beatIndex: 0,
        totalBeats: 1,
        visualMoment: 'Kenji waits while Hikari decides what to say.',
        primaryAction: 'waits in tense stillness',
        foregroundCharacterNames: ['Kenji Tanaka', 'Hikari Hoshino'],
        coveragePlan: {
          stagingPattern: 'ots-speaker',
          shotDistance: 'MCU',
          cameraAngle: 'eye-level',
          cameraSide: 'primary',
          focalCharacterIds: ['kenji'],
          requiredVisibleCharacterIds: ['kenji', 'hikari'],
          optionalVisibleCharacterIds: [],
          offscreenCharacterIds: [],
          relationshipBlocking: 'Over-the-shoulder dialogue coverage keeps Hikari physically present as listener.',
          coverageReason: 'dialogue coverage run 1; pattern=ots-speaker; shot=MCU',
        },
      },
      {
        sceneId: 'scene-1',
        sceneName: 'The Kitchen',
        genre: 'drama',
        tone: 'tense',
        artStyle: 'fashion anime',
      },
    );

    expect(prompt.prompt).toContain('Coverage plan: ots-speaker staging, MCU shot, eye-level');
    expect(prompt.prompt).toContain('Relationship blocking: Over-the-shoulder dialogue coverage');
    expect(prompt.prompt).toContain('Coverage reason: dialogue coverage run 1');
    expect(prompt.prompt).toContain('Visual continuity: fresh composition by default');
  });

  it('honors explicit locked micro-progression continuity', () => {
    const prompt = buildBeatImagePrompt(
      {
        beatId: 'beat-locked',
        beatText: 'Hikari notices the blood on Kenji\'s sleeve.',
        beatIndex: 0,
        totalBeats: 1,
        visualMoment: 'Hikari notices the blood on Kenji\'s sleeve.',
        primaryAction: 'eyes drop to the sleeve as her hand tightens on the cup',
        foregroundCharacterNames: ['Hikari Hoshino', 'Kenji Tanaka'],
        coveragePlan: {
          stagingPattern: 'two-shot',
          shotDistance: 'MCU',
          cameraAngle: 'eye-level',
          cameraSide: 'primary',
          focalCharacterIds: ['hikari'],
          requiredVisibleCharacterIds: ['hikari', 'kenji'],
          optionalVisibleCharacterIds: [],
          offscreenCharacterIds: [],
          relationshipBlocking: 'The tiny reaction between them is the beat.',
          coverageReason: 'locked reaction insert',
          visualContinuity: {
            mode: 'locked_micro_progression',
            reason: 'The drama is a single visible realization inside the same frame.',
            preserve: ['camera', 'blocking', 'lighting', 'environment', 'character_position'],
            changeOnly: 'Hikari glances down and tightens her grip on the cup',
          },
        },
      },
      {
        sceneId: 'scene-1',
        sceneName: 'The Kitchen',
        genre: 'drama',
        tone: 'tense',
        artStyle: 'fashion anime',
      },
    );

    expect(prompt.prompt).toContain('Visual continuity: locked micro-progression');
    expect(prompt.prompt).toContain('ONLY visible change: Hikari glances down and tightens her grip on the cup');
  });

  it('keeps style in the style contract and strips competing art direction from beat text', () => {
    const prompt = buildBeatImagePrompt(
      {
        beatId: 'beat-style',
        beatText: 'Mara waits in what looks like a film still.',
        beatIndex: 0,
        totalBeats: 1,
        visualMoment: 'Mara waits in a cinematic story frame with oil painting texture.',
        primaryAction: 'stands still',
        foregroundCharacterNames: ['Mara'],
      },
      {
        sceneId: 'scene-1',
        sceneName: 'The Gate',
        genre: 'fantasy',
        tone: 'tense',
        artStyle: 'inked watercolor with clean linework',
      },
    );

    expect(prompt.style).toBe('inked watercolor with clean linework');
    expect(prompt.styleContract?.text).toBe('inked watercolor with clean linework');
    expect(prompt.prompt).toContain('STYLE CONTRACT');
    expect(prompt.prompt).not.toMatch(/Maintain art style|Style reminder/i);
    expect(prompt.prompt).not.toMatch(/cinematic story frame|oil painting texture|film still/i);
    expect(prompt.negativePrompt).toContain('photorealism');
    expect(prompt.negativePrompt).toContain('architectural visualization');
    expect(prompt.negativeContract).toContain('realistic 3D render');
    expect(prompt.promptContract?.sanitizedTerms).toEqual(
      expect.arrayContaining(['cinematic story frame', 'oil painting texture']),
    );
  });

  it('rejects stable character redesigns unless an appearance state is supplied', () => {
    expect(() => buildBeatImagePrompt(
      {
        beatId: 'beat-redesign',
        beatText: 'Mara enters with a new look.',
        beatIndex: 0,
        totalBeats: 1,
        visualMoment: 'Mara has changed hair and a different face.',
        primaryAction: 'walks into the room',
        foregroundCharacterNames: ['Mara'],
      },
      {
        sceneId: 'scene-1',
        sceneName: 'The Gate',
        genre: 'fantasy',
        tone: 'tense',
        artStyle: 'inked watercolor',
      },
    )).toThrow(/appearance_state/);
  });
});
