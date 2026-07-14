import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  buildFoundationCacheIdentity,
  readFoundationArtifact,
  writeFoundationArtifact,
} from './foundationArtifactCache';

describe('foundationArtifactCache', () => {
  let dir: string;
  const brief = {
    story: { title: 'Test', genre: 'drama' },
    world: { premise: 'A city' },
    protagonist: { id: 'p1', name: 'Alex' },
    userPrompt: 'make it tense',
  };

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'foundation-cache-'));
    delete process.env.STORYRPG_BYPASS_ARTIFACT_CACHE;
  });
  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(dir, { recursive: true, force: true });
    delete process.env.STORYRPG_BYPASS_ARTIFACT_CACHE;
  });

  it('round-trips a world bible for identical inputs and skips on mismatch', () => {
    const identity = buildFoundationCacheIdentity({
      kind: 'world_bible',
      brief,
      provider: 'anthropic',
      model: 'test-model',
      stageInput: { brief },
      memoryContext: 'memory-a',
      upstreamArtifacts: {},
      policyVersions: { prompt: '1', schema: '1' },
    });
    writeFoundationArtifact(dir, identity, { locations: [{ id: 'loc-1' }] });
    expect(readFoundationArtifact<{ locations: Array<{ id: string }> }>(dir, identity)).toEqual({
      locations: [{ id: 'loc-1' }],
    });
    const other = buildFoundationCacheIdentity({
      kind: 'world_bible',
      brief: { ...brief, userPrompt: 'different' },
      provider: 'anthropic',
      model: 'test-model',
      stageInput: { brief: { ...brief, userPrompt: 'different' } },
      memoryContext: 'memory-a',
      upstreamArtifacts: {},
      policyVersions: { prompt: '1', schema: '1' },
    });
    expect(readFoundationArtifact(dir, other)).toBeUndefined();
  });

  it('honors STORYRPG_BYPASS_ARTIFACT_CACHE=1', () => {
    const identity = buildFoundationCacheIdentity({
      kind: 'character_bible',
      brief,
      provider: 'anthropic',
      model: 'test-model',
      stageInput: { brief },
      memoryContext: 'memory-a',
      upstreamArtifacts: { worldBible: { locations: [] } },
      policyVersions: { prompt: '1', schema: '1' },
    });
    writeFoundationArtifact(dir, identity, { characters: [] });
    process.env.STORYRPG_BYPASS_ARTIFACT_CACHE = '1';
    expect(readFoundationArtifact(dir, identity)).toBeUndefined();
  });

  it('invalidates on memory, upstream canon, and prompt policy changes', () => {
    const base = {
      kind: 'character_bible' as const,
      brief,
      provider: 'gemini',
      model: 'gemini-3-pro',
      stageInput: { brief },
      memoryContext: 'memory-a',
      upstreamArtifacts: { worldBible: { locations: [{ id: 'old' }] } },
      policyVersions: { prompt: '1', schema: '1' },
    };
    const identity = buildFoundationCacheIdentity(base);
    writeFoundationArtifact(dir, identity, { characters: [{ id: 'p1' }] });

    expect(readFoundationArtifact(dir, buildFoundationCacheIdentity({ ...base, memoryContext: 'memory-b' }))).toBeUndefined();
    expect(readFoundationArtifact(dir, buildFoundationCacheIdentity({
      ...base,
      upstreamArtifacts: { worldBible: { locations: [{ id: 'new' }] } },
    }))).toBeUndefined();
    expect(readFoundationArtifact(dir, buildFoundationCacheIdentity({
      ...base,
      policyVersions: { prompt: '2', schema: '1' },
    }))).toBeUndefined();
    expect(fs.readdirSync(dir).some((name) => name.endsWith('.tmp'))).toBe(false);
  });

  it('removes the temporary file when an atomic promotion fails', () => {
    const identity = buildFoundationCacheIdentity({
      kind: 'world_bible',
      brief,
      provider: 'gemini',
      model: 'gemini-3-pro',
      stageInput: { brief },
      policyVersions: { prompt: '1', schema: '1' },
    });
    vi.spyOn(fs, 'renameSync').mockImplementationOnce(() => {
      throw new Error('simulated interrupted rename');
    });

    writeFoundationArtifact(dir, identity, { locations: [] });

    expect(fs.readdirSync(dir).some((name) => name.endsWith('.tmp'))).toBe(false);
    expect(readFoundationArtifact(dir, identity)).toBeUndefined();
  });
});
