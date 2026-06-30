import { describe, expect, it } from 'vitest';
import { buildSceneTimelineLabels } from './sceneNumbering';

describe('buildSceneTimelineLabels', () => {
  it('shares a display number across branch alternatives and keeps the bottleneck correct', () => {
    const labels = buildSceneTimelineLabels(['scene-1', 'scene-2', 'scene-3a', 'scene-3b', 'scene-4']);
    const byId = Object.fromEntries(labels.map((l) => [l.sceneId, l]));
    expect(byId['scene-1'].label).toBe('Scene 1');
    expect(byId['scene-2'].label).toBe('Scene 2');
    expect(byId['scene-3a'].label).toBe('Scene 3 (Path A)');
    expect(byId['scene-3b'].label).toBe('Scene 3 (Path B)');
    expect(byId['scene-3a'].displayNumber).toBe(byId['scene-3b'].displayNumber);
    // The bottleneck is Scene 4, not Scene 5.
    expect(byId['scene-4'].label).toBe('Scene 4');
  });

  it('numbers plain sequential scenes 1..N', () => {
    const labels = buildSceneTimelineLabels(['scene-1', 'scene-2', 'scene-3']);
    expect(labels.map((l) => l.label)).toEqual(['Scene 1', 'Scene 2', 'Scene 3']);
  });

  it('falls back to first-appearance ordering for ids that do not parse', () => {
    const labels = buildSceneTimelineLabels(['intro', 'scene-1', 'finale']);
    expect(labels.map((l) => l.displayNumber)).toEqual([1, 2, 3]);
  });
});
