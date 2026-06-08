/**
 * Treatment-Fidelity Remediation §4.4 — Signature Device Presence (RC5).
 *
 * The "expand, do not rewrite" contract binds each authored SIGNATURE staged
 * moment to its scene (`signatureMoment` / `requiredBeats[tier==='signature']`).
 * This validator is the backstop that confirms each signature actually LANDS in
 * the generated prose and is not INVERTED ("he didn't ...").
 *
 * Covered:
 *  - a signature that is depicted in the matching scene's prose → valid (pass);
 *  - a signature that never appears in the prose → blocking error (fail);
 *  - a signature whose keywords appear but are negated ("he didn't ...") →
 *    blocking inversion error (the RC5 Ep2 failure mode);
 *  - encounter-level signature beats are checked too;
 *  - a plan with no signature beats is trivially valid (from-scratch / silent run).
 */

import { describe, expect, it } from 'vitest';
import {
  SignatureDevicePresenceValidator,
  type SignatureDevicePresenceInput,
} from './SignatureDevicePresenceValidator';
import type { PlannedScene, RequiredBeat, SeasonScenePlan } from '../../types/scenePlan';
import type { Beat } from '../../types/content';
import type { Episode, Scene, Story } from '../../types/story';

// --- builders -------------------------------------------------------------

function plannedScene(
  id: string,
  episodeNumber: number,
  opts: {
    signatureMoment?: string;
    requiredBeats?: RequiredBeat[];
    encounterRequiredBeats?: RequiredBeat[];
  } = {},
): PlannedScene {
  const scene: PlannedScene = {
    id,
    episodeNumber,
    order: 0,
    kind: opts.encounterRequiredBeats ? 'encounter' : 'standard',
    title: id,
    dramaticPurpose: 'x',
    narrativeRole: 'turn',
    locations: [],
    npcsInvolved: [],
    setsUp: [],
    paysOff: [],
    signatureMoment: opts.signatureMoment,
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
  for (const s of scenes) {
    (byEpisode[s.episodeNumber] ??= []).push(s.id);
  }
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

function run(input: SignatureDevicePresenceInput) {
  return new SignatureDevicePresenceValidator().validate(input);
}

// --- tests ----------------------------------------------------------------

describe('SignatureDevicePresenceValidator', () => {
  it('PASS: a depicted signature device lands in the matching scene prose', () => {
    const sig = 'the joined-blood archive floor revealed beneath the dust';
    const result = run({
      plan: plan([plannedScene('s1-1', 1, { signatureMoment: sig })]),
      story: story([
        episode(1, [
          generatedScene('s1-1', [
            beat(
              'b1',
              'She brushed the dust aside and the archive floor revealed the joined blood sealed into the stone.',
            ),
          ]),
        ]),
      ]),
    });

    expect(result.valid).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  it('FAIL: a signature device absent from the prose is a blocking error', () => {
    const sig = 'the joined-blood archive floor revealed beneath the dust';
    const result = run({
      plan: plan([plannedScene('s1-1', 1, { signatureMoment: sig })]),
      story: story([
        episode(1, [
          generatedScene('s1-1', [
            beat('b1', 'She walked into a quiet, ordinary room and sat down to rest.'),
          ]),
        ]),
      ]),
    });

    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.severity === 'error' && /missing/i.test(i.message))).toBe(true);
  });

  it('FAIL: an inverted/negated signature ("he didn\'t ...") is a blocking error', () => {
    const sig = 'Aethavyr leaps from the battlement to save the falling child';
    const result = run({
      plan: plan([
        plannedScene('s2-3', 2, {
          requiredBeats: [
            { id: 's2-3-rb1', sourceTurn: 'Ep2 naming + rescue leap', mustDepict: sig, tier: 'signature' },
          ],
        }),
      ]),
      story: story([
        episode(2, [
          generatedScene('s2-3', [
            // Keywords present, but negated — the RC5 inversion failure mode.
            beat('b1', 'Aethavyr stood on the battlement and did not leap to save the falling child.'),
          ]),
        ]),
      ]),
    });

    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.severity === 'error' && /INVERTED|negat/i.test(i.message))).toBe(true);
  });

  it('checks encounter-level signature required beats too', () => {
    const sig = 'the wall breach where the poison vial is administered';
    const result = run({
      plan: plan([
        plannedScene('s4-2', 4, {
          encounterRequiredBeats: [
            { id: 's4-2-erb1', sourceTurn: 'Ep4 trap', mustDepict: sig, tier: 'signature' },
          ],
        }),
      ]),
      story: story([
        episode(4, [
          generatedScene('s4-2', [beat('b1', 'A calm corridor with nothing of note.')]),
        ]),
      ]),
    });

    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => /encounterRequiredBeat/.test(i.location ?? ''))).toBe(true);
  });

  it('a plan with no signature beats is trivially valid', () => {
    const result = run({
      plan: plan([plannedScene('s1-1', 1)]),
      story: story([episode(1, [generatedScene('s1-1', [beat('b1', 'anything')])])]),
    });

    expect(result.valid).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  it('non-signature required beats are out of scope (not enforced here)', () => {
    const result = run({
      plan: plan([
        plannedScene('s1-1', 1, {
          requiredBeats: [
            { id: 's1-1-rb1', sourceTurn: 'authored turn', mustDepict: 'a totally unrelated authored turn', tier: 'authored' },
          ],
        }),
      ]),
      story: story([episode(1, [generatedScene('s1-1', [beat('b1', 'nothing matching')])])]),
    });

    expect(result.valid).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  it('partial-season: skips signatures for episodes that were not generated (gen-5)', () => {
    // A treatment plans signatures for ep1 AND ep4, but only ep1–3 were generated.
    // The ep4 signature must NOT be flagged "no generated prose" — it is legitimately
    // absent. The ep1 signature is present and clean.
    const ep1sig = 'the rooftop bar at sunset where the dusk club locks into place';
    const result = run({
      plan: plan([
        plannedScene('s1-1', 1, { signatureMoment: ep1sig }),
        plannedScene('treatment-enc-4-1', 4, { signatureMoment: 'the fire-lit dinner at Casa Lupului' }),
      ]),
      story: story([
        episode(1, [generatedScene('s1-1', [beat('b1', 'On the rooftop bar at sunset the dusk club locks into place around you.')])]),
        episode(2, [generatedScene('s2-1', [beat('b1', 'A different night.')])]),
        episode(3, [generatedScene('s3-1', [beat('b1', 'Another night still.')])]),
      ]),
    });
    expect(result.valid).toBe(true);
    expect(result.issues).toHaveLength(0);
  });
});
