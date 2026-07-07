import { describe, expect, it } from 'vitest';
import { StoryArchitect } from './StoryArchitect';
import type { EpisodeBlueprint, StoryArchitectInput } from './StoryArchitect';

const config = {
  provider: 'gemini' as const,
  model: 'test-model',
  apiKey: 'test-key',
  maxTokens: 1024,
  temperature: 0.1,
};

const GENERIC_TURN = 'Aftermath pressure shifts visible leverage around the episode turn.';

type ArchitectInternals = {
  reauthorGenericPlannerTurns(blueprint: EpisodeBlueprint, input: StoryArchitectInput): Promise<void>;
  reauthorSceneTurn(ctx: { sceneId: string; avoidEvents?: string[] }): Promise<string | null>;
  callLLM(messages: Array<{ role: string; content: string }>, retries?: number): Promise<string>;
};

function buildBlueprint(): EpisodeBlueprint {
  return {
    episodeId: 'episode-1',
    number: 1,
    title: 'Episode 1',
    synopsis: 'Kylie starts over in Bucharest.',
    scenes: [
      {
        id: 's1-6',
        name: 'The Attack',
        narrativeRole: 'turn',
        description: 'Kylie is attacked walking home through Cișmigiu Park.',
        turnContract: {
          turnId: 's1-6-turn',
          source: 'planner',
          centralTurn: 'Kylie is attacked in Cișmigiu Park and saved by a stranger who vanishes.',
          beforeState: 'Before the turn, the park is quiet.',
          turnEvent: 'Kylie is attacked in Cișmigiu Park and saved by a stranger who vanishes.',
          afterState: 'After the turn, Kylie knows someone was watching.',
          handoff: 'Carry the fear home.',
        },
      },
      {
        id: 's1-7',
        name: 'Can Kylie start over and write under her own name?',
        narrativeRole: 'release',
        description: 'Can Kylie start over, feel wanted, and write under her own name?',
        turnContract: {
          turnId: 's1-7-turn',
          source: 'planner',
          centralTurn: GENERIC_TURN,
          beforeState: '',
          turnEvent: GENERIC_TURN,
          afterState: '',
          handoff: '',
        },
      },
    ],
    startingSceneId: 's1-6',
  } as unknown as EpisodeBlueprint;
}

const input = {
  episodeNumber: 1,
  episodeTitle: 'Episode 1',
  episodeSynopsis: 'Kylie starts over in Bucharest.',
} as unknown as StoryArchitectInput;

describe('StoryArchitect.reauthorGenericPlannerTurns', () => {
  it('re-authors only planner-source scaffold turns and re-applies scene contracts', async () => {
    const architect = new StoryArchitect(config) as unknown as ArchitectInternals;
    const authored = 'Kylie tells Bianca she is done hiding and says the next byline will carry her real name.';
    const called: string[] = [];
    architect.reauthorSceneTurn = async (ctx) => {
      called.push(ctx.sceneId);
      return authored;
    };

    const blueprint = buildBlueprint();
    await architect.reauthorGenericPlannerTurns(blueprint, input);

    expect(called).toEqual(['s1-7']);
    const repaired = blueprint.scenes.find((scene) => scene.id === 's1-7');
    expect(repaired?.turnContract?.centralTurn).toBe(authored);
    expect(repaired?.turnContract?.source).toBe('planner');
    // Contract re-application rebuilt the cleared before/after states around the concrete turn.
    expect(repaired?.turnContract?.beforeState).toBeTruthy();
    expect(repaired?.turnContract?.afterState).toBeTruthy();
    // The already-concrete scene is untouched.
    const untouched = blueprint.scenes.find((scene) => scene.id === 's1-6');
    expect(untouched?.turnContract?.centralTurn).toContain('attacked in Cișmigiu Park');
  });

  // Live regression (bite-me 2026-07-07 second abort): the first re-authored
  // turn invented "an anonymous message arrives…", giving s1-7 ownership of the
  // antagonistContact staged event and breaking route chronology against the
  // earlier blog-aftermath scene. The guard must retry with forbidden-event
  // feedback and accept only a turn that stays on the scene's own material.
  it('retries with forbidden-event feedback when the authored turn introduces a foreign staged event', async () => {
    const architect = new StoryArchitect(config) as unknown as ArchitectInternals;
    const inventedEventTurn =
      'An anonymous message arrives on Kylie\'s phone, referencing a secret detail from her attack that she never made public.';
    const cleanTurn = 'Kylie tells Bianca she is done hiding and says the next byline will carry her real name.';
    const avoidEventsSeen: string[][] = [];
    let call = 0;
    architect.reauthorSceneTurn = async (ctx) => {
      call += 1;
      avoidEventsSeen.push(ctx.avoidEvents ?? []);
      return call === 1 ? inventedEventTurn : cleanTurn;
    };

    const blueprint = buildBlueprint();
    await architect.reauthorGenericPlannerTurns(blueprint, input);

    expect(call).toBe(2);
    expect(avoidEventsSeen[0]).toEqual([]);
    expect(avoidEventsSeen[1].length).toBeGreaterThan(0);
    expect(avoidEventsSeen[1].join(' ')).toMatch(/anonymous|hidden sender|contact/i);
    const scene = blueprint.scenes.find((candidate) => candidate.id === 's1-7');
    expect(scene?.turnContract?.centralTurn).toBe(cleanTurn);
  });

  it('keeps the scaffold when both attempts introduce foreign staged events', async () => {
    const architect = new StoryArchitect(config) as unknown as ArchitectInternals;
    architect.reauthorSceneTurn = async () =>
      'An anonymous message arrives on Kylie\'s phone, referencing a secret detail from her attack that she never made public.';

    const blueprint = buildBlueprint();
    await architect.reauthorGenericPlannerTurns(blueprint, input);

    const scene = blueprint.scenes.find((candidate) => candidate.id === 's1-7');
    expect(scene?.turnContract?.centralTurn).toBe(GENERIC_TURN);
  });

  it('keeps the scaffold when the re-author returns nothing usable', async () => {
    const architect = new StoryArchitect(config) as unknown as ArchitectInternals;
    architect.reauthorSceneTurn = async () => null;

    const blueprint = buildBlueprint();
    await architect.reauthorGenericPlannerTurns(blueprint, input);

    const scene = blueprint.scenes.find((candidate) => candidate.id === 's1-7');
    expect(scene?.turnContract?.centralTurn).toBe(GENERIC_TURN);
  });
});

describe('StoryArchitect.reauthorSceneTurn', () => {
  it('accepts a concrete declarative turn from the LLM', async () => {
    const architect = new StoryArchitect(config) as unknown as ArchitectInternals;
    architect.callLLM = async () =>
      JSON.stringify({ centralTurn: 'Kylie hits publish on the first Mr. Midnight post and the counter explodes overnight.' });

    await expect(architect.reauthorSceneTurn({ sceneId: 's1-7' }))
      .resolves.toBe('Kylie hits publish on the first Mr. Midnight post and the counter explodes overnight.');
  });

  it('rejects scaffold, question-shaped, and too-short answers', async () => {
    const architect = new StoryArchitect(config) as unknown as ArchitectInternals;
    for (const bad of [
      GENERIC_TURN,
      'Can Kylie start over, feel wanted, and write under her own name?',
      'Too short.',
    ]) {
      architect.callLLM = async () => JSON.stringify({ centralTurn: bad });
      await expect(architect.reauthorSceneTurn({ sceneId: 's1-7' })).resolves.toBeNull();
    }
  });

  it('returns null instead of throwing when the LLM call fails', async () => {
    const architect = new StoryArchitect(config) as unknown as ArchitectInternals;
    architect.callLLM = async () => {
      throw new Error('provider unavailable');
    };
    await expect(architect.reauthorSceneTurn({ sceneId: 's1-7' })).resolves.toBeNull();
  });
});
