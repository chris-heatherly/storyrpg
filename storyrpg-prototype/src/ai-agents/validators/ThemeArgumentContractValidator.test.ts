import { describe, expect, it } from 'vitest';
import { ThemeArgumentContractValidator } from './ThemeArgumentContractValidator';
import type { ThemeArgumentContract } from '../../types/sourceAnalysis';

const contract: ThemeArgumentContract = {
  themeQuestion: 'What do you owe family when loyalty costs your selfhood?',
  controllingIdea: {
    value: 'selfhood',
    cause: 'the protagonist chooses honesty over obedience',
    sentence: 'Selfhood survives because love becomes honest rather than obedient.',
  },
  counterIdea: {
    value: 'belonging',
    cause: 'obedience appears to preserve the family',
    sentence: 'Belonging requires obedience because truth can destroy the family.',
  },
  valueLadder: {
    positive: 'love that honors agency',
    contrary: 'emotional absence',
    contradiction: 'active rejection',
    negationOfNegation: 'love used as control',
  },
  archetypalCore: 'A child must decide whether belonging is worth self-erasure.',
  uniqueSurface: 'A neon vampire-family politics story in a crumbling coastal arcade.',
  climaxResonantEvent: 'The protagonist refuses the family oath while saving the person who demanded it.',
  retroactiveReframe: 'Earlier protection reads as control, not safety.',
  aestheticEmotionTarget: 'The reader feels the cost of honest love and understands why obedience was the trap.',
};

describe('ThemeArgumentContractValidator', () => {
  it('accepts a concrete theme argument contract', () => {
    const result = new ThemeArgumentContractValidator().validate({ themeArgument: contract });
    expect(result.valid).toBe(true);
    expect(result.metrics.missingFieldCount).toBe(0);
  });

  it('flags identical controlling and counter ideas', () => {
    const result = new ThemeArgumentContractValidator().validate({
      themeArgument: {
        ...contract,
        counterIdea: { ...contract.counterIdea, sentence: contract.controllingIdea.sentence },
      },
    });

    expect(result.valid).toBe(false);
    expect(result.issues.some(issue => /identical/.test(issue.message))).toBe(true);
  });
});
