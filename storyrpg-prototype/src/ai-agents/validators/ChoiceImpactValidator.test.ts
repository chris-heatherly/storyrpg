import { describe, expect, it } from 'vitest';
import { ChoiceImpactValidator } from './ChoiceImpactValidator';

describe('ChoiceImpactValidator', () => {
  it('rejects flavor or expression choices that branch', () => {
    const result = new ChoiceImpactValidator().validate({
      choices: [{
        id: 'wave',
        text: 'Wave politely.',
        choiceType: 'expression',
        choiceIntent: 'flavor',
        nextSceneId: 'secret-route',
      }],
    });

    expect(result.valid).toBe(false);
    expect(result.issues[0].message).toContain('branches');
    expect(result.metrics.flavorBranches).toBe(1);
  });

  it('warns when meaningful choices lack impact factors and stakes', () => {
    const result = new ChoiceImpactValidator().validate({
      choices: [{
        id: 'betray',
        text: 'Turn on the captain.',
        choiceType: 'dilemma',
        choiceIntent: 'dilemma',
        nextSceneId: 'captain-falls',
      }],
    });

    expect(result.valid).toBe(true);
    expect(result.issues.map((issue) => issue.message).join('\n')).toContain('no impactFactors');
    expect(result.issues.map((issue) => issue.message).join('\n')).toContain('needs complete stakes');
  });

  it('passes a classified meaningful choice with durable impact', () => {
    const result = new ChoiceImpactValidator().validate({
      choices: [{
        id: 'tell-truth',
        text: 'Tell Mira the truth.',
        choiceType: 'relationship',
        choiceIntent: 'blind',
        impactFactors: ['relationship', 'identity'],
        consequenceTier: 'sceneTint',
        stakes: {
          want: 'Keep Mira close.',
          cost: 'Risk her anger.',
          identity: 'Become honest under pressure.',
        },
        consequences: [{ type: 'setFlag', flag: 'mira-knows-truth', value: true } as any],
      }],
    });

    expect(result.valid).toBe(true);
    expect(result.issues).toEqual([]);
  });
});
