import { describe, expect, it, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { SeasonPlannerAgent } from './SeasonPlannerAgent';
import { BaseAgent } from './BaseAgent';
import { extractTreatmentFromMarkdown } from '../utils/treatmentExtraction';
import { buildLockedStoryCanon } from '../utils/sourceCanonBuilder';

function makePlanner() {
  return new SeasonPlannerAgent({
    provider: 'anthropic',
    model: 'test',
    apiKey: 'test',
    maxTokens: 1000,
    temperature: 0,
  });
}

function makeAnalysis() {
  const treatment = readFileSync(join(__dirname, '../fixtures/bite-me-treatment.md'), 'utf8');
  const extracted = extractTreatmentFromMarkdown(treatment);
  const analysis = {
    sourceTitle: 'Bite Me',
    sourceFormat: 'story_treatment',
    treatmentMetadata: extracted.metadata,
    treatmentSeasonGuidance: extracted.seasonGuidance,
    totalWordCount: treatment.split(/\s+/).length,
    analysisTimestamp: new Date('2026-01-01T00:00:00Z'),
    genre: 'paranormal romance',
    tone: 'glamorous and dangerous',
    themes: ['voice', 'friendship'],
    anchors: {
      stakes: 'Kylie risks her voice, humanity, friends, and blog.',
      goal: 'Build a new life in Bucharest without being owned.',
      incitingIncident: 'Kylie is attacked and rescued by Victor.',
      climax: 'Kylie chooses what she will become at the Hunter Moon ball.',
    },
    storyCircle: {
      you: 'Kylie arrives in Bucharest trying to turn performance into safety.',
      need: 'Kylie wants a dazzling new life but needs to keep her voice and selfhood.',
      go: 'The attack and Victor rescue pull Kylie across the supernatural threshold.',
      search: 'Kylie tests glamour, friendship, blogging, and vampire rules under pressure.',
      find: 'Kylie gains proof, intimacy, and access that reveal what Victor wants from her.',
      take: 'Trust collapses and Kylie pays for attention with danger to voice, friends, and humanity.',
      return: 'Kylie brings the truth back into public and relational consequence at the ball.',
      change: 'Kylie chooses what she will become and writes from altered selfhood.',
    },
    storyArcs: [{ id: 'arc-1', name: 'Dusk', description: 'Kylie learns the city.', estimatedEpisodeRange: { start: 1, end: 8 } }],
    protagonist: { id: 'char-kylie', name: 'Kylie', description: 'A blogger.' },
    characterArchitecture: {
      protagonist: {
        lie: 'Kylie believes attention is the same thing as safety.',
        originPressure: 'Her old life rewarded performance more than honesty.',
        truth: 'She has to choose selfhood over being consumed by someone else gaze.',
        want: 'Build a dazzling new life in Bucharest.',
        need: 'Keep her voice and selfhood even when glamour offers protection.',
        arcMode: 'ambiguous',
        climaxChoice: {
          choiceQuestion: 'Will Kylie choose her own voice or let Victor define her?',
          integrateTruthOption: 'Choose her own voice and boundaries.',
          recommitLieOption: 'Trade selfhood for glamorous protection.',
          activeChoiceMechanism: 'The player chooses what Kylie risks at the Hunter Moon ball.',
        },
      },
      supportingCharacters: [],
    },
    majorCharacters: [],
    keyLocations: [],
    resolvedEndingMode: 'multiple',
    detectedEndingMode: 'multiple',
    resolvedEndings: extracted.endings,
    treatmentBranches: extracted.branches,
    warnings: [],
    episodeBreakdown: Array.from({ length: 8 }, (_, index) => {
      const episodeNumber = index + 1;
      const roles = [
        ['you'],
        ['go'],
        ['search'],
        ['search'],
        ['find'],
        ['take'],
        ['return'],
        ['return', 'change'],
      ][index];
      const storyCircleRole = [
        [{ beat: 'you', roleKind: 'primary' }],
        [{ beat: 'need', roleKind: 'primary' }],
        [{ beat: 'go', roleKind: 'primary' }],
        [{ beat: 'search', roleKind: 'primary' }],
        [{ beat: 'find', roleKind: 'primary' }],
        [{ beat: 'take', roleKind: 'primary' }],
        [{ beat: 'return', roleKind: 'primary' }],
        [{ beat: 'change', roleKind: 'primary' }],
      ][index];
      return {
        episodeNumber,
        title: `Episode ${episodeNumber}`,
        synopsis: `Synopsis ${episodeNumber}`,
        sourceChapters: [`${episodeNumber}`],
        sourceSummary: `Synopsis ${episodeNumber}`,
        plotPoints: [],
        mainCharacters: ['Kylie'],
        supportingCharacters: [],
        locations: ['Bucharest'],
        estimatedSceneCount: 8,
        estimatedChoiceCount: 4,
        storyCircleRole,
        narrativeFunction: { setup: '', conflict: '', resolution: '' },
        treatmentGuidance: extracted.episodes[episodeNumber],
      };
    }),
    totalEstimatedEpisodes: 8,
  } as any;
  const sourceCanon = buildLockedStoryCanon({
    analysis,
    sourceText: treatment,
    treatment: extracted,
  });
  analysis.sourceCanon = sourceCanon;
  analysis.canonLockManifest = sourceCanon.lockManifest;
  return analysis;
}

describe('SeasonPlannerAgent treatment handoff', () => {
  it('normalizes encounter-style arc turnout vocabulary before arc-pressure validation', () => {
    const planner = makePlanner();
    const turnouts = (planner as any).normalizeArcEpisodeTurnouts(
      [{
        episodeNumber: 2,
        storyCircleBeat: 'search',
        storyCircleRoleKind: 'primary',
        turnType: 'exploration',
        description: 'The middle episode tests the arc question with a new obstacle.',
        leavesProtagonistWith: 'A changed sense of what the problem costs.',
        whyThisCannotMoveLater: 'The next episode depends on this pressure having changed state.',
      }],
      [{
        episodeNumber: 2,
        storyCircleRole: [{ beat: 'search', roleKind: 'primary' }],
        synopsis: 'A generic middle episode.',
      }],
      { start: 1, end: 3, midpointEpisode: 2, crisisEpisode: 2 },
    );

    expect(turnouts[0].turnType).toBe('escalation');
  });

  it('re-samples malformed planner JSON before return back', async () => {
    const planner = makePlanner();
    let calls = 0;
    (planner as any).callLLM = async () => {
      calls += 1;
      if (calls === 1) {
        return '{"arcs":["Bucharest",Secrecy"],"episodeEncounters":{}';
      }
      return JSON.stringify({
        seasonTitle: 'Bite Me',
        seasonSynopsis: 'A retry-preserved authored plan.',
        arcs: [{
          id: 'llm-arc',
          name: 'Retry Arc',
          description: 'Authored after JSON correction.',
          episodeRange: { start: 1, end: 8 },
          keyMoments: [],
        }],
        episodeEncounters: {},
        crossEpisodeBranches: [],
        episodeEndingRoutes: {},
      });
    };

    const result = await planner.execute({
      sourceAnalysis: makeAnalysis() as any,
      preferences: {
        targetScenesPerEpisode: 6,
        targetChoicesPerEpisode: 4,
        pacing: 'moderate',
      },
      storyCircleBlocking: false,
    });

    expect(result.success).toBe(true);
    expect(calls).toBe(2);
    expect(result.data!.arcs[0].id).toBe('llm-arc');
  });

  it('does not replace treatment-bound required beats with an LLM-authored scene spine', async () => {
    const planner = makePlanner();
    (planner as any).callLLM = async () => '{}';
    (planner as any).authorScenePlanLLM = async () => {
      throw new Error('authorScenePlanLLM should not run for authored treatments');
    };

    const result = await planner.execute({
      sourceAnalysis: makeAnalysis() as any,
      preferences: {
        targetScenesPerEpisode: 6,
        targetChoicesPerEpisode: 4,
        pacing: 'moderate',
      },
      storyCircleBlocking: false,
    });

    expect(result.success).toBe(true);
    const ep1Scenes = result.data!.episodes[0].plannedScenes ?? [];
    const requiredText = ep1Scenes
      .flatMap((scene: any) => scene.requiredBeats ?? [])
      .map((beat: any) => beat.mustDepict)
      .join('\n');
    const encounterText = (result.data!.episodes[0].plannedEncounters ?? [])
      .map((encounter: any) => encounter.description)
      .join('\n');
    expect(requiredText).toContain('Mika\'s key card');
    expect(requiredText).toContain('quartz');
    expect(encounterText.toLowerCase()).toContain('rooftop bar at sunset');
    expect(result.data!.notes.join('\n')).toMatch(
      /authored-lite ESC projection is sole structural author|kept deterministic treatment-bound spine/,
    );
  });

  it('refuses authorScenePlanLLM for authored-lite ESC plans', async () => {
    const planner = makePlanner();
    const plan = {
      episodes: [{ episodeNumber: 1, treatmentGuidance: { sourceKind: 'authored_lite' } }],
      scenePlan: { scenes: [] },
    };
    await expect((planner as any).authorScenePlanLLM(plan)).rejects.toThrow(/\[EscAuthority\]/);
  });

  it('detects authored-lite scene identity drift after budget overlay', () => {
    const planner = makePlanner();
    const plan = {
      scenePlan: {
        scenes: [
          { id: 's1', order: 0, spineUnitId: 'u1' },
          { id: 's2', order: 1, spineUnitId: 'u2' },
        ],
      },
      episodes: [],
    };
    const fingerprint = (planner as any).fingerprintAuthoredLiteScenePlan(plan);
    plan.scenePlan.scenes[0].order = 9;
    expect(() => (planner as any).assertAuthoredLiteScenePlanFrozen(plan, fingerprint, 'post-budget'))
      .toThrow(/\[EscAuthority\].*drifted/);
  });

  it('maps treatment episode guidance into encounters, cliffhangers, branches, and ending routes', () => {
    const planner = makePlanner();
    const analysis = makeAnalysis();
    const merged = (planner as any).mergeTreatmentGuidanceIntoPlanData(analysis, {});
    const plan = (planner as any).buildSeasonPlan(analysis, merged, {
      targetScenesPerEpisode: 8,
      targetChoicesPerEpisode: 4,
      pacing: 'moderate',
    });

    expect(plan.endingMode).toBe('multiple');
    expect(plan.resolvedEndings).toHaveLength(3);
    expect(plan.episodes[0].plannedEncounters[0].description).toContain('rooftop bar');
    expect(['go', 'search', 'find', 'take']).toContain(plan.episodes[0].plannedEncounters[0].storyCircleTarget);
    expect(plan.episodes[0].plannedEncounters[0].storyCircleTargetRationale).toContain('Target');
    expect(plan.episodes[0].plannedEncounters[0].storyCircleTargetEvidence.protagonistChange).toBeTruthy();
    expect(plan.episodes[0].cliffhangerPlan.hook).toContain('horrible dream');
    expect(plan.episodes[4].cliffhangerPlan.hook).toContain('stag-crest ring');
    expect(plan.episodes[4].cliffhangerPlan.intensity).toBe('high');
    expect(plan.episodes[4].cliffhangerPlan.type).toBe('reframe');
    expect(plan.crossEpisodeBranches.map((branch: any) => branch.name)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('The Quartz'),
        expect.stringContaining('The Blog War'),
        expect.stringContaining('Mika'),
        expect.stringContaining('The Mountain Confession'),
      ]),
    );
    expect(plan.episodes[0].endingRoutes.map((route: any) => route.endingId)).toEqual(
      expect.arrayContaining(plan.resolvedEndings.map((ending: any) => ending.id)),
    );
    expect(plan.arcs[0].arcQuestion).toContain('Kylie');
    expect(plan.arcs[0].midpointRecontextualization.questionAfter).toContain('understand');
    expect(plan.arcs[0].lateArcCrisis.irreversibleCost).toBeTruthy();
    expect(plan.arcs[0].episodeTurnouts).toHaveLength(8);
    expect(plan.arcs[0].episodeTurnouts[4].turnType).toBe('recontextualization');
    expect(plan.seasonPromiseArchitecture!.seasonDramaticQuestion).toContain('Kylie');
    expect(plan.seasonPromiseArchitecture!.centralPressure.pressuresLieBy).toContain('attention');
    expect(plan.seasonPromiseArchitecture!.seasonPromise.playerExperiencePromise).toContain('player');
    expect(plan.preferences.targetScenesPerEpisode).toBe(6);
  });

  it('repairs LLM arc plans that leave final Story Circle beats unowned', () => {
    const planner = makePlanner();
    const analysis = makeAnalysis();
    const merged = (planner as any).mergeTreatmentGuidanceIntoPlanData(analysis, {
      arcs: [
        {
          id: 'arc-1-3',
          name: 'Opening Glamour',
          description: 'Kylie enters the dangerous romance.',
          episodeRange: { start: 1, end: 3 },
        },
        {
          id: 'arc-4-6',
          name: 'Gathering Shadow',
          description: 'Victor pressure escalates into cost.',
          episodeRange: { start: 4, end: 6 },
        },
      ],
    });
    const plan = (planner as any).buildSeasonPlan(analysis, merged, {
      targetScenesPerEpisode: 8,
      targetChoicesPerEpisode: 4,
      pacing: 'moderate',
    });

    const owners = new Map<string, string[]>();
    for (const arc of plan.arcs) {
      for (const beat of arc.storyCircleSpan?.ownedBeats ?? []) {
        owners.set(beat, [...(owners.get(beat) ?? []), arc.name]);
      }
    }

    expect(owners.get('return')).toEqual(['Gathering Shadow']);
    expect(owners.get('change')).toEqual(['Gathering Shadow']);
    expect(plan.arcs.find((arc: any) => arc.id === 'arc-4-6')?.episodeRange).toEqual({ start: 4, end: 8 });
  });

  it('partitions overlapping LLM arc Story Circle ownership before gating', () => {
    const planner = makePlanner();
    const analysis = makeAnalysis();
    const merged = (planner as any).mergeTreatmentGuidanceIntoPlanData(analysis, {
      arcs: [
        {
          id: 'blog-war',
          name: 'The Blog War',
          description: 'The season-long public voice pressure.',
          episodeRange: { start: 1, end: 8 },
        },
        {
          id: 'mika-crossroad',
          name: 'Mika\'s Crossroad',
          description: 'The friend-group loyalty pressure.',
          episodeRange: { start: 1, end: 4 },
        },
      ],
    });
    const plan = (planner as any).buildSeasonPlan(analysis, merged, {
      targetScenesPerEpisode: 8,
      targetChoicesPerEpisode: 4,
      pacing: 'moderate',
    });

    const owners = new Map<string, string[]>();
    for (const arc of plan.arcs) {
      for (const beat of arc.storyCircleSpan?.ownedBeats ?? []) {
        owners.set(beat, [...(owners.get(beat) ?? []), arc.name]);
      }
    }

    for (const beat of ['you', 'need', 'go', 'search', 'find', 'take', 'return', 'change']) {
      expect(owners.get(beat)).toHaveLength(1);
    }
    expect(plan.arcs.find((arc: any) => arc.id === 'mika-crossroad')?.episodeRange).toEqual({ start: 1, end: 4 });
    expect(plan.arcs.find((arc: any) => arc.id === 'blog-war')?.episodeRange).toEqual({ start: 5, end: 8 });
  });

  it('keeps a three-episode authored late-arc crisis on the final episode', () => {
    const planner = makePlanner();
    const guided = (planner as any).applyAuthoredArcGuidance({}, {
      arcIndex: 1,
      title: 'Champagne',
      sourceText: 'Arc 1: Champagne',
      episodeRange: { start: 1, end: 3 },
      arcDramaticQuestion: 'Can Kylie start over without letting approval consume her?',
      relationToSeasonQuestion: 'Tests the season question through Victor approval.',
      lieFacet: 'Kylie mistakes attention for safety.',
      midpointRecontextualization: 'The glamorous new life is underneath a funnel.',
      lateArcCrisis: 'At the Equinox weekend Victor makes clear that the blog and his privacy cannot both win.',
      finaleAnswer: 'Kylie comes home seeing the cost of being chosen.',
      handoffPressure: 'The first crack carries into the next arc.',
      episodeTurnouts: [],
    }, 3);

    expect(guided.midpointRecontextualization.episodeNumber).toBe(2);
    expect(guided.lateArcCrisis.episodeNumber).toBe(3);
  });

  it('carries refreshed treatment episode turns, central conflict, and aftermath into planned encounters', () => {
    const planner = makePlanner();
    const treatment = readFileSync(join(__dirname, '../fixtures/refreshed-treatment.md'), 'utf8');
    const extracted = extractTreatmentFromMarkdown(treatment);
    const analysis = {
      ...makeAnalysis(),
      sourceTitle: 'Harbor Light',
      totalEstimatedEpisodes: 2,
      resolvedEndings: extracted.endings,
      treatmentBranches: extracted.branches,
      episodeBreakdown: [1, 2].map((episodeNumber) => ({
        episodeNumber,
        title: extracted.episodes[episodeNumber].authoredTitle,
        synopsis: extracted.episodes[episodeNumber].episodePromise,
        sourceChapters: [`${episodeNumber}`],
        sourceSummary: extracted.episodes[episodeNumber].episodePromise,
        plotPoints: [],
        mainCharacters: ['Mara'],
        supportingCharacters: [],
        locations: ['Lighthouse'],
        estimatedSceneCount: 6,
        estimatedChoiceCount: 4,
        storyCircleRole: String(extracted.episodes[episodeNumber].rawStoryCircleRole ?? '')
          .split(/\s*(?:\+|,|\/|and)\s*/)
          .filter(Boolean)
          .map((beat) => ({
          beat,
          roleKind: 'primary',
          source: 'treatment',
        })) as any,
        narrativeFunction: { setup: '', conflict: '', resolution: '' },
        treatmentGuidance: extracted.episodes[episodeNumber],
      })),
    } as any;

    const merged = (planner as any).mergeTreatmentGuidanceIntoPlanData(analysis, {});
    const plan = (planner as any).buildSeasonPlan(analysis, merged, {
      targetScenesPerEpisode: 6,
      targetChoicesPerEpisode: 4,
      pacing: 'moderate',
    });

    const encounter = plan.episodes[0].plannedEncounters[0];
    expect(encounter.description).toContain('Central conflict');
    expect(['go', 'search', 'find', 'take']).toContain(encounter.storyCircleTarget);
    expect(encounter.storyCircleTargetEvidence.episodeQuestion).toBeTruthy();
    expect(encounter.centralConflict).toContain('miracle worth protecting');
    expect(encounter.aftermathConsequence).toContain('salt burns');
    expect(encounter.encounterSetupContext).toEqual(
      expect.arrayContaining([
        expect.stringContaining('turn:treatment_turn_ep1_1'),
        expect.stringContaining('growth:treatment_growth_ep1_1'),
        expect.stringContaining('aftermath:treatment_ep1'),
      ]),
    );
    expect(plan.episodes[0].cliffhangerPlan.hook).toContain('shadow points inland');
  });

  it('uses authored treatment cliffhanger questions as next-episode pressure and exempts finales', () => {
    const planner = makePlanner();
    const analysis = {
      ...makeAnalysis(),
      sourceTitle: 'Harbor Debt',
      totalEstimatedEpisodes: 2,
      treatmentBranches: [],
      resolvedEndings: [],
      episodeBreakdown: [1, 2].map((episodeNumber) => ({
        episodeNumber,
        title: episodeNumber === 1 ? 'The Ledger Opens' : 'The Closed Registry',
        synopsis: `Synopsis ${episodeNumber}`,
        sourceChapters: [`${episodeNumber}`],
        sourceSummary: `Synopsis ${episodeNumber}`,
        plotPoints: [],
        mainCharacters: ['Mara'],
        supportingCharacters: [],
        locations: ['Harbor'],
        estimatedSceneCount: 6,
        estimatedChoiceCount: 4,
        storyCircleRole: (episodeNumber === 1 ? ['search'] : ['change']).map((beat) => ({
          beat,
          roleKind: 'primary',
          source: 'treatment',
        })) as any,
        narrativeFunction: { setup: '', conflict: '', resolution: '' },
        treatmentGuidance: episodeNumber === 1
          ? {
              authoredTitle: 'The Ledger Opens',
              dramaticQuestion: 'Will Mara protect Jonas or the ledger?',
              encounterAnchors: ['The auction fight over the ledger.'],
              endingTurnout: "The ledger page names Mara's father.",
              resolvedEpisodeTension: 'Mara chooses to take the case.',
              cliffhangerHook: "The red seal appears on her father's locked file.",
              cliffhangerQuestion: "Why did Mara's father sign the syndicate ledger?",
              nextEpisodePressure: 'The question forces Mara into the closed registry.',
              cliffhangerSetup: 'The seal appears twice before the final file.',
              cliffhangerType: 'revelation',
              emotionalCharge: 'intimate dread',
            }
          : {
              authoredTitle: 'The Closed Registry',
              dramaticQuestion: 'Can Mara survive the truth?',
              endingTurnout: 'Mara gets the record.',
              resolutionAftermath: 'Mara understands the record and chooses what to do with it.',
            },
      })),
    } as any;

    const merged = (planner as any).mergeTreatmentGuidanceIntoPlanData(analysis, {});
    const plan = (planner as any).buildSeasonPlan(analysis, merged, {
      targetScenesPerEpisode: 6,
      targetChoicesPerEpisode: 4,
      pacing: 'moderate',
    });

    expect(plan.episodes[0].cliffhangerPlan.hook).toContain('locked file');
    expect(plan.episodes[0].cliffhangerPlan.newOpenQuestion).toContain("Why did Mara's father");
    expect(plan.episodes[0].cliffhangerPlan.nextEpisodePressure).toContain('closed registry');
    expect(plan.episodes[0].cliffhangerPlan.resolvedEpisodeTension).toContain('take the case');
    expect(plan.episodes[0].cliffhangerPlan.type).toBe('revelation');
    expect(plan.episodes[0].cliffhangerPlan.emotionalCharge).toBe('intimate dread');
    expect(plan.episodes[1].cliffhangerPlan.nextEpisodePressure).toContain('understands the record');
  });

  it('carries treatment contracts into encounters and cliffhangers without encounter anchors', () => {
    const planner = makePlanner();
    const analysis = {
      ...makeAnalysis(),
      sourceTitle: 'Harbor Debt',
      totalEstimatedEpisodes: 1,
      treatmentSeasonGuidance: {
        informationLedger: 'info-seal',
        rawSectionSummary: ['informationLedger'],
      },
      resolvedEndings: makeAnalysis().resolvedEndings,
      treatmentBranches: [],
      episodeBreakdown: [{
        episodeNumber: 1,
        title: 'The Auction Bell',
        synopsis: 'Mara exposes herself at the auction.',
        sourceChapters: ['1'],
        sourceSummary: 'Mara exposes herself at the auction.',
        plotPoints: [],
        mainCharacters: ['Mara'],
        supportingCharacters: [],
        locations: ['Harbor'],
        estimatedSceneCount: 1,
        estimatedChoiceCount: 2,
        narrativeFunction: { setup: '', conflict: '', resolution: '' },
        treatmentGuidance: {
          authoredTitle: 'The Auction Bell',
          dramaticQuestion: 'Will Mara make herself visible to save the ledger?',
          entryGoal: 'Buy the fish crate quietly.',
          obstacle: 'The syndicate bids with Jonas family ring.',
          forcedChoice: 'Publicly challenge the bid or let the crate disappear.',
          exitShift: 'Mara leaves exposed as a bidder.',
          stakesLayers: ['Material: ledger access', 'Relational: Jonas trust', 'Identity: visibility'],
          themePressure: 'What does truth demand in public?',
          liePressure: 'Mara believes invisibility keeps people safe.',
          informationMovement: 'Plant the seal and open the brother question.',
          consequenceResidue: 'The auctioneer now knows Mara father name.',
          nextEpisodeCausality: 'The named father forces Mara to visit the closed registry.',
          majorChoicePressures: ['Challenge the bid or use Jonas secret.'],
          alternativePaths: ['Challenge creates public suspicion; secrecy creates private debt.'],
        },
      }],
    } as any;

    const merged = (planner as any).mergeTreatmentGuidanceIntoPlanData(analysis, {});
    const plan = (planner as any).buildSeasonPlan(analysis, merged, {
      targetScenesPerEpisode: 1,
      targetChoicesPerEpisode: 2,
      pacing: 'tight',
    });

    const encounter = plan.episodes[0].plannedEncounters[0];
    expect(encounter.description).toContain('Forced choice');
    expect(encounter.centralConflict).toContain('make herself visible');
    expect(encounter.stakes).toContain('Material: ledger access');
    expect(encounter.aftermathConsequence).toContain('Mara leaves exposed');
    expect(encounter.encounterSetupContext).toEqual(
      expect.arrayContaining([
        expect.stringContaining('entry_goal:treatment_ep1'),
        expect.stringContaining('forced_choice:treatment_ep1'),
        expect.stringContaining('information:treatment_ep1'),
        expect.stringContaining('residue:treatment_ep1'),
      ]),
    );
    expect(plan.episodes[0].plannedEncounters[0].isBranchPoint).toBe(true);
  });

  it('never anchors an encounter on a question-shaped dramaticQuestion; mines the synopsis threat sentence instead (bite-me 2026-07-02)', () => {
    const planner = makePlanner();
    const base = makeAnalysis();
    const analysis = {
      ...base,
      totalEstimatedEpisodes: 1,
      episodeBreakdown: [{
        episodeNumber: 1,
        title: 'Dating After Dusk',
        synopsis: 'Kylie arrives in the city with two suitcases. '
          + 'Walking home through the park, she is attacked and rescued by a handsome stranger. '
          + 'At 4am she turns the night into her first post.',
        sourceChapters: ['1'],
        sourceSummary: 'Arrival, attack, first post.',
        plotPoints: [],
        mainCharacters: ['Kylie'],
        supportingCharacters: [],
        locations: ['Park'],
        estimatedSceneCount: 4,
        estimatedChoiceCount: 3,
        narrativeFunction: { setup: '', conflict: '', resolution: '' },
        treatmentGuidance: {
          authoredTitle: 'Dating After Dusk',
          dramaticQuestion: 'Can Kylie start over, feel wanted, and write under her own name in a city that is already watching her?',
        },
      }],
    } as any;

    const merged = (planner as any).mergeTreatmentGuidanceIntoPlanData(analysis, {});

    const encounters = merged.episodeEncounters['1'];
    expect(encounters).toHaveLength(1);
    expect(encounters[0].description).toContain('attacked and rescued');
    expect(encounters[0].description).not.toContain('Can Kylie start over');
  });

  it('plans no encounter when guidance offers only question-shaped anchors and the synopsis stages no threat', () => {
    const planner = makePlanner();
    const base = makeAnalysis();
    const analysis = {
      ...base,
      totalEstimatedEpisodes: 1,
      episodeBreakdown: [{
        episodeNumber: 1,
        title: 'Quiet Episode',
        synopsis: 'Kylie settles into the apartment and writes her first post.',
        sourceChapters: ['1'],
        sourceSummary: 'A quiet settling-in episode.',
        plotPoints: [],
        mainCharacters: ['Kylie'],
        supportingCharacters: [],
        locations: ['Apartment'],
        estimatedSceneCount: 3,
        estimatedChoiceCount: 2,
        narrativeFunction: { setup: '', conflict: '', resolution: '' },
        treatmentGuidance: {
          authoredTitle: 'Quiet Episode',
          dramaticQuestion: 'Who is watching her?',
        },
      }],
    } as any;

    const merged = (planner as any).mergeTreatmentGuidanceIntoPlanData(analysis, {});

    expect(merged.episodeEncounters['1'] ?? []).toHaveLength(0);
  });
});

describe('SeasonPlannerAgent.normalizeChoiceMoments (E1 slice 4)', () => {
  const norm = (raw: unknown, total = 6) => (makePlanner() as any).normalizeChoiceMoments(raw, total);

  it('keeps valid moments, clamps episodes, and only keeps genuine later payoffs', () => {
    const out = norm([
      { id: 'a', episode: 1, anchor: 'Confront the captain', paysOffEpisode: 1 }, // not later → dropped payoff
      { id: 'b', episode: 2, anchor: 'Spare the envoy', paysOffEpisode: 4, flag: 'spared_envoy' },
      { id: 'c', episode: 99, anchor: 'Late call' }, // episode clamped to total (6)
    ]);
    expect(out).toEqual([
      { id: 'a', episode: 1, anchor: 'Confront the captain' },
      { id: 'b', episode: 2, anchor: 'Spare the envoy', paysOffEpisode: 4, flag: 'spared_envoy' },
      { id: 'c', episode: 6, anchor: 'Late call' },
    ]);
  });

  it('drops malformed entries and a non-snake_case flag', () => {
    const out = norm([
      { episode: 1 },                                   // no anchor → dropped
      { id: 'x', anchor: 'No episode' },                // no episode → dropped
      { id: 'y', episode: 1, anchor: 'Bad flag', flag: 'Not A Flag' }, // flag dropped, moment kept
    ]);
    expect(out).toEqual([{ id: 'y', episode: 1, anchor: 'Bad flag' }]);
  });

  it('returns undefined for an empty or non-array input', () => {
    expect(norm([])).toBeUndefined();
    expect(norm(undefined)).toBeUndefined();
  });

  it('de-dupes repeated ids', () => {
    const out = norm([
      { id: 'dup', episode: 1, anchor: 'First' },
      { id: 'dup', episode: 2, anchor: 'Second' },
    ]);
    expect(out).toHaveLength(2);
    expect(new Set(out.map((m: any) => m.id)).size).toBe(2);
  });
});

describe('SeasonPlannerAgent Story Circle spine gate (tier 1)', () => {
  afterEach(() => {
    delete process.env.GATE_ARC_PRESSURE;
  });

  const testScenePlan = (episodeCount = 1) => {
    const scenes = Array.from({ length: episodeCount }, (_, index) => {
      const episodeNumber = index + 1;
      return {
        id: `s${episodeNumber}-1`,
        episodeNumber,
        order: 0,
        kind: 'standard',
        title: `Episode ${episodeNumber} Opening`,
        dramaticPurpose: 'Open the test episode.',
        narrativeRole: 'setup',
        locations: [],
        npcsInvolved: [],
        setsUp: [],
        paysOff: [],
      };
    });
    return {
      scenes,
      byEpisode: Object.fromEntries(scenes.map((scene) => [scene.episodeNumber, [scene.id]])),
      setupPayoffEdges: [],
    };
  };

  // A plan with no anchors/storyCircle fails StoryCircleCoverageValidator with errors.
  const brokenPlan = () => ({
    totalEpisodes: 1, arcs: [], encounterPlan: { totalEncounters: 0 }, crossEpisodeBranches: [],
    anchors: undefined, storyCircle: undefined, episodes: [], resolvedEndings: [],
    warnings: [],
    notes: [],
    scenePlan: testScenePlan(),
  });

  it('throws (blocks) when the season spine is incomplete', async () => {
    const planner = makePlanner();
    (planner as any).callLLM = async () => '{}';
    (planner as any).buildSeasonPlan = () => brokenPlan();
    await expect(
      planner.execute({ sourceAnalysis: makeAnalysis() as any, preferences: {}, storyCircleBlocking: true }),
    ).rejects.toThrow(/StoryCircleGate/);
  });

  it('throws when scene-first planning is enabled but the season plan has no scene spine', async () => {
    const planner = makePlanner();
    (planner as any).callLLM = async () => '{}';
    (planner as any).buildSeasonPlan = () => ({
      ...brokenPlan(),
      anchors: {
        stakes: 'The test stakes are explicit.',
        goal: 'Reach the end of the test season.',
        incitingIncident: 'The test begins.',
        return: 'The final test choice lands.',
      },
      storyCircle: {
        you: 'A test protagonist begins in a known state.',
        need: 'They need a real scene spine.',
        go: 'The plan moves into generation.',
        search: 'The plan searches for scene support.',
        find: 'The missing scene spine is discovered.',
        take: 'The pipeline pays the cost of missing structure.',
        return: 'The plan returns to the gate.',
        change: 'The run stops instead of inventing scenes downstream.',
      },
      scenePlan: undefined,
    });

    await expect(
      planner.execute({ sourceAnalysis: makeAnalysis() as any, preferences: {}, storyCircleBlocking: false }),
    ).rejects.toThrow(/ScenePlanGate/);
  });

  it('does NOT throw when storyCircleBlocking is off (advisory)', async () => {
    process.env.GATE_ARC_PRESSURE = '0';
    const planner = makePlanner();
    (planner as any).callLLM = async () => '{}';
    (planner as any).buildSeasonPlan = () => brokenPlan();
    const result = await planner.execute({ sourceAnalysis: makeAnalysis() as any, preferences: {}, storyCircleBlocking: false });
    expect(result.success).toBe(true);
  });

  it('does NOT throw on a complete spine even with blocking on', async () => {
    process.env.GATE_ARC_PRESSURE = '0';
    const planner = makePlanner();
    (planner as any).callLLM = async () => '{}';
    // A minimally-complete plan: anchors + storyCircle present, episodes cover all 8 beats in order.
    (planner as any).buildSeasonPlan = () => ({
      totalEpisodes: 8, arcs: [], encounterPlan: { totalEncounters: 0 }, crossEpisodeBranches: [],
      anchors: {
        stakes: 'The fort falls and the valley with it if the line breaks.',
        goal: 'Hold the eastern wall until the relief column arrives.',
        incitingIncident: 'The first assault wave breaches the outer gate at dawn.',
        climax: 'The commander chooses between the wall and the wounded.',
      },
      storyCircle: {
        you: 'A soldier wakes inside the familiar discipline of the fort under siege.',
        need: 'The garrison wants survival and needs a commander who can choose what matters.',
        go: 'The outer gate breach forces the defenders into rules they cannot retreat from.',
        search: 'The survivors test defenses, alliances, and sacrifice under mounting pressure.',
        find: 'They discover the traitor and the route that might save part of the fort.',
        take: 'Saving that route costs supplies, wounded soldiers, and public trust.',
        return: 'The commander brings the chosen plan back to the broken eastern wall.',
        change: 'The garrison survives changed, counting who and what the choice preserved.',
      },
      episodes: [
        { episodeNumber: 1, storyCircleRole: [{ beat: 'you', roleKind: 'primary' }] },
        { episodeNumber: 2, storyCircleRole: [{ beat: 'need', roleKind: 'primary' }] },
        { episodeNumber: 3, storyCircleRole: [{ beat: 'go', roleKind: 'primary' }] },
        { episodeNumber: 4, storyCircleRole: [{ beat: 'search', roleKind: 'primary' }] },
        { episodeNumber: 5, storyCircleRole: [{ beat: 'find', roleKind: 'primary' }] },
        { episodeNumber: 6, storyCircleRole: [{ beat: 'take', roleKind: 'primary' }] },
        { episodeNumber: 7, storyCircleRole: [{ beat: 'return', roleKind: 'primary' }] },
        { episodeNumber: 8, storyCircleRole: [{ beat: 'change', roleKind: 'primary' }] },
      ],
      resolvedEndings: [],
      warnings: [],
      notes: [],
      scenePlan: testScenePlan(8),
    });
    const result = await planner.execute({ sourceAnalysis: makeAnalysis() as any, preferences: {}, storyCircleBlocking: true });
    expect(result.success).toBe(true);
  });
});

describe('SeasonPlannerAgent.refetchMissingPlanFields (truncated-plan recovery)', () => {
  afterEach(() => BaseAgent.setLlmTransportOverride(null));

  it('re-fetches just the missing critical fields and merges them in', async () => {
    let prompt = '';
    BaseAgent.setLlmTransportOverride(async (req) => {
      prompt = req.messages.map((m) => String(m.content)).join('\n');
      return JSON.stringify({ arcs: [{ id: 'arc-1' }], episodeEncounters: [{ ep: 1 }] });
    });
    const agent: any = makePlanner();
    const planData: any = { crossEpisodeBranches: [], episodeEndingRoutes: [] }; // arcs + episodeEncounters missing
    await agent.refetchMissingPlanFields(planData, ['arcs', 'episodeEncounters'], makeAnalysis(), undefined);

    expect(planData.arcs).toEqual([{ id: 'arc-1' }]);
    expect(planData.episodeEncounters).toEqual([{ ep: 1 }]);
    expect(prompt).toContain('arcs, episodeEncounters'); // focused on exactly the missing keys
  });

  it('leaves planData unchanged (no throw) when the re-fetch fails', async () => {
    BaseAgent.setLlmTransportOverride(async () => { throw new Error('boom'); });
    const agent: any = makePlanner();
    const planData: any = {};
    await expect(agent.refetchMissingPlanFields(planData, ['arcs'], makeAnalysis(), undefined)).resolves.toBeUndefined();
    expect(planData.arcs).toBeUndefined(); // deterministic fill will cover it downstream
  });
});
