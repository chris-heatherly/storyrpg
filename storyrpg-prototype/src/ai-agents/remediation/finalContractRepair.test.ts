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
});
