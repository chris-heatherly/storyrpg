import { describe, expect, it } from 'vitest';

import type { EpisodeBlueprint } from '../agents/StoryArchitect';
import { DramaticStructureValidator } from './DramaticStructureValidator';

function blueprint(overrides: Partial<EpisodeBlueprint> = {}): EpisodeBlueprint {
  return {
    episodeId: 'episode-1',
    title: 'The Ledger Turns',
    synopsis: 'A mystery episode where the player exposes a betrayal.',
    arc: {
      you: '',
      need: '',
      go: '',
      search: 'The mentor signature reframes the missing witness.',
      find: '',
      take: '',
      return: '',
      change: '',
    },
    themes: ['What does loyalty cost when truth would destroy the people you love?'],
    dramaticAudit: {
      episodeQuestion: 'Will the player expose the mentor before Mara loses faith?',
      themePressure: 'The episode forces loyalty and truth into direct conflict.',
      personalStake: 'Mara trust and the player reputation will be damaged if the truth is mishandled.',
      stakesLayers: {
        material: 'The archive access can be lost.',
        relational: 'Mara trust is at risk.',
        identity: 'The player becomes someone who chooses truth under pressure.',
      },
      majorTurns: [
        {
          id: 'turn-1',
          description: 'The player chooses to open the sealed ledger.',
          driver: 'player_choice',
          protagonistInfluence: 'The discovery happens because the player risks breaking the seal.',
        },
        {
          id: 'turn-2',
          description: 'Mara withdraws when the mentor signature appears.',
          driver: 'protagonist',
          protagonistInfluence: 'The player revelation creates the relational cost.',
        },
        {
          id: 'turn-3',
          description: 'The antagonist locks the archive.',
          driver: 'antagonist',
          protagonistInfluence: 'The lock-down is a reaction to the player exposing the first clue.',
        },
      ],
      informationPlan: [
        {
          item: 'The mentor paid the missing witness.',
          knownBy: ['player', 'protagonist', 'antagonist'],
          revealTiming: 'Scene 1 ledger reveal.',
          payoff: 'The clue becomes leverage in the confrontation.',
        },
      ],
    },
    scenes: [
      {
        id: 'scene-1',
        name: 'The Ledger',
        description: 'The player breaks the seal and finds the mentor signature.',
        location: 'archive',
        mood: 'tense',
        purpose: 'bottleneck',
        dramaticQuestion: 'Will the player risk the seal?',
        wantVsNeed: 'They want proof without betrayal; they need to expose the truth.',
        conflictEngine: 'The locked ledger and Mara fear of public scandal.',
        dramaticStructure: {
          question: 'Will the player open the ledger?',
          turn: 'The mentor signature appears.',
          pressurePeak: 'Mara realizes the truth implicates someone she trusts.',
          changedState: 'The player now has proof and damaged trust.',
        },
        personalStake: 'Mara trust and the player reputation are at risk.',
        stakesLayers: {
          material: 'The sealed ledger and archive access can be lost.',
          relational: 'Mara trust is at risk.',
          identity: 'The player chooses whether truth matters more than comfort.',
        },
        npcsPresent: ['mara'],
        narrativeFunction: 'Reveal the clue that makes the confrontation possible.',
        keyBeats: ['REST: the archive dust settles', 'PEAK: the signature appears'],
        leadsTo: ['scene-2'],
        transitionOut: [{
          toSceneId: 'scene-2',
          connector: 'therefore',
          causalLink: 'The signature gives the player leverage for the confrontation.',
          pressureChange: 'Private suspicion becomes public risk.',
        }],
        residue: [{
          type: 'information',
          description: 'The player knows the mentor paid the witness.',
        }],
      },
      {
        id: 'scene-2',
        name: 'The Confrontation',
        description: 'The player uses the signature as leverage.',
        location: 'court',
        mood: 'urgent',
        purpose: 'bottleneck',
        dramaticQuestion: 'Will the truth cost Mara?',
        wantVsNeed: 'They want justice; they need to accept relational cost.',
        conflictEngine: 'The antagonist turns the accusation against Mara.',
        dramaticStructure: {
          question: 'Can the player use the proof without losing Mara?',
          turn: 'The antagonist weaponizes Mara silence.',
          pressurePeak: 'The player must choose reputation or trust.',
          changedState: 'The court knows the truth and Mara sees the cost.',
        },
        personalStake: 'The player may lose Mara trust to protect the town.',
        stakesLayers: {
          material: 'The court record and archive access can be lost.',
          relational: 'Mara trust may break in public.',
          identity: 'The player chooses whether to become someone who exposes painful truth.',
        },
        npcsPresent: ['mara', 'arden'],
        narrativeFunction: 'Episode return.',
        keyBeats: ['PEAK: accusation lands', 'the court turns'],
        leadsTo: [],
        transitionOut: [],
        residue: [{
          type: 'relationship',
          description: 'Mara trust is shaken even though the proof saves the case.',
        }],
      },
    ],
    startingSceneId: 'scene-1',
    bottleneckScenes: ['scene-1', 'scene-2'],
    suggestedFlags: [],
    suggestedScores: [],
    suggestedTags: [],
    narrativePromises: [],
    ...overrides,
  };
}

describe('DramaticStructureValidator', () => {
  it('passes a path-aware blueprint with causal transitions and residue', () => {
    const result = new DramaticStructureValidator().validate(blueprint());

    expect(result.valid).toBe(true);
    expect(result.metrics.causalTransitionCount).toBe(1);
    expect(result.metrics.protagonistAgencyRatio).toBe(1);
  });

  it('accepts residue prose that merely contains a placeholder word (live FP regression)', () => {
    const bp = blueprint();
    bp.scenes[1].residue = [{
      type: 'information',
      description: 'What Victoria knows is still unknown to the crew, and none of them will say it aloud.',
    }];

    const result = new DramaticStructureValidator().validate(bp);

    expect(result.issues.map(issue => issue.message).join('\n')).not.toContain('residue without description');
  });

  it('still rejects a whole-value placeholder residue description', () => {
    const bp = blueprint();
    bp.scenes[1].residue = [{ type: 'information', description: 'TBD.' }];

    const result = new DramaticStructureValidator().validate(bp);

    expect(result.issues.map(issue => issue.message).join('\n')).toContain('residue without description');
  });

  it('fails an and-then transition with no therefore/but metadata', () => {
    const bp = blueprint();
    bp.scenes[0].transitionOut = [];

    const result = new DramaticStructureValidator().validate(bp);

    expect(result.valid).toBe(false);
    expect(result.issues.map(issue => issue.message).join('\n')).toContain('without transitionOut metadata');
  });

  it('warns when fewer than 60 percent of major turns are protagonist-driven', () => {
    const bp = blueprint({
      dramaticAudit: {
        ...blueprint().dramaticAudit!,
        majorTurns: [
          { id: 'turn-1', description: 'A storm closes the road.', driver: 'world', protagonistInfluence: '' },
          { id: 'turn-2', description: 'The villain burns the letter.', driver: 'antagonist', protagonistInfluence: '' },
          { id: 'turn-3', description: 'A witness arrives.', driver: 'npc', protagonistInfluence: '' },
          { id: 'turn-4', description: 'The player opens the vault.', driver: 'player_choice', protagonistInfluence: 'The vault opens because the player kept the key.' },
        ],
      },
    });

    const result = new DramaticStructureValidator().validate(bp);

    expect(result.valid).toBe(true);
    expect(result.issues.some(issue => issue.severity === 'warning' && issue.message.includes('60%'))).toBe(true);
  });

  it('fails abstract stakes that are not grounded personally', () => {
    const bp = blueprint({
      dramaticAudit: {
        ...blueprint().dramaticAudit!,
        personalStake: 'The world is in danger.',
      },
    });
    bp.scenes[0].personalStake = 'Everything is at risk.';

    const result = new DramaticStructureValidator().validate(bp);

    expect(result.valid).toBe(false);
    expect(result.issues.map(issue => issue.message).join('\n')).toContain('personal stake');
  });

  it('fails major scenes that do not name at least three stakes layers', () => {
    const bp = blueprint();
    bp.scenes[1].stakesLayers = { material: 'The court record changes.' };

    const result = new DramaticStructureValidator().validate(bp);

    expect(result.valid).toBe(false);
    expect(result.issues.map(issue => issue.message).join('\n')).toContain('at least three stakes layers');
  });

  it('fails dilemmas without relational or identity stakes layers', () => {
    const bp = blueprint();
    bp.scenes[0].choicePoint = {
      type: 'dilemma',
      stakes: {
        want: 'Expose the mentor.',
        cost: 'Lose archive access.',
        identity: 'Choose truth over safety.',
      },
      stakesLayers: {
        material: 'The archive access can be lost.',
      },
      description: 'Expose the mentor or hide the proof.',
      optionHints: ['Expose him', 'Hide the proof'],
    };

    const result = new DramaticStructureValidator().validate(bp);

    expect(result.valid).toBe(false);
    expect(result.issues.map(issue => issue.message).join('\n')).toContain('dilemma choice lacks relational or identity stakes');
  });

  it('fails major scenes without a stakes ladder in key beats', () => {
    const bp = blueprint();
    bp.scenes[1].keyBeats = ['People talk.', 'The moment continues.'];
    bp.scenes[1].dramaticStructure = {
      question: 'Can the player use the proof?',
      turn: 'People talk.',
      pressurePeak: 'The moment continues.',
      changedState: 'The meeting ends.',
    };

    const result = new DramaticStructureValidator().validate(bp);

    expect(result.valid).toBe(false);
    expect(result.issues.map(issue => issue.message).join('\n')).toContain('missing a stakes ladder');
  });

  it('fails existential stakes that are not stacked with enough layers', () => {
    const bp = blueprint();
    bp.scenes[1].stakesLayers = {
      existential: 'The future of the town is threatened.',
      relational: 'Mara trust may break in public.',
    };

    const result = new DramaticStructureValidator().validate(bp);

    expect(result.valid).toBe(false);
    expect(result.issues.map(issue => issue.message).join('\n')).toContain('at least three stakes layers');
  });
});
