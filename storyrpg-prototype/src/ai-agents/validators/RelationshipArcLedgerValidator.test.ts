import { describe, expect, it } from 'vitest';
import type { Scene, Story } from '../../types';
import type { RelationshipPacingContract, SeasonScenePlan } from '../../types/scenePlan';
import { RelationshipArcLedgerValidator } from './RelationshipArcLedgerValidator';

function pacing(overrides: Partial<RelationshipPacingContract> = {}): RelationshipPacingContract {
  return {
    id: 'group-pacing',
    source: 'planner',
    groupId: 'dusk-club',
    startStage: 'unmet',
    targetStage: 'acquaintance',
    minScenesSinceIntroduction: 0,
    maxDeltaThisScene: 0,
    requiredEvidence: ['keep the group as an invitation'],
    allowedLabels: ['invitation'],
    blockedLabels: ['official'],
    mechanicDimensions: [],
    ...overrides,
  };
}

function story(scene: Scene): Story {
  return {
    id: 'relationship-test',
    title: 'Relationship Test',
    genre: 'drama',
    synopsis: '',
    coverImage: '',
    initialState: { attributes: {} as never, skills: {} as never, tags: [], inventory: [] },
    npcs: [],
    episodes: [{
      id: 'ep-1',
      number: 1,
      title: 'Episode 1',
      synopsis: '',
      coverImage: '',
      startingSceneId: scene.id,
      scenes: [scene],
    }],
  } as Story;
}

describe('RelationshipArcLedgerValidator', () => {
  it('caps an unchosen group target to provisional spark instead of flagging the stale higher target', () => {
    const contract = pacing();
    const scene = {
      id: 's1-1',
      name: 'Invitation',
      startingBeatId: 'b1',
      relationshipPacing: [contract],
      beats: [{
        id: 'b1',
        text: 'Mara hears the group name as a joke and an invitation, not a settled membership.',
        choices: [],
      }],
    } as Scene;
    const scenePlan: SeasonScenePlan = {
      scenes: [{
        id: 's1-1',
        episodeNumber: 1,
        order: 0,
        kind: 'standard',
        title: 'Invitation',
        dramaticPurpose: 'Mara receives a group invitation.',
        narrativeRole: 'turn',
        locations: [],
        npcsInvolved: [],
        setsUp: [],
        paysOff: [],
        relationshipPacing: [contract],
      }],
      byEpisode: { 1: ['s1-1'] },
      setupPayoffEdges: [],
    };

    const result = new RelationshipArcLedgerValidator().validate({ story: story(scene), scenePlan });

    expect(result.valid).toBe(true);
    expect(result.issues.some((issue) => issue.message.includes('targets acquaintance'))).toBe(false);
  });

  it('allows early group naming when the prose frames it as provisional', () => {
    const contract = pacing();
    const scene = {
      id: 's1-1',
      name: 'Invitation',
      startingBeatId: 'b1',
      relationshipPacing: [contract],
      beats: [{
        id: 'b1',
        text: 'Mara raises a glass for the Dusk Club, and the name hangs there as a joke and a promise.',
        choices: [],
      }],
    } as Scene;

    const result = new RelationshipArcLedgerValidator().validate({ story: story(scene) });

    expect(result.issues.some((issue) => issue.message.includes('settled membership'))).toBe(false);
  });

  it('does not treat venue or publication status as settled group membership', () => {
    const contract = pacing();
    const scene = {
      id: 's1-1',
      name: 'The Night Club',
      startingBeatId: 'b1',
      relationshipPacing: [contract],
      beats: [{
        id: 'b1',
        text: [
          'The club is a refuge for now, all velvet booths and low light.',
          'Your post glows on the Dusk Club blog, and the first byline is officially live.',
        ].join(' '),
        choices: [],
      }],
    } as Scene;

    const result = new RelationshipArcLedgerValidator().validate({ story: story(scene) });

    expect(result.issues.some((issue) => issue.message.includes('settled membership'))).toBe(false);
  });

  it('still blocks explicit settled group membership language before the ledger earns it', () => {
    const contract = pacing();
    const scene = {
      id: 's1-1',
      name: 'Invitation',
      startingBeatId: 'b1',
      relationshipPacing: [contract],
      beats: [{
        id: 'b1',
        text: 'Mara raises her glass. The Dusk Club is official now, and everyone at the table belongs.',
        choices: [],
      }],
    } as Scene;

    const result = new RelationshipArcLedgerValidator().validate({ story: story(scene) });

    expect(result.issues.some((issue) => issue.message.includes('settled membership'))).toBe(true);
  });

  it('does not treat family-history or lore references as high-stage relationship labels', () => {
    const contract = pacing({
      groupId: 'archive-circle',
      blockedLabels: ['friend', 'family', 'trusted ally'],
    });
    const scene = {
      id: 's1-1',
      name: 'Archive Invitation',
      startingBeatId: 'b1',
      relationshipPacing: [contract],
      beats: [{
        id: 'b1',
        text: 'You find a family portrait in the archive and a clue about old family rivalries before the group name becomes anything more than an invitation.',
        choices: [],
      }],
    } as Scene;

    const result = new RelationshipArcLedgerValidator().validate({ story: story(scene), treatmentSourced: true });

    expect(result.issues.some((issue) => issue.message.includes('friend/trusted/intimate relationship language'))).toBe(false);
  });

  it('still blocks chosen-family language before the ledger earns the bond', () => {
    const contract = pacing({
      groupId: 'archive-circle',
      blockedLabels: ['friend', 'family', 'trusted ally'],
    });
    const scene = {
      id: 's1-1',
      name: 'Archive Invitation',
      startingBeatId: 'b1',
      relationshipPacing: [contract],
      beats: [{
        id: 'b1',
        text: 'The strangers raise their glasses, and for one dangerous second the room feels like family.',
        choices: [],
      }],
    } as Scene;

    const result = new RelationshipArcLedgerValidator().validate({ story: story(scene), treatmentSourced: true });

    expect(result.issues.some((issue) => issue.message.includes('friend/trusted/intimate relationship language'))).toBe(true);
  });
});
