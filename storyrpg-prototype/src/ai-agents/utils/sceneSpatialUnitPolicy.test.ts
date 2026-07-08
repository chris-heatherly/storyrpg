import { describe, expect, it } from 'vitest';
import { detectSpatialUnitViolations, strictSceneLocationCues } from './sceneSpatialUnitPolicy';

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
});
