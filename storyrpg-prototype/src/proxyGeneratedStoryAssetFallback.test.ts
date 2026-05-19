import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';

const {
  buildLegacyEncounterCandidates,
  resolveGeneratedStoryAssetFallback,
} = require('../proxy/generatedStoryAssetFallback') as {
  buildLegacyEncounterCandidates: (fileName: string) => string[];
  resolveGeneratedStoryAssetFallback: (storiesDir: string, requestPath: string) => string | null;
};

describe('generated story asset fallback', () => {
  it('maps storyboard-v2 encounter paths to legacy encounter image names', () => {
    expect(
      buildLegacyEncounterCandidates(
        'storyboard-v2-story-beat-episode-1-scene-1-beat-1.png'
      )[0]
    ).toBe('beat-episode-1-scene-1-beat-1-recovery-qa-retry-5.png');

    expect(
      buildLegacyEncounterCandidates(
        'storyboard-v2-encounter-outcome-episode-1-scene-4-beat-1-c1-success-c1-s-c2-failure.png'
      )[0]
    ).toBe('encounter-episode-1-scene-4-beat-1-c1-path-success-path-c1-s-c2-failure-textfix1.png');

    expect(
      buildLegacyEncounterCandidates(
        'storyboard-v2-encounter-situation-episode-1-scene-4-beat-1-c2-complicated-beat-1-c2-complicated-situation.png'
      )[0]
    ).toBe('encounter-episode-1-scene-4-situation-beat-1-c2-complicated-textfix1.png');
  });

  it('falls back to an older sibling package with the same story slug', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'storyrpg-assets-'));
    const current = path.join(root, 'bite-me_2026-05-12T01-12-40');
    const older = path.join(root, 'bite-me_2026-05-04T18-50-04', 'images');
    fs.mkdirSync(path.join(current, 'images', 'storyboard-v2', 'panels'), { recursive: true });
    fs.mkdirSync(older, { recursive: true });

    const fallback = path.join(older, 'beat-episode-1-scene-1-beat-1-recovery-qa-retry-2.png');
    fs.writeFileSync(fallback, 'image');

    expect(
      resolveGeneratedStoryAssetFallback(
        root,
        '/bite-me_2026-05-12T01-12-40/images/storyboard-v2/panels/storyboard-v2-story-beat-episode-1-scene-1-beat-1.png'
      )
    ).toBe(fallback);
  });
});
