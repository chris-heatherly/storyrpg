import { describe, expect, it } from 'vitest';
import {
  buildEpisodeKnownEntitySet,
  buildPropIntroductionInput,
  type EpisodeSceneForPropGate,
} from './propIntroductionGate';
import { PropIntroductionValidator } from '../validators/PropIntroductionValidator';

describe('buildEpisodeKnownEntitySet', () => {
  it('unions cast/prop ids with every scene introduction, de-duped, first-seen order', () => {
    const scenes: EpisodeSceneForPropGate[] = [
      { sceneId: 's1', introducesEntityIds: ['ghost', 'cast-a'] },
      { sceneId: 's2', introducesEntityIds: ['lantern', 'ghost'] },
    ];
    expect(buildEpisodeKnownEntitySet(['cast-a', 'cast-b'], scenes)).toEqual([
      'cast-a',
      'cast-b',
      'ghost',
      'lantern',
    ]);
  });

  it('drops falsy ids from both sources', () => {
    const scenes: EpisodeSceneForPropGate[] = [
      { sceneId: 's1', introducesEntityIds: ['', 'lantern'] },
    ];
    expect(buildEpisodeKnownEntitySet(['cast-a', undefined, null, ''], scenes)).toEqual([
      'cast-a',
      'lantern',
    ]);
  });

  it('handles missing introduction arrays and empty inputs', () => {
    expect(buildEpisodeKnownEntitySet([], [{ sceneId: 's1' }])).toEqual([]);
    expect(buildEpisodeKnownEntitySet([], [])).toEqual([]);
  });

  it('folds in a later-scene introduction (ordering not enforced)', () => {
    const scenes: EpisodeSceneForPropGate[] = [
      { sceneId: 's1', referencedEntityIds: ['relic'] },
      { sceneId: 's2', introducesEntityIds: ['relic'] },
    ];
    expect(buildEpisodeKnownEntitySet(['hero'], scenes)).toEqual(['hero', 'relic']);
  });
});

describe('buildPropIntroductionInput', () => {
  it('shapes a ready-to-validate input and passes through the validator clean', () => {
    const scenes: EpisodeSceneForPropGate[] = [
      { sceneId: 's1', sceneName: 'Arrival', referencedEntityIds: ['hero'] },
      { sceneId: 's2', sceneName: 'The Vault', referencedEntityIds: ['relic'], introducesEntityIds: ['relic'] },
    ];
    const input = buildPropIntroductionInput(['hero', 'mentor'], scenes);

    expect(input.knownEntityIds).toEqual(['hero', 'mentor', 'relic']);
    expect(input.sceneContents).toEqual([
      { sceneId: 's1', sceneName: 'Arrival', referencedEntityIds: ['hero'], introducesEntityIds: [] },
      {
        sceneId: 's2',
        sceneName: 'The Vault',
        referencedEntityIds: ['relic'],
        introducesEntityIds: ['relic'],
      },
    ]);

    const result = new PropIntroductionValidator().validate(input);
    expect(result.valid).toBe(true);
    expect(result.metrics.unresolvedReferences).toEqual([]);
  });

  it('produces an input that flags an undeclared reference via the validator', () => {
    const scenes: EpisodeSceneForPropGate[] = [
      { sceneId: 's1', sceneName: 'Arrival', referencedEntityIds: ['hero', 'phantom'] },
    ];
    const input = buildPropIntroductionInput(['hero'], scenes);

    const result = new PropIntroductionValidator().validate(input);
    expect(result.valid).toBe(false);
    expect(result.metrics.unresolvedReferences).toEqual([{ sceneId: 's1', entityId: 'phantom' }]);
  });

  it('treats a cross-scene introduction as known even when referenced in an earlier scene', () => {
    const scenes: EpisodeSceneForPropGate[] = [
      { sceneId: 's1', sceneName: 'Foreshadow', referencedEntityIds: ['relic'] },
      { sceneId: 's2', sceneName: 'Reveal', introducesEntityIds: ['relic'] },
    ];
    const input = buildPropIntroductionInput(['hero'], scenes);

    const result = new PropIntroductionValidator().validate(input);
    expect(result.valid).toBe(true);
    expect(result.metrics.unresolvedReferences).toEqual([]);
  });

  it('filters falsy reference ids out of the shaped scene rows', () => {
    const scenes: EpisodeSceneForPropGate[] = [
      { sceneId: 's1', referencedEntityIds: ['hero', ''], introducesEntityIds: ['', 'relic'] },
    ];
    const input = buildPropIntroductionInput(['hero'], scenes);
    expect(input.sceneContents[0].referencedEntityIds).toEqual(['hero']);
    expect(input.sceneContents[0].introducesEntityIds).toEqual(['relic']);
  });
});
