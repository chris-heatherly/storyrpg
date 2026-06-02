import { describe, it, expect } from 'vitest';
import {
  initPlan,
  setEpisodeScenes,
  setSceneBeats,
  markEpisode,
  markSceneActive,
  setPhaseUnits,
  computeContentFraction,
  computeOverallProgress,
  CONTENT_PHASE,
  type GenerationPlan,
} from './generationPlan';

/** A content-only plan (single phase, weight 1) so overall == contentFraction*100. */
const contentOnlyPlan = (totalEpisodes: number): GenerationPlan =>
  initPlan({
    totalEpisodes,
    episodes: Array.from({ length: totalEpisodes }, (_, i) => ({ number: i + 1 })),
    phases: [{ phase: CONTENT_PHASE, weight: 1 }],
  });

describe('computeContentFraction', () => {
  it('treats an episode with no scenes as 0 unless marked complete', () => {
    const plan = contentOnlyPlan(3);
    expect(computeContentFraction(plan)).toBe(0);
    markEpisode(plan, 1, 'complete');
    expect(computeContentFraction(plan)).toBeCloseTo(1 / 3, 5);
  });

  it('1 of 3 episodes complete ⇒ ~0.333', () => {
    const plan = contentOnlyPlan(3);
    // Episode 1 fully written.
    setEpisodeScenes(plan, 1, [
      { id: 's1', expectedBeatCount: 4 },
      { id: 's2', expectedBeatCount: 4 },
    ]);
    setSceneBeats(plan, 1, 's1', 4);
    setSceneBeats(plan, 1, 's2', 5);
    markEpisode(plan, 1, 'complete');
    expect(computeContentFraction(plan)).toBeCloseTo(1 / 3, 5);
  });

  it('partial current episode: completed scenes + pending scenes', () => {
    const plan = contentOnlyPlan(1);
    setEpisodeScenes(plan, 1, [
      { id: 's1', expectedBeatCount: 4 },
      { id: 's2', expectedBeatCount: 4 },
      { id: 's3', expectedBeatCount: 4 },
      { id: 's4', expectedBeatCount: 4 },
    ]);
    // Equal beat weights ⇒ 1 of 4 scenes written ⇒ 0.25.
    setSceneBeats(plan, 1, 's1', 4);
    expect(computeContentFraction(plan)).toBeCloseTo(0.25, 5);
  });

  it('weights scenes by beat count', () => {
    const plan = contentOnlyPlan(1);
    setEpisodeScenes(plan, 1, [
      { id: 'small', expectedBeatCount: 2 },
      { id: 'big', expectedBeatCount: 8 },
    ]);
    // Writing the big scene (weight 8 of 10) ⇒ 0.8.
    setSceneBeats(plan, 1, 'big', 8);
    expect(computeContentFraction(plan)).toBeCloseTo(0.8, 5);
  });

  it('estimate-then-fill: estimated beats contribute 0 until the scene is written', () => {
    const plan = contentOnlyPlan(1);
    setEpisodeScenes(plan, 1, [{ id: 's1', expectedBeatCount: 6 }]);
    // Beats are estimated/pending ⇒ scene fraction 0.
    expect(computeContentFraction(plan)).toBe(0);
    setSceneBeats(plan, 1, 's1', 6);
    expect(computeContentFraction(plan)).toBe(1);
  });
});

describe('computeOverallProgress', () => {
  it('normalizes by total weight across phases', () => {
    const plan = initPlan({
      totalEpisodes: 1,
      episodes: [{ number: 1 }],
      phases: [
        { phase: 'world', weight: 10, total: 1 },
        { phase: CONTENT_PHASE, weight: 10 },
      ],
    });
    expect(computeOverallProgress(plan)).toBe(0);
    // World done (10/20 of weight), content empty ⇒ 50%.
    setPhaseUnits(plan, 'world', { completed: 1, total: 1 });
    expect(computeOverallProgress(plan)).toBe(50);
    // Content done too ⇒ 100%.
    markEpisode(plan, 1, 'complete');
    expect(computeOverallProgress(plan)).toBe(100);
  });

  it('uses completed/total for non-content phases', () => {
    const plan = initPlan({
      totalEpisodes: 1,
      episodes: [{ number: 1 }],
      phases: [{ phase: 'images', weight: 1, total: 4 }],
    });
    setPhaseUnits(plan, 'images', { completed: 2 });
    expect(computeOverallProgress(plan)).toBe(50);
  });

  it('single-episode degenerate case tracks the one episode', () => {
    const plan = contentOnlyPlan(1);
    setEpisodeScenes(plan, 1, [{ id: 's1', expectedBeatCount: 4 }, { id: 's2', expectedBeatCount: 4 }]);
    setSceneBeats(plan, 1, 's1', 4);
    expect(computeOverallProgress(plan)).toBe(50);
  });
});

describe('accumulation + monotonicity', () => {
  it('progress never decreases across a realistic emission sequence', () => {
    const plan = initPlan({
      totalEpisodes: 2,
      episodes: [{ number: 1 }, { number: 2 }],
      phases: [
        { phase: 'world', weight: 8, total: 1 },
        { phase: 'characters', weight: 16, total: 3 },
        { phase: CONTENT_PHASE, weight: 22 },
        { phase: 'images', weight: 20, total: 6 },
      ],
    });

    const series: number[] = [];
    const tick = () => series.push(computeOverallProgress(plan));

    tick();
    setPhaseUnits(plan, 'world', { completed: 1 });
    tick();
    setPhaseUnits(plan, 'characters', { completed: 3 });
    tick();
    setEpisodeScenes(plan, 1, [{ id: 'e1s1', expectedBeatCount: 5 }, { id: 'e1s2', expectedBeatCount: 5 }]);
    markEpisode(plan, 1, 'active');
    tick();
    setSceneBeats(plan, 1, 'e1s1', 5);
    tick();
    setSceneBeats(plan, 1, 'e1s2', 6);
    markEpisode(plan, 1, 'complete');
    tick();
    setEpisodeScenes(plan, 2, [{ id: 'e2s1', expectedBeatCount: 5 }]);
    markEpisode(plan, 2, 'active');
    tick();
    setSceneBeats(plan, 2, 'e2s1', 5);
    markEpisode(plan, 2, 'complete');
    tick();
    setPhaseUnits(plan, 'images', { completed: 6 });
    tick();

    for (let i = 1; i < series.length; i += 1) {
      expect(series[i]).toBeGreaterThanOrEqual(series[i - 1]);
    }
    expect(series[series.length - 1]).toBe(100);
  });

  it('episode completion is derived from scenes — a pending encounter keeps it <100%', () => {
    const plan = contentOnlyPlan(1);
    setEpisodeScenes(plan, 1, [
      { id: 's1', expectedBeatCount: 6 },
      { id: 's2', expectedBeatCount: 6 },
      { id: 's3', expectedBeatCount: 3, isEncounter: true }, // built later by EncounterArchitect
    ]);
    setSceneBeats(plan, 1, 's1', 6);
    setSceneBeats(plan, 1, 's2', 6);
    // Marking the EPISODE complete must NOT force 100% while the encounter is unbuilt.
    markEpisode(plan, 1, 'complete');
    expect(computeContentFraction(plan)).toBeLessThan(1);
    expect(plan.episodes[0].scenes.find((s) => s.id === 's3')?.status).toBe('pending');
    // Only once the encounter scene is actually built does the episode reach 1.0.
    setSceneBeats(plan, 1, 's3', 3);
    expect(computeContentFraction(plan)).toBe(1);
  });

  it('markSceneActive sets activity, setSceneBeats clears it on complete', () => {
    const plan = contentOnlyPlan(1);
    setEpisodeScenes(plan, 1, [{ id: 's1', expectedBeatCount: 8, isEncounter: true }]);
    markSceneActive(plan, 1, 's1', 'writing');
    const scene = plan.episodes[0].scenes[0];
    expect(scene.status).toBe('active');
    expect(scene.activity).toBe('writing');
    expect(scene.isEncounter).toBe(true);
    setSceneBeats(plan, 1, 's1', 8);
    expect(scene.status).toBe('complete');
    expect(scene.activity).toBeUndefined();
  });

  it('handles out-of-order (parallel) episode completion', () => {
    const plan = contentOnlyPlan(3);
    setEpisodeScenes(plan, 3, [{ id: 'e3s1', expectedBeatCount: 4 }]);
    setSceneBeats(plan, 3, 'e3s1', 4);
    markEpisode(plan, 3, 'complete');
    // Episode 3 done before 1 and 2 ⇒ still 1/3.
    expect(computeContentFraction(plan)).toBeCloseTo(1 / 3, 5);
  });
});
