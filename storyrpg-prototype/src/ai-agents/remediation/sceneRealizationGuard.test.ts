import { describe, expect, it } from 'vitest';
import {
  improvesMissingRealization,
  insertMissingMomentBeats,
  missingRequiredMoments,
  realizationRetryFeedback,
  requiredMomentsFor,
  rewriteLosesRequiredMoment,
} from './sceneRealizationGuard';
import { buildSceneConstructionPromptView } from '../utils/sceneConstructionProfile';

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

  it('flags a shoe-swap authored beat when prose only jokes about the shoes', () => {
    const missing = missingRequiredMoments(
      { requiredBeats: [{ tier: 'authored', mustDepict: 'Mika swaps out her "American shoes,"' }] },
      [
        { id: 'b1', text: 'Mika waves a dismissive hand at your shoes, calling them an international crime.' },
        { id: 'b2', text: 'She opens a sleek black shoebox with a flourish.' },
      ],
    );

    expect(missing).toHaveLength(1);
    expect(missing[0].missingTokens).toEqual(expect.arrayContaining(['swap-shoes', 'american-shoes']));
  });

  it('does not enforce abstract seed labels even when the scene declares it sets a treatment seed', () => {
    const moments = requiredMomentsFor({
      requiredBeats: [{ tier: 'seed', mustDepict: "Victor's Nature" }],
      choicePoint: { setsTreatmentSeeds: ['treatment_seed_ep1_1'] },
    });
    expect(moments).toEqual([]);
  });

  it('does not enforce hidden backstory seeds as player-facing prose', () => {
    const moments = requiredMomentsFor({
      requiredBeats: [
        { tier: 'seed', mustDepict: 'Mika is a succubus bound by a 57-year contract to Victor, assigned to reel Kylie in.' },
        { tier: 'seed', mustDepict: 'Kylie arrives in Bucharest, starts her blog, gathers her friend group, and lets herself be courted by Victor.' },
      ],
      choicePoint: { setsTreatmentSeeds: ['treatment_seed_ep1_1'] },
    });
    expect(moments).toEqual([]);
  });

  it('does not enforce unscoped choice-contingent future residue', () => {
    const moments = requiredMomentsFor({
      requiredBeats: [{ tier: 'seed', mustDepict: "The quartz Kylie did or didn't accept warms in her pocket." }],
    });
    expect(moments).toEqual([]);
  });

  it('skips social umbrella authored fragments while keeping concrete sibling actions', () => {
    const moments = requiredMomentsFor({
      requiredBeats: [
        { tier: 'authored', mustDepict: 'Mika adopts Kylie at the door of Vâlcescu Club on night two' },
        { tier: 'authored', mustDepict: 'Mika swaps out her "American shoes,"' },
        { tier: 'authored', mustDepict: 'Mika hands her a key card to the side entrance.' },
      ],
    });

    expect(moments.map((m) => m.moment)).toEqual([
      'Mika swaps out her "American shoes,"',
      'Mika hands her a key card to the side entrance.',
    ]);
  });
});

describe('missingRequiredMoments', () => {
  it('does not enforce routed construction obligations as hidden scene realization requirements', () => {
    const scene = {
      id: 's1-1',
      requiredBeats: [
        {
          id: 'active-arrival',
          tier: 'authored',
          mustDepict: 'The traveler arrives at the station with two suitcases.',
        },
        {
          id: 'routed-aftermath',
          tier: 'authored',
          mustDepict: 'The traveler turns a later rescue into public proof that they can author a new life.',
        },
      ],
      sceneConstructionProfile: {
        activeCast: [],
        passiveCast: [],
        obligations: [
          { source: 'requiredBeat', id: 'active-arrival', slot: 'must_stage' },
          { source: 'requiredBeat', id: 'routed-aftermath', slot: 'route_later' },
        ],
      },
    } as any;

    const realizationScene = buildSceneConstructionPromptView(scene);
    const missing = missingRequiredMoments(realizationScene, [
      { id: 'b1', text: 'At the station, the traveler arrives with two suitcases and stops at the threshold.' },
    ]);

    expect(realizationScene.requiredBeats?.map((beat: any) => beat.id)).toEqual(['active-arrival']);
    expect(missing).toEqual([]);
  });

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
  it('names each moment and its missing requirements', () => {
    const feedback = realizationRetryFeedback([
      { moment: 'Cișmigiu at 1am: a scream and a rescue.', validator: 'SignatureDevicePresenceValidator', tier: 'signature', missingTokens: ['cismigiu', 'scream', 'rescue'] },
    ]);
    expect(feedback).toContain('[signature] Cișmigiu at 1am');
    expect(feedback).toContain('cismigiu, scream, rescue');
    expect(feedback).toContain('MUST be depicted concretely');
  });

  it('translates action-requirement tokens into prose instructions', () => {
    const feedback = realizationRetryFeedback([
      { moment: 'Victor declines to come in', validator: 'RequiredBeatRealizationValidator', tier: 'authored', missingTokens: ['decline-entry'] },
    ]);
    expect(feedback).toContain('Victor declines to come in');
    expect(feedback).toContain('explicitly refusing to enter, come inside, or cross the threshold');
    expect(feedback).not.toContain('decline-entry');
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

  it('skips a time-coded authored fallback by default so routing can escalate it', () => {
    const beats = [
      { id: 'b1', text: 'The last sunset warms the Lipscani apartment.', nextBeatId: 'b2' },
      { id: 'b2', text: 'Sadie asks whether Romania has vampires.', nextBeatId: 'b3' },
      { id: 'b3', text: 'Three nights later, you are on a rooftop bar at sunset.', nextBeatId: 'b4' },
      { id: 'b4', text: 'It is past 1 a.m. when you walk home through Cișmigiu.' },
    ];
    const missing = [{
      moment: 'Mika adopts Kylie at the door of Vâlcescu Club on night two, swaps out her American shoes, and hands her a key card to the side entrance.',
      validator: 'RequiredBeatRealizationValidator' as const,
      tier: 'authored',
      missingTokens: ['mika'],
    }];
    const skipped: string[] = [];

    insertMissingMomentBeats('s1-1', beats, missing, {
      onSkip: (m, reason) => skipped.push(`${m.moment}:${reason}`),
    });

    expect(beats.map((beat) => beat.id)).toEqual([
      'b1',
      'b2',
      'b3',
      'b4',
    ]);
    expect(skipped[0]).toContain('timeline or cross-scene cues');
  });

  it('allows deterministic recovery for same-scene viral Mr Midnight aftermath beats', () => {
    const beats = [
      { id: 'b1', text: 'The laptop counter jumps while Mika calls about everyone sharing the Mr Midnight thing.', nextBeatId: 'b2' },
      { id: 'b2', text: 'Stela warns that the attention has teeth.' },
    ];
    const missing = [{
      moment: 'the viral *Mr Midnight* post changes the aftermath by making her a name',
      validator: 'RequiredBeatRealizationValidator' as const,
      tier: 'authored',
      missingTokens: ['viral', 'post', 'name'],
    }];
    const skipped: string[] = [];

    insertMissingMomentBeats('s1-blog-aftermath', beats, missing, {
      onSkip: (m, reason) => skipped.push(`${m.moment}:${reason}`),
    });

    expect(skipped).toEqual([]);
    expect(beats.some((beat) => beat.text?.includes('the viral *Mr Midnight* post changes the aftermath by making her a name'))).toBe(true);
  });

  it('allows deterministic recovery for arrival beats with public-breakup backstory', () => {
    const beats = [
      { id: 'b1', text: 'The taxi turns into Lipscani with the city still wet from rain.', nextBeatId: 'b2' },
      { id: 'b2', text: 'The apartment key waits in her palm.' },
    ];
    const missing = [{
      moment: "Kylie Marinescu arrives in Bucharest as a charming, wounded observer with two suitcases, her grandmother's address, and the intent to rebuild after a public breakup",
      validator: 'RequiredBeatRealizationValidator' as const,
      tier: 'authored',
      missingTokens: ['kylie', 'marinescu', 'arrives', 'bucharest', 'charming'],
    }];
    const skipped: string[] = [];

    insertMissingMomentBeats('s1-arrival-cold-open', beats, missing, {
      onSkip: (m, reason) => skipped.push(`${m.moment}:${reason}`),
    });

    expect(skipped).toEqual([]);
    expect(beats.some((beat) => beat.text?.includes('Kylie Marinescu arrives in Bucharest'))).toBe(true);
  });

  it('does not treat title-cased project and group names as unsafe timeline cues', () => {
    const beats = [
      { id: 'b1', text: 'The rescue leaves her hands shaking above the keyboard.', nextBeatId: 'b2' },
      { id: 'b2', text: 'The publish button waits.' },
    ];
    const missing = [{
      moment: 'Signal After Dusk turns the Dusk Circle rescue into proof the narrator can author a new life',
      validator: 'RequiredBeatRealizationValidator' as const,
      tier: 'authored',
      missingTokens: ['signal', 'dusk', 'circle'],
    }];
    const skipped: string[] = [];

    insertMissingMomentBeats('s1-blog-aftermath', beats, missing, {
      onSkip: (m, reason) => skipped.push(`${m.moment}:${reason}`),
    });

    expect(skipped).toEqual([]);
    expect(beats.some((beat) => beat.text?.includes('Signal After Dusk turns the Dusk Circle rescue'))).toBe(true);
  });

  it('skips terse action summaries instead of pasting planning labels into prose', () => {
    const beats = [
      { id: 'b1', text: 'Victor steadies you as the streetlights blur.', nextBeatId: 'b2' },
      { id: 'b2', text: 'The apartment door waits at the top of the stairs.' },
    ];
    const missing = [{
      moment: 'Victor walks her home',
      validator: 'RequiredBeatRealizationValidator' as const,
      tier: 'authored',
      missingTokens: ['victor', 'walks', 'home'],
    }];
    const skipped: string[] = [];

    insertMissingMomentBeats('s1-4', beats, missing, {
      onSkip: (m, reason) => skipped.push(`${m.moment}:${reason}`),
    });

    expect(beats.map((beat) => beat.text)).toEqual([
      'Victor steadies you as the streetlights blur.',
      'The apartment door waits at the top of the stairs.',
    ]);
    expect(skipped[0]).toContain('terse action summary needs prose rewrite');
  });

  it('allows last-resort insertion for concrete action requirements even when the moment is terse', () => {
    const beats = [
      { id: 'b1', text: 'Victor stands outside the apartment door, patient and unreadable.', nextBeatId: 'b2' },
      { id: 'b2', text: 'The hallway light flickers once.' },
    ];
    const missing = [{
      moment: 'Victor declines to come in',
      validator: 'RequiredBeatRealizationValidator' as const,
      tier: 'authored',
      missingTokens: ['decline-entry'],
    }];

    insertMissingMomentBeats('s1-4-threshold', beats, missing);

    expect(beats.map((beat) => beat.text)).toEqual([
      'Victor stands outside the apartment door, patient and unreadable.',
      'The hallway light flickers once.',
      'Victor declines to come in.',
    ]);
    expect(beats[1].nextBeatId).toBe(beats[2].id);
  });

  it('does not insert from a stale missing list when current prose already depicts the moment', () => {
    const beats = [
      { id: 'b1', text: 'Victor stops at the threshold, careful not to cross it.', nextBeatId: 'b2' },
      { id: 'b2', text: 'He lifts your hand and kisses your knuckles with impossible formality.' },
    ];
    const missing = [{
      moment: 'Victor kisses her hand at the threshold',
      validator: 'RequiredBeatRealizationValidator' as const,
      tier: 'authored',
      missingTokens: ['kiss-hand'],
    }];
    const skipped: string[] = [];

    insertMissingMomentBeats('s1-4-threshold', beats, missing, {
      onSkip: (m, reason) => skipped.push(`${m.moment}:${reason}`),
    });

    expect(beats.map((beat) => beat.text)).toEqual([
      'Victor stops at the threshold, careful not to cross it.',
      'He lifts your hand and kisses your knuckles with impossible formality.',
    ]);
    expect(skipped[0]).toContain('moment is already depicted in current prose');
  });

  it('skips compact object-swap action summaries instead of pasting planning labels into prose', () => {
    const beats = [
      { id: 'b1', text: 'The host studies your outfit with theatrical horror.', nextBeatId: 'b2' },
      { id: 'b2', text: 'The club door hums behind her.' },
    ];
    const missing = [{
      moment: 'Mika swaps out her American shoes',
      validator: 'RequiredBeatRealizationValidator' as const,
      tier: 'authored',
      missingTokens: ['mika', 'swaps', 'american', 'shoes'],
    }];
    const skipped: string[] = [];

    insertMissingMomentBeats('s1-1', beats, missing, {
      onSkip: (m, reason) => skipped.push(`${m.moment}:${reason}`),
    });

    expect(beats.map((beat) => beat.text)).toEqual([
      'The host studies your outfit with theatrical horror.',
      'The club door hums behind her.',
    ]);
    expect(skipped[0]).toContain('terse action summary needs prose rewrite');
  });

  it('can still place an earlier night-two fallback before night-three when explicitly allowed', () => {
    const beats = [
      { id: 'b1', text: 'The last sunset warms the Lipscani apartment.', nextBeatId: 'b2' },
      { id: 'b2', text: 'Sadie asks whether Romania has vampires.', nextBeatId: 'b3' },
      { id: 'b3', text: 'Three nights later, you are on a rooftop bar at sunset.', nextBeatId: 'b4' },
      { id: 'b4', text: 'It is past 1 a.m. when you walk home through Cișmigiu.' },
    ];
    const missing = [{
      moment: 'Mika adopts Kylie at the door of Vâlcescu Club on night two, swaps out her American shoes, and hands her a key card to the side entrance.',
      validator: 'RequiredBeatRealizationValidator' as const,
      tier: 'authored',
      missingTokens: ['mika'],
    }];

    insertMissingMomentBeats('s1-1', beats, missing, { allowTimelineCuedInsertion: true });

    expect(beats.map((beat) => beat.id)).toEqual([
      'b1',
      'b2',
      expect.stringContaining('s1-1-authored-authored-mika-adopts-kylie'),
      'b3',
      'b4',
    ]);
    expect(beats[1].nextBeatId).toBe(beats[2].id);
    expect(beats[2].nextBeatId).toBe('b3');
    expect(beats[2].text).toContain('night two');
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
