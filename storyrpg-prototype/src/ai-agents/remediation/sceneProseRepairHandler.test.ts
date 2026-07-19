import { describe, expect, it, vi } from 'vitest';
import {
  buildSceneClusterRepairHandler,
  buildSceneProseRepairHandler,
  buildSceneRepairDirectorNotes,
  characterIntroductionIssuesCleared,
  selectSceneProseRepairs,
} from './sceneProseRepairHandler';
import { runFinalContractRepair, type ContractRepairReport } from './finalContractRepair';
import type { Story } from '../../types/story';
import type { Scene } from '../../types/story';

const SIGNATURE =
  'Two anchors, light then dark — the rooftop bar at sunset on night three where the Dusk Club locks into place and Kylie catches both men watching her; then Cișmigiu at 1am, eight seconds of fog, a shadow, a scream, and a rescue.';

const requiredBeatIssue = (sceneId: string, episodeNumber = 2) => ({
  type: 'treatment_fidelity_violation',
  severity: 'error',
  message: `Authored required beat is missing from the final prose of episode ${episodeNumber} scene "${sceneId}": "A strategy argument over the route sharpens the old hostility.". The authored turn must be dramatized on-page, not dropped or truncated.`,
  validator: 'RequiredBeatRealizationValidator',
  suggestion: 'Dramatize this authored beat on-page in its scene.',
  sceneId,
  episodeNumber,
});

const signatureIssue = (sceneId: string) => ({
  type: 'treatment_fidelity_violation',
  severity: 'error',
  message: `Signature device is missing from the final prose of episode 1 scene "${sceneId}": "${SIGNATURE}". The staged signature moment must be depicted, not summarized away.`,
  validator: 'SignatureDevicePresenceValidator',
  suggestion: 'Dramatize the signature device on-page in this scene.',
  sceneId,
  episodeNumber: 1,
});

function makeStory(): Story {
  return {
    id: 'st',
    title: 'T',
    episodes: [
      {
        id: 'ep-1', number: 1,
        scenes: [
          { id: 's1-4', name: 'Willow', beats: [{ id: 'b1', text: 'Kylie walks home through the park.' }, { id: 'b2', text: 'The night is quiet.' }] },
          {
            id: 'treatment-enc-1-1', name: 'Encounter', beats: [],
            encounter: {
              id: 'enc',
              phases: [{ beats: [{ id: 'p1', setupText: 'A sunset on the stoop, the door locks.', text: '' }] }],
              storylets: [
                { beats: [{ id: 'sv-1', text: 'Fog clings as she fumbles the key.' }] },
                { beats: [{ id: 'sp-1', text: 'A taxi blares; she dives in.' }] },
              ],
            },
          },
          { id: 'treatment-enc-1-2', name: 'Empty Encounter', beats: [], encounter: { id: 'enc2' } },
        ],
      },
      {
        id: 'ep-2', number: 2,
        scenes: [
          { id: 's2-1', name: 'Route', beats: [{ id: 'b1', text: 'They study the map in silence.' }] },
        ],
      },
    ],
  } as unknown as Story;
}

describe('selectSceneProseRepairs', () => {
  it('selects only prose-realization validators with a sceneId, grouped by scene', () => {
    const groups = selectSceneProseRepairs([
      requiredBeatIssue('s2-1'),
      signatureIssue('s1-4'),
      requiredBeatIssue('s2-1'), // second finding on same scene merges into the group
      { type: 'skill_plan_nonconformance', severity: 'error', validator: 'SkillPlanConformanceValidator', message: 'off-plan' }, // not prose-repairable
      { type: 'treatment_fidelity_violation', severity: 'error', validator: 'AuthoredEpisodeConformanceValidator', message: 'episode list mismatch' }, // fidelity but not prose
      { type: 'treatment_fidelity_violation', severity: 'error', validator: 'RequiredBeatRealizationValidator', message: 'no scene id' }, // missing sceneId
    ]);
    expect([...groups.keys()].sort()).toEqual(['s1-4', 's2-1']);
    expect(groups.get('s2-1')).toHaveLength(2);
  });

  it('accepts judge-confirmed scene_prose realization misses and refuses choice_reauthor (23-29-29 starvation)', () => {
    // bite-me_2026-07-14T23-29-29: s1-1/s1-3 SemanticRealizationJudge findings
    // were routed same_scene_retry but this handler's allowlist predated the
    // validator name, so the scenes were never rewritten across two rounds.
    const groups = selectSceneProseRepairs([
      {
        type: 'semantic_realization_violation',
        severity: 'error',
        message: 'missing: event:ep1-u1:semantic:1. Missing meaning(s): Kylie arrives in Bucharest with her luggage and an address.',
        validator: 'SemanticRealizationJudge',
        repairHandler: 'scene_prose',
        sceneId: 's1-1',
        episodeNumber: 1,
      },
      {
        type: 'semantic_realization_violation',
        severity: 'error',
        message: 'choice resolution missing',
        validator: 'SemanticRealizationJudge',
        repairHandler: 'choice_reauthor',
        sceneId: 's1-4',
        episodeNumber: 1,
      },
    ] as never);
    expect([...groups.keys()]).toEqual(['s1-1']);
  });

  it('does not route planning-register prose leaks to SceneCritic prose repair', () => {
    const groups = selectSceneProseRepairs([
      {
        type: 'planning_register_prose',
        severity: 'error',
        message: 'Planning-register instruction leaked into story content (Open the episode).',
        validator: 'PlanningRegisterLeakValidator',
        sceneId: 's1-4',
        episodeNumber: 1,
      },
    ]);

    expect([...groups.keys()]).toEqual([]);
  });

  it('leaves exact encounter outcome and metadata fields to their owning handlers', () => {
    const groups = selectSceneProseRepairs([
      {
        type: 'unsafe_fallback_prose', severity: 'error', validator: 'RouteContinuityValidator',
        sceneId: 'treatment-enc-1-1', fieldPath: 'encounter.description', message: 'unsafe description',
      },
      {
        type: 'unsafe_fallback_prose', severity: 'error', validator: 'RouteContinuityValidator',
        sceneId: 'treatment-enc-1-1',
        fieldPath: 'encounter.phases[0].beats[7].choices[0].outcomes.complicated.narrativeText',
        message: 'unsafe outcome',
      },
      {
        type: 'unsafe_fallback_prose', severity: 'error', validator: 'RouteContinuityValidator',
        sceneId: 'treatment-enc-1-1', fieldPath: 'readerFacing[94]', message: 'projected duplicate',
      },
    ] as never);
    expect([...groups.keys()]).toEqual([]);
  });

  it('caps the number of scenes per round but keeps extra findings for capped scenes', () => {
    const groups = selectSceneProseRepairs(
      [requiredBeatIssue('a'), requiredBeatIssue('b'), requiredBeatIssue('c'), requiredBeatIssue('a')],
      2,
    );
    expect([...groups.keys()]).toEqual(['a', 'b']);
    expect(groups.get('a')).toHaveLength(2);
  });
});

describe('buildSceneRepairDirectorNotes', () => {
  it('includes each finding message and suggestion, and the on-page dramatization instruction', () => {
    const notes = buildSceneRepairDirectorNotes([requiredBeatIssue('s2-1')]);
    expect(notes).toContain('strategy argument over the route');
    expect(notes).toContain('Dramatize this authored beat on-page');
    expect(notes).toContain('ON-PAGE');
    expect(notes).toContain('Keep beat ids');
  });

  it('routes forbidden ending findings as removals while preserving protagonist ownership', () => {
    const notes = buildSceneRepairDirectorNotes([{
      validator: 'SemanticRealizationJudge',
      message: 'Canonical realization validation confirms forbidden evidence: the final emotional beat belongs to the new threat and displaces the protagonist.',
      matchedForbiddenAtoms: ['escalation-budget:ep1:ending-displaced'],
    }] as never);

    expect(notes).toContain('FORBIDDEN REALIZATION TARGET');
    expect(notes).toContain('remove that proposition');
    expect(notes).toContain('do not replace the forbidden material with a different surprise, threat, reveal, arrival, message, or codename');
    expect(notes).toContain('ENDING OWNERSHIP');
    expect(notes).toContain('protagonist');
  });
});

describe('buildSceneProseRepairHandler', () => {
  it('returns changed:false when there are no repairable findings', async () => {
    const critic = { execute: vi.fn() };
    const handler = buildSceneProseRepairHandler({ critic: () => critic as never });
    const story = makeStory();
    const result = await handler({ story, blockingIssues: [{ type: 'empty_scene', severity: 'error', message: 'x' }] });
    expect(result.changed).toBe(false);
    expect(critic.execute).not.toHaveBeenCalled();
  });

  it('rewrites the named scene via SceneCritic and merges beats into the story', async () => {
    const critic = {
      execute: vi.fn().mockResolvedValue({
        success: true,
        data: {
          sceneId: 's2-1',
          rewrittenBeats: [{ id: 'b1', text: 'A strategy argument over the route sharpens the old hostility.' }],
          critiqueNotes: [],
          overallCommentary: '',
        },
      }),
    };
    const handler = buildSceneProseRepairHandler({ critic: () => critic as never });
    const story = makeStory();
    const result = await handler({ story, blockingIssues: [requiredBeatIssue('s2-1')] });

    expect(result.changed).toBe(true);
    expect(critic.execute).toHaveBeenCalledTimes(1);
    const callArg = critic.execute.mock.calls[0][0];
    expect(callArg.scene.sceneId).toBe('s2-1');
    expect(callArg.directorNotes).toContain('strategy argument');
    expect((story as any).episodes[1].scenes[0].beats[0].text).toContain('strategy argument over the route');
    expect(result.record).toMatchObject({ rule: 'final_contract_scene_prose', scope: 'scene', succeeded: true });
  });

  it('marks only the closest beat for a semantic realization repair', async () => {
    const critic = {
      execute: vi.fn().mockResolvedValue({
        success: true,
        data: {
          sceneId: 's1-4',
          rewrittenBeats: [{ id: 'b1', text: 'Kylie arrives in Bucharest and walks home through the park.' }],
          critiqueNotes: [],
          overallCommentary: '',
        },
      }),
    };
    const story = makeStory();
    const handler = buildSceneProseRepairHandler({ critic: () => critic as never });
    await handler({
      story,
      blockingIssues: [{
        type: 'semantic_realization_violation', severity: 'error', validator: 'SemanticRealizationJudge',
        repairHandler: 'scene_prose', sceneId: 's1-4', episodeNumber: 1,
        message: 'Canonical realization is missing. Missing meaning(s): Kylie arrives in Bucharest.',
      }] as never,
    });
    expect(critic.execute.mock.calls[0][0].flaggedBeatIds).toEqual(['b1']);
    expect(critic.execute.mock.calls[0][0].directorNotes).toContain('Every unflagged beat is locked');
  });

  it('parses the canonical meaning(s) label and targets the beat closest to that proposition', async () => {
    const critic = {
      execute: vi.fn().mockResolvedValue({
        success: true,
        data: {
          sceneId: 's1-3',
          rewrittenBeats: [{ id: 'b2', text: 'Stela offers her number, and you save it before agreeing to meet tomorrow as friends.' }],
          critiqueNotes: [],
          overallCommentary: '',
        },
      }),
    };
    const story = makeStory();
    (story as any).episodes[0].scenes.push({
      id: 's1-3',
      name: 'Bookshop',
      beats: [
        { id: 'b1', text: 'The shop bell settles behind you.' },
        { id: 'b2', text: 'Stela smiles and asks what brought you to Bucharest.' },
      ],
    });
    const handler = buildSceneProseRepairHandler({ critic: () => critic as never, protagonistName: 'Kylie' });

    await handler({
      story,
      blockingIssues: [{
        type: 'semantic_realization_violation', severity: 'error', validator: 'SemanticRealizationJudge',
        repairHandler: 'scene_prose', sceneId: 's1-3', episodeNumber: 1,
        message: 'Canonical realization is missing. Missing meaning(s): Stela befriends Kylie..',
      }] as never,
    });

    expect(critic.execute.mock.calls[0][0].flaggedBeatIds).toEqual(['b2']);
    expect(critic.execute.mock.calls[0][0].directorNotes).toContain('SEMANTIC REALIZATION TARGET: Stela befriends Kylie.');
    expect(critic.execute.mock.calls[0][0].directorNotes).toContain('RELATIONSHIP TRANSITION');
    expect(critic.execute.mock.calls[0][0].directorNotes).toContain('friend/friendship');
    expect(critic.execute.mock.calls[0][0].directorNotes).toContain('semantic superset');
    expect(critic.execute.mock.calls[0][0].appendOnlyBeatIds).toEqual(['b2']);
  });

  it('targets the closest beat for each missing semantic meaning', async () => {
    const critic = {
      execute: vi.fn().mockResolvedValue({
        success: true,
        data: {
          sceneId: 's1-3',
          rewrittenBeats: [
            { id: 'b2', text: 'Stela offers her number, and you both agree to meet tomorrow as friends.' },
            { id: 'b3', text: 'Stela invites you into the secret nightlife of Valescu Club tonight.' },
          ],
          critiqueNotes: [],
          overallCommentary: '',
        },
      }),
    };
    const story = makeStory();
    (story as any).episodes[0].scenes.push({
      id: 's1-3', name: 'Bookshop', beats: [
        { id: 'b1', text: 'The shop bell settles behind you.' },
        { id: 'b2', text: 'Stela smiles and asks what brought you to Bucharest.' },
        { id: 'b3', text: 'Stela asks whether you have heard of Valescu Club.' },
      ],
    });
    const handler = buildSceneProseRepairHandler({ critic: () => critic as never, protagonistName: 'Kylie' });
    await handler({
      story,
      blockingIssues: [{
        type: 'semantic_realization_violation', severity: 'error', validator: 'SemanticRealizationJudge',
        repairHandler: 'scene_prose', sceneId: 's1-3', episodeNumber: 1,
        message: 'Canonical realization is missing. Missing meaning(s): Stela befriends Kylie.; Stela introduces Kylie to the secret nightlife world of Valescu Club..',
      }] as never,
    });
    expect(critic.execute.mock.calls[0][0].flaggedBeatIds).toEqual(['b2', 'b3']);
    expect(critic.execute.mock.calls[0][0].appendOnlyBeatIds).toEqual(['b2', 'b3']);
  });

  it('honors pacing labels while asking for behavioral semantic realization', async () => {
    const notes = buildSceneRepairDirectorNotes([{
      validator: 'SemanticRealizationJudge',
      message: 'Missing meaning(s): Rowan befriends the protagonist.',
    }], '', [{ blockedLabels: ['friend', 'best friend'] }] as never);
    expect(notes).toContain('concrete reciprocal action');
    expect(notes).toContain('forbids settled labels');
    expect(notes).not.toContain('Lexically ground the requested state');
  });

  it('rejects an unflagged semantic rewrite and retries with the required beat id', async () => {
    const critic = {
      execute: vi.fn()
        .mockResolvedValueOnce({
          success: true,
          data: { sceneId: 's1-3', rewrittenBeats: [{ id: 'b1', text: 'Unrelated doorway prose.' }], critiqueNotes: [], overallCommentary: '' },
        })
        .mockResolvedValueOnce({
          success: true,
          data: { sceneId: 's1-3', rewrittenBeats: [{ id: 'b2', text: 'Stela offers her number; you save it, and both of you agree to meet for coffee tomorrow.' }], critiqueNotes: [], overallCommentary: '' },
        }),
    };
    const story = makeStory();
    (story as any).episodes[0].scenes.push({
      id: 's1-3', name: 'Bookshop', beats: [
        { id: 'b1', text: 'The door closes behind you.' },
        { id: 'b2', text: 'Stela smiles and asks what brought you here.' },
      ],
    });
    const emitted: string[] = [];
    const handler = buildSceneProseRepairHandler({
      critic: () => critic as never,
      protagonistName: 'Kylie',
      emit: (message) => emitted.push(message),
    });
    const result = await handler({
      story,
      blockingIssues: [{
        type: 'semantic_realization_violation', severity: 'error', validator: 'SemanticRealizationJudge',
        repairHandler: 'scene_prose', sceneId: 's1-3', episodeNumber: 1,
        message: 'Canonical realization is missing. Missing meaning(s): Stela befriends Kylie..',
      }] as never,
    });
    expect(critic.execute).toHaveBeenCalledTimes(2);
    expect(emitted.join(' ')).toContain('unflagged beat id(s): b1');
    expect((story as any).episodes[0].scenes.at(-1).beats[0].text).toBe('The door closes behind you.');
    expect((story as any).episodes[0].scenes.at(-1).beats[1].text).toContain('agree to meet for coffee');
    expect(result.attemptedIssueKeys).toHaveLength(1);
  });

  it('restores a rewrite and reports no progress when the authored moment still will not clear', async () => {
    const critic = {
      execute: vi.fn().mockResolvedValue({
        success: true,
        data: {
          sceneId: 's2-1',
          rewrittenBeats: [{ id: 'b1', text: 'They keep studying the map in guarded silence.' }],
          critiqueNotes: [],
          overallCommentary: '',
        },
      }),
    };
    const handler = buildSceneProseRepairHandler({ critic: () => critic as never });
    const story = makeStory();
    const original = (story as any).episodes[1].scenes[0].beats[0].text;
    const emitted: string[] = [];
    const handlerWithEmit = buildSceneProseRepairHandler({
      critic: () => critic as never,
      emit: (message) => emitted.push(message),
      allowRequiredBeatFallback: () => false,
      requirePredictedClear: true,
    });

    const result = await handlerWithEmit({ story, blockingIssues: [requiredBeatIssue('s2-1')] });

    expect(result.changed).toBe(false);
    expect(critic.execute).toHaveBeenCalledTimes(2);
    expect((story as any).episodes[1].scenes[0].beats[0].text).toBe(original);
    expect(emitted.join('\n')).toContain('restored s2-1');
    expect(result.attemptedIssueKeys).toHaveLength(1);
  });

  it('r116 gap analysis (2026-07-18): restores a rewrite instead of falsely declaring a SemanticRealizationJudge forbidden-evidence finding cleared', async () => {
    // Live regression: bite-me-r116_2026-07-18T14-51-12. An escalation-budget
    // forbidden-evidence finding ("Canonical realization validation confirms
    // forbidden evidence...") has no quoted moment to extract — before this
    // fix, any SemanticRealizationJudge finding with no extractable moment
    // fell through to `!MOMENT_REALIZATION_VALIDATORS.has(...)`, which is
    // vacuously true (SemanticRealizationJudge was never in that set), so
    // the very first rewrite attempt was declared "predicted clear" whether
    // or not it actually removed the forbidden content — skipping the
    // sharpened-feedback retry and, under requirePredictedClear, keeping a
    // rewrite that never fixed anything. The real content still had the
    // forbidden evidence at final regression, but the repair loop had
    // already (wrongly) moved on.
    const critic = {
      execute: vi.fn().mockResolvedValue({
        success: true,
        data: {
          sceneId: 's1-4',
          // A rewrite that doesn't remove anything meaningful — stands in
          // for a rewrite that fails to clear the forbidden evidence.
          rewrittenBeats: [{ id: 'b1', text: 'Kylie walks home through the quiet park once more.' }],
          critiqueNotes: [],
          overallCommentary: '',
        },
      }),
    };
    const story = makeStory();
    const original = (story as any).episodes[0].scenes[0].beats[0].text;
    const emitted: string[] = [];
    const handler = buildSceneProseRepairHandler({
      critic: () => critic as never,
      emit: (message) => emitted.push(message),
      allowRequiredBeatFallback: () => false,
      requirePredictedClear: true,
    });

    const result = await handler({
      story,
      blockingIssues: [{
        type: 'semantic_realization_violation', severity: 'error', validator: 'SemanticRealizationJudge',
        repairHandler: 'scene_prose', sceneId: 's1-4', episodeNumber: 1,
        message: 'Canonical realization validation confirms forbidden evidence for task task:escalation-budget:ep1: escalation-budget:ep1:ending-displaced.',
      }] as never,
    });

    expect(result.changed).toBe(false);
    expect((story as any).episodes[0].scenes[0].beats[0].text).toBe(original);
    expect(emitted.join('\n')).toContain('restored s1-4');
  });

  it('allows the final-contract caller to defer an interpretive forbidden verdict to canonical revalidation', async () => {
    const critic = {
      execute: vi.fn().mockResolvedValue({
        success: true,
        data: {
          sceneId: 's1-4',
          rewrittenBeats: [{ id: 'b1', text: 'Kylie closes the laptop on her own terms and lets the silence answer her.' }],
          critiqueNotes: [],
          overallCommentary: '',
        },
      }),
    };
    const story = makeStory();
    const handler = buildSceneProseRepairHandler({
      critic: () => critic as never,
      requirePredictedClear: true,
      deferSemanticPredictionToCanonicalRevalidation: true,
    });

    const result = await handler({
      story,
      blockingIssues: [{
        type: 'semantic_realization_violation', severity: 'error', validator: 'SemanticRealizationJudge',
        repairHandler: 'scene_prose', sceneId: 's1-4', episodeNumber: 1,
        message: 'Canonical realization validation confirms forbidden evidence for the ending.',
        matchedForbiddenAtoms: ['escalation-budget:ep1:ending-displaced'],
      }] as never,
    });

    expect(result.changed).toBe(true);
    expect((story as any).episodes[0].scenes[0].beats[0].text).toContain('on her own terms');
  });

  it('commits a deferred semantic rewrite only when canonical revalidation clears the finding', async () => {
    const issue = {
      type: 'semantic_realization_violation', severity: 'error', validator: 'SemanticRealizationJudge',
      issueCode: 'SEMANTIC_FORBIDDEN_EVIDENCE_PRESENT', taskId: 'task:escalation-budget:ep1',
      repairHandler: 'scene_prose', sceneId: 's1-4', episodeNumber: 1,
      message: 'Canonical realization validation confirms forbidden evidence for the ending.',
      matchedForbiddenAtoms: ['escalation-budget:ep1:ending-displaced'],
    };
    const initialReport: ContractRepairReport = { passed: false, blockingIssues: [issue] };
    const critic = {
      execute: vi.fn().mockResolvedValue({
        success: true,
        data: {
          sceneId: 's1-4',
          rewrittenBeats: [{ id: 'b1', text: 'Kylie closes the laptop on her own terms and lets the silence answer her.' }],
          critiqueNotes: [],
          overallCommentary: '',
        },
      }),
    };
    const story = makeStory();
    const handler = buildSceneProseRepairHandler({
      critic: () => critic as never,
      requirePredictedClear: true,
      deferSemanticPredictionToCanonicalRevalidation: true,
    });

    const outcome = await runFinalContractRepair({
      story,
      initialReport,
      handlers: [handler],
      revalidate: async (candidate) => (candidate.episodes[0].scenes[0].beats[0].text.includes('on her own terms')
        ? { passed: true, blockingIssues: [] }
        : initialReport),
      maxAttempts: 1,
      rejectIntroducedBlockingIssues: true,
      rejectNoBlockingProgress: true,
    });

    expect(outcome.passed).toBe(true);
    expect(story.episodes[0].scenes[0].beats[0].text).toContain('on her own terms');
  });

  it('rolls back a deferred semantic rewrite when canonical revalidation does not improve the finding', async () => {
    const issue = {
      type: 'semantic_realization_violation', severity: 'error', validator: 'SemanticRealizationJudge',
      issueCode: 'SEMANTIC_FORBIDDEN_EVIDENCE_PRESENT', taskId: 'task:escalation-budget:ep1',
      repairHandler: 'scene_prose', sceneId: 's1-4', episodeNumber: 1,
      message: 'Canonical realization validation confirms forbidden evidence for the ending.',
      matchedForbiddenAtoms: ['escalation-budget:ep1:ending-displaced'],
    };
    const initialReport: ContractRepairReport = { passed: false, blockingIssues: [issue] };
    const critic = {
      execute: vi.fn().mockResolvedValue({
        success: true,
        data: {
          sceneId: 's1-4',
          rewrittenBeats: [{ id: 'b1', text: 'A different threat claims the final sentence.' }],
          critiqueNotes: [],
          overallCommentary: '',
        },
      }),
    };
    const story = makeStory();
    const original = story.episodes[0].scenes[0].beats[0].text;
    const handler = buildSceneProseRepairHandler({
      critic: () => critic as never,
      requirePredictedClear: true,
      deferSemanticPredictionToCanonicalRevalidation: true,
    });

    const outcome = await runFinalContractRepair({
      story,
      initialReport,
      handlers: [handler],
      revalidate: async () => initialReport,
      maxAttempts: 1,
      rejectIntroducedBlockingIssues: true,
      rejectNoBlockingProgress: true,
    });

    expect(outcome.passed).toBe(false);
    expect(story.episodes[0].scenes[0].beats[0].text).toBe(original);
  });

  it('runs a second repair-loop candidate after the first deferred semantic rewrite is rolled back', async () => {
    const issue = {
      type: 'semantic_realization_violation', severity: 'error', validator: 'SemanticRealizationJudge',
      issueCode: 'SEMANTIC_FORBIDDEN_EVIDENCE_PRESENT', taskId: 'task:escalation-budget:ep1',
      repairHandler: 'scene_prose', sceneId: 's1-4', episodeNumber: 1,
      message: 'Canonical realization validation confirms forbidden evidence for the ending.',
      matchedForbiddenAtoms: ['escalation-budget:ep1:ending-displaced'],
    };
    const initialReport: ContractRepairReport = { passed: false, blockingIssues: [issue] };
    const critic = {
      execute: vi.fn()
        .mockResolvedValueOnce({
          success: true,
          data: { sceneId: 's1-4', rewrittenBeats: [{ id: 'b1', text: 'A different threat claims the final sentence.' }], critiqueNotes: [], overallCommentary: '' },
        })
        .mockResolvedValueOnce({
          success: true,
          data: { sceneId: 's1-4', rewrittenBeats: [{ id: 'b1', text: 'Kylie closes the laptop on her own terms and lets the silence answer her.' }], critiqueNotes: [], overallCommentary: '' },
        }),
    };
    const story = makeStory();
    const handler = buildSceneProseRepairHandler({
      critic: () => critic as never,
      requirePredictedClear: true,
      deferSemanticPredictionToCanonicalRevalidation: true,
    });

    const outcome = await runFinalContractRepair({
      story,
      initialReport,
      handlers: [handler],
      revalidate: async (candidate) => candidate.episodes[0].scenes[0].beats[0].text.includes('on her own terms')
        ? { passed: true, blockingIssues: [] }
        : initialReport,
      maxAttempts: 2,
      maxAttemptsPerIssue: 2,
      rejectIntroducedBlockingIssues: true,
      rejectNoBlockingProgress: true,
    });

    expect(critic.execute).toHaveBeenCalledTimes(2);
    expect(outcome.passed).toBe(true);
    expect(story.episodes[0].scenes[0].beats[0].text).toContain('on her own terms');
  });

  it('repairs an ENCOUNTER scene: rewrites encounter phase/storylet prose and merges it back', async () => {
    const critic = {
      execute: vi.fn().mockResolvedValue({
        success: true,
        data: {
          sceneId: 'treatment-enc-1-1',
          rewrittenBeats: [
            { id: 'p1', text: 'The rooftop bar locks into place at sunset; Kylie catches both men watching her.' },
            { id: 'sv-1', text: 'Cișmigiu at 1am: eight seconds of fog, a shadow, a scream, a rescue.' },
          ],
          critiqueNotes: [],
          overallCommentary: '',
        },
      }),
    };
    const handler = buildSceneProseRepairHandler({ critic: () => critic as never });
    const story = makeStory();
    const result = await handler({ story, blockingIssues: [signatureIssue('treatment-enc-1-1')] });

    expect(result.changed).toBe(true);
    expect(critic.execute).toHaveBeenCalledTimes(1);
    // SceneCritic saw the flattened encounter prose beats (by their real ids).
    const beatIds = critic.execute.mock.calls[0][0].scene.beats.map((b: { id: string }) => b.id);
    expect(beatIds).toEqual(['p1', 'sv-1', 'sp-1']);
    // Phase prose merged to setupText; storylet prose merged to text.
    const enc = (story as any).episodes[0].scenes[1].encounter;
    expect(enc.phases[0].beats[0].setupText).toContain('rooftop bar');
    expect(enc.storylets[0].beats[0].text).toContain('Cișmigiu');
    expect(result.record).toMatchObject({ rule: 'final_contract_scene_prose', succeeded: true });
  });

  it('skips an encounter scene with no rewritable prose and reports changed:false', async () => {
    const critic = { execute: vi.fn() };
    const handler = buildSceneProseRepairHandler({ critic: () => critic as never });
    const story = makeStory();
    const result = await handler({ story, blockingIssues: [signatureIssue('treatment-enc-1-2')] });
    expect(result.changed).toBe(false);
    expect(critic.execute).not.toHaveBeenCalled();
  });

  // A finding whose message QUOTES the authored moment (the real validator shape) —
  // lets the handler predict clearance with the local scoring mirror.
  const momentIssue = (sceneId: string, episodeNumber: number, moment: string) => ({
    type: 'treatment_fidelity_violation',
    severity: 'error',
    message: `Authored required beat is missing from the final prose of episode ${episodeNumber} scene "${sceneId}": "${moment}". The authored turn must be dramatized on-page, not dropped or truncated.`,
    validator: 'RequiredBeatRealizationValidator',
    suggestion: 'Dramatize this authored beat on-page in its scene.',
    sceneId,
    episodeNumber,
  });
  const MOMENT = 'Kylie posts the rooftop story to the blog before dawn while Mika watches the stairwell.';
  const NOTICER_SPLINTERS = "Kylie's 'noticer' instinct collects unsettling splinters: Ileana crying in the powder room, a mantle photograph that seems to omit Victor, Mika's unexplained missing hour, and a guest who knows the Marinescu maiden name.";
  const sceneTurnIssue = (sceneId: string, episodeNumber: number, moment: string) => ({
    type: 'scene_turn_realization_violation',
    severity: 'error',
    message: `Scene "${sceneId}" does not dramatize its central turn on-page: "${moment}".`,
    validator: 'SceneTurnRealizationValidator',
    suggestion: 'Generate reader-facing scene prose that establishes, dramatizes, and follows through on the scene turn.',
    sceneId,
    episodeNumber,
  });

  it('verifies the merge against the scoring mirror and retries ONCE with the still-missing checklist', async () => {
    const critic = {
      execute: vi.fn()
        // Attempt 1: fluent but incomplete — misses blog/dawn/Mika/stairwell.
        .mockResolvedValueOnce({
          success: true,
          data: { sceneId: 's2-1', rewrittenBeats: [{ id: 'b1', text: 'Kylie posts the rooftop story.' }], critiqueNotes: [], overallCommentary: '' },
        })
        // Attempt 2: full dramatization.
        .mockResolvedValueOnce({
          success: true,
          data: { sceneId: 's2-1', rewrittenBeats: [{ id: 'b1', text: 'Kylie posts the rooftop story to the blog before dawn while Mika watches the stairwell.' }], critiqueNotes: [], overallCommentary: '' },
        }),
    };
    const handler = buildSceneProseRepairHandler({ critic: () => critic as never });
    const story = makeStory();
    const result = await handler({ story, blockingIssues: [momentIssue('s2-1', 2, MOMENT)] });

    expect(critic.execute).toHaveBeenCalledTimes(2);
    // The retry's director notes name the words still missing after attempt 1
    // (the checklist line, not the quoted finding which always carries the moment).
    const retryNotes: string = critic.execute.mock.calls[1][0].directorNotes;
    const checklist = retryNotes.split('\n').find((l: string) => l.includes('NON-NEGOTIABLE')) ?? '';
    expect(checklist).toContain('blog');
    expect(checklist).toContain('stairwell');
    expect(checklist).not.toContain('rooftop'); // already landed in attempt 1
    expect(result.changed).toBe(true);
    expect(result.record).toMatchObject({ succeeded: true, attempts: 2 });
    expect((story as any).episodes[1].scenes[0].beats[0].text).toContain('stairwell');
  });

  it('requires active planned Story Circle moments to clear before accepting a rewrite', async () => {
    const reportedMoment = 'Avery opens the locked side door for Mara.';
    const plannedMoment = 'Mara pockets the brass key before crossing the threshold.';
    const critic = {
      execute: vi.fn().mockResolvedValue({
        success: true,
        data: {
          sceneId: 's2-1',
          rewrittenBeats: [{ id: 'b1', text: 'Avery opens the locked side door for Mara.' }],
          critiqueNotes: [],
          overallCommentary: '',
        },
      }),
    };
    const emitted: string[] = [];
    const handler = buildSceneProseRepairHandler({
      critic: () => critic as never,
      emit: (message) => emitted.push(message),
      plannedMomentSources: new Map([[
        's2-1',
        {
          storyCircleBeatContracts: [{
            beat: 'you',
            sourceText: plannedMoment,
            requiredRealization: ['scene_turn', 'final_prose'],
          }],
        },
      ]]),
      requirePredictedClear: true,
    });
    const story = makeStory();
    const original = (story as any).episodes[1].scenes[0].beats[0].text;

    const result = await handler({
      story,
      blockingIssues: [momentIssue('s2-1', 2, reportedMoment)],
    });

    expect(result.changed).toBe(false);
    expect(critic.execute).toHaveBeenCalledTimes(2);
    expect(critic.execute.mock.calls[0][0].directorNotes).toContain('ACTIVE PLANNED MOMENTS');
    expect(critic.execute.mock.calls[0][0].directorNotes).toContain('brass key');
    expect((story as any).episodes[1].scenes[0].beats[0].text).toBe(original);
    expect(emitted.join('\n')).toContain('restored s2-1');
  });

  it('carries previously repaired authored moments into later repair notes for the same scene', async () => {
    const firstMoment = 'Kylie opens the blue door with the brass key before dawn.';
    const secondMoment = 'Mika waits on the landing with a folded club invitation.';
    const critic = {
      execute: vi.fn()
        .mockResolvedValueOnce({
          success: true,
          data: { sceneId: 's2-1', rewrittenBeats: [{ id: 'b1', text: firstMoment }], critiqueNotes: [], overallCommentary: '' },
        })
        .mockResolvedValueOnce({
          success: true,
          data: { sceneId: 's2-1', rewrittenBeats: [{ id: 'b1', text: `${firstMoment} ${secondMoment}` }], critiqueNotes: [], overallCommentary: '' },
        }),
    };
    const handler = buildSceneProseRepairHandler({ critic: () => critic as never });
    const story = makeStory();

    await handler({ story, blockingIssues: [momentIssue('s2-1', 2, firstMoment)] });
    await handler({ story, blockingIssues: [momentIssue('s2-1', 2, secondMoment)] });

    const secondNotes: string = critic.execute.mock.calls[1][0].directorNotes;
    expect(secondNotes).toContain(firstMoment);
    expect(secondNotes).toContain(secondMoment);
    expect((story as any).episodes[1].scenes[0].beats[0].text).toContain(firstMoment);
    expect((story as any).episodes[1].scenes[0].beats[0].text).toContain(secondMoment);
  });

  it('appends a required-beat fallback when SceneCritic keeps omitting Bite Me blog-orbit tokens', async () => {
    const biteMeMoment = "Kylie publishes the pre-weekend post, planting the blog squarely in Victor's orbit before leaving the city.";
    const partial = [
      "His fussiness isn't what has you on edge. Your apartment smelled of stale coffee and ozone from the laptop.",
      'You remember the decisive click of publishing the post. It was aimed like a torpedo at this very house.',
    ].join(' ');
    const critic = {
      execute: vi.fn().mockResolvedValue({
        success: true,
        data: { sceneId: 's2-1', rewrittenBeats: [{ id: 'b1', text: partial }], critiqueNotes: [], overallCommentary: '' },
      }),
    };
    const handler = buildSceneProseRepairHandler({ critic: () => critic as never });
    const story = makeStory();
    const result = await handler({ story, blockingIssues: [momentIssue('s2-1', 2, biteMeMoment)] });
    const text = (story as any).episodes[1].scenes[0].beats[0].text;

    expect(critic.execute).toHaveBeenCalledTimes(2);
    expect(text).toContain("blog squarely in Victor's orbit");
    expect(text).toContain('before leaving the city');
    expect(result.changed).toBe(true);
    expect(result.record).toMatchObject({ succeeded: true, degraded: false, attempts: 2 });
  });

  it('appends the full required beat when a stylish paraphrase still omits validator-critical words', async () => {
    const appetiteMoment = "That her job is to observe and describe other people's lives, ordering second and writing the piece later, rather than claiming her own appetite.";
    const paraphrase = [
      'The tremor in your hand feels alien, a twitch you can only observe.',
      'Always watching, tasting second-hand, curating an appetite for others.',
      'Always describing the meal, never taking the first bite yourself.',
    ].join(' ');
    const critic = {
      execute: vi.fn().mockResolvedValue({
        success: true,
        data: { sceneId: 's2-1', rewrittenBeats: [{ id: 'b1', text: paraphrase }], critiqueNotes: [], overallCommentary: '' },
      }),
    };
    const handler = buildSceneProseRepairHandler({ critic: () => critic as never });
    const story = makeStory();
    const result = await handler({ story, blockingIssues: [momentIssue('s2-1', 2, appetiteMoment)] });
    const text = (story as any).episodes[1].scenes[0].beats[0].text;

    expect(critic.execute).toHaveBeenCalledTimes(2);
    expect(text).toContain('ordering second');
    expect(text).toContain('writing the piece later');
    expect(text).toContain('claiming her own appetite');
    expect(result.changed).toBe(true);
    expect(result.record).toMatchObject({ succeeded: true, degraded: false, attempts: 2 });
  });

  it('keeps an appended required-beat fallback when a later cluster rewrite touches the same scene', async () => {
    const moment = 'Three terrible dates provide blog material, while Mika pushes Kylie to finally visit Vâlcescu Club.';
    const story = makeStory() as any;
    story.episodes[1].scenes = [
      { id: 's2-1', name: 'Before', beats: [{ id: 's2-1-b1', text: 'The apartment is all phone glow and coffee.' }] },
      { id: 's2-2', name: 'Dates', beats: [{ id: 's2-2-b1', text: 'Mika taps the invitation and mentions Vâlcescu Club.' }] },
      { id: 's2-3', name: 'After', beats: [{ id: 's2-3-b1', text: 'The street outside is wet with reflected neon.' }] },
    ];
    const proseCritic = {
      execute: vi.fn().mockResolvedValue({
        success: true,
        data: {
          sceneId: 's2-2',
          rewrittenBeats: [{ id: 's2-2-b1', text: 'Mika pushes Kylie to finally visit Vâlcescu Club.' }],
          critiqueNotes: [],
          overallCommentary: '',
        },
      }),
    };
    const clusterCritic = {
      execute: vi.fn().mockImplementation(async ({ scene }: { scene: { sceneId: string; beats: Array<{ id?: string }> } }) => ({
        success: true,
        data: {
          sceneId: scene.sceneId,
          rewrittenBeats: scene.beats.map((beat) => ({
            id: beat.id,
            text: scene.sceneId === 's2-2'
              ? 'Inside the club, Mika points out the velvet rope and tells you to smile.'
              : 'The transition stays grounded.',
          })),
          critiqueNotes: [],
          overallCommentary: '',
        },
      })),
    };
    const requiredIssue = momentIssue('s2-2', 2, moment);
    const turnIssue = sceneTurnIssue('s2-2', 2, moment);

    await buildSceneProseRepairHandler({ critic: () => proseCritic as never })({
      story,
      blockingIssues: [requiredIssue, turnIssue],
    });
    expect(story.episodes[1].scenes[1].beats[0].text).toContain('Three terrible dates provide blog material');

    const clusterResult = await buildSceneClusterRepairHandler({ critic: () => clusterCritic as never })({
      story,
      blockingIssues: [requiredIssue, turnIssue],
    });

    expect(clusterResult.changed).toBe(true);
    expect(story.episodes[1].scenes[1].beats[0].text).toContain('Three terrible dates provide blog material');
    expect(story.episodes[1].scenes[1].beats[0].text).toContain('Mika pushes Kylie to finally visit Vâlcescu Club');
  });

  it('preserves locked planned prose deterministically after a cluster rewrite drops it', async () => {
    const lockedMoment =
      'Kylie watches the blog dashboard tick from 84K to 92K while the draft says Three Dates and a Tow Truck.';
    const newMoment =
      'Mika calls from the stairwell and says the viral post has put Victor on a stage.';
    const story = makeStory() as any;
    story.episodes[1].scenes = [
      { id: 's2-1', name: 'Blog Cold Open', beats: [{ id: 's2-1-b1', text: lockedMoment }] },
    ];
    const critic = {
      execute: vi.fn().mockResolvedValue({
        success: true,
        data: {
          sceneId: 's2-1',
          rewrittenBeats: [{ id: 's2-1-b1', text: newMoment }],
          critiqueNotes: [],
          overallCommentary: '',
        },
      }),
    };
    const handler = buildSceneClusterRepairHandler({
      critic: () => critic as never,
      routeIssue: (repairIssue) => ({
        kind: 'scene_cluster_rewrite',
        validator: repairIssue.validator,
        episodeNumber: repairIssue.episodeNumber,
        sceneIds: repairIssue.sceneId ? [repairIssue.sceneId] : [],
        reason: 'time-coded authored beat needs adjacent context',
        attemptBudget: 2,
        qualityFloor: { overall: 90, voice: 85, stakes: 85, rejectDrop: 5 },
        unsafeForProsePatch: true,
      }),
      plannedMomentSources: new Map([
        ['s2-1', { requiredBeats: [{ tier: 'coldopen', mustDepict: lockedMoment }] }],
      ]),
    });

    const result = await handler({
      story,
      blockingIssues: [{
        ...requiredBeatIssue('s2-1', 2),
        message: `Authored required beat is missing from scene "s2-1": "${newMoment}".`,
      }],
    });

    expect(result.changed).toBe(true);
    expect(critic.execute).toHaveBeenCalledTimes(1);
    const firstNotes: string = critic.execute.mock.calls[0][0].directorNotes;
    expect(firstNotes).toContain('LOCKED EXISTING MOMENTS');
    expect(firstNotes).toContain('84K to 92K');
    expect(story.episodes[1].scenes[0].beats[0].text).toContain('84K to 92K');
    expect(story.episodes[1].scenes[0].beats[0].text).toContain('Victor on a stage');
  });

  it('cluster-repairs RequiredBeat findings routed away from same-scene repair', async () => {
    const critic = {
      execute: vi.fn().mockImplementation(async ({ scene }: { scene: { sceneId: string; beats: Array<{ id?: string }> } }) => ({
        success: true,
        data: {
          sceneId: scene.sceneId,
          rewrittenBeats: scene.beats.map((beat) => ({
            id: beat.id,
            text: scene.sceneId === 's2-1'
              ? 'On night two, Mika swaps out your American shoes and hands you the key card.'
              : 'The neighboring scene supports the turn.',
          })),
          critiqueNotes: [],
          overallCommentary: '',
        },
      })),
    };
    const handler = buildSceneClusterRepairHandler({
      critic: () => critic as never,
      routeIssue: (repairIssue) => ({
        kind: 'scene_cluster_rewrite',
        validator: repairIssue.validator,
        episodeNumber: repairIssue.episodeNumber,
        sceneIds: repairIssue.sceneId ? [repairIssue.sceneId] : [],
        reason: 'time-coded authored beat needs adjacent context',
        attemptBudget: 2,
        qualityFloor: { overall: 90, voice: 85, stakes: 85, rejectDrop: 5 },
        unsafeForProsePatch: true,
      }),
    });
    const story = makeStory();
    const result = await handler({
      story,
      blockingIssues: [{
        ...requiredBeatIssue('s2-1', 2),
        message: 'Authored required beat is missing from scene "s2-1": "On night two, Mika swaps out your American shoes and hands you the key card."',
      }],
    });

    expect(result.changed).toBe(true);
    expect(critic.execute).toHaveBeenCalled();
    expect(story.episodes[1].scenes[0].beats[0].text).toContain('key card');
  });

  it('re-appends compact SceneTurn fragments after cluster repair leaves a residual state change missing', async () => {
    const centralTurn =
      'At a Lipscani bookshop, Stela presses a chunk of rose quartz into Kylie\'s hand — "this one wants to be with you, love" — and the Dusk Club is now three.';
    const critic = {
      execute: vi.fn().mockImplementation(async ({ scene }: { scene: { sceneId: string; beats: Array<{ id?: string }> } }) => ({
        success: true,
        data: {
          sceneId: scene.sceneId,
          rewrittenBeats: scene.beats.map((beat) => ({
            id: beat.id,
            text: scene.sceneId === 's2-1'
              ? 'Stela presses a chunk of rose quartz into your hand. "This one wants to be with you, love," she says.'
              : 'The neighboring scene supports the turn.',
          })),
          critiqueNotes: [],
          overallCommentary: '',
        },
      })),
    };
    const story = makeStory() as any;
    story.episodes[1].scenes = [
      { id: 'before', name: 'Before', beats: [{ id: 'before-b1', text: 'The bell over the bookshop door rings.' }] },
      { id: 's2-1', name: 'Bookshop', beats: [{ id: 'b1', text: 'Stela studies the bowl of stones.' }] },
      { id: 'after', name: 'After', beats: [{ id: 'after-b1', text: 'The street outside waits.' }] },
    ];
    const handler = buildSceneClusterRepairHandler({
      critic: () => critic as never,
      routeIssue: (repairIssue) => ({
        kind: 'scene_cluster_rewrite',
        validator: repairIssue.validator,
        episodeNumber: repairIssue.episodeNumber,
        sceneIds: repairIssue.sceneId ? [repairIssue.sceneId] : [],
        reason: 'central turn needs adjacent context',
        attemptBudget: 2,
        qualityFloor: { overall: 90, voice: 85, stakes: 85, rejectDrop: 5 },
        unsafeForProsePatch: false,
      }),
    });

    const result = await handler({
      story,
      blockingIssues: [sceneTurnIssue('s2-1', 2, centralTurn)],
    });

    expect(result.changed).toBe(true);
    expect(story.episodes[1].scenes[1].beats[0].text).toContain('Dusk Club is now three.');
  });

  it('does not retry when the first rewrite already depicts the full moment', async () => {
    const critic = {
      execute: vi.fn().mockResolvedValue({
        success: true,
        data: { sceneId: 's2-1', rewrittenBeats: [{ id: 'b1', text: MOMENT }], critiqueNotes: [], overallCommentary: '' },
      }),
    };
    const handler = buildSceneProseRepairHandler({ critic: () => critic as never });
    const result = await handler({ story: makeStory(), blockingIssues: [momentIssue('s2-1', 2, MOMENT)] });
    expect(critic.execute).toHaveBeenCalledTimes(1);
    expect(result.record).toMatchObject({ succeeded: true, attempts: 1 });
  });

  it('does not append compact scene-turn fragments for generic planner turns', async () => {
    const critic = {
      execute: vi.fn().mockResolvedValue({
        success: true,
        data: { sceneId: 's2-1', rewrittenBeats: [{ id: 'b1', text: 'The morning light gathers around the laptop.' }], critiqueNotes: [], overallCommentary: '' },
      }),
    };
    const story = makeStory() as any;
    const scene = story.episodes[1].scenes[0];
    scene.beats[0].text = 'The morning light gathers around the laptop.';
    const genericTurn = 'Let the fallout settle into the next pressure: Kylie lands in Bucharest, forms the Dusk Club, is attacked in Cișmigiu, and writes the viral Mr. Midnight post.';
    const handler = buildSceneClusterRepairHandler({
      critic: () => critic as never,
      routeIssue: (repairIssue) => ({
        kind: 'scene_cluster_rewrite',
        validator: repairIssue.validator,
        episodeNumber: repairIssue.episodeNumber,
        sceneIds: repairIssue.sceneId ? [repairIssue.sceneId] : [],
        reason: 'central turn needs adjacent context',
        attemptBudget: 2,
        qualityFloor: { overall: 90, voice: 85, stakes: 85, rejectDrop: 5 },
        unsafeForProsePatch: false,
      }),
    });

    await handler({
      story,
      blockingIssues: [{
        ...sceneTurnIssue('s2-1', 2, genericTurn),
        message: `Scene "s2-1" still has a generic planner central turn instead of a concrete scene event: "${genericTurn}".`,
      }],
    });

    expect(scene.beats[0].text).not.toContain('forms the Dusk Club');
    expect(scene.beats[0].text).not.toContain('is attacked in Cișmigiu');
    expect(scene.beats[0].text).not.toContain('writes the viral Mr. Midnight post');
  });

  it('does not append compact scene-turn fragments into encounter scenes', async () => {
    const centralTurn =
      'Walking home through Cișmigiu at 1am, Kylie is pinned to a willow by a shadow — and a second figure in a charcoal suit drops the attacker, walks her home, kisses her hand at the threshold, declines to come in, and vanishes.';
    const critic = {
      execute: vi.fn().mockImplementation(async ({ scene }: { scene: { sceneId: string; beats: Array<{ id?: string }> } }) => ({
        success: true,
        data: {
          sceneId: scene.sceneId,
          rewrittenBeats: scene.beats.map((beat) => ({
            id: beat.id,
            text: scene.sceneId === 'treatment-enc-1-1'
              ? 'At 1am in Cișmigiu, a shadow pins you to a willow before a figure in a charcoal suit drops the attacker and walks you home.'
              : 'The neighboring scene stays grounded.',
          })),
          critiqueNotes: [],
          overallCommentary: '',
        },
      })),
    };
    const story = makeStory() as any;
    const encounterScene = story.episodes[0].scenes[1];
    const handler = buildSceneClusterRepairHandler({
      critic: () => critic as never,
      routeIssue: (repairIssue) => ({
        kind: 'scene_cluster_rewrite',
        validator: repairIssue.validator,
        episodeNumber: repairIssue.episodeNumber,
        sceneIds: repairIssue.sceneId ? [repairIssue.sceneId] : [],
        reason: 'central turn needs adjacent context',
        attemptBudget: 2,
        qualityFloor: { overall: 90, voice: 85, stakes: 85, rejectDrop: 5 },
        unsafeForProsePatch: false,
      }),
    });

    const result = await handler({
      story,
      blockingIssues: [sceneTurnIssue('treatment-enc-1-1', 1, centralTurn)],
    });

    expect(result.changed).toBe(true);
    const encounterText = JSON.stringify(encounterScene.encounter);
    expect(encounterText).not.toContain('kisses your hand at the threshold');
    expect(encounterText).not.toContain('declines to come in');
    expect(encounterText).not.toContain('vanishes.');
  });

  it('does not report a SceneTurn repair as succeeded when the rewrite only lands part of the central turn', async () => {
    const partial =
      "The mantle photograph bothers you because Victor seems omitted from the family arrangement. A guest smiles too knowingly and uses the Marinescu maiden name before you offer it.";
    const critic = {
      execute: vi.fn().mockResolvedValue({
        success: true,
        data: { sceneId: 's2-1', rewrittenBeats: [{ id: 'b1', text: partial }], critiqueNotes: [], overallCommentary: '' },
      }),
    };
    const handler = buildSceneProseRepairHandler({ critic: () => critic as never });
    const story = makeStory();
    const result = await handler({ story, blockingIssues: [sceneTurnIssue('s2-1', 2, NOTICER_SPLINTERS)] });

    expect(critic.execute).toHaveBeenCalledTimes(2);
    expect(result.changed).toBe(true);
    expect(result.record).toMatchObject({ succeeded: false, degraded: true, attempts: 2 });
  });

  it('preserves an already-realized required beat when a scene repair rewrite drops it', async () => {
    const critic = {
      execute: vi.fn().mockResolvedValue({
        success: true,
        data: {
          sceneId: 's2-1',
          rewrittenBeats: [{ id: 'b1', text: 'Stela presses the quartz into your hand but says something too cryptic to catch.' }],
          critiqueNotes: [],
          overallCommentary: '',
        },
      }),
    };
    const handler = buildSceneProseRepairHandler({ critic: () => critic as never });
    const story = makeStory();
    const scene = story.episodes[1].scenes[0] as any;
    scene.requiredBeats = [{ tier: 'authored', mustDepict: '"this one wants to be with you, love"' }];
    scene.beats[0].text = 'Stela presses the quartz into your hand. "This one wants to be with you, love."';

    const result = await handler({
      story,
      blockingIssues: [sceneTurnIssue('s2-1', 2, 'Stela tests whether Kylie will accept protection.')],
    });

    expect(result.changed).toBe(true);
    expect(story.episodes[1].scenes[0].beats[0].text.toLowerCase()).toContain('this one wants to be with you, love');
    expect(story.episodes[1].scenes[0].beats[0].text).toContain('Stela presses the quartz into your hand');
  });

  it('preserves planned required beats absent from assembled scene metadata when a rewrite drops them', async () => {
    const critic = {
      execute: vi.fn().mockResolvedValue({
        success: true,
        data: {
          sceneId: 's2-1',
          rewrittenBeats: [{
            id: 'b1',
            text: 'Stela presses the quartz into your hand and says the stone has been waiting.',
            textVariants: [{ text: '"This one wants to be with you, love."' }],
          }],
          critiqueNotes: [],
          overallCommentary: '',
        },
      }),
    };
    const plannedMomentSources = new Map([
      ['s2-1', { requiredBeats: [{ tier: 'authored', mustDepict: '"This one wants to be with you, love."' }] }],
    ]);
    const handler = buildSceneProseRepairHandler({
      critic: () => critic as never,
      plannedMomentSources,
    });
    const story = makeStory();
    const scene = story.episodes[1].scenes[0] as any;
    delete scene.requiredBeats;
    scene.beats[0].text = 'Stela presses the quartz into your hand. "This one wants to be with you, love."';

    const result = await handler({
      story,
      blockingIssues: [sceneTurnIssue('s2-1', 2, 'Stela tests whether Kylie will accept protection.')],
    });

    expect(result.changed).toBe(true);
    expect(story.episodes[1].scenes[0].beats[0].text).toContain('This one wants to be with you, love');
    expect(story.episodes[1].scenes[0].beats[0].text).toContain('Stela presses the quartz into your hand');
  });

  it('preserves locked planned prose deterministically after a same-scene rewrite drops it', async () => {
    const lockedMoment =
      'Kylie watches the blog dashboard tick from 84K to 92K while the draft says Three Dates and a Tow Truck.';
    const newMoment =
      'Mika calls from the stairwell and says the viral post has put Victor on a stage.';
    const critic = {
      execute: vi.fn().mockResolvedValue({
        success: true,
        data: {
          sceneId: 's2-1',
          rewrittenBeats: [{ id: 'b1', text: newMoment }],
          critiqueNotes: [],
          overallCommentary: '',
        },
      }),
    };
    const story = makeStory();
    const scene = story.episodes[1].scenes[0] as any;
    scene.requiredBeats = [{ tier: 'coldopen', mustDepict: lockedMoment }];
    scene.beats[0].text = lockedMoment;
    const handler = buildSceneProseRepairHandler({ critic: () => critic as never });

    const result = await handler({
      story,
      blockingIssues: [{
        ...momentIssue('s2-1', 2, newMoment),
        message: `Authored required beat is missing from scene "s2-1": "${newMoment}".`,
      }],
    });

    expect(result.changed).toBe(true);
    expect(critic.execute).toHaveBeenCalledTimes(1);
    const firstNotes: string = critic.execute.mock.calls[0][0].directorNotes;
    expect(firstNotes).toContain('LOCKED EXISTING MOMENTS');
    expect(firstNotes).toContain('84K to 92K');
    expect(story.episodes[1].scenes[0].beats[0].text).toContain('84K to 92K');
    expect(story.episodes[1].scenes[0].beats[0].text).toContain('Victor on a stage');
  });

  it('does not paste a dense required beat fallback when fallback policy disallows it', async () => {
    const denseMoment =
      'Walking home through Cișmigiu at 1am, Kylie is pinned to a willow by a shadow — and a second figure in a charcoal suit drops the attacker, walks her home, kisses her hand at the threshold, declines to come in, and vanishes.';
    const critic = {
      execute: vi.fn().mockResolvedValue({
        success: true,
        data: {
          sceneId: 's1-4',
          rewrittenBeats: [{ id: 'b1', text: 'By 1am, you are walking home through Cișmigiu when a shadow pins you to a willow.' }],
          critiqueNotes: [],
          overallCommentary: '',
        },
      }),
    };
    const handler = buildSceneProseRepairHandler({
      critic: () => critic as never,
      allowRequiredBeatFallback: () => false,
    });
    const story = makeStory();
    const result = await handler({ story, blockingIssues: [momentIssue('s1-4', 1, denseMoment)] });

    expect(critic.execute).toHaveBeenCalledTimes(2);
    expect(result.changed).toBe(true);
    expect(result.record).toMatchObject({ succeeded: false, degraded: true });
    expect((story as any).episodes[0].scenes[0].beats[0].text).not.toContain('kisses her hand at the threshold');
    expect((story as any).episodes[0].scenes[0].beats[0].text).not.toContain(denseMoment);
  });

  it('appends a compact required quote when the critic paraphrases it away', async () => {
    const quote = '"this one wants to be with you, love"';
    const critic = {
      execute: vi.fn().mockResolvedValue({
        success: true,
        data: {
          sceneId: 's2-1',
          rewrittenBeats: [{ id: 'b1', text: 'Stela presses the quartz into your palm and says the stone has been waiting.' }],
          critiqueNotes: [],
          overallCommentary: '',
        },
      }),
    };
    const handler = buildSceneProseRepairHandler({
      critic: () => critic as never,
      allowRequiredBeatFallback: () => true,
    });
    const story = makeStory();
    const result = await handler({
      story,
      blockingIssues: [{
        ...momentIssue('s2-1', 2, quote),
        message: `Authored required beat is missing from scene "s2-1": ${quote}.`,
      }],
    });

    expect(result.changed).toBe(true);
    expect(story.episodes[1].scenes[0].beats[0].text).toContain('this one wants to be with you, love');
  });

  it('does not append a noun-fragment required-beat fallback', async () => {
    const fragment = "her grandmother's address";
    const critic = {
      execute: vi.fn().mockResolvedValue({
        success: true,
        data: {
          sceneId: 's2-1',
          rewrittenBeats: [{ id: 'b1', text: 'You arrive with two suitcases and a phone going dark.' }],
          critiqueNotes: [],
          overallCommentary: '',
        },
      }),
    };
    const handler = buildSceneProseRepairHandler({
      critic: () => critic as never,
      allowRequiredBeatFallback: () => true,
    });
    const story = makeStory();

    await handler({ story, blockingIssues: [momentIssue('s2-1', 2, fragment)] });

    expect(story.episodes[1].scenes[0].beats[0].text).not.toContain(fragment);
  });

  it('reports a SceneTurn repair as succeeded only after every listed splinter is on-page', async () => {
    const partial =
      "The mantle photograph bothers you because Victor seems omitted from the family arrangement. A guest smiles too knowingly and uses the Marinescu maiden name before you offer it.";
    const complete = [
      'In the powder room, Ileana cries into a monogrammed towel and freezes when you see her.',
      'The mantle photograph omits Victor from a family arrangement that otherwise accounts for everyone.',
      "Mika returns from an unexplained missing hour and deflects when you ask where he's been.",
      'A guest knows the Marinescu maiden name before you give him any reason to know it.',
    ].join(' ');
    const critic = {
      execute: vi.fn()
        .mockResolvedValueOnce({
          success: true,
          data: { sceneId: 's2-1', rewrittenBeats: [{ id: 'b1', text: partial }], critiqueNotes: [], overallCommentary: '' },
        })
        .mockResolvedValueOnce({
          success: true,
          data: { sceneId: 's2-1', rewrittenBeats: [{ id: 'b1', text: complete }], critiqueNotes: [], overallCommentary: '' },
        }),
    };
    const handler = buildSceneProseRepairHandler({ critic: () => critic as never });
    const story = makeStory();
    const result = await handler({ story, blockingIssues: [sceneTurnIssue('s2-1', 2, NOTICER_SPLINTERS)] });

    expect(critic.execute).toHaveBeenCalledTimes(2);
    expect(result.changed).toBe(true);
    expect(result.record).toMatchObject({ succeeded: true, degraded: false, attempts: 2 });
    expect((story as any).episodes[1].scenes[0].beats[0].text).toContain('Ileana cries');
    expect((story as any).episodes[1].scenes[0].beats[0].text).toContain('missing hour');
  });

  it('prioritizes never-attempted scenes in later rounds instead of re-claiming slots', async () => {
    // Two failing scenes, cap 1/round. Round 1 takes s1-4 (insertion order) and
    // its rewrite does NOT clear; round 2 must pick s2-1 (never attempted),
    // not retry s1-4 again.
    const critic = {
      execute: vi.fn().mockResolvedValue({
        success: true,
        data: { sceneId: 'x', rewrittenBeats: [{ id: 'b1', text: 'unrelated polish' }], critiqueNotes: [], overallCommentary: '' },
      }),
    };
    const handler = buildSceneProseRepairHandler({ critic: () => critic as never, maxScenesPerRound: 1 });
    const story = makeStory();
    const blocking = [
      momentIssue('s1-4', 1, 'A note about the crescent card is slipped under the door at midnight.'),
      momentIssue('s2-1', 2, MOMENT),
    ];
    await handler({ story, blockingIssues: blocking }); // round 1: s1-4 (2 attempts, never clears)
    const round1Scenes = critic.execute.mock.calls.map((c) => c[0].scene.sceneId);
    expect(round1Scenes.every((s: string) => s === 's1-4')).toBe(true);

    critic.execute.mockClear();
    await handler({ story, blockingIssues: blocking }); // round 2: s2-1 first
    expect(critic.execute.mock.calls[0][0].scene.sceneId).toBe('s2-1');
  });

  it('survives a critic failure on one scene and still repairs the other', async () => {
    const critic = {
      execute: vi.fn()
        .mockRejectedValueOnce(new Error('LLM unavailable'))
        .mockResolvedValueOnce({
          success: true,
          data: { sceneId: 's1-4', rewrittenBeats: [{ id: 'b2', text: 'A shadow pins Kylie to the willow; a second figure peels from the dark.' }], critiqueNotes: [], overallCommentary: '' },
        }),
    };
    const handler = buildSceneProseRepairHandler({ critic: () => critic as never });
    const story = makeStory();
    const result = await handler({
      story,
      blockingIssues: [requiredBeatIssue('s2-1'), signatureIssue('s1-4')],
    });
    expect(result.changed).toBe(true);
    expect((story as any).episodes[0].scenes[0].beats[1].text).toContain('willow');
    expect(result.record?.degraded).toBe(true); // one of two scenes failed
  });

  it('returns changed:false when no critic is available', async () => {
    const handler = buildSceneProseRepairHandler({ critic: () => null });
    const result = await handler({ story: makeStory(), blockingIssues: [requiredBeatIssue('s2-1')] });
    expect(result.changed).toBe(false);
  });

  it('does not append a required-beat fallback when the fallback sentence is planning-register prose', async () => {
    const moment =
      'The protagonist arrives in the capital as a charming observer with two suitcases and the intent to rebuild after a public failure.';
    const critic = {
      execute: vi.fn().mockResolvedValue({
        success: true,
        data: {
          sceneId: 's2-1',
          rewrittenBeats: [{ id: 'b1', text: 'They study the map in silence.' }],
          critiqueNotes: [],
          overallCommentary: '',
        },
      }),
    };
    const handler = buildSceneProseRepairHandler({
      critic: () => critic as never,
      allowRequiredBeatFallback: () => true,
    });
    const story = makeStory();

    await handler({
      story,
      blockingIssues: [{
        ...requiredBeatIssue('s2-1'),
        message: `Authored required beat is missing from scene "s2-1": "${moment}".`,
      }],
    });

    expect(story.episodes[1].scenes[0].beats[0].text).not.toContain('intent to rebuild');
    expect(story.episodes[1].scenes[0].beats[0].text).not.toContain(moment);
  });

  it('skips same-scene repair when the repair router classifies the issue as unsafe for prose patching', async () => {
    const critic = { execute: vi.fn() };
    const routedAway: string[] = [];
    const handler = buildSceneProseRepairHandler({
      critic: () => critic as never,
      routeIssue: (repairIssue) => ({
        kind: 'blueprint_rebalance',
        validator: repairIssue.validator,
        episodeNumber: repairIssue.episodeNumber,
        sceneIds: repairIssue.sceneId ? [repairIssue.sceneId] : [],
        reason: 'scene overloaded',
        attemptBudget: 1,
        qualityFloor: { overall: 90, voice: 85, stakes: 85, rejectDrop: 5 },
        unsafeForProsePatch: true,
      }),
      emit: (message) => routedAway.push(message),
    });

    const result = await handler({ story: makeStory(), blockingIssues: [requiredBeatIssue('s2-1')] });

    expect(result.changed).toBe(false);
    expect(critic.execute).not.toHaveBeenCalled();
    expect(routedAway.join('\n')).toContain('blueprint_rebalance');
  });

  it('defers same-scene repair when the scene also has a cluster-routed blocker', async () => {
    const critic = { execute: vi.fn() };
    const emitted: string[] = [];
    const handler = buildSceneProseRepairHandler({
      critic: () => critic as never,
      routeIssue: (repairIssue) => ({
        kind: repairIssue.validator === 'SceneTurnRealizationValidator' ? 'scene_cluster_rewrite' : 'same_scene_retry',
        validator: repairIssue.validator,
        episodeNumber: repairIssue.episodeNumber,
        sceneIds: repairIssue.sceneId ? [repairIssue.sceneId] : [],
        reason: 'cluster owns the dramatic turn',
        attemptBudget: 2,
        qualityFloor: { overall: 90, voice: 85, stakes: 85, rejectDrop: 5 },
        unsafeForProsePatch: repairIssue.validator === 'SceneTurnRealizationValidator',
      }),
      emit: (message) => emitted.push(message),
    });

    const result = await handler({
      story: makeStory(),
      blockingIssues: [
        momentIssue('s2-1', 2, 'Mika calls from the stairwell and says the viral post has put Victor on a stage.'),
        sceneTurnIssue('s2-1', 2, 'The cold open turns from blog success into social danger.'),
      ],
    });

    expect(result.changed).toBe(false);
    expect(critic.execute).not.toHaveBeenCalled();
    expect(emitted.join('\n')).toContain('deferred s2-1 to cluster repair');
  });
});

describe('selectSceneProseRepairs — EncounterAnchorContent is repairable (bite-me-g18)', () => {
  it('selects an EncounterAnchorContentValidator finding by its encounter sceneId', () => {
    const groups = selectSceneProseRepairs([
      { validator: 'EncounterAnchorContentValidator', sceneId: 'treatment-enc-3-1', message: 'does not depict its central conflict…' } as never,
      { validator: 'AuthoredEpisodeConformanceValidator', sceneId: 'x', message: 'episode mismatch' } as never,
    ]);
    expect(groups.has('treatment-enc-3-1')).toBe(true);
    expect(groups.has('x')).toBe(false); // non-prose validator stays excluded
  });
})

describe('prose/cluster deferral deadlock (bite-me 2026-07-03T14-10-21 s1-1 regression)', () => {
  const proseCritic = () => ({
    execute: vi.fn().mockImplementation(async ({ scene }: { scene: { sceneId: string; beats: Array<{ id?: string }> } }) => ({
      success: true,
      data: {
        sceneId: scene.sceneId,
        rewrittenBeats: scene.beats.map((beat) => ({
          id: beat.id,
          text: 'A strategy argument over the route sharpens the old hostility on the page.',
        })),
        critiqueNotes: [],
        overallCommentary: '',
      },
    })),
  });

  const clusterRoute = (repairIssue: { validator?: string; episodeNumber?: number; sceneId?: string }) => ({
    kind: 'scene_cluster_rewrite' as const,
    validator: repairIssue.validator,
    episodeNumber: repairIssue.episodeNumber,
    sceneIds: repairIssue.sceneId ? [repairIssue.sceneId] : [],
    reason: 'treatment event has sequence context',
    attemptBudget: 2,
    qualityFloor: { overall: 90, voice: 85, stakes: 85, rejectDrop: 5 },
    unsafeForProsePatch: true,
  });

  it('prose handler stops deferring a scene once cluster repair has attempted it', async () => {
    // Round-2 shape of the deadlock: the scene's blocker routes
    // scene_cluster_rewrite, the cluster handler already attempted the center
    // (attemptedCenters), and without the shared set the prose handler kept
    // deferring while the cluster handler kept skipping — the blocker survived
    // every remaining round and failed the run.
    const shared = new Set<string>();
    const issue = requiredBeatIssue('s2-1');
    const emitted: string[] = [];

    const cluster = buildSceneClusterRepairHandler({
      critic: () => proseCritic() as never,
      routeIssue: clusterRoute,
      clusterAttemptedCenters: shared,
    });
    await cluster({ story: makeStory(), blockingIssues: [issue] });
    expect(shared.has('2:s2-1')).toBe(true);

    const critic = proseCritic();
    const prose = buildSceneProseRepairHandler({
      critic: () => critic as never,
      routeIssue: clusterRoute,
      clusterAttemptedCenters: shared,
      emit: (message) => emitted.push(message),
    });
    const result = await prose({ story: makeStory(), blockingIssues: [issue] });

    // Not deferred, not routed away: taken same-scene as the fallback.
    expect(emitted.some((message) => message.includes('deferred'))).toBe(false);
    expect(emitted.some((message) => message.includes('same-scene after cluster repair'))).toBe(true);
    expect(result.changed).toBe(true);
    expect(critic.execute).toHaveBeenCalled();
  });

  it('prose handler still defers to cluster repair on the first round', async () => {
    const shared = new Set<string>();
    const emitted: string[] = [];
    const critic = proseCritic();
    const prose = buildSceneProseRepairHandler({
      critic: () => critic as never,
      routeIssue: clusterRoute,
      clusterAttemptedCenters: shared,
      emit: (message) => emitted.push(message),
    });
    const result = await prose({ story: makeStory(), blockingIssues: [requiredBeatIssue('s2-1')] });
    expect(emitted.some((message) => message.includes('deferred'))).toBe(true);
    expect(result.changed).toBe(false);
    expect(critic.execute).not.toHaveBeenCalled();
  });
});

describe('characterIntroductionIssuesCleared', () => {
  const metadataIssue = {
    validator: 'CharacterIntroductionValidator',
    severity: 'error',
    type: 'character_introduction',
    message:
      '"Victor Valcescu" first appears in the cast of scene "enc-1-1" (episode 1) but the prose of that scene never names them, and no earlier scene introduced them — they exist in metadata only, not on-page.',
    location: 'characterIntroduction:ep1:enc-1-1:char-victor',
    suggestion: 'Have the prose of "enc-1-1" actually present Victor Valcescu: name them and let the protagonist register who they are.',
  };

  it('requires naming for metadata-only issues (named intro)', () => {
    const unnamed = {
      id: 'enc-1-1',
      beats: [{ id: 'b1', text: 'Fog clings to the willow. Something moves in the dark.' }],
    } as unknown as Scene;
    expect(characterIntroductionIssuesCleared(unnamed as never, [metadataIssue])).toBe(false);

    const named = {
      id: 'enc-1-1',
      beats: [{ id: 'b1', text: 'Victor Valcescu steps between you and the shadow and offers a hand.' }],
    } as unknown as Scene;
    expect(characterIntroductionIssuesCleared(named as never, [metadataIssue])).toBe(true);
  });

  it('accepts first-contact staging for anonymous_plant metadata issues', () => {
    const anonymousIssue = {
      ...metadataIssue,
      suggestion:
        'Stage Victor Valcescu as an anonymous first-contact plant in "enc-1-1" (stranger/visual cues, no roster name yet) or name them on-page if this is a named intro.',
    };
    const staged = {
      id: 'enc-1-1',
      beats: [{ id: 'b1', text: 'A stranger in a charcoal suit steps between you and the shadow and offers a hand.' }],
    } as unknown as Scene;
    expect(characterIntroductionIssuesCleared(staged as never, [anonymousIssue])).toBe(true);
  });

  it('keeps off-page-familiarity checks for :offpage-familiarity locations', () => {
    const offPageIssue = {
      validator: 'CharacterIntroductionValidator',
      severity: 'error',
      type: 'character_introduction',
      message:
        '"Mika Drăgan" first appears in scene "s1-1" (episode 1) inside prose that implies off-page familiarity or settled group belonging before the reader has met them.',
      location: 'characterIntroduction:ep1:s1-1:char-mika:offpage-familiarity',
      suggestion: 'Introduce Mika with first-contact behavior.',
    };
    const familiar = {
      id: 's1-1',
      beats: [{
        id: 'b1',
        text: 'It has only been three days with Mika, so every easy gesture still feels slightly staged as she refills your wine.',
      }],
    } as unknown as Scene;
    expect(characterIntroductionIssuesCleared(familiar as never, [offPageIssue])).toBe(false);

    const firstContact = {
      id: 's1-1',
      beats: [{ id: 'b1', text: 'A woman with silver-streaked hair offers a hand. "Mika," she says.' }],
    } as unknown as Scene;
    expect(characterIntroductionIssuesCleared(firstContact as never, [offPageIssue])).toBe(true);
  });

  it('plant-leak predicted-clear is false while roster name present, true when removed', () => {
    const plantLeakIssue = {
      validator: 'CharacterIntroductionValidator',
      severity: 'error',
      type: 'character_introduction',
      message:
        '"Victor Valcescu" is named in reader-facing prose of scene "s1-1" (episode 1) while scheduled as an anonymous plant — roster identity must stay hidden until the reveal scene.',
      location: 'characterIntroduction:ep1:s1-1:char-victor-valcescu:anonymous-plant-leak',
      suggestion:
        'Keep Victor Valcescu anonymous on all reader surfaces until the planned reveal; use stranger/visual descriptors only.',
    };
    const named = {
      id: 's1-1',
      beats: [{ id: 'b1', text: 'A man in a charcoal suit, Victor Valcescu radiates elegance.' }],
    } as unknown as Scene;
    expect(characterIntroductionIssuesCleared(named as never, [plantLeakIssue])).toBe(false);

    const anonymous = {
      id: 's1-1',
      beats: [{ id: 'b1', text: 'A stranger in a charcoal suit steps between you and the shadow and offers a hand.' }],
    } as unknown as Scene;
    expect(characterIntroductionIssuesCleared(anonymous as never, [plantLeakIssue])).toBe(true);
  });
});
