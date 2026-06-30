import { describe, expect, it } from 'vitest';
import { EmptyPlayableSceneValidator } from './EmptyPlayableSceneValidator';

describe('EmptyPlayableSceneValidator', () => {
  it('blocks empty standard and encounter scenes', () => {
    const story = {
      id: 'synthetic',
      title: 'Synthetic',
      episodes: [{
        id: 'ep1',
        number: 1,
        scenes: [
          { id: 's1', beats: [] },
          { id: 'enc1', encounter: {}, beats: [] },
          { id: 's2', beats: [{ id: 'b1', text: 'Avery opens the locked door.' }] },
        ],
      }],
    } as any;

    const report = new EmptyPlayableSceneValidator().validate({ story });

    expect(report.passed).toBe(false);
    expect(report.emptySceneIds).toEqual(['s1', 'enc1']);
    expect(report.emptyEncounterSceneIds).toEqual(['enc1']);
  });
});
