import { describe, expect, it } from 'vitest';
import {
  missingRequiredMoments,
  realizationRetryFeedback,
  requiredMomentsFor,
  rewriteLosesRequiredMoment,
} from './sceneRealizationGuard';

const BLUEPRINT_SCENE = {
  requiredBeats: [
    { tier: 'authored', mustDepict: 'The pre-weekend post goes up and clears 50K before the car leaves Bucharest.' },
    { tier: 'connective', mustDepict: 'They drive for a while.' }, // free tissue — not enforced
    { tier: 'signature', mustDepict: 'Kylie catches both men watching her from the rooftop bar at sunset.' },
  ],
  signatureMoment: 'Cișmigiu at 1am: eight seconds of fog, a shadow, a scream, and a rescue.',
};

describe('requiredMomentsFor', () => {
  it('collects authored + signature beats and the scene signatureMoment; skips connective', () => {
    const moments = requiredMomentsFor(BLUEPRINT_SCENE);
    expect(moments).toHaveLength(3);
    expect(moments.map((m) => m.validator)).toEqual([
      'RequiredBeatRealizationValidator',
      'SignatureDevicePresenceValidator',
      'SignatureDevicePresenceValidator',
    ]);
  });

  it('returns [] for scenes with no contract (from-scratch runs unaffected)', () => {
    expect(requiredMomentsFor(undefined)).toEqual([]);
    expect(requiredMomentsFor({})).toEqual([]);
    expect(requiredMomentsFor({ requiredBeats: [{ tier: 'connective', mustDepict: 'x y z w' }] })).toEqual([]);
  });
});

describe('missingRequiredMoments', () => {
  it('flags under-realized moments with their absent content words', () => {
    const beats = [
      { id: 'b1', text: 'The post goes up; fifty thousand readers before the car clears Bucharest city limits.' },
      { id: 'b2', text: 'Kylie catches both men watching her from the rooftop bar at sunset.' },
      // signatureMoment (Cișmigiu) never dramatized
    ];
    const missing = missingRequiredMoments(BLUEPRINT_SCENE, beats);
    expect(missing).toHaveLength(1);
    expect(missing[0].tier).toBe('signature');
    expect(missing[0].missingTokens).toContain('cismigiu');
    expect(missing[0].missingTokens).toContain('scream');
  });

  it('passes a fully realized scene', () => {
    const beats = [
      { id: 'b1', text: 'The pre-weekend post clears 50K before the car leaves Bucharest.' },
      { id: 'b2', text: 'From the rooftop bar at sunset Kylie catches both men watching her.' },
      { id: 'b3', text: 'Cișmigiu at 1am: eight seconds of fog, a shadow, a scream — a rescue.' },
    ];
    expect(missingRequiredMoments(BLUEPRINT_SCENE, beats)).toEqual([]);
  });

  it('scans textVariants too (a variant-only realization counts)', () => {
    const beats = [{ id: 'b1', text: 'placeholder', textVariants: [{ text: 'Cișmigiu at 1am, eight seconds of fog, a shadow, a scream, and a rescue.' }] }];
    const missing = missingRequiredMoments({ signatureMoment: BLUEPRINT_SCENE.signatureMoment }, beats);
    expect(missing).toEqual([]);
  });
});

describe('realizationRetryFeedback', () => {
  it('names each moment and its missing words', () => {
    const feedback = realizationRetryFeedback([
      { moment: 'Cișmigiu at 1am: a scream and a rescue.', validator: 'SignatureDevicePresenceValidator', tier: 'signature', missingTokens: ['cismigiu', 'scream', 'rescue'] },
    ]);
    expect(feedback).toContain('[signature] Cișmigiu at 1am');
    expect(feedback).toContain('cismigiu, scream, rescue');
    expect(feedback).toContain('MUST be depicted concretely');
  });
});

describe('rewriteLosesRequiredMoment', () => {
  const source = { requiredBeats: [{ tier: 'authored', mustDepict: 'Victor reframes the blog as a privacy problem at Sunday breakfast.' }] };
  const realized = [{ id: 'b1', text: 'At Sunday breakfast, Victor reframes the blog as a privacy problem, smiling.' }];

  it('returns the lost moment when a rewrite paraphrases it away', () => {
    const polished = [{ id: 'b1', text: 'Over croissants he turns her writing into a compliment that lands like a warning.' }];
    const lost = rewriteLosesRequiredMoment(source, realized, polished);
    expect(lost?.moment).toContain('privacy problem');
  });

  it('returns undefined when the rewrite preserves the moment', () => {
    const polished = [{ id: 'b1', text: 'At Sunday breakfast Victor reframes the blog as a privacy problem — in the tone of a compliment.' }];
    expect(rewriteLosesRequiredMoment(source, realized, polished)).toBeUndefined();
  });

  it('returns undefined when the moment was ALREADY missing before the rewrite (no false revert)', () => {
    const unrealized = [{ id: 'b1', text: 'Breakfast is quiet.' }];
    const polished = [{ id: 'b1', text: 'Breakfast is quiet and the coffee is bitter.' }];
    expect(rewriteLosesRequiredMoment(source, unrealized, polished)).toBeUndefined();
  });
});
