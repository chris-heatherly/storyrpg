import { describe, expect, it } from 'vitest';

import {
  createInitialPlayerState,
  deserializePlayerState,
  serializePlayerState,
  DEFAULT_ATTRIBUTES,
  PLAYER_SAVE_VERSION,
} from './playerStatePersistence';

describe('player save persistence (audit H19 — versioning + old-save tolerance)', () => {
  it('round-trips the initial state and stamps the save version', () => {
    const state = createInitialPlayerState();
    const json = serializePlayerState(state);
    expect(JSON.parse(json).saveVersion).toBe(PLAYER_SAVE_VERSION);
    const loaded = deserializePlayerState(json)!;
    expect(loaded.attributes).toEqual(DEFAULT_ATTRIBUTES);
    expect(loaded.tags).toBeInstanceOf(Set);
  });

  it('defaults every missing map/collection in an old (v0) save instead of crashing later', () => {
    // A pre-versioning save from an older build: several maps entirely absent.
    const v0 = JSON.stringify({
      characterName: 'Mara',
      flags: { quest_started: true },
      // attributes, skills, relationships, scores, inventory,
      // completedEpisodes, tags all missing
    });
    const loaded = deserializePlayerState(v0)!;
    expect(loaded.attributes).toEqual(DEFAULT_ATTRIBUTES); // was undefined → NaN poison
    expect(loaded.skills).toEqual({});
    expect(loaded.relationships).toEqual({});
    expect(loaded.scores).toEqual({});
    expect(loaded.inventory).toEqual([]);
    expect(loaded.completedEpisodes).toEqual([]);
    expect(loaded.tags).toBeInstanceOf(Set);
    expect(loaded.flags.quest_started).toBe(true); // real data preserved
  });

  it('merges a partial attributes map over the defaults', () => {
    const save = JSON.stringify({ attributes: { charm: 88 } });
    const loaded = deserializePlayerState(save)!;
    expect(loaded.attributes.charm).toBe(88);
    expect(loaded.attributes.wit).toBe(DEFAULT_ATTRIBUTES.wit);
  });

  it('returns null (fresh start) for corrupt or non-object saves', () => {
    expect(deserializePlayerState('{not json')).toBeNull();
    expect(deserializePlayerState('null')).toBeNull();
    expect(deserializePlayerState('"a string"')).toBeNull();
  });
});
