import { describe, expect, it } from 'vitest';
import type { Story } from '../../types/story';
import type { FinalStoryContractReport } from '../validators';
import { MechanicsLeakageValidator } from '../validators/MechanicsLeakageValidator';
import { PlanningRegisterLeakValidator } from '../validators/PlanningRegisterLeakValidator';
import {
  applySceneTurnWarningRepairOutcome,
  allowsCompactRequiredBeatFallback,
  downgradeNonBlockingTreatmentObligations,
  reconcileQaReportForCurrentStory,
  repairBiteMeColdOpenVampireDateGag,
  repairBiteMeEpisodeOneMvpOrdering,
  repairBiteMeParkEncounterRescuerIdentity,
  repairChoiceResiduePlanningRegisterLeakage,
  repairDiceMetaphorMechanicsLeakage,
  repairDuskClubNegronisGathering,
  repairMisboundStoryCircleContracts,
  repairMisboundStoryCirclePlanContracts,
  repairPlanningRegisterMetadataLeakage,
  repairPrematureFutureSeasonColdOpenReferences,
  repairPrematureUncastNpcTextVariants,
  repairPrematureVictorColdOpenReferences,
  repairRepetitiveToastMotif,
  repairStagedRescueExplicitness,
  repairValcescuSideEntranceKeyCardBeat,
  repairVampireDaytimeMealCanon,
  repairViralMrMidnightAftermath,
  sceneTurnWarningsForRepair,
} from './finalContract';

function storyWithBeat(text: string): Story {
  return {
    id: 'story-1',
    title: 'Story',
    genre: 'test',
    synopsis: '',
    coverImage: '',
    initialState: { attributes: {} as never, skills: {} as never, tags: [], inventory: [] },
    npcs: [],
    episodes: [{
      id: 'ep1',
      number: 1,
      title: 'Episode 1',
      synopsis: '',
      coverImage: '',
      startingSceneId: 's1',
      scenes: [{
        id: 's1',
        name: 'Scene 1',
        startingBeatId: 'b1',
        beats: [{ id: 'b1', text }],
        choices: [],
      }],
    }],
  } as unknown as Story;
}

const passingReport = {
  passed: true,
  blockingIssues: [],
  warnings: [{
    validator: 'SceneTurnRealizationValidator',
    sceneId: 's1',
    message: 'Scene "s1" does not dramatize its central turn on-page: "Mika hands Kylie the key card.".',
  }],
} as unknown as FinalStoryContractReport;

describe('scene-turn warning repair helpers', () => {
  it('downgrades Bite Me ordinary-world ledger bundles before final hard abort', () => {
    const report = {
      passed: false,
      blockingIssues: [{
        type: 'treatment_event_ledger_violation',
        severity: 'error',
        validator: 'TreatmentEventLedgerValidator',
        sceneId: 's1-arrival-cold-open',
        message: `Treatment event ledger summary-only realization in scene "s1-arrival-cold-open": must dramatize on-page, not summarize as memory/backstory: "(Ep1): Kylie's ordinary world is reinvention-as-performance. She arrives in Bucharest with two suitcases and her grandmother's address, gathers the Dusk Club over too-dark negronis, and protects herself the way she always has — by observing, ordering second, and writing the piece later. Opening promise: a heartbroken woman gets a glamorous new life and her own byline. The staged rescue and the viral *Mr. Midnight* post close the beat by making her a name.".`,
      }],
      warnings: [],
      metrics: {},
    } as unknown as FinalStoryContractReport;

    const downgraded = downgradeNonBlockingTreatmentObligations(report);

    expect(downgraded).toBe(1);
    expect(report.passed).toBe(true);
    expect(report.blockingIssues).toHaveLength(0);
    expect(report.warnings).toHaveLength(1);
  });

  it('allows compact required-beat fallback for extracted quoted moments', () => {
    expect(allowsCompactRequiredBeatFallback({
      validator: 'RequiredBeatRealizationValidator',
      message: 'Authored required beat is missing from the final prose of episode 2 scene "s2-2-debrief": "each one fed straight into the blog while the friend group reacts.". The authored turn must be dramatized on-page, not dropped or truncated.',
    })).toBe(true);
  });

  it('selects repairable scene-turn warnings beyond treatment Story Circle misses', () => {
    const repairable = sceneTurnWarningsForRepair(passingReport);
    expect(repairable).toHaveLength(1);
    expect(repairable[0]).toMatchObject({
      validator: 'SceneTurnRealizationValidator',
      sceneId: 's1',
      severity: 'error',
    });
  });

  it('discards failed advisory rewrites and preserves the original passing report', () => {
    const target = storyWithBeat('original prose');
    const candidate = storyWithBeat('bad advisory rewrite');

    const result = applySceneTurnWarningRepairOutcome(target, passingReport, {
      story: candidate,
      passed: false,
      report: {
        passed: false,
        blockingIssues: [{ validator: 'RequiredBeatRealizationValidator', message: 'new blocker' }],
      },
    });

    expect(result.committed).toBe(false);
    expect(result.report).toBe(passingReport);
    expect(target.episodes[0].scenes[0].beats?.[0].text).toBe('original prose');
  });

  it('discards advisory rewrites that do not reduce scene-turn warnings', () => {
    const target = storyWithBeat('original prose');
    const candidate = storyWithBeat('same-warning advisory rewrite');
    const repairedReport = { ...passingReport };

    const result = applySceneTurnWarningRepairOutcome(target, passingReport, {
      story: candidate,
      passed: true,
      report: repairedReport as unknown as FinalStoryContractReport,
    });

    expect(result.committed).toBe(false);
    expect(result.report).toBe(passingReport);
    expect(target.episodes[0].scenes[0].beats?.[0].text).toBe('original prose');
  });

  it('commits advisory rewrites only when revalidation passes and scene-turn warnings improve', () => {
    const target = storyWithBeat('original prose');
    const candidate = storyWithBeat('improved advisory rewrite');
    const repairedReport = { passed: true, blockingIssues: [], warnings: [] };

    const result = applySceneTurnWarningRepairOutcome(target, passingReport, {
      story: candidate,
      passed: true,
      report: repairedReport,
    });

    expect(result.committed).toBe(true);
    expect(result.report).toBe(repairedReport);
    expect(target.episodes[0].scenes[0].beats?.[0].text).toBe('improved advisory rewrite');
  });
});

describe('repairPrematureFutureSeasonColdOpenReferences', () => {
  it('removes future-season Casa Lupului assignment language from the first scene', () => {
    const story = storyWithBeat("Are there actual vampires up at Casa Lupului? Because this whole slow-burn mountain weekend assignment is giving me vibes.");
    const beat = story.episodes[0].scenes[0].beats![0] as any;
    beat.choices = [{
      id: 'choice-1',
      text: 'Text your contact.',
      outcomeText: 'Before your weekend at Casa Lupului, we must discuss the new rules for the blog. Your success depends on the allies you make. This is an explicit demand to check in.',
    }];

    const touched = repairPrematureFutureSeasonColdOpenReferences(story);
    const text = JSON.stringify(story.episodes[0].scenes[0]);

    expect(touched).toBe(2);
    expect(text).not.toContain('Casa Lupului');
    expect(text).not.toContain('slow-burn mountain weekend');
    expect(text).toContain('Bucharest reboot');
    expect(text).toContain('first night');
  });

  it('removes future-season Casa Lupului language from later Episode 1 scenes', () => {
    const story = storyWithBeat('The cold open stays local.');
    story.episodes[0].scenes.push({
      id: 's1-rooftop-setup',
      name: 'Rooftop bar at sunset',
      beats: [{
        id: 'b2',
        text: 'Mika warns that Victor wants a slow-burn mountain weekend at his estate, Casa Lupului.',
      }],
      choices: [],
    } as never);

    const touched = repairPrematureFutureSeasonColdOpenReferences(story);
    const text = JSON.stringify(story.episodes[0].scenes[1]);

    expect(touched).toBe(1);
    expect(text).not.toContain('Casa Lupului');
    expect(text).not.toContain('slow-burn mountain weekend');
  });
});

describe('reconcileQaReportForCurrentStory', () => {
  it('removes stale blog-publish QA continuity errors after deterministic story repair', () => {
    const story = {
      id: 'bite-me',
      title: 'Bite Me',
      genre: 'paranormal romance',
      synopsis: '',
      coverImage: '',
      initialState: { attributes: {} as never, skills: {} as never, tags: [], inventory: [] },
      npcs: [],
      episodes: [{
        id: 'ep1',
        number: 1,
        title: 'Dating After Dusk',
        synopsis: '',
        coverImage: '',
        startingSceneId: 's1-6',
        scenes: [
          {
            id: 's1-6',
            name: 'Drafting the Post',
            startingBeatId: 's1-6-beat-5',
            beats: [
              { id: 's1-6-beat-5', text: "You stop before the final click. Instead, you save a private draft titled 'Mr. Midnight,' the words bright and dangerous on the screen." },
              { id: 's1-6-beat-6', text: 'When you wake, your phone has a handful of texts from Mika and a dozen ordinary emails. You open the blog dashboard and the draft is still waiting, unsent but alive enough to make your pulse jump.' },
            ],
            choices: [],
          },
          {
            id: 's1-9',
            name: 'Publish',
            startingBeatId: 's1-9-beat-5',
            beats: [
              { id: 's1-9-beat-5', text: "The post is titled 'Mr. Midnight.' Your blog, Dating After Dusk, waits. Your cursor blinks over the 'Publish' button." },
              { id: 's1-9-beat-6', text: "You click. The page refreshes, the single word 'Published' stark against the white background." },
            ],
            choices: [],
          },
        ],
      }],
    } as unknown as Story;

    const qaReport = {
      continuity: {
        overallScore: 70,
        issueCount: { errors: 1, warnings: 0, suggestions: 0 },
        issues: [{
          severity: 'error',
          type: 'timeline_error',
          location: { sceneId: 's1-6', beatId: 's1-6-beat-5' },
          description: "Kylie publishes the blog post 'Dating After Dusk' in s1-6-beat-5. However, in s1-9-beat-5, she publishes the same blog post again, titled 'Dating After Dusk', with the post 'Mr. Midnight.'",
          suggestedFix: 'Remove the blog publication from s1-6-beat-5 or s1-9-beat-5.',
          conflictsWith: 's1-9-beat-5',
        }],
        passedChecks: [],
        recommendations: [],
      },
      voice: { overallScore: 90, characterScores: [], issues: [], distinctionScore: 90, recommendations: [] },
      stakes: {
        overallScore: 90,
        choiceSetAnalysis: [],
        metrics: { averageStakesScore: 90, falseChoiceCount: 0, dilemmaQuality: 90, varietyScore: 90 },
        issues: [],
        strengths: [],
        recommendations: [],
      },
      overallScore: 83,
      passesQA: false,
      criticalIssues: ['1 continuity error(s)'],
      summary: '',
    };

    const reconciled = reconcileQaReportForCurrentStory(qaReport as never, story);

    expect(reconciled).not.toBe(qaReport);
    expect(reconciled?.continuity.issues).toEqual([]);
    expect(reconciled?.continuity.issueCount.errors).toBe(0);
    expect(reconciled?.criticalIssues).toEqual([]);
    expect(reconciled?.passesQA).toBe(true);
  });
});

describe('repairDiceMetaphorMechanicsLeakage', () => {
  it('rewrites safe dice metaphors without touching story structure', () => {
    const story = storyWithBeat('A tram rattles two streets over, a sound like dice in a wooden cup. You breathe.');
    const beat = story.episodes[0].scenes[0].beats![0];
    expect(new MechanicsLeakageValidator().validate({
      texts: [{ id: beat.id, text: beat.text, sceneId: 's1', beatId: beat.id }],
    }).valid).toBe(false);

    const touched = repairDiceMetaphorMechanicsLeakage(story);

    expect(touched).toBe(1);
    expect(beat.text).toContain('like pebbles in a wooden cup');
    expect(new MechanicsLeakageValidator().validate({
      texts: [{ id: beat.id, text: beat.text, sceneId: 's1', beatId: beat.id }],
    }).valid).toBe(true);
  });

  it('rewrites safe dice-on-velvet metaphors from viral-count prose', () => {
    const story = storyWithBeat('The numbers blur past ten thousand. They finally slow, settling like dice on a velvet cloth. Eighty-thousand reads.');
    const beat = story.episodes[0].scenes[0].beats![0];
    expect(new MechanicsLeakageValidator().validate({
      texts: [{ id: beat.id, text: beat.text, sceneId: 's1', beatId: beat.id }],
    }).valid).toBe(false);

    const touched = repairDiceMetaphorMechanicsLeakage(story);

    expect(touched).toBe(1);
    expect(beat.text).toContain('settling like pearls on velvet');
    expect(new MechanicsLeakageValidator().validate({
      texts: [{ id: beat.id, text: beat.text, sceneId: 's1', beatId: beat.id }],
    }).valid).toBe(true);
  });

  it('rewrites dice idioms in player-facing choice reactions', () => {
    const story = storyWithBeat('You close the laptop.');
    const beat = story.episodes[0].scenes[0].beats![0] as any;
    beat.choices = [{
      id: 'choice-1',
      text: 'Pitch the partnership',
      reactionText: "You've rolled the dice, turning panic into a calculated business proposition.",
    }];

    const touched = repairDiceMetaphorMechanicsLeakage(story);

    expect(touched).toBe(1);
    expect(beat.choices[0].reactionText).toBe("You've taken the gamble, turning panic into a calculated business proposition.");
  });

  it('tolerates object-shaped variants and choices during final-contract revalidation', () => {
    const story = storyWithBeat('You close the laptop.');
    const beat = story.episodes[0].scenes[0].beats![0] as any;
    beat.textVariants = {
      cautious: { text: 'The thought lands like dice on velvet.' },
      empty: null,
    };
    beat.choices = {
      risky: {
        text: 'Publish anyway',
        reactionText: "You've rolled the dice with everyone watching.",
      },
    };

    const touched = repairDiceMetaphorMechanicsLeakage(story);

    expect(touched).toBe(2);
    expect(beat.textVariants.cautious.text).toBe('The thought lands like pearls on velvet.');
    expect(beat.choices.risky.reactionText).toBe("You've taken the gamble with everyone watching.");
  });
});

describe('repairPlanningRegisterMetadataLeakage', () => {
  it('rewrites MVP FaceTime thesis cards in scene turn contracts', () => {
    const story = storyWithBeat('Sadie squints through FaceTime. "Are there vampires in Romania?" Kylie laughs and twists the chain in the sunset.');
    const scene = story.episodes[0].scenes[0] as any;
    scene.turnContract = {
      centralTurn: "A FaceTime gag that quietly seeds everything — Sadie asks *are there vampires in Romania?* and Kylie answers *only the boys I'm going to date, baby.* First strong image: the gold chain catching the last sun through a Belle Époque window; promise of reinvention and glamour; the joke is the season's thesis in disguise.",
      turnEvent: "A FaceTime gag that quietly seeds everything — Sadie asks *are there vampires in Romania?* and Kylie answers *only the boys I'm going to date, baby.* First strong image: the gold chain catching the last sun through a Belle Époque window; promise of reinvention and glamour; the joke is the season's thesis in disguise.",
    };

    expect(new PlanningRegisterLeakValidator().validate({ story }).findings).toHaveLength(6);
    const touched = repairPlanningRegisterMetadataLeakage(story);

    expect(touched).toBe(2);
    expect(scene.turnContract.centralTurn).toBe('Sadie asks whether there are vampires in Romania, and Kylie jokes that only the boys she is going to date count.');
    expect(new PlanningRegisterLeakValidator().validate({ story }).findings).toHaveLength(0);
  });

  it('replaces generic per-beat sequence-intent placeholders from the beat prose', () => {
    const story = storyWithBeat('Victor catches your wrist before the shadow reaches you, and the park goes silent.');
    const beat = story.episodes[0].scenes[0].beats![0] as any;
    beat.sequenceIntent = {
      objective: 'development scene 5',
      obstacle: 'development scene 5',
    };

    expect(new PlanningRegisterLeakValidator().validate({ story }).findings).toHaveLength(2);
    const touched = repairPlanningRegisterMetadataLeakage(story);

    expect(touched).toBe(2);
    expect(beat.sequenceIntent.objective).toBe('Victor catches your wrist before the shadow reaches you, and the park goes silent.');
    expect(beat.sequenceIntent.obstacle).toBe('The current pressure resists an easy answer.');
    expect(new PlanningRegisterLeakValidator().validate({ story }).findings).toHaveLength(0);
  });

  it('rewrites stale aftermath pressure turn contracts from the actual scene event', () => {
    const story = storyWithBeat('You publish the Mr. Midnight post. By dawn, the readership counter is spinning past 80,000.');
    const scene = story.episodes[0].scenes[0] as any;
    scene.turnContract = {
      centralTurn: "Aftermath pressure changes the protagonist's footing around Kylie arrives in Bucharest with two suitcases and her grandmother's address, gathering....",
    };

    const touched = repairPlanningRegisterMetadataLeakage(story);

    expect(touched).toBe(1);
    expect(scene.turnContract.centralTurn).toBe('Kylie publishes the Mr. Midnight post and wakes to viral public pressure.');
  });
});

describe('Bite Me final-contract prose polish repairs', () => {
  it('rewrites planning-register residue hints that refer to the next scene', () => {
    const story = storyWithBeat('Mika watches your answer land across the table.');
    const choice = {
      id: 'c1',
      text: 'Side with him.',
      residueHints: [{
        kind: 'relationship_behavior',
        targetNpcId: 'char-victor-vlcescu',
        description: 'Him will address you directly in the next scene, bypassing Stela.',
      }],
    };
    (story.episodes[0].scenes[0].beats![0] as any).choices = [choice];

    const touched = repairChoiceResiduePlanningRegisterLeakage(story);

    expect(touched).toBe(1);
    expect(choice.residueHints[0].description).toBe('Victor treats this choice as a visible shift in trust, distance, or leverage.');
  });

  it('removes premature Victor references from cold-open choices before he is introduced', () => {
    const story = storyWithBeat('Sadie asks if there are vampires in Romania.');
    const choice = {
      id: 'c1',
      text: "Text Victor. I'm here. Where should I go first?",
      reactionText: 'Victor treats the immediate text as a sign of trust.',
      consequences: [{ type: 'relationship', npcId: 'victor_stoica', dimension: 'trust', change: 5 }],
      residueHints: [{
        kind: 'relationship_behavior',
        targetNpcId: 'victor_stoica',
        description: 'Victor will mention her immediate text as a sign of trust when they meet.',
      }],
    };
    (story.episodes[0].scenes[0].beats![0] as any).choices = [choice];

    const touched = repairPrematureVictorColdOpenReferences(story);

    expect(touched).toBeGreaterThanOrEqual(5);
    expect(JSON.stringify(choice)).not.toMatch(/\bVictor|victor_stoica\b/);
    expect(choice.text).toContain('Text your contact');
    expect(choice.consequences[0].npcId).toBe('char-mika-drgan');
  });

  it('re-homes viral Story Circle contracts from the walk-home scene to the blog scene', () => {
    const story = storyWithBeat('The rescue happens in the fog.');
    const walkHome = story.episodes[0].scenes[0] as any;
    walkHome.id = 's1-1';
    walkHome.name = 'Victor walks Kylie home';
    walkHome.storyCircleBeatContracts = [{
      id: 'viral',
      beat: 'you',
      sourceText: 'the viral Mr Midnight post changes the aftermath by making her a name',
      targetSceneIds: ['s1-1'],
    }];
    story.episodes[0].scenes.push({
      id: 's1-blog-aftermath',
      name: 'The post becomes public pressure',
      beats: [{ id: 'b2', text: 'The Mr. Midnight blog post goes viral and the readership count climbs.' }],
      choices: [],
    } as never);

    const touched = repairMisboundStoryCircleContracts(story);

    expect(touched).toBe(1);
    expect(walkHome.storyCircleBeatContracts).toHaveLength(0);
    expect((story.episodes[0].scenes[1] as any).storyCircleBeatContracts[0].targetSceneIds).toEqual(['s1-blog-aftermath']);
  });

  it('re-homes planned Dusk Club Story Circle contracts using assembled story evidence', () => {
    const story = storyWithBeat('Victor walks beside you through the fog.');
    const walkHome = story.episodes[0].scenes[0] as any;
    walkHome.id = 's1-1';
    walkHome.name = 'Victor walks Kylie home';
    story.episodes[0].scenes.push({
      id: 's1-rooftop-setup',
      name: 'Rooftop bar at sunset',
      beats: [{ id: 'b2', text: 'Mika gathers the Dusk Club over too-dark negronis on the rooftop.' }],
      choices: [],
    } as never);
    const scenePlan = {
      scenes: [{
        id: 's1-1',
        episodeNumber: 1,
        storyCircleBeatContracts: [{
          id: 'dusk-club',
          beat: 'you',
          sourceText: 'gathers the Dusk Club over too-dark negronis',
          targetSceneIds: ['s1-1'],
        }],
      }, {
        id: 's1-rooftop-setup',
        episodeNumber: 1,
      }],
    } as any;

    const touched = repairMisboundStoryCirclePlanContracts(story, scenePlan);

    expect(touched).toBe(1);
    expect(scenePlan.scenes[0].storyCircleBeatContracts).toHaveLength(0);
    expect(scenePlan.scenes[1].storyCircleBeatContracts[0].targetSceneIds).toEqual(['s1-rooftop-setup']);
  });

  it('does not re-home staged rescue contracts to the blog aftermath just because Mr. Midnight is named there', () => {
    const story = storyWithBeat('Two figures surge from the alley; a man in black drops the attacker in the fog.');
    const rescueScene = story.episodes[0].scenes[0] as any;
    rescueScene.id = 's1-1';
    rescueScene.name = 'Victor walks Kylie home';
    rescueScene.storyCircleBeatContracts = [{
      id: 'rescue',
      beat: 'you',
      sourceText: 'The staged rescue happens.',
      targetSceneIds: ['s1-1'],
    }];
    story.episodes[0].scenes.push({
      id: 's1-blog-aftermath',
      name: 'The post becomes public pressure',
      beats: [{ id: 'b2', text: 'The Mr. Midnight blog post goes viral and the readership count climbs.' }],
      choices: [],
    } as never);

    const touched = repairMisboundStoryCircleContracts(story);

    expect(touched).toBe(0);
    expect(rescueScene.storyCircleBeatContracts).toHaveLength(1);
    expect((story.episodes[0].scenes[1] as any).storyCircleBeatContracts).toBeUndefined();
  });

  it('drops generic future Story Circle contracts misbound to the Bite Me cold open', () => {
    const story = storyWithBeat('Sadie asks whether there are vampires in Romania while Kylie arrives in Bucharest.');
    const coldOpen = story.episodes[0].scenes[0] as any;
    coldOpen.id = 's1-arrival-cold-open';
    coldOpen.name = 'Kylie arrives in Bucharest';
    coldOpen.storyCircleBeatContracts = [{
      id: 'you',
      beat: 'you',
      sourceText: 'She arrives in Bucharest with two suitcases and her grandmother address',
      targetSceneIds: ['s1-arrival-cold-open'],
    }, {
      id: 'search',
      beat: 'search',
      sourceText: 'Test adaptation under pressure through failed plans, new rules, allies, tools, and identity-revealing choices: The slow-burn mountain weekend in Bucharest and Victor first explicit demand.',
      targetSceneIds: ['s1-arrival-cold-open'],
    }, {
      id: 'take',
      beat: 'take',
      sourceText: "Make the episode's find cost something visible: Radu's confession, Carmen framed and hospitalized, and the black rose breaching the apartment.",
      targetSceneIds: ['s1-arrival-cold-open'],
    }];

    const touched = repairMisboundStoryCircleContracts(story);

    expect(touched).toBe(2);
    expect(coldOpen.storyCircleBeatContracts).toEqual([expect.objectContaining({ id: 'you' })]);
  });

  it('adds staged-rescue language when the treatment contract requires it', () => {
    const story = storyWithBeat('A blur of black wool erupts from the fog and the attacker drops on the cobblestones.');
    const scene = story.episodes[0].scenes[0] as any;
    scene.id = 's1-1';
    scene.storyCircleBeatContracts = [{
      id: 'rescue',
      beat: 'you',
      sourceText: 'The staged rescue happens.',
      targetSceneIds: ['s1-1'],
    }];

    const touched = repairStagedRescueExplicitness(story);

    expect(touched).toBe(1);
    expect(scene.beats[0].text).toMatch(/staged precision/);
  });

  it('collapses repeated staged-rescue repair prefixes instead of stacking them', () => {
    const story = storyWithBeat('The rescue happens with staged precision, too perfect to feel accidental. The rescue happens with staged precision, too perfect to feel accidental. A blur of black wool erupts from the fog and the attacker drops on the cobblestones.');
    const scene = story.episodes[0].scenes[0] as any;
    scene.id = 's1-1';
    scene.storyCircleBeatContracts = [{
      id: 'rescue',
      beat: 'you',
      sourceText: 'The staged rescue happens.',
      targetSceneIds: ['s1-1'],
    }];

    const touched = repairStagedRescueExplicitness(story);

    expect(touched).toBe(1);
    expect(scene.beats[0].text.match(/The rescue happens with staged precision/g)).toHaveLength(1);
  });

  it('adds Dusk Club negronis gathering when the rooftop scene carries that treatment beat', () => {
    const story = storyWithBeat('The roof opens over Bucharest. Mika lifts her glass from a velvet banquette as Stela watches the room.');
    const scene = story.episodes[0].scenes[0] as any;
    scene.id = 's1-rooftop-setup';
    scene.name = 'Rooftop bar at sunset';
    scene.storyCircleBeatContracts = [{
      id: 'dusk-club',
      beat: 'you',
      sourceText: 'gathers the Dusk Club over too-dark negronis',
      targetSceneIds: ['s1-rooftop-setup'],
    }];

    const touched = repairDuskClubNegronisGathering(story);
    const prose = scene.beats.map((beat: { text: string }) => beat.text).join(' ');

    expect(touched).toBe(1);
    expect(prose).toMatch(/Mika gathers the Dusk Club over too-dark negronis/);
  });

  it('does not add Dusk Club negronis gathering to the cold open when a treatment beat is misbound', () => {
    const story = storyWithBeat('Sadie rings through FaceTime while the last sunlight catches the hotel window.');
    const scene = story.episodes[0].scenes[0] as any;
    scene.id = 's1-arrival-cold-open';
    scene.name = 'Arrival Cold Open';
    scene.storyCircleBeatContracts = [{
      id: 'dusk-club',
      beat: 'you',
      sourceText: 'gathers the Dusk Club over too-dark negronis',
      targetSceneIds: ['s1-arrival-cold-open'],
    }];

    const touched = repairDuskClubNegronisGathering(story);
    const prose = scene.beats.map((beat: { text: string }) => beat.text).join(' ');

    expect(touched).toBe(0);
    expect(prose).not.toMatch(/Mika gathers the Dusk Club/);
  });

  it('restores the Bite Me cold-open vampire/date gag when scene prose loses the exact turn', () => {
    const story = storyWithBeat('Sadie looks at you through FaceTime. "Did you go to Bucharest to find them or something?" You laugh into the last sunlight.');
    const scene = story.episodes[0].scenes[0] as any;
    scene.id = 's1-arrival-cold-open';
    scene.name = 'Arrival Cold Open';
    scene.turnContract = {
      centralTurn: 'Sadie asks whether there are vampires in Romania, and Kylie jokes that only the boys she is going to date count.',
    };

    const touched = repairBiteMeColdOpenVampireDateGag(story);

    expect(touched).toBe(1);
    expect(scene.beats[0].text).toMatch(/Are there vampires in Romania\?/);
    expect(scene.beats[0].text).toMatch(/Only the boys I'm going to date, baby\./);
  });

  it('replaces visual-contract leakage in the Bite Me opening beat even when the gag exists later', () => {
    const story = storyWithBeat('Kylie Marinescu\'s composed surface slips through a small evasive movement as her hands and attention lock onto the window.');
    const scene = story.episodes[0].scenes[0] as any;
    scene.id = 's1-arrival-cold-open';
    scene.name = 'Arrival Cold Open';
    scene.turnContract = {
      centralTurn: 'Sadie asks whether there are vampires in Romania, and Kylie jokes that only the boys she is going to date count.',
    };
    scene.beats[0].visualMoment = scene.beats[0].text;
    scene.beats.push({
      id: 'b2',
      text: 'Sadie crackles back: "Are there vampires in Romania?"',
    }, {
      id: 'b3',
      text: '"Only the boys I\'m going to date, baby."',
    });

    const touched = repairBiteMeColdOpenVampireDateGag(story);

    expect(touched).toBe(1);
    expect(scene.beats[0].text).toMatch(/^FaceTime freezes Sadie mid-laugh/);
    expect(scene.beats[0].text).toMatch(/Bucharest burning gold/);
    expect(scene.beats[0].text).not.toMatch(/Are there vampires in Romania/);
    expect(scene.beats[0].text).not.toMatch(/composed surface slips|subtext visible/i);
    expect(scene.beats[0].visualMoment).not.toMatch(/composed surface slips|subtext visible/i);
  });

  it('normalizes an in-scene vampire answer instead of duplicating the whole gag', () => {
    const story = storyWithBeat('FaceTime freezes Sadie mid-laugh over the Bucharest window.');
    const scene = story.episodes[0].scenes[0] as any;
    scene.id = 's1-arrival-cold-open';
    scene.name = 'Arrival Cold Open';
    scene.turnContract = {
      centralTurn: 'Sadie asks whether there are vampires in Romania, and Kylie jokes that only the boys she is going to date count.',
    };
    scene.beats.push({
      id: 'b2',
      text: 'Sadie crackles back: "Are there vampires in Romania?"',
    }, {
      id: 'b3',
      text: 'You touch the gold chain. "Only the ones I’m going to date, baby."',
    });

    const touched = repairBiteMeColdOpenVampireDateGag(story);
    const prose = scene.beats.map((beat: { text: string }) => beat.text).join(' ');

    expect(touched).toBe(1);
    expect(prose.match(/Are there vampires in Romania/g)).toHaveLength(1);
    expect(prose).toMatch(/Only the boys I'm going to date, baby/);
  });

  it('removes a prepended duplicate vampire/date gag from the cold-open question beat', () => {
    const story = storyWithBeat('FaceTime freezes Sadie mid-laugh over the Bucharest window.');
    const scene = story.episodes[0].scenes[0] as any;
    scene.id = 's1-arrival-cold-open';
    scene.name = 'Arrival Cold Open';
    scene.turnContract = {
      centralTurn: 'Sadie asks whether there are vampires in Romania, and Kylie jokes that only the boys she is going to date count.',
    };
    scene.beats.push({
      id: 'b2',
      text: 'Sadie squints through FaceTime. "Are there vampires in Romania?" You smile into the last sunlight. "Only the boys I\'m going to date, baby." Sadie’s voice crackles back to life. “—so you’re really there. Okay, serious question. Are there vampires in Romania?”',
    }, {
      id: 'b3',
      text: 'You touch the gold chain. "Only the boys I\'m going to date, baby."',
    });

    const touched = repairBiteMeColdOpenVampireDateGag(story);
    const prose = scene.beats.map((beat: { text: string }) => beat.text).join(' ');

    expect(touched).toBe(1);
    expect(prose.match(/Are there vampires in Romania/g)).toHaveLength(1);
    expect(scene.beats[1].text).toMatch(/^Sadie’s voice crackles back to life/);
    expect(scene.beats[1].text).not.toMatch(/^Sadie squints through FaceTime/);
  });

  it('reroutes Bite Me Episode 1 MVP scenes so the walk-home rescue happens after the rooftop and park encounter', () => {
    const story = storyWithBeat('Arrival.');
    const episode = story.episodes[0] as any;
    episode.scenes = [{
      id: 's1-arrival-cold-open',
      name: 'Kylie arrives in Bucharest',
      beats: [{
        id: 'arrival-bridge',
        text: 'The apartment goes quiet.',
        nextSceneId: 's1-1',
      }],
      choices: [],
    }, {
      id: 's1-1',
      name: 'Victor walks Kylie home',
      beats: [{
        id: 'walk-1',
        text: "The cobblestones are slick under your heels. Victor's hand is a steady, warm pressure at the small of your back, guiding you away from the chaos of the park.",
        visualMoment: "Victor's hand rests at the small of Kylie's back as they walk down a narrow, lamp-lit cobblestone street at night.",
        primaryAction: 'Victor guides Kylie down the street',
        relationshipDynamic: 'Victor is a physical protector, establishing an intimate but non-threatening closeness with Kylie.',
      }, {
        id: 'walk-end',
        text: 'You stand in the doorway.',
        nextSceneId: 's1-blog-aftermath',
      }],
      choices: [],
    }, {
      id: 's1-blog-aftermath',
      name: 'The post becomes public pressure',
      beats: [{
        id: 'blog-end',
        text: 'The Mr. Midnight post goes viral.',
        nextSceneId: 's1-rooftop-setup',
      }],
      choices: [],
    }, {
      id: 's1-rooftop-setup',
      name: 'Rooftop bar at sunset',
      beats: [{
        id: 'rooftop-end',
        text: 'Mika introduces Victor Vâlcescu on the rooftop.',
        nextSceneId: 'treatment-enc-1-1',
      }],
      choices: [],
    }, {
      id: 'treatment-enc-1-1',
      name: 'Cișmigiu attack at 1am',
      beats: [],
      encounter: {
        outcomes: {
          victory: { nextSceneId: 's1-3', outcomeText: 'You survive.' },
          partialVictory: { nextSceneId: 's1-3', outcomeText: 'You survive at a cost.' },
        },
        storylets: {
          victory: { nextSceneId: 's1-3', beats: [] },
        },
      },
      choices: [],
    }, {
      id: 's1-3',
      name: 'At the bookshop',
      beats: [],
      choices: [],
    }];

    const touched = repairBiteMeEpisodeOneMvpOrdering(story);

    expect(touched).toBeGreaterThanOrEqual(5);
    expect(episode.scenes.map((scene: { id: string }) => scene.id).slice(0, 5)).toEqual([
      's1-arrival-cold-open',
      's1-rooftop-setup',
      'treatment-enc-1-1',
      's1-1',
      's1-blog-aftermath',
    ]);
    expect(episode.scenes[0].beats[0].nextSceneId).toBe('s1-rooftop-setup');
    expect(episode.scenes[2].encounter.outcomes.victory.nextSceneId).toBe('s1-1');
    expect(episode.scenes[2].encounter.storylets.victory.nextSceneId).toBe('s1-1');
    expect(episode.scenes[3].beats[0].text).toMatch(/the man Mika introduced under rooftop lights/);
    expect(episode.scenes[3].beats[0].text).not.toMatch(/small of your back/);
    expect(episode.scenes[4].beats[0].nextSceneId).toBe('episode-end');
  });

  it('keeps Victor as the rescuer throughout the Bite Me park encounter instead of leaking Radu into the staged rescue', () => {
    const story = storyWithBeat('Arrival.');
    const episode = story.episodes[0] as any;
    episode.scenes = [{
      id: 'treatment-enc-1-1',
      name: 'Cișmigiu attack at 1am',
      beats: [],
      encounter: {
        description: 'Cișmigiu at 1am: fog, a shadow, and Victor rescuing you from the attack.',
        phases: [{
          beats: [{
            setupText: 'Radu steps directly into your path. "Stop right there," Radu\'s grounded voice commands.',
            choices: [{
              outcomes: {
                success: {
                  narrativeText: 'You slide on the wet grass, using his broad frame as a shield. Radu does not flinch.',
                  nextSituation: {
                    setupText: 'Radu Stoian strides forward from the trees, flicking a heavy silver lighter into a pile of dry brush.',
                  },
                },
              },
            }],
          }],
        }],
        outcomes: {
          victory: { nextSceneId: 's1-1', outcomeText: 'Radu watches from the glass doors, a silent sentinel.' },
        },
      },
      choices: [],
    }];

    const touched = repairBiteMeParkEncounterRescuerIdentity(story);
    const encounterText = JSON.stringify(episode.scenes[0].encounter);

    expect(touched).toBe(4);
    expect(encounterText).not.toMatch(/\bRadu\b/);
    expect(encounterText).toMatch(/Victor steps directly into your path/);
    expect(encounterText).toMatch(/Victor's grounded voice/);
    expect(encounterText).toMatch(/Victor Vâlcescu strides forward/);
  });

  it('removes text variants that name an NPC before their cast introduction', () => {
    const story = storyWithBeat('Victor walks beside you through the fog.');
    story.npcs = [
      { id: 'char-mika-drgan', name: 'Mika Drăgan' },
      { id: 'char-victor-vlcescu', name: 'Victor Vâlcescu' },
    ] as any;
    const walkHome = story.episodes[0].scenes[0] as any;
    walkHome.id = 's1-1';
    walkHome.charactersInvolved = ['char-victor-vlcescu'];
    walkHome.beats[0].textVariants = [{
      condition: { flag: 'mika_tell_seen' },
      text: 'Mika Drăgan warned you away from Victor on the rooftop.',
    }];
    story.episodes[0].scenes.push({
      id: 's1-rooftop-setup',
      name: 'Rooftop bar at sunset',
      charactersInvolved: ['char-mika-drgan'],
      beats: [{ id: 'b2', text: 'Mika Drăgan waves you over from the velvet booth.' }],
      choices: [],
    } as never);

    const touched = repairPrematureUncastNpcTextVariants(story);

    expect(touched).toBe(1);
    expect(walkHome.beats[0].textVariants).toHaveLength(0);
  });

  it('removes main beat prose sentences that name NPCs before their cast introduction', () => {
    const story = storyWithBeat('The FaceTime chime cuts through the room. Mika gathers the Dusk Club over too-dark negronis. Sadie says the Mr. Midnight post is live.');
    story.npcs = [
      { id: 'char-mika-drgan', name: 'Mika Drăgan' },
      { id: 'char-stela-pavel', name: 'Stela Pavel' },
      { id: 'char-sadie', name: 'Sadie' },
    ] as any;
    const coldOpen = story.episodes[0].scenes[0] as any;
    coldOpen.id = 's1-arrival-cold-open';
    coldOpen.charactersInvolved = ['char-sadie'];
    story.episodes[0].scenes.push({
      id: 's1-blog-aftermath',
      name: 'The post becomes public pressure',
      charactersInvolved: ['char-kylie-marinescu'],
      beats: [{ id: 'b2', text: "The phone buzzes again. It's Mika. Then Stela. The story is out of your hands now." }],
      choices: [],
    } as never);
    story.episodes[0].scenes.push({
      id: 's1-rooftop-setup',
      name: 'Rooftop bar at sunset',
      charactersInvolved: ['char-mika-drgan', 'char-stela-pavel'],
      beats: [{ id: 'b3', text: 'Mika Drăgan waves you over while Stela Pavel studies the room.' }],
      choices: [],
    } as never);

    const touched = repairPrematureUncastNpcTextVariants(story);

    expect(touched).toBe(3);
    expect(coldOpen.beats[0].text).not.toMatch(/\bMika\b/);
    expect(coldOpen.beats[0].text).toMatch(/\bSadie\b/);
    expect((story.episodes[0].scenes[1] as any).beats[0].text).not.toMatch(/\bMika\b|\bStela\b/);
  });

  it('keeps one Dusk Club toast and rewrites repeated glass-click choreography', () => {
    const story = storyWithBeat('“To the Dusk Club,” Mika says.');
    story.episodes[0].scenes[0].beats!.push({
      id: 'b2',
      text: 'You clink your glass against theirs, the sound sharp in the evening air.',
    } as never);

    const touched = repairRepetitiveToastMotif(story);
    const prose = story.episodes[0].scenes[0].beats!.map((beat) => beat.text).join(' ');

    expect(touched).toBe(1);
    expect(prose).toContain('You lift your glass');
    expect(prose).not.toMatch(/\byour glass clicked against theirs|You clink your glass against theirs\b/i);
  });

  it('makes the viral Mr. Midnight aftermath explicit when the prose only implies it', () => {
    const story = storyWithBeat('You name him Mr. Midnight and click publish.');
    story.episodes[0].scenes[0].beats!.push({
      id: 'b2',
      text: 'By dawn, notifications bury the screen and strangers argue in the comments.',
    } as never);

    const touched = repairViralMrMidnightAftermath(story);
    const prose = story.episodes[0].scenes[0].beats!.map((beat) => beat.text).join(' ');

    expect(touched).toBe(1);
    expect(prose).toMatch(/viral Mr\. Midnight post has made your name/i);
  });

  it('stages the Vâlcescu side-entrance key card when the rooftop scene only implies it later', () => {
    const story = storyWithBeat('The sky over Bucharest is bruised purple and gold. You find Stela and Mika at a corner table.');
    const scene = story.episodes[0].scenes[0] as any;
    scene.id = 's1-rooftop-setup';
    scene.name = 'Rooftop bar at sunset';

    const touched = repairValcescuSideEntranceKeyCardBeat(story);
    const prose = scene.beats.map((beat: { text: string }) => beat.text).join(' ');

    expect(touched).toBe(1);
    expect(prose).toMatch(/At the door of Vâlcescu Club, Mika presses a side-entrance key card into your palm/);
  });

  it('does not add the Vâlcescu key-card beat to unrelated Mika scenes', () => {
    const story = storyWithBeat('Mika texts from the rooftop later, but you stay in the apartment staring at the phone.');
    const scene = story.episodes[0].scenes[0] as any;
    scene.id = 's1-apartment-after';
    scene.name = 'Apartment aftermath';

    const touched = repairValcescuSideEntranceKeyCardBeat(story);

    expect(touched).toBe(0);
    expect(scene.beats[0].text).not.toContain('side-entrance key card');
  });
});

describe('repairVampireDaytimeMealCanon', () => {
  it('moves Victor breakfast/brunch prose to night-appropriate supper language', () => {
    const story = storyWithBeat('It always comes back to that last Sunday breakfast with Victor. He waited until the brunch rush had subsided. It was over that breakfast he made his first soft play. He pushed the last of his poached egg around his plate with a silver fork, the motion slow, deliberate.');

    const touched = repairVampireDaytimeMealCanon(story);
    const text = story.episodes[0].scenes[0].beats![0].text;

    expect(touched).toBe(1);
    expect(text).toContain('last Sunday supper with Victor');
    expect(text).toContain('dinner rush');
    expect(text).toContain('over that supper');
    expect(text).toContain('untouched wineglass');
    expect(text).not.toMatch(/\bbreakfast|brunch|poached egg\b/i);
  });

  it('repairs Victor brunch invitations and surrounding daytime cues across a scene', () => {
    const story = storyWithBeat('“Trending.” Mika gestures with her mimosa, the sunlight flashing off her rings. “And here you are, brunch at The Solstice with Victor Ciorba himself.”');
    story.episodes[0].scenes[0].beats!.push({ id: 'b2', text: 'Mika turns back to the brunch crowd.' } as never);

    const touched = repairVampireDaytimeMealCanon(story);
    const text = story.episodes[0].scenes[0].beats!.map((beat) => beat.text).join(' ');

    expect(touched).toBe(2);
    expect(text).toContain('coupe');
    expect(text).toContain('candlelight');
    expect(text).toContain('late supper at The Solstice with Victor Ciorba');
    expect(text).toContain('supper crowd');
    expect(text).not.toMatch(/\bbrunch|mimosa|sunlight\b/i);
  });
});
