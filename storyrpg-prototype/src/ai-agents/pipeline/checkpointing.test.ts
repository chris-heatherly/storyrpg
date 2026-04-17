import { describe, expect, it } from 'vitest';
import {
  CheckpointRegistry,
  CHECKPOINT_STEP_IDS,
  mapCheckpointPhaseToStepId,
} from './checkpointing';

describe('mapCheckpointPhaseToStepId', () => {
  it('maps kebab-case phases to step ids', () => {
    expect(mapCheckpointPhaseToStepId('world-building')).toBe('worldBible');
    expect(mapCheckpointPhaseToStepId('scene-generation')).toBe('sceneContent');
  });

  it('maps camelCase phases to step ids', () => {
    expect(mapCheckpointPhaseToStepId('characterDesign')).toBe('characterBible');
    expect(mapCheckpointPhaseToStepId('videoGeneration')).toBe('videoGeneration');
  });

  it('returns null for unknown phases', () => {
    expect(mapCheckpointPhaseToStepId('not-a-real-phase')).toBeNull();
    expect(mapCheckpointPhaseToStepId('')).toBeNull();
  });

  it('exposes the expected stable step ids', () => {
    expect(CHECKPOINT_STEP_IDS).toContain('brief');
    expect(CHECKPOINT_STEP_IDS).toContain('worldBible');
    expect(CHECKPOINT_STEP_IDS).toContain('imageGeneration');
    expect(CHECKPOINT_STEP_IDS).toContain('finalize');
  });
});

describe('CheckpointRegistry', () => {
  it('appends checkpoints in insertion order', () => {
    const reg = new CheckpointRegistry();
    reg.add('brief', { x: 1 }, false);
    reg.add('worldBible', { y: 2 }, true);

    const all = reg.list();
    expect(all).toHaveLength(2);
    expect(all[0].phase).toBe('brief');
    expect(all[1].requiresApproval).toBe(true);
    expect(reg.size).toBe(2);
  });

  it('latestFor returns the most recent checkpoint for a phase', () => {
    const reg = new CheckpointRegistry();
    reg.add('worldBible', { revision: 1 }, false);
    reg.add('characterBible', { revision: 1 }, false);
    reg.add('worldBible', { revision: 2 }, true);

    const latest = reg.latestFor('worldBible');
    expect(latest).toBeDefined();
    expect((latest!.data as { revision: number }).revision).toBe(2);
    expect(latest!.requiresApproval).toBe(true);
  });

  it('latestFor returns undefined for unknown phases', () => {
    const reg = new CheckpointRegistry();
    reg.add('brief', {}, false);
    expect(reg.latestFor('imageGeneration')).toBeUndefined();
  });

  it('clear resets the registry', () => {
    const reg = new CheckpointRegistry();
    reg.add('brief', {}, false);
    reg.add('brief', {}, false);

    reg.clear();

    expect(reg.size).toBe(0);
    expect(reg.list()).toHaveLength(0);
  });
});
