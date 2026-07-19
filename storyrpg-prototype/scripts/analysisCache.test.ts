import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  analysisCacheFingerprint,
  readAnalysisCache,
  writeAnalysisCache,
  type AnalysisCacheIdentity,
} from './analysisCache';

const dirs: string[] = [];

function identity(overrides: Partial<AnalysisCacheIdentity> = {}): AnalysisCacheIdentity {
  return {
    sourceText: 'treatment source',
    provider: 'gemini',
    model: 'gemini-test',
    options: { pacing: 'moderate', targetScenesPerEpisode: 6 },
    ...overrides,
  };
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('analysis cache fingerprinting', () => {
  it('is stable across option key order', () => {
    expect(analysisCacheFingerprint(identity()).fingerprint).toBe(
      analysisCacheFingerprint(identity({
        options: { targetScenesPerEpisode: 6, pacing: 'moderate' },
      })).fingerprint,
    );
  });

  it('rejects source, model, provider, and option drift', () => {
    const dir = mkdtempSync(join(tmpdir(), 'storyrpg-analysis-cache-'));
    dirs.push(dir);
    const path = join(dir, 'analysis.json');
    writeAnalysisCache(path, identity(), { success: true });

    expect(readAnalysisCache(path, identity())).toEqual({ success: true });
    expect(readAnalysisCache(path, identity({ sourceText: 'changed' }))).toBeUndefined();
    expect(readAnalysisCache(path, identity({ model: 'changed' }))).toBeUndefined();
    expect(readAnalysisCache(path, identity({ provider: 'anthropic' }))).toBeUndefined();
    expect(readAnalysisCache(path, identity({ options: { pacing: 'fast' } }))).toBeUndefined();
  });

  it('rejects cache envelopes that predate canonical identity versioning', () => {
    const dir = mkdtempSync(join(tmpdir(), 'storyrpg-analysis-cache-'));
    dirs.push(dir);
    const path = join(dir, 'analysis.json');
    writeAnalysisCache(path, identity(), { success: true });
    const legacy = JSON.parse(readFileSync(path, 'utf8'));
    delete legacy.identitySchemaVersion;
    writeFileSync(path, JSON.stringify(legacy));

    expect(readAnalysisCache(path, identity())).toBeUndefined();
  });
});
