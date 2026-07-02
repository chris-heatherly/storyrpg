import { describe, it, expect } from 'vitest';
import {
  buildDeterministicContractHandlers,
  runFinalContractRepair,
  type ContractRepairReport,
  type ContractRepairHandler,
} from './finalContractRepair';
import type { Story } from '../../types/story';

// Minimal stand-in story; the loop never inspects its fields (handlers/revalidate are fakes).
const story = { id: 's1', title: 'T' } as unknown as Story;
const fail: ContractRepairReport = { passed: false, blockingIssues: [{ message: 'x', severity: 'error' }] };
const pass: ContractRepairReport = { passed: true, blockingIssues: [] };

describe('runFinalContractRepair', () => {
  it('no-ops when the report already passes', async () => {
    const out = await runFinalContractRepair({
      story,
      initialReport: pass,
      handlers: [() => ({ story, changed: true })],
      revalidate: async () => pass,
    });
    expect(out.passed).toBe(true);
    expect(out.attempts).toBe(0);
    expect(out.records).toHaveLength(0);
  });

  it('repairs and re-validates to a pass, recording the handler', async () => {
    const handler: ContractRepairHandler = () => ({
      story,
      changed: true,
      record: { rule: 'structural', scope: 'autofix', attempted: 1, succeeded: true, degraded: false, blocked: false, attempts: 1 },
    });
    const out = await runFinalContractRepair({
      story,
      initialReport: fail,
      handlers: [handler],
      revalidate: async () => pass,
    });
    expect(out.passed).toBe(true);
    expect(out.attempts).toBe(1);
    expect(out.records).toHaveLength(1);
    expect(out.records[0].rule).toBe('structural');
  });

  it('stops at a fixpoint when no handler changes anything (still failing)', async () => {
    let revalidations = 0;
    const out = await runFinalContractRepair({
      story,
      initialReport: fail,
      handlers: [() => ({ story, changed: false })],
      revalidate: async () => {
        revalidations += 1;
        return fail;
      },
    });
    expect(out.passed).toBe(false);
    expect(out.attempts).toBe(1); // one round attempted, then fixpoint break
    expect(revalidations).toBe(0); // never re-validated because nothing changed
  });

  it('respects maxAttempts when repairs keep changing but never pass', async () => {
    const out = await runFinalContractRepair({
      story,
      initialReport: fail,
      handlers: [() => ({ story, changed: true })],
      revalidate: async () => fail,
      maxAttempts: 3,
    });
    expect(out.passed).toBe(false);
    expect(out.attempts).toBe(3);
  });

  it('deduplicates repeated issue fingerprints before handlers when enabled', async () => {
    let seenIssues = 0;
    const duplicateFail: ContractRepairReport = {
      passed: false,
      blockingIssues: [
        { validator: 'SceneTurnRealizationValidator', episodeNumber: 2, sceneId: 's2-2', message: 'Missing "same authored moment in prose"' },
        { validator: 'SceneTurnRealizationValidator', episodeNumber: 2, sceneId: 's2-2', message: 'Missing "same authored moment in prose"' },
      ],
    };
    const out = await runFinalContractRepair({
      story,
      initialReport: duplicateFail,
      handlers: [({ blockingIssues }) => {
        seenIssues = blockingIssues.length;
        return { story, changed: false };
      }],
      revalidate: async () => duplicateFail,
      dedupeIssueFingerprints: true,
    });
    expect(out.passed).toBe(false);
    expect(out.attempts).toBe(1);
    expect(seenIssues).toBe(1);
  });

  it('stops retrying an unchanged issue after its per-issue budget is spent', async () => {
    let handlerCalls = 0;
    let revalidations = 0;
    const repeatedFail: ContractRepairReport = {
      passed: false,
      blockingIssues: [{ validator: 'SceneTurnRealizationValidator', episodeNumber: 2, sceneId: 's2-2', message: 'Missing "stubborn authored moment in prose"' }],
    };
    const out = await runFinalContractRepair({
      story,
      initialReport: repeatedFail,
      handlers: [() => {
        handlerCalls += 1;
        return { story, changed: true };
      }],
      revalidate: async () => {
        revalidations += 1;
        return repeatedFail;
      },
      maxAttempts: 5,
      maxAttemptsPerIssue: 1,
    });
    expect(out.passed).toBe(false);
    expect(out.attempts).toBe(1);
    expect(handlerCalls).toBe(1);
    expect(revalidations).toBe(1);
    expect(out.exhaustedIssueCount).toBe(1);
  });

  it('charges per-issue budget on ATTEMPT, not selection — every issue gets a repair pass (g23)', async () => {
    // The g23 shape: 10 distinct scene fingerprints, a handler capped at 4
    // scenes/round, maxAttemptsPerIssue=2. The OLD accounting charged every
    // SELECTED issue whenever the round changed anything, so the 6 un-attempted
    // issues were "exhausted" after 2 rounds without ever being repaired and the
    // run aborted. With attempt-based charging, all 10 receive an attempt.
    const issues = Array.from({ length: 10 }, (_, i) => ({
      validator: 'SceneTurnRealizationValidator',
      episodeNumber: 1,
      sceneId: `s1-${i + 1}`,
      message: `Missing "authored moment ${i + 1}"`,
    }));
    const attempted = new Set<string>();
    const { contractRepairIssueFingerprint } = await import('./finalContractRepair');
    const cappedHandler: ContractRepairHandler = ({ blockingIssues }) => {
      // Simulate the scene-prose handler: work on at most 4 not-yet-attempted
      // scenes per round, report exactly what was attempted.
      const round = blockingIssues.filter((i) => !attempted.has(i.sceneId!)).slice(0, 4);
      for (const issue of round) attempted.add(issue.sceneId!);
      return {
        story,
        changed: round.length > 0,
        attemptedIssueKeys: round.map((issue) => contractRepairIssueFingerprint(issue)),
      };
    };
    const out = await runFinalContractRepair({
      story,
      initialReport: { passed: false, blockingIssues: issues },
      handlers: [cappedHandler],
      // Nothing ever clears — the worst case. The loop should still give every
      // distinct issue an attempt before running out of rounds.
      revalidate: async () => ({ passed: false, blockingIssues: issues }),
      maxAttempts: 3,
      maxAttemptsPerIssue: 2,
      dedupeIssueFingerprints: true,
    });
    expect(out.passed).toBe(false);
    // All 10 scenes were attempted across the 3 rounds (4 + 4 + 2) — under the
    // old selection-charging, rounds 1-2 would have exhausted the budgets of
    // scenes 9-10 before they were ever attempted.
    expect(attempted.size).toBe(10);
    // And no issue was marked exhausted without having been attempted.
    for (const key of out.exhaustedIssueKeys) {
      const sceneId = key.split('::')[5];
      expect(attempted.has(sceneId), `issue ${sceneId} exhausted without an attempt`).toBe(true);
    }
  });

  it('allows a new issue fingerprint after the prior one is repaired', async () => {
    let handlerCalls = 0;
    const firstFail: ContractRepairReport = {
      passed: false,
      blockingIssues: [{ validator: 'RequiredBeatRealizationValidator', episodeNumber: 1, sceneId: 's1-1', message: 'Missing "door adoption"' }],
    };
    const secondFail: ContractRepairReport = {
      passed: false,
      blockingIssues: [{ validator: 'RequiredBeatRealizationValidator', episodeNumber: 1, sceneId: 's1-2', message: 'Missing "club entrance"' }],
    };
    const reports = [secondFail, pass];
    const out = await runFinalContractRepair({
      story,
      initialReport: firstFail,
      handlers: [() => {
        handlerCalls += 1;
        return { story, changed: true };
      }],
      revalidate: async () => reports.shift() ?? pass,
      maxAttempts: 5,
      maxAttemptsPerIssue: 1,
    });
    expect(out.passed).toBe(true);
    expect(out.attempts).toBe(2);
    expect(handlerCalls).toBe(2);
    expect(out.exhaustedIssueCount).toBe(0);
  });

  it('stops early when canSpend denies another round', async () => {
    const out = await runFinalContractRepair({
      story,
      initialReport: fail,
      handlers: [() => ({ story, changed: true })],
      revalidate: async () => fail,
      maxAttempts: 5,
      canSpend: () => false,
    });
    expect(out.passed).toBe(false);
    expect(out.attempts).toBe(0);
  });

  it('sanitizes generic dramaticIntent metadata scaffold during deterministic repair', async () => {
    const localStory = {
      id: 'metadata-hygiene',
      title: 'Metadata Hygiene',
      episodes: [{
        id: 'ep1',
        number: 1,
        scenes: [{
          id: 'scene-1',
          beats: [{
            id: 'beat-1',
            text: 'The room changes when the letter lands on the table.',
            dramaticIntent: {
              characterObjectives: {
                'the protagonist': 'the protagonist wants to shift the moment without saying everything directly',
              },
              statusBefore: 'the protagonist enters without full control of the room',
              statusAfter: "the protagonist's visible action shifts attention and leverage",
            },
          }],
        }],
      }],
    } as unknown as Story;

    const out = await runFinalContractRepair({
      story: localStory,
      initialReport: {
        passed: false,
        blockingIssues: [{
          validator: 'RouteContinuityValidator',
          type: 'unsafe_fallback_prose',
          sceneId: 'scene-1',
          beatId: 'beat-1',
          message: 'Unsafe fallback/planning prose survived in scene:scene-1.beat:beat-1.dramaticIntent.',
        }],
      },
      handlers: buildDeterministicContractHandlers(),
      revalidate: async () => pass,
    });

    const intent = localStory.episodes[0].scenes[0].beats[0].dramaticIntent as any;
    expect(out.passed).toBe(true);
    expect(intent.characterObjectives['the protagonist']).toBeUndefined();
    expect(JSON.stringify(intent)).not.toMatch(/the protagonist|without saying everything directly|without full control of the room/i);
    expect(intent.characterObjectives['the focal character']).toContain('visible change');
  });

  it('removes synthetic cold-open fallback beats from non-opening scenes flagged by route continuity', async () => {
    const localStory = {
      id: 'coldopen-cleanup',
      title: 'Cold Open Cleanup',
      episodes: [{
        id: 'ep1',
        number: 1,
        startingSceneId: 'opening',
        scenes: [{
          id: 'opening',
          startingBeatId: 'open-b1',
          beats: [{ id: 'open-b1', text: 'The taxi drops Mara at the curb.' }],
        }, {
          id: 'later',
          startingBeatId: 'later-b1',
          beats: [{
            id: 'later-b1',
            text: 'The booth is already loud.',
            nextBeatId: 'later-authored-coldopen-mara-arrives-1',
          }, {
            id: 'later-authored-coldopen-mara-arrives-1',
            text: 'Mara arrives in the city with two suitcases.',
            nextBeatId: 'later-b2',
          }, {
            id: 'later-b2',
            text: 'The conversation continues.',
          }],
        }],
      }],
    } as unknown as Story;

    const out = await runFinalContractRepair({
      story: localStory,
      initialReport: {
        passed: false,
        blockingIssues: [{
          validator: 'RouteContinuityValidator',
          type: 'route_chronology_violation',
          sceneId: 'later',
          message: 'Reader route opening -> later stages arrival after socialMeet.',
        }],
      },
      handlers: buildDeterministicContractHandlers(),
      revalidate: async () => pass,
    });

    const later = localStory.episodes[0].scenes[1];
    expect(out.passed).toBe(true);
    expect(later.beats.map((beat) => beat.id)).toEqual(['later-b1', 'later-b2']);
    expect(later.beats[0].nextBeatId).toBe('later-b2');
    expect(out.records.some((record) => record.rule === 'final_contract_coldopen_fallback_route_cleanup')).toBe(true);
  });
});
