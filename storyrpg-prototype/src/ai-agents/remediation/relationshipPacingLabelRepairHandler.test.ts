import { describe, expect, it } from 'vitest';
import type { Story } from '../../types/story';
import { RelationshipArcLedgerValidator } from '../validators/RelationshipArcLedgerValidator';
import { buildRelationshipPacingLabelRepairHandler } from './relationshipPacingLabelRepairHandler';

function makeStory(): Story {
  return {
    id: 'relationship-repair-test',
    title: 'Relationship Repair Test',
    genre: 'paranormal-romance',
    synopsis: 'Test',
    initialState: {
      flags: {},
      attributes: {},
      resources: {},
      relationships: {},
      inventory: [],
      storyVariables: {},
      skills: {},
    },
    npcs: [{ id: 'mika', name: 'Mika' }],
    episodes: [{
      id: 'ep1',
      number: 1,
      title: 'Episode 1',
      startingSceneId: 's1-4',
      scenes: [{
        id: 's1-4',
        title: 'Prior Scene',
        name: 'Prior Scene',
        startingBeatId: 's1-4-b1',
        relationshipPacing: [{
          id: 's1-4-rel-mika',
          source: 'planner',
          npcId: 'mika',
          startStage: 'spark',
          targetStage: 'tentative_ally',
          allowedLabels: ['tentative ally'],
          blockedLabels: ['best friend', 'family', 'trusts completely'],
          requiredEvidence: ['show behavior before naming the bond'],
          minScenesSinceIntroduction: 0,
          maxDeltaThisScene: 8,
          mechanicDimensions: ['trust', 'affection'],
        }],
        beats: [{
          id: 's1-4-b1',
          text: 'Mika notices your fear and chooses to stand between you and the door.',
          choices: [{
            id: 'prior-choice',
            text: 'Let Mika help',
            nextSceneId: 's1-5',
            consequences: [{ type: 'relationship', npcId: 'mika', dimension: 'trust', change: 8 }],
          }],
        }],
      }, {
        id: 's1-5',
        title: 'Development Scene',
        name: 'Development Scene',
        startingBeatId: 's1-5-b1',
        relationshipPacing: [{
          id: 's1-5-rel-group',
          source: 'treatment',
          groupId: 'dusk-club',
          startStage: 'unmet',
          targetStage: 'spark',
          allowedLabels: ['invitation', 'dare', 'inside joke', 'provisional name', 'fragile beginning'],
          blockedLabels: ['inner circle', 'one of us', 'friends now'],
          requiredEvidence: ['make the group label provisional unless prior scenes earned it'],
          minScenesSinceIntroduction: 1,
          maxDeltaThisScene: 8,
          mechanicDimensions: ['trust', 'affection'],
        }, {
          id: 's1-5-rel-mika',
          source: 'treatment',
          npcId: 'mika',
          startStage: 'tentative_ally',
          targetStage: 'friend',
          allowedLabels: ['tentative ally', 'earned friend'],
          blockedLabels: ['best friend', 'family', 'trusts completely'],
          requiredEvidence: ['show behavior before naming the bond'],
          minScenesSinceIntroduction: 0,
          maxDeltaThisScene: 12,
          mechanicDimensions: ['trust', 'affection'],
        }],
        beats: [{
          id: 's1-5-b1',
          text: 'You tell yourself the glossy friend group is becoming real before anyone has risked anything.',
          textVariants: [{
            condition: { type: 'flag', flag: 'survived', value: true },
            text: 'The new friends gather around you too fast.',
          }],
          choices: [{
            id: 'c1',
            text: 'Push the story into Victor’s orbit.',
            reactionText: 'His inner circle begins a counter-intelligence operation to trace the source.',
            nextSceneId: 's1-6',
          }],
        }],
      }],
    }],
  } as unknown as Story;
}

describe('buildRelationshipPacingLabelRepairHandler', () => {
  it('downgrades unearned relationship labels in visible scene prose without touching navigation', async () => {
    const story = makeStory();
    const targetBeat = story.episodes[0].scenes[1].beats[0];
    const beforeChoice = JSON.stringify(targetBeat.choices?.[0]);
    const beforeNext = targetBeat.choices?.[0]?.nextSceneId;
    const initial = new RelationshipArcLedgerValidator().validate({ story, treatmentSourced: true });
    expect(initial.valid).toBe(false);

    const handler = buildRelationshipPacingLabelRepairHandler();
    const result = await handler({
      story,
      blockingIssues: initial.issues.map((issue) => ({
        validator: 'RelationshipArcLedgerValidator',
        type: 'relationship_pacing_violation',
        sceneId: 's1-5',
        severity: issue.severity,
        message: issue.message,
        suggestion: issue.suggestion,
      })),
    });

    expect(result.changed).toBe(true);
    expect(targetBeat.choices?.[0]?.nextSceneId).toBe(beforeNext);
    const afterChoice = JSON.parse(JSON.stringify(targetBeat.choices?.[0]));
    const beforeChoiceParsed = JSON.parse(beforeChoice);
    expect(afterChoice.id).toBe(beforeChoiceParsed.id);
    expect(afterChoice.nextSceneId).toBe(beforeChoiceParsed.nextSceneId);
    expect(afterChoice.reactionText).toContain('people moving around him');
    expect(targetBeat.text).toContain('new circle');
    expect(targetBeat.textVariants?.[0]?.text).toContain('new companions');
    expect(new RelationshipArcLedgerValidator().validate({ story, treatmentSourced: true }).valid).toBe(true);
  });

  it('caps unearned group membership contracts to a provisional stage', async () => {
    const story = makeStory();
    const scene = story.episodes[0].scenes[1];
    scene.beats[0].text = 'Stela presses rose quartz into your palm, and the Dusk Club is now three.';
    const initial = new RelationshipArcLedgerValidator().validate({ story, treatmentSourced: true });
    expect(initial.issues.some((issue) => issue.message.includes('settled membership'))).toBe(true);

    const result = await buildRelationshipPacingLabelRepairHandler()({
      story,
      blockingIssues: initial.issues.map((issue) => ({
        validator: 'RelationshipArcLedgerValidator',
        type: 'relationship_pacing_violation',
        sceneId: scene.id,
        severity: issue.severity,
        message: issue.message,
        suggestion: issue.suggestion,
      })),
    });

    expect(result.changed).toBe(true);
    expect(scene.relationshipPacing?.[0]?.targetStage).toBe('spark');
    expect(new RelationshipArcLedgerValidator().validate({ story, treatmentSourced: true }).valid).toBe(true);
  });

  it('recognizes final-contract provisional spark wording as a relationship cap', async () => {
    const story = makeStory();
    const scene = story.episodes[0].scenes[1];
    const result = await buildRelationshipPacingLabelRepairHandler()({
      story,
      blockingIssues: [{
        validator: 'RelationshipArcLedgerValidator',
        type: 'treatment_fidelity_violation',
        sceneId: scene.id,
        severity: 'error',
        message: `Scene "${scene.id}" treats group "new-circle" as settled membership while the ledger only permits a provisional spark.`,
        suggestion: 'Keep the group name as a joke, dare, or fragile invitation until individual relationships and a group-defining choice earn membership.',
      }],
    });

    expect(result.changed).toBe(true);
    expect(scene.relationshipPacing?.map((contract) => contract.targetStage)).toEqual(['spark', 'spark']);
  });

  it('rewrites group trust claims as provisional circle language', async () => {
    const story = makeStory();
    const scene = story.episodes[0].scenes[1];
    scene.beats[0].text = 'The Dusk Club is real now, and a refusal would damage the club\'s trust.';
    const initial = new RelationshipArcLedgerValidator().validate({ story, treatmentSourced: true });
    expect(initial.valid).toBe(false);

    const result = await buildRelationshipPacingLabelRepairHandler()({
      story,
      blockingIssues: initial.issues.map((issue) => ({
        validator: 'RelationshipArcLedgerValidator',
        type: 'relationship_pacing_violation',
        sceneId: scene.id,
        severity: issue.severity,
        message: issue.message,
        suggestion: issue.suggestion,
      })),
    });

    expect(result.changed).toBe(true);
    expect(scene.beats[0].text).toContain('still a dare');
    expect(scene.beats[0].text).toContain('fragile circle');
  });

  it('clears premature "official first meeting" labels in base beats and conditional variants without touching benign "official" uses', async () => {
    const story = makeStory();
    const scene = story.episodes[0].scenes[1];
    const beat = scene.beats[0];
    beat.text = 'Welcome to the Dusk Club, official first meeting. A city official waved you past on official business.';
    beat.textVariants = [{
      condition: { type: 'flag', flag: 'info-mika-contract_setup', value: true },
      text: 'Welcome to the Dusk Club, official first meeting.',
    }];
    beat.choices = [];

    const result = await buildRelationshipPacingLabelRepairHandler()({
      story,
      blockingIssues: [{
        validator: 'RelationshipArcLedgerValidator',
        type: 'relationship_pacing_violation',
        sceneId: scene.id,
        severity: 'error',
        message: `Scene "${scene.id}" uses unearned relationship label(s): official.`,
        suggestion: 'Rewrite as invitation, dare until relationship choices and evidence earn the stronger label.',
      }],
    });

    expect(result.changed).toBe(true);
    expect(beat.text).toContain('Dusk Club, first meeting');
    expect(beat.text).not.toMatch(/official first meeting/i);
    expect(beat.text).toContain('city official');
    expect(beat.text).toContain('official business');
    expect(beat.textVariants?.[0]?.text).toBe('Welcome to the Dusk Club, first meeting.');
    expect(beat.textVariants?.[0]?.text).not.toMatch(/official/i);
  });

  it('clears the reversed "first official" word order and sibling milestone nouns (bite-me 2026-07-04)', async () => {
    const story = makeStory();
    const scene = story.episodes[0].scenes[1];
    const beat = scene.beats[0];
    beat.text = '"Okay, Dusk Club, first official meeting," Mika toasts. Later she calls the post the Dusk Club\'s first official operation.';
    beat.textVariants = [];
    beat.choices = [];

    const result = await buildRelationshipPacingLabelRepairHandler()({
      story,
      blockingIssues: [{
        validator: 'RelationshipArcLedgerValidator',
        type: 'relationship_pacing_violation',
        sceneId: scene.id,
        severity: 'error',
        message: `Scene "${scene.id}" uses unearned relationship label(s): official.`,
        suggestion: 'Rewrite as invitation, dare until relationship choices and evidence earn the stronger label.',
      }],
    });

    expect(result.changed).toBe(true);
    expect(beat.text).not.toMatch(/official/i);
    expect(beat.text).toContain('first meeting');
    expect(beat.text).toContain('first operation');
  });

  it('downgrades unearned relationship labels in scene headers', async () => {
    const story = makeStory();
    const scene = story.episodes[0].scenes[1] as any;
    scene.name = 'Friend debrief';
    scene.title = 'Friend debrief';
    scene.beats[0].text = 'Mika and Stela compare the night like a dare, not a settled bond.';
    scene.beats[0].textVariants = [];
    scene.beats[0].choices = [];
    const initial = new RelationshipArcLedgerValidator().validate({ story, treatmentSourced: true });
    expect(initial.valid).toBe(false);
    expect(initial.issues.some((issue) => issue.message.includes('relationship language'))).toBe(true);

    const result = await buildRelationshipPacingLabelRepairHandler()({
      story,
      blockingIssues: initial.issues.map((issue) => ({
        validator: 'RelationshipArcLedgerValidator',
        type: 'relationship_pacing_violation',
        sceneId: scene.id,
        severity: issue.severity,
        message: issue.message,
        suggestion: issue.suggestion,
      })),
    });

    expect(result.changed).toBe(true);
    expect(scene.name).toBe('ally debrief');
    expect(scene.title).toBe('ally debrief');
    expect(new RelationshipArcLedgerValidator().validate({ story, treatmentSourced: true }).valid).toBe(true);
  });

  it('downgrades friend-priority and friendship residue in choices and reactions', async () => {
    const story = makeStory();
    const scene = story.episodes[0].scenes[1];
    const beat = scene.beats[0];
    beat.text = 'Mika and Stela invite you into a provisional circle.';
    beat.textVariants = [];
    beat.choices = [{
      id: 'protect-the-circle',
      text: 'Choose your best friend over the stranger.',
      stakes: {
        want: 'Keep the table warm.',
        cost: 'Ignore the stranger.',
        identity: 'My friends are my priority; strangers can wait.',
      },
      reactionText: 'The warmth of friendship is a welcome shield.',
      nextSceneId: 's1-6',
    } as any];

    const initial = new RelationshipArcLedgerValidator().validate({ story, treatmentSourced: true });
    expect(initial.valid).toBe(false);

    const result = await buildRelationshipPacingLabelRepairHandler()({
      story,
      blockingIssues: initial.issues.map((issue) => ({
        validator: 'RelationshipArcLedgerValidator',
        type: 'relationship_pacing_violation',
        sceneId: scene.id,
        severity: issue.severity,
        message: issue.message,
        suggestion: issue.suggestion,
      })),
    });

    expect(result.changed).toBe(true);
    const choice = beat.choices?.[0] as any;
    expect(choice.text).toContain('sharp new ally');
    expect(choice.stakes.identity).toContain('these companions');
    expect(choice.reactionText).toContain('guarded warmth');
    expect(new RelationshipArcLedgerValidator().validate({ story, treatmentSourced: true }).valid).toBe(true);
  });

  it('caps relationship pacing target stages from validator-owned permitted-stage findings', async () => {
    const story = {
      id: 'generic-relationship-cap',
      title: 'Generic Relationship Cap',
      genre: 'drama',
      synopsis: '',
      initialState: { attributes: {}, skills: {}, tags: [], inventory: [] },
      npcs: [{ id: 'ally', name: 'Ally' }],
      episodes: [{
        id: 'ep1',
        number: 1,
        title: 'Episode 1',
        startingSceneId: 'scene-a',
        scenes: [{
          id: 'scene-a',
          name: 'Scene A',
          title: 'Scene A',
          startingBeatId: 'beat-a',
          relationshipPacing: [{
            id: 'scene-a-rel-ally',
            source: 'planner',
            npcId: 'ally',
            startStage: 'spark',
            targetStage: 'friend',
            allowedLabels: ['friend', 'trusted ally'],
            blockedLabels: [],
            requiredEvidence: ['show behavior before naming the bond'],
            minScenesSinceIntroduction: 0,
            maxDeltaThisScene: 8,
            mechanicDimensions: ['trust'],
          }],
          beats: [{ id: 'beat-a', text: 'The conversation stays careful.', choices: [] }],
        }],
      }],
    } as unknown as Story;

    const result = await buildRelationshipPacingLabelRepairHandler()({
      story,
      blockingIssues: [{
        validator: 'RelationshipArcLedgerValidator',
        type: 'relationship_pacing_violation',
        sceneId: 'scene-a',
        message: 'Scene "scene-a" targets friend for ally, but the deterministic relationship ledger only permits acquaintance.',
      }],
    });

    const contract = story.episodes[0].scenes[0].relationshipPacing?.[0];
    expect(result.changed).toBe(true);
    expect(contract?.targetStage).toBe('acquaintance');
    expect(contract?.allowedLabels.join(' ')).not.toMatch(/\bfriend|trusted ally\b/i);
    expect(contract?.blockedLabels).toEqual(expect.arrayContaining(['friend', 'trusted ally']));
  });

  it('no-ops when relationship pacing is not blocking', async () => {
    const story = makeStory();
    const before = JSON.stringify(story);
    const result = await buildRelationshipPacingLabelRepairHandler()({
      story,
      blockingIssues: [{ validator: 'PlanningRegisterLeakValidator', sceneId: 's1-5' }],
    });

    expect(result.changed).toBe(false);
    expect(JSON.stringify(story)).toBe(before);
  });
});
