import { describe, expect, it } from 'vitest';
import { migrateV1ToV2 } from './v1ToV2';
import { migrateV2ToV3 } from './v2ToV3';
import { decodeStory, StoryValidationError } from '../storyCodec';

const v1Story = {
  id: 'story-legacy-1',
  title: 'Legacy',
  genre: 'mystery',
  synopsis: 'A legacy v1 story.',
  episodes: [
    {
      id: 'ep-1',
      number: 1,
      title: 'Ep 1',
      synopsis: 'Start',
      scenes: [
        {
          id: 'scene-1',
          startingBeatId: 'beat-1',
          beats: [{ id: 'beat-1', text: 'Hello', choices: [] }],
        },
      ],
    },
  ],
};

describe('migrations', () => {
  it('v1 → v2 wraps a bare Story object and produces a decodable package', () => {
    const { migrated, notes } = migrateV1ToV2(v1Story, { createdAt: '2024-01-01T00:00:00.000Z' });
    expect(migrated.schemaVersion).toBe(2);
    expect(migrated.storyId).toBe('story-legacy-1');
    expect(migrated.story.id).toBe('story-legacy-1');
    expect(notes).toEqual([]);

    const decoded = decodeStory(migrated);
    expect(decoded.schemaVersion).toBe(3);
    expect(decoded.detectedSchemaVersion).toBe(2);
    expect(decoded.migrated).toBe(true);
  });

  it('v1 → v2 throws on input that is not a Story', () => {
    expect(() => migrateV1ToV2({ not: 'a story' } as unknown)).toThrow(StoryValidationError);
  });

  it('v2 → v3 attaches an empty asset index by default', () => {
    const { migrated: v2 } = migrateV1ToV2(v1Story);
    const { migrated: v3, notes } = migrateV2ToV3(v2);
    expect(v3.schemaVersion).toBe(3);
    expect(v3.assets).toEqual({});
    expect(notes.some((n) => n.includes('assets index empty'))).toBe(true);
  });

  it('v2 → v3 attaches a provided asset index', () => {
    const { migrated: v2 } = migrateV1ToV2(v1Story);
    const sha = 'a'.repeat(64);
    const assets = {
      [sha]: {
        kind: 'image' as const,
        sha256: sha,
        mimeType: 'image/png',
      },
    };
    const { migrated: v3, notes } = migrateV2ToV3(v2, { assets });
    expect(v3.assets).toEqual(assets);
    expect(notes.some((n) => n.includes('assets index empty'))).toBe(false);
  });

  it('decodeStory runs v1 → v3 end-to-end on a bare Story', () => {
    const pkg = decodeStory(v1Story);
    expect(pkg.schemaVersion).toBe(3);
    expect(pkg.detectedSchemaVersion).toBe(1);
    expect(pkg.migrated).toBe(true);
    expect(pkg.story.id).toBe('story-legacy-1');
    expect(pkg.assets).toEqual({});
  });
});
