import { describe, expect, it } from 'vitest';
import { collectRouteEvidenceSurfaceIndex } from './encounterTextSurfaces';

// Regression for bite-me_2026-07-14T21-31-30: the beats-based encounter model
// (no `phases`, no `outcomes` map) keeps its route-specific prose in
// beats[].choices[].outcomes.<tier>. The route surface index only read
// phases/outcomes/storylets, so every route task validated against empty
// surfaces and all six tiers failed despite the evidence being on-page.

const beatsBasedEncounter = {
  sceneId: 'treatment-enc-1-1',
  beats: [
    {
      id: 'enc-b1',
      text: 'Victor lunges across the newsstand, teeth bared.',
      choices: [
        {
          id: 'enc-b1-c1',
          text: 'Break for the bookshop door.',
          outcomes: {
            success: { narrativeText: 'Stela intervenes, hauling you inside — rescued before his hand closes on your coat.' },
            complicated: { narrativeText: 'Stela pulls you clear at the last instant, but your bag spills across the pavement.' },
            failure: { narrativeText: 'He catches your sleeve before anyone can reach you.' },
          },
        },
      ],
    },
  ],
  storylets: {
    victory: { beats: [{ id: 'st-v-1', text: 'The street settles; the danger is past.' }] },
    partialVictory: { beats: [{ id: 'st-p-1', text: 'You are safe, but shaken and lighter one bag.' }] },
    defeat: { beats: [{ id: 'st-d-1', text: 'The world narrows to his grip.' }] },
    escape: { beats: [{ id: 'st-e-1', text: 'You run and do not look back.' }] },
  },
};

describe('collectRouteEvidenceSurfaceIndex (beats-based encounters)', () => {
  it('indexes per-tier choice-outcome prose from encounter.beats as encounter_phase', () => {
    const complicated = collectRouteEvidenceSurfaceIndex({ encounter: beatsBasedEncounter, outcomeTier: 'complicated' });
    expect(complicated.encounter_phase.join(' ')).toContain('pulls you clear');
    // Alias mapping: the 'complicated' tier also reads the partialVictory storylet.
    expect(complicated.terminal_storylet.join(' ')).toContain('lighter one bag');

    const success = collectRouteEvidenceSurfaceIndex({ encounter: beatsBasedEncounter, outcomeTier: 'success' });
    expect(success.encounter_phase.join(' ')).toContain('rescued before his hand closes');
    // Sibling-route prose stays out of this tier's surfaces.
    expect(success.encounter_phase.join(' ')).not.toContain('pulls you clear');
  });

  it('keeps phases-based encounters working unchanged', () => {
    const phasesEncounter = {
      phases: [{ beats: [{ id: 'p1-b1', text: 'The alley narrows.' }], onSuccess: { outcomeText: 'You slip free, saved by the crowd.' } }],
      outcomes: { victory: { narrativeText: 'Stela shielded you the whole way home.' } },
    };
    const index = collectRouteEvidenceSurfaceIndex({ encounter: phasesEncounter, outcomeTier: 'victory' });
    expect(index.encounter_outcome.join(' ')).toContain('shielded you');
    expect(index.encounter_phase.join(' ')).toContain('The alley narrows');
  });
});
