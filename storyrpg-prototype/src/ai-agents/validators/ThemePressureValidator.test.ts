import { describe, expect, it } from 'vitest';

import type { EpisodeBlueprint } from '../agents/StoryArchitect';
import { ThemePressureValidator } from './ThemePressureValidator';

function blueprint(overrides: Partial<EpisodeBlueprint> = {}): EpisodeBlueprint {
  return {
    episodeId: 'episode-1',
    title: 'The Ledger Turns',
    synopsis: 'A mystery episode where the player exposes a betrayal.',
    arc: {
      hook: '',
      plotTurn1: '',
      pinch1: 'The mentor signature reframes the missing witness.',
      midpoint: '',
      pinch2: '',
      climax: '',
      resolution: '',
    },
    structuralRole: ['pinch1'],
    themes: ['What does loyalty cost when truth would destroy the people you love?'],
    dramaticAudit: {
      episodeQuestion: 'Will the player expose the mentor before Mara loses faith?',
      themeQuestion: 'What does loyalty cost when truth would destroy the people you love?',
      themePressure: 'The episode forces loyalty and truth into direct conflict.',
      themeAngle: 'Loyalty is tested as silence that protects a loved person but harms the town.',
      themeChoicePressure: 'The player chooses whether to reveal painful truth, hide it, or spend trust to soften the cost.',
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
      ],
      informationPlan: [
        {
          item: 'The mentor paid the missing witness.',
          knownBy: ['player', 'protagonist'],
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
        themePressure: 'The scene turns loyalty into a cost because the clue can protect Mara or expose truth.',
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
        choicePoint: {
          type: 'dilemma',
          branches: true,
          stakes: {
            want: 'Protect Mara from the truth.',
            cost: 'Lose leverage against the mentor.',
            identity: 'Become someone who hides harm to preserve loyalty.',
          },
          stakesLayers: {
            relational: 'Mara trust changes based on what the player reveals.',
            identity: 'The player defines whether loyalty means protection or honesty.',
          },
          themeAnswer: 'The player answers the loyalty question by choosing truth, protection, or a costly half-measure.',
          description: 'Reveal the signature to Mara or hide it until the confrontation.',
          optionHints: ['Show Mara', 'Hide the signature'],
          consequenceDomain: 'relationship',
          reminderPlan: {
            immediate: 'Mara reacts to the choice.',
            shortTerm: 'The confrontation opens with different trust.',
          },
        },
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
        themePressure: 'The climax makes loyalty visible as the cost of exposing painful truth.',
        stakesLayers: {
          material: 'The court record and archive access can be lost.',
          relational: 'Mara trust may break in public.',
          identity: 'The player chooses whether to become someone who exposes painful truth.',
        },
        npcsPresent: ['mara', 'arden'],
        narrativeFunction: 'Episode climax.',
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

describe('ThemePressureValidator', () => {
  it('passes a blueprint with a playable theme question and choice-answerable pressure', () => {
    const result = new ThemePressureValidator().validate(blueprint());

    expect(result.valid).toBe(true);
    expect(result.metrics.majorChoiceCount).toBe(1);
    expect(result.metrics.majorChoicesWithThemeAnswer).toBe(1);
  });

  it('rejects noun-only themes', () => {
    const bp = blueprint({
      themes: ['family'],
      dramaticAudit: {
        ...blueprint().dramaticAudit!,
        themeQuestion: 'family',
      },
    });

    const result = new ThemePressureValidator().validate(bp);

    expect(result.valid).toBe(false);
    expect(result.issues.map(issue => issue.message).join('\n')).toContain('not a usable question');
  });

  it('requires theme to be answerable by protagonist/player choice', () => {
    const bp = blueprint({
      dramaticAudit: {
        ...blueprint().dramaticAudit!,
        themeChoicePressure: 'A prophecy settles the question after the villain gives up.',
      },
    });

    const result = new ThemePressureValidator().validate(bp);

    expect(result.valid).toBe(false);
    expect(result.issues.map(issue => issue.message).join('\n')).toContain('answerable by protagonist/player action');
  });

  it('requires a distinct episode theme angle', () => {
    const bp = blueprint({
      dramaticAudit: {
        ...blueprint().dramaticAudit!,
        themeAngle: '',
      },
    });

    const result = new ThemePressureValidator().validate(bp);

    expect(result.valid).toBe(false);
    expect(result.issues.map(issue => issue.message).join('\n')).toContain('themeAngle is missing');
  });

  it('rejects direct theme-question statement in scene material', () => {
    const bp = blueprint();
    bp.scenes[0].keyBeats = [
      'Mara asks, "What does loyalty cost when truth would destroy the people you love?"',
      'PEAK: the player opens the ledger.',
    ];

    const result = new ThemePressureValidator().validate(bp);

    expect(result.valid).toBe(false);
    expect(result.issues.map(issue => issue.message).join('\n')).toContain('states the theme question directly');
  });

  it('requires major scenes to name theme pressure', () => {
    const bp = blueprint();
    bp.scenes[1].themePressure = '';

    const result = new ThemePressureValidator().validate(bp);

    expect(result.valid).toBe(false);
    expect(result.issues.map(issue => issue.message).join('\n')).toContain('missing themePressure');
  });

  it('does not require B-plots or subplots', () => {
    const bp = blueprint();
    delete (bp as any).subplots;

    const result = new ThemePressureValidator().validate(bp);

    expect(result.valid).toBe(true);
  });
});
