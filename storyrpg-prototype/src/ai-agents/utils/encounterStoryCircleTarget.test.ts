import { describe, expect, it } from 'vitest';
import {
  buildEncounterStoryCircleTargetRationale,
  formatEncounterStoryCircleTargetCriteria,
  normalizeEncounterStoryCircleTarget,
} from './encounterStoryCircleTarget';

describe('encounterStoryCircleTarget utilities', () => {
  it('keeps explicit valid targets', () => {
    expect(normalizeEncounterStoryCircleTarget('take', undefined, 'gain the proof')).toBe('take');
  });

  it('infers targets from encounter function keywords', () => {
    expect(normalizeEncounterStoryCircleTarget(undefined, undefined, 'The heroine crosses the threshold and retreat is impossible')).toBe('go');
    expect(normalizeEncounterStoryCircleTarget(undefined, undefined, 'The plan fails, allies are tested, and she must improvise')).toBe('search');
    expect(normalizeEncounterStoryCircleTarget(undefined, undefined, 'She discovers proof and gains access to the archive')).toBe('find');
    expect(normalizeEncounterStoryCircleTarget(undefined, undefined, 'Victory has a price: exposure, rupture, and loss')).toBe('take');
  });

  it('falls back from episode Story Circle roles', () => {
    expect(normalizeEncounterStoryCircleTarget(undefined, [{ beat: 'return', roleKind: 'primary' }], '')).toBe('take');
    expect(normalizeEncounterStoryCircleTarget(undefined, [{ beat: 'need', roleKind: 'primary' }], '')).toBe('go');
  });

  it('renders planner criteria and rationale for prompts', () => {
    expect(formatEncounterStoryCircleTargetCriteria()).toContain('Choose `go`');
    expect(formatEncounterStoryCircleTargetCriteria()).toContain('Choose `take`');
    expect(buildEncounterStoryCircleTargetRationale('find', [{ beat: 'find', roleKind: 'primary' }], 'Get the ledger')).toContain('Target `find`');
  });
});
