import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getNextScene, processBeat, executeChoice, getResolutionTracker, isTerminalSceneTarget } from './storyEngine';
import type { Episode, PlayerState, Story, EncounterBeat, Choice } from '../types';

function createPlayer(): PlayerState {
  return {
    characterName: 'Player',
    characterPronouns: 'they/them',
    attributes: {
      charm: 50,
      wit: 50,
      courage: 50,
      empathy: 50,
      resolve: 50,
      resourcefulness: 50,
    },
    skills: {},
    relationships: {},
    flags: {},
    scores: {},
    tags: new Set(),
    identityProfile: {
      mercy_justice: 0,
      idealism_pragmatism: 0,
      cautious_bold: 0,
      loner_leader: 0,
      heart_head: 0,
      honest_deceptive: 0,
    },
    pendingConsequences: [],
    inventory: [],
    currentStoryId: null,
    currentEpisodeId: null,
    currentSceneId: null,
    completedEpisodes: [],
  };
}

function createEpisode(): Episode {
  return {
    id: 'episode-1',
    number: 1,
    title: 'Episode 1',
    synopsis: 'Test',
    coverImage: '',
    startingSceneId: 'scene-a',
    scenes: [
      {
        id: 'scene-a',
        name: 'Scene A',
        startingBeatId: 'beat-a',
        beats: [{ id: 'beat-a', text: 'A', choices: [] }],
        leadsTo: ['scene-b'],
      },
      {
        id: 'scene-b',
        name: 'Scene B',
        startingBeatId: 'beat-b',
        beats: [{ id: 'beat-b', text: 'B', choices: [] }],
        conditions: {
          type: 'flag',
          flag: 'unlock-b',
          value: true,
        },
        fallbackSceneId: 'scene-c',
      },
      {
        id: 'scene-c',
        name: 'Scene C',
        startingBeatId: 'beat-c',
        beats: [{ id: 'beat-c', text: 'C', choices: [] }],
      },
    ],
  };
}

describe('storyEngine.getNextScene', () => {
  it('uses fallback scenes when the target scene is skipped', () => {
    const nextScene = getNextScene(createEpisode(), 'scene-a', createPlayer());
    expect(nextScene?.id).toBe('scene-c');
  });

  it('returns undefined for circular fallback chains', () => {
    const episode = createEpisode();
    episode.scenes[1].fallbackSceneId = 'scene-c';
    episode.scenes[2].conditions = {
      type: 'flag',
      flag: 'unlock-c',
      value: true,
    };
    episode.scenes[2].fallbackSceneId = 'scene-b';

    const nextScene = getNextScene(episode, 'scene-a', createPlayer());
    expect(nextScene).toBeUndefined();
  });
});

describe('storyEngine.processBeat encounter gating', () => {
  it('returns passive skill insights when hidden coverage meets threshold', () => {
    const player = createPlayer();
    player.attributes.wit = 80;
    player.skills.investigation = 70;

    const story: Story = {
      id: 'story-1',
      title: 'Story',
      synopsis: 'Test',
      genre: 'Mystery',
      coverImage: '',
      initialState: { attributes: player.attributes, skills: {}, tags: [], inventory: [] },
      npcs: [],
      episodes: [],
    };

    const beat = {
      id: 'beat-1',
      text: 'The office is dark.',
      skillInsights: [
        {
          id: 'scrape-marks',
          skillWeights: { investigation: 1 },
          threshold: 55,
          text: 'The scrape marks beneath the desk point toward the window.',
          priority: 1,
        },
        {
          id: 'locked-safe',
          skillWeights: { survival: 1 },
          threshold: 90,
          text: 'This should stay hidden.',
        },
      ],
      choices: [],
    };

    const processed = processBeat(beat as any, player, story);
    expect(processed.skillInsights).toEqual(['The scrape marks beneath the desk point toward the window.']);
  });

  it('uses fiction-first fallback when unsafe planning text is stripped', () => {
    const player = createPlayer();
    const story: Story = {
      id: 'bite-me',
      title: 'Bite Me',
      synopsis: 'Test',
      genre: 'Paranormal romance',
      coverImage: '',
      initialState: { attributes: player.attributes, skills: {}, tags: [], inventory: [] },
      npcs: [],
      episodes: [],
    };
    const beat = {
      id: 's1-5__beat-5',
      text: 'PEAK: In the park when the shadow appears: scream, run, freeze, or fight — And next morning, what name do you give him: Mr. Midnight (canonical), The Stranger, The Velvet, or The Suit.',
      primaryAction: 'Kylie claws at the wet bark and fights for breath.',
      choices: [],
    };

    const processed = processBeat(beat as any, player, story);

    expect(processed.text).toBe('Kylie claws at the wet bark and fights for breath.');
    expect(processed.text).not.toMatch(/PEAK|canonical|what name do you give him|journey|challenges|decisions/i);
  });

  it('does not render visual-contract fallback prose as player-facing beat text', () => {
    const player = createPlayer();
    const story: Story = {
      id: 'bite-me',
      title: 'Bite Me',
      synopsis: 'Test',
      genre: 'Paranormal romance',
      coverImage: '',
      initialState: { attributes: player.attributes, skills: {}, tags: [], inventory: [] },
      npcs: [],
      episodes: [],
    };
    const beat = {
      id: 's1-arrival-cold-open__beat-1',
      text: "Kylie Marinescu's composed surface slips through a small evasive movement as her hands and attention lock onto the window.",
      visualMoment: "Kylie Marinescu's composed surface slips through a small evasive movement.",
      primaryAction: 'the character reacts through a visible gesture, object cue, or shift in distance',
      choices: [],
    };

    const processed = processBeat(beat as any, player, story);

    expect(processed.text).toBe('The moment tightens. You take the next breath and move before fear can close around you.');
    expect(processed.text).not.toMatch(/composed surface|small evasive movement|subtext visible|visible gesture/i);
  });

  it('shows relationship-gated encounter choices as locked when configured to showWhenLocked', () => {
    const player = createPlayer();
    player.relationships.mara = {
      npcId: 'mara',
      trust: 5,
      affection: 0,
      respect: 0,
      fear: 0,
    };

    const story: Story = {
      id: 'story-1',
      title: 'Story',
      synopsis: 'Test',
      genre: 'Drama',
      tone: 'Tense',
      protagonist: {
        id: 'pc',
        name: 'Player',
        description: 'Hero',
        pronouns: 'they/them',
      },
      npcs: [{ id: 'mara', name: 'Mara', role: 'ally', description: 'Ally', pronouns: 'she/her' as const }],
      episodes: [],
    } as any;

    const beat: EncounterBeat = {
      id: 'beat-1',
      phase: 'setup',
      name: 'A tense pause',
      setupText: 'Mara watches you carefully.',
      choices: [
        {
          id: 'locked-choice',
          text: 'Ask Mara to trust you',
          approach: 'steady',
          showWhenLocked: true,
          lockedText: 'Mara does not trust you enough yet.',
          conditions: { type: 'relationship', npcId: 'mara', dimension: 'trust', operator: '>=', value: 20 },
          outcomes: {
            success: { tier: 'success', narrativeText: 'She relents.', goalTicks: 1, threatTicks: 0, isTerminal: true, encounterOutcome: 'victory' },
            complicated: { tier: 'complicated', narrativeText: 'She hesitates.', goalTicks: 1, threatTicks: 1, isTerminal: true, encounterOutcome: 'partialVictory' },
            failure: { tier: 'failure', narrativeText: 'She turns away.', goalTicks: 0, threatTicks: 2, isTerminal: true, encounterOutcome: 'defeat' },
          },
        },
        {
          id: 'hidden-choice',
          text: 'Use your secret history',
          approach: 'clever',
          conditions: { type: 'relationship', npcId: 'mara', dimension: 'trust', operator: '>=', value: 40 },
          outcomes: {
            success: { tier: 'success', narrativeText: 'It works.', goalTicks: 1, threatTicks: 0, isTerminal: true, encounterOutcome: 'victory' },
            complicated: { tier: 'complicated', narrativeText: 'Almost.', goalTicks: 1, threatTicks: 1, isTerminal: true, encounterOutcome: 'partialVictory' },
            failure: { tier: 'failure', narrativeText: 'It backfires.', goalTicks: 0, threatTicks: 2, isTerminal: true, encounterOutcome: 'defeat' },
          },
        },
      ],
    } as any;

    const processed = processBeat(beat, player, story);

    expect(processed.choices).toHaveLength(1);
    expect(processed.choices[0]).toMatchObject({
      id: 'locked-choice',
      isLocked: true,
      lockedReason: 'Mara does not trust you enough yet.',
    });
  });
});

// -----------------------------------------------------------------------
// executeChoice integration
// -----------------------------------------------------------------------

describe('storyEngine.executeChoice', () => {
  beforeEach(() => {
    getResolutionTracker().reset();
    vi.restoreAllMocks();
  });

  function makeChoice(overrides?: Partial<Choice>): Choice {
    return {
      id: 'choice-1',
      text: 'Test choice',
      ...overrides,
    } as Choice;
  }

  it('returns success with no change when no statCheck', () => {
    const result = executeChoice(makeChoice(), createPlayer());
    expect(result.success).toBe(true);
    expect(result.resolution).toBeUndefined();
  });

  it('returns { success: false } when conditions are not met', () => {
    const choice = makeChoice({
      conditions: { type: 'flag', flag: 'nonexistent', value: true },
    });
    const result = executeChoice(choice, createPlayer());
    expect(result.success).toBe(false);
    expect(result.consequences).toHaveLength(0);
  });

  it('returns change with tier, roll, target, margin for stat check', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.1);
    const choice = makeChoice({
      statCheck: { skillWeights: { persuasion: 1.0 }, difficulty: 50 },
    });
    const result = executeChoice(choice, createPlayer());
    expect(result.success).toBe(true);
    expect(result.resolution).toBeDefined();
    expect(['success', 'complicated', 'failure']).toContain(result.resolution!.tier);
    expect(typeof result.resolution!.roll).toBe('number');
    expect(typeof result.resolution!.target).toBe('number');
  });

  it('emits use-based growth as skill consequences after stat check', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.1);
    const player = createPlayer();
    expect(player.skills.persuasion ?? 0).toBe(0);

    const choice = makeChoice({
      statCheck: { skillWeights: { persuasion: 1.0 }, difficulty: 50 },
    });
    const result = executeChoice(choice, player);
    expect(player.skills.persuasion ?? 0).toBe(0);
    expect(result.consequences).toContainEqual({ type: 'skill', skill: 'persuasion', change: 2 });
  });

  it('applies prepared stat-check modifiers only when their conditions pass', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.35);
    const player = createPlayer();
    player.flags.kept_promise = true;

    const baseline = executeChoice(makeChoice({
      statCheck: { skillWeights: { persuasion: 1.0 }, difficulty: 65 },
    }), createPlayer()).resolution!;

    getResolutionTracker().reset();
    vi.spyOn(Math, 'random').mockReturnValue(0.35);
    const prepared = executeChoice(makeChoice({
      statCheck: {
        skillWeights: { persuasion: 1.0 },
        difficulty: 65,
        modifiers: [
          {
            id: 'kept-promise',
            condition: { type: 'flag', flag: 'kept_promise', value: true },
            delta: 25,
            reason: 'Promise creates leverage.',
            hint: 'The promise still gives you a way in.',
          },
        ],
      },
    }), player).resolution!;

    expect(prepared.tier).toBe('success');
    expect(baseline.tier).not.toBe('success');
  });

  it('injects outcome tier flags as consequences', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.01); // low roll -> success
    const choice = makeChoice({
      statCheck: { skillWeights: { athletics: 1.0 }, difficulty: 50 },
    });
    const result = executeChoice(choice, createPlayer());
    const flagConsequences = result.consequences.filter(c => c.type === 'setFlag');
    const flagNames = flagConsequences.map(c => (c as any).flag);
    expect(flagNames).toContain('_outcome_success');
    expect(flagNames).toContain('_outcome_partial');
    expect(flagNames).toContain('_outcome_failure');
  });

  it('overrides narrative text when outcomeTexts are provided', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.01);
    const choice = makeChoice({
      statCheck: { skillWeights: { athletics: 1.0 }, difficulty: 50 },
      outcomeTexts: {
        success: 'You did it!',
        partial: 'Almost...',
        failure: 'Not this time.',
      },
    });
    const result = executeChoice(choice, createPlayer());
    expect(result.resolution).toBeDefined();
    expect(['You did it!', 'Almost...', 'Not this time.']).toContain(result.resolution!.narrativeText);
  });

  it('records outcome in shared ResolutionTracker', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.99); // high roll -> failure
    const choice = makeChoice({
      statCheck: { skillWeights: { athletics: 1.0 }, difficulty: 50 },
    });
    executeChoice(choice, createPlayer());
    expect(getResolutionTracker().getConsecutiveFailures()).toBeGreaterThanOrEqual(0);
  });

  it('handles legacy attribute-only stat check format', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.1);
    const choice = makeChoice({
      statCheck: { attribute: 'courage', difficulty: 50 },
    });
    const result = executeChoice(choice, createPlayer());
    expect(result.success).toBe(true);
    expect(result.resolution).toBeDefined();
  });

  it('preserves nextSceneId and nextBeatId from choice', () => {
    const choice = makeChoice({
      nextSceneId: 'scene-next',
      nextBeatId: 'beat-next',
    });
    const result = executeChoice(choice, createPlayer());
    expect(result.nextSceneId).toBe('scene-next');
    expect(result.nextBeatId).toBe('beat-next');
  });
});

describe('isTerminalSceneTarget', () => {
  it('recognizes terminal sentinels (so the reader finishes instead of loading a missing scene)', () => {
    for (const t of ['episode-end', 'story-end', 'season-end', 'end', 'the-end', 'ending', 'EPISODE-END', 'episode-2']) {
      expect(isTerminalSceneTarget(t)).toBe(true);
    }
  });
  it('does not flag real scene ids or empty values', () => {
    for (const s of ['scene-1', 'scene-2b', 'scene-3', '', undefined, null]) {
      expect(isTerminalSceneTarget(s as any)).toBe(false);
    }
  });
});

describe('storyEngine unified choice processing (encounter unification W1)', () => {
  const story: Story = {
    id: 'story-w1',
    title: 'Story',
    synopsis: 'Test',
    genre: 'Mystery',
    coverImage: '',
    initialState: { attributes: {} as any, skills: {} as any, tags: [], inventory: [] },
    npcs: [],
    episodes: [],
  };

  it('getChoiceAvailability matches legacy gating for both shapes', async () => {
    const { getChoiceAvailability } = await import('./storyEngine');
    const player = createPlayer();
    player.flags = { met_mika: true };

    // Unlocked
    expect(getChoiceAvailability({ conditions: { type: 'flag', flag: 'met_mika', value: true } } as any, player, story))
      .toEqual({ visible: true, isLocked: false, lockedReason: undefined });
    // Hidden when locked and not showWhenLocked
    expect(getChoiceAvailability({ conditions: { type: 'flag', flag: 'nope', value: true } } as any, player, story).visible)
      .toBe(false);
    // Locked with authored lockedText
    const locked = getChoiceAvailability(
      { conditions: { type: 'flag', flag: 'nope', value: true }, showWhenLocked: true, lockedText: 'She is not ready.' } as any,
      player,
      story,
    );
    expect(locked).toEqual({ visible: true, isLocked: true, lockedReason: 'She is not ready.' });
    // Retryable fallback copy
    const retryable = getChoiceAvailability(
      { conditions: { type: 'flag', flag: 'nope', value: true }, showWhenLocked: true, feedbackCue: { checkClass: 'retryable' } } as any,
      player,
      story,
    );
    expect(retryable.lockedReason).toContain('Not yet.');
  });

  it('encounter beat choices keep their tactical display facets through the shared skeleton', () => {
    const player = createPlayer();
    player.skills.stealth = 40;
    const encounterBeat = {
      id: 'enc-b1',
      setupText: 'Guards block the door.',
      phase: 'rising',
      choices: [{
        id: 'enc-c1',
        text: 'Slip past the guards',
        approach: 'cautious',
        primarySkill: 'stealth',
        statBonus: { condition: { type: 'flag', flag: 'nope', value: true }, difficultyReduction: 10, flavorText: 'The shadows favor you.' },
        outcomes: { success: {}, complicated: {}, failure: {} },
      }],
    };

    const processed = processBeat(encounterBeat as any, player, story);
    expect(processed.choices).toHaveLength(1);
    const choice = processed.choices[0];
    expect(choice.hasStatCheck).toBe(true);
    expect(choice.statCheckInfo).toEqual({ skill: 'stealth' });
    expect(choice.primarySkillKey).toBe('stealth');
    expect(choice.hasAdvantage).toBe(true);
    expect(choice.advantageText).toBe('The shadows favor you.');
    expect(choice.isLocked).toBe(false);
  });
});
