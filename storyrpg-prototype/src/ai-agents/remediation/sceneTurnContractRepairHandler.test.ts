import { describe, expect, it } from 'vitest';
import type { Story } from '../../types/story';
import {
  buildSceneTurnContractRepairHandler,
  collectGenericTurnScenes,
  type SceneTurnReauthorAgent,
} from './sceneTurnContractRepairHandler';

const GENERIC_TURN = 'Aftermath pressure shifts visible leverage around the episode turn.';

const PROSE =
  'Kylie hits publish on the first Mr. Midnight post at 3 a.m., and by morning the counter has climbed past ten thousand readers while her phone will not stop buzzing.';

function buildStory(): Story {
  return {
    id: 'story-1',
    title: 'Bite Me',
    genre: 'test',
    synopsis: '',
    coverImage: '',
    initialState: { attributes: {} as never, skills: {} as never, tags: [], inventory: [] },
    npcs: [],
    episodes: [{
      id: 'episode-1',
      number: 1,
      title: 'Episode 1',
      synopsis: '',
      coverImage: '',
      startingSceneId: 's1-7',
      scenes: [{
        id: 's1-7',
        name: 'The First Post',
        beats: [{ id: 's1-7-b1', text: PROSE }],
        turnContract: {
          turnId: 's1-7-turn',
          source: 'planner',
          centralTurn: GENERIC_TURN,
          beforeState: 'Before the turn, the page is blank.',
          turnEvent: GENERIC_TURN,
          afterState: 'After the turn, consequences remain.',
          handoff: 'Carry the consequence forward.',
        },
      }],
    }],
  } as unknown as Story;
}

function genericTurnIssue(sceneId = 's1-7') {
  return {
    validator: 'SceneTurnRealizationValidator',
    message: `Scene "${sceneId}" still has a generic planner central turn instead of a concrete scene event: "${GENERIC_TURN}".`,
    sceneId,
  };
}

function agentReturning(turn: string | null, calls?: string[]): SceneTurnReauthorAgent {
  return {
    async reauthorSceneTurn(ctx) {
      calls?.push(ctx.sceneId);
      return turn;
    },
  };
}

describe('collectGenericTurnScenes', () => {
  it('locates flagged scenes by sceneId and falls back to the message scene reference', () => {
    const story = buildStory();
    expect(collectGenericTurnScenes(story, [genericTurnIssue()])).toHaveLength(1);
    expect(collectGenericTurnScenes(story, [{ ...genericTurnIssue(), sceneId: undefined }])).toHaveLength(1);
  });

  it('ignores findings from other validators and other SceneTurnRealization classes', () => {
    const story = buildStory();
    expect(collectGenericTurnScenes(story, [
      { validator: 'RequiredBeatRealizationValidator', message: 'generic planner central turn', sceneId: 's1-7' },
      { validator: 'SceneTurnRealizationValidator', message: 'Scene "s1-7" does not dramatize its central turn on-page: "x".', sceneId: 's1-7' },
    ])).toHaveLength(0);
  });
});

describe('buildSceneTurnContractRepairHandler', () => {
  it('replaces a generic planner turn with a prose-grounded authored turn', async () => {
    const story = buildStory();
    const authored = 'Kylie hits publish on the first Mr. Midnight post at 3 a.m., and by morning the counter has climbed past ten thousand readers.';
    const calls: string[] = [];
    const handler = buildSceneTurnContractRepairHandler({ architect: () => agentReturning(authored, calls) });

    const result = await handler({ story, blockingIssues: [genericTurnIssue()] });

    expect(result.changed).toBe(true);
    expect(calls).toEqual(['s1-7']);
    const scene = (story as never as { episodes: Array<{ scenes: Array<{ turnContract: { centralTurn: string; turnEvent: string; turnId: string; source: string } }> }> }).episodes[0].scenes[0];
    expect(scene.turnContract.centralTurn).toBe(authored);
    expect(scene.turnContract.turnEvent).toBe(authored);
    expect(scene.turnContract.turnId).toBe('s1-7-turn');
    expect(scene.turnContract.source).toBe('planner');
    expect(result.record?.rule).toBe('final_contract_scene_turn_contract');
  });

  it('keeps the scaffold when the authored turn is not depicted by the scene prose', async () => {
    const story = buildStory();
    const emitted: string[] = [];
    const handler = buildSceneTurnContractRepairHandler({
      architect: () => agentReturning('Victor burns the municipal archive to the ground before dawn.'),
      emit: (message) => emitted.push(message),
    });

    const result = await handler({ story, blockingIssues: [genericTurnIssue()] });

    expect(result.changed).toBe(false);
    const scene = (story as never as { episodes: Array<{ scenes: Array<{ turnContract: { centralTurn: string } }> }> }).episodes[0].scenes[0];
    expect(scene.turnContract.centralTurn).toBe(GENERIC_TURN);
    expect(emitted.some((message) => message.includes('not depicted'))).toBe(true);
  });

  it('keeps the scaffold when the re-author returns another scaffold or nothing', async () => {
    for (const bad of [null, GENERIC_TURN, 'Can Kylie start over and write under her own name?']) {
      const story = buildStory();
      const handler = buildSceneTurnContractRepairHandler({ architect: () => agentReturning(bad) });
      const result = await handler({ story, blockingIssues: [genericTurnIssue()] });
      expect(result.changed).toBe(false);
      const scene = (story as never as { episodes: Array<{ scenes: Array<{ turnContract: { centralTurn: string } }> }> }).episodes[0].scenes[0];
      expect(scene.turnContract.centralTurn).toBe(GENERIC_TURN);
    }
  });

  it('is a no-op when no generic-turn findings are present', async () => {
    const story = buildStory();
    const calls: string[] = [];
    const handler = buildSceneTurnContractRepairHandler({ architect: () => agentReturning('anything', calls) });
    const result = await handler({
      story,
      blockingIssues: [{ validator: 'RouteContinuityValidator', message: 'unrelated', sceneId: 's1-7' }],
    });
    expect(result.changed).toBe(false);
    expect(calls).toHaveLength(0);
  });
});
