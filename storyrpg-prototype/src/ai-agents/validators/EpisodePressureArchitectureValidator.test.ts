import { describe, expect, it } from 'vitest';

import type { EpisodeBlueprint } from '../agents/StoryArchitect';
import { EpisodePressureArchitectureValidator } from './EpisodePressureArchitectureValidator';

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
      episodeQuestionSetup: 'The opening ledger scene poses whether truth is worth damaging Mara trust.',
      episodeQuestionAnswer: 'The confrontation answers that truth can save the case while wounding the relationship.',
      themeQuestion: 'What does loyalty cost when truth would destroy the people you love?',
      themePressure: 'The episode forces loyalty and truth into direct conflict.',
      themeAngle: 'Loyalty is tested as silence that protects a loved person but harms the town.',
      themeChoicePressure: 'The player chooses whether to reveal painful truth or hide it.',
      openingPromise: {
        hook: 'Mara reaches the sealed ledger before the player can stop her.',
        episodePromise: 'A truth will matter only if the player pays a relationship cost.',
        activePressure: 'The sealed ledger threatens Mara trust and public reputation.',
        optionalStakes: 'Mara trust and archive access are on the table.',
      },
      episodePressureLanes: {
        aPlot: {
          externalPressure: 'Expose the forged witness payment before the court closes the archive.',
          climaxIntersection: 'The court confrontation uses the ledger as the decisive proof.',
        },
        bPlot: {
          mode: 'scene',
          relationshipOrIdentityPressure: 'Mara needs loyalty but the player needs truth.',
          offscreenNpcMotivation: 'Mara has been protecting the mentor because she owes him her place in the archive.',
          protagonistVisibleSignals: [
            'Mara flinches at the mentor signature.',
            'Mara asks the player not to read the second page aloud.',
          ],
          scenesOrEpisodes: ['scene-1', 'scene-2'],
          climaxIntersection: 'The proof only works if the player spends Mara trust in public.',
        },
        cPlot: {
          function: 'future_seed',
          seed: 'The witness mark appears on a second sealed note.',
          visiblePlant: 'A second seal carries the same ash-gray mark.',
          payoffPlan: 'The mark can identify the wider conspiracy in a later episode.',
          targetPayoff: 'later_episode',
        },
      },
      episodeEndStateDelta: 'The player has proof, Mara trust is damaged, and archive access is politically dangerous.',
      nextEpisodePressure: 'The second seal points toward a larger witness conspiracy.',
      personalStake: 'Mara trust and the player reputation will be damaged if the truth is mishandled.',
      stakesLayers: {
        material: 'The archive access can be lost.',
        relational: 'Mara trust is at risk.',
        identity: 'The player becomes someone who chooses truth under pressure.',
      },
      majorTurns: [
        {
          id: 'turn-1',
          description: 'The player opens the sealed ledger.',
          turnType: 'revelation',
          driver: 'player_choice',
          protagonistInfluence: 'The discovery happens because the player risks breaking the seal.',
          closesQuestion: 'The ledger answers whether there is proof.',
          opensQuestion: 'The mentor signature asks whether truth will destroy Mara trust.',
          memorableImageOrLine: 'The mentor signature blooms through the dust.',
        },
        {
          id: 'turn-2',
          description: 'Mara asks the player to hide the signature.',
          turnType: 'choice',
          driver: 'protagonist',
          protagonistInfluence: 'The player response determines whether trust or truth leads into court.',
          closesQuestion: 'Mara loyalty is no longer abstract.',
          opensQuestion: 'The court will make the private choice public.',
          memorableImageOrLine: 'Mara keeps one hand on the page as if she can hold the truth down.',
        },
      ],
      informationPlan: [],
    },
    scenes: [
      {
        id: 'scene-1',
        name: 'The Ledger',
        description: 'The player opens the sealed ledger with Mara watching.',
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
        npcsPresent: ['mara'],
        narrativeFunction: 'Reveal the clue that makes the confrontation possible.',
        keyBeats: ['Mara reaches the sealed ledger before the player can stop her.', 'PEAK: the signature appears'],
        leadsTo: ['scene-2'],
        transitionOut: [],
        residue: [],
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
        themePressure: 'The return makes loyalty visible as the cost of exposing painful truth.',
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
        residue: [],
        isEncounter: true,
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

describe('EpisodePressureArchitectureValidator', () => {
  it('passes complete episode pressure architecture', () => {
    const result = new EpisodePressureArchitectureValidator().validate(blueprint(), {
      targetSceneCount: 5,
    });

    expect(result.valid).toBe(true);
    expect(result.metrics.hasAPlot).toBe(true);
    expect(result.metrics.hasBPlot).toBe(true);
    expect(result.metrics.hasCPlot).toBe(true);
  });

  it('fails missing episode question setup', () => {
    const bp = blueprint();
    bp.dramaticAudit!.episodeQuestionSetup = '';

    const result = new EpisodePressureArchitectureValidator().validate(bp);

    expect(result.valid).toBe(false);
    expect(result.issues.map(issue => issue.message).join('\n')).toContain('episodeQuestionSetup is missing');
  });

  it('fails missing episode question answer', () => {
    const bp = blueprint();
    bp.dramaticAudit!.episodeQuestionAnswer = '';

    const result = new EpisodePressureArchitectureValidator().validate(bp);

    expect(result.valid).toBe(false);
    expect(result.issues.map(issue => issue.message).join('\n')).toContain('episodeQuestionAnswer is missing');
  });

  it('fails missing opening promise', () => {
    const bp = blueprint();
    bp.dramaticAudit!.openingPromise = undefined;

    const result = new EpisodePressureArchitectureValidator().validate(bp);

    expect(result.valid).toBe(false);
    expect(result.issues.map(issue => issue.message).join('\n')).toContain('openingPromise is incomplete');
  });

  it('fails missing A-plot', () => {
    const bp = blueprint();
    bp.dramaticAudit!.episodePressureLanes = {} as any;

    const result = new EpisodePressureArchitectureValidator().validate(bp);

    expect(result.valid).toBe(false);
    expect(result.issues.map(issue => issue.message).join('\n')).toContain('aPlot is incomplete');
  });

  it('fails B-plot with no protagonist-visible signals', () => {
    const bp = blueprint();
    bp.dramaticAudit!.episodePressureLanes!.bPlot!.protagonistVisibleSignals = [];

    const result = new EpisodePressureArchitectureValidator().validate(bp);

    expect(result.valid).toBe(false);
    expect(result.issues.map(issue => issue.message).join('\n')).toContain('no protagonist-visible signals');
  });

  it('fails B-plot with no return intersection', () => {
    const bp = blueprint();
    bp.dramaticAudit!.episodePressureLanes!.bPlot!.climaxIntersection = '';

    const result = new EpisodePressureArchitectureValidator().validate(bp);

    expect(result.valid).toBe(false);
    expect(result.issues.map(issue => issue.message).join('\n')).toContain('climaxIntersection is missing');
  });

  it('fails B-plot scene mode with no scene or episode references', () => {
    const bp = blueprint();
    bp.dramaticAudit!.episodePressureLanes!.bPlot!.mode = 'scene';
    bp.dramaticAudit!.episodePressureLanes!.bPlot!.scenesOrEpisodes = [];

    const result = new EpisodePressureArchitectureValidator().validate(bp);

    expect(result.valid).toBe(false);
    expect(result.issues.map(issue => issue.message).join('\n')).toContain('scene mode needs scenesOrEpisodes');
  });

  it('warns when a relationship-heavy longer episode lacks B-plot', () => {
    const bp = blueprint();
    delete bp.dramaticAudit!.episodePressureLanes!.bPlot;

    const result = new EpisodePressureArchitectureValidator().validate(bp, {
      targetSceneCount: 6,
    });

    expect(result.valid).toBe(true);
    expect(result.issues.some(issue => issue.severity === 'warning' && issue.message.includes('no B-plot'))).toBe(true);
  });

  it('passes short episodes without B/C lanes when they would be forced', () => {
    const bp = blueprint();
    bp.scenes = [bp.scenes[0]];
    bp.dramaticAudit!.episodePressureLanes = {
      aPlot: bp.dramaticAudit!.episodePressureLanes!.aPlot,
    };

    const result = new EpisodePressureArchitectureValidator().validate(bp, {
      targetSceneCount: 3,
    });

    expect(result.valid).toBe(true);
  });

  it('fails missing episode end state delta', () => {
    const bp = blueprint();
    bp.dramaticAudit!.episodeEndStateDelta = '';

    const result = new EpisodePressureArchitectureValidator().validate(bp);

    expect(result.valid).toBe(false);
    expect(result.issues.map(issue => issue.message).join('\n')).toContain('episodeEndStateDelta is missing');
  });

  it('warns non-finale missing next episode pressure', () => {
    const bp = blueprint();
    bp.dramaticAudit!.nextEpisodePressure = '';

    const result = new EpisodePressureArchitectureValidator().validate(bp);

    expect(result.valid).toBe(true);
    expect(result.issues.some(issue => issue.severity === 'warning' && issue.message.includes('nextEpisodePressure'))).toBe(true);
  });

  it('accepts finale aftermath without next episode pressure', () => {
    const bp = blueprint({ storyCircleRole: [{ beat: 'change', roleKind: 'primary', source: 'llm' }] });
    bp.dramaticAudit!.nextEpisodePressure = '';

    const result = new EpisodePressureArchitectureValidator().validate(bp, {
      isFinale: true,
    });

    expect(result.valid).toBe(true);
    expect(result.issues.some(issue => issue.message.includes('nextEpisodePressure'))).toBe(false);
  });

  it('warns vague C-plot payoff target without requiring Story Circle', () => {
    const bp = blueprint();
    bp.dramaticAudit!.episodePressureLanes!.cPlot!.targetPayoff = undefined;

    const result = new EpisodePressureArchitectureValidator().validate(bp);

    expect(result.valid).toBe(true);
    expect(result.issues.some(issue => issue.severity === 'warning' && issue.message.includes('targetPayoff'))).toBe(true);
  });
});
