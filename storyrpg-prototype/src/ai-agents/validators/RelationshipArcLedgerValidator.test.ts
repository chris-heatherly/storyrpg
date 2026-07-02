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

// Ported from RelationshipPacingValidator when its checks merged into this
// validator (GATE_RELATIONSHIP_PACING is shadowed pending deletion).
describe('RelationshipArcLedgerValidator merged pacing checks', () => {
  function npcContract(overrides: Partial<RelationshipPacingContract> = {}): RelationshipPacingContract {
    return pacing({
      id: 's1-1-rel-mika',
      groupId: undefined,
      npcId: 'mika',
      targetStage: 'spark',
      allowedLabels: ['spark', 'connection', 'invitation'],
      blockedLabels: ['friend', 'trusted ally', 'inner circle'],
      maxDeltaThisScene: 6,
      minScenesSinceIntroduction: 1,
      ...overrides,
    });
  }

  function beatScene(id: string, beats: any[], contracts: RelationshipPacingContract[]): Scene {
    return {
      id,
      name: id,
      startingBeatId: beats[0]?.id,
      relationshipPacing: contracts,
      beats,
    } as Scene;
  }

  function npcStory(scenes: Scene[], npcs: any[] = [{ id: 'mika', name: 'Mika' }]): Story {
    return {
      ...story(scenes[0]),
      npcs,
      episodes: [{
        id: 'ep-1',
        number: 1,
        title: 'Episode 1',
        synopsis: '',
        coverImage: '',
        startingSceneId: scenes[0].id,
        scenes,
      }],
    } as Story;
  }

  it('fails when narration declares friendship on a first meeting', () => {
    const result = new RelationshipArcLedgerValidator().validate({
      story: npcStory([beatScene('s1-1', [
        { id: 'b1', text: 'Mika hands you the key card. By the door, she is already your friend.', choices: [] },
      ], [npcContract()])]),
      treatmentSourced: true,
    });

    expect(result.valid).toBe(false);
    expect(result.issues.some((issue) => issue.message.includes('friend/trusted/intimate relationship language'))).toBe(true);
  });

  it('does not flag negated not-yet-friends prose as a stage claim', () => {
    const result = new RelationshipArcLedgerValidator().validate({
      story: npcStory([beatScene('s1-1', [
        { id: 'b1', text: 'Mika hands you the key card. You are not yet a friend, and she makes sure you know it.', choices: [] },
      ], [npcContract()])]),
      treatmentSourced: true,
    });

    expect(result.issues.some((issue) => issue.message.includes('friend/trusted/intimate relationship language'))).toBe(false);
  });

  it('fails when an unmet NPC is reachable by private text before an on-page introduction', () => {
    const result = new RelationshipArcLedgerValidator().validate({
      story: npcStory([beatScene('s1-1', [
        { id: 'b1', text: 'You message Mika before you can talk yourself out of it. The reply comes quickly.', choices: [] },
      ], [npcContract({ targetStage: 'acquaintance' })])]),
      treatmentSourced: true,
    });

    expect(result.valid).toBe(false);
    expect(result.issues.some((issue) => issue.message.includes('direct phone/contact access'))).toBe(true);
  });

  it('allows later private contact after a same-scene speaker introduction', () => {
    const result = new RelationshipArcLedgerValidator().validate({
      story: npcStory([beatScene('s1-1', [
        { id: 'b1', text: '"You made it," she says, already moving toward the door.', speaker: 'Mika', choices: [] },
        { id: 'b2', text: 'Mika offers the key card like a test, not a promise.', choices: [] },
        {
          id: 'b3',
          text: 'She points toward the street.',
          choices: [{
            id: 'c1',
            text: 'Ask for a slower start.',
            outcomeTexts: { success: 'Mika promises to text you the address once you have unpacked.' },
          }],
        },
      ], [npcContract({ targetStage: 'acquaintance' })])]),
      treatmentSourced: true,
    });

    expect(result.issues.some((issue) => issue.message.includes('direct phone/contact access'))).toBe(false);
  });

  it('allows private text after the NPC has been introduced in a prior scene (no exchange-verb requirement)', () => {
    const result = new RelationshipArcLedgerValidator().validate({
      story: npcStory([
        beatScene('s1-1', [
          { id: 'b1', text: 'At the club door, Mika offers the key card like a test.', choices: [] },
        ], [npcContract({ targetStage: 'acquaintance' })]),
        beatScene('s1-2', [
          { id: 'b2', text: 'A text from Mika lights up the phone: you survived the comments.', choices: [] },
        ], [npcContract({ id: 's1-2-rel-mika', startStage: 'acquaintance', targetStage: 'acquaintance', minScenesSinceIntroduction: 0 })]),
      ]),
      treatmentSourced: true,
    });

    expect(result.issues.some((issue) => issue.message.includes('direct phone/contact access'))).toBe(false);
  });

  it('fails when first-week chemistry is narrated as years of comfort', () => {
    const result = new RelationshipArcLedgerValidator().validate({
      story: npcStory([beatScene('s1-1', [
        { id: 'b1', text: 'It has only been three days with these women, but Stela refilling your wine feels like the comfortable habit of years.', choices: [] },
      ], [npcContract({ npcId: 'stela', targetStage: 'acquaintance', allowedLabels: ['guarded warmth', 'testing trust'] })])], [{ id: 'stela', name: 'Stela' }]),
      treatmentSourced: true,
    });

    expect(result.valid).toBe(false);
    expect(result.issues.some((issue) => issue.message.includes('old-friend familiarity'))).toBe(true);
  });

  it('flags custom contract blocked labels beyond the generic high-stage vocabulary', () => {
    const result = new RelationshipArcLedgerValidator().validate({
      story: npcStory([beatScene('s1-1', [
        { id: 'b1', text: 'Mika laughs and names you her blood-sworn before the first drink lands.', choices: [] },
      ], [npcContract({ blockedLabels: ['blood-sworn'] })])]),
      treatmentSourced: true,
    });

    expect(result.valid).toBe(false);
    expect(result.issues.some((issue) => issue.message.includes('unearned relationship label'))).toBe(true);
  });

  it('flags relationship-gated choices that prior consequences cannot reach', () => {
    const result = new RelationshipArcLedgerValidator().validate({
      story: npcStory([beatScene('s1-1', [
        {
          id: 'b1',
          text: 'Mika offers a key card.',
          choices: [{
            id: 'c1',
            text: 'Ask Mika to trust you completely',
            conditions: { type: 'relationship', npcId: 'mika', dimension: 'trust', operator: '>=', value: 20 },
            consequences: [],
          }],
        },
      ], [npcContract()])]),
    });

    expect(result.valid).toBe(false);
    expect(result.issues.some((issue) => issue.message.includes('Relationship-gated choice'))).toBe(true);
  });

  it('allows a relationship gate that earlier authored gains can reach', () => {
    const result = new RelationshipArcLedgerValidator().validate({
      story: npcStory([
        beatScene('s1-1', [
          {
            id: 'b1',
            text: 'Mika tests your answer and lets you keep the card.',
            choices: [{ id: 'c1', text: 'Answer honestly', consequences: [{ type: 'relationship', npcId: 'mika', dimension: 'trust', change: 6 }] }],
          },
        ], []),
        beatScene('s1-2', [
          {
            id: 'b2',
            text: 'Mika waits by the door.',
            choices: [{
              id: 'c2',
              text: 'Lean on the trust you built',
              conditions: { type: 'relationship', npcId: 'mika', dimension: 'trust', operator: '>=', value: 5 },
              consequences: [],
            }],
          },
        ], []),
      ]),
    });

    expect(result.issues.some((issue) => issue.message.includes('Relationship-gated choice'))).toBe(false);
  });

  it('passes instant chemistry expressed as behavior and provisional invitation', () => {
    const result = new RelationshipArcLedgerValidator().validate({
      story: npcStory([beatScene('s1-1', [
        { id: 'b1', text: 'Mika notices the shoes first. Her smile cuts sideways, testing and amused, and she offers the key card like an invitation you have not earned yet.', choices: [] },
      ], [npcContract()])]),
      treatmentSourced: true,
    });

    expect(result.valid).toBe(true);
  });

  it('passes earned friendship once the ledger has choices, movement, and evidence', () => {
    const result = new RelationshipArcLedgerValidator().validate({
      story: npcStory([
        beatScene('s1-1', [
          {
            id: 'b1',
            text: 'Mika tests your answer and lets you keep the card.',
            choices: [{
              id: 'c1',
              text: 'Answer honestly',
              consequences: [{ type: 'relationship', npcId: 'mika', dimension: 'trust', change: 6 }],
              relationshipValueEvidence: [{ npcId: 'mika', axis: 'love', evidenceTags: ['protected_player'], reason: 'She steps between you and the watcher.', intendedSurface: 'protection' }],
            }],
          },
        ], []),
        beatScene('s1-2', [
          {
            id: 'b2',
            text: 'She remembers the joke and waits when she could leave.',
            choices: [{ id: 'c2', text: 'Let her help', consequences: [{ type: 'relationship', npcId: 'mika', dimension: 'affection', change: 6 }] }],
          },
        ], []),
        beatScene('s1-3', [
          { id: 'b3', text: 'After two nights of tests and favors, because you remember what she risked, Mika calls herself your friend and makes it sound like a dare.', choices: [] },
        ], [npcContract({ id: 's1-3-rel-mika', source: 'planner', startStage: 'tentative_ally', targetStage: 'friend', allowedLabels: ['friend'], minScenesSinceIntroduction: 2, maxDeltaThisScene: 10 })]),
      ]),
    });

    expect(result.valid).toBe(true);
  });
});
