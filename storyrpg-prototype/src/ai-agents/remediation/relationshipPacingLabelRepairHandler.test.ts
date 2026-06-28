import { describe, expect, it } from 'vitest';
import type { Story } from '../../types/story';
import { RelationshipPacingValidator } from '../validators/RelationshipPacingValidator';
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
    const initial = new RelationshipPacingValidator().validate({ story, treatmentSourced: true });
    expect(initial.valid).toBe(false);

    const handler = buildRelationshipPacingLabelRepairHandler();
    const result = await handler({
      story,
      blockingIssues: initial.issues.map((issue) => ({
        validator: 'RelationshipPacingValidator',
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
    expect(new RelationshipPacingValidator().validate({ story, treatmentSourced: true }).valid).toBe(true);
  });

  it('downgrades settled Dusk Club membership into a provisional joke', async () => {
    const story = makeStory();
    const scene = story.episodes[0].scenes[1];
    scene.beats[0].text = 'Stela presses rose quartz into your palm, and the Dusk Club is now three.';
    const initial = new RelationshipPacingValidator().validate({ story, treatmentSourced: true });
    expect(initial.issues.some((issue) => issue.message.includes('settled group membership'))).toBe(true);

    const result = await buildRelationshipPacingLabelRepairHandler()({
      story,
      blockingIssues: initial.issues.map((issue) => ({
        validator: 'RelationshipPacingValidator',
        type: 'relationship_pacing_violation',
        sceneId: scene.id,
        severity: issue.severity,
        message: issue.message,
        suggestion: issue.suggestion,
      })),
    });

    expect(result.changed).toBe(true);
    expect(scene.beats[0].text).toContain('joke about calling it the Dusk Club');
    expect(new RelationshipPacingValidator().validate({ story, treatmentSourced: true }).valid).toBe(true);
  });

  it('downgrades unearned relationship labels in scene headers', async () => {
    const story = makeStory();
    const scene = story.episodes[0].scenes[1] as any;
    scene.name = 'Friend debrief';
    scene.title = 'Friend debrief';
    scene.beats[0].text = 'Mika and Stela compare the night like a dare, not a settled bond.';
    scene.beats[0].textVariants = [];
    scene.beats[0].choices = [];
    const initial = new RelationshipPacingValidator().validate({ story, treatmentSourced: true });
    expect(initial.valid).toBe(false);
    expect(initial.issues.some((issue) => issue.message.includes('high relationship stage'))).toBe(true);

    const result = await buildRelationshipPacingLabelRepairHandler()({
      story,
      blockingIssues: initial.issues.map((issue) => ({
        validator: 'RelationshipPacingValidator',
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
    expect(new RelationshipPacingValidator().validate({ story, treatmentSourced: true }).valid).toBe(true);
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
