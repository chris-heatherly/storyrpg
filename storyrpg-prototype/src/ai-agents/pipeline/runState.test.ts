import { describe, expect, it } from 'vitest';
import { createRunState, resetEpisodeScratch, serializeSeasonState } from './runState';

describe('PipelineRunState', () => {
  it('creates the three segments with fresh narrative state', () => {
    const state = createRunState();
    expect(state.season.canon).toBeTruthy();
    expect(state.season.callbackLedger.all()).toEqual([]);
    expect(state.season.threadLedger.threads).toEqual([]);
    expect(state.season.episodeTwistPlans.size).toBe(0);
    expect(state.episode.sceneValidationResults).toEqual([]);
    expect(state.run.allSceneValidationResults).toEqual([]);
  });

  it('resetEpisodeScratch clears ONLY the episode segment', () => {
    const state = createRunState();
    state.episode.sceneValidationResults.push({ sceneId: 's1' } as never);
    state.episode.encounterTelemetry.push({ sceneId: 's1' } as never);
    state.run.allSceneValidationResults.push({ sceneId: 's1' } as never);

    resetEpisodeScratch(state);

    expect(state.episode.sceneValidationResults).toEqual([]);
    expect(state.episode.encounterTelemetry).toEqual([]);
    expect(state.run.allSceneValidationResults).toHaveLength(1); // cumulative untouched
  });

  it('serializeSeasonState produces a JSON-safe resume payload', () => {
    const state = createRunState();
    state.season.callbackLedger.add({
      id: 'flag:f1', sourceEpisode: 1, sourceSceneId: 's1', sourceChoiceId: 'c1',
      flags: ['f1'], summary: 'plant', payoffWindow: { minEpisode: 1, maxEpisode: 3 },
    });
    state.season.episodeTwistPlans.set(1, { twists: [] } as never);

    const payload = serializeSeasonState(state.season);
    // Round-trips through JSON without loss of the ledger entry or map entries.
    const json = JSON.parse(JSON.stringify(payload));
    expect(json.callbackLedger.hooks).toHaveLength(1);
    expect(json.episodeTwistPlans).toEqual([[1, { twists: [] }]]);
    expect(json.threadLedger.threads).toEqual([]);
  });
});
