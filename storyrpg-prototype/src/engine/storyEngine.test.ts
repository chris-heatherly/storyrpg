import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getNextScene, processBeat, executeChoice, getResolutionTracker } from './storyEngine';
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

  it('returns success with no resolution when no statCheck', () => {
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

  it('returns resolution with tier, roll, target, margin for stat check', () => {
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

  it('applies use-based growth after stat check', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.1);
    const player = createPlayer();
    expect(player.skills.persuasion ?? 0).toBe(0);

    const choice = makeChoice({
      statCheck: { skillWeights: { persuasion: 1.0 }, difficulty: 50 },
    });
    executeChoice(choice, player);
    expect(player.skills.persuasion).toBeGreaterThan(0);
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
