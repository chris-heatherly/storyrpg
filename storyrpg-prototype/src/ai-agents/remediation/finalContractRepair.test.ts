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
  it('keeps a canonical-target fingerprint stable when rewritten prose changes', async () => {
    const { contractRepairIssueFingerprint } = await import('./finalContractRepair');
    const first = contractRepairIssueFingerprint({
      validator: 'NarrativeContractValidator', type: 'treatment_fidelity_violation',
      sceneId: 's1-1', taskId: 'task:premise:identity',
      message: 'Premise was missing: "observer orders second".',
    });
    const second = contractRepairIssueFingerprint({
      validator: 'NarrativeContractValidator', type: 'treatment_fidelity_violation',
      sceneId: 's1-1', taskId: 'task:premise:identity',
      message: 'Premise was missing: "watches the room".',
    });
    expect(first).toBe(second);
  });

  it('preserves an owner-stage realization fingerprint across final repair routing', async () => {
    const { contractRepairIssueFingerprint } = await import('./finalContractRepair');
    expect(contractRepairIssueFingerprint({
      validator: 'NarrativeContractValidator',
      message: 'wording can change',
      severity: 'error',
      realizationFingerprint: 'OWNER_REALIZATION_MISSING::task:route::s1-4::victory::departure',
    })).toBe('realization::OWNER_REALIZATION_MISSING::task:route::s1-4::victory::departure');
  });

  it('treats a reduced semantic atom set as progress within one repair family', async () => {
    const localStory = { id: 'semantic-progress', title: 'Semantic Progress', marker: 'before' } as unknown as Story;
    const issueFor = (atoms: string[]) => ({
      validator: 'SemanticRealizationJudge',
      issueCode: 'SEMANTIC_REALIZATION_MISSING',
      sceneId: 's1-3',
      taskId: 'task:event:ep1-u3:owner-event',
      severity: 'error',
      message: `Missing: ${atoms.join(', ')}`,
      missingEvidenceAtoms: atoms,
      realizationFingerprint: `SEMANTIC_REALIZATION_MISSING::task:event:ep1-u3:owner-event::s1-3::${atoms.join(',')}`,
    });
    const initial: ContractRepairReport = { passed: false, blockingIssues: [issueFor(['semantic:3', 'semantic:4'])] };
    const partial: ContractRepairReport = { passed: false, blockingIssues: [issueFor(['semantic:3'])] };
    const out = await runFinalContractRepair({
      story: localStory,
      initialReport: initial,
      handlers: [({ story: candidate }) => {
        (candidate as any).marker = 'partially-repaired';
        return { story: candidate, changed: true };
      }],
      revalidate: async () => partial,
      maxAttempts: 1,
      rejectIntroducedBlockingIssues: true,
      rejectNoBlockingProgress: true,
      requireMutationEvidence: true,
    });
    expect((localStory as any).marker).toBe('partially-repaired');
    expect(out.report.blockingIssues[0]?.missingEvidenceAtoms).toEqual(['semantic:3']);
  });

  it('rejects a new missing semantic atom within an existing repair family', async () => {
    const localStory = { id: 'semantic-regression', title: 'Semantic Regression', marker: 'before' } as unknown as Story;
    const issueFor = (atoms: string[]) => ({
      validator: 'SemanticRealizationJudge', issueCode: 'SEMANTIC_REALIZATION_MISSING',
      sceneId: 's1-3', taskId: 'task:event:ep1-u3:owner-event', severity: 'error',
      missingEvidenceAtoms: atoms,
      realizationFingerprint: `SEMANTIC_REALIZATION_MISSING::task:event:ep1-u3:owner-event::s1-3::${atoms.join(',')}`,
    });
    const initial: ContractRepairReport = { passed: false, blockingIssues: [issueFor(['semantic:3'])] };
    const regressed: ContractRepairReport = { passed: false, blockingIssues: [issueFor(['semantic:3', 'semantic:4'])] };
    const out = await runFinalContractRepair({
      story: localStory,
      initialReport: initial,
      handlers: [({ story: candidate }) => {
        (candidate as any).marker = 'regressed';
        return { story: candidate, changed: true };
      }],
      revalidate: async () => regressed,
      maxAttempts: 1,
      rejectIntroducedBlockingIssues: true,
    });
    expect((localStory as any).marker).toBe('before');
    expect(out.report).toEqual(initial);
  });

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

  it('records and budgets targeted LLM attempts even when no candidate commits', async () => {
    const issueKey = (await import('./finalContractRepair')).contractRepairIssueFingerprint(fail.blockingIssues[0]);
    const snapshots: Array<{ attemptedIssueKeys: string[] }> = [];
    let handlerCalls = 0;
    const out = await runFinalContractRepair({
      story,
      initialReport: fail,
      handlers: [({ story: candidate }) => {
        handlerCalls += 1;
        return { story: candidate, changed: false, attemptedIssueKeys: [issueKey] };
      }],
      revalidate: async () => fail,
      maxAttempts: 2,
      maxAttemptsPerIssue: 2,
      onRoundSnapshot: (snapshot) => { snapshots.push(snapshot); },
    });

    expect(out.passed).toBe(false);
    expect(handlerCalls).toBe(2);
    expect(snapshots).toHaveLength(2);
    expect(snapshots.every((snapshot) => snapshot.attemptedIssueKeys.includes(issueKey))).toBe(true);
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

  it('revalidates before charging and records before/after paths for replay', async () => {
    const localStory = {
      id: 'round-evidence',
      title: 'Round Evidence',
      episodes: [{ id: 'ep1', scenes: [{ id: 's1-1', beats: [{ id: 'b1', text: 'unsafe' }] }] }],
    } as unknown as Story;
    const snapshots: any[] = [];
    let revalidated = false;
    const out = await runFinalContractRepair({
      story: localStory,
      initialReport: {
        passed: false,
        blockingIssues: [{ validator: 'RouteContinuityValidator', type: 'unsafe_fallback_prose', sceneId: 's1-1', fieldPath: 'beats[0].text', message: 'unsafe' }],
      },
      handlers: [({ story: candidate, blockingIssues }) => {
        (candidate as any).episodes[0].scenes[0].beats[0].text = 'authored';
        return {
          story: candidate,
          changed: true,
          attemptedIssueKeys: blockingIssues.map((issue) => [
            issue.validator ?? '', issue.type ?? '', '', '', '', issue.sceneId ?? '', '', issue.fieldPath ?? '', issue.message ?? '',
          ].join('::')),
        };
      }],
      revalidate: async () => {
        revalidated = true;
        return pass;
      },
      onRoundSnapshot: (snapshot) => {
        expect(revalidated).toBe(true);
        snapshots.push(snapshot);
      },
      requireMutationEvidence: true,
    });
    expect(out.passed).toBe(true);
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0].changedFieldPaths).toContain('story.episodes[0].scenes[0].beats[0].text');
    expect(snapshots[0].clearedIssueKeys).toHaveLength(1);
  });

  it('fails loudly when a handler claims success without mutation evidence', async () => {
    await expect(runFinalContractRepair({
      story,
      initialReport: fail,
      handlers: [() => ({ story, changed: true })],
      revalidate: async () => fail,
      requireMutationEvidence: true,
    })).rejects.toThrow(/claimed success without changing/i);
  });

  it('rejects a repair candidate that introduces a new blocking fingerprint', async () => {
    const localStory = { id: 'transactional', title: 'Transactional', marker: 'original' } as unknown as Story;
    const introduced: ContractRepairReport = {
      passed: false,
      blockingIssues: [{ validator: 'NewValidator', sceneId: 's1-2', message: 'new blocker' }],
    };
    const out = await runFinalContractRepair({
      story: localStory,
      initialReport: fail,
      handlers: [({ story: candidate }) => {
        (candidate as any).marker = 'rejected';
        return { story: candidate, changed: true };
      }],
      revalidate: async () => introduced,
      maxAttempts: 1,
      rejectIntroducedBlockingIssues: true,
    });
    expect(out.passed).toBe(false);
    expect(out.report.blockingIssues).toEqual(fail.blockingIssues);
    expect(out.records).toHaveLength(0);
    expect((localStory as any).marker).toBe('original');
    expect(out.story).toBe(localStory);
  });

  it('rejects a repair candidate that loses a previously realized canonical anchor', async () => {
    const localStory = { id: 'anchor-loss', title: 'Anchor Loss', marker: 'realized' } as unknown as Story;
    const initial: ContractRepairReport = {
      passed: false,
      blockingIssues: [{ validator: 'TargetValidator', sceneId: 's1', message: 'target miss' }],
      warnings: [],
    };
    const regressed: ContractRepairReport = {
      passed: false,
      blockingIssues: initial.blockingIssues,
      warnings: [{
        validator: 'SemanticRealizationJudge',
        issueCode: 'SEMANTIC_REALIZATION_MISSING',
        taskId: 'task:anchor:1:4:protection:planting',
        contractId: 'anchor:1:4:protection',
        sceneId: 's1-3',
        severity: 'warning',
        message: 'The authored protection anchor is no longer planted.',
      }],
    };

    const out = await runFinalContractRepair({
      story: localStory,
      initialReport: initial,
      handlers: [({ story: candidate }) => {
        (candidate as any).marker = 'lossy rewrite';
        return { story: candidate, changed: true };
      }],
      revalidate: async () => regressed,
      maxAttempts: 1,
      rejectIntroducedBlockingIssues: true,
      rejectIntroducedWarnings: true,
    });

    expect((localStory as any).marker).toBe('realized');
    expect(out.report).toEqual(initial);
  });

  it('rejects only the offending handler and commits a safe sibling repair', async () => {
    const localStory = {
      id: 'handler-transactions',
      title: 'Handler Transactions',
      marker: 'original',
      repaired: false,
    } as unknown as Story;
    const introduced: ContractRepairReport = {
      passed: false,
      blockingIssues: [
        ...fail.blockingIssues,
        { validator: 'NewValidator', sceneId: 's1-2', message: 'new blocker' },
      ],
    };
    const out = await runFinalContractRepair({
      story: localStory,
      initialReport: fail,
      handlers: [
        ({ story: candidate }) => {
          (candidate as any).marker = 'lossy rewrite';
          return { story: candidate, changed: true };
        },
        ({ story: candidate }) => {
          (candidate as any).repaired = true;
          return { story: candidate, changed: true };
        },
      ],
      revalidate: async (candidate) => {
        if ((candidate as any).marker === 'lossy rewrite') return introduced;
        return (candidate as any).repaired ? pass : fail;
      },
      maxAttempts: 1,
      rejectIntroducedBlockingIssues: true,
      requireMutationEvidence: true,
    });
    expect(out.passed).toBe(true);
    expect(out.story).toBe(localStory);
    expect((localStory as any).marker).toBe('original');
    expect((localStory as any).repaired).toBe(true);
  });

  it('commits safe scene scopes when a batched sibling rewrite introduces a blocker', async () => {
    const localStory = {
      id: 'scene-transactions', title: 'Scene Transactions',
      episodes: [{ id: 'ep1', number: 1, scenes: [
        { id: 's1', beats: [{ id: 'b1', text: 'missing' }] },
        { id: 's2', beats: [{ id: 'b2', text: 'original' }] },
      ] }],
    } as unknown as Story;
    const issue1 = { validator: 'SemanticRealizationJudge', sceneId: 's1', message: 'first missing' };
    const issue2 = { validator: 'SemanticRealizationJudge', sceneId: 's2', message: 'second missing' };
    const initial: ContractRepairReport = { passed: false, blockingIssues: [issue1, issue2] };

    const out = await runFinalContractRepair({
      story: localStory,
      initialReport: initial,
      handlers: [({ story: candidate }) => {
        (candidate.episodes[0].scenes[0].beats[0] as any).text = 'fixed';
        (candidate.episodes[0].scenes[1].beats[0] as any).text = 'lossy';
        return {
          story: candidate,
          changed: true,
          atomicScopes: [
            { kind: 'scene', sceneId: 's1', episodeNumber: 1 },
            { kind: 'scene', sceneId: 's2', episodeNumber: 1 },
          ],
        };
      }],
      revalidate: async (candidate) => {
        const first = candidate.episodes[0].scenes[0].beats[0].text;
        const second = candidate.episodes[0].scenes[1].beats[0].text;
        const blockingIssues = [] as ContractRepairReport['blockingIssues'];
        if (first !== 'fixed') blockingIssues.push(issue1);
        if (second === 'lossy') blockingIssues.push({ validator: 'NewValidator', sceneId: 's2', message: 'new blocker' });
        else blockingIssues.push(issue2);
        return { passed: blockingIssues.length === 0, blockingIssues };
      },
      maxAttempts: 1,
      rejectIntroducedBlockingIssues: true,
      requireMutationEvidence: true,
    });

    expect(localStory.episodes[0].scenes[0].beats[0].text).toBe('fixed');
    expect(localStory.episodes[0].scenes[1].beats[0].text).toBe('original');
    expect(out.report.blockingIssues).toEqual([issue2]);
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

describe('buildChoicePayoffRematerializationHandler', () => {
  const makeStory = () => ({
    id: 'bite-me',
    episodes: [{
      id: 'ep1',
      number: 1,
      scenes: [{
        id: 's1-1',
        beats: [
          { id: 's1-1-b5', text: 'The last box waits.', nextBeatId: 's1-1-b6' },
          {
            id: 's1-1-b6',
            text: 'What do you unpack first?',
            isChoicePoint: true,
            nextSceneId: 's1-2',
            choices: [
              { id: 'c1', text: 'The framed photo.', nextBeatId: 's1-1-b6-payoff-1', outcomeTexts: { partial: 'You set the photo where morning light will find it.' } },
              { id: 'c2', text: 'The knives.', nextBeatId: 's1-1-b6-payoff-2', reactionText: 'Steel first; sentiment later.' },
            ],
          },
        ],
      }],
    }],
  }) as unknown as Story;

  const issues = [
    { type: 'broken_navigation', severity: 'error' as const, sceneId: 's1-1', beatId: 's1-1-b6', message: 'Choice "c1" routes to missing beat "s1-1-b6-payoff-1".' },
    { type: 'broken_navigation', severity: 'error' as const, sceneId: 's1-1', beatId: 's1-1-b6', message: 'Choice "c2" routes to missing beat "s1-1-b6-payoff-2".' },
  ];

  it('rebuilds dropped payoff beats from the choices own authored outcome prose (run 2026-07-16T03-12-37)', async () => {
    const target = makeStory();
    const { buildChoicePayoffRematerializationHandler } = await import('./finalContractRepair');
    const handler = buildChoicePayoffRematerializationHandler();
    const result = await handler({ story: target, blockingIssues: issues as never });
    expect(result.changed).toBe(true);
    expect(result.attemptedIssueKeys?.length).toBe(2);
    const beats = (target as unknown as { episodes: Array<{ scenes: Array<{ beats: Array<{ id: string; text: string; nextSceneId?: string; isChoicePayoff?: boolean }> }> }> })
      .episodes[0].scenes[0].beats;
    const p1 = beats.find((beat) => beat.id === 's1-1-b6-payoff-1');
    const p2 = beats.find((beat) => beat.id === 's1-1-b6-payoff-2');
    expect(p1?.text).toContain('morning light');
    expect(p2?.text).toContain('Steel first');
    expect(p1?.isChoicePayoff).toBe(true);
    // Choice point has no onward beat, so the payoff carries the scene handoff.
    expect(p1?.nextSceneId).toBe('s1-2');
  });

  it('ignores broken navigation that does not target a payoff beat', async () => {
    const { buildChoicePayoffRematerializationHandler } = await import('./finalContractRepair');
    const handler = buildChoicePayoffRematerializationHandler();
    const result = await handler({
      story: makeStory(),
      blockingIssues: [{ type: 'broken_navigation', severity: 'error', sceneId: 's1-1', message: 'Beat s1-1-b5 nextBeatId references non-existent beat: s1-1-b9.' }] as never,
    });
    expect(result.changed).toBe(false);
  });
});

describe('wall-clock deadline (r120 timeout root cause, 2026-07-19)', () => {
  it('exits gracefully with the current report when the deadline has passed — handlers never run', async () => {
    const { runFinalContractRepair } = await import('./finalContractRepair');
    let handlerRan = false;
    const report = {
      passed: false,
      blockingIssues: [{
        type: 'treatment_event_ledger_violation', severity: 'error',
        validator: 'TreatmentEventLedgerValidator', sceneId: 's1-3', message: 'unrepaired residue',
      }],
      warnings: [],
    };
    const outcome = await runFinalContractRepair({
      story: { episodes: [] } as never,
      initialReport: report as never,
      handlers: [async () => { handlerRan = true; return { changed: false }; }],
      revalidate: async () => report as never,
      maxAttempts: 3,
      deadlineAt: Date.now() - 1,
    });

    expect(outcome.deadlineExhausted).toBe(true);
    expect(outcome.attempts).toBe(0);
    expect(handlerRan).toBe(false);
    // The report survives intact for the caller's abort-time triage —
    // the whole point vs. the withTimeout race that discarded loop state.
    expect(outcome.report.blockingIssues).toHaveLength(1);
  });

  it('does not set deadlineExhausted when no deadline is configured', async () => {
    const { runFinalContractRepair } = await import('./finalContractRepair');
    const passing = { passed: true, blockingIssues: [], warnings: [] };
    const outcome = await runFinalContractRepair({
      story: { episodes: [] } as never,
      initialReport: passing as never,
      handlers: [],
      revalidate: async () => passing as never,
      maxAttempts: 3,
    });
    expect(outcome.deadlineExhausted).toBe(false);
  });
});
