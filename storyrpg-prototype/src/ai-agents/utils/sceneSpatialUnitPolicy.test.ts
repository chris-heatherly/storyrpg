import { afterEach, describe, expect, it } from 'vitest';
import {
  GENRE_NEUTRAL_LEXICON,
  resetStoryLexiconFromEnv,
  setStoryLexicon,
  withDeclaredContainerLocations,
} from '../config/storyLexicon';
import { detectSpatialUnitViolations, strictSceneLocationCues } from './sceneSpatialUnitPolicy';

afterEach(() => resetStoryLexiconFromEnv({}));

describe('sceneSpatialUnitPolicy', () => {
  it('counts container city plus specific venue as two spatial units', () => {
    const cues = strictSceneLocationCues(
      ['Lumina Books'],
      [
        'She explores the streets of Bucharest.',
        'She wanders into a bookshop owned by Stela who befriends her.',
      ],
    );
    expect(cues.length).toBeGreaterThanOrEqual(2);
  });

  it('detects stacked spatial beats on one scene', () => {
    const violation = detectSpatialUnitViolations({
      sceneId: 's1-1',
      kind: 'standard',
      locations: ['Lumina Books'],
      requiredBeats: [
        { id: 'a', tier: 'authored', sourceTurn: 'She explores the streets of Bucharest.', mustDepict: 'She explores the streets of Bucharest.' },
        { id: 'b', tier: 'authored', sourceTurn: 'She wanders into a bookshop owned by Stela who befriends her.', mustDepict: 'She wanders into a bookshop owned by Stela who befriends her.' },
      ],
    });
    expect(violation?.locationCues.length).toBeGreaterThanOrEqual(2);
  });

  it('does not split a declared city container from its child scene location', () => {
    setStoryLexicon(withDeclaredContainerLocations(GENRE_NEUTRAL_LEXICON, [
      'Present-day Nairobi, Kenya (including Westlands and Karura Forest)',
    ]));
    const violation = detectSpatialUnitViolations({
      sceneId: 's1-1',
      kind: 'standard',
      locations: ['Apartment'],
      requiredBeats: [{
        id: 'arrival',
        tier: 'authored',
        sourceTurn: 'Amara arrives in Nairobi with two suitcases and her aunt\'s address.',
        mustDepict: 'Amara arrives in Nairobi with two suitcases and her aunt\'s address.',
      }],
    });
    expect(violation).toBeUndefined();
  });

  it('maps city exploration to its declared container instead of an abstract location', () => {
    setStoryLexicon(withDeclaredContainerLocations(GENRE_NEUTRAL_LEXICON, [
      'Modern Nairobi, Kenya',
    ]));
    expect(strictSceneLocationCues(
      ['Nairobi Streets'],
      ['She explores the streets of Nairobi.'],
    )).toEqual(['nairobi']);
  });

  it('still blocks obligations spanning two concrete venues', () => {
    setStoryLexicon(withDeclaredContainerLocations(GENRE_NEUTRAL_LEXICON, ['Nairobi, Kenya']));
    const violation = detectSpatialUnitViolations({
      sceneId: 's1-2',
      kind: 'standard',
      locations: ['Apartment'],
      requiredBeats: [
        {
          id: 'letter',
          tier: 'authored',
          sourceTurn: 'At the apartment, she opens the letter.',
          mustDepict: 'At the apartment, she opens the letter.',
        },
        {
          id: 'meeting',
          tier: 'authored',
          sourceTurn: 'At the museum, she meets her contact.',
          mustDepict: 'At the museum, she meets her contact.',
        },
      ],
    });
    expect(violation?.locationCues.sort()).toEqual(['apartment', 'museum']);
  });
});
