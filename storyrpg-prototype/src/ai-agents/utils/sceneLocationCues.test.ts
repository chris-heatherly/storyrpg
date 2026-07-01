import { describe, expect, it } from 'vitest';

import {
  extractSceneLocationCues,
  isContainerLocationCue,
  normalizeSceneLocationCue,
  uniqueMajorLocationCues,
} from './sceneLocationCues';

describe('normalizeSceneLocationCue', () => {
  it('collapses venue aliases and strips articles/accents', () => {
    expect(normalizeSceneLocationCue('Cișmigiu Gardens')).toBe('cismigiu');
    expect(normalizeSceneLocationCue('the Rooftop Bar')).toBe('rooftop bar');
    expect(normalizeSceneLocationCue('Vâlcescu Club')).toBe('valcescu club');
    expect(normalizeSceneLocationCue('a Bookstore')).toBe('bookshop');
  });

  it('drops planning-register prefixes', () => {
    expect(normalizeSceneLocationCue('Purpose: establish the threat')).toBeUndefined();
    expect(normalizeSceneLocationCue('')).toBeUndefined();
  });
});

describe('isContainerLocationCue', () => {
  it('treats cities and generic settlements as containers', () => {
    expect(isContainerLocationCue('bucharest')).toBe(true);
    expect(isContainerLocationCue('city center')).toBe(true);
    expect(isContainerLocationCue('rooftop bar')).toBe(false);
  });
});

describe('extractSceneLocationCues', () => {
  it('pulls prepositional location phrases out of prose', () => {
    expect(extractSceneLocationCues('Through Cismigiu, the protagonist notices a shadow.')).toEqual(['cismigiu']);
    expect(extractSceneLocationCues('In Bucharest, she waits.')).toEqual(['bucharest']);
  });
});

describe('uniqueMajorLocationCues', () => {
  it('does NOT treat a short prose fragment as a location (FP repro)', () => {
    // Regression: previously any <=48-char, punctuation-free, verb-free string
    // counted as a location, so this became a phantom "shadow moves behind trees"
    // cue and inflated the multi-location count that hard-aborts the gate.
    expect(uniqueMajorLocationCues(['A shadow moves behind the trees'])).toEqual([]);
  });

  it('counts one location when a scene declares a venue plus prose about it', () => {
    expect(
      uniqueMajorLocationCues(['Rooftop Bar', 'A shadow moves behind the trees']),
    ).toEqual(['rooftop bar']);
  });

  it('collapses container-only cues to a single location (FP repro)', () => {
    // "city center" (container) + "Bucharest" (container/city) describe one
    // ambient setting; they must not count as two conflicting locations.
    expect(
      uniqueMajorLocationCues(['city center', 'She lingers in Bucharest tonight.']).length,
    ).toBe(1);
  });

  it('still counts two genuinely distinct venues as two locations', () => {
    expect(
      uniqueMajorLocationCues(['Rooftop Bar', 'Then she crosses to the Museum.']).sort(),
    ).toEqual(['museum', 'rooftop bar']);
  });

  it('accepts proper place names and venue labels, rejects prose', () => {
    expect(uniqueMajorLocationCues(['Cișmigiu'])).toEqual(['cismigiu']);
    expect(uniqueMajorLocationCues(['Vâlcescu Club'])).toEqual(['valcescu club']);
    expect(uniqueMajorLocationCues(['she notices something is wrong'])).toEqual([]);
  });

  it('flattens nested arrays', () => {
    expect(uniqueMajorLocationCues([['Rooftop Bar'], 'Vâlcescu Club']).sort()).toEqual([
      'rooftop bar',
      'valcescu club',
    ]);
  });
});
