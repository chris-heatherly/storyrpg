import { describe, expect, it, beforeEach, afterEach } from 'vitest';
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
    fs.rmSync(dir, { recursive: true, force: true });
    delete process.env.STORYRPG_BYPASS_ARTIFACT_CACHE;
  });

  it('round-trips a world bible for identical inputs and skips on mismatch', () => {
    const identity = buildFoundationCacheIdentity({
      kind: 'world_bible',
      brief,
      provider: 'anthropic',
      model: 'test-model',
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
    });
    expect(readFoundationArtifact(dir, other)).toBeUndefined();
  });

  it('honors STORYRPG_BYPASS_ARTIFACT_CACHE=1', () => {
    const identity = buildFoundationCacheIdentity({
      kind: 'character_bible',
      brief,
      provider: 'anthropic',
      model: 'test-model',
    });
    writeFoundationArtifact(dir, identity, { characters: [] });
    process.env.STORYRPG_BYPASS_ARTIFACT_CACHE = '1';
    expect(readFoundationArtifact(dir, identity)).toBeUndefined();
  });
});
