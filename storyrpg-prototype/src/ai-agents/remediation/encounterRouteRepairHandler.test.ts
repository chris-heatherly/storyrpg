import { describe, expect, it, vi } from 'vitest';
import type { Story } from '../../types/story';
import { buildEncounterRouteRepairHandler } from './encounterRouteRepairHandler';

describe('buildEncounterRouteRepairHandler', () => {
  it('derives an encounter outcome tier from an unsafe exact field path', async () => {
    const story = {
      id: 'story',
      title: 'Story',
      episodes: [{
        id: 'ep1',
        number: 1,
        scenes: [{ id: 'enc-1', name: 'Rescue', beats: [], encounter: { phases: [] } }],
      }],
    } as unknown as Story;
    const reauthorEncounterRoute = vi.fn().mockResolvedValue(1);
    const handler = buildEncounterRouteRepairHandler({
      author: () => ({ reauthorEncounterRoute }),
    });

    const result = await handler({
      story,
      blockingIssues: [{
        validator: 'RouteContinuityValidator',
        type: 'unsafe_fallback_prose',
        sceneId: 'enc-1',
        fieldPath: 'encounter.phases[0].beats[7].choices[0].outcomes.complicated.narrativeText',
        message: 'Unsafe fallback prose survived.',
      }],
    });

    expect(result.changed).toBe(true);
    expect(reauthorEncounterRoute).toHaveBeenCalledWith(expect.objectContaining({
      outcomeTier: 'complicated',
      sceneName: 'Rescue',
    }));
  });
});
