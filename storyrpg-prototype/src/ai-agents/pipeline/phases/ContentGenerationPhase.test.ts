import { describe, expect, it } from 'vitest';

import { isEncounterNarrativelyHollow } from '../encounterCompleteness';
import { filterProtagonistEncounterRefs } from '../encounterParticipants';

describe('ContentGenerationPhase encounter completeness', () => {
  it('treats an id-only encounter beat as hollow', () => {
    expect(isEncounterNarrativelyHollow({ beats: [{ id: 'beat-1' } as any] })).toBe(true);
  });

  it('accepts an encounter with player-facing setup prose', () => {
    expect(isEncounterNarrativelyHollow({
      beats: [{
        id: 'beat-1',
        setupText: 'Fog closes over the park path as the figure steps out from the willow shadows.',
      } as any],
    })).toBe(false);
  });

  it('accepts an encounter with authored choice outcome prose', () => {
    expect(isEncounterNarrativelyHollow({
      beats: [{
        id: 'beat-1',
        choices: [{
          id: 'choice-1',
          text: 'Hold your ground.',
          outcomes: {
            success: {
              narrativeText: 'You plant your feet and make the attacker hesitate long enough for help to arrive.',
            },
          },
        }],
      } as any],
    })).toBe(false);
  });
});

describe('filterProtagonistEncounterRefs', () => {
  it('removes protagonist id, full name, and first-name refs before EncounterArchitect NPC handoff', () => {
    expect(filterProtagonistEncounterRefs(
      ['char-kylie-marinescu', 'Kylie Marinescu', 'Kylie', 'Victor Vâlcescu', 'char-stela-pavel'],
      { id: 'char-kylie-marinescu', name: 'Kylie Marinescu' },
    )).toEqual(['Victor Vâlcescu', 'char-stela-pavel']);
  });

  it('matches protagonist refs through accents and punctuation normalization', () => {
    expect(filterProtagonistEncounterRefs(
      ['char-kylie-marinescu', 'Kylie-Marinescu', 'Mika Drăgan'],
      { id: 'char-kylie-marinescu', name: 'Kylie Marinescu' },
    )).toEqual(['Mika Drăgan']);
  });
});
