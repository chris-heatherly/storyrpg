import { describe, expect, it } from 'vitest';
import type { Episode, Scene } from '../../types';
import type { EpisodeBlueprint } from '../agents/StoryArchitect';
import { DuplicateEstablishingBeatValidator } from './DuplicateEstablishingBeatValidator';

function scene(id: string, text: string): Scene {
  return {
    id,
    name: id,
    startingBeatId: `${id}-b1`,
    beats: [{ id: `${id}-b1`, text }],
  } as Scene;
}

function episode(scenes: Scene[]): Episode {
  return {
    id: 'ep', number: 3, title: 'Ep', synopsis: '', coverImage: '',
    startingSceneId: scenes[0].id, scenes,
  } as Episode;
}

function blueprint(locations: Record<string, string>): EpisodeBlueprint {
  return {
    episodeId: 'ep', number: 3, title: 'Ep', synopsis: '',
    arc: { you: '', need: '', go: '', search: '', find: '', take: '', return: '', change: '' },
    themes: [],
    scenes: Object.entries(locations).map(([id, location]) => ({
      id, name: id, description: id, location, mood: 'tense', purpose: 'bottleneck',
      dramaticQuestion: '', wantVsNeed: '', conflictEngine: '', npcsPresent: [],
      narrativeFunction: '', keyBeats: [], leadsTo: [],
    })),
    startingSceneId: Object.keys(locations)[0],
    bottleneckScenes: [], suggestedFlags: [], suggestedScores: [], suggestedTags: [], narrativePromises: [],
  } as EpisodeBlueprint;
}

describe('DuplicateEstablishingBeatValidator', () => {
  // The real Endsong Gen-4 dual-first-entry.
  const s32 = scene('s3-2', 'You cross the threshold into the commander\'s hall before you smell it — tallow and old blood. Thorne is already at the map table.');
  const s33 = scene('s3-3', 'You step into the great hall of Fort Dawnwatch and the smell finds you first — tallow smoke and rationed grain. You find Thorne at the far end.');

  it('flags two sequential scenes that re-enter the same blueprint location', () => {
    const result = new DuplicateEstablishingBeatValidator().validateEpisode(
      episode([s32, s33]),
      blueprint({ 's3-2': "Commander's Hall, Fort Dawnwatch", 's3-3': "Commander's Hall, Fort Dawnwatch" }),
    );
    expect(result.metrics.duplicateEstablishingBeatCount).toBe(1);
    expect(result.issues[0]).toMatchObject({ sceneId: 's3-3', priorSceneId: 's3-2', severity: 'warning' });
  });

  it('flags via the shared place-noun fallback when locations are absent', () => {
    const result = new DuplicateEstablishingBeatValidator().validateEpisode(episode([s32, s33]));
    // Both opening sentences contain "hall".
    expect(result.metrics.duplicateEstablishingBeatCount).toBe(1);
  });

  it('escalates to error when blocking', () => {
    const result = new DuplicateEstablishingBeatValidator().validateEpisode(
      episode([s32, s33]), undefined, { blocking: true },
    );
    expect(result.valid).toBe(false);
    expect(result.issues[0].severity).toBe('error');
  });

  it('does not flag distinct locations', () => {
    const a = scene('s1', 'You step into the candlelit study and shut the door.');
    const b = scene('s2', 'You cross the muddy courtyard toward the gate.');
    const result = new DuplicateEstablishingBeatValidator().validateEpisode(
      episode([a, b]),
      blueprint({ s1: 'The Study', s2: 'The Outer Courtyard' }),
    );
    expect(result.metrics.duplicateEstablishingBeatCount).toBe(0);
  });

  it('does not flag when the second scene is a continuation (no entry verb)', () => {
    const a = scene('s1', 'You cross into the great hall and find Thorne at his ledger.');
    const b = scene('s2', 'Thorne sets down his pen. The hall has not grown warmer since you arrived.');
    const result = new DuplicateEstablishingBeatValidator().validateEpisode(
      episode([a, b]),
      blueprint({ s1: 'Great Hall', s2: 'Great Hall' }),
    );
    expect(result.metrics.duplicateEstablishingBeatCount).toBe(0);
  });
});
