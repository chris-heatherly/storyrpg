import { describe, expect, it } from 'vitest';
import {
  assembleChoiceForStory,
  buildReaderFacingFallbackChoiceOptions,
  foldTintFlagIntoConsequences,
  isSafeChoiceAttachmentBeat,
  normalizeConsequence,
  normalizeConsequences,
  routeFallbackChoicesAcrossTargets,
  repairBranchFanOut,
  reconcileChoiceSetBeatIds,
  bakeWitnessReactionsIntoOutcomeTexts,
} from './choiceAssembly';

describe('buildReaderFacingFallbackChoiceOptions', () => {
  it('filters planning-register option hints instead of inventing choices from narration', () => {
    const options = buildReaderFacingFallbackChoiceOptions({
      optionHints: ['Decide how to handle release scene 6.', 'Advance the goal of Rooftop Exit'],
      choiceBeatText: 'Stela lowers her voice and points to the black roses waiting on the table.',
      sceneName: 'release scene 6',
    });

    expect(options).toEqual([
      'Act before the moment closes.',
      'Wait long enough to read the danger.',
      'Ask what is really at stake.',
    ]);
    expect(options.join(' ')).not.toMatch(/Decide how to handle|Advance the goal|release scene 6/i);
  });

  it('keeps authored reader-facing option hints and pads to the reader minimum', () => {
    const options = buildReaderFacingFallbackChoiceOptions({
      optionHints: ['Ask Stela why the roses came first', 'Pocket the card before anyone sees it'],
      choiceBeatText: 'Decide how to handle release scene 6.',
    });

    expect(options).toEqual([
      'Ask Stela why the roses came first.',
      'Pocket the card before anyone sees it.',
      'Act before the moment closes.',
      'Wait long enough to read the danger.',
    ]);
  });

  it('splits authored list hints and expands short labels into playable options', () => {
    const options = buildReaderFacingFallbackChoiceOptions({
      optionHints: [
        'In the park when the shadow appears: scream, run, freeze.',
        'What name do you give him: Mr. Midnight (canonical), The Stranger, The Suit.',
      ],
      choiceBeatText: 'The email lands with no subject line.',
    });

    expect(options).toEqual([
      'Scream for help.',
      'Run for the open path.',
      'Freeze and read the danger.',
      'Choose Mr. Midnight.',
    ]);
    expect(options.join(' ')).not.toContain('scream, run, freeze');
  });

  it('filters stale mixed option hints against the current beat context', () => {
    const options = buildReaderFacingFallbackChoiceOptions({
      optionHints: [
        'In the park when the shadow appears: scream, run, freeze',
        'fight back — and the next morning, what name do you give him: Mr. Midnight (canonical), The Stranger, The Velvet',
        'The Suit.',
      ],
      localContext: [
        'At 4am, unable to sleep, Kylie launches Dating After Dusk with a post about a club, a friend who calls everyone iubita, and the man she names only Mr. Midnight; by 6pm it has 80,000 reads.',
      ],
      choiceBeatText: 'You open the site. The readership counter is spinning like a slot machine. 80,000 reads.',
    });

    expect(options).toEqual([
      'Choose Mr. Midnight.',
      'Choose The Stranger as the name.',
      'Choose The Velvet as the name.',
    ]);
    expect(options.join(' ')).not.toMatch(/Scream|Run for the open path|Freeze/i);
  });

  it('does not turn quoted planning metadata into "what was just said" choices', () => {
    const options = buildReaderFacingFallbackChoiceOptions({
      choiceBeatText:
        'Aftermath that resettles stakes; serves the hook beat ("Kylie unpacks in Bucharest, fleeing public heartbreak.").',
      dramaticPurpose:
        'Aftermath that resettles stakes; serves the hook beat ("Kylie unpacks in Bucharest, fleeing public heartbreak.").',
      sceneName: 'release scene 6',
    });

    expect(options).toEqual([
      'Act before the moment closes.',
      'Wait long enough to read the danger.',
      'Ask what is really at stake.',
    ]);
    expect(options.join(' ')).not.toMatch(/what was just said|Aftermath|serves the hook beat|release scene/i);
  });

  it('does not split mixed treatment decision prose into stale choices for a completed beat', () => {
    const options = buildReaderFacingFallbackChoiceOptions({
      optionHints: [
        "On the broken-down country road: accept Radu's lift, or wait for the tow; and at 2am with both numbers in her phone, choose the chef's codename — *The Mountain* (canonical), *The Wolf* (foreshadowing the audience catches later), or *The Cab Whisperer*.",
      ],
      choiceBeatText:
        "You write the chef into the dictionary. You name him *The Mountain*. And you know exactly what you need to write about next.",
    });

    expect(options.join(' ')).not.toMatch(/Radu's lift|tow|2am|Mountain|Wolf|foreshadowing|Cab Whisperer/i);
  });

  it('does not invent named signal choices from warning-message prose', () => {
    const options = buildReaderFacingFallbackChoiceOptions({
      choiceBeatText:
        "The no-profile account writes: Ileana is missing. She was at his last party. Don't go.",
      choiceBeatVisualMoment: 'Extreme close-up on the anonymous warning message.',
      dramaticPurpose:
        'Aftermath that resettles stakes; serves the plotTurn1 beat ("The post goes viral.").',
      sceneName: 'release scene 6',
    });

    expect(options).toEqual([
      'Act before the moment closes.',
      'Wait long enough to read the danger.',
      'Ask what is really at stake.',
    ]);
    expect(options.join(' ')).not.toMatch(/Ileana's signal|Respond to|Hold back and study/i);
  });
});

describe('isSafeChoiceAttachmentBeat', () => {
  it('allows explicitly marked choice-point beats', () => {
    expect(isSafeChoiceAttachmentBeat({
      id: 'b-choice',
      text: 'You write the chef into the dictionary. You name him *The Mountain*.',
      isChoicePoint: true,
    })).toBe(true);
  });

  it('rejects completed aftermath beats as fallback attachment targets', () => {
    expect(isSafeChoiceAttachmentBeat({
      id: 's2-4-b8',
      text: "You write the chef into the dictionary. You name him *The Mountain*. And you know exactly what you need to write about next.",
    })).toBe(false);
  });

  it('allows unmarked beats only when the prose is still a live prompt', () => {
    expect(isSafeChoiceAttachmentBeat({
      id: 'b-live',
      text: 'The cab idles at the curb. Do you accept the ride or wait for the tow?',
    })).toBe(true);
  });
});

describe('repairBranchFanOut (under-fanned branch point recovery)', () => {
  it('re-points a redundant choice to the orphaned target (bite-me-gen-8 s1-1)', () => {
    const choices = [{ id: 'accept', nextSceneId: 's1-2' }, { id: 'decline', nextSceneId: 's1-2' }];
    expect(repairBranchFanOut(choices, ['s1-2', 's1-3'])).toBe(true);
    expect(new Set(choices.map((c) => c.nextSceneId))).toEqual(new Set(['s1-2', 's1-3']));
  });

  it('fills an unreached target using an unrouted choice first', () => {
    const choices = [{ id: 'a', nextSceneId: 's1-2' }, { id: 'b', nextSceneId: undefined }];
    expect(repairBranchFanOut(choices, ['s1-2', 's1-3'])).toBe(true);
    expect(choices.find((c) => c.id === 'b')!.nextSceneId).toBe('s1-3');
    expect(choices.find((c) => c.id === 'a')!.nextSceneId).toBe('s1-2'); // existing distinct route preserved
  });

  it('routes each choice to its AUTHORED target by matching choice text to the path label', () => {
    // Both choices wrongly point at s1-2; pathHints carry the authored intent
    // (s1-3 = "The Side Entrance / accept the key card", s1-2 = "The Front Door / decline").
    // The "decline" choice must land on s1-2, the "accept" choice on s1-3 — by MEANING,
    // not order. Ordered decline-first so a naive first-spare repair would mis-route.
    const choices = [
      { id: 'decline', nextSceneId: 's1-2', text: 'Decline the key card and walk in the front door.' },
      { id: 'accept', nextSceneId: 's1-2', text: 'Accept the key card and slip in the side entrance.' },
    ];
    const changed = repairBranchFanOut(choices, ['s1-2', 's1-3'], {
      pathHints: [
        { target: 's1-3', label: 'The Side Entrance — accept the key card and use the side entrance' },
        { target: 's1-2', label: 'The Front Door — decline the key card' },
      ],
    });
    expect(changed).toBe(true);
    expect(choices.find((c) => c.id === 'accept')!.nextSceneId).toBe('s1-3'); // side entrance
    expect(choices.find((c) => c.id === 'decline')!.nextSceneId).toBe('s1-2'); // front door
  });

  it('is a no-op when the branch already fans out to >=2 targets', () => {
    const choices = [{ id: 'a', nextSceneId: 's1-2' }, { id: 'b', nextSceneId: 's1-3' }];
    expect(repairBranchFanOut(choices, ['s1-2', 's1-3'])).toBe(false);
    expect(choices.map((c) => c.nextSceneId)).toEqual(['s1-2', 's1-3']);
  });

  it('is a no-op for a single-target (non-branch) scene or too few choices', () => {
    expect(repairBranchFanOut([{ id: 'a', nextSceneId: 's2' }], ['s2'])).toBe(false);
    expect(repairBranchFanOut([{ id: 'a', nextSceneId: 's2' }], ['s2', 's3'])).toBe(false); // 1 choice, can't cover 2
  });
});

describe('reconcileChoiceSetBeatIds (post-rewrite beatId drift)', () => {
  it('re-points a branch point choice set whose beatId drifted out of the scene (bite-me-g13 ep3 s3-1)', () => {
    // ChoiceAuthor keyed s3-1's branch choices to "beat-3"; a later rewrite pass
    // renamed the scene's beats to "s3-1-b*", orphaning the link. Without this the
    // branch point assembles choiceless and aborts at GATE_BRANCH_FANOUT.
    const sceneContents = [
      { sceneId: 's3-1', beats: [{ id: 's3-1-b1' }, { id: 's3-1-b2' }, { id: 's3-1-b3', isChoicePoint: true }] },
    ];
    const choiceSets = [{ sceneId: 's3-1', beatId: 'beat-3' }];
    expect(reconcileChoiceSetBeatIds(sceneContents, choiceSets)).toBe(1);
    expect(choiceSets[0].beatId).toBe('s3-1-b3');
  });

  it('is a no-op when every choice set already matches a beat (golden parity)', () => {
    const sceneContents = [
      { sceneId: 's2-1', beats: [{ id: 'beat-1' }, { id: 'beat-3', isChoicePoint: true }] },
    ];
    const choiceSets = [{ sceneId: 's2-1', beatId: 'beat-3' }];
    expect(reconcileChoiceSetBeatIds(sceneContents, choiceSets)).toBe(0);
    expect(choiceSets[0].beatId).toBe('beat-3');
  });

  it('re-points a set keyed to a beat that EXISTS but is no longer the choice point (bite-me-g14 ep2 s2-1)', () => {
    // ChoiceAuthor keyed s2-1's branch choices to "beat-3" (the choice point at
    // authoring time); a later rewrite kept the beat ids but MOVED isChoicePoint to
    // "beat-4". "beat-3" still exists, so the rename-drift check (no matching beat)
    // never fired — but assembly only attaches choices to the marked choice-point
    // beat, so "beat-4" got no entry and s2-1 shipped choiceless, "reaching none of
    // [s2-2, s2-3]". The set must re-point onto the real choice-point beat.
    const sceneContents = [
      {
        sceneId: 's2-1',
        beats: [
          { id: 'beat-1' },
          { id: 'beat-2' },
          { id: 'beat-3' }, // was the choice point; the rewrite demoted it
          { id: 'beat-4', isChoicePoint: true },
        ],
      },
    ];
    const choiceSets = [{ sceneId: 's2-1', beatId: 'beat-3' }];
    expect(reconcileChoiceSetBeatIds(sceneContents, choiceSets)).toBe(1);
    expect(choiceSets[0].beatId).toBe('beat-4');
  });

  it('leaves a non-choice-point-keyed set alone when the scene marks no choice point', () => {
    // No beat is isChoicePoint — assembly attaches choices to no beat regardless, so
    // re-pointing can't help. Must not thrash a set that names a real (if non-CP) beat.
    const sceneContents = [{ sceneId: 's', beats: [{ id: 'b1' }, { id: 'b2' }] }];
    const choiceSets = [{ sceneId: 's', beatId: 'b1' }];
    expect(reconcileChoiceSetBeatIds(sceneContents, choiceSets)).toBe(0);
    expect(choiceSets[0].beatId).toBe('b1');
  });

  it('falls back to a promptable last beat when no beat is marked isChoicePoint', () => {
    const sceneContents = [{ sceneId: 's1', beats: [{ id: 's1-a' }, { id: 's1-b', text: 'Do you follow Mika or stay with Stela?' }] }];
    const choiceSets = [{ sceneId: 's1', beatId: 'stale' }];
    expect(reconcileChoiceSetBeatIds(sceneContents, choiceSets)).toBe(1);
    expect(choiceSets[0].beatId).toBe('s1-b');
  });

  it('does not fall back to a completed final beat when no beat is marked isChoicePoint', () => {
    const sceneContents = [{
      sceneId: 's2-4',
      beats: [
        { id: 's2-4-b7', text: 'The cursor blinks on a blank page.' },
        {
          id: 's2-4-b8',
          text: "You write the chef into the dictionary. You name him *The Mountain*. And you know exactly what you need to write about next.",
        },
      ],
    }];
    const choiceSets = [{ sceneId: 's2-4', beatId: 'stale' }];
    expect(reconcileChoiceSetBeatIds(sceneContents, choiceSets)).toBe(0);
    expect(choiceSets[0].beatId).toBe('stale');
  });

  it('never steals a choice-point beat already claimed by an aligned choice set', () => {
    // Two choice points; one set is aligned (s-cp1), the other drifted. The drifted
    // set must land on the UNCLAIMED choice point (s-cp2), not the claimed one.
    const sceneContents = [
      {
        sceneId: 's',
        beats: [{ id: 's-cp1', isChoicePoint: true }, { id: 's-mid' }, { id: 's-cp2', isChoicePoint: true }],
      },
    ];
    const choiceSets = [
      { sceneId: 's', beatId: 's-cp1' }, // aligned — claims s-cp1
      { sceneId: 's', beatId: 'drifted' }, // must go to s-cp2
    ];
    expect(reconcileChoiceSetBeatIds(sceneContents, choiceSets)).toBe(1);
    expect(choiceSets[0].beatId).toBe('s-cp1');
    expect(choiceSets[1].beatId).toBe('s-cp2');
  });

  it('leaves a drifted set untouched when no unclaimed choice-point/last beat remains', () => {
    // Single choice point already claimed; the only other beats are non-choice and
    // the last beat is the claimed one — nothing safe to re-point to.
    const sceneContents = [
      { sceneId: 's', beats: [{ id: 's-mid' }, { id: 's-cp', isChoicePoint: true }] },
    ];
    const choiceSets = [
      { sceneId: 's', beatId: 's-cp' }, // claims s-cp (the last beat)
      { sceneId: 's', beatId: 'drifted' }, // no safe target
    ];
    expect(reconcileChoiceSetBeatIds(sceneContents, choiceSets)).toBe(0);
    expect(choiceSets[1].beatId).toBe('drifted');
  });

  it('ignores choice sets without a sceneId (legacy beatId-only keying)', () => {
    const sceneContents = [{ sceneId: 's', beats: [{ id: 's-b1', isChoicePoint: true }] }];
    const choiceSets = [{ beatId: 'whatever' }];
    expect(reconcileChoiceSetBeatIds(sceneContents, choiceSets)).toBe(0);
    expect(choiceSets[0].beatId).toBe('whatever');
  });
});

describe('routeFallbackChoicesAcrossTargets (branch-point recovery)', () => {
  it('routes each choice to a distinct target so every leadsTo target is reached', () => {
    const out = routeFallbackChoicesAcrossTargets<{ id: string; nextSceneId?: string }>(
      [{ id: 'c1' }, { id: 'c2' }],
      ['s3-2', 's3-3'],
      'beat-x',
    );
    expect(out.map((c) => c.nextSceneId)).toEqual(['s3-2', 's3-3']);
    // every target is reached by ≥1 choice (the gate's requirement)
    expect(new Set(out.map((c) => c.nextSceneId))).toEqual(new Set(['s3-2', 's3-3']));
  });

  it('pads when there are more targets than base choices, with stable ids', () => {
    const out = routeFallbackChoicesAcrossTargets<{ id: string; nextSceneId?: string }>([{ id: 'c1' }], ['a', 'b', 'c'], 'beat-x');
    expect(out).toHaveLength(3);
    expect(out.map((c) => c.nextSceneId)).toEqual(['a', 'b', 'c']);
    expect(out[1].id).toBe('beat-x-fallback-choice-2');
    expect(out[2].id).toBe('beat-x-fallback-choice-3');
  });

  it('round-robins when there are more choices than targets (all targets still covered)', () => {
    const out = routeFallbackChoicesAcrossTargets<{ id: string; nextSceneId?: string }>([{ id: 'c1' }, { id: 'c2' }, { id: 'c3' }], ['a', 'b'], 'beat-x');
    expect(out.map((c) => c.nextSceneId)).toEqual(['a', 'b', 'a']);
  });

  it('is a no-op clone when there are no targets', () => {
    const base = [{ id: 'c1', nextSceneId: 'keep' }];
    const out = routeFallbackChoicesAcrossTargets<{ id: string; nextSceneId?: string }>(base, [], 'beat-x');
    expect(out).toEqual(base);
    expect(out).not.toBe(base); // returns a copy, does not mutate input
  });
});

describe('foldTintFlagIntoConsequences (D1)', () => {
  it('adds the tintFlag as a setFlag consequence (canonicalized to the engine vocabulary)', () => {
    const out = foldTintFlagIntoConsequences([], 'tint:honest')!;
    expect(out).toEqual([{ type: 'setFlag', flag: 'tint:honesty', value: true }]);
  });
  it('does not duplicate an already-present flag', () => {
    const out = foldTintFlagIntoConsequences([{ type: 'setFlag', flag: 'tint:honest', value: true } as any], 'tint:honest')!;
    expect(out).toHaveLength(1);
  });
  it('is a no-op without a tintFlag', () => {
    expect(foldTintFlagIntoConsequences(undefined, undefined)).toBeUndefined();
  });
  it('assembleChoiceForStory folds tintFlag into consequences', () => {
    const assembled = assembleChoiceForStory({ id: 'c', text: 't', choiceType: 'expression', consequences: [], tintFlag: 'tint:control' } as any);
    expect(assembled.consequences).toContainEqual({ type: 'setFlag', flag: 'tint:control', value: true });
  });
  it('assembleChoiceForStory normalizes stat-check difficulty and skill weights', () => {
    const assembled = assembleChoiceForStory({
      id: 'c',
      text: 't',
      choiceType: 'strategic',
      consequences: [],
      statCheck: { skillWeights: { persuasion: 1, perception: 0.5 }, difficulty: 30 },
    } as any);
    expect(assembled.statCheck?.difficulty).toBe(35);
    expect(assembled.statCheck?.skillWeights).toEqual({ persuasion: 0.6667, perception: 0.3333 });
  });
});

describe('choice assembly preservation', () => {
  it('normalizes relationshipType and aspect relationship aliases to dimension', () => {
    expect(normalizeConsequence({
      type: 'relationship',
      npcId: 'mika',
      relationshipType: 'affection',
      change: 8,
    } as any)).toMatchObject({
      type: 'relationship',
      npcId: 'mika',
      dimension: 'affection',
      relationshipType: 'affection',
      change: 8,
    });

    expect(normalizeConsequence({
      type: 'relationship',
      npcId: 'stela',
      aspect: 'trust',
      change: -10,
    } as any)).toMatchObject({
      type: 'relationship',
      npcId: 'stela',
      dimension: 'trust',
      aspect: 'trust',
      change: -10,
    });
  });

  it('keeps canonical relationship dimensions unchanged', () => {
    expect(normalizeConsequences([
      {
        type: 'relationship',
        npcId: 'radu',
        dimension: 'respect',
        change: 2,
      } as any,
    ])).toEqual([
      {
        type: 'relationship',
        npcId: 'radu',
        dimension: 'respect',
        change: 2,
      },
    ]);
  });

  it('preserves full mechanical storytelling choice metadata during assembly', () => {
    const assembled = assembleChoiceForStory({
      id: 'choice-pressure',
      text: 'Pressure the witness.',
      choiceType: 'strategic',
      choiceIntent: 'blind',
      impactFactors: ['information', 'relationship'],
      consequenceTier: 'sceneTint',
      stakes: {
        want: 'learn who paid her',
        cost: 'make fear the price of truth',
        identity: 'someone who treats panic as leverage',
      },
      conditions: { type: 'item', itemId: 'black-card', hasItem: true },
      showWhenLocked: true,
      lockedText: 'You need proof before this will work.',
      statCheck: { skillWeights: { intimidation: 1 }, difficulty: 55 },
      consequenceDomain: 'information',
      storyVerb: 'pressure',
      affordanceSource: 'item',
      reminderPlan: {
        immediate: 'The room hears how you got there.',
        shortTerm: 'Mara keeps more distance.',
      },
      feedbackCue: {
        echoSummary: 'You turned fear into leverage.',
        progressSummary: 'This changes who feels safe around you.',
      },
      moralContract: {
        valueA: 'truth',
        valueB: 'safety',
        unavoidableCost: 'Someone loses trust.',
        benefits: ['kylie'],
        harms: ['witness'],
        uncertainty: 'The cost may arrive later.',
      },
      residueHints: [{
        kind: 'relationship_behavior',
        description: 'Mara becomes colder.',
        targetNpcId: 'mara',
      }],
      witnessReactions: [{
        npcId: 'mara',
        stance: 'questions',
        reactionText: 'Mara lets her hand fall from your sleeve.',
      }],
      failureResidue: {
        kind: 'lost_leverage',
        description: 'The courier gains time.',
      },
      visualResidueHint: 'Mara stands farther away next time.',
      consequences: [{
        type: 'relationship',
        npcId: 'mara',
        aspect: 'trust',
        change: -5,
      } as any],
      delayedConsequences: [{
        consequence: {
          type: 'relationship',
          npcId: 'mara',
          relationshipType: 'respect',
          change: -3,
        } as any,
        description: 'Mara later questions the pressure tactic.',
      }],
      nextSceneId: 'scene-4',
      nextBeatId: 'beat-payoff',
      outcomeTexts: {
        success: 'She names the courier.',
        partial: 'She names him, but loudly.',
        failure: 'She shuts down and suspicion spreads.',
      },
      reactionText: 'The silence afterward feels earned and ugly.',
      tintFlag: 'tint:ruthless',
      memorableMoment: {
        id: 'pressured-witness',
        summary: 'You pressured the witness.',
        flags: ['pressed-witness'],
      },
    } as any, 'scene-corrected');

    expect(assembled).toMatchObject({
      choiceType: 'strategic',
      choiceIntent: 'blind',
      impactFactors: ['information', 'relationship'],
      consequenceTier: 'sceneTint',
      storyVerb: 'pressure',
      affordanceSource: 'item',
      witnessReactions: [expect.objectContaining({ npcId: 'mara' })],
      failureResidue: { kind: 'lost_leverage' },
      visualResidueHint: 'Mara stands farther away next time.',
      nextSceneId: 'scene-corrected',
      // G12/WS7: witness reactions are baked into the rendered outcomeTexts at
      // assembly (the metadata channel has no runtime consumer).
      outcomeTexts: {
        success: 'She names the courier. Mara lets her hand fall from your sleeve.',
        partial: 'She names him, but loudly. Mara lets her hand fall from your sleeve.',
        failure: 'She shuts down and suspicion spreads. Mara lets her hand fall from your sleeve.',
      },
      memorableMoment: { id: 'pressured-witness' },
    });
    expect(assembled.consequences?.[0]).toMatchObject({ dimension: 'trust' });
    expect(assembled.delayedConsequences?.[0].consequence).toMatchObject({ dimension: 'respect' });
  });
});

describe('bakeWitnessReactionsIntoOutcomeTexts (G12/WS7)', () => {
  it('appends the witness reaction to each tier', () => {
    const baked = bakeWitnessReactionsIntoOutcomeTexts(
      { success: 'You take the seat.', partial: 'You hesitate, then sit.', failure: 'You stay standing.' },
      [{ npcId: 'mika', stance: 'approves', reactionText: "Mika's posture loosens by a fraction." }] as any,
    )!;
    expect(baked.success).toBe("You take the seat. Mika's posture loosens by a fraction.");
    expect(baked.failure).toContain('posture loosens');
  });

  it('skips tiers where the reaction is already present, and is idempotent', () => {
    const tiers = { success: "You sit. Mika's posture loosens by a fraction.", partial: 'Half.', failure: 'No.' };
    const baked = bakeWitnessReactionsIntoOutcomeTexts(
      tiers,
      [{ npcId: 'mika', stance: 'approves', reactionText: "Mika's posture loosens by a fraction." }] as any,
    )!;
    expect(baked.success).toBe(tiers.success);
    const again = bakeWitnessReactionsIntoOutcomeTexts(baked, [{ npcId: 'mika', stance: 'approves', reactionText: "Mika's posture loosens by a fraction." }] as any)!;
    expect(again.partial).toBe(baked.partial);
  });

  it('no-ops without reactions or outcomeTexts', () => {
    expect(bakeWitnessReactionsIntoOutcomeTexts(undefined, [] as any)).toBeUndefined();
    const tiers = { success: 'x', partial: 'y', failure: 'z' };
    expect(bakeWitnessReactionsIntoOutcomeTexts(tiers, undefined)).toBe(tiers);
  });
});
