import { describe, expect, it } from 'vitest';
import type { AppliedConsequence } from '../types';
import {
  buildChoiceConsequenceSentence,
  buildChoiceRecognitionLine,
  getFictionFirstChangeFeedback,
} from './choiceChangeFeedback';

describe('choice change feedback', () => {
  it('keeps only relationship, identity, skill, and attribute feedback', () => {
    const feedback: AppliedConsequence[] = [
      { type: 'relationship', label: 'Mara · Trust', direction: 'up', magnitude: 'minor' },
      { type: 'identity', label: 'Bolder', direction: 'up', magnitude: 'moderate' },
      { type: 'skill', label: 'Persuasion', direction: 'up', magnitude: 'minor' },
      { type: 'attribute', label: 'Resolve', direction: 'up', magnitude: 'minor' },
      { type: 'score', label: 'Suspicion', direction: 'up', magnitude: 'minor' },
      { type: 'flag', label: 'Hidden Flag', direction: 'neutral', magnitude: 'minor' },
      { type: 'item', label: 'Key', direction: 'up', magnitude: 'minor' },
    ];

    expect(getFictionFirstChangeFeedback(feedback).map((item) => item.type)).toEqual([
      'relationship',
      'identity',
      'skill',
      'attribute',
    ]);
  });

  it('prioritizes relationship prose for next-beat recognition', () => {
    const line = buildChoiceRecognitionLine([
      {
        type: 'skill',
        label: 'Persuasion',
        direction: 'up',
        magnitude: 'minor',
        narrativeHint: 'You feel more practiced in persuasion.',
      },
      {
        type: 'relationship',
        label: 'Mara · Trust',
        direction: 'up',
        magnitude: 'minor',
        narrativeHint: 'Mara trusts you more.',
      },
    ]);

    expect(line).toBe('Mara trusts you more.');
  });

  it('rewrites identity labels into fiction-first prose', () => {
    const line = buildChoiceRecognitionLine([
      {
        type: 'identity',
        label: 'Bolder',
        direction: 'up',
        magnitude: 'moderate',
        narrativeHint: 'Bolder — your choices are shaping who you become.',
      },
    ]);

    expect(line).toBe('A bolder part of you steps forward.');
  });

  it('falls back to attribute and skill hints without exposing numbers', () => {
    expect(buildChoiceRecognitionLine([
      {
        type: 'attribute',
        label: 'Resolve',
        direction: 'up',
        magnitude: 'minor',
        narrativeHint: 'Your determination hardens.',
      },
    ])).toBe('Your determination hardens.');

    expect(buildChoiceRecognitionLine([
      {
        type: 'skill',
        label: 'Investigation',
        direction: 'up',
        magnitude: 'minor',
        narrativeHint: 'You feel more practiced in investigation.',
      },
    ])).toBe('You feel more practiced in investigation.');
  });

  it('combines relationship and skill feedback into one fiction-first sentence', () => {
    const sentence = buildChoiceConsequenceSentence([
      {
        type: 'relationship',
        label: 'Lysandra Brightwell · Trust',
        direction: 'up',
        magnitude: 'minor',
        narrativeHint: 'Lysandra Brightwell trusts you.',
      },
      {
        type: 'skill',
        label: 'Persuasion',
        direction: 'up',
        magnitude: 'minor',
        narrativeHint: 'You feel more practiced in persuasion.',
      },
    ]);

    expect(sentence).toBe('Lysandra Brightwell trusts you as you become more practiced in persuasion.');
  });

  it('omits neutral relationship chatter when meaningful feedback is present', () => {
    const sentence = buildChoiceConsequenceSentence([
      {
        type: 'relationship',
        label: 'Lysandra Brightwell · Respect',
        direction: 'up',
        magnitude: 'minor',
        narrativeHint: 'Lysandra Brightwell neither respects nor disrespects you.',
      },
      {
        type: 'relationship',
        label: 'Lysandra Brightwell · Trust',
        direction: 'up',
        magnitude: 'minor',
        narrativeHint: 'Lysandra Brightwell trusts you.',
      },
      {
        type: 'skill',
        label: 'Persuasion',
        direction: 'up',
        magnitude: 'minor',
        narrativeHint: 'You feel more practiced in persuasion.',
      },
    ]);

    expect(sentence).toBe('Lysandra Brightwell trusts you as you become more practiced in persuasion.');
  });

  it('keeps skill-only and attribute-only feedback fiction-first', () => {
    expect(buildChoiceConsequenceSentence([
      {
        type: 'skill',
        label: 'Investigation',
        direction: 'up',
        magnitude: 'minor',
        narrativeHint: 'You feel more practiced in investigation.',
      },
    ])).toBe('You feel more practiced in investigation.');

    expect(buildChoiceConsequenceSentence([
      {
        type: 'attribute',
        label: 'Resolve',
        direction: 'up',
        magnitude: 'minor',
        narrativeHint: 'Your determination hardens.',
      },
    ])).toBe('Your determination hardens.');
  });

  it('does not surface hidden mechanics or neutral-only relationship feedback', () => {
    expect(buildChoiceConsequenceSentence([
      { type: 'score', label: 'Suspicion', direction: 'up', magnitude: 'minor' },
      { type: 'flag', label: 'Hidden Flag', direction: 'neutral', magnitude: 'minor' },
      { type: 'item', label: 'Key', direction: 'up', magnitude: 'minor' },
    ])).toBeUndefined();

    expect(buildChoiceConsequenceSentence([
      {
        type: 'relationship',
        label: 'Lysandra Brightwell · Respect',
        direction: 'up',
        magnitude: 'minor',
        narrativeHint: 'Lysandra Brightwell neither respects nor disrespects you.',
      },
    ])).toBeUndefined();
  });
});
