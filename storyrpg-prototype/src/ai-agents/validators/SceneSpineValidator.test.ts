import { describe, expect, it } from 'vitest';
import { SceneSpineValidator } from './SceneSpineValidator';
import type { PlannedScene, SeasonScenePlan } from '../../types/scenePlan';

function scene(id: string, episodeNumber: number, order: number, opts: Partial<PlannedScene> = {}): PlannedScene {
  return {
    id,
    episodeNumber,
    order,
    kind: 'standard',
    title: id,
    dramaticPurpose: 'purpose',
    narrativeRole: 'development',
    locations: [],
    npcsInvolved: [],
    setsUp: [],
    paysOff: [],
    ...opts,
  };
}

function planFrom(scenes: PlannedScene[], edges: SeasonScenePlan['setupPayoffEdges'] = []): SeasonScenePlan {
  const byEpisode: Record<number, string[]> = {};
  for (const s of scenes) {
    (byEpisode[s.episodeNumber] ??= []).push(s.id);
  }
  return { scenes, byEpisode, setupPayoffEdges: edges };
}

describe('SceneSpineValidator', () => {
  it('passes a well-formed spine with consistent setup/payoff', () => {
    const a = scene('s1-1', 1, 0, { setsUp: ['s2-1'] });
    const b = scene('s1-2', 1, 1);
    const c = scene('s2-1', 2, 0, { paysOff: ['s1-1'] });
    const sp = planFrom([a, b, c], [{ from: 's1-1', to: 's2-1', span: 'cross_episode' }]);

    const result = new SceneSpineValidator().validate(sp);
    expect(result.valid).toBe(true);
    expect(result.issues.filter((i) => i.severity === 'error')).toHaveLength(0);
  });

  it('errors on a backward (earlier-episode) setup', () => {
    const a = scene('s2-1', 2, 0, { setsUp: ['s1-1'] });
    const b = scene('s1-1', 1, 0, { paysOff: ['s2-1'] });
    const sp = planFrom([a, b]);

    const result = new SceneSpineValidator().validate(sp);
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.severity === 'error' && /EARLIER episode/.test(i.message))).toBe(true);
  });

  it('errors on a setsUp pointing at an unknown scene', () => {
    const a = scene('s1-1', 1, 0, { setsUp: ['ghost'] });
    const sp = planFrom([a]);

    const result = new SceneSpineValidator().validate(sp);
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => /unknown scene "ghost"/.test(i.message))).toBe(true);
  });

  it('warns when setsUp and paysOff disagree', () => {
    const a = scene('s1-1', 1, 0, { setsUp: ['s2-1'] });
    const c = scene('s2-1', 2, 0); // does NOT list s1-1 as payoff
    const sp = planFrom([a, c]);

    const result = new SceneSpineValidator().validate(sp);
    expect(result.issues.some((i) => i.severity === 'warning' && /does not list it as a payoff/.test(i.message))).toBe(true);
  });

  it('errors on an empty plan', () => {
    const result = new SceneSpineValidator().validate(planFrom([]));
    expect(result.valid).toBe(false);
  });
});
