import { describe, expect, it } from 'vitest';

import {
  anchoredSceneLocationCues,
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

  it('never mines a city + person-name run as a second location (bite-me 2026-07-03)', () => {
    // Beat fields are space-joined without sentence boundaries, so
    // "…arrives in Bucharest␣Kylie unpacks…" produces the capitalized run
    // "Bucharest Kylie". It must collapse to the container city (which never
    // counts toward the multi-location conflict), leaving only the apartment.
    expect(
      uniqueMajorLocationCues(['Lipscani Apartment', 'Kylie arrives in Bucharest Kylie unpacks her two suitcases in the apartment']),
    ).toEqual(['apartment']);
  });

  it('still counts two genuinely distinct venues as two locations', () => {
    expect(
      uniqueMajorLocationCues(['Rooftop Bar', 'Then she crosses to the Museum.']).sort(),
    ).toEqual(['museum', 'rooftop bar']);
  });

  it('does not treat gerund action phrases as places (bite-me 2026-07-08 s1-4)', () => {
    // "Testing Kylie" is Title Case and verb-free enough to look like a place
    // name under the old heuristic; it must not become a second major cue
    // beside the apartment and abort SceneConstructionGate.
    expect(uniqueMajorLocationCues(['apartment', 'Testing Kylie'])).toEqual(['apartment']);
    expect(uniqueMajorLocationCues(['Testing Kylie'])).toEqual([]);
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

describe('anchoredSceneLocationCues', () => {
  it('anchors declared location labels to one cue (qualified label FP)', () => {
    // Live FP (Phase 7 smoke, 2026-07-01): "Rooftop bar in Lipscani" was mined
    // for two major cues and hard-aborted a single-place scene.
    expect(anchoredSceneLocationCues(
      ['Rooftop bar in Lipscani'],
      ['At a rooftop bar she catches the attention of a man in a charcoal suit.'],
    )).toEqual(['rooftop bar']);
  });

  it('anchors itinerary-style labels and absorbs text cues the label names', () => {
    expect(anchoredSceneLocationCues(
      ['Rooftop bar, then the walk home through Cismigiu'],
      ['At a rooftop bar she catches the attention of a stranger.'],
    )).toHaveLength(1);
  });

  it('still surfaces a genuinely conflicting obligation-text location', () => {
    expect(anchoredSceneLocationCues(
      ['Apartment'],
      ['At the apartment, she opens the letter.', 'At the rooftop bar, she forms a new circle.'],
    ).sort()).toEqual(['apartment', 'rooftop bar']);
  });

  it('treats container-only labels as ambient, not anchors', () => {
    expect(anchoredSceneLocationCues(
      ['Bucharest'],
      ['At the rooftop bar, she forms a new circle.'],
    )).toEqual(['rooftop bar']);
  });
});

describe('person entities are not location anchors (bite-me 2026-07-03T15-30-01 victor regression)', () => {
  it('rejects a bare pressure-entity name mined from a preposition phrase', () => {
    expect(extractSceneLocationCues('She reads the note again, an invitation from Victor for the Equinox weekend.')).not.toContain('victor');
  });

  it('keeps venue-qualified entity phrases as places (label path)', () => {
    // Scene location LABELS flow through normalizeSceneLocationCue directly;
    // a venue word keeps an entity-prefixed label a real place.
    expect(normalizeSceneLocationCue("Victor's estate")).toBeDefined();
    expect(normalizeSceneLocationCue('Victor')).toBeUndefined();
  });

  it('still anchors ordinary places alongside entity mentions', () => {
    const cues = extractSceneLocationCues('At the apartment she thinks of Victor.');
    expect(cues).toContain('apartment');
    expect(cues).not.toContain('victor');
  });
});
