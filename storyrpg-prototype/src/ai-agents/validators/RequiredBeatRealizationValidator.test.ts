/**
 * G10 audit — Required-Beat Realization (authored-tier beats on STANDARD scenes).
 *
 * Closes the gap between SignatureDevicePresenceValidator (signature-tier only) and
 * EncounterAnchorContentValidator (encounter scenes only): an `authored`-tier required
 * beat on a `standard` scene was verified by nothing. The audited Endsong ep1 `s1-6`
 * ("Vraxxan Names the Key") shipped its authored key-reveal beat unwritten.
 *
 * Covered:
 *  - an authored beat depicted in the matching standard scene's prose → pass;
 *  - an authored beat absent from the prose (the s1-6 truncation) → blocking error;
 *  - encounter-scene authored beats are SKIPPED here (EncounterAnchorContent owns them);
 *  - signature / connective tiers are SKIPPED here;
 *  - a beat whose episode was not generated (partial season) → skipped, no false fail;
 *  - a plan with no authored standard beats → trivially valid.
 */

import { describe, expect, it } from 'vitest';
import {
  RequiredBeatRealizationValidator,
  type RequiredBeatRealizationInput,
} from './RequiredBeatRealizationValidator';
import type { PlannedScene, RequiredBeat, SceneKind, SeasonScenePlan } from '../../types/scenePlan';
import type { Beat } from '../../types/content';
import type { Episode, Scene, Story } from '../../types/story';

// --- builders -------------------------------------------------------------

function requiredBeat(id: string, mustDepict: string, tier: RequiredBeat['tier']): RequiredBeat {
  return { id, sourceTurn: mustDepict, mustDepict, tier };
}

function plannedScene(
  id: string,
  episodeNumber: number,
  opts: { kind?: SceneKind; requiredBeats?: RequiredBeat[]; encounterRequiredBeats?: RequiredBeat[] } = {},
): PlannedScene {
  const scene: PlannedScene = {
    id,
    episodeNumber,
    order: 0,
    kind: opts.kind ?? (opts.encounterRequiredBeats ? 'encounter' : 'standard'),
    title: id,
    dramaticPurpose: 'x',
    narrativeRole: 'turn',
    locations: [],
    npcsInvolved: [],
    setsUp: [],
    paysOff: [],
    requiredBeats: opts.requiredBeats,
  };
  if (opts.encounterRequiredBeats) {
    scene.encounter = {
      type: 'social',
      difficulty: 'moderate',
      relevantSkills: [],
      isBranchPoint: false,
      requiredBeats: opts.encounterRequiredBeats,
    };
  }
  return scene;
}

function plan(scenes: PlannedScene[]): SeasonScenePlan {
  const byEpisode: Record<number, string[]> = {};
  for (const s of scenes) (byEpisode[s.episodeNumber] ??= []).push(s.id);
  return { scenes, byEpisode, setupPayoffEdges: [] };
}

function beat(id: string, text: string): Beat {
  return { id, text };
}

function generatedScene(id: string, beats: Beat[]): Scene {
  return { id, name: id, beats, startingBeatId: beats[0]?.id ?? '' };
}

function episode(number: number, scenes: Scene[]): Episode {
  return {
    id: `ep-${number}`,
    number,
    title: `Episode ${number}`,
    synopsis: '',
    coverImage: '',
    scenes,
    startingSceneId: scenes[0]?.id ?? '',
  };
}

function story(episodes: Episode[]): Story {
  return {
    id: 'story-1',
    title: 'Test Story',
    genre: 'fantasy',
    synopsis: '',
    coverImage: '',
    initialState: { attributes: {} as never, skills: {} as never, tags: [], inventory: [] },
    npcs: [],
    episodes,
  };
}

function run(input: RequiredBeatRealizationInput) {
  return new RequiredBeatRealizationValidator().validate(input);
}

// The real Endsong ep1 s1-6 authored required beat.
const S1_6_REVEAL =
  'Vraxxan materializes, names Aethavyr "old friend", reaches for Lysandra, and declares her blood the key to the Codex before withdrawing wounded.';

// --- tests ----------------------------------------------------------------

describe('RequiredBeatRealizationValidator', () => {
  it('PASS: an authored beat depicted in the standard scene prose is valid', () => {
    const result = run({
      plan: plan([plannedScene('s1-6', 1, { requiredBeats: [requiredBeat('rb1', S1_6_REVEAL, 'authored')] })]),
      story: story([
        episode(1, [
          generatedScene('s1-6', [
            beat('b1', 'The shadow resolves into Vraxxan, who names you old friend and reaches for Lysandra.'),
            beat('b2', 'He declares her blood the key to the Codex, then withdraws wounded into the dark.'),
          ]),
        ]),
      ]),
    });
    expect(result.valid).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  it('FAIL: an authored beat truncated out of the prose is a blocking error (the s1-6 hole)', () => {
    const result = run({
      plan: plan([plannedScene('s1-6', 1, { requiredBeats: [requiredBeat('rb1', S1_6_REVEAL, 'authored')] })]),
      story: story([
        episode(1, [
          // Prose stops at the villain's entrance — the real defect.
          generatedScene('s1-6', [
            beat('b1', 'The last Shadowscale crumples. A tall, gaunt figure steps through the dark.'),
            beat('b2', '"Hello, old friend."'),
          ]),
        ]),
      ]),
    });
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.severity === 'error' && /missing from the final prose/i.test(i.message))).toBe(true);
  });

  it('SKIP: encounter-scene authored beats are not checked here (EncounterAnchorContent owns them)', () => {
    const result = run({
      plan: plan([plannedScene('enc-1-1', 1, { encounterRequiredBeats: [requiredBeat('rb1', S1_6_REVEAL, 'authored')] })]),
      story: story([episode(1, [generatedScene('enc-1-1', [beat('b1', 'Unrelated prose.')])])]),
    });
    expect(result.valid).toBe(true);
  });

  it('SKIP: signature and connective tiers are not checked here', () => {
    const result = run({
      plan: plan([
        plannedScene('s1-1', 1, {
          requiredBeats: [
            requiredBeat('rb1', S1_6_REVEAL, 'signature'),
            requiredBeat('rb2', 'A second unrelated authored-but-connective image', 'connective'),
          ],
        }),
      ]),
      story: story([episode(1, [generatedScene('s1-1', [beat('b1', 'Totally different prose.')])])]),
    });
    expect(result.valid).toBe(true);
  });

  it('SKIP: broad Bite Me arrival/identity summary is not treated as one hard prose beat', () => {
    const broad =
      "She arrives in Bucharest with two suitcases and her grandmother's address, gathers the Dusk Club over too-dark negronis, and protects herself the way she always has — by observing, ordering second, and writing the piece later.";
    const result = run({
      plan: plan([plannedScene('s1-arrival-cold-open', 1, { requiredBeats: [requiredBeat('broad', broad, 'authored')] })]),
      story: story([
        episode(1, [
          generatedScene('s1-arrival-cold-open', [beat('b1', 'You arrive in Bucharest with your bags and your grandmother’s old address.')]),
        ]),
      ]),
    });

    expect(result.valid).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  it('SKIP: abstract opening promise is not treated as one hard prose beat', () => {
    const result = run({
      plan: plan([plannedScene('s1-arrival-cold-open', 1, {
        requiredBeats: [requiredBeat('promise', 'Opening promise: a heartbroken woman gets a glamorous new life and her own byline.', 'authored')],
      })]),
      story: story([
        episode(1, [
          generatedScene('s1-arrival-cold-open', [beat('b1', 'You arrive under wet Bucharest light with your suitcase handle cutting into your palm.')]),
        ]),
      ]),
    });

    expect(result.valid).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  it('SKIP: a beat whose episode was not generated this run does not false-fail (partial season)', () => {
    const result = run({
      plan: plan([
        plannedScene('s1-6', 1, { requiredBeats: [requiredBeat('rb1', S1_6_REVEAL, 'authored')] }),
        plannedScene('s5-3', 5, { requiredBeats: [requiredBeat('rb2', 'A later authored turn never generated', 'authored')] }),
      ]),
      story: story([
        episode(1, [
          generatedScene('s1-6', [beat('b1', 'Vraxxan names you old friend, reaches for Lysandra, declares her blood the Codex key, and withdraws wounded.')]),
        ]),
      ]),
    });
    expect(result.valid).toBe(true);
  });

  it('PASS: an emphasized enumeration beat is depicted when all named entities land (bite-me-g13 s2-1 false positive)', () => {
    // Whole-beat overlap scores this ~0.29 (diluted by "terrible/fail/straight/group/
    // reacts" which never appear in dramatized prose) and used to false-flag a fully
    // dramatized scene. The ≥2 emphasized entities all land → depicted, no judge needed.
    const THREE_DATES =
      'Three terrible dates fail in a row — *The Lawyer*, *The Founder*, *The Filmmaker* — each one fed straight into the blog while the friend group reacts.';
    const result = run({
      plan: plan([plannedScene('s2-1', 2, { requiredBeats: [requiredBeat('rb1', THREE_DATES, 'authored')] })]),
      story: story([
        episode(2, [
          generatedScene('s2-1', [
            beat('b1', 'You meet The Lawyer under chandeliers; he corrects the waiter and orders sparkling water.'),
            beat('b2', 'Dating After Dusk gets its first casualty. The Founder describes intimacy as scalable.'),
            beat('b3', 'The Filmmaker brings a scarf and the phrase "your heartbreak has texture." Mika applauds.'),
          ]),
        ]),
      ]),
    });
    expect(result.valid).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  it('FAIL: an emphasized enumeration beat still fails when a named entity is dropped (no free pass)', () => {
    const THREE_DATES =
      'Three terrible dates fail in a row — *The Lawyer*, *The Founder*, *The Filmmaker* — each one fed straight into the blog while the friend group reacts.';
    const result = run({
      plan: plan([plannedScene('s2-1', 2, { requiredBeats: [requiredBeat('rb1', THREE_DATES, 'authored')] })]),
      story: story([
        episode(2, [
          // The Filmmaker date is missing — enumeration credit must NOT fire.
          generatedScene('s2-1', [
            beat('b1', 'You meet The Lawyer under chandeliers; he corrects the waiter.'),
            beat('b2', 'The Founder describes intimacy as scalable and becomes a blog post.'),
          ]),
        ]),
      ]),
    });
    expect(result.valid).toBe(false);
  });

  it('PASS: paraphrased rose-quartz warding consent counts when the object transfer lands on-page', () => {
    const moment = "Stela presses a piece of rose quartz into Kylie's hand at Lumina Books, quietly establishing her first warding consent.";
    const result = run({
      plan: plan([plannedScene('s1-3', 1, { requiredBeats: [requiredBeat('rb1', moment, 'authored')] })]),
      story: story([
        episode(1, [
          generatedScene('s1-3', [
            beat('b1', "Stela's hand hovers over a chipped ceramic bowl filled with stones."),
            beat('b2', "Her fingers close around a pinkish stone. 'For your new apartment,' she says."),
            beat('b3', 'She closes your fingers around the quartz, and the words hang there as a quiet warning.'),
          ]),
        ]),
      ]),
    });
    expect(result.valid).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  it('PASS: paraphrased protective-herb warding counts when the brunch gift lands on-page', () => {
    const moment = 'Stela gifts Kylie a protective bag of herbs during brunch, continuing her quiet, consent-based warding.';
    const result = run({
      plan: plan([plannedScene('s2-2', 2, { requiredBeats: [requiredBeat('rb1', moment, 'authored')] })]),
      story: story([
        episode(2, [
          generatedScene('s2-2', [
            beat('b1', "Mika slides her phone across the polished table. 'Five hundred thousand impressions, and that's just since breakfast.'"),
            beat('b2', "Stela pushes a small muslin bag across the table, lavender and crushed pine cutting through the cafe's coffee smell."),
            beat('b3', "'For the apartment,' she says. 'Against... drafts.' The word she does not say - protection - settles between you."),
          ]),
        ]),
      ]),
    });
    expect(result.valid).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  it('FAIL: a compound treatment list cannot pass when only some listed splinters land', () => {
    const moment = "Kylie's 'noticer' instinct collects unsettling splinters: Ileana crying in the powder room, a mantle photograph that seems to omit Victor, Mika's unexplained missing hour, and a guest who knows the Marinescu maiden name.";
    const result = run({
      plan: plan([plannedScene('s3-3', 3, { requiredBeats: [requiredBeat('rb1', moment, 'authored')] })]),
      story: story([
        episode(3, [
          generatedScene('s3-3', [
            beat('b1', 'A photograph over the marble mantle omits Victor from the place of honor.'),
            beat('b2', "An older guest says you have your grandmother's eyes and probes the Marinescu legacy you carry."),
          ]),
        ]),
      ]),
    });
    expect(result.valid).toBe(false);
    expect(result.issues[0]?.message).toContain('Ileana crying');
  });

  it('PASS: a compound treatment list passes when every listed splinter is dramatized', () => {
    const moment = "Kylie's 'noticer' instinct collects unsettling splinters: Ileana crying in the powder room, a mantle photograph that seems to omit Victor, Mika's unexplained missing hour, and a guest who knows the Marinescu maiden name.";
    const result = run({
      plan: plan([plannedScene('s3-3', 3, { requiredBeats: [requiredBeat('rb1', moment, 'authored')] })]),
      story: story([
        episode(3, [
          generatedScene('s3-3', [
            beat('b1', 'In the powder room, Ileana cries into a towel before rebuilding her smile.'),
            beat('b2', 'A mantle photograph seems to omit Victor from the place of honor.'),
            beat('b3', 'Mika returns after an unexplained missing hour and refuses to say where he went.'),
            beat('b4', "A guest knows the Marinescu maiden name before you offer it."),
          ]),
        ]),
      ]),
    });
    expect(result.valid).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  it('FAIL: a time-chain treatment beat cannot pass when the Mr. Midnight blog payoff is dropped', () => {
    const moment = "Kylie lands in Bucharest with two suitcases and her grandmother's address; by night three she's at a rooftop bar with two new friends watching two men watch her; by 1am she's walking home through Cișmigiu; by 1:15 she's pinned to a tree; by 1:16 a man in a charcoal suit asks if she can stand. She writes about him as Mr. Midnight, and the post does 80,000 reads in a week.";
    const result = run({
      plan: plan([plannedScene('s1-1', 1, { requiredBeats: [requiredBeat('rb1', moment, 'authored')] })]),
      story: story([
        episode(1, [
          generatedScene('s1-1', [
            beat('b1', "You land in Bucharest with two suitcases and your grandmother's address."),
            beat('b2', 'By night three, you are at a rooftop bar with two new friends and two men watching you.'),
            beat('b3', 'At 1am you walk home through Cișmigiu; by 1:15 you are pinned to a tree.'),
            beat('b4', 'At 1:16, a man in a charcoal suit asks if you can stand.'),
          ]),
        ]),
      ]),
    });
    expect(result.valid).toBe(false);
    expect(result.issues[0]?.message).toContain('Mr. Midnight');
  });

  it('PASS: a time-chain treatment beat passes once every atom is dramatized', () => {
    const moment = "Kylie lands in Bucharest with two suitcases and her grandmother's address; by night three she's at a rooftop bar with two new friends watching two men watch her; by 1am she's walking home through Cișmigiu; by 1:15 she's pinned to a tree; by 1:16 a man in a charcoal suit asks if she can stand. She writes about him as Mr. Midnight, and the post does 80,000 reads in a week.";
    const result = run({
      plan: plan([plannedScene('s1-1', 1, { requiredBeats: [requiredBeat('rb1', moment, 'authored')] })]),
      story: story([
        episode(1, [
          generatedScene('s1-1', [
            beat('b1', "You land in Bucharest with two suitcases and your grandmother's address."),
            beat('b2', 'By night three, you are at a rooftop bar with two new friends and two men watching you.'),
            beat('b3', 'At 1am you walk through Cișmigiu; by 1:15 you are pinned to a tree.'),
            beat('b4', 'At 1:16, a man in a charcoal suit asks if you can stand.'),
            beat('b5', 'You write about him as Mr. Midnight, and within a week the post does 80,000 reads.'),
          ]),
        ]),
      ]),
    });
    expect(result.valid).toBe(true);
  });

  it('FAIL: split park-rescue action atoms cannot pass when the threshold tail is truncated', () => {
    const result = run({
      plan: plan([
        plannedScene('s1-4', 1, {
          requiredBeats: [
            requiredBeat('park-action-1', 'Walking home through Cișmigiu at 1am, Kylie is pinned to a willow by a shadow', 'authored'),
            requiredBeat('park-action-2', 'a second figure in a charcoal suit drops the attacker', 'authored'),
            requiredBeat('park-action-3', 'a second figure in a charcoal suit walks her home', 'authored'),
            requiredBeat('park-action-4', 'a second figure in a charcoal suit kisses her hand at the threshold', 'authored'),
            requiredBeat('park-action-5', 'a second figure in a charcoal suit declines to come in', 'authored'),
            requiredBeat('park-action-6', 'a second figure in a charcoal suit vanishes.', 'authored'),
          ],
        }),
      ]),
      story: story([
        episode(1, [
          generatedScene('s1-4', [
            beat('b1', "By 1 AM, you're walking home through Cișmigiu."),
            beat('b2', 'Before you can draw breath to scream, a hand closes on your throat.'),
            beat('b3', "You're slammed back against the rough bark of a weeping willow, pinned."),
            beat('b4', 'A man in a perfectly tailored charcoal suit emerges from the mist. In one fluid, impossible motion, he drops the attacker.'),
            beat('b5', 'The man does not spare your attacker a glance. His dark eyes find yours. He extends a hand. "Can you stand?"'),
          ]),
        ]),
      ]),
    });

    expect(result.valid).toBe(false);
    expect(result.issues.map((issue) => issue.location)).toEqual([
      'requiredBeat:ep1:s1-4:park-action-3',
      'requiredBeat:ep1:s1-4:park-action-4',
      'requiredBeat:ep1:s1-4:park-action-5',
      'requiredBeat:ep1:s1-4:park-action-6',
    ]);
  });

  it('PASS: split park-rescue action atoms pass when the home, threshold, refusal, and vanish actions land', () => {
    const result = run({
      plan: plan([
        plannedScene('s1-4', 1, {
          requiredBeats: [
            requiredBeat('park-action-3', 'a second figure in a charcoal suit walks her home', 'authored'),
            requiredBeat('park-action-4', 'a second figure in a charcoal suit kisses her hand at the threshold', 'authored'),
            requiredBeat('park-action-5', 'a second figure in a charcoal suit declines to come in', 'authored'),
            requiredBeat('park-action-6', 'a second figure in a charcoal suit vanishes.', 'authored'),
          ],
        }),
      ]),
      story: story([
        episode(1, [
          generatedScene('s1-4', [
            beat('b1', 'Victor walks you home through the thinning fog, one gloved hand hovering near your elbow without quite touching.'),
            beat('b2', 'At your threshold, he kisses your knuckles as if the doorway is a chapel rail.'),
            beat('b3', 'When you ask him inside, he refuses to cross the threshold.'),
            beat('b4', 'You blink once, and he vanishes into the mist before the latch clicks shut.'),
          ]),
        ]),
      ]),
    });

    expect(result.valid).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  it('FAIL: a short quoted treatment line cannot pass on loose token overlap alone', () => {
    const result = run({
      plan: plan([plannedScene('s1-2', 1, { requiredBeats: [requiredBeat('quote-stela', '"this one wants to be with you, love"', 'authored')] })]),
      story: story([
        episode(1, [
          generatedScene('s1-2', [
            beat('b1', "'This one,' Stela says, placing the warm quartz in your hand, 'has been waiting for you.'"),
          ]),
        ]),
      ]),
    });

    expect(result.valid).toBe(false);
    expect(result.issues[0]?.location).toBe('requiredBeat:ep1:s1-2:quote-stela');
  });

  it('PASS: a short quoted treatment line passes when the authored line lands verbatim', () => {
    const result = run({
      plan: plan([plannedScene('s1-2', 1, { requiredBeats: [requiredBeat('quote-stela', '"this one wants to be with you, love"', 'authored')] })]),
      story: story([
        episode(1, [
          generatedScene('s1-2', [
            beat('b1', "'This one wants to be with you, love,' Stela says, closing your fingers around the rose quartz."),
          ]),
        ]),
      ]),
    });

    expect(result.valid).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  it('valid when the plan carries no authored standard beats', () => {
    const result = run({
      plan: plan([plannedScene('s1-1', 1, {})]),
      story: story([episode(1, [generatedScene('s1-1', [beat('b1', 'Anything.')])])]),
    });
    expect(result.valid).toBe(true);
    expect(result.score).toBe(100);
  });

  it('blocks a dropped concrete seed beat by default', () => {
    const result = run({
      plan: plan([plannedScene('s1-1', 1, { requiredBeats: [requiredBeat('rb1', 'A FaceTime to her niece Sadie about vampires in Romania', 'seed')] })]),
      story: story([episode(1, [generatedScene('s1-1', [beat('b1', 'She dresses for the club, fastening her grandmother\'s gold chain.')])])]),
    });
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.severity === 'error')).toBe(true);
  });

  it('does not enforce abstract seed labels as on-page prose moments', () => {
    const result = run({
      plan: plan([plannedScene('s1-1', 1, { requiredBeats: [requiredBeat('rb1', "Victor's Nature", 'seed')] })]),
      story: story([episode(1, [generatedScene('s1-1', [beat('b1', 'Victor watches the room without touching the wine.')])])]),
    });
    expect(result.valid).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  it('does not enforce abstract seed labels without deterministic source evidence', () => {
    const result = run({
      plan: plan([plannedScene('s1-1', 1, { requiredBeats: [requiredBeat('seed-radu', "Radu's Secret", 'seed')] })]),
      story: story([
        episode(1, [
          generatedScene('s1-1', [
            beat('b1', 'A stray dog watches from the courtyard below.'),
            beat('b2', 'Morning light falls across the kitchen counter and a hand-knit blanket.'),
          ]),
        ]),
      ]),
    });
    expect(result.valid).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  it('enforces an abstract seed label when sourceTurn supplies concrete evidence', () => {
    const concreteSource = "Radu's Secret: The rougher man at the kitchen entrance who didn't fit.";
    const result = run({
      plan: plan([
        plannedScene('s1-1', 1, {
          requiredBeats: [{ id: 'seed-radu', sourceTurn: concreteSource, mustDepict: "Radu's Secret", tier: 'seed' }],
        }),
      ]),
      story: story([
        episode(1, [
          generatedScene('s1-1', [
            beat('b1', 'A stray dog watches from the courtyard below.'),
            beat('b2', 'Morning light falls across the kitchen counter and a hand-knit blanket.'),
          ]),
        ]),
      ]),
    });
    expect(result.valid).toBe(false);
    expect(result.issues.some((issue) => issue.severity === 'error')).toBe(true);
    expect(result.issues[0]?.message).toContain(concreteSource);
  });

  it('blocks a full rougher-man seed when only unrelated kitchen and entrance words appear', () => {
    const result = run({
      plan: plan([
        plannedScene('s1-1', 1, {
          requiredBeats: [requiredBeat('seed-rougher', "The rougher man at the kitchen entrance who didn't fit.", 'seed')],
        }),
      ]),
      story: story([
        episode(1, [
          generatedScene('s1-1', [
            beat('b1', 'Mika hands you a key card to the side entrance.'),
            beat('b2', 'Morning light falls across the kitchen counter and a hand-knit blanket.'),
          ]),
        ]),
      ]),
    });
    expect(result.valid).toBe(false);
    expect(result.issues.some((issue) => issue.severity === 'error')).toBe(true);
    expect(result.issues[0]?.location).toContain('seedBeat:ep1:s1-1:seed-rougher');
  });

  it('blocks a full rougher-man seed when the prose has only a generic man by kitchens', () => {
    const result = run({
      plan: plan([
        plannedScene('s1-1', 1, {
          requiredBeats: [
            requiredBeat('seed-rougher', "The rougher man at the kitchen entrance who didn't fit.", 'seed'),
          ],
        }),
      ]),
      story: story([
        episode(1, [
          generatedScene('s1-1', [
            beat(
              'b1',
              "Your gaze drifts to an archway flanking the kitchens and catches on a man who is a block of granite amidst silk. He isn't watching the party. He's watching the exits.",
            ),
          ]),
        ]),
      ]),
    });
    expect(result.valid).toBe(false);
    expect(result.issues.filter((issue) => issue.severity === 'error')).toHaveLength(1);
  });

  it('credits a rougher-man seed depicted across adjacent local sentences', () => {
    const result = run({
      plan: plan([
        plannedScene('s1-1', 1, {
          requiredBeats: [
            requiredBeat('seed-rougher', "The rougher man at the kitchen entrance who didn't fit.", 'seed'),
          ],
        }),
      ]),
      story: story([
        episode(1, [
          generatedScene('s1-1', [
            beat(
              'b1',
              'The scent of woodsmoke leads you toward the building kitchen. Radu is pinned against the doorframe. Opposite him stands a rougher man, his heavy hand-knit sweater straining at the shoulders.',
            ),
          ]),
        ]),
      ]),
    });
    expect(result.valid).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  it('seed beat depicted on-page produces no warning', () => {
    const result = run({
      plan: plan([plannedScene('s1-1', 1, { requiredBeats: [requiredBeat('rb1', 'A FaceTime to her niece Sadie about vampires in Romania', 'seed')] })]),
      story: story([episode(1, [generatedScene('s1-1', [beat('b1', 'On FaceTime, her niece Sadie asks if there are vampires in Romania.')])])]),
    });
    expect(result.valid).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  it('label-style episode seeds can be realized by concrete treatment signs', () => {
    const result = run({
      plan: plan([
        plannedScene('s1-1', 1, {
          requiredBeats: [
            requiredBeat('seed-blog', 'The blog readership number, displayed at episode end and climbing.', 'seed'),
            requiredBeat('seed-rougher', "The rougher man at the kitchen entrance who didn't fit.", 'seed'),
            requiredBeat('seed-pressure', 'Season central pressure', 'seed'),
          ],
        }),
      ]),
      story: story([
        episode(1, [
          generatedScene('s1-1', [
            beat('b1', 'The rougher man by the kitchen smells faintly of woodsmoke before turning away.'),
            beat('b2', 'Victor in charcoal rescues you, and the black roses wait beside the card.'),
            beat('b3', 'Dating After Dusk has 84,127 reads on the dashboard by morning.'),
          ]),
        ]),
      ]),
    });
    expect(result.valid).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  it('does not enforce choice-contingent future-window seeds as on-page prose moments', () => {
    const result = run({
      plan: plan([
        plannedScene('s1-1', 1, {
          requiredBeats: [
            requiredBeat('seed-quartz-route', "The quartz Kylie did or didn't accept warms in her pocket.", 'seed'),
          ],
        }),
      ]),
      story: story([
        episode(1, [
          generatedScene('s1-1', [
            beat('b1', 'Stela keeps her hand closed, and the question follows you into the stairwell.'),
          ]),
        ]),
      ]),
    });
    expect(result.valid).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  it('WS1.3 ADVISORY: a dropped cold open is a non-blocking warning by default', () => {
    const result = run({
      plan: plan([plannedScene('s1-1', 1, { requiredBeats: [requiredBeat('rb1', 'A FaceTime to her niece Sadie about vampires in Romania', 'coldopen')] })]),
      story: story([episode(1, [generatedScene('s1-1', [beat('b1', 'She dresses for the club, fastening her grandmother\'s gold chain.')])])]),
    });
    expect(result.valid).toBe(true);
    expect(result.issues.some((i) => i.severity === 'warning' && /Cold open not found/.test(i.message))).toBe(true);
  });

  it('WS1.3 GATE on: a dropped cold open escalates to a blocking error (g17 dropped Sadie hook)', () => {
    const prev = process.env.GATE_COLD_OPEN_REALIZATION;
    process.env.GATE_COLD_OPEN_REALIZATION = '1';
    try {
      const result = run({
        plan: plan([plannedScene('s1-1', 1, { requiredBeats: [requiredBeat('rb1', 'A FaceTime to her niece Sadie about vampires in Romania', 'coldopen')] })]),
        story: story([episode(1, [generatedScene('s1-1', [beat('b1', 'She arrives at the club, already mid-glamour.')])])]),
      });
      expect(result.valid).toBe(false);
      expect(result.issues.some((i) => i.severity === 'error' && /Cold open not found/.test(i.message))).toBe(true);
    } finally {
      if (prev === undefined) delete process.env.GATE_COLD_OPEN_REALIZATION;
      else process.env.GATE_COLD_OPEN_REALIZATION = prev;
    }
  });

  it('WS1.3: a cold open dramatized on-page produces no finding', () => {
    const result = run({
      plan: plan([plannedScene('s1-1', 1, { requiredBeats: [requiredBeat('rb1', 'A FaceTime to her niece Sadie about vampires in Romania', 'coldopen')] })]),
      story: story([episode(1, [generatedScene('s1-1', [beat('b1', 'On FaceTime, her niece Sadie asks if there are vampires in Romania.')])])]),
    });
    expect(result.valid).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  it('a dropped seed escalates to a blocking error by default (bite-me-g16 dropped plant)', () => {
    const result = run({
      plan: plan([plannedScene('s1-1', 1, { requiredBeats: [requiredBeat('rb1', 'The stray dog in the courtyard, watching', 'seed')] })]),
      story: story([episode(1, [generatedScene('s1-1', [beat('b1', 'She dresses for the club, fastening her grandmother\'s gold chain.')])])]),
    });
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.severity === 'error')).toBe(true);
  });

  it('keeps broad composite synopsis seeds advisory while concrete seed gate is on', () => {
    const result = run({
      plan: plan([plannedScene('s1-1', 1, {
        requiredBeats: [
          requiredBeat(
            'rb1',
            'Kylie arrives, builds a new glamorous life, launches a viral blog, and lets herself be courted by Victor, ignoring the quiet wrong-notes.',
            'seed',
          ),
        ],
      })]),
      story: story([episode(1, [generatedScene('s1-1', [beat('b1', 'Kylie FaceTimes Sadie from her Lipscani apartment and jokes about vampires in Romania.')])])]),
    });
    expect(result.valid).toBe(true);
    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ severity: 'warning' }),
    ]));
  });

  it('keeps hidden-information seeds advisory instead of requiring literal spoiler prose', () => {
    const result = run({
      plan: plan([plannedScene('s1-1', 1, {
        requiredBeats: [
          requiredBeat(
            'rb1',
            'Mika has been secretly steering Kylie toward Victor to settle her own debts.',
            'seed',
          ),
        ],
      })]),
      story: story([episode(1, [generatedScene('s1-1', [
        beat('b1', 'Mika slides the key card across the table and tells you Victor will be there.'),
        beat('b2', 'Her eyes flick to the window, hunted for half a second, before the bright smile snaps back.'),
      ])])]),
    });
    expect(result.valid).toBe(true);
    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ severity: 'warning' }),
    ]));
  });

  it('env kill-switch can keep a dropped seed advisory during rollback', () => {
    const prev = process.env.GATE_TREATMENT_SEED_REALIZATION;
    process.env.GATE_TREATMENT_SEED_REALIZATION = '0';
    try {
      const result = run({
        plan: plan([plannedScene('s1-1', 1, { requiredBeats: [requiredBeat('rb1', 'The stray dog in the courtyard, watching', 'seed')] })]),
        story: story([episode(1, [generatedScene('s1-1', [beat('b1', 'She dresses for the club, fastening her grandmother\'s gold chain.')])])]),
      });
      expect(result.valid).toBe(true);
      expect(result.issues.some((i) => i.severity === 'warning')).toBe(true);
    } finally {
      if (prev === undefined) delete process.env.GATE_TREATMENT_SEED_REALIZATION;
      else process.env.GATE_TREATMENT_SEED_REALIZATION = prev;
    }
  });
});
