import { describe, expect, it } from 'vitest';
import type { MechanicPressureContract } from '../../types/scenePlan';
import { NarrativeMechanicPressureValidator } from './NarrativeMechanicPressureValidator';

function pressure(overrides: Partial<MechanicPressureContract> = {}): MechanicPressureContract {
  return {
    id: 's1-1-pressure-keycard',
    source: 'treatment',
    domain: 'item',
    mechanicRef: { itemId: 'key-card' },
    function: 'plant',
    storyPressure: 'Mika gives you access leverage through the side-entrance key card.',
    evidenceRequired: ['show Mika testing you before handing over the card'],
    visibleResidue: ['the card remains visible as access, obligation, and suspicion'],
    allowedPayoffs: ['access leverage', 'route permission', 'obligation'],
    blockedPayoffs: ['instant friendship', 'unexplained teleport'],
    originatingSceneId: 's1-1',
    ...overrides,
  };
}

function beat(id: string, text: string, extra: Record<string, unknown> = {}): any {
  return { id, text, ...extra };
}

function scene(id: string, text: string, mechanicPressure: MechanicPressureContract[] = [], extra: Record<string, unknown> = {}): any {
  return {
    id,
    name: id,
    startingBeatId: `${id}-b1`,
    beats: [beat(`${id}-b1`, text)],
    mechanicPressure,
    ...extra,
  };
}

function story(scenes: any[]): any {
  return {
    id: 'story',
    title: 'Story',
    genre: 'urban fantasy',
    synopsis: '',
    coverImage: '',
    initialState: { attributes: {}, skills: {}, tags: [], inventory: [] },
    npcs: [{ id: 'mika', name: 'Mika', description: '' }],
    episodes: [{
      id: 'ep1',
      number: 1,
      title: 'Episode 1',
      synopsis: '',
      coverImage: '',
      scenes,
      startingSceneId: scenes[0]?.id,
    }],
  };
}

const validator = new NarrativeMechanicPressureValidator();

describe('NarrativeMechanicPressureValidator', () => {
  it('fails bare meaningful consequences with no visible residue or pressure contract', () => {
    const result = validator.validate({
      story: story([
        scene('s1-1', 'Mika smiles at the door.', [], {
          beats: [beat('s1-1-b1', 'Mika smiles at the door.', {
            choices: [{ id: 'c1', text: 'Trust her', consequences: [{ type: 'relationship', npcId: 'mika', dimension: 'trust', change: 4 }] }],
          })],
        }),
      ]),
      treatmentSourced: true,
    });

    expect(result.valid).toBe(false);
    expect(result.issues.some((issue) => issue.message.includes('no narrative pressure contract'))).toBe(true);
  });

  it('fails gates that spend pressure never planted', () => {
    const result = validator.validate({
      story: story([
        scene('s1-1', 'The bookshop door waits.', [], {
          beats: [beat('s1-1-b1', 'The bookshop door waits.', {
            choices: [{
              id: 'c1',
              text: 'Use the side entrance card',
              conditions: { type: 'item', itemId: 'key-card' },
              consequences: [],
            }],
          })],
        }),
      ]),
    });

    expect(result.valid).toBe(false);
    expect(result.issues.some((issue) => issue.message.includes('was never planted'))).toBe(true);
  });

  it('fails high-magnitude changes without major visible evidence', () => {
    const result = validator.validate({
      story: story([
        scene('s1-1', 'Mika nods once at the door.', [
          pressure({
            id: 's1-1-pressure-mika',
            domain: 'relationship',
            mechanicRef: { npcId: 'mika', relationshipDimension: 'trust' },
            maxMagnitudeThisScene: 6,
          }),
        ], {
          beats: [beat('s1-1-b1', 'Mika nods once at the door.', {
            choices: [{
              id: 'c1',
              text: 'Smile back',
              residueHints: [{ kind: 'relationship_behavior', description: 'Mika warms by one careful degree.' }],
              consequences: [{ type: 'relationship', npcId: 'mika', dimension: 'trust', change: 20 }],
            }],
          })],
        }),
      ]),
    });

    expect(result.valid).toBe(false);
    expect(result.issues.some((issue) => issue.message.includes('too large'))).toBe(true);
  });

  it('passes earned item pressure that leaves residue and later gates access', () => {
    const result = validator.validate({
      story: story([
        scene('s1-1', 'Mika tests your answer, then places the key card in your palm. The plastic stays cold as access and obligation.', [pressure()], {
          beats: [beat('s1-1-b1', 'Mika tests your answer, then places the key card in your palm. The plastic stays cold as access and obligation.', {
            choices: [{
              id: 'c1',
              text: 'Take the card',
              mechanicPressure: [pressure()],
              residueHints: [{ kind: 'immediate_prose_echo', description: 'The card creates access and obligation.' }],
              consequences: [{ type: 'addItem', itemId: 'key-card', name: 'Side-entrance key card', description: 'Access with strings attached.' }],
            }],
          })],
        }),
        scene('s1-2', 'Later, you use the card at the side entrance; the door opens, but the camera sees you.', [
          pressure({ id: 's1-2-pressure-route', function: 'gate', domain: 'route', mechanicRef: { routeId: 'side-entrance' }, source: 'planner' }),
        ], {
          beats: [beat('s1-2-b1', 'Later, you use the card at the side entrance; the door opens, but the camera sees you.', {
            choices: [{ id: 'c2', text: 'Slip inside', conditions: { type: 'item', itemId: 'key-card' }, consequences: [{ type: 'setFlag', flag: 'entered_by_side_door', value: true }] }],
          })],
        }),
      ]),
      treatmentSourced: true,
    });

    expect(result.valid).toBe(true);
  });

  it('accepts relationship pacing as relationship-domain pressure during migration', () => {
    const result = validator.validate({
      story: story([
        scene('s1-1', 'Mika notices the shoes first and offers the card like a test, not friendship.', [], {
          relationshipPacing: [{
            id: 's1-1-rel-mika',
            source: 'treatment',
            npcId: 'mika',
            startStage: 'unmet',
            targetStage: 'spark',
            allowedLabels: ['spark', 'invitation'],
            blockedLabels: ['friend', 'trusted ally'],
            requiredEvidence: ['show behavior before naming the bond'],
            minScenesSinceIntroduction: 1,
            maxDeltaThisScene: 6,
            mechanicDimensions: ['trust'],
          }],
          beats: [beat('s1-1-b1', 'Mika notices the shoes first and offers the card like a test, not friendship.', {
            choices: [{
              id: 'c1',
              text: 'Play along',
              residueHints: [{ kind: 'relationship_behavior', description: 'Mika keeps testing you, but closer now.' }],
              consequences: [{ type: 'relationship', npcId: 'mika', dimension: 'trust', change: 4 }],
            }],
          })],
        }),
      ]),
      treatmentSourced: true,
    });

    expect(result.valid).toBe(true);
  });

  it('counts encounter prose as visible residue for treatment-authored pressure', () => {
    const result = validator.validate({
      story: story([
        scene('enc-1', '', [
          pressure({
            id: 'enc-1-pressure-secret',
            source: 'treatment',
            domain: 'information',
            mechanicRef: { infoId: 'park-rescue' },
            storyPressure: 'The park rescue changes what Kylie notices about Victor.',
            evidenceRequired: ['show the rescue clue on-page'],
            visibleResidue: ['suspicion, warning, clue, or changed interpretation'],
            allowedPayoffs: ['later suspicion'],
          }),
        ], {
          encounter: {
            phases: [{
              beats: [{
                id: 'enc-1-b1',
                setupText: 'Victor shields Kylie in the park, and the warning leaves a clue she notices because the rescue changes her suspicion.',
              }],
            }],
          },
        }),
      ]),
      treatmentSourced: true,
    });

    expect(result.valid).toBe(true);
  });

  it('warns instead of blocking future payoff checks in the terminal episode of a partial generated slice', () => {
    const result = validator.validate({
      story: story([
        scene('treatment-enc-1-1', 'The encounter plants a dangerous invitation in the room.', [
          pressure({
            id: 'enc-1-pressure-future',
            source: 'treatment',
            domain: 'relationship',
            mechanicRef: { npcId: 'mika', relationshipDimension: 'trust' },
            storyPressure: 'Relationship with Mika Drăgan is moving only as far as acquaintance.',
            evidenceRequired: ['show Mika testing Kylie before trust can grow'],
            visibleResidue: ['later invitation, callback, gate, or relationship pressure'],
            allowedPayoffs: ['future callback'],
          }),
        ]),
      ]),
      treatmentSourced: true,
      requestedEpisodeNumbers: [1],
      generatedEpisodeNumbers: [1],
      generatedThroughEpisode: 1,
      partialGeneratedSlice: true,
    });

    expect(result.valid).toBe(true);
    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        severity: 'warning',
        message: expect.stringContaining('terminal generated episode of a partial slice'),
      }),
    ]));
  });
});
