import { describe, expect, it } from 'vitest';
import {
  buildQualityBaselineKey,
  compareQualityBaseline,
  deriveQualityDisposition,
  type QualityBaselineSnapshot,
} from './qualityDisposition';

const baseline: QualityBaselineSnapshot = {
  version: 1,
  key: 'bite-me',
  runDir: 'r115',
  finalScore: 79,
  evidenceCoverage: 96,
  capIds: [],
  domains: { prose_craft: 69, scene_coherence_prose_continuity: 91 },
  committedAt: '2026-07-18T00:00:00.000Z',
};

describe('quality promotion disposition', () => {
  it('uses stable source identity across run names, providers, and compiled plans', () => {
    const common = {
      storyId: 'bite-me-r130_2026-07-19T16-24-08',
      storyTitle: 'Bite Me r130',
      sourceKind: 'authored_lite',
      requestedEpisodes: [1],
      sourceAnalysisHash: 'source-hash',
    };
    const first = buildQualityBaselineKey({
      ...common,
      seasonPlanHash: 'plan-a',
      compilerVersion: 'compiler-a',
      generator: { modelFamily: 'gemini' },
    });
    const second = buildQualityBaselineKey({
      ...common,
      storyId: 'bite-me-r133_2026-07-19T16-24-44',
      storyTitle: 'Bite Me r133',
      seasonPlanHash: 'plan-b',
      compilerVersion: 'compiler-b',
      generator: { modelFamily: 'claude' },
    });
    expect(second).toBe(first);
  });

  it('uses the canonical source hash instead of an LLM-varied display title when available', () => {
    const first = buildQualityBaselineKey({
      storyId: 'bite-me-r133', storyTitle: 'Bite Me', sourceKind: 'authored_lite',
      requestedEpisodes: [1], sourceAnalysisHash: 'source-hash',
    });
    const retitled = buildQualityBaselineKey({
      storyId: 'night-bites-r134', storyTitle: 'Dating After Dusk', sourceKind: 'authored_lite',
      requestedEpisodes: [1], sourceAnalysisHash: 'source-hash',
    });

    expect(retitled).toBe(first);
  });

  it('holds stale QA evidence even when the numeric score would ship', () => {
    expect(deriveQualityDisposition({
      score: 88, rawBand: 'ship', capIds: [], blockingCapCount: 0,
      qaEvidenceStale: true, createdAt: '2026-07-19T00:00:00.000Z',
    })).toMatchObject({ status: 'held', band: 'warn', eligibleForReader: false, reasonCodes: ['qa_evidence_stale'] });
  });

  it('detects the r127-style regression against the accepted baseline', () => {
    const comparison = compareQualityBaseline({
      key: 'bite-me', runDir: 'r127', finalScore: 74, evidenceCoverage: 91,
      capIds: ['unrepaired_contract_semantic'],
      domains: { prose_craft: 64, scene_coherence_prose_continuity: 83 },
    }, baseline);
    expect(comparison.accepted).toBe(false);
    expect(comparison.regressions).toEqual(expect.arrayContaining([
      'final_score:74<79',
      'domain:prose_craft:64<69',
      'domain:scene_coherence_prose_continuity:83<91',
    ]));
  });
});
