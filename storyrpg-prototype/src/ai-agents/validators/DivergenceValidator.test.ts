import { describe, expect, it } from 'vitest';
import { DivergenceValidator, DivergenceInput } from './DivergenceValidator';
import { Episode, Scene, Beat, Choice } from '../../types';

function beat(partial: Partial<Beat> & { id: string }): Beat {
  return {
    text: 'A beat.',
    ...partial,
  } as Beat;
}

function choice(partial: Partial<Choice> & { id: string }): Choice {
  return {
    text: 'A choice.',
    ...partial,
  } as Choice;
}

function scene(partial: Partial<Scene> & { id: string; beats: Beat[] }): Scene {
  return {
    name: partial.id,
    startingBeatId: partial.beats[0]?.id ?? '',
    ...partial,
  } as Scene;
}

function episode(scenes: Scene[], startingSceneId: string): Episode {
  return {
    id: 'ep-1',
    number: 1,
    title: 'Test Episode',
    synopsis: 'A synopsis.',
    coverImage: 'cover.png',
    scenes,
    startingSceneId,
  } as Episode;
}

describe('DivergenceValidator', () => {
  it('passes an episode whose branches diverge into distinct terminal states', () => {
    // Two choice-point scenes; each choice persists a different flag/score so the
    // four leaf paths produce multiple distinct fingerprints.
    const scenes: Scene[] = [
      scene({
        id: 'start',
        beats: [
          beat({
            id: 'b-start',
            choices: [
              choice({
                id: 'c-help',
                consequences: [{ type: 'setFlag', flag: 'helped', value: true }],
                // G12: divergence is measured by EXPERIENCE (rendered prose +
                // felt state), not raw flags — give the branch distinct prose.
                outcomeTexts: { success: 'You take her hand and pull her up.', partial: 'You reach; she hesitates.', failure: 'Your hand closes on air.' },
                nextSceneId: 'mid',
              }),
              choice({
                id: 'c-refuse',
                consequences: [{ type: 'setFlag', flag: 'refused', value: true }],
                outcomeTexts: { success: 'You step back into the crowd alone.', partial: 'You half-turn away.', failure: 'You freeze in place.' },
                nextSceneId: 'mid',
              }),
            ],
          }),
        ],
      }),
      scene({
        id: 'mid',
        beats: [
          beat({
            id: 'b-mid',
            choices: [
              choice({
                id: 'c-fight',
                consequences: [{ type: 'changeScore', score: 'aggression', change: 3 }],
              }),
              choice({
                id: 'c-flee',
                consequences: [{ type: 'changeScore', score: 'caution', change: 2 }],
              }),
            ],
          }),
        ],
      }),
    ];

    const input: DivergenceInput = { episode: episode(scenes, 'start') };
    const result = new DivergenceValidator().validate(input);

    expect(result.valid).toBe(true);
    expect(result.issues.filter((i) => i.severity === 'error')).toHaveLength(0);
    expect(result.metrics.choicePointsEvaluated).toBe(2);
    expect(result.metrics.distinctFingerprints).toBeGreaterThan(1);
    expect(result.metrics.distinctFingerprints).toBe(result.metrics.totalTerminals);
    expect(result.score).toBe(100);
  });

  it('flags cosmetic branching when all paths converge to one terminal state', () => {
    // Two choice points but no choice carries any consequence — every leaf path
    // collapses to the same (empty) fingerprint.
    const scenes: Scene[] = [
      scene({
        id: 'start',
        beats: [
          beat({
            id: 'b-start',
            choices: [
              choice({ id: 'c-a', nextSceneId: 'mid' }),
              choice({ id: 'c-b', nextSceneId: 'mid' }),
            ],
          }),
        ],
      }),
      scene({
        id: 'mid',
        beats: [
          beat({
            id: 'b-mid',
            choices: [choice({ id: 'c-c' }), choice({ id: 'c-d' })],
          }),
        ],
      }),
    ];

    const input: DivergenceInput = { episode: episode(scenes, 'start') };
    const result = new DivergenceValidator().validate(input);

    expect(result.valid).toBe(false);
    expect(result.metrics.choicePointsEvaluated).toBe(2);
    expect(result.metrics.distinctFingerprints).toBe(1);
    expect(result.metrics.totalTerminals).toBeGreaterThan(1);

    const errors = result.issues.filter((i) => i.severity === 'error');
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain('cosmetic branching');
    expect(result.score).toBeLessThan(100);
  });
});

describe('DivergenceValidator — G12 write-only flags are cosmetic', () => {
  it('terminals distinguished ONLY by unread flags share an experience fingerprint', () => {
    const scenes: Scene[] = [
      scene({
        id: 'start',
        beats: [
          beat({
            id: 'b-start',
            choices: [
              // Identical prose, write-only flags — the g12 shape that gamed ratio 1.0.
              choice({ id: 'c-a', consequences: [{ type: 'setFlag', flag: 'only_a', value: true }], outcomeTexts: { success: 'You nod.', partial: 'You nod.', failure: 'You nod.' } }),
              choice({ id: 'c-b', consequences: [{ type: 'setFlag', flag: 'only_b', value: true }], outcomeTexts: { success: 'You nod.', partial: 'You nod.', failure: 'You nod.' } }),
            ],
          }),
        ],
      }),
    ];
    const result = new DivergenceValidator().validate({ episode: episode(scenes, 'start') });
    expect(result.metrics.totalTerminals).toBe(2);
    expect(result.metrics.distinctFingerprints).toBe(1); // experience: identical
    expect(result.metrics.distinctStateFingerprints).toBe(2); // raw state: still distinct (telemetry)
  });
});
