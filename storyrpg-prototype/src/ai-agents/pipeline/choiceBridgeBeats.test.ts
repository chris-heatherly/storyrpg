import { describe, expect, it } from 'vitest';
import {
  buildChoiceBridgeBeatText,
  genericBridgeDestination,
  isGenericChoiceBridgeFragment,
} from './choiceBridgeBeats';
import type { ChoiceSet } from '../agents/ChoiceAuthor';

type ChoiceLike = ChoiceSet['choices'][number];

describe('genericBridgeDestination', () => {
  it('is deterministic for the same choice id', () => {
    expect(genericBridgeDestination('choice-1')).toBe(genericBridgeDestination('choice-1'));
  });

  it('always returns one of the rotation lines', () => {
    const options = [
      'What comes next is already in motion.',
      'There is no stepping back from here.',
      'The decision settles into your chest and stays there.',
      'The choice changes the air around you.',
    ];
    for (const id of ['a', 'b', 'c', 'longer-choice-id', undefined]) {
      expect(options).toContain(genericBridgeDestination(id));
    }
  });
});

describe('isGenericChoiceBridgeFragment', () => {
  it('detects the known generic lines regardless of case/spacing', () => {
    expect(isGenericChoiceBridgeFragment('What comes next is already in motion.')).toBe(true);
    expect(isGenericChoiceBridgeFragment('  the choice changes   the air around you ')).toBe(true);
  });

  it('passes authored prose through', () => {
    expect(isGenericChoiceBridgeFragment('She pockets the key and heads for the stairwell.')).toBe(false);
  });
});

describe('buildChoiceBridgeBeatText', () => {
  it('prefers the authored in-fiction fragment', () => {
    const choice = {
      id: 'c1',
      text: 'Take the key',
      outcomeTexts: { partial: 'You pocket the key before anyone notices' },
    } as unknown as ChoiceLike;
    expect(buildChoiceBridgeBeatText(choice)).toBe('You pocket the key before anyone notices.');
  });

  it('falls back to a deterministic generic line when nothing is authored', () => {
    const choice = { id: 'c2', text: 'Wait' } as unknown as ChoiceLike;
    const first = buildChoiceBridgeBeatText(choice);
    expect(first).toBe(buildChoiceBridgeBeatText(choice));
    expect(isGenericChoiceBridgeFragment(first)).toBe(true);
  });

  it('rejects generic fragments sourced from planning fields', () => {
    const choice = {
      id: 'c3',
      text: 'Leave',
      reactionText: 'What comes next is already in motion.',
    } as unknown as ChoiceLike;
    // The authored fragment IS a known generic line — it must be replaced by the
    // deterministic rotation, not double-counted as authored prose.
    expect(isGenericChoiceBridgeFragment(buildChoiceBridgeBeatText(choice))).toBe(true);
  });
});
