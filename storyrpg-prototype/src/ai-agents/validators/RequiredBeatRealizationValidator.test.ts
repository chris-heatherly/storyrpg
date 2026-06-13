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

  it('valid when the plan carries no authored standard beats', () => {
    const result = run({
      plan: plan([plannedScene('s1-1', 1, {})]),
      story: story([episode(1, [generatedScene('s1-1', [beat('b1', 'Anything.')])])]),
    });
    expect(result.valid).toBe(true);
    expect(result.score).toBe(100);
  });
});
