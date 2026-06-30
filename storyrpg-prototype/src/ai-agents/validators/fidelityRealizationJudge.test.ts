import { describe, expect, it, vi } from 'vitest';
import {
  FidelityRealizationJudge,
  confirmHeuristicFidelityFindings,
} from './fidelityRealizationJudge';
import type { Story } from '../../types/story';

const config = {
  provider: 'anthropic' as const,
  model: 'test-model',
  apiKey: 'test-key',
  maxTokens: 1024,
  temperature: 0.1,
};

function makeStory(): Story {
  return {
    id: 'st',
    title: 'T',
    episodes: [
      {
        id: 'ep-2', number: 2,
        scenes: [
          {
            id: 's2-1', name: 'Route',
            beats: [
              { id: 'b1', text: 'Rorik stabs a finger at the river crossing; Lysandra counters with the ridge path, voice flat with old contempt. Neither yields until the map tears.' },
            ],
          },
          { id: 's2-4', name: 'Confession', beats: [{ id: 'b1', text: 'They make camp in silence.' }] },
        ],
      },
    ],
  } as unknown as Story;
}

const beatFinding = (sceneId: string) => ({
  type: 'treatment_fidelity_violation',
  severity: 'error',
  message: `Authored required beat is missing from the final prose of episode 2 scene "${sceneId}": "Rorik and Lysandra argue over the river crossing route and tear the map.". The authored turn must be dramatized on-page, not dropped or truncated.`,
  validator: 'RequiredBeatRealizationValidator',
  sceneId,
  episodeNumber: 2,
});

describe('confirmHeuristicFidelityFindings', () => {
  it('downgrades judge-refuted findings to warnings and recomputes passed', async () => {
    const judge = {
      execute: vi.fn().mockResolvedValue({
        success: true,
        data: { verdicts: [{ id: 'claim-0', dramatized: true, evidence: 'Neither yields until the map tears' }] },
      }),
    };
    const report = { passed: false, blockingIssues: [beatFinding('s2-1')], warnings: [] as unknown[] };
    const outcome = await confirmHeuristicFidelityFindings({
      report: report as never,
      story: makeStory(),
      judge: () => judge as never,
    });

    expect(outcome).toEqual({ judged: 1, downgraded: 1 });
    expect(report.blockingIssues).toHaveLength(0);
    expect(report.passed).toBe(true);
    expect(report.warnings).toHaveLength(1);
    expect((report.warnings[0] as { message: string }).message).toContain('judge-confirmed dramatized');
    // The judge saw the scene's actual prose.
    const claims = judge.execute.mock.calls[0][0];
    expect(claims[0].prose).toContain('map tears');
    expect(claims[0].authoredMoment).toBe('Rorik and Lysandra argue over the river crossing route and tear the map.');
  });

  it('keeps RequiredBeat findings blocking when the judge is looser than deterministic scoring', async () => {
    const judge = {
      execute: vi.fn().mockResolvedValue({
        success: true,
        data: { verdicts: [{ id: 'claim-0', dramatized: true, evidence: 'privacy pressure' }] },
      }),
    };
    const report = {
      passed: false,
      blockingIssues: [{
        type: 'treatment_fidelity_violation',
        severity: 'error',
        message: 'Authored required beat is missing from the final prose of episode 2 scene "s2-4": "Over Sunday breakfast, Victor asks Kylie to keep his face out of her viral blog for privacy.". The authored turn must be dramatized on-page, not dropped or truncated.',
        validator: 'RequiredBeatRealizationValidator',
        sceneId: 's2-4',
        episodeNumber: 2,
      }],
      warnings: [] as unknown[],
    };
    const outcome = await confirmHeuristicFidelityFindings({
      report: report as never,
      story: makeStory(),
      judge: () => judge as never,
    });

    expect(outcome).toEqual({ judged: 1, downgraded: 0 });
    expect(report.blockingIssues).toHaveLength(1);
    expect(report.passed).toBe(false);
  });

  it('keeps judge-confirmed misses blocking', async () => {
    const judge = {
      execute: vi.fn().mockResolvedValue({
        success: true,
        data: { verdicts: [{ id: 'claim-0', dramatized: false }] },
      }),
    };
    const report = { passed: false, blockingIssues: [beatFinding('s2-4')], warnings: [] as unknown[] };
    const outcome = await confirmHeuristicFidelityFindings({
      report: report as never,
      story: makeStory(),
      judge: () => judge as never,
    });
    expect(outcome).toEqual({ judged: 1, downgraded: 0 });
    expect(report.blockingIssues).toHaveLength(1);
    expect(report.passed).toBe(false);
  });

  it('is conservative on judge failure — everything stays blocking', async () => {
    const judge = { execute: vi.fn().mockResolvedValue({ success: false, error: 'LLM down' }) };
    const report = { passed: false, blockingIssues: [beatFinding('s2-1')], warnings: [] as unknown[] };
    const outcome = await confirmHeuristicFidelityFindings({
      report: report as never,
      story: makeStory(),
      judge: () => judge as never,
    });
    expect(outcome.downgraded).toBe(0);
    expect(report.blockingIssues).toHaveLength(1);
    expect(report.passed).toBe(false);
  });

  it('never touches non-heuristic findings (deterministic validators are not judgeable)', async () => {
    const judge = { execute: vi.fn() };
    const report = {
      passed: false,
      blockingIssues: [
        { type: 'encounter_template_collapse', severity: 'error', validator: 'EncounterQualityValidator', sceneId: 's2-1', message: 'template' },
        { type: 'broken_navigation', severity: 'error', message: 'route to nowhere' },
      ],
      warnings: [] as unknown[],
    };
    const outcome = await confirmHeuristicFidelityFindings({
      report: report as never,
      story: makeStory(),
      judge: () => judge as never,
    });
    expect(outcome).toEqual({ judged: 0, downgraded: 0 });
    expect(judge.execute).not.toHaveBeenCalled();
    expect(report.blockingIssues).toHaveLength(2);
  });

  it('skips judging (stays blocking) when the named scene has no prose', async () => {
    const judge = { execute: vi.fn() };
    const report = { passed: false, blockingIssues: [beatFinding('missing-scene')], warnings: [] as unknown[] };
    const outcome = await confirmHeuristicFidelityFindings({
      report: report as never,
      story: makeStory(),
      judge: () => judge as never,
    });
    expect(outcome).toEqual({ judged: 0, downgraded: 0 });
    expect(judge.execute).not.toHaveBeenCalled();
    expect(report.blockingIssues).toHaveLength(1);
  });
});

describe('FidelityRealizationJudge', () => {
  it('parses verdicts and filters unknown/malformed ids', async () => {
    const judge = new FidelityRealizationJudge(config) as never as {
      callLLM: unknown;
      execute: (claims: Array<{ id: string; authoredMoment: string; prose: string }>) => Promise<{ success: boolean; data?: { verdicts: unknown[] } }>;
    };
    (judge as { callLLM: unknown }).callLLM = vi.fn().mockResolvedValue(JSON.stringify({
      verdicts: [
        { id: 'claim-0', dramatized: true, evidence: 'quote' },
        { id: 'claim-99', dramatized: true }, // unknown id → filtered
        { id: 'claim-1', dramatized: 'yes' }, // malformed → filtered
      ],
    }));
    const res = await judge.execute([
      { id: 'claim-0', authoredMoment: 'a', prose: 'p' },
      { id: 'claim-1', authoredMoment: 'b', prose: 'q' },
    ]);
    expect(res.success).toBe(true);
    expect(res.data?.verdicts).toEqual([{ id: 'claim-0', dramatized: true, evidence: 'quote' }]);
  });

  it('returns success:false (conservative) when the LLM call fails', async () => {
    const judge = new FidelityRealizationJudge(config) as never as {
      callLLM: unknown;
      execute: (claims: Array<{ id: string; authoredMoment: string; prose: string }>) => Promise<{ success: boolean }>;
    };
    (judge as { callLLM: unknown }).callLLM = vi.fn().mockRejectedValue(new Error('down'));
    const res = await judge.execute([{ id: 'claim-0', authoredMoment: 'a', prose: 'p' }]);
    expect(res.success).toBe(false);
  });
});
