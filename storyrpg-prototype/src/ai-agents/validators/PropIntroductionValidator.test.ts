import { describe, expect, it } from 'vitest';
import { PropIntroductionValidator } from './PropIntroductionValidator';

describe('PropIntroductionValidator', () => {
  it('flags a reference to an entity that is not declared anywhere', () => {
    const r = new PropIntroductionValidator().validate({
      knownEntityIds: ['protagonist', 'lysandra'],
      sceneContents: [
        { sceneId: 's1', referencedEntityIds: ['protagonist'] },
        { sceneId: 's2', referencedEntityIds: ['protagonist', 'mystery_knight'] },
      ],
    });
    expect(r.valid).toBe(false);
    expect(r.metrics.unresolvedReferences).toEqual([{ sceneId: 's2', entityId: 'mystery_knight' }]);
  });

  it('passes when every reference resolves to a known entity', () => {
    const r = new PropIntroductionValidator().validate({
      knownEntityIds: ['protagonist', 'lysandra'],
      sceneContents: [
        { sceneId: 's1', referencedEntityIds: ['protagonist', 'lysandra'] },
        { sceneId: 's2', referencedEntityIds: ['lysandra'] },
      ],
    });
    expect(r.valid).toBe(true);
  });

  it('treats a scene-declared introduction as making the entity known', () => {
    const r = new PropIntroductionValidator().validate({
      knownEntityIds: ['protagonist'],
      sceneContents: [
        { sceneId: 's1', referencedEntityIds: [], introducesEntityIds: ['relic'] },
        { sceneId: 's2', referencedEntityIds: ['relic'] },
      ],
    });
    expect(r.valid).toBe(true);
  });

  it('de-dupes repeated references to the same unknown entity into one issue', () => {
    const r = new PropIntroductionValidator().validate({
      knownEntityIds: ['protagonist'],
      sceneContents: [
        { sceneId: 's1', referencedEntityIds: ['ghost'] },
        { sceneId: 's2', referencedEntityIds: ['ghost'] },
      ],
    });
    expect(r.metrics.unresolvedReferences).toHaveLength(2);
    expect(r.issues).toHaveLength(1);
  });

  it('default mode emits warning severity for an unresolved reference', () => {
    const r = new PropIntroductionValidator().validate({
      knownEntityIds: ['protagonist'],
      sceneContents: [{ sceneId: 's1', referencedEntityIds: ['ghost'] }],
    });
    expect(r.issues.every((i) => i.severity === 'warning')).toBe(true);
    expect(r.issues.some((i) => i.severity === 'error')).toBe(false);
  });

  it('strict mode escalates an unresolved reference to error severity', () => {
    const r = new PropIntroductionValidator().validate(
      {
        knownEntityIds: ['protagonist'],
        sceneContents: [{ sceneId: 's1', referencedEntityIds: ['ghost'] }],
      },
      { strict: true },
    );
    expect(r.issues.some((i) => i.severity === 'error')).toBe(true);
    expect(r.issues.every((i) => i.severity === 'error')).toBe(true);
  });

  it('strict mode does not invent issues when all references resolve', () => {
    const r = new PropIntroductionValidator().validate(
      {
        knownEntityIds: ['protagonist', 'lysandra'],
        sceneContents: [{ sceneId: 's1', referencedEntityIds: ['protagonist', 'lysandra'] }],
      },
      { strict: true },
    );
    expect(r.valid).toBe(true);
    expect(r.issues).toHaveLength(0);
  });
});
