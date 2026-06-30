import { describe, expect, it } from 'vitest';
import {
  buildAudioPerformanceScript,
  hasAudioPerformanceTagLeak,
  stripAudioPerformanceTags,
} from './audioPerformance';

describe('audioPerformance', () => {
  it('adds performance tags only to the internal audio script', () => {
    const beat = {
      beatId: 'beat-1',
      text: 'Mara pulls you behind the service door before the guards turn.',
      speaker: 'Mara',
      speakerMood: 'urgent and hushed',
    };

    const script = buildAudioPerformanceScript(beat, true);

    expect(script).toMatch(/^\[(?:hushed|urgent)\]/);
    expect(beat.text).toBe('Mara pulls you behind the service door before the guards turn.');
    expect(stripAudioPerformanceTags(script)).toBe(beat.text);
  });

  it('detects and strips provider-facing audio tags from player-facing text', () => {
    expect(hasAudioPerformanceTagLeak('[whispering] You hear the lock give.')).toBe(true);
    expect(hasAudioPerformanceTagLeak('<prosody rate="slow">You wait.</prosody>')).toBe(true);
    expect(stripAudioPerformanceTags('[whispering] You hear the lock give.')).toBe('You hear the lock give.');
  });
});
