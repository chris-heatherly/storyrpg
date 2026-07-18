import { describe, it, expect } from 'vitest';
import {
  assignBlueprintTimeline,
  buildSceneTimelineHandoff,
  inferExplicitClockTimeFromText,
  inferTimeOfDayFromText,
  normalizeTimeOfDay,
  sceneTimelineMetaForScene,
  type TimelineScene,
} from './sceneTimeline';

const scene = (overrides: Partial<TimelineScene> & { id: string }): TimelineScene => ({
  name: overrides.id,
  location: 'the-hall',
  ...overrides,
} as TimelineScene);

describe('normalizeTimeOfDay', () => {
  it('keeps canonical values and maps synonyms', () => {
    expect(normalizeTimeOfDay('night')).toBe('night');
    expect(normalizeTimeOfDay('NOON')).toBe('midday');
    expect(normalizeTimeOfDay('sunset')).toBe('dusk');
    expect(normalizeTimeOfDay('midnight')).toBe('night');
  });

  it('drops invalid values', () => {
    expect(normalizeTimeOfDay('whenever')).toBeUndefined();
    expect(normalizeTimeOfDay(42)).toBeUndefined();
    expect(normalizeTimeOfDay(undefined)).toBeUndefined();
  });
});

describe('inferTimeOfDayFromText', () => {
  it('infers from explicit markers with word boundaries', () => {
    expect(inferTimeOfDayFromText('Sunday Breakfast at the estate')).toBe('morning');
    expect(inferTimeOfDayFromText('The rooftop at 4am')).toBe('night');
    expect(inferTimeOfDayFromText('A knight rides to the tournament')).toBeUndefined();
    expect(inferTimeOfDayFromText('dusk settles over the pass')).toBe('dusk');
  });
});

describe('assignBlueprintTimeline', () => {
  it('keeps assigned times, infers from text, inherits across gaps, derives jumps', () => {
    const scenes = [
      scene({ id: 's1', name: 'Morning at the bookshop', location: 'bookshop' }),
      scene({ id: 's2', name: 'The argument', location: 'bookshop' }),
      scene({ id: 's3', name: 'Rooftop at midnight', location: 'rooftop' }),
    ];
    assignBlueprintTimeline(scenes);

    expect(scenes[0].timeOfDay).toBe('morning');
    // s2 has no marker — inherits the morning.
    expect(scenes[1].timeOfDay).toBe('morning');
    expect(scenes[1].timeJumpFromPrevious).toContain('continuous');
    // s3 names midnight and moves location: jump must describe both.
    expect(scenes[2].timeOfDay).toBe('night');
    expect(scenes[2].timeJumpFromPrevious).toContain('time passes');
    expect(scenes[2].timeJumpFromPrevious).toContain('bookshop to rooftop');
  });

  it('never fabricates a time when nothing names one', () => {
    const scenes = [scene({ id: 's1' }), scene({ id: 's2' })];
    assignBlueprintTimeline(scenes);
    expect(scenes[0].timeOfDay).toBeUndefined();
    expect(scenes[1].timeOfDay).toBeUndefined();
  });

  it('is idempotent and keeps an authored timeJumpFromPrevious', () => {
    const scenes = [
      scene({ id: 's1', timeOfDay: 'evening' }),
      scene({ id: 's2', location: 'cellar', timeJumpFromPrevious: 'later that night' }),
    ];
    assignBlueprintTimeline(scenes);
    assignBlueprintTimeline(scenes);
    expect(scenes[1].timeJumpFromPrevious).toBe('later that night');
    expect(scenes[1].timeOfDay).toBe('evening');
  });
});

describe('buildSceneTimelineHandoff', () => {
  const scenes = [
    scene({ id: 's1', name: 'Bookshop', location: 'bookshop', timeOfDay: 'afternoon' }),
    scene({ id: 'enc-1', name: 'Ambush', location: 'alley', timeOfDay: 'night', isEncounter: true }),
    scene({ id: 's2', name: 'Aftermath', location: 'apartment', timeOfDay: 'night' }),
  ];

  it('returns undefined for the first scene', () => {
    expect(buildSceneTimelineHandoff(scenes, scenes[0])).toBeUndefined();
  });

  it('flags time and location changes', () => {
    const handoff = buildSceneTimelineHandoff(scenes, scenes[1])!;
    expect(handoff.locationChanged).toBe(true);
    expect(handoff.timeChanged).toBe(true);
    expect(handoff.previous?.sceneName).toBe('Bookshop');
  });

  it('crosses the encounter seam (previous can be an encounter)', () => {
    const handoff = buildSceneTimelineHandoff(scenes, scenes[2])!;
    expect(handoff.previous?.sceneName).toBe('Ambush');
    expect(handoff.previous?.isEncounter).toBe(true);
    expect(handoff.locationChanged).toBe(true);
    expect(handoff.timeChanged).toBe(false);
  });
});

describe('sceneTimelineMetaForScene', () => {
  it('persists planned fields plus the writer transitionIn', () => {
    const meta = sceneTimelineMetaForScene(
      scene({ id: 's2', location: 'rooftop', timeOfDay: 'night', timeJumpFromPrevious: 'later that night' }),
      'Later that night,',
    );
    expect(meta).toEqual({
      location: 'rooftop',
      timeOfDay: 'night',
      timeJumpFromPrevious: 'later that night',
      transitionIn: 'Later that night,',
    });
  });

  it('returns undefined when there is nothing to persist', () => {
    expect(sceneTimelineMetaForScene(scene({ id: 's1', location: '' }))).toBeUndefined();
  });

  it('r115 (2026-07-18): an explicit clock time in the authored prose overrides stale planned metadata', () => {
    // Live regression: bite-me-r115_2026-07-18T04-37-51 shipped s1-6 tagged
    // timeOfDay "dusk" while the beat text read "...illuminated in the blue
    // twilight of 4 AM."
    const meta = sceneTimelineMetaForScene(
      scene({ id: 's1-6', location: 'apartment', timeOfDay: 'dusk' }),
      undefined,
      'It\'s finished. The story sits complete on the screen, illuminated in the blue twilight of 4 AM.',
    );
    expect(meta?.timeOfDay).toBe('night');
  });

  it('keeps planned timeOfDay when the prose has no explicit clock mention', () => {
    const meta = sceneTimelineMetaForScene(
      scene({ id: 's1-3', location: 'bookshop', timeOfDay: 'afternoon' }),
      undefined,
      'The bell above the door chimes as you step inside the dusty bookshop.',
    );
    expect(meta?.timeOfDay).toBe('afternoon');
  });

  it('fills in missing planned timeOfDay from an explicit clock mention', () => {
    const meta = sceneTimelineMetaForScene(
      scene({ id: 's2-1', location: 'kitchen' }),
      undefined,
      'At 7 AM the kitchen is already loud with breakfast.',
    );
    expect(meta?.timeOfDay).toBe('morning');
  });
});

describe('inferExplicitClockTimeFromText', () => {
  it('maps explicit clock hours to the canonical bucket', () => {
    expect(inferExplicitClockTimeFromText('the blue twilight of 4 AM')).toBe('night');
    expect(inferExplicitClockTimeFromText('at 7am the kitchen is loud')).toBe('morning');
    expect(inferExplicitClockTimeFromText('11:30 p.m. and the bar is closing')).toBe('night');
    expect(inferExplicitClockTimeFromText('at noon the square empties')).toBe('midday');
    expect(inferExplicitClockTimeFromText('midnight strikes')).toBe('night');
    expect(inferExplicitClockTimeFromText('a 6pm reservation')).toBe('dusk');
  });

  it('ignores atmospheric words with no numeric clock mention', () => {
    expect(inferExplicitClockTimeFromText('dusk settles over the pass')).toBeUndefined();
    expect(inferExplicitClockTimeFromText('a knight rides at dawn')).toBeUndefined();
    expect(inferExplicitClockTimeFromText(undefined)).toBeUndefined();
  });
});
