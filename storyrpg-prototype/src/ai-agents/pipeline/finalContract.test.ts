import { describe, expect, it } from 'vitest';
import type { Story } from '../../types/story';
import type { FinalStoryContractReport } from '../validators';
import { MechanicsLeakageValidator } from '../validators/MechanicsLeakageValidator';
import { PlanningRegisterLeakValidator } from '../validators/PlanningRegisterLeakValidator';
import {
  applySceneTurnWarningRepairOutcome,
  allowsCompactRequiredBeatFallback,
  downgradeNonBlockingTreatmentObligations,
  repairChoiceResiduePlanningRegisterLeakage,
  repairDiceMetaphorMechanicsLeakage,
  repairRelationshipChoiceMovement,
  repairPlanningRegisterMetadataLeakage,
  repairPrematureUncastNpcTextVariants,
  selectFinalContractPlannedChoiceTypes,
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
    message: 'Scene "s1" does not dramatize its central turn on-page: "Jordan hands Avery the key card.".',
  }],
} as unknown as FinalStoryContractReport;

describe('scene-turn warning repair helpers', () => {
  it('prefers the run-scoped choice-type contract over stale season-plan scene types', () => {
    const seasonPlan = {
      scenePlan: {
        scenes: [{ id: 'scene-a', choiceType: 'expression' }],
      },
    } as never;

    expect(selectFinalContractPlannedChoiceTypes({ 'scene-a': 'relationship' }, seasonPlan)).toEqual({
      'scene-a': 'relationship',
    });
  });

  it('falls back to season-plan scene choice types when no run-scoped contract exists', () => {
    const seasonPlan = {
      scenePlan: {
        scenes: [{ id: 'scene-a', choiceType: 'strategic' }],
      },
    } as never;

    expect(selectFinalContractPlannedChoiceTypes(undefined, seasonPlan)).toEqual({
      'scene-a': 'strategic',
    });
  });

  it('downgrades abstract treatment ledger bundles before final hard abort', () => {
    const report = {
      passed: false,
      blockingIssues: [{
        type: 'treatment_event_ledger_violation',
        severity: 'error',
        validator: 'TreatmentEventLedgerValidator',
        sceneId: 's1-arrival',
        message: `Treatment event ledger summary-only realization in scene "s1-arrival": must dramatize on-page, not summarize as memory/backstory: "(Ep1): The protagonist's ordinary world is reinvention-as-performance. They arrive with two bags and an old address, gather new allies, and protect themselves by observing first and acting later. Opening promise: a stranger gets a new life and public attention. The rescue and public post close the beat by making them visible.".`,
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
  it('strips abstract thesis-card framing from scene turn contracts', () => {
    const story = storyWithBeat('Avery notices the brass key under the station lights and Jordan pockets it before anyone can ask.');
    const scene = story.episodes[0].scenes[0] as any;
    scene.turnContract = {
      centralTurn: "A small object that quietly seeds everything — Avery notices the brass key and Jordan pockets it before anyone can ask. First strong image: the key catching light under the station clock; promise of reinvention; the gesture is the season's thesis in disguise.",
      turnEvent: "A small object that quietly seeds everything — Avery notices the brass key and Jordan pockets it before anyone can ask. First strong image: the key catching light under the station clock; promise of reinvention; the gesture is the season's thesis in disguise.",
    };

    expect(new PlanningRegisterLeakValidator().validate({ story }).findings.length).toBeGreaterThan(0);
    const touched = repairPlanningRegisterMetadataLeakage(story);

    expect(touched).toBe(2);
    expect(scene.turnContract.centralTurn).not.toMatch(/quietly seeds|First strong image|season's thesis|promise of reinvention/i);
    expect(new PlanningRegisterLeakValidator().validate({ story }).findings).toHaveLength(0);
  });

  it('replaces generic per-beat sequence-intent placeholders from the beat prose', () => {
    const story = storyWithBeat('Jordan catches your wrist before the crowd reaches you, and the platform goes silent.');
    const beat = story.episodes[0].scenes[0].beats![0] as any;
    beat.sequenceIntent = {
      objective: 'development scene 5',
      obstacle: 'development scene 5',
    };

    expect(new PlanningRegisterLeakValidator().validate({ story }).findings.length).toBeGreaterThanOrEqual(2);
    const touched = repairPlanningRegisterMetadataLeakage(story);

    expect(touched).toBe(2);
    expect(beat.sequenceIntent.objective).toBe('Jordan catches your wrist before the crowd reaches you, and the platform goes silent.');
    expect(beat.sequenceIntent.obstacle).toBe('The current pressure resists an easy answer.');
    expect(new PlanningRegisterLeakValidator().validate({ story }).findings).toHaveLength(0);
  });

  it('rewrites stale aftermath pressure turn contracts from the actual scene event', () => {
    const story = storyWithBeat('You publish the Night Signal post. By dawn, the readership counter is spinning past 80,000.');
    const scene = story.episodes[0].scenes[0] as any;
    scene.turnContract = {
      centralTurn: "Aftermath pressure changes the protagonist's footing around Jordan arrives with two bags and an old address, gathering....",
    };

    const touched = repairPlanningRegisterMetadataLeakage(story);

    expect(touched).toBe(1);
    expect(scene.turnContract.centralTurn).toBe('You publish the Night Signal post.');
  });
});

describe('content-agnostic final-contract prose repairs', () => {
  it('rewrites planning-register residue hints that refer to the next scene', () => {
    const story = storyWithBeat('Avery watches your answer land across the table.');
    const choice = {
      id: 'c1',
      text: 'Side with him.',
      residueHints: [{
        kind: 'relationship_behavior',
        targetNpcId: 'char-jordan-vale',
        description: 'Him will address you directly in the next scene, bypassing Avery.',
      }],
    };
    (story.episodes[0].scenes[0].beats![0] as any).choices = [choice];

    const touched = repairChoiceResiduePlanningRegisterLeakage(story);

    expect(touched).toBe(1);
    expect(choice.residueHints[0].description).toBe('Jordan Vale treats this choice as a visible shift in trust, distance, or leverage.');
  });

  it('removes text variants that name an NPC before their cast introduction', () => {
    const story = storyWithBeat('Jordan walks beside you through the fog.');
    story.npcs = [
      { id: 'char-avery-stone', name: 'Avery Stone' },
      { id: 'char-jordan-vale', name: 'Jordan Vale' },
    ] as any;
    const earlyScene = story.episodes[0].scenes[0] as any;
    earlyScene.id = 's1-1';
    earlyScene.charactersInvolved = ['char-jordan-vale'];
    earlyScene.beats[0].textVariants = [{
      condition: { flag: 'avery_warning_seen' },
      text: 'Avery Stone warned you away from Jordan Vale before the meeting.',
    }];
    story.episodes[0].scenes.push({
      id: 's1-later-meeting',
      name: 'Later Meeting',
      charactersInvolved: ['char-avery-stone'],
      beats: [{ id: 'b2', text: 'Avery Stone waves you over from the far table.' }],
      choices: [],
    } as never);

    const touched = repairPrematureUncastNpcTextVariants(story);

    expect(touched).toBe(1);
    expect(earlyScene.beats[0].textVariants).toHaveLength(0);
  });

  it('removes main beat prose sentences that name NPCs before their cast introduction', () => {
    const story = storyWithBeat('The phone chime cuts through the room. Avery Stone names the locked archive. Sam says the post is live.');
    story.npcs = [
      { id: 'char-avery-stone', name: 'Avery Stone' },
      { id: 'char-jordan-vale', name: 'Jordan Vale' },
      { id: 'char-sam-rivera', name: 'Sam Rivera' },
    ] as any;
    const firstScene = story.episodes[0].scenes[0] as any;
    firstScene.id = 's1-first';
    firstScene.charactersInvolved = ['char-sam-rivera'];
    story.episodes[0].scenes.push({
      id: 's1-bridge',
      name: 'Bridge Scene',
      charactersInvolved: [],
      beats: [{ id: 'b2', text: "The phone buzzes again. It's Avery. Then Jordan. The story is out of your hands now." }],
      choices: [],
    } as never);
    story.episodes[0].scenes.push({
      id: 's1-later-meeting',
      name: 'Later Meeting',
      charactersInvolved: ['char-avery-stone', 'char-jordan-vale'],
      beats: [{ id: 'b3', text: 'Avery Stone waves you over while Jordan Vale studies the room.' }],
      choices: [],
    } as never);

    const touched = repairPrematureUncastNpcTextVariants(story);

    expect(touched).toBe(3);
    expect(firstScene.beats[0].text).not.toMatch(/\bAvery\b/);
    expect(firstScene.beats[0].text).toMatch(/\bSam\b/);
    expect((story.episodes[0].scenes[1] as any).beats[0].text).not.toMatch(/\bAvery\b|\bJordan\b/);
  });

  it('replaces all-premature payoff prose instead of leaving future NPC names intact', () => {
    const story = storyWithBeat('Jordan walks beside you through the fog.');
    story.npcs = [
      { id: 'char-avery-stone', name: 'Avery Stone' },
      { id: 'char-jordan-vale', name: 'Jordan Vale' },
    ] as any;
    const earlyScene = story.episodes[0].scenes[0] as any;
    earlyScene.id = 's1-1';
    earlyScene.charactersInvolved = ['char-jordan-vale'];
    earlyScene.beats.push({ id: 'b-payoff', text: 'Avery Stone seems amused by your caution.' });
    story.episodes[0].scenes.push({
      id: 's1-later-meeting',
      name: 'Later Meeting',
      charactersInvolved: ['char-avery-stone'],
      beats: [{ id: 'b2', text: 'Avery Stone waves you over from the far table.' }],
      choices: [],
    } as never);

    const touched = repairPrematureUncastNpcTextVariants(story);

    expect(touched).toBe(1);
    expect(earlyScene.beats[1].text).toBe('The moment leaves its consequence hanging in the air.');
  });

  it('repairs premature future NPC names in assembled choice outcome text', () => {
    const story = storyWithBeat('Jordan walks beside you through the fog.');
    story.npcs = [
      { id: 'char-avery-stone', name: 'Avery Stone' },
      { id: 'char-jordan-vale', name: 'Jordan Vale' },
    ] as any;
    const earlyScene = story.episodes[0].scenes[0] as any;
    earlyScene.id = 's1-1';
    earlyScene.charactersInvolved = ['char-jordan-vale'];
    earlyScene.beats[0].choices = [{
      id: 'c1',
      text: 'Wait for the signal.',
      outcomeTexts: {
        success: 'Avery Stone accepts the delay from across the room.',
        partial: 'Jordan notices the pause.',
      },
    }];
    story.episodes[0].scenes.push({
      id: 's1-later-meeting',
      name: 'Later Meeting',
      charactersInvolved: ['char-avery-stone'],
      beats: [{ id: 'b2', text: 'Avery Stone waves you over from the far table.' }],
      choices: [],
    } as never);

    const touched = repairPrematureUncastNpcTextVariants(story);

    expect(touched).toBe(1);
    expect(earlyScene.beats[0].choices[0].outcomeTexts.success).not.toMatch(/\bAvery\b/);
    expect(earlyScene.beats[0].choices[0].outcomeTexts.partial).toMatch(/\bJordan\b/);
  });

  it('adds movement and evidence to assembled relationship choices that bypassed ChoiceAuthor repair', () => {
    const story = storyWithBeat('Jordan waits for your answer.');
    const scene = story.episodes[0].scenes[0] as any;
    scene.charactersInvolved = ['char-protagonist', 'char-jordan-vale'];
    scene.relationshipPacing = [{
      id: 'rel-jordan',
      source: 'choice',
      npcId: 'char-jordan-vale',
      startStage: 'spark',
      targetStage: 'acquaintance',
      allowedLabels: ['guarded warmth'],
      blockedLabels: [],
      requiredEvidence: [],
      minScenesSinceIntroduction: 0,
      maxDeltaThisScene: 4,
      mechanicDimensions: ['trust'],
    }];
    scene.beats[0].choices = [{
      id: 'c1',
      text: 'Trust Jordan with the room.',
      choiceType: 'relationship',
      consequences: [{ type: 'setFlag', flag: 'trusted_jordan', value: true }],
    }];

    const touched = repairRelationshipChoiceMovement(story);

    expect(touched).toBe(1);
    expect(scene.beats[0].choices[0].consequences).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'relationship', npcId: 'char-jordan-vale' }),
    ]));
    expect(scene.beats[0].choices[0].relationshipValueEvidence).toEqual(expect.arrayContaining([
      expect.objectContaining({ npcId: 'char-jordan-vale', axis: 'trust' }),
    ]));
  });
});
