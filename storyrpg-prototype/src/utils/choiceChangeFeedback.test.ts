import { describe, expect, it } from 'vitest';
import type { AppliedConsequence } from '../types';
import {
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
});
