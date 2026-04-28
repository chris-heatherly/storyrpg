import { describe, it, expect } from 'vitest';
import {
  SevenPointCoverageValidator,
  SevenPointCoverageInput,
} from './SevenPointCoverageValidator';

function baseInput(overrides?: Partial<SevenPointCoverageInput>): SevenPointCoverageInput {
  return {
    anchors: {
      stakes: 'The city will fall to the Court of Ashes if Rhea chooses wrong.',
      goal: 'Rhea must recover the Ashbound Ledger before the winter council.',
      incitingIncident: 'The Court executes Rhea\'s mentor in the opening chapter.',
      climax: 'Rhea confronts the Court on the Ashgate ramparts.',
    },
    sevenPoint: {
      hook: 'Rhea forges papers in the archives, oblivious to the Court\'s spies.',
      plotTurn1: 'The mentor is executed; Rhea vows revenge.',
      pinch1: 'A failed heist nearly kills Rhea\'s ally.',
      midpoint: 'Rhea learns the Ledger names her own father.',
      pinch2: 'The Court captures her crew and forces a public tribunal.',
      climax: 'Rhea confronts the Court on the Ashgate ramparts.',
      resolution: 'The Ledger is burned; the city enters an uneasy peace.',
    },
    episodes: [
      { episodeNumber: 1, structuralRole: ['hook'], difficultyTier: 'introduction' },
      { episodeNumber: 2, structuralRole: ['plotTurn1'], difficultyTier: 'rising' },
      { episodeNumber: 3, structuralRole: ['pinch1'], difficultyTier: 'rising' },
      { episodeNumber: 4, structuralRole: ['midpoint'], difficultyTier: 'peak' },
      { episodeNumber: 5, structuralRole: ['pinch2'], difficultyTier: 'peak' },
      { episodeNumber: 6, structuralRole: ['climax'], difficultyTier: 'finale' },
      { episodeNumber: 7, structuralRole: ['resolution'], difficultyTier: 'finale' },
    ],
    resolvedEndings: [
      {
        id: 'ending-peace',
        name: 'Uneasy Peace',
        summary: 'Rhea survives and the city endures.',
        emotionalRegister: 'bittersweet',
        themePayoff: 'The city survives because Rhea chose truth over vengeance.',
        stateDrivers: [
          {
            type: 'theme',
            label: 'stakes',
            details: 'The city does not fall to the Court of Ashes.',
          },
        ],
        targetConditions: [],
        sourceConfidence: 'generated',
      },
    ],
    ...overrides,
  };
}

describe('SevenPointCoverageValidator', () => {
  it('passes when anchors, sevenPoint, episodes, and endings are all well-formed', () => {
    const validator = new SevenPointCoverageValidator();
    const result = validator.validate(baseInput());
    expect(result.valid).toBe(true);
    expect(result.issues.filter((i) => i.severity === 'error')).toHaveLength(0);
  });

  it('fails when an anchor is missing', () => {
    const validator = new SevenPointCoverageValidator();
    const result = validator.validate(
      baseInput({
        anchors: {
          stakes: 'The city will fall.',
          goal: '',
          incitingIncident: 'The mentor is executed.',
          climax: 'Rhea confronts the Court.',
        },
      }),
    );
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.location?.includes('anchors.goal'))).toBe(true);
  });

  it('fails when a 7-point beat is empty', () => {
    const validator = new SevenPointCoverageValidator();
    const input = baseInput();
    input.sevenPoint.midpoint = '';
    const result = validator.validate(input);
    expect(result.valid).toBe(false);
    expect(
      result.issues.some((i) => i.location?.includes('sevenPoint.midpoint')),
    ).toBe(true);
  });

  it('fails when a canonical beat is unassigned to any episode', () => {
    const validator = new SevenPointCoverageValidator();
    const input = baseInput();
    input.episodes[5].structuralRole = ['resolution']; // was 'climax'
    input.episodes[6].structuralRole = ['resolution'];
    const result = validator.validate(input);
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.message.includes('climax'))).toBe(true);
  });

  it('warns when sevenPoint.climax and anchors.climax describe different events', () => {
    const validator = new SevenPointCoverageValidator();
    const input = baseInput();
    input.sevenPoint.climax = 'A wedding is held in the summer gardens.';
    const result = validator.validate(input);
    expect(
      result.issues.some(
        (i) =>
          i.severity === 'warning' &&
          i.location?.includes('climax'),
      ),
    ).toBe(true);
  });

  it('warns when difficultyTier does not match structural role', () => {
    const validator = new SevenPointCoverageValidator();
    const input = baseInput();
    input.episodes[5].difficultyTier = 'introduction'; // climax episode marked as introduction
    const result = validator.validate(input);
    expect(
      result.issues.some(
        (i) =>
          i.severity === 'warning' &&
          i.message.includes('climax') &&
          i.message.includes('introduction'),
      ),
    ).toBe(true);
  });

  it('warns when no ending links back to the season Stakes', () => {
    const validator = new SevenPointCoverageValidator();
    const input = baseInput();
    input.resolvedEndings = [
      {
        id: 'ending-unrelated',
        name: 'Epilogue',
        summary: 'A flower blooms.',
        emotionalRegister: 'quiet',
        themePayoff: 'Gardens endure.',
        stateDrivers: [],
        targetConditions: [],
        sourceConfidence: 'generated',
      },
    ];
    const result = validator.validate(input);
    expect(
      result.issues.some(
        (i) =>
          i.severity === 'warning' &&
          i.location === 'season.resolvedEndings',
      ),
    ).toBe(true);
  });
});
