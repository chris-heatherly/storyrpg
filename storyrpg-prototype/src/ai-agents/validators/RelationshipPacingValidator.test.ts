import { describe, expect, it } from 'vitest';
import type { RelationshipPacingContract } from '../../types/scenePlan';
import { RelationshipPacingValidator } from './RelationshipPacingValidator';

function contract(overrides: Partial<RelationshipPacingContract> = {}): RelationshipPacingContract {
  return {
    id: 's1-1-rel-mika',
    source: 'treatment',
    npcId: 'mika',
    startStage: 'unmet',
    targetStage: 'spark',
    allowedLabels: ['spark', 'connection', 'invitation'],
    blockedLabels: ['friend', 'trusted ally', 'inner circle'],
    requiredEvidence: ['show behavior before naming the bond'],
    minScenesSinceIntroduction: 1,
    maxDeltaThisScene: 6,
    mechanicDimensions: ['trust', 'affection'],
    ...overrides,
  };
}

function beat(id: string, text: string, extra: Record<string, unknown> = {}): any {
  return { id, text, ...extra };
}

function scene(id: string, text: string, pacing: RelationshipPacingContract[] = [], extra: Record<string, unknown> = {}): any {
  return {
    id,
    name: id,
    startingBeatId: `${id}-b1`,
    beats: [beat(`${id}-b1`, text)],
    relationshipPacing: pacing,
    ...extra,
  };
}

function story(scenes: any[], npcs: any[] = [{ id: 'mika', name: 'Mika' }]): any {
  return {
    id: 'story',
    title: 'Story',
    episodes: [{
      id: 'ep1',
      number: 1,
      title: 'Episode 1',
      synopsis: '',
      scenes,
      startingSceneId: scenes[0]?.id,
    }],
    npcs,
  };
}

const validator = new RelationshipPacingValidator();

describe('RelationshipPacingValidator', () => {
  it('fails when narration declares friendship on a first meeting', () => {
    const result = validator.validate({
      story: story([
        scene('s1-1', 'Mika hands you the key card. By the door, she is already your friend.', [contract()]),
      ]),
      treatmentSourced: true,
    });

    expect(result.valid).toBe(false);
    expect(result.issues.some((issue) => issue.severity === 'error' && issue.message.includes('unearned relationship label'))).toBe(true);
  });

  it('fails when first-week chemistry is narrated as years of comfort', () => {
    const result = validator.validate({
      story: story([
        scene(
          's1-1',
          'It has only been three days with these women, but Stela refilling your wine feels like the comfortable habit of years.',
          [contract({ npcId: 'stela', targetStage: 'acquaintance', allowedLabels: ['guarded warmth', 'testing trust'] })],
        ),
      ], [{ id: 'stela', name: 'Stela' }]),
      treatmentSourced: true,
    });

    expect(result.valid).toBe(false);
    expect(result.issues.some((issue) => issue.message.includes('old-friend familiarity'))).toBe(true);
  });

  it('fails when a first-scene time jump treats new acquaintances as an already easy group', () => {
    const result = validator.validate({
      story: story([
        scene(
          's1-1',
          'It has only been three days with Mika and Stela, so every easy gesture still feels slightly staged: Stela refills your wine and Mika watches over the rim of her glass.',
          [
            contract({ npcId: 'mika', targetStage: 'acquaintance', allowedLabels: ['guarded warmth', 'testing trust'] }),
            contract({ id: 's1-1-rel-stela', npcId: 'stela', targetStage: 'acquaintance', allowedLabels: ['guarded warmth', 'testing trust'] }),
          ],
        ),
      ], [{ id: 'mika', name: 'Mika' }, { id: 'stela', name: 'Stela' }]),
      treatmentSourced: true,
    });

    expect(result.valid).toBe(false);
    expect(result.issues.some((issue) => issue.message.includes('old-friend familiarity'))).toBe(true);
  });

  it('does not fail on blocked labels that appear only in hidden beat metadata', () => {
    const result = validator.validate({
      story: story([
        scene('s1-1', 'Mika offers the key card like a test, not a promise.', [contract({ blockedLabels: ['family'] })], {
          beats: [beat('s1-1-b1', 'Mika offers the key card like a test, not a promise.', {
            relationshipDynamic: 'Kylie performs confidence for her family, and maybe for herself.',
          })],
        }),
      ]),
      treatmentSourced: true,
    });

    expect(result.issues.some((issue) => issue.message.includes('unearned relationship label'))).toBe(false);
  });

  it('does not treat lore phrases like family rivalries as relationship-label claims', () => {
    const result = validator.validate({
      story: story([
        scene('s1-7', 'Stela warns you over the phone.', [contract({
          blockedLabels: ['best friend', 'soulmate', 'family', 'trusts completely'],
          targetStage: 'friend',
          minScenesSinceIntroduction: 0,
        })], {
          beats: [beat('s1-7-b1', 'Stela warns you over the phone.', {
            choices: [{
              id: 'c1',
              text: 'Ask about the old houses',
              outcomeTexts: {
                success: 'Mika offers a cryptic but useful hint about old family rivalries.',
                partial: 'She deflects, but her tone tells you this is serious.',
                failure: 'She goes cold.',
              },
            }],
          })],
        }),
      ]),
      treatmentSourced: true,
    });

    expect(result.issues.some((issue) => issue.message.includes('unearned relationship label'))).toBe(false);
  });

  it('does not treat visible family-history clues as relationship-label claims', () => {
    const result = validator.validate({
      story: story([
        scene('s3-3', 'Victor is missing from his family portrait. A stranger knows your family history before you offer it.', [contract({
          blockedLabels: ['best friend', 'soulmate', 'family', 'trusts completely'],
          targetStage: 'acquaintance',
          minScenesSinceIntroduction: 0,
        })]),
      ]),
      treatmentSourced: true,
    });

    expect(result.issues.some((issue) => issue.message.includes('unearned relationship label'))).toBe(false);
  });

  it('does not treat hidden choice-planning summaries as visible relationship-stage claims', () => {
    const result = validator.validate({
      story: story([
        scene('s1-5', 'Mika changes the subject before the danger can name itself.', [contract({
          targetStage: 'friend',
          blockedLabels: ['best friend', 'family', 'trusts completely'],
          minScenesSinceIntroduction: 0,
        })], {
          beats: [beat('s1-5-b1', 'Mika changes the subject before the danger can name itself.', {
            choices: [{
              id: 'c1',
              text: 'Let her redirect you',
              feedbackCue: {
                progressSummary: 'Relationship with Mika is moving only as far as friend.',
              },
              reminderPlan: {
                immediate: 'The choice leaves visible pressure around Relationship with Mika is moving only as far as friend.',
              },
            }],
          })],
        }),
      ]),
      treatmentSourced: true,
    });

    expect(result.issues.some((issue) => issue.message.includes('claims a high relationship stage'))).toBe(false);
  });

  it('does not fail only because a hidden pacing contract targets friend', () => {
    const result = validator.validate({
      story: story([
        scene('s1-4', 'Mika sees the man watching you and turns her body to block your view.', [contract({
          targetStage: 'friend',
          blockedLabels: ['best friend', 'soulmate', 'family', 'trusts completely'],
          minScenesSinceIntroduction: 0,
        })]),
      ]),
      treatmentSourced: true,
    });

    expect(result.issues.some((issue) => issue.message.includes('claims a high relationship stage'))).toBe(false);
  });

  it('fails when Dusk Club is treated as settled membership too early', () => {
    const result = validator.validate({
      story: story([
        scene('s1-2', 'Stela presses rose quartz into your palm. The Dusk Club is now three.', [
          contract({
            id: 's1-2-rel-dusk-club',
            npcId: undefined,
            groupId: 'dusk-club',
            allowedLabels: ['invitation', 'dare', 'provisional name'],
            blockedLabels: ['inner circle', 'one of us', 'friends now'],
          }),
        ]),
      ]),
      treatmentSourced: true,
    });

    expect(result.valid).toBe(false);
    expect(result.issues.some((issue) => issue.message.includes('settled group membership'))).toBe(true);
  });

  it('passes instant chemistry expressed as behavior and provisional invitation', () => {
    const result = validator.validate({
      story: story([
        scene(
          's1-1',
          'Mika notices the shoes first. Her smile cuts sideways, testing and amused, and she offers the key card like an invitation you have not earned yet.',
          [contract()],
        ),
      ]),
      treatmentSourced: true,
    });

    expect(result.valid).toBe(true);
  });

  it('passes earned friendship after prior scenes and relationship movement', () => {
    const earned = contract({
      id: 's1-3-rel-mika',
      source: 'planner',
      startStage: 'tentative_ally',
      targetStage: 'friend',
      allowedLabels: ['friend'],
      blockedLabels: ['best friend', 'family', 'trusts completely'],
      minScenesSinceIntroduction: 2,
      maxDeltaThisScene: 10,
    });
    const result = validator.validate({
      story: story([
        scene('s1-1', 'Mika tests your answer and lets you keep the card.', [], {
          beats: [beat('s1-1-b1', 'Mika tests your answer.', {
            choices: [{ id: 'c1', text: 'Answer honestly', consequences: [{ type: 'relationship', npcId: 'mika', dimension: 'trust', change: 6 }] }],
          })],
        }),
        scene('s1-2', 'She remembers the joke and waits when she could leave.', [], {
          beats: [beat('s1-2-b1', 'She remembers the joke.', {
            choices: [{ id: 'c2', text: 'Let her help', consequences: [{ type: 'relationship', npcId: 'mika', dimension: 'affection', change: 6 }] }],
          })],
        }),
        scene('s1-3', 'After two nights of tests and favors, Mika calls herself your friend and makes it sound like a dare.', [earned]),
      ]),
    });

    expect(result.valid).toBe(true);
  });

  it('counts app-shaped relationship consequences toward named NPC pacing evidence', () => {
    const earned = contract({
      id: 's1-2-rel-mika',
      npcId: 'Mika Drăgan',
      targetStage: 'friend',
      allowedLabels: ['friend'],
      blockedLabels: ['best friend', 'family', 'trusts completely'],
      minScenesSinceIntroduction: 1,
    });
    const result = validator.validate({
      story: story([
        scene('s1-1', 'Mika notices your fear and chooses to help.', [], {
          beats: [beat('s1-1-b1', 'Mika notices your fear and chooses to help.', {
            choices: [{ id: 'c1', text: 'Let her help', consequences: [{ type: 'relationship', npcId: 'char-mika-drgan', score: 'trust', value: 12 }] }],
          })],
        }),
        scene('s1-2', 'After the warning and the help, Mika calls herself your friend like she is daring you to object.', [earned]),
      ], [{ id: 'char-mika-drgan', name: 'Mika Drăgan' }]),
      treatmentSourced: true,
    });

    expect(result.valid).toBe(true);
  });

  it('flags relationship deltas above the pacing cap', () => {
    const result = validator.validate({
      story: story([
        scene('s1-1', 'Mika offers a key card.', [contract()], {
          beats: [beat('s1-1-b1', 'Mika offers a key card.', {
            choices: [{ id: 'c1', text: 'Trust her', consequences: [{ type: 'relationship', npcId: 'mika', dimension: 'trust', change: 20 }] }],
          })],
        }),
      ]),
    });

    expect(result.valid).toBe(false);
    expect(result.issues.some((issue) => issue.message.includes('above this scene'))).toBe(true);
  });

  it('flags relationship-gated choices that prior consequences cannot reach', () => {
    const result = validator.validate({
      story: story([
        scene('s1-1', 'Mika offers a key card.', [contract()], {
          beats: [beat('s1-1-b1', 'Mika offers a key card.', {
            choices: [{
              id: 'c1',
              text: 'Ask Mika to trust you completely',
              conditions: { type: 'relationship', npcId: 'mika', dimension: 'trust', operator: '>=', value: 20 },
              consequences: [],
            }],
          })],
        }),
      ]),
    });

    expect(result.valid).toBe(false);
    expect(result.issues.some((issue) => issue.message.includes('Relationship-gated choice'))).toBe(true);
  });
});
