import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ProseCraftJudge,
  ResponsivenessJudge,
  aggregateProseCraftReports,
  aggregateResponsivenessReports,
  buildResponsivenessProbes,
  judgeFlagEnabled,
  sampleSceneProse,
} from './QualityJudges';
import { QARunner } from './QAAgents';
import type { SceneContent } from './SceneWriter';
import type { ChoiceSet } from './ChoiceAuthor';

function scene(sceneId: string, beatTexts: string[]): SceneContent {
  return {
    sceneId,
    sceneName: sceneId,
    beats: beatTexts.map((text, index) => ({ id: `${sceneId}-b${index + 1}`, text })),
    startingBeatId: `${sceneId}-b1`,
    moodProgression: [],
    charactersInvolved: [],
    keyMoments: [],
    continuityNotes: [],
  } as unknown as SceneContent;
}

function choiceSet(sceneId: string, beatId: string, choices: Array<Record<string, unknown>>): ChoiceSet {
  return {
    beatId,
    sceneId,
    choiceType: 'strategic',
    choices,
    overallStakes: { want: 'w', cost: 'c', identity: 'i' },
    designNotes: '',
  } as unknown as ChoiceSet;
}

afterEach(() => {
  delete process.env.STORYRPG_PROSE_JUDGE;
  delete process.env.STORYRPG_RESPONSIVENESS_JUDGE;
});

describe('judgeFlagEnabled', () => {
  it('defaults on and honors 0/false kill switches', () => {
    expect(judgeFlagEnabled('STORYRPG_PROSE_JUDGE')).toBe(true);
    process.env.STORYRPG_PROSE_JUDGE = '0';
    expect(judgeFlagEnabled('STORYRPG_PROSE_JUDGE')).toBe(false);
    process.env.STORYRPG_PROSE_JUDGE = 'false';
    expect(judgeFlagEnabled('STORYRPG_PROSE_JUDGE')).toBe(false);
    process.env.STORYRPG_PROSE_JUDGE = '1';
    expect(judgeFlagEnabled('STORYRPG_PROSE_JUDGE')).toBe(true);
  });
});

describe('sampleSceneProse', () => {
  it('samples every scene when the budget allows and anchors excerpts to beat ids', () => {
    const samples = sampleSceneProse([
      scene('s1', ['Alpha beat text.', 'Second beat.']),
      scene('s2', ['Bravo beat text.']),
    ], 14000);

    expect(samples.map((s) => s.sceneId)).toEqual(['s1', 's2']);
    expect(samples[0].excerpts[0]).toMatchObject({ beatId: 's1-b1', text: 'Alpha beat text.' });
  });

  it('spreads sampling across the episode when the budget cannot fit all scenes', () => {
    const scenes = Array.from({ length: 10 }, (_, i) => scene(`s${i + 1}`, ['x'.repeat(800)]));
    const samples = sampleSceneProse(scenes, 2000); // fits ~2 scenes at 900 chars minimum

    expect(samples.length).toBeLessThanOrEqual(2);
    // Not just the front of the episode
    expect(samples.some((s) => s.sceneId !== 's1' && s.sceneId !== 's2')).toBe(true);
  });

  it('returns empty for no prose', () => {
    expect(sampleSceneProse([], 5000)).toEqual([]);
    expect(sampleSceneProse([scene('s1', [])], 5000)).toEqual([]);
  });
});

describe('buildResponsivenessProbes', () => {
  const scenes = [
    scene('s1', ['Opening beat.']),
    scene('s2', ['You slip through the side door before anyone clocks you.']),
    scene('s3', ['Mara is waiting, arms crossed, when you walk in the front.']),
  ];

  it('builds probes from branching choice sets with downstream excerpts', () => {
    const probes = buildResponsivenessProbes(scenes, [
      choiceSet('s1', 'b1', [
        { text: 'Sneak in', nextSceneId: 's2' },
        { text: 'Walk in openly', nextSceneId: 's3' },
      ]),
    ]);

    expect(probes).toHaveLength(1);
    expect(probes[0].probeId).toBe('s1:b1');
    expect(probes[0].options[0].downstreamExcerpt).toContain('side door');
    expect(probes[0].options[1].downstreamExcerpt).toContain('Mara is waiting');
  });

  it('requires at least two options carrying downstream signal', () => {
    const probes = buildResponsivenessProbes(scenes, [
      choiceSet('s1', 'b1', [
        { text: 'Option with nothing' },
        { text: 'Another with nothing' },
      ]),
    ]);
    expect(probes).toHaveLength(0);
  });

  it('accepts outcome-text-only sets and prefers branching ones first', () => {
    const branching = choiceSet('s1', 'b1', [
      { text: 'A', nextSceneId: 's2' },
      { text: 'B', nextSceneId: 's3' },
    ]);
    const tinted = choiceSet('s2', 'b2', [
      { text: 'C', outcomeTexts: { success: 'She softens.' }, reactionText: 'A nod.' },
      { text: 'D', outcomeTexts: { success: 'She hardens.' } },
    ]);
    const probes = buildResponsivenessProbes(scenes, [tinted, branching], 6);

    expect(probes[0].probeId).toBe('s1:b1');
    expect(probes[1].probeId).toBe('s2:b2');
    expect(probes[1].options[0].outcomeSuccess).toBe('She softens.');
  });

  it('projects each option through matching successor text variants', () => {
    const successor = scene('s2', ['The room holds its breath.']);
    successor.beats[0].textVariants = [
      { condition: { type: 'flag', flag: 'answered_boldly', value: true }, text: 'Mika grins at the nerve of your answer.' },
      { condition: { type: 'flag', flag: 'answered_gently', value: true }, text: 'Mika lowers her voice to meet your gentleness.' },
    ];
    const probes = buildResponsivenessProbes([scene('s1', ['Choose.']), successor], [
      choiceSet('s1', 'b1', [
        { text: 'Answer boldly', nextSceneId: 's2', consequences: [{ type: 'setFlag', flag: 'answered_boldly', value: true }] },
        { text: 'Answer gently', nextSceneId: 's2', consequences: [{ type: 'setFlag', flag: 'answered_gently', value: true }] },
      ]),
    ]);

    expect(probes[0].options[0].downstreamExcerpt).toContain('grins');
    expect(probes[0].options[1].downstreamExcerpt).toContain('lowers her voice');
  });

  it('caps the probe count', () => {
    const sets = Array.from({ length: 10 }, (_, i) => choiceSet(`s${i}`, `b${i}`, [
      { text: 'A', nextSceneId: 's2' },
      { text: 'B', nextSceneId: 's3' },
    ]));
    expect(buildResponsivenessProbes(scenes, sets, 4)).toHaveLength(4);
  });
});

describe('ProseCraftJudge', () => {
  it('fails fast without prose and without calling the LLM', async () => {
    const judge = new ProseCraftJudge({} as any);
    const callLLM = vi.fn();
    (judge as any).callLLM = callLLM;

    const result = await judge.execute({ sceneContents: [] });
    expect(result.success).toBe(false);
    expect(callLLM).not.toHaveBeenCalled();
  });

  it('normalizes the report: clamps scores, drops unknown concepts, coerces severities', async () => {
    const judge = new ProseCraftJudge({} as any);
    (judge as any).callLLM = vi.fn(async () => JSON.stringify({
      overallScore: 340,
      conceptScores: [
        { conceptId: 'sentence_craft', score: 72.6, evidence: 'clean verbs' },
        { conceptId: 'made_up_concept', score: 90, evidence: 'nope' },
        { conceptId: 'filler_density', score: -5, evidence: 'padding everywhere' },
      ],
      issues: [
        { severity: 'catastrophic', conceptId: 'filler_density', description: 'Beat 2 is throat-clearing.' },
        { severity: 'error', conceptId: 'unknown', description: '' },
      ],
      recommendations: ['Cut the padding.'],
    }));

    const result = await judge.execute({ sceneContents: [scene('s1', ['Some prose worth judging.'])] });
    expect(result.success).toBe(true);
    const report = result.data!;
    expect(report.overallScore).toBe(100); // clamped
    expect(report.conceptScores).toHaveLength(2);
    expect(report.conceptScores.find((c) => c.conceptId === 'filler_density')?.score).toBe(0);
    expect(report.issues).toHaveLength(1);
    expect(report.issues[0].severity).toBe('warning'); // coerced
    expect(report.sampledSceneIds).toEqual(['s1']);
  });

  it('derives overallScore from concept scores when the model omits it', async () => {
    const judge = new ProseCraftJudge({} as any);
    (judge as any).callLLM = vi.fn(async () => JSON.stringify({
      conceptScores: [
        { conceptId: 'sentence_craft', score: 60, evidence: 'e' },
        { conceptId: 'rhythm_pacing', score: 40, evidence: 'e' },
      ],
      issues: [],
      recommendations: [],
    }));

    const result = await judge.execute({ sceneContents: [scene('s1', ['Prose.'])] });
    expect(result.data!.overallScore).toBe(50);
  });
});

describe('ResponsivenessJudge', () => {
  const scenes = [
    scene('s1', ['Opening.']),
    scene('s2', ['Side door.']),
    scene('s3', ['Front door.']),
  ];
  const sets = [choiceSet('s1', 'b1', [
    { text: 'Sneak', nextSceneId: 's2' },
    { text: 'Walk', nextSceneId: 's3' },
  ])];

  it('fails fast without judgeable probes', async () => {
    const judge = new ResponsivenessJudge({} as any);
    const callLLM = vi.fn();
    (judge as any).callLLM = callLLM;

    const result = await judge.execute({ sceneContents: scenes, choiceSets: [] });
    expect(result.success).toBe(false);
    expect(callLLM).not.toHaveBeenCalled();
  });

  it('normalizes verdicts and filters unknown probe ids', async () => {
    const judge = new ResponsivenessJudge({} as any);
    (judge as any).callLLM = vi.fn(async () => JSON.stringify({
      overallScore: 55,
      conceptScores: [
        { conceptId: 'choice_reflected_in_prose', score: 61, evidence: 'probe s1:b1 diverges' },
        { conceptId: 'npc_reacts_to_player_choice', score: 30, evidence: 'Mara ignores the entry route' },
      ],
      probeVerdicts: [
        { probeId: 's1:b1', verdict: 'divergent', npcReaction: 'static', notes: 'routes differ' },
        { probeId: 'invented:probe', verdict: 'cosmetic', npcReaction: 'static', notes: 'x' },
      ],
      issues: [
        { severity: 'error', conceptId: 'npc_reacts_to_player_choice', description: 'Mara greets you identically on both routes.' },
      ],
      recommendations: [],
    }));

    const result = await judge.execute({ sceneContents: scenes, choiceSets: sets });
    expect(result.success).toBe(true);
    const report = result.data!;
    expect(report.probeVerdicts).toHaveLength(1);
    expect(report.probeVerdicts[0].probeId).toBe('s1:b1');
    expect(report.conceptScores.map((c) => c.conceptId).sort()).toEqual([
      'choice_reflected_in_prose',
      'npc_reacts_to_player_choice',
    ]);
    expect(report.issues[0].severity).toBe('error');
  });
});

describe('multi-episode judge aggregation', () => {
  it('keeps the weakest concept grade across episodes and accumulates issues', () => {
    const merged = aggregateProseCraftReports([
      {
        overallScore: 80,
        conceptScores: [
          { conceptId: 'sentence_craft', score: 82, evidence: 'ep1 solid' },
          { conceptId: 'filler_density', score: 88, evidence: 'ep1 tight' },
        ],
        issues: [{ severity: 'warning', conceptId: 'sentence_craft', description: 'ep1 wobble' }],
        sampledSceneIds: ['s1-1'],
        recommendations: ['tighten openers'],
      },
      undefined,
      {
        overallScore: 61,
        conceptScores: [
          { conceptId: 'sentence_craft', score: 91, evidence: 'ep2 clean' },
          { conceptId: 'filler_density', score: 55, evidence: 'ep2 padded' },
        ],
        issues: [{ severity: 'error', conceptId: 'filler_density', description: 'ep2 padding' }],
        sampledSceneIds: ['s2-1'],
        recommendations: ['tighten openers', 'cut padding'],
      },
    ]);

    expect(merged?.overallScore).toBe(61);
    expect(merged?.conceptScores.find((c) => c.conceptId === 'sentence_craft')?.score).toBe(82);
    expect(merged?.conceptScores.find((c) => c.conceptId === 'filler_density')?.score).toBe(55);
    expect(merged?.issues).toHaveLength(2);
    expect(merged?.sampledSceneIds).toEqual(['s1-1', 's2-1']);
    expect(merged?.recommendations).toEqual(['tighten openers', 'cut padding']);
  });

  it('returns undefined when no episode carried a judge report', () => {
    expect(aggregateProseCraftReports([undefined, undefined])).toBeUndefined();
    expect(aggregateResponsivenessReports([])).toBeUndefined();
  });

  it('accumulates responsiveness probe verdicts across episodes', () => {
    const merged = aggregateResponsivenessReports([
      {
        overallScore: 70,
        conceptScores: [{ conceptId: 'choice_reflected_in_prose', score: 70, evidence: 'ep1' }],
        probeVerdicts: [{ probeId: 's1:b1', verdict: 'divergent', npcReaction: 'reactive', notes: '' }],
        issues: [],
        recommendations: [],
      },
      {
        overallScore: 40,
        conceptScores: [{ conceptId: 'choice_reflected_in_prose', score: 40, evidence: 'ep2' }],
        probeVerdicts: [{ probeId: 's2:b1', verdict: 'cosmetic', npcReaction: 'static', notes: '' }],
        issues: [],
        recommendations: [],
      },
    ]);

    expect(merged?.overallScore).toBe(40);
    expect(merged?.conceptScores[0].score).toBe(40);
    expect(merged?.probeVerdicts.map((p) => p.probeId)).toEqual(['s1:b1', 's2:b1']);
  });
});

describe('QARunner judge wiring', () => {
  function stubbedRunner(): QARunner {
    const runner = new QARunner({} as any);
    (runner as any).continuityChecker = {
      execute: async () => ({
        success: true,
        data: {
          overallScore: 95,
          issueCount: { errors: 0, warnings: 0, suggestions: 0 },
          issues: [], passedChecks: ['ok'], recommendations: [],
        },
      }),
    };
    (runner as any).voiceValidator = {
      execute: async () => ({ success: true, data: { overallScore: 90, characterScores: [], issues: [], distinctionScore: 80, recommendations: [] } }),
    };
    (runner as any).stakesAnalyzer = {
      execute: async () => ({
        success: true,
        data: { overallScore: 90, choiceSetAnalysis: [], metrics: { averageStakesScore: 90, falseChoiceCount: 0, dilemmaQuality: 80, varietyScore: 80 }, issues: [], strengths: [], recommendations: [] },
      }),
    };
    return runner;
  }

  const qaInput = {
    sceneContents: [scene('s1', ['Prose.'])],
    choiceSets: [],
    characterProfiles: [],
    knownFlags: [],
    knownScores: [],
    establishedFacts: [],
    sceneContexts: [],
    storyThemes: [],
    targetTone: '',
  };

  it('attaches judge reports without touching the QA gate', async () => {
    const runner = stubbedRunner();
    (runner as any).proseCraftJudge = {
      execute: async () => ({ success: true, data: { overallScore: 40, conceptScores: [], issues: [], sampledSceneIds: ['s1'], recommendations: [] } }),
    };
    (runner as any).responsivenessJudge = {
      execute: async () => ({ success: false, error: 'no probes' }),
    };

    const report = await runner.runFullQA(qaInput);
    expect(report.proseCraft?.overallScore).toBe(40);
    expect(report.responsiveness).toBeUndefined();
    // Judge grade of 40 must not change the QA gate outcome.
    expect(report.passesQA).toBe(true);
  });

  it('skips judges when the kill switches are set', async () => {
    process.env.STORYRPG_PROSE_JUDGE = '0';
    process.env.STORYRPG_RESPONSIVENESS_JUDGE = '0';
    const runner = stubbedRunner();
    const proseExecute = vi.fn();
    (runner as any).proseCraftJudge = { execute: proseExecute };
    (runner as any).responsivenessJudge = { execute: proseExecute };

    const report = await runner.runFullQA(qaInput);
    expect(proseExecute).not.toHaveBeenCalled();
    expect(report.skippedChecks).toContain('proseCraft');
    expect(report.skippedChecks).toContain('responsiveness');
  });
});
