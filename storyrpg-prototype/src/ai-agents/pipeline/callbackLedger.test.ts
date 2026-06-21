import { describe, it, expect } from 'vitest';
import {
  CallbackLedger,
  canonicalizeHookId,
  isTintFlag,
  toneAcknowledgmentProse,
  TONE_HOOK_PREFIX,
} from './callbackLedger';
import { isUnsafeCallbackProse } from '../constants/metaProse';
import { isFallbackReminderStub } from '../constants/choiceTextFallbacks';
import type { Choice } from '../../types/choice';
import type { TextVariant } from '../../types/content';

function makeChoice(overrides: Partial<Choice> = {}): Choice {
  return {
    id: 'choice-1',
    text: 'Spare the herald',
    ...overrides,
  };
}

describe('CallbackLedger', () => {
  it('ignores choices without memorableMoment', () => {
    const ledger = new CallbackLedger();
    const result = ledger.recordChoice({
      choice: makeChoice(),
      episode: 1,
      sceneId: 'scene-1',
    });
    expect(result).toBeUndefined();
    expect(ledger.size()).toBe(0);
  });

  it('excludes structural treatment_branch_ flags from trackable callbacks (W5.2)', () => {
    const ledger = new CallbackLedger();
    const choice = makeChoice({
      consequences: [
        { type: 'setFlag', flag: 'treatment_branch_scene_2a', value: true } as any,
        { type: 'setFlag', flag: 'kylie_noticed', value: true } as any,
      ],
    });
    const flags = ledger.trackableFlagsOf(choice);
    expect(flags).toContain('kylie_noticed');
    expect(flags).not.toContain('treatment_branch_scene_2a');
    expect(ledger.recordFlagSet({ choice, flag: 'treatment_branch_scene_2a', episode: 1, sceneId: 's1' })).toBeUndefined();
  });

  it('excludes encounter-outcome state flags from trackable callbacks (bite-me-g13 2026-06-12)', () => {
    const ledger = new CallbackLedger();
    const choice = makeChoice({
      consequences: [
        { type: 'setFlag', flag: 'encounter_treatment-enc-1-1_partialVictory', value: true } as any,
        { type: 'setFlag', flag: 'kylie_noticed', value: true } as any,
      ],
    });
    const flags = ledger.trackableFlagsOf(choice);
    expect(flags).toContain('kylie_noticed');
    expect(flags).not.toContain('encounter_treatment-enc-1-1_partialVictory');
    expect(
      ledger.recordFlagSet({ choice, flag: 'encounter_treatment-enc-1-1_partialVictory', episode: 1, sceneId: 's1' }),
    ).toBeUndefined();
  });

  it('recordForwardPromise carries the choice gating flag so a conditional payoff is realizable', () => {
    const ledger = new CallbackLedger();
    const choice = makeChoice({
      id: 'choice-accept-key-card',
      consequences: [
        { type: 'setFlag', flag: 'accepted_mika_key_card', value: true } as any,
        { type: 'setFlag', flag: 'treatment_branch_s1_2', value: true } as any, // structural → excluded
      ],
    });
    const hook = ledger.recordForwardPromise({
      choice, episode: 1, sceneId: 's1-1', payoffEpisode: 3,
      summary: 'In Episode 3, the key card becomes the first data point.',
    });
    expect(hook).toBeDefined();
    expect(hook!.id).toBe('later:choice-accept-key-card');
    expect(hook!.payoffEpisode).toBe(3);
    // the gating flag is captured (so ep3 can author a flag-conditional payoff); the
    // structural branch flag is not.
    expect(hook!.flags).toContain('accepted_mika_key_card');
    expect(hook!.flags).not.toContain('treatment_branch_s1_2');
    // add() folds flags into conditionKeys so the inject->payoff loop surfaces them.
    expect(hook!.conditionKeys).toContain('accepted_mika_key_card');
  });

  it('tracks a tint: flag as a lower-priority, referenceable tone callback (tints no longer write-only)', () => {
    const ledger = new CallbackLedger();
    const choice = makeChoice({
      id: 'spare-the-herald',
      text: 'Let the herald go.',
      consequences: [{ type: 'setFlag', flag: 'tint:mercy', value: true } as any],
    });
    // trackableTintsOf surfaces the tint; trackableFlagsOf still excludes it.
    expect(ledger.trackableTintsOf(choice)).toEqual(['tint:mercy']);
    expect(ledger.trackableFlagsOf(choice)).not.toContain('tint:mercy');

    const hook = ledger.recordTintSet({ choice, flag: 'tint:mercy', episode: 1, sceneId: 's1' });
    expect(hook).toBeDefined();
    // Hook id is the de-prioritized `tone:` namespace, NOT `tint:`-prefixed, so it is
    // a real ledger hook the injector can tag (and the dangling gate won't reject).
    expect(hook!.id).toBe(`${TONE_HOOK_PREFIX}mercy`);
    expect(ledger.has(`${TONE_HOOK_PREFIX}mercy`)).toBe(true);
    // Gated on the real runtime tint flag.
    expect(hook!.flags).toContain('tint:mercy');
    // Its summary is a CLEAN in-fiction acknowledgment (passes the reject filters),
    // so the deterministic injector has a safe prose candidate.
    expect(isUnsafeCallbackProse(hook!.summary)).toBe(false);
    expect(isFallbackReminderStub(hook!.summary)).toBe(false);
    // A non-tint flag is not a tone hook.
    expect(ledger.recordTintSet({ choice, flag: 'door_open', episode: 1, sceneId: 's1' })).toBeUndefined();
  });

  it('tracks choice.tintFlag before assembly folds it into consequences', () => {
    const ledger = new CallbackLedger();
    const choice = makeChoice({
      id: 'favor-mika',
      text: 'Take Mika at her word.',
      tintFlag: 'tint_mika_favored',
      consequences: [],
    });

    expect(ledger.trackableTintsOf(choice)).toEqual(['tint:mika_favored']);
    const hook = ledger.recordTintSet({ choice, flag: ledger.trackableTintsOf(choice)[0], episode: 1, sceneId: 's1' });
    expect(hook?.id).toBe('tone:mika_favored');
    expect(hook?.flags).toEqual(['tint:mika_favored']);
  });

  it('isTintFlag recognizes tint flags (bare or flag:-prefixed) and nothing else', () => {
    expect(isTintFlag('tint:boldness')).toBe(true);
    expect(isTintFlag('flag:tint:boldness')).toBe(true);
    expect(isTintFlag('route_left')).toBe(false);
    expect(isTintFlag('kylie_noticed')).toBe(false);
  });

  it('toneAcknowledgmentProse yields clean, tone-varied prose with no system leakage', () => {
    const mercy = toneAcknowledgmentProse('mercy');
    const boldness = toneAcknowledgmentProse('boldness');
    // Different tones read differently (anti-repetition).
    expect(mercy).not.toBe(boldness);
    for (const line of [mercy, boldness, toneAcknowledgmentProse('some-unmapped-tone'), toneAcknowledgmentProse('')]) {
      expect(line.length).toBeGreaterThan(0);
      expect(isUnsafeCallbackProse(line)).toBe(false);
      expect(isFallbackReminderStub(line)).toBe(false);
      // No raw flag identifiers, scene refs, or episode numbers.
      expect(line).not.toMatch(/tint:|\bscene\b|\bepisode\b/i);
    }
  });

  it('unresolvedFor sorts tone (tint) hooks AFTER narrative hooks so they never crowd a real payoff', () => {
    const ledger = new CallbackLedger();
    // A tone hook sourced in ep1 (older) and a narrative flag hook sourced in ep1.
    ledger.recordTintSet({
      choice: makeChoice({ id: 'tone-choice', consequences: [{ type: 'setFlag', flag: 'tint:mercy', value: true } as any] }),
      flag: 'tint:mercy', episode: 1, sceneId: 's1',
    });
    ledger.recordFlagSet({
      choice: makeChoice({ id: 'flag-choice', consequences: [{ type: 'setFlag', flag: 'door_open', value: true } as any] }),
      flag: 'door_open', episode: 1, sceneId: 's1',
    });
    const ids = ledger.unresolvedFor(2).map((h) => h.id);
    // narrative hook first, tone hook last regardless of source-episode tie.
    expect(ids.indexOf('flag:door_open')).toBeLessThan(ids.indexOf('tone:mercy'));
  });

  it('records a memorableMoment as a hook and infers flags when absent', () => {
    const ledger = new CallbackLedger();
    const choice = makeChoice({
      memorableMoment: { id: 'spared-herald', summary: 'You spared the herald.' },
      consequences: [{ type: 'setFlag', flag: 'herald-lives', value: true } as any],
    });
    const hook = ledger.recordChoice({ choice, episode: 1, sceneId: 'scene-1' });
    expect(hook).toBeDefined();
    expect(hook!.id).toBe('spared-herald');
    expect(hook!.flags).toContain('herald-lives');
    expect(hook!.conditionKeys).toContain('herald-lives');
    expect(hook!.consequenceTier).toBe('callback');
    expect(hook!.resolved).toBe(false);
    expect(hook!.payoffWindow.minEpisode).toBe(2);
  });

  it('unresolvedFor never lets the maxActiveHooks cap starve an explicitly-due promise', () => {
    // Bite-Me G13 regression: a forward promise due THIS episode was pushed past
    // the cap by lower-priority window-only flag hooks, so it never reached the
    // prompt feed or the deterministic fallback — yet the (uncapped) promise-due
    // gate still hard-failed the episode.
    const ledger = new CallbackLedger({ config: { payoffThreshold: 2, defaultWindowSpan: 3, maxActiveHooks: 10 } });
    // 12 window-only flag hooks eligible in episode 3 (more than the cap).
    for (let i = 0; i < 12; i++) {
      ledger.recordFlagSet({
        choice: makeChoice({ id: `choice-flag-${i}`, consequences: [{ type: 'setFlag', flag: `flag_${i}`, value: true } as any] }),
        flag: `flag_${i}`,
        episode: 1,
        sceneId: 's1-1',
      });
    }
    // The hard obligation: a promise explicitly due in episode 3.
    ledger.recordForwardPromise({
      choice: makeChoice({ id: 'choice-write-magnolia-column', consequences: [{ type: 'setFlag', flag: 'magnolia_column_filed', value: true } as any] }),
      episode: 1,
      sceneId: 's1-5',
      payoffEpisode: 3,
      summary: 'In Episode 3, Mika will mention a food writer whose column got a thousand reads.',
    });

    const surfaced = ledger.unresolvedFor(3);
    const dueIds = ledger.dueAt(3).map((h) => h.id);
    expect(dueIds).toContain('later:choice-write-magnolia-column');
    // Every gate-enforced due hook must appear in the realization set...
    for (const id of dueIds) expect(surfaced.map((h) => h.id)).toContain(id);
    // ...and due hooks are surfaced FIRST.
    expect(surfaced[0].id).toBe('later:choice-write-magnolia-column');
  });

  it('carries the source choice prose onto the hook so a cross-episode fallback can source it', () => {
    const ledger = new CallbackLedger();
    const hook = ledger.recordForwardPromise({
      choice: makeChoice({
        id: 'choice-write-magnolia-column',
        feedbackCue: { echoSummary: 'You wrote the safe piece. The other story stayed inside.' } as any,
        reminderPlan: { immediate: 'The column fills the screen cleanly.', shortTerm: 'No blog post exists to quote back.' },
        consequences: [{ type: 'setFlag', flag: 'magnolia_column_filed', value: true } as any],
      }),
      episode: 1,
      sceneId: 's1-5',
      payoffEpisode: 3,
      summary: 'In Episode 3, Mika will mention a food writer.',
    });
    expect(hook!.proseSources?.echoSummary).toBe('You wrote the safe piece. The other story stayed inside.');
    expect(hook!.proseSources?.immediate).toBe('The column fills the screen cleanly.');
    // Round-trips through serialize/deserialize.
    const revived = CallbackLedger.deserialize(ledger.serialize());
    expect(revived.all().find((h) => h.id === hook!.id)?.proseSources?.echoSummary)
      .toBe('You wrote the safe piece. The other story stayed inside.');
  });

  it('plants a score:<name> promise so a score-keyed payoff is not dangling', () => {
    const ledger = new CallbackLedger();
    const choice = makeChoice({
      id: 'earn-thorne-trust',
      text: 'Take the eastern-wall assessment to Thorne yourself.',
      consequences: [{ type: 'changeScore', score: 'thorne_loyalty', change: 1 } as any],
    });
    expect(ledger.trackableScoresOf(choice)).toEqual(['thorne_loyalty']);
    const hook = ledger.recordScoreSet({ choice, score: 'thorne_loyalty', episode: 2, sceneId: 's2-1' });
    expect(hook).toBeDefined();
    expect(hook!.id).toBe('score:thorne_loyalty');
    // A later TextVariant keyed on this score now resolves against a real hook.
    expect(ledger.has('score:thorne_loyalty')).toBe(true);
  });

  it('records impact factors and explicit consequence tier from the choice', () => {
    const ledger = new CallbackLedger();
    const choice = makeChoice({
      memorableMoment: { id: 'truth-told', summary: 'You told Mira the truth.', flags: ['truth-told'] },
      impactFactors: ['relationship', 'identity'],
      consequenceTier: 'sceneTint',
    });
    const hook = ledger.recordChoice({ choice, episode: 1, sceneId: 'scene-1' });
    expect(hook!.impactFactors).toEqual(['relationship', 'identity']);
    expect(hook!.consequenceTier).toBe('sceneTint');
  });

  it('uses explicit memorableMoment flags over inferred ones', () => {
    const ledger = new CallbackLedger();
    const choice = makeChoice({
      memorableMoment: {
        id: 'spared-herald',
        summary: 'You spared the herald.',
        flags: ['herald-alive'],
      },
      consequences: [{ type: 'setFlag', flag: 'other-flag', value: true } as any],
    });
    const hook = ledger.recordChoice({ choice, episode: 1, sceneId: 'scene-1' });
    expect(hook!.flags).toContain('herald-alive');
  });

  it('records payoff and auto-resolves once threshold is met', () => {
    const ledger = new CallbackLedger({ config: { payoffThreshold: 2, defaultWindowSpan: 3, maxActiveHooks: 10 } });
    ledger.add({
      id: 'hook-1',
      sourceEpisode: 1,
      sourceSceneId: 's1',
      sourceChoiceId: 'c1',
      flags: ['f'],
      summary: 'Summary.',
      payoffWindow: { minEpisode: 2, maxEpisode: 4 },
    });
    ledger.recordPayoff('hook-1');
    expect(ledger.all()[0].resolved).toBe(false);
    ledger.recordPayoff('hook-1');
    expect(ledger.all()[0].resolved).toBe(true);
    expect(ledger.all()[0].payoffCount).toBe(2);
  });

  it('recordPayoff canonicalizes a prefix-drifted id so the payoff is not dropped', () => {
    const ledger = new CallbackLedger();
    // Planted with a `flag:` prefix; paid off with the bare name (and vice versa).
    ledger.add({ id: 'flag:treatment_seed_ep1', sourceEpisode: 1, sourceSceneId: 's1', sourceChoiceId: 'c1', flags: ['treatment_seed_ep1'], summary: 's', payoffWindow: { minEpisode: 1, maxEpisode: 4 } });
    // Bare planted hook, paid off WITH a spurious prefix.
    ledger.add({ id: 'accepted-stelas-protection', sourceEpisode: 1, sourceSceneId: 's2', sourceChoiceId: 'c2', flags: [], summary: 's', payoffWindow: { minEpisode: 1, maxEpisode: 4 } });

    expect(ledger.recordPayoff('treatment_seed_ep1')?.id).toBe('flag:treatment_seed_ep1');
    expect(ledger.recordPayoff('flag:accepted-stelas-protection')?.id).toBe('accepted-stelas-protection');
    expect(ledger.recordPayoff('never-planted')).toBeUndefined();
  });

  it('records payoffs from text variants that reference existing hook ids', () => {
    const ledger = new CallbackLedger();
    ledger.add({
      id: 'hook-1',
      sourceEpisode: 1,
      sourceSceneId: 's1',
      sourceChoiceId: 'c1',
      flags: ['f'],
      summary: 'Summary.',
      payoffWindow: { minEpisode: 2, maxEpisode: 4 },
    });
    const variants: TextVariant[] = [
      { condition: { type: 'flag', flag: 'f', value: true }, text: 'Payoff.', callbackHookId: 'hook-1' },
      { condition: { type: 'flag', flag: 'missing', value: true }, text: 'Ignored.', callbackHookId: 'does-not-exist' },
    ];
    const matched = ledger.recordPayoffsFromVariants(variants);
    expect(matched).toEqual(['hook-1']);
    expect(ledger.all()[0].payoffCount).toBe(1);
  });

  it('resolveHookId canonicalizes a bare flag/score name to its planted hook', () => {
    const ledger = new CallbackLedger();
    ledger.add({ id: 'flag:treatment_seed_ep1_3', sourceEpisode: 1, sourceSceneId: 's1', sourceChoiceId: 'c1', flags: ['treatment_seed_ep1_3'], summary: 's', payoffWindow: { minEpisode: 1, maxEpisode: 4 } });
    ledger.add({ id: 'score:thorne_loyalty', sourceEpisode: 1, sourceSceneId: 's1', sourceChoiceId: 'c2', flags: [], conditionKeys: ['score:thorne_loyalty'], summary: 's', payoffWindow: { minEpisode: 1, maxEpisode: 4 } });
    expect(ledger.resolveHookId('treatment_seed_ep1_3')).toBe('flag:treatment_seed_ep1_3');
    expect(ledger.resolveHookId('thorne_loyalty')).toBe('score:thorne_loyalty');
    // An id that IS a hook, or matches nothing, is returned unchanged.
    expect(ledger.resolveHookId('flag:treatment_seed_ep1_3')).toBe('flag:treatment_seed_ep1_3');
    expect(ledger.resolveHookId('unknown_flag')).toBe('unknown_flag');
  });

  it('canonicalizeHookId (pure helper) prefixes a bare name against a known-id predicate', () => {
    const known = new Set(['flag:treatment_seed_ep1_3', 'score:thorne_loyalty', 'within-ep2-planted_z']);
    const has = (id: string): boolean => known.has(id);
    // Bare flag/score name → its planted prefixed id (the SceneWriter parse-time fix).
    expect(canonicalizeHookId('treatment_seed_ep1_3', has)).toBe('flag:treatment_seed_ep1_3');
    expect(canonicalizeHookId('thorne_loyalty', has)).toBe('score:thorne_loyalty');
    // Already-canonical ids and unknown ids pass through unchanged.
    expect(canonicalizeHookId('flag:treatment_seed_ep1_3', has)).toBe('flag:treatment_seed_ep1_3');
    expect(canonicalizeHookId('within-ep2-planted_z', has)).toBe('within-ep2-planted_z');
    expect(canonicalizeHookId('never_planted', has)).toBe('never_planted');
    expect(canonicalizeHookId('', has)).toBe('');
  });

  it('strips a SPURIOUS flag:/score: prefix when the planted hook is registered bare (bite-me-g14 ep3)', () => {
    // The ledger holds the narrative callback-hook `accepted-stelas-protection` BARE,
    // but the agent tagged the payoff `flag:accepted-stelas-protection`. The intended
    // hook is the bare one — resolve to it instead of dangling.
    const known = new Set(['accepted-stelas-protection', 'score:thorne_loyalty']);
    const has = (id: string): boolean => known.has(id);
    expect(canonicalizeHookId('flag:accepted-stelas-protection', has)).toBe('accepted-stelas-protection');
    expect(canonicalizeHookId('score:accepted-stelas-protection', has)).toBe('accepted-stelas-protection');
    // Exact match still wins; a prefix with no bare counterpart is left unchanged.
    expect(canonicalizeHookId('score:thorne_loyalty', has)).toBe('score:thorne_loyalty');
    expect(canonicalizeHookId('flag:never_planted', has)).toBe('flag:never_planted');
  });

  it('resolveHookId resolves a spuriously-prefixed payoff to the planted bare hook', () => {
    const ledger = new CallbackLedger();
    ledger.add({ id: 'accepted-stelas-protection', sourceEpisode: 2, sourceSceneId: 's2-1', sourceChoiceId: 'c1', flags: [], summary: 'Stela offers her warding', payoffWindow: { minEpisode: 2, maxEpisode: 4 } });
    expect(ledger.resolveHookId('flag:accepted-stelas-protection')).toBe('accepted-stelas-protection');
    expect(ledger.has(ledger.resolveHookId('flag:accepted-stelas-protection'))).toBe(true);
  });

  it('credits a payoff tagged with a bare flag name (callbackHookId missing the flag: prefix)', () => {
    const ledger = new CallbackLedger();
    ledger.add({ id: 'flag:treatment_seed_ep1_3', sourceEpisode: 1, sourceSceneId: 's1', sourceChoiceId: 'c1', flags: ['treatment_seed_ep1_3'], summary: 's', payoffWindow: { minEpisode: 1, maxEpisode: 4 }, payoffCount: 0 });
    // The variant gates on a DIFFERENT flag, so only the bare callbackHookId can credit the seed hook.
    const matched = ledger.recordPayoffsFromVariants([
      { condition: { type: 'flag', flag: 'treatment_seed_ep1_2', value: false }, text: 'A key card.', callbackHookId: 'treatment_seed_ep1_3' } as any,
    ]);
    expect(matched).toEqual(['flag:treatment_seed_ep1_3']);
    expect(ledger.all().find((h) => h.id === 'flag:treatment_seed_ep1_3')!.payoffCount).toBe(1);
  });

  it('credits a forward-promise hook when its same-choice flag hook is honored (sibling payoff)', () => {
    const ledger = new CallbackLedger();
    const choice = makeChoice({
      id: 'choice-protect-brightwell',
      consequences: [{ type: 'setFlag', flag: 'protected_brightwell', value: true } as any],
    });
    ledger.recordFlagSet({ choice, flag: 'protected_brightwell', episode: 1, sceneId: 's1-1' });
    ledger.recordForwardPromise({ choice, episode: 1, sceneId: 's1-1', payoffEpisode: 2, summary: 'In Episode 2, Lysandra withholds intelligence.' });
    const promise0 = ledger.all().find((h) => h.id === 'later:choice-protect-brightwell');
    expect(promise0!.payoffCount).toBe(0);

    // ep2 honors the decision via a flag-gated variant tagged with ONLY the flag hook id.
    ledger.recordPayoffsFromVariants([
      { condition: { type: 'flag', flag: 'protected_brightwell', value: true }, text: 'She says nothing.', callbackHookId: 'flag:protected_brightwell' } as any,
    ]);
    // the forward-promise hook (same sourceChoiceId) is credited too → not "never referenced".
    expect(ledger.all().find((h) => h.id === 'later:choice-protect-brightwell')!.payoffCount).toBeGreaterThan(0);
    expect(ledger.all().find((h) => h.id === 'flag:protected_brightwell')!.payoffCount).toBeGreaterThan(0);
  });

  it('credits hooks via an untagged flag-conditional variant (no callbackHookId)', () => {
    const ledger = new CallbackLedger();
    const choice = makeChoice({ id: 'c1', consequences: [{ type: 'setFlag', flag: 'kept_the_secret', value: true } as any] });
    ledger.recordFlagSet({ choice, flag: 'kept_the_secret', episode: 1, sceneId: 's1' });
    ledger.recordPayoffsFromVariants([
      { condition: { type: 'flag', flag: 'kept_the_secret', value: true }, text: 'It surfaces again.' } as any, // no callbackHookId
    ]);
    expect(ledger.all().find((h) => h.id === 'flag:kept_the_secret')!.payoffCount).toBeGreaterThan(0);
  });

  it('returns only unresolved hooks within the payoff window', () => {
    const ledger = new CallbackLedger();
    ledger.add({
      id: 'old',
      sourceEpisode: 1,
      sourceSceneId: 's1',
      sourceChoiceId: 'c1',
      flags: [],
      summary: 'Old hook.',
      payoffWindow: { minEpisode: 2, maxEpisode: 3 },
    });
    ledger.add({
      id: 'current',
      sourceEpisode: 2,
      sourceSceneId: 's2',
      sourceChoiceId: 'c2',
      flags: [],
      summary: 'Current hook.',
      payoffWindow: { minEpisode: 3, maxEpisode: 5 },
    });
    expect(ledger.unresolvedFor(3).map((h) => h.id)).toEqual(['old', 'current']);
    expect(ledger.unresolvedFor(4).map((h) => h.id)).toEqual(['current']);
  });

  it('serializes and deserializes losslessly', () => {
    const ledger = new CallbackLedger({ storyId: 'story-1' });
    ledger.add({
      id: 'h',
      sourceEpisode: 1,
      sourceSceneId: 's',
      sourceChoiceId: 'c',
      flags: ['x'],
      summary: 'sum',
      payoffWindow: { minEpisode: 2, maxEpisode: 4 },
    });
    const json = JSON.stringify(ledger.serialize());
    const round = CallbackLedger.deserialize(JSON.parse(json));
    expect(round.size()).toBe(1);
    expect(round.all()[0].id).toBe('h');
  });

  it('harvests flags set via DELAYED consequences (gen-5)', () => {
    const ledger = new CallbackLedger();
    const choice = makeChoice({
      delayedConsequences: [
        { consequence: { type: 'setFlag', flag: 'mika_invented_cover_story', value: true } as any, description: 'later betrayal', delay: { type: 'episodes', count: 2 } },
        { consequence: { type: 'setFlag', flag: 'tint:wary', value: true } as any, description: 'cosmetic' },
      ],
    });
    const flags = ledger.trackableDelayedFlagsOf(choice);
    expect(flags).toContain('mika_invented_cover_story');
    expect(flags).not.toContain('tint:wary');
    expect(ledger.recordFlagSet({ choice, flag: 'mika_invented_cover_story', episode: 1, sceneId: 's1' })).toBeDefined();
    expect(ledger.all().some((h) => h.flags.includes('mika_invented_cover_story'))).toBe(true);
  });

  it('records a forward-promise targeting the named payoff episode (gen-5)', () => {
    const ledger = new CallbackLedger();
    const choice = makeChoice({ id: 'choice-shoes-3' });
    const hook = ledger.recordForwardPromise({
      choice,
      episode: 1,
      sceneId: 's1',
      summary: 'In Episode 2 the photo from this night appears in the blog sidebar.',
      payoffEpisode: 2,
    });
    expect(hook).toBeDefined();
    expect(hook!.id).toBe('later:choice-shoes-3');
    expect(hook!.payoffEpisode).toBe(2);
    // Eligible to pay off in episode 2, its named episode.
    expect(ledger.unresolvedFor(2).some((h) => h.id === 'later:choice-shoes-3')).toBe(true);
  });
});
