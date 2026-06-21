import { describe, expect, it } from 'vitest';
import {
  improvesMissingRealization,
  insertMissingMomentBeats,
  missingRequiredMoments,
  realizationRetryFeedback,
  requiredMomentsFor,
  rewriteLosesRequiredMoment,
} from './sceneRealizationGuard';

const BLUEPRINT_SCENE = {
  requiredBeats: [
    { tier: 'authored', mustDepict: 'The pre-weekend post goes up and clears 50K before the car leaves Bucharest.' },
    { tier: 'connective', mustDepict: 'They drive for a while.' }, // free tissue — not enforced
    { tier: 'seed', mustDepict: 'The quartz in Kylie’s pocket warms when Stela presses it into her hand.' },
    { tier: 'signature', mustDepict: 'Kylie catches both men watching her from the rooftop bar at sunset.' },
  ],
  signatureMoment: 'Cișmigiu at 1am: eight seconds of fog, a shadow, a scream, and a rescue.',
  choicePoint: { setsTreatmentSeeds: ['treatment_seed_ep1_1'] },
};

describe('requiredMomentsFor', () => {
  it('collects authored + seed + signature beats and the scene signatureMoment; skips connective', () => {
    const moments = requiredMomentsFor(BLUEPRINT_SCENE);
    expect(moments).toHaveLength(4);
    expect(moments.map((m) => m.validator)).toEqual([
      'RequiredBeatRealizationValidator',
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

  it('enforces concrete physical seed moments even when they are not flag-scoped', () => {
    const moments = requiredMomentsFor({
      requiredBeats: [{ tier: 'seed', mustDepict: 'The stray dog in the courtyard, watching.' }],
    });
    expect(moments).toEqual([expect.objectContaining({
      moment: 'The stray dog in the courtyard, watching.',
      tier: 'seed',
    })]);
  });

  it('flags missing concrete physical seeds at scene time', () => {
    const missing = missingRequiredMoments(
      { requiredBeats: [{ tier: 'seed', mustDepict: 'The stray dog in the courtyard, watching.' }] },
      [{ id: 'b1', text: 'The courtyard is empty except for rain and old leaves.' }],
    );
    expect(missing).toHaveLength(1);
    expect(missing[0].missingTokens).toContain('stray');
    expect(missing[0].missingTokens).toContain('watching');
  });

  it('does not enforce abstract seed labels unless the scene declares it sets a treatment seed', () => {
    const moments = requiredMomentsFor({
      requiredBeats: [{ tier: 'seed', mustDepict: "Victor's Nature" }],
    });
    expect(moments).toEqual([]);
  });

  it('does not enforce unscoped choice-contingent future residue', () => {
    const moments = requiredMomentsFor({
      requiredBeats: [{ tier: 'seed', mustDepict: "The quartz Kylie did or didn't accept warms in her pocket." }],
    });
    expect(moments).toEqual([]);
  });
});

describe('missingRequiredMoments', () => {
  it('flags under-realized moments with their absent content words', () => {
    const beats = [
      { id: 'b1', text: 'The post goes up; fifty thousand readers before the car clears Bucharest city limits.' },
      { id: 'b-seed', text: 'Stela presses the quartz into Kylie’s hand, and its warmth follows her into the night.' },
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
      { id: 'b-seed', text: 'The quartz in Kylie’s pocket warms when Stela presses it into her hand.' },
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

describe('improvesMissingRealization', () => {
  it('keeps a retry that reduces missing tokens inside the same authored moment', () => {
    const before = [{
      moment: 'On night three at a rooftop bar at sunset, Kylie locks eyes with Victor across the room.',
      validator: 'RequiredBeatRealizationValidator' as const,
      tier: 'authored',
      missingTokens: ['three', 'rooftop', 'sunset', 'kylie', 'victor', 'room'],
    }];
    const after = [{
      ...before[0],
      missingTokens: ['victor', 'room'],
    }];

    expect(improvesMissingRealization(before, after)).toBe(true);
  });

  it('does not keep a retry that leaves realization score unchanged', () => {
    const before = [{
      moment: 'The quartz warms in Kylie\'s pocket.',
      validator: 'RequiredBeatRealizationValidator' as const,
      tier: 'seed',
      missingTokens: ['quartz'],
    }];
    const after = [{ ...before[0], missingTokens: ['quartz'] }];

    expect(improvesMissingRealization(before, after)).toBe(false);
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

describe('insertMissingMomentBeats', () => {
  it('inserts concrete authored moments before the choice point and wires nextBeatId', () => {
    const beats = [
      { id: 's1-b1', text: 'The rooftop noise rises.', nextBeatId: 's1-b2' },
      { id: 's1-b2', text: 'What do you do?', isChoicePoint: true, choices: [{ id: 'c1' }] },
    ];
    const missing = missingRequiredMoments(
      { requiredBeats: [{ tier: 'seed', mustDepict: 'The stray dog in the courtyard, watching.' }] },
      beats,
    );

    insertMissingMomentBeats('s1', beats, missing);

    expect(beats.map((beat) => beat.id)).toEqual([
      's1-b1',
      expect.stringContaining('s1-authored-seed-the-stray-dog-in-the-courtyard-watching'),
      's1-b2',
    ]);
    expect(beats[0].nextBeatId).toBe(beats[1].id);
    expect(beats[1].nextBeatId).toBe('s1-b2');
    expect(beats[1].text).toBe('The stray dog in the courtyard, watching.');
    expect(missingRequiredMoments(
      { requiredBeats: [{ tier: 'seed', mustDepict: 'The stray dog in the courtyard, watching.' }] },
      beats,
    )).toEqual([]);
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
