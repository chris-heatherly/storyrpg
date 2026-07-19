import { describe, expect, it, vi } from 'vitest';
import type { PipelineConfig, StoryCouncilConfig } from '../config';
import { QualityCouncilRunner } from './QualityCouncilRunner';

const scores = {
  dramaticCausality: 80,
  characterPressure: 80,
  playerAgency: 80,
  routeDifferentiation: 80,
  setupPayoff: 80,
  relationshipPacing: 80,
  sceneEconomy: 80,
  sourceFidelity: 80,
};

function councilConfig(mode: StoryCouncilConfig['mode']): StoryCouncilConfig {
  return {
    enabled: true,
    mode,
    preset: 'custom',
    candidateCount: 2,
    synthesisPolicy: 'adaptive',
    runEpisodeBlueprintCandidates: true,
    runSeasonPlanningCandidates: false,
    runFoundationCandidates: false,
    runChoiceCandidates: false,
    runEncounterCandidates: false,
    runNarrativeScaffoldingCandidates: false,
    runPlanCouncil: false,
    runChoiceCouncil: false,
    runRoutePlaytestCouncil: true,
    runFinalCouncil: true,
    maxCouncilCallsPerRun: 12,
    maxConcurrentCandidates: 2,
    councilTokenBudget: 100000,
    councilRemediationBudget: 2,
    maxCandidateChoiceSets: 2,
  };
}

function runner(mode: StoryCouncilConfig['mode']) {
  return new QualityCouncilRunner({
    config: { storyCouncil: councilConfig(mode), agents: {} } as PipelineConfig,
  });
}

describe('QualityCouncilRunner candidate tournament', () => {
  it('runs candidates concurrently, selects a qualified winner, and retains losing artifacts', async () => {
    const subject = runner('select');
    let active = 0;
    let maxActive = 0;
    (subject as any).candidateJudge = {
      compare: vi.fn(async ({ candidates }: any) => ({
        success: true,
        data: {
          summary: 'second candidate is stronger',
          winnerId: candidates[1].candidateId,
          complementaryMerits: false,
          evaluations: candidates.map((candidate: any) => ({
            candidateId: candidate.candidateId,
            scores,
            strengths: ['clear causality'],
            risks: [],
          })),
        },
      })),
    };

    const result = await subject.runEpisodeBlueprintTournament({
      stage: 'episode-blueprint',
      scope: { episodeNumber: 3 },
      lockedContext: { lockedSceneIds: ['scene-1'] },
      produce: async (seat) => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await Promise.resolve();
        active -= 1;
        return { success: true, data: { id: seat.candidateId } };
      },
      qualify: () => ({ passed: true, issueCodes: [], issues: [] }),
    });

    expect(maxActive).toBe(2);
    expect(result.response.data).toEqual({ id: 'episode-3-candidate-2' });
    expect(result.decision.selectedCandidateId).toBe('episode-3-candidate-2');
    expect(subject.getCandidateArtifactSet({ episodeNumber: 3 })?.candidates).toHaveLength(2);
    expect(subject.getReport()?.summary.callsUsed).toBe(3);
  });

  it('keeps the baseline in shadow mode while reporting the shadow winner', async () => {
    const subject = runner('shadow');
    (subject as any).candidateJudge = {
      compare: vi.fn(async ({ candidates }: any) => ({
        success: true,
        data: {
          summary: 'shadow comparison',
          winnerId: candidates[1].candidateId,
          complementaryMerits: false,
          evaluations: candidates.map((candidate: any) => ({ candidateId: candidate.candidateId, scores, strengths: [], risks: [] })),
        },
      })),
    };
    const result = await subject.runEpisodeBlueprintTournament({
      stage: 'episode-blueprint',
      scope: { episodeNumber: 1 },
      lockedContext: {},
      produce: async (seat) => ({ success: true, data: { id: seat.candidateId } }),
      qualify: () => ({ passed: true, issueCodes: [], issues: [] }),
    });

    expect(result.response.data).toEqual({ id: 'episode-1-candidate-1' });
    expect(result.decision.shadowWinnerId).toBe('episode-1-candidate-2');
  });

  it('isolates a failed candidate call and can still select another qualified candidate', async () => {
    const subject = runner('select');
    const result = await subject.runEpisodeBlueprintTournament({
      stage: 'episode-blueprint',
      scope: { episodeNumber: 4 },
      lockedContext: {},
      produce: async (seat) => {
        if (seat.candidateId.endsWith('candidate-1')) throw new Error('provider timeout');
        return { success: true, data: { id: seat.candidateId } };
      },
      qualify: () => ({ passed: true, issueCodes: [], issues: [] }),
    });

    expect(result.response.data).toEqual({ id: 'episode-4-candidate-2' });
    expect(result.decision.candidates[0]).toMatchObject({ status: 'failed', error: 'provider timeout' });
    expect(subject.getReport()?.summary.infrastructureFailures).toBe(1);
  });

  it('lets the canonical owner synthesize complementary finalists only in select-and-repair mode', async () => {
    const subject = runner('select-and-repair');
    let comparison = 0;
    (subject as any).candidateJudge = {
      compare: vi.fn(async ({ candidates }: any) => {
        comparison += 1;
        return {
          success: true,
          data: {
            summary: 'complementary finalists',
            winnerId: comparison === 1 ? candidates[1].candidateId : 'episode-2-candidate-synthesis',
            complementaryMerits: comparison === 1,
            evaluations: candidates.map((candidate: any) => ({ candidateId: candidate.candidateId, scores, strengths: ['portable merit'], risks: [] })),
          },
        };
      }),
    };
    const produce = vi.fn(async (seat: any) => ({ success: true, data: { id: seat.candidateId, kind: seat.kind } }));
    const result = await subject.runEpisodeBlueprintTournament({
      stage: 'episode-blueprint',
      scope: { episodeNumber: 2 },
      lockedContext: {},
      produce,
      qualify: () => ({ passed: true, issueCodes: [], issues: [] }),
    });

    expect(result.decision.synthesisUsed).toBe(true);
    expect(result.decision.selectedCandidateId).toBe('episode-2-candidate-synthesis');
    expect(result.response.data).toMatchObject({ kind: 'synthesis' });
    const synthesisSeat = produce.mock.calls.map((call) => call[0]).find((seat) => seat.kind === 'synthesis');
    expect(synthesisSeat?.sourceArtifacts?.map((source: any) => source.candidateId)).toEqual([
      'episode-2-candidate-1', 'episode-2-candidate-2',
    ]);
  });
});
