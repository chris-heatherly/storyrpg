import { describe, expect, it } from 'vitest';

import type { EpisodeBlueprint } from '../agents/StoryArchitect';
import { SceneTurnContractValidator } from './SceneTurnContractValidator';

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
      themeQuestion: 'What does loyalty cost when truth would destroy the people you love?',
      themePressure: 'The episode forces loyalty and truth into direct conflict.',
      themeAngle: 'Loyalty is tested as silence that protects a loved person but harms the town.',
      themeChoicePressure: 'The player chooses whether to reveal painful truth or hide it.',
      personalStake: 'Mara trust and the player reputation will be damaged if the truth is mishandled.',
      stakesLayers: {
        material: 'The archive access can be lost.',
        relational: 'Mara trust is at risk.',
        identity: 'The player becomes someone who chooses truth under pressure.',
      },
      majorTurns: [],
      informationPlan: [],
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
          pressurePeak: 'The player must choose whether to show Mara the signature.',
          changedState: 'The player now has proof and damaged trust.',
        },
        personalStake: 'Mara trust and the player reputation are at risk.',
        themePressure: 'The scene turns loyalty into a cost because the clue can protect Mara or expose truth.',
        stakesLayers: {
          material: 'The sealed ledger and archive access can be lost.',
          relational: 'Mara trust is at risk.',
          identity: 'The player chooses whether truth matters more than comfort.',
        },
        sequenceIntent: {
          objective: 'Open the ledger without destroying Mara trust.',
          activity: 'searching the archive',
          obstacle: 'The locked seal and Mara fear block the truth.',
          startState: 'The player has suspicion but no proof.',
          turningPoint: 'The mentor signature appears.',
          endState: 'The player leaves with proof and damaged trust.',
          visualThread: 'the sealed ledger',
        },
        npcsPresent: ['mara'],
        narrativeFunction: 'Reveal the clue that makes the confrontation possible.',
        keyBeats: ['The player opens the seal.', 'PEAK: the player must choose whether to show Mara.'],
        leadsTo: [],
        transitionOut: [],
        residue: [{
          type: 'information',
          description: 'The player knows the mentor paid the witness.',
        }],
      },
    ],
    startingSceneId: 'scene-1',
    bottleneckScenes: ['scene-1'],
    suggestedFlags: [],
    suggestedScores: [],
    suggestedTags: [],
    narrativePromises: [],
    ...overrides,
  };
}

describe('SceneTurnContractValidator', () => {
  it('passes a scene with entry intent, obstacle, forced decision, and exit shift', () => {
    const result = new SceneTurnContractValidator().validate(blueprint());

    expect(result.valid).toBe(true);
    expect(result.metrics.scenesWithEntryIntent).toBe(1);
    expect(result.metrics.scenesWithObstacle).toBe(1);
    expect(result.metrics.scenesWithForcedDecision).toBe(1);
    expect(result.metrics.scenesWithExitShift).toBe(1);
  });

  it('fails a scene without entry intent', () => {
    const bp = blueprint();
    bp.scenes[0].sequenceIntent!.objective = '';
    bp.scenes[0].dramaticQuestion = '';
    bp.scenes[0].wantVsNeed = '';

    const result = new SceneTurnContractValidator().validate(bp);

    expect(result.valid).toBe(false);
    expect(result.issues.map(issue => issue.message).join('\n')).toContain('lacks entry intent');
  });

  it('fails a scene without an active obstacle', () => {
    const bp = blueprint();
    bp.scenes[0].sequenceIntent!.obstacle = '';
    bp.scenes[0].conflictEngine = '';
    bp.scenes[0].encounterBuildup = '';
    bp.scenes[0].encounterStakes = '';
    bp.scenes[0].dramaticStructure!.turn = 'The moment continues.';
    bp.scenes[0].dramaticStructure!.pressurePeak = 'The moment continues.';

    const result = new SceneTurnContractValidator().validate(bp);

    expect(result.valid).toBe(false);
    expect(result.issues.map(issue => issue.message).join('\n')).toContain('lacks an active obstacle');
  });

  it('fails a scene without a forced decision or irreversible reaction', () => {
    const bp = blueprint();
    bp.scenes[0].choicePoint = undefined;
    bp.scenes[0].sequenceIntent!.turningPoint = 'The room grows quiet.';
    bp.scenes[0].dramaticStructure!.pressurePeak = 'The room grows quiet.';
    bp.scenes[0].dramaticStructure!.changedState = 'The scene ends in a different mood.';
    bp.scenes[0].keyBeats = ['The room grows quiet.', 'The moment lingers.'];
    bp.scenes[0].residue = [];

    const result = new SceneTurnContractValidator().validate(bp);

    expect(result.valid).toBe(false);
    expect(result.issues.map(issue => issue.message).join('\n')).toContain('lacks a forced decision');
  });

  it('fails a scene without an exit shift', () => {
    const bp = blueprint();
    bp.scenes[0].sequenceIntent!.endState = '';
    bp.scenes[0].dramaticStructure!.changedState = '';
    bp.scenes[0].residue = [];
    bp.scenes[0].transitionOut = [];

    const result = new SceneTurnContractValidator().validate(bp);

    expect(result.valid).toBe(false);
    expect(result.issues.map(issue => issue.message).join('\n')).toContain('lacks an exit shift');
  });

  it('fails a major multi-character scene without a power dynamic shift', () => {
    const bp = blueprint();
    bp.scenes[0] = {
      ...bp.scenes[0],
      description: 'The player studies the code beside Mara.',
      dramaticQuestion: 'Will the player open the code?',
      wantVsNeed: 'They want the code; they need to act.',
      conflictEngine: 'A locked seal blocks the code.',
      dramaticStructure: {
        question: 'Will the player open the code?',
        turn: 'The code appears.',
        pressurePeak: 'The player must act.',
        changedState: 'The player knows the code.',
      },
      personalStake: 'The code can be lost.',
      themePressure: 'The scene tests whether action is worth the cost.',
      stakesLayers: {
        material: 'The code can be lost.',
      },
      sequenceIntent: {
        objective: 'Open the code.',
        activity: 'studying the page',
        obstacle: 'A locked seal blocks the code.',
        startState: 'The code is sealed.',
        turningPoint: 'The code appears.',
        endState: 'The player knows the code.',
        visualThread: 'the code page',
      },
      npcsPresent: ['mara'],
      narrativeFunction: 'Reveal the code.',
      keyBeats: ['The player opens the page.', 'PEAK: the player must act.'],
      residue: [{
        type: 'information',
        description: 'The player knows the code.',
      }],
    };

    const result = new SceneTurnContractValidator().validate(bp);

    expect(result.valid).toBe(false);
    expect(result.issues.map(issue => issue.message).join('\n')).toContain('lacks a power-dynamic shift');
  });

  it('fails a removable scene with no narrative consequence', () => {
    const bp = blueprint();
    bp.scenes[0] = {
      ...bp.scenes[0],
      description: 'The player studies a blank wall.',
      dramaticQuestion: 'Will the player act?',
      wantVsNeed: 'They want quiet; they need to act.',
      conflictEngine: 'A locked door blocks the room.',
      dramaticStructure: {
        question: 'Will the player act?',
        turn: 'The room pauses.',
        pressurePeak: 'The player must act.',
        changedState: '',
      },
      personalStake: '',
      themePressure: '',
      stakesLayers: undefined,
      sequenceIntent: {
        objective: 'Study the room.',
        activity: 'standing by the wall',
        obstacle: 'A locked door blocks the room.',
        startState: 'The room is quiet.',
        turningPoint: 'The room pauses.',
        endState: '',
        visualThread: 'the blank wall',
      },
      npcsPresent: [],
      narrativeFunction: 'Atmosphere.',
      keyBeats: ['The player waits.', 'PEAK: the player must act.'],
      leadsTo: [],
      transitionOut: [],
      residue: [],
      choicePoint: undefined,
      isEncounter: undefined,
    };

    const result = new SceneTurnContractValidator().validate(bp);

    expect(result.valid).toBe(false);
    expect(result.issues.map(issue => issue.message).join('\n')).toContain('appears removable');
  });
});
